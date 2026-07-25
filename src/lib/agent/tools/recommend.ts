// Tool 2: recommend_crops — ranks 3+ candidate crops for the farm profile + season + weather
// Tier 0 #3. Each recommendation cites the retrieved KB data + weather it used.

import { CROPS, SOILS, SEASONS, INPUT_COSTS, type CropRecord, type Season } from '@/lib/kb/crops';
import { getCropsForSeason, ragSearch } from '@/lib/kb/rag';
import type { WeatherResult } from './weather';

export interface FarmProfile {
  location?: string;
  farmSizeDecimal?: number;
  soilType?: string;
  waterSource?: string;
  budgetBdt?: number;
  targetSeason?: string;
  previousCropId?: string;  // for crop rotation penalty
}

export interface CropRecommendation {
  rank: number;
  cropId: string;
  cropName: string;
  bnName: string;
  suitabilityScore: number;        // 0-100
  waterNeed: 'low' | 'medium' | 'high';
  riskLevel: 'low' | 'medium' | 'high';
  estimatedYieldMaund: number;     // per acre
  estimatedRevenueBdt: number;     // per acre
  estimatedCostBdt: number;        // per acre
  estimatedProfitBdt: number;      // per acre
  roiPercent: number;              // profit/cost * 100
  rationale: string[];             // bullet reasons — each citing inputs/data
  kbEvidence: string[];            // source citations
}

export interface RecommendResult {
  profile: FarmProfile;
  weather: WeatherResult | null;
  recommendations: CropRecommendation[];
  notes: string;
}

function waterNeedLabel(mm: number): 'low' | 'medium' | 'high' {
  if (mm < 300) return 'low';
  if (mm < 700) return 'medium';
  return 'high';
}

// Botanical family map — for crop rotation penalty (same family → same pest/disease pressure)
const CROP_FAMILY_MAP: Record<string, string> = {
  'rice-boro': 'Poaceae',
  'rice-aman': 'Poaceae',
  'rice-aus': 'Poaceae',
  'wheat': 'Poaceae',
  'maize': 'Poaceae',
  'jute': 'Malvaceae',
  'potato': 'Solanaceae',
  'tomato': 'Solanaceae',
  'brinjal': 'Solanaceae',
  'chili': 'Solanaceae',
  'mustard': 'Brassicaceae',
  'lentil': 'Fabaceae',
  'mungbean': 'Fabaceae',
  'groundnut': 'Fabaceae',
  'sesame': 'Pedaliaceae',
  'okra': 'Malvaceae',
  'cucumber': 'Cucurbitaceae',
  'onion': 'Amaryllidaceae',
};

const MIN_RECOMMENDATIONS = 3;
const MAX_RECOMMENDATIONS = 5;

type CandidateSeasonFit = 'exact' | 'nearby' | 'fallback';

interface CandidateEntry {
  crop: CropRecord;
  seasonFit: CandidateSeasonFit;
  backfillSeason?: Season;
}

const SEASON_BACKFILL_ORDER: Record<Season, Season[]> = {
  aus: ['kharif-1', 'aman', 'rabi'],
  aman: ['kharif-2', 'aus', 'rabi'],
  boro: ['rabi', 'aus', 'kharif-1'],
  rabi: ['boro', 'kharif-1', 'kharif-2'],
  'kharif-1': ['aus', 'rabi', 'kharif-2'],
  'kharif-2': ['aman', 'kharif-1', 'rabi'],
};

function buildSeasonCandidates(season: Season): CandidateEntry[] {
  const selected = new Map<string, CandidateEntry>();

  for (const crop of getCropsForSeason(season)) {
    selected.set(crop.id, { crop, seasonFit: 'exact' });
  }

  for (const nearbySeason of SEASON_BACKFILL_ORDER[season] || []) {
    if (selected.size >= MIN_RECOMMENDATIONS) break;

    for (const crop of getCropsForSeason(nearbySeason)) {
      if (selected.size >= MIN_RECOMMENDATIONS) break;
      if (!selected.has(crop.id)) {
        selected.set(crop.id, { crop, seasonFit: 'nearby', backfillSeason: nearbySeason });
      }
    }
  }

  for (const crop of CROPS) {
    if (selected.size >= MIN_RECOMMENDATIONS) break;
    if (!selected.has(crop.id)) {
      selected.set(crop.id, { crop, seasonFit: 'fallback' });
    }
  }

  return Array.from(selected.values());
}

// Parse sowing window string (e.g. "Nov 1 – Dec 15") into month range [startMonth, endMonth] (1-indexed)
const MONTH_MAP: Record<string, number> = {
  'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
  'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
};

function parseSowingWindowMonths(sowingWindow: string): [number, number] | null {
  // Extract month names from the window string (e.g. "Nov 1 – Dec 15")
  const months = sowingWindow.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/g);
  if (!months || months.length < 1) return null;
  const startMonth = MONTH_MAP[months[0]];
  const endMonth = months.length >= 2 ? MONTH_MAP[months[months.length - 1]] : startMonth;
  return [startMonth, endMonth];
}

function isMonthInRange(month: number, start: number, end: number): boolean {
  if (start <= end) return month >= start && month <= end;
  // Wraps around year boundary (e.g. Nov-Feb)
  return month >= start || month <= end;
}

interface CropFinancialAssumption {
  yieldFactor: number;
  priceFactor: number;
  harvestMarketingCostBdt: number;
}

const DEFAULT_FINANCIAL_ASSUMPTION: CropFinancialAssumption = {
  yieldFactor: 0.9,
  priceFactor: 0.85,
  harvestMarketingCostBdt: 3500,
};

const CROP_FINANCIAL_ASSUMPTIONS: Record<string, CropFinancialAssumption> = {
  'rice-boro': { yieldFactor: 0.92, priceFactor: 0.9, harvestMarketingCostBdt: 4500 },
  'rice-aman': { yieldFactor: 0.92, priceFactor: 0.9, harvestMarketingCostBdt: 4200 },
  'rice-aus': { yieldFactor: 0.88, priceFactor: 0.88, harvestMarketingCostBdt: 3500 },
  'wheat': { yieldFactor: 0.88, priceFactor: 0.86, harvestMarketingCostBdt: 3500 },
  'maize': { yieldFactor: 0.9, priceFactor: 0.85, harvestMarketingCostBdt: 4500 },
  'jute': { yieldFactor: 0.88, priceFactor: 0.85, harvestMarketingCostBdt: 9000 },
  'potato': { yieldFactor: 0.82, priceFactor: 0.72, harvestMarketingCostBdt: 16000 },
  'tomato': { yieldFactor: 0.72, priceFactor: 0.62, harvestMarketingCostBdt: 22000 },
  'brinjal': { yieldFactor: 0.75, priceFactor: 0.65, harvestMarketingCostBdt: 20000 },
  'chili': { yieldFactor: 0.78, priceFactor: 0.68, harvestMarketingCostBdt: 14000 },
  'okra': { yieldFactor: 0.76, priceFactor: 0.68, harvestMarketingCostBdt: 15000 },
  'cucumber': { yieldFactor: 0.76, priceFactor: 0.65, harvestMarketingCostBdt: 16000 },
  'onion': { yieldFactor: 0.82, priceFactor: 0.7, harvestMarketingCostBdt: 14000 },
};

function getFinancialAssumption(crop: CropRecord): CropFinancialAssumption {
  return CROP_FINANCIAL_ASSUMPTIONS[crop.id] || DEFAULT_FINANCIAL_ASSUMPTION;
}

function getContingencyRate(crop: CropRecord): number {
  if (crop.riskLevel === 'high') return 0.12;
  if (crop.riskLevel === 'medium') return 0.1;
  return 0.08;
}

function computePerAcreCost(crop: CropRecord): number {
  const f = crop.fertilizerKgPerAcre;
  const c = INPUT_COSTS;
  let cost = 0;
  cost += (f.npk15_15_15 || 0) * c.npk15PerKg;
  cost += (f.urea || 0) * c.ureaPerKg;
  cost += (f.tsp || 0) * c.tspPerKg;
  cost += (f.mop || 0) * c.mopPerKg;
  cost += (f.gypsum || 0) * c.gypsumPerKg;
  cost += (f.zinc || 0) * c.zincPerKg;
  cost += (f.boron || 0) * c.boronPerKg;

  // Seed cost — varies by crop
  const seedKgPerAcre: Record<string, number> = {
    'rice-boro': 25, 'rice-aman': 22, 'rice-aus': 30,
    'wheat': 50, 'maize': 25, 'potato': 700, 'mustard': 6,
    'lentil': 25, 'jute': 7, 'tomato': 0.3, 'brinjal': 0.3, 'chili': 0.5,
    'mungbean': 10, 'sesame': 3, 'okra': 4, 'cucumber': 0.5,
    'onion': 4, 'groundnut': 45,
  };
  const seedUnit: Record<string, number> = {
    'rice-boro': c.seedRicePerKg, 'rice-aman': c.seedRicePerKg, 'rice-aus': c.seedRicePerKg,
    'wheat': c.seedWheatPerKg, 'maize': c.seedMaizePerKg, 'potato': c.seedPotatoPerKg,
    'mustard': c.seedMustardPerKg, 'lentil': c.seedLentilPerKg, 'jute': c.seedJutePerKg,
    'mungbean': c.seedMungbeanPerKg, 'sesame': c.seedSesamePerKg,
    'okra': c.seedOkraPerKg, 'cucumber': c.seedCucumberPerKg,
    'onion': c.seedOnionPerKg, 'groundnut': c.seedGroundnutPerKg,
    'tomato': c.seedTomatoPer10g * 100, 'brinjal': c.seedBrinjalPer10g * 100,
    'chili': c.seedChiliPer10g * 100,
  };
  cost += (seedKgPerAcre[crop.id] || 0) * (seedUnit[crop.id] || 0);

  // Labour — rough person-days per acre per crop
  const labourDays: Record<string, number> = {
    'rice-boro': 35, 'rice-aman': 30, 'rice-aus': 18,
    'wheat': 18, 'maize': 22, 'potato': 50, 'mustard': 14,
    'lentil': 12, 'jute': 45, 'tomato': 70, 'brinjal': 75, 'chili': 80,
    'mungbean': 14, 'sesame': 16, 'okra': 55, 'cucumber': 50,
    'onion': 60, 'groundnut': 28,
  };
  cost += (labourDays[crop.id] || 20) * c.labourPerDay;

  // Irrigation events
  const irrigEvents: Record<string, number> = {
    'rice-boro': 18, 'rice-aman': 4, 'rice-aus': 2,
    'wheat': 3, 'maize': 4, 'potato': 5, 'mustard': 2,
    'lentil': 1, 'jute': 2, 'tomato': 12, 'brinjal': 14, 'chili': 10,
    'mungbean': 1, 'sesame': 1, 'okra': 6, 'cucumber': 7,
    'onion': 6, 'groundnut': 4,
  };
  cost += (irrigEvents[crop.id] || 3) * c.irrigationPerApplication;

  // Land preparation diesel
  cost += 18 * c.dieselPerLitre; // ~18 L/acre for ploughing

  // Pesticide/pest management flat estimate
  const pestCost: Record<string, number> = {
    'rice-boro': 1500, 'rice-aman': 1000, 'rice-aus': 600,
    'wheat': 800, 'maize': 1200, 'potato': 3000, 'mustard': 600,
    'lentil': 800, 'jute': 1000, 'tomato': 4500, 'brinjal': 5000, 'chili': 5500,
    'mungbean': 900, 'sesame': 800, 'okra': 3000, 'cucumber': 3200,
    'onion': 3500, 'groundnut': 1200,
  };
  cost += pestCost[crop.id] || 1000;

  const assumption = getFinancialAssumption(crop);
  cost += assumption.harvestMarketingCostBdt;
  cost += cost * getContingencyRate(crop);

  return Math.round(cost);
}

function computePerAcreRevenue(crop: CropRecord): { revenueBdt: number; yieldMaund: number } {
  // Use conservative farmgate assumptions: not every acre reaches midpoint yield,
  // and harvest-time farmgate price is usually below retail/season-average price.
  const assumption = getFinancialAssumption(crop);
  const yieldMaund = ((crop.typicalYieldPerAcre.min + crop.typicalYieldPerAcre.max) / 2) * assumption.yieldFactor;
  const priceMid = ((crop.typicalPricePerUnit.min + crop.typicalPricePerUnit.max) / 2) * assumption.priceFactor;
  const revenueBdt = Math.round(yieldMaund * priceMid);
  return { revenueBdt, yieldMaund };
}

function applyWeatherScore(crop: CropRecord, weather: WeatherResult): { delta: number; rationale: string[] } {
  let delta = 0;
  const rationale: string[] = [];
  const totalRain7d = weather.summary.totalRain7dMm;
  const rainyDays = weather.summary.rainyDays;
  const avgHumidity = weather.summary.avgHumidityPercent;
  const avgTemp = weather.summary.avgTempC;

  if (crop.rainfallTolerance === 'low' && totalRain7d > 50) {
    delta -= 12;
    rationale.push(`Weather: ${totalRain7d.toFixed(0)} mm rain in the next 7 days raises waterlogging/disease risk for ${crop.name}.`);
  } else if (crop.rainfallTolerance === 'medium' && totalRain7d > 90) {
    delta -= 8;
    rationale.push(`Weather: ${totalRain7d.toFixed(0)} mm rain is a bit high for ${crop.name}; drainage will be important.`);
  } else if (crop.rainfallTolerance === 'high' && totalRain7d >= 25 && totalRain7d <= 120) {
    delta += 6;
    rationale.push(`Weather: ${totalRain7d.toFixed(0)} mm rain supports ${crop.name}, which handles wet conditions better than many crops.`);
  }

  if (rainyDays >= 5 && crop.riskLevel === 'high') {
    delta -= 8;
    rationale.push(`Weather: rain on ${rainyDays} of 7 days increases pest and fungal pressure for this higher-risk crop.`);
  }

  if (avgHumidity !== null && avgHumidity >= 85) {
    if (crop.riskLevel === 'high') {
      delta -= 8;
      rationale.push(`Weather: average humidity ${avgHumidity.toFixed(0)}% is disease-friendly, so ${crop.name}'s risk is adjusted down.`);
    } else if (crop.rainfallTolerance === 'low') {
      delta -= 4;
      rationale.push(`Weather: average humidity ${avgHumidity.toFixed(0)}% adds disease risk for low-rainfall-tolerance crops.`);
    }
  }

  if (avgTemp > 33 && ['wheat', 'potato', 'tomato'].includes(crop.id)) {
    delta -= 8;
    rationale.push(`Weather: average temperature ${avgTemp.toFixed(1)}°C is stressful for ${crop.name}.`);
  } else if (avgTemp >= 24 && avgTemp <= 32 && ['jute', 'maize', 'brinjal', 'okra', 'cucumber'].includes(crop.id)) {
    delta += 3;
    rationale.push(`Weather: average temperature ${avgTemp.toFixed(1)}°C is broadly suitable for warm-season ${crop.name}.`);
  }

  return { delta, rationale };
}

export async function recommendCrops(profile: FarmProfile, weather: WeatherResult | null): Promise<RecommendResult> {
  if (!Number.isFinite(profile.farmSizeDecimal) || (profile.farmSizeDecimal as number) <= 0) {
    throw new Error('farmSizeDecimal must be a positive number before recommending crops');
  }
  const season = (profile.targetSeason || 'rabi') as Season;
  const candidateEntries = buildSeasonCandidates(season);
  const hasBackfilledCandidates = candidateEntries.some(entry => entry.seasonFit !== 'exact');

  // Get the current month for sowing window fitness check
  const currentMonth = new Date().getMonth() + 1; // 1-indexed
  const seasonRecord = SEASONS.find(s => s.id === season);

  // Score each candidate
  const scored = candidateEntries.map(({ crop, seasonFit, backfillSeason }) => {
    let score = 50; // baseline
    const rationale: string[] = [];
    const kbEvidence: string[] = [];

    if (seasonFit === 'exact') {
      rationale.push(`${crop.name} is listed for the ${season} season in the crop knowledge base.`);
    } else if (seasonFit === 'nearby' && backfillSeason) {
      score -= 8;
      rationale.push(`${crop.name} is a nearby-season option from ${backfillSeason}; included because exact ${season} options are limited. Confirm local sowing timing before planting.`);
    } else {
      score -= 18;
      rationale.push(`${crop.name} is a fallback crop, not a direct ${season} match. Use only if local DAE/extension advice confirms the timing.`);
    }

    // 1. Soil suitability (+20 if soil is in suitable list, -20 if not)
    if (profile.soilType) {
      const soilRecord = SOILS.find(s => s.type === profile.soilType);
      if (crop.suitableSoils.includes(profile.soilType)) {
        score += 20;
        rationale.push(`Your soil is ${profile.soilType}, which ${crop.name} tolerates well.`);
        if (soilRecord) {
          kbEvidence.push(`${profile.soilType.charAt(0).toUpperCase() + profile.soilType.slice(1)} soil fertility=${soilRecord.fertility}, water retention=${soilRecord.waterRetention} (BARC Soil Guide).`);
        }
      } else {
        score -= 25;
        rationale.push(`Your ${profile.soilType} soil is suboptimal for ${crop.name} (prefers ${crop.suitableSoils.join('/')}).`);
      }
    }

    // 2. Water availability match (+15 / -15)
    if (profile.waterSource) {
      const prefSources = crop.waterSourcePreference;
      if (prefSources.includes(profile.waterSource)) {
        score += 15;
        rationale.push(`Your water source (${profile.waterSource}) is one of ${crop.name}'s preferred sources.`);
      } else if (profile.waterSource === 'rainfed' && crop.waterNeedMm > 700) {
        score -= 20;
        rationale.push(`${crop.name} needs ${crop.waterNeedMm} mm/season — too much for rainfed-only supply in your area.`);
      }

      /*
      // Weather check: heavy rain forecast for a low-rainfall-tolerance crop = bad
      const totalRain7d = weather.summary.totalRain7dMm;
      if (crop.rainfallTolerance === 'low' && totalRain7d > 50) {
        score -= 10;
        rationale.push(`Weather: ${totalRain7d.toFixed(0)} mm rain forecast in next 7 days. ${crop.name} has low rainfall tolerance — risk of disease/waterlogging.`);
      } else if (crop.rainfallTolerance === 'high' && totalRain7d > 30) {
        score += 5;
        rationale.push(`Weather: ${totalRain7d.toFixed(0)} mm rain forecast — favorable for ${crop.name} (high rainfall tolerance).`);
      }
      */
    }

    if (weather) {
      const weatherFit = applyWeatherScore(crop, weather);
      score += weatherFit.delta;
      rationale.push(...weatherFit.rationale);
    }

    // 3. Budget fit
    const farmSize = profile.farmSizeDecimal || 50;
    const perAcreCost = computePerAcreCost(crop);
    const totalCost = perAcreCost * (farmSize / 100);
    if (profile.budgetBdt) {
      if (totalCost > profile.budgetBdt * 1.1) {
        score -= 20;
        rationale.push(`Estimated total cost ৳${totalCost.toLocaleString()} exceeds your budget ৳${profile.budgetBdt.toLocaleString()}.`);
      } else if (totalCost < profile.budgetBdt * 0.7) {
        score += 5;
        rationale.push(`Estimated total cost ৳${totalCost.toLocaleString()} fits comfortably within your budget.`);
      } else {
        score += 10;
        rationale.push(`Estimated total cost ৳${totalCost.toLocaleString()} fits within your budget.`);
      }
    }

    // 4. Profitability bonus
    const { revenueBdt, yieldMaund } = computePerAcreRevenue(crop);
    const profit = revenueBdt - perAcreCost;
    const roi = (profit / perAcreCost) * 100;
    if (roi > 80) score += 15;
    else if (roi > 40) score += 8;
    else if (roi < 0) score -= 15;
    rationale.push(`Conservative expected ROI ${roi.toFixed(0)}% (farmgate revenue ৳${revenueBdt.toLocaleString()}/acre − realistic cost ৳${perAcreCost.toLocaleString()}/acre).`);
    kbEvidence.push(`${crop.name} typical yield ${crop.typicalYieldPerAcre.min}-${crop.typicalYieldPerAcre.max} ${crop.typicalYieldPerAcre.unit}/acre; price ৳${crop.typicalPricePerUnit.min}-${crop.typicalPricePerUnit.max}/${crop.typicalPricePerUnit.unit}. Source: ${crop.source}.`);

    // 5. Risk adjustment
    if (crop.riskLevel === 'low') score += 5;
    else if (crop.riskLevel === 'high') score -= 10;

    // ---------- NEW RULE-BASED SCORING FACTORS ----------

    // 6. Sowing window fitness (+15 if in optimal window, −20 if >30 days past)
    if (seasonRecord) {
      const windowMonths = parseSowingWindowMonths(seasonRecord.sowingWindow);
      if (windowMonths) {
        const [winStart, winEnd] = windowMonths;
        if (isMonthInRange(currentMonth, winStart, winEnd)) {
          score += 15;
          rationale.push(`Current month is within ${season} optimal sowing window (${seasonRecord.sowingWindow}) — excellent timing.`);
        } else {
          // How far off are we? Simple rule: if >2 months past end, harsh penalty
          const monthsPastEnd = winEnd < currentMonth ? currentMonth - winEnd : currentMonth + 12 - winEnd;
          if (monthsPastEnd <= 1) {
            score -= 5;
            rationale.push(`Slightly past the optimal ${season} sowing window (${seasonRecord.sowingWindow}). Minor yield impact expected.`);
          } else {
            score -= 20;
            rationale.push(`Significantly past the optimal ${season} sowing window (${seasonRecord.sowingWindow}). Late sowing typically reduces yield 10-25%.`);
            kbEvidence.push(`BARI research: late sowing past optimal window reduces wheat yield ~1.3%/day and rice yield ~0.5%/day. (BARI Annual Report 2023)`);
          }
        }
      }
    }

    // 7. Crop rotation penalty (−15 if same botanical family as previous crop)
    if (profile.previousCropId) {
      const prevFamily = CROP_FAMILY_MAP[profile.previousCropId];
      const currFamily = CROP_FAMILY_MAP[crop.id];
      if (prevFamily && currFamily && prevFamily === currFamily && crop.id !== profile.previousCropId) {
        score -= 10;
        rationale.push(`Same botanical family (${currFamily}) as previous crop — higher pest/disease carryover risk. Crop rotation with a different family is recommended.`);
      } else if (prevFamily && currFamily && crop.id === profile.previousCropId) {
        score -= 15;
        rationale.push(`Same crop as last season — depletes specific soil nutrients and increases pest/disease buildup. Rotate to a different crop family.`);
      } else if (prevFamily && currFamily && prevFamily !== currFamily) {
        score += 5;
        rationale.push(`Good crop rotation: ${currFamily} family follows ${prevFamily} — breaks pest/disease cycles.`);
      }
    }

    // 8. Market glut / oversupply risk (−10 if risk notes mention oversupply, price crash)
    if (/oversuppl|glut|price crash|price drop|volatile price|excess production/i.test(crop.riskNotes)) {
      score -= 10;
      rationale.push(`Market risk: ${crop.name} has noted oversupply/price volatility concerns — consider diversifying.`);
    }

    // ---------- END NEW FACTORS ----------

    // 9. RAG-grounded evidence: pull MULTIPLE relevant KB chunks for evidence
    // Query for variety + soil + crop-specific facts
    const ragQuery = `${crop.name} ${profile.soilType || ''} ${season} season cultivation variety fertilizer`;
    const ragResults = ragSearch(ragQuery, 3);
    for (const r of ragResults) {
      const sourceUrl = r.chunk.sourceUrl ? ` (${r.chunk.sourceUrl})` : '';
      kbEvidence.push(`[${r.chunk.id}] ${r.chunk.text}${sourceUrl}`);
    }

    score = Math.max(0, Math.min(100, score));

    const rec: CropRecommendation = {
      rank: 0,
      cropId: crop.id,
      cropName: crop.name,
      bnName: crop.bnName,
      suitabilityScore: Math.round(score),
      waterNeed: waterNeedLabel(crop.waterNeedMm),
      riskLevel: crop.riskLevel,
      estimatedYieldMaund: Math.round(yieldMaund),
      estimatedRevenueBdt: revenueBdt,
      estimatedCostBdt: perAcreCost,
      estimatedProfitBdt: profit,
      roiPercent: Math.round(roi),
      rationale,
      kbEvidence,
    };
    return rec;
  });

  // Sort by score desc, take top 3+, assign ranks
  scored.sort((a, b) => b.suitabilityScore - a.suitabilityScore);
  const positiveRecommendations = scored.filter(r => r.suitabilityScore > 0);
  const topSource = positiveRecommendations.length >= MIN_RECOMMENDATIONS ? positiveRecommendations : scored;
  const top = topSource.slice(0, Math.min(MAX_RECOMMENDATIONS, topSource.length));
  top.forEach((r, i) => (r.rank = i + 1));

  return {
    profile,
    weather,
    recommendations: top,
    notes: `Ranked ${top.length} candidate crops for ${season} season using soil=${profile.soilType || '?'}, water=${profile.waterSource || '?'}, budget=৳${profile.budgetBdt?.toLocaleString() || '?'}, farm size=${profile.farmSizeDecimal || '?'} decimal. Scores combine soil fit, water match, budget fit, ROI, risk, sowing window, rotation, and market risk.${hasBackfilledCandidates ? ' Exact season matches were limited, so nearby-season crops were included with a season-fit penalty to keep at least 3 practical options.' : ''}`,
  };
}
