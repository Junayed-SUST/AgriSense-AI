// AgriSense AI — RAG retriever (Tier 0 #7)
//
// Two-corpus TF-IDF retriever:
//   1. Structured KB (crops.ts) — ~80 chunks with calendars, fertilizer, financials
//   2. Verified Facts KB (verified_facts.ts) — 1000 verified facts from BARI/BWMRI/BRRI/FAO
//
// Total searchable chunks: ~1080. Each query returns top-K merged results across
// both corpora, with source citations preserved so the agent can ground its
// recommendations in real institutional data.
//
// Improvements over the v1 retriever:
//   - Stemming (Porter-lite) — "irrigation" matches "irrigate", "sandy" matches "sand"
//   - Crop-name synonyms — "Aman rice" / "T. Aman" / "T. Aman Rice" all match
//   - Query expansion — adds category keywords for common query patterns
//   - Source diversity — caps results per source to avoid one institution dominating

import { CROPS, SOILS, SEASONS, type CropRecord } from './crops';
import { VERIFIED_FACTS, type VerifiedFact } from './verified_facts';

export interface KbChunk {
  id: string;
  source: string;
  sourceUrl?: string;
  sourceLocator?: string;
  text: string;
  cropId?: string;
  cropName?: string;
  category?: string;
  factName?: string;
  value?: string;
  unit?: string;
  institution?: string;
  kind: 'structured' | 'verified';
}

// ---------- Build the two corpora ----------

function buildStructuredCorpus(): KbChunk[] {
  const chunks: KbChunk[] = [];

  for (const c of CROPS) {
    chunks.push({
      id: `crop-${c.id}-overview`,
      source: c.source,
      cropId: c.id,
      cropName: c.name,
      kind: 'structured',
      text: [
        `${c.name} (${c.bnName}, ${c.scientificName}) is grown in seasons: ${c.seasons.join(', ')}.`,
        `Total duration: ${c.durationDays} days. Water need: ${c.waterNeedMm} mm/season.`,
        `Suitable soils: ${c.suitableSoils.join(', ')}. Rainfall tolerance: ${c.rainfallTolerance}.`,
        `Typical yield: ${c.typicalYieldPerAcre.min}-${c.typicalYieldPerAcre.max} ${c.typicalYieldPerAcre.unit}/acre.`,
        `Typical farmgate price: ${c.typicalPricePerUnit.min}-${c.typicalPricePerUnit.max} BDT/${c.typicalPricePerUnit.unit}.`,
        `Risk level: ${c.riskLevel}. ${c.riskNotes}`,
        `Notes: ${c.notes}`,
      ].join(' '),
    });

    const fertEntries = Object.entries(c.fertilizerKgPerAcre)
      .map(([k, v]) => `${k}: ${v} kg/acre`)
      .join('; ');
    chunks.push({
      id: `crop-${c.id}-fertilizer`,
      source: c.source,
      cropId: c.id,
      cropName: c.name,
      category: 'Fertilizer',
      kind: 'structured',
      text: `Fertilizer recommendation for ${c.name} per acre: ${fertEntries}. Apply basal NPK + TSP + MOP at final land preparation. Urea applied as top dress in 2-3 splits during vegetative stage.`,
    });

    const stageText = c.growthStages
      .map(s => `${s.name} (days ${s.dayRange[0]}-${s.dayRange[1]}): ${s.keyActions.join(', ')}`)
      .join(' | ');
    chunks.push({
      id: `crop-${c.id}-calendar`,
      source: c.source,
      cropId: c.id,
      cropName: c.name,
      category: 'Crop calendar',
      kind: 'structured',
      text: `Crop calendar for ${c.name}: ${stageText}`,
    });

    chunks.push({
      id: `crop-${c.id}-pests`,
      source: c.source,
      cropId: c.id,
      cropName: c.name,
      category: 'Pest management',
      kind: 'structured',
      text: `${c.name} major pests: ${c.majorPests.join(', ')}. Major diseases: ${c.majorDiseases.join(', ')}. Monitor weekly. Practice IPM: rotate crops, use resistant varieties, threshold-based pesticide application.`,
    });

    chunks.push({
      id: `crop-${c.id}-water`,
      source: c.source,
      cropId: c.id,
      cropName: c.name,
      category: 'Irrigation',
      kind: 'structured',
      text: `${c.name} water management: total seasonal need ${c.waterNeedMm} mm. Preferred water sources (priority): ${c.waterSourcePreference.join(', ')}. Rainfall tolerance: ${c.rainfallTolerance}.`,
    });
  }

  for (const s of SOILS) {
    chunks.push({
      id: `soil-${s.type}`,
      source: 'BARC Soil Classification Guide',
      category: 'Soil',
      kind: 'structured',
      text: `${s.type.charAt(0).toUpperCase() + s.type.slice(1)} soil: ${s.description} Water retention: ${s.waterRetention}. Fertility: ${s.fertility}. Drainage: ${s.drainage}. Best-suited crops: ${s.bestCrops.join(', ')}. Amendment tips: ${s.amendmentTips.join('; ')}.`,
    });
  }

  for (const s of SEASONS) {
    chunks.push({
      id: `season-${s.id}`,
      source: 'DAE Crop Calendar Bangladesh',
      category: 'Season classification',
      kind: 'structured',
      text: `${s.id.toUpperCase()} season (${s.bnName}): ${s.description} Sowing window: ${s.sowingWindow}. Harvest window: ${s.harvestWindow}. Rainfall pattern: ${s.rainfallPattern}.`,
    });
  }

  return chunks;
}

function buildVerifiedCorpus(): KbChunk[] {
  return VERIFIED_FACTS.map(f => ({
    id: f.id,
    source: `${f.sourceInstitution} — ${f.sourceTitle}`,
    sourceUrl: f.sourceUrl,
    sourceLocator: f.sourceLocator,
    text: f.searchableText,
    cropName: f.crop,
    category: f.category,
    factName: f.factName,
    value: f.value,
    unit: f.unit,
    institution: f.sourceInstitution,
    kind: 'verified' as const,
  }));
}

const STRUCTURED_CORPUS = buildStructuredCorpus();
const VERIFIED_CORPUS = buildVerifiedCorpus();
const ALL_CORPUS = [...STRUCTURED_CORPUS, ...VERIFIED_CORPUS];

// ---------- Tokenization + stemming ----------

// Very light Porter-like stemmer — handles common English endings.
// Not perfect, but improves recall substantially for ag queries.
function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length <= 3) return w;

  // Plurals and -ed/-ing
  if (w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('es')) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);

  if (w.endsWith('ing')) w = w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);

  // Common ag-specific normalizations
  if (w === 'irrigated') w = 'irrigate';
  if (w === 'irrigation') w = 'irrigate';
  if (w === 'fertilization') w = 'fertilize';
  if (w === 'fertilizer') w = 'fertilize';
  if (w === 'cultivation') w = 'cultivate';
  if (w === 'grown') w = 'grow';
  if (w === 'growing') w = 'grow';
  if (w === 'sandy') w = 'sand';
  if (w === 'clayey') w = 'clay';
  if (w === 'loamy') w = 'loam';
  if (w === 'silty') w = 'silt';
  if (w === 'saline') w = 'salt';
  if (w === 'rainfed') w = 'rain';
  if (w === 'tomatoes') w = 'tomato';
  if (w === 'potatoes') w = 'potato';

  return w;
}

// Crop-name synonyms — normalize variant spellings to a canonical form
const CROP_SYNONYMS: Record<string, string[]> = {
  'aman': ['t. aman', 't. aman rice', 't aman', 't aman rice', 'transplanted aman', 't-aman'],
  'boro': ['boro rice', 't. boro', 't boro'],
  'aus': ['aus rice', 't. aus', 't aus'],
  'rice': ['paddy', 'dhan', 'ধান'],
  'wheat': ['gom', 'গম'],
  'maize': ['corn', 'ভুট্টা'],
  'potato': ['alu', 'আলু'],
  'mustard': ['sarisha', 'সরিষা', 'rapeseed'],
  'lentil': ['masur', 'masoor', 'মসুর'],
  'jute': ['pat', 'পাট'],
  'tomato': ['টমেটো'],
  'brinjal': ['eggplant', 'begun', 'বেগুন', 'bt brinjal'],
  'chili': ['chilli', 'morich', 'মরিচ'],
  'onion': ['peyaj', 'পেঁয়াজ'],
  'garlic': ['rasun', 'রসুন'],
  'mungbean': ['mung', 'moong', 'mug'],
  'cabbage': ['badhakopi', 'বাঁধাকপি'],
  'mango': ['aam', 'আম'],
  'coconut': ['narkel', 'নারকেল'],
};

function expandQuery(tokens: string[]): string[] {
  const expanded = new Set(tokens);
  for (const t of tokens) {
    const lower = t.toLowerCase();
    // If token matches a canonical crop name, add all its synonyms
    const syns = CROP_SYNONYMS[lower];
    if (syns) {
      for (const s of syns) {
        for (const w of s.split(/\s+/)) expanded.add(stem(w));
      }
    }
    // Reverse: if token is a synonym, add the canonical form
    for (const [canonical, synList] of Object.entries(CROP_SYNONYMS)) {
      if (synList.some(s => s.toLowerCase().includes(lower))) {
        expanded.add(stem(canonical));
      }
    }
  }
  return Array.from(expanded);
}

function tokenize(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
  return raw.map(stem);
}

// ---------- TF-IDF ----------

const DF = new Map<string, number>();
const DOC_TOKENS = ALL_CORPUS.map(doc => {
  const tokens = tokenize(doc.text);
  const unique = new Set(tokens);
  for (const t of unique) {
    DF.set(t, (DF.get(t) || 0) + 1);
  }
  return tokens;
});

const N = ALL_CORPUS.length;

function idf(term: string): number {
  const df = DF.get(term) || 0;
  return Math.log((N + 1) / (df + 1)) + 1;
}

function tfidfVector(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  const vec = new Map<string, number>();
  for (const [term, freq] of tf) {
    vec.set(term, freq * idf(term));
  }
  let norm = 0;
  for (const v of vec.values()) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (const [term, v] of vec) vec.set(term, v / norm);
  return vec;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [term, v] of small) {
    const w = large.get(term);
    if (w) dot += v * w;
  }
  return dot;
}

// Precompute all doc vectors at module load
const DOC_VECS = DOC_TOKENS.map(tokens => tfidfVector(tokens));

export interface RetrievalResult {
  chunk: KbChunk;
  score: number;
}

export function ragSearch(query: string, topK = 8): RetrievalResult[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  // Query expansion: add synonyms
  const expandedTokens = expandQuery(qTokens);
  const qVec = tfidfVector(expandedTokens);

  const scored = DOC_VECS.map((docVec, idx) => ({
    chunk: ALL_CORPUS[idx],
    score: cosine(qVec, docVec),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Source diversity: cap at 3 results per (institution + sourceTitle) to avoid
  // one BARI page dominating the top-K
  const sourceCounts = new Map<string, number>();
  const MAX_PER_SOURCE = 3;
  const filtered: RetrievalResult[] = [];

  for (const s of scored) {
    if (s.score < 0.001) continue;
    const sourceKey = s.chunk.source;
    const count = sourceCounts.get(sourceKey) || 0;
    if (count >= MAX_PER_SOURCE) continue;
    sourceCounts.set(sourceKey, count + 1);
    filtered.push(s);
    if (filtered.length >= topK) break;
  }

  return filtered;
}

// Pretty-print retrieved chunks for the LLM context
export function formatRetrievedContext(results: RetrievalResult[]): string {
  if (results.length === 0) return '(no relevant knowledge base entries found)';
  return results
    .map((r, i) => {
      const c = r.chunk;
      const sourceLine = c.sourceUrl
        ? `${c.source} (${c.sourceUrl})`
        : c.source;
      const valueLine = c.value ? ` Value: ${c.value}${c.unit ? ' ' + c.unit : ''}.` : '';
      return `[${i + 1}] (score=${r.score.toFixed(3)}, source=${sourceLine})\n${c.text}${valueLine}`;
    })
    .join('\n\n');
}

// Helper: get a specific crop record by id (kept for backward compat)
export function getCropById(id: string): CropRecord | undefined {
  return CROPS.find(c => c.id === id);
}

// Helper: list crops suitable for a given season
export function getCropsForSeason(season: string): CropRecord[] {
  return CROPS.filter(c => c.seasons.includes(season as any));
}

// Stats — exposed for the UI to show "1000+ verified facts" badge
export const KB_STATS = {
  totalChunks: ALL_CORPUS.length,
  structuredChunks: STRUCTURED_CORPUS.length,
  verifiedChunks: VERIFIED_CORPUS.length,
  uniqueCrops: new Set(VERIFIED_FACTS.map(f => f.crop)).size,
  uniqueCategories: new Set(VERIFIED_FACTS.map(f => f.category)).size,
  sources: Array.from(new Set(VERIFIED_FACTS.map(f => f.sourceInstitution))),
};
