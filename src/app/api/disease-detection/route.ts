import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import sharp from 'sharp';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_FORMAT = new Set(['jpeg', 'png', 'webp']);

type Language = 'en' | 'bn';
type DiagnosisStatus = 'healthy' | 'possible_disease' | 'uncertain' | 'not_leaf';

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function stringList(value: unknown, limit = 6): string[] {
  return Array.isArray(value) ? value.map(item => text(item)).filter(Boolean).slice(0, limit) : [];
}

function score(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
}

function parseModelJson(content: string): any {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

function fallbackNextSteps(language: Language, status: DiagnosisStatus): string[] {
  if (language === 'bn') {
    if (status === 'not_leaf') return ['পাতার পরিষ্কার ছবি আপলোড করুন।', 'প্রাকৃতিক আলোতে পাতার সামনে ও পেছনের দিক আলাদা করে তুলুন।'];
    if (status === 'healthy') return ['পরবর্তী ৫-৭ দিন নতুন দাগ, হলদে হওয়া বা পাতা কুঁকড়ে যাওয়া আছে কি না দেখুন।'];
    return ['একই গাছের পাতার সামনে, পেছনে এবং পুরো গাছের ছবি তুলুন।', 'রাসায়নিক ব্যবহারের আগে স্থানীয় কৃষি কর্মকর্তা বা উদ্ভিদ রোগ বিশেষজ্ঞের সঙ্গে নিশ্চিত করুন।'];
  }

  if (status === 'not_leaf') return ['Upload a clear photo of a plant leaf.', 'Photograph the front and back of the leaf separately in natural light.'];
  if (status === 'healthy') return ['Monitor for new spots, yellowing, curling, or spreading symptoms over the next 5-7 days.'];
  return ['Photograph the leaf front, leaf back, and the whole plant.', 'Confirm with a local extension officer or plant pathologist before applying chemicals.'];
}

function formatAnswer(result: any, language: Language): string {
  const candidates = result.candidates as any[];
  const candidateLines = candidates.length
    ? candidates.map((candidate, index) => `${index + 1}. **${candidate.displayName || candidate.canonicalDiseaseName}** - ${candidate.visualMatchScore}/100 ${language === 'bn' ? 'ভিজ্যুয়াল মিল' : 'visual match'}\n   - ${language === 'bn' ? 'দৃশ্যমান লক্ষণ' : 'Visible signs'}: ${candidate.symptomsSeen.join(', ') || (language === 'bn' ? 'পর্যাপ্ত নয়' : 'insufficient')}\n   - ${language === 'bn' ? 'কেন সম্ভাব্য' : 'Why possible'}: ${candidate.whyPossible || '-'}\n   - ${language === 'bn' ? 'নিশ্চিত করতে দেখুন' : 'Differentiating check'}: ${candidate.whatWouldDifferentiate || '-'}`).join('\n')
    : (language === 'bn' ? '- নির্ভরযোগ্য রোগ প্রার্থী পাওয়া যায়নি।' : '- No reliable disease candidate was identified.');

  if (language === 'bn') {
    return `## পাতার ছবির GPT বিশ্লেষণ

**সম্ভাব্য ফসল:** ${result.crop.displayName || result.crop.canonicalName || 'অনিশ্চিত'} (${result.crop.visualMatchScore}/100 ভিজ্যুয়াল মিল)  
**ছবির মান:** ${result.imageAssessment.quality}  
**ফল:** ${result.statusLabel}

### সম্ভাব্য রোগ

${candidateLines}

### এখন কী করবেন

${result.nextSteps.map((step: string) => `- ${step}`).join('\n')}

${result.questions.length ? `### নিশ্চিত হতে আরও তথ্য\n\n${result.questions.map((question: string) => `- ${question}`).join('\n')}\n\n` : ''}> **সতর্কতা:** এটি ছবিভিত্তিক প্রাথমিক বিশ্লেষণ, নিশ্চিত রোগ নির্ণয় নয়। রাসায়নিক ব্যবহারের আগে স্থানীয় কৃষি কর্মকর্তা বা উদ্ভিদ রোগ বিশেষজ্ঞের পরামর্শ নিন।`;
  }

  return `## GPT Leaf-Disease Analysis

**Likely crop:** ${result.crop.displayName || result.crop.canonicalName || 'Uncertain'} (${result.crop.visualMatchScore}/100 visual match)  
**Image quality:** ${result.imageAssessment.quality}  
**Result:** ${result.statusLabel}

### Possible Diseases

${candidateLines}

### What To Do Now

${result.nextSteps.map((step: string) => `- ${step}`).join('\n')}

${result.questions.length ? `### Helpful Details To Confirm\n\n${result.questions.map((question: string) => `- ${question}`).join('\n')}\n\n` : ''}> **Caution:** This is image-based visual triage, not a confirmed diagnosis. Confirm with a local extension officer or plant pathologist before applying chemicals.`;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  try {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');

    const form = await req.formData();
    const file = form.get('image');
    const sessionId = text(form.get('sessionId'));
    const language: Language = form.get('language') === 'bn' ? 'bn' : 'en';
    const cropHint = text(form.get('cropHint')).slice(0, 80);

    if (!(file instanceof File)) return NextResponse.json({ error: 'image is required' }, { status: 400 });
    if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    if (!ALLOWED_MIME.has(file.type)) return NextResponse.json({ error: 'Only JPEG, PNG, and WebP images are supported' }, { status: 415 });
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'Image must be between 1 byte and 8 MB' }, { status: 413 });

    const input = Buffer.from(await file.arrayBuffer());
    const pipeline = sharp(input, { failOn: 'error', limitInputPixels: 25_000_000 });
    const metadata = await pipeline.metadata();

    if (!metadata.format || !ALLOWED_FORMAT.has(metadata.format)) {
      return NextResponse.json({ error: 'The uploaded file is not a supported image' }, { status: 415 });
    }
    if (!metadata.width || !metadata.height || metadata.width < 128 || metadata.height < 128) {
      return NextResponse.json({ error: 'Image dimensions must be at least 128x128 pixels' }, { status: 400 });
    }

    const normalized = await pipeline
      .rotate()
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 86 })
      .toBuffer();
    const dataUrl = `data:image/jpeg;base64,${normalized.toString('base64')}`;

    const outputLanguage = language === 'bn' ? 'Bangla' : 'English';
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-5.1';

    const completion = await client.chat.completions.create({
      model,
      store: false,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_completion_tokens: 1400,
      messages: [
        {
          role: 'system',
          content: `You are a careful plant pathologist doing visual triage from a farmer's uploaded image.
Use only visible evidence in the image plus the optional crop hint. Do not assume a closed dataset, do not claim lab certainty, and do not invent field facts that are not visible. Distinguish disease from nutrient stress, pest damage, sunscald, water stress, physical injury, natural aging, and image artifacts.

Scores are visual-similarity scores from 0-100, not probabilities or accuracy. Do not prescribe pesticide, fungicide, chemical product names, or doses. User-facing strings must be in ${outputLanguage}; canonical names may stay in English. Return only valid JSON.`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Crop hint from farmer profile: ${cropHint || 'none'}.
Analyze only visible evidence and return this exact JSON shape:
{
  "imageAssessment": {"isPlantLeaf": boolean, "quality": "good|fair|poor", "limitations": [string]},
  "crop": {"canonicalName": string, "displayName": string, "visualMatchScore": number},
  "diagnosisStatus": "healthy|possible_disease|uncertain|not_leaf",
  "statusLabel": string,
  "candidates": [{"canonicalDiseaseName": string, "displayName": string, "visualMatchScore": number, "symptomsSeen": [string], "whyPossible": string, "whatWouldDifferentiate": string}],
  "questions": [string],
  "nextSteps": [string]
}
Return at most 3 disease candidates. If the image is unclear or multiple causes fit, choose "uncertain".`,
            },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          ],
        },
      ] as any,
    });

    const raw = parseModelJson(completion.choices[0]?.message?.content || '{}');
    const imageAssessment = {
      isPlantLeaf: Boolean(raw.imageAssessment?.isPlantLeaf),
      quality: ['good', 'fair', 'poor'].includes(raw.imageAssessment?.quality) ? raw.imageAssessment.quality : 'poor',
      limitations: stringList(raw.imageAssessment?.limitations),
    };

    let diagnosisStatus: DiagnosisStatus = ['healthy', 'possible_disease', 'uncertain', 'not_leaf'].includes(raw.diagnosisStatus)
      ? raw.diagnosisStatus
      : 'uncertain';
    const candidates = (Array.isArray(raw.candidates) ? raw.candidates : []).slice(0, 3).map((candidate: any) => ({
      canonicalDiseaseName: text(candidate.canonicalDiseaseName, 'Uncertain'),
      displayName: text(candidate.displayName, text(candidate.canonicalDiseaseName, 'Uncertain')),
      visualMatchScore: score(candidate.visualMatchScore),
      symptomsSeen: stringList(candidate.symptomsSeen),
      whyPossible: text(candidate.whyPossible),
      whatWouldDifferentiate: text(candidate.whatWouldDifferentiate),
    })).sort((a: any, b: any) => b.visualMatchScore - a.visualMatchScore);

    if (!imageAssessment.isPlantLeaf) diagnosisStatus = 'not_leaf';
    else if (imageAssessment.quality === 'poor' && diagnosisStatus === 'possible_disease') diagnosisStatus = 'uncertain';
    else if (diagnosisStatus === 'possible_disease' && (!candidates[0] || candidates[0].visualMatchScore < 45)) diagnosisStatus = 'uncertain';
    else if (diagnosisStatus === 'possible_disease' && candidates[1] && candidates[0].visualMatchScore - candidates[1].visualMatchScore < 15) diagnosisStatus = 'uncertain';

    const statusLabel = text(raw.statusLabel) || ({
      healthy: language === 'bn' ? 'দৃশ্যত সুস্থ' : 'Visually healthy',
      possible_disease: language === 'bn' ? 'সম্ভাব্য রোগ' : 'Possible disease',
      uncertain: language === 'bn' ? 'অনিশ্চিত' : 'Uncertain',
      not_leaf: language === 'bn' ? 'পাতার ছবি নয়' : 'Not a leaf image',
    } as Record<DiagnosisStatus, string>)[diagnosisStatus];

    const result = {
      imageAssessment,
      crop: {
        canonicalName: text(raw.crop?.canonicalName, cropHint || 'Uncertain'),
        displayName: text(raw.crop?.displayName, text(raw.crop?.canonicalName, cropHint || 'Uncertain')),
        visualMatchScore: score(raw.crop?.visualMatchScore),
      },
      diagnosisStatus,
      statusLabel,
      candidates,
      questions: stringList(raw.questions, 5),
      nextSteps: stringList(raw.nextSteps, 5).length ? stringList(raw.nextSteps, 5) : fallbackNextSteps(language, diagnosisStatus),
      model,
      analysisNature: language === 'bn'
        ? 'GPT ভিশন-সহায়ক প্রাথমিক লক্ষণ বিশ্লেষণ; এটি নিশ্চিত ল্যাব রোগ নির্ণয় নয়'
        : 'GPT vision-assisted symptom triage; this is not a confirmed diagnostic-lab result',
      image: {
        width: metadata.width,
        height: metadata.height,
        originalBytes: file.size,
        normalizedBytes: normalized.length,
        persisted: false,
      },
    };
    const answer = formatAnswer(result, language);

    const farmer = await db.farmer.upsert({ where: { sessionId }, update: {}, create: { sessionId } });
    await db.$transaction([
      db.conversation.create({
        data: {
          farmerId: farmer.id,
          role: 'user',
          content: language === 'bn'
            ? `পাতার রোগ বিশ্লেষণের জন্য ছবি আপলোড করেছি${cropHint ? ` (${cropHint})` : ''}।`
            : `Uploaded a leaf photo for GPT disease analysis${cropHint ? ` (${cropHint})` : ''}.`,
        },
      }),
      db.conversation.create({ data: { farmerId: farmer.id, role: 'assistant', content: answer } }),
      db.traceEntry.create({
        data: {
          farmerId: farmer.id,
          toolName: 'analyze_plant_image',
          toolArgs: JSON.stringify({ cropHint: cropHint || null, language, image: result.image }),
          toolResult: JSON.stringify(result).slice(0, 50000),
          durationMs: Date.now() - startedAt,
        },
      }),
    ]);

    return NextResponse.json({
      answer,
      result,
      trace: [{
        iteration: 1,
        toolName: 'analyze_plant_image',
        toolArgs: { cropHint: cropHint || null, language, image: result.image },
        toolResult: result,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      }],
    });
  } catch (error: any) {
    console.error('[/api/disease-detection] error:', error);
    return NextResponse.json({ error: error.message || 'Disease analysis failed' }, { status: 500 });
  }
}
