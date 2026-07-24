import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import sharp from 'sharp';
import { db } from '@/lib/db';
import { ragSearch } from '@/lib/kb/rag';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_FORMAT = new Set(['jpeg', 'png', 'webp']);

type Language = 'en' | 'bn';

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

function safeNextSteps(language: Language, status: string): string[] {
  if (status === 'not_leaf') {
    return language === 'bn'
      ? ['একটি পাতার পরিষ্কার ছবি দিন।', 'প্রাকৃতিক আলোতে পাতার সামনের ও পেছনের দিক আলাদাভাবে তুলুন।']
      : ['Upload a clear photo of a plant leaf.', 'Photograph the front and back of the leaf separately in natural light.'];
  }
  if (status === 'healthy') {
    return language === 'bn'
      ? ['পরবর্তী ৫–৭ দিন নতুন দাগ, হলদে হওয়া বা মুড়ে যাওয়া দেখা যায় কি না পর্যবেক্ষণ করুন।', 'লক্ষণ দেখা দিলে পাতার দুই পাশ ও পুরো গাছের নতুন ছবি তুলুন।']
      : ['Monitor for new spots, yellowing, or curling over the next 5–7 days.', 'If symptoms appear, photograph both leaf surfaces and the whole plant.'];
  }
  return language === 'bn'
    ? ['একই গাছের পাতার সামনে, পেছনে এবং পুরো গাছের ছবি তুলুন।', 'কতটি গাছ আক্রান্ত এবং লক্ষণ কতদিন ধরে আছে তা লিখে রাখুন।', 'ছবির ফলের ওপর ভিত্তি করে কীটনাশক/ছত্রাকনাশক প্রয়োগ করবেন না; স্থানীয় কৃষি কর্মকর্তা বা উদ্ভিদ রোগ বিশেষজ্ঞের মাধ্যমে নিশ্চিত করুন।', 'আক্রান্ত গাছের উপকরণ অন্য জমিতে নেওয়া আপাতত বন্ধ রাখুন।']
    : ['Photograph the leaf front, leaf back, and the whole plant.', 'Record how many plants are affected and when symptoms began.', 'Do not apply a pesticide or fungicide from an image result alone; confirm with a local extension officer or plant pathologist.', 'Avoid moving affected plant material to another field until confirmed.'];
}

function formatAnswer(result: any, language: Language): string {
  const candidates = result.candidates as any[];
  const candidateLines = candidates.length
    ? candidates.map((candidate, index) => `${index + 1}. **${candidate.displayName || candidate.canonicalDiseaseName}** — ${candidate.visualMatchScore}/100 ${language === 'bn' ? 'ভিজ্যুয়াল মিল' : 'visual match'}\n   - ${language === 'bn' ? 'দেখা লক্ষণ' : 'Visible signs'}: ${candidate.symptomsSeen.join(', ') || (language === 'bn' ? 'পর্যাপ্ত নয়' : 'insufficient')}\n   - ${language === 'bn' ? 'কেন সম্ভাব্য' : 'Why possible'}: ${candidate.whyPossible || '—'}\n   - ${language === 'bn' ? 'যা দেখে আলাদা করা যাবে' : 'Differentiating check'}: ${candidate.whatWouldDifferentiate || '—'}`).join('\n')
    : (language === 'bn' ? '- নির্ভরযোগ্য রোগ প্রার্থী পাওয়া যায়নি।' : '- No reliable disease candidate was identified.');
  const evidenceLines = result.knowledgeEvidence.length
    ? result.knowledgeEvidence.map((item: any) => `- ${item.id}: ${item.text}${item.sourceUrl ? ` ([${item.source}](${item.sourceUrl}))` : ` (${item.source})`}`).join('\n')
    : (language === 'bn' ? '- এই ভিজ্যুয়াল প্রার্থীর জন্য জ্ঞানভান্ডারে সরাসরি মিল পাওয়া যায়নি।' : '- No direct knowledge-base match was found for this visual candidate.');

  if (language === 'bn') {
    return `## 📷 পাতার ছবির প্রাথমিক রোগ বিশ্লেষণ

**ফসলের সম্ভাব্য পরিচয়:** ${result.crop.displayName || result.crop.canonicalName || 'অনিশ্চিত'} (${result.crop.visualMatchScore}/100 ভিজ্যুয়াল মিল)  
**ছবির মান:** ${result.imageAssessment.quality}  
**ফল:** ${result.statusLabel}

### সম্ভাব্য রোগসমূহ

${candidateLines}

### এখন কী করবেন

${result.nextSteps.map((step: string) => `- ${step}`).join('\n')}

${result.questions.length ? `### নিশ্চিত হতে আরও তথ্য\n\n${result.questions.map((question: string) => `- ${question}`).join('\n')}\n\n` : ''}### জ্ঞানভান্ডারের প্রমাণ

${evidenceLines}

> **সতর্কতা:** এটি ছবি-ভিত্তিক প্রাথমিক যাচাই, নিশ্চিত রোগ নির্ণয় নয়। ভিজ্যুয়াল মিলের স্কোর মডেলের নির্ভুলতার হার নয়। রাসায়নিক ব্যবহারের আগে স্থানীয় কৃষি কর্মকর্তা/উদ্ভিদ রোগ বিশেষজ্ঞের পরামর্শ নিন।`;
  }

  return `## 📷 Preliminary leaf-disease analysis

**Likely crop:** ${result.crop.displayName || result.crop.canonicalName || 'Uncertain'} (${result.crop.visualMatchScore}/100 visual match)  
**Image quality:** ${result.imageAssessment.quality}  
**Result:** ${result.statusLabel}

### Possible diseases

${candidateLines}

### What to do now

${result.nextSteps.map((step: string) => `- ${step}`).join('\n')}

${result.questions.length ? `### Information needed to confirm\n\n${result.questions.map((question: string) => `- ${question}`).join('\n')}\n\n` : ''}### Knowledge-base evidence

${evidenceLines}

> **Caution:** This is image-based visual triage, not a confirmed diagnosis. A visual-match score is not model accuracy. Confirm with a local extension officer or plant pathologist before applying chemicals.`;
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
    if (!metadata.format || !ALLOWED_FORMAT.has(metadata.format)) throw new Error('The uploaded file is not a supported image');
    if (!metadata.width || !metadata.height || metadata.width < 128 || metadata.height < 128) {
      return NextResponse.json({ error: 'Image dimensions must be at least 128×128 pixels' }, { status: 400 });
    }

    const normalized = await pipeline.rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
    const dataUrl = `data:image/jpeg;base64,${normalized.toString('base64')}`;
    const outputLanguage = language === 'bn' ? 'Bangla (বাংলা)' : 'English';
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_VISION_MODEL || 'gpt-5.4-mini';
    const completion = await client.chat.completions.create({
      model,
      store: false,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 1400,
      messages: [
        {
          role: 'system',
          content: `You perform conservative visual triage of plant-leaf photos. You do not provide a certain diagnosis, treatment, pesticide, fungicide, chemical, dose, or guarantee. Distinguish disease from nutrient stress, pest damage, sunscald, physical injury, and image artifacts. If the image is not clearly a plant leaf or image quality is inadequate, say so. Scores are visual-similarity scores from 0-100, never probabilities or accuracy. Return only valid JSON. User-facing displayName, symptomsSeen, explanations, limitations, and questions must be in ${outputLanguage}; canonical names remain English.

Before ranking, systematically compare lesion color, shape, texture, margins/halos, vein relationship, upper-vs-lower-surface signs, and distribution. Generic spotting alone must not receive a high score. For PlantVillage-style crops, explicitly compare the applicable benchmark classes: Apple (Apple Scab, Black Rot, Cedar Apple Rust, healthy); Corn (Gray Leaf Spot, Common Rust, Northern Leaf Blight, healthy); Grape (Black Rot, Esca/Black Measles, Leaf Blight, healthy); Potato (Early Blight, Late Blight, healthy); Tomato (Bacterial Spot, Early Blight, Late Blight, Leaf Mold, Septoria Leaf Spot, Spider Mites, Target Spot, Yellow Leaf Curl Virus, Mosaic Virus, healthy); Pepper (Bacterial Spot, healthy); Strawberry (Leaf Scorch, healthy); Peach (Bacterial Spot, healthy); Cherry (Powdery Mildew, healthy); Squash (Powdery Mildew); Orange (Citrus Greening). You may return another disease or non-disease cause when visual evidence supports it. On Apple, distinguish orange/yellow circular rust spots from olive, velvety, irregular scab lesions and frog-eye black-rot lesions.`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Crop hint from farmer profile: ${cropHint || 'none'}. Analyze only visible evidence and return this JSON shape: {"imageAssessment":{"isPlantLeaf":boolean,"quality":"good|fair|poor","limitations":[string]},"crop":{"canonicalName":string,"displayName":string,"visualMatchScore":number},"diagnosisStatus":"healthy|possible_disease|uncertain|not_leaf","statusLabel":string,"candidates":[{"canonicalDiseaseName":string,"displayName":string,"visualMatchScore":number,"symptomsSeen":[string],"whyPossible":string,"whatWouldDifferentiate":string}],"questions":[string]}. Return at most 3 disease candidates in descending score order.`,
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
    let diagnosisStatus = ['healthy', 'possible_disease', 'uncertain', 'not_leaf'].includes(raw.diagnosisStatus) ? raw.diagnosisStatus : 'uncertain';
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

    const crop = {
      canonicalName: text(raw.crop?.canonicalName, cropHint || 'Uncertain'),
      displayName: text(raw.crop?.displayName, text(raw.crop?.canonicalName, cropHint || (language === 'bn' ? 'অনিশ্চিত' : 'Uncertain'))),
      visualMatchScore: score(raw.crop?.visualMatchScore),
    };
    const query = `${crop.canonicalName} ${candidates[0]?.canonicalDiseaseName || ''} plant disease symptoms management`;
    const knowledgeEvidence = diagnosisStatus === 'possible_disease'
      ? ragSearch(query, 5).map(item => ({ id: item.chunk.id, text: item.chunk.text, source: item.chunk.source, sourceUrl: item.chunk.sourceUrl, score: Number(item.score.toFixed(3)) }))
      : [];
    const result = {
      imageAssessment,
      crop,
      diagnosisStatus,
      statusLabel: language === 'bn'
        ? ({ healthy: 'দৃশ্যত সুস্থ', possible_disease: 'সম্ভাব্য রোগ', uncertain: 'অনিশ্চিত—আরও তথ্য প্রয়োজন', not_leaf: 'পাতার ছবি নয়' } as Record<string, string>)[diagnosisStatus]
        : ({ healthy: 'Visually healthy', possible_disease: 'Possible disease', uncertain: 'Uncertain—more evidence needed', not_leaf: 'Not a leaf image' } as Record<string, string>)[diagnosisStatus],
      candidates,
      questions: stringList(raw.questions, 5),
      nextSteps: safeNextSteps(language, diagnosisStatus),
      knowledgeEvidence,
      model,
      analysisNature: 'AI vision-assisted symptom triage; not a trained local diagnostic-lab result',
      image: { width: metadata.width, height: metadata.height, originalBytes: file.size, normalizedBytes: normalized.length, persisted: false },
    };
    const answer = formatAnswer(result, language);

    const farmer = await db.farmer.upsert({ where: { sessionId }, update: {}, create: { sessionId } });
    await db.$transaction([
      db.conversation.create({ data: { farmerId: farmer.id, role: 'user', content: language === 'bn' ? `📷 রোগ শনাক্তকরণের জন্য পাতার ছবি আপলোড করেছি${cropHint ? ` (${cropHint})` : ''}।` : `📷 Uploaded a leaf photo for disease detection${cropHint ? ` (${cropHint})` : ''}.` } }),
      db.conversation.create({ data: { farmerId: farmer.id, role: 'assistant', content: answer } }),
      db.traceEntry.create({ data: { farmerId: farmer.id, toolName: 'analyze_plant_image', toolArgs: JSON.stringify({ cropHint: cropHint || null, language, image: result.image }), toolResult: JSON.stringify(result).slice(0, 50000), durationMs: Date.now() - startedAt } }),
    ]);

    return NextResponse.json({ answer, result, trace: [{ iteration: 1, toolName: 'analyze_plant_image', toolArgs: { cropHint: cropHint || null, language, image: result.image }, toolResult: result, durationMs: Date.now() - startedAt, timestamp: new Date().toISOString() }] });
  } catch (error: any) {
    console.error('[/api/disease-detection] error:', error);
    return NextResponse.json({ error: error.message || 'Disease analysis failed' }, { status: 500 });
  }
}
