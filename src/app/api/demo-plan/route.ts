// Demo endpoint that runs the agent tools directly without needing the LLM.
// Use this to verify the UI visualizations work end-to-end.
//
// GET /api/demo-plan?location=Jashore&farmSize=50&soil=loamy&water=tubewell&budget=25000&season=rabi
//
// Returns the same shape as /api/chat but with a pre-built trace:
//   { sessionId, answer, trace: [...], iterations: 4 }

import { NextRequest, NextResponse } from 'next/server';
import { getWeather } from '@/lib/agent/tools/weather';
import { recommendCrops, type FarmProfile } from '@/lib/agent/tools/recommend';
import { computeFinancials } from '@/lib/agent/tools/financials';
import { getCropCalendar } from '@/lib/agent/tools/calendar';
import {
  getFertilizerSchedule,
  getIrrigationSchedule,
  assessPestDiseaseRisk,
  checkWeatherTriggers,
  simulateScenario,
} from '@/lib/agent/tools/tier1_tools';
import { ragSearch, formatRetrievedContext } from '@/lib/kb/rag';
import { CROPS } from '@/lib/kb/crops';
import type { ToolName } from '@/lib/agent/tools/registry';

export const runtime = 'nodejs';
export const maxDuration = 30;

function makeTraceEntry(iteration: number, toolName: ToolName, toolArgs: any, toolResult: any, durationMs: number) {
  return {
    iteration,
    toolName,
    toolArgs,
    toolResult,
    durationMs,
    timestamp: new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const location = sp.get('location') || 'Jashore';
  const farmSize = Number(sp.get('farmSize') || '50');
  const soil = sp.get('soil') || 'loamy';
  const water = sp.get('water') || 'tubewell';
  const budget = Number(sp.get('budget') || '25000');
  const season = sp.get('season') || 'rabi';

  const profile: FarmProfile = {
    location,
    farmSizeDecimal: farmSize,
    soilType: soil,
    waterSource: water,
    budgetBdt: budget,
    targetSeason: season,
  };

  const trace: any[] = [];
  let iter = 0;

  // 1. Weather
  iter++;
  const wStart = Date.now();
  let weather: any = null;
  try {
    weather = await getWeather(location);
  } catch (e: any) {
    weather = { error: e.message };
  }
  trace.push(makeTraceEntry(iter, 'get_weather', { location }, weather, Date.now() - wStart));

  // 2. RAG search
  iter++;
  const rStart = Date.now();
  const ragQuery = `${season} season cultivation ${soil} soil crop variety fertilizer`;
  const ragResults = ragSearch(ragQuery, 8);
  const ragResult = {
    query: ragQuery,
    numResults: ragResults.length,
    formattedContext: formatRetrievedContext(ragResults),
    rawChunks: ragResults.map(r => ({
      id: r.chunk.id,
      score: Number(r.score.toFixed(3)),
      source: r.chunk.source,
      sourceUrl: r.chunk.sourceUrl,
      crop: r.chunk.cropName,
      category: r.chunk.category,
      factName: r.chunk.factName,
      value: r.chunk.value,
      unit: r.chunk.unit,
      text: r.chunk.text,
    })),
  };
  trace.push(makeTraceEntry(iter, 'rag_search', { query: ragQuery }, ragResult, Date.now() - rStart));

  // 3. Recommend crops
  iter++;
  const recStart = Date.now();
  let recs: any = null;
  try {
    recs = await recommendCrops(profile, weather);
  } catch (e: any) {
    recs = { error: e.message };
  }
  trace.push(makeTraceEntry(iter, 'recommend_crops', { profile: JSON.stringify(profile), weather: weather ? JSON.stringify(weather) : undefined }, recs, Date.now() - recStart));

  // 4. Pick top crop → calendar + financials
  const topCrop = recs?.recommendations?.[0];
  let chosenCropId: string | undefined;
  // Find cropId in CROPS by name match
  if (topCrop) {
    const cropRecord = CROPS.find(c => c.name === topCrop.cropName);
    chosenCropId = cropRecord?.id;
  }
  if (!chosenCropId) chosenCropId = 'wheat'; // fallback

  // Compute a sensible sowing date based on season
  const seasonMonthDay: Record<string, string> = {
    rabi: '11-15', boro: '01-15', aman: '07-15', aus: '04-15',
    'kharif-1': '03-15', 'kharif-2': '07-15',
  };
  const today = new Date();
  let sowingYear = today.getUTCFullYear();
  const monthDay = seasonMonthDay[season] || '05-15';
  let sowingDate = `${sowingYear}-${monthDay}`;
  if (sowingDate < today.toISOString().slice(0, 10)) sowingDate = `${++sowingYear}-${monthDay}`;

  // 5. Calendar
  iter++;
  const calStart = Date.now();
  let calendar: any = null;
  try {
    const weatherForecast = weather?.forecast;
    calendar = getCropCalendar(chosenCropId, sowingDate, weatherForecast);
  } catch (e: any) {
    calendar = { error: e.message };
  }
  trace.push(makeTraceEntry(iter, 'get_crop_calendar', { cropId: chosenCropId, sowingDate, weatherForecast: weather?.forecast ? '(from get_weather)' : undefined }, calendar, Date.now() - calStart));

  // 6. Financials
  iter++;
  const finStart = Date.now();
  let financials: any = null;
  try {
    financials = computeFinancials(chosenCropId, farmSize, sowingDate);
  } catch (e: any) {
    financials = { error: e.message };
  }
  trace.push(makeTraceEntry(iter, 'compute_financials', { cropId: chosenCropId, farmSizeDecimal: farmSize, sowingDate }, financials, Date.now() - finStart));

  const chosenCropRecord = CROPS.find(c => c.id === chosenCropId);
  const chosenCropName = chosenCropRecord?.name || topCrop?.cropName || chosenCropId;

  // 7. Verified fertilizer and irrigation schedules
  iter++;
  const fertilizerStart = Date.now();
  const fertilizer = getFertilizerSchedule(chosenCropName, soil, farmSize);
  trace.push(makeTraceEntry(iter, 'get_fertilizer_schedule', { crop: chosenCropName, soilType: soil, farmSizeDecimal: farmSize }, fertilizer, Date.now() - fertilizerStart));

  iter++;
  const irrigationStart = Date.now();
  const irrigation = getIrrigationSchedule(chosenCropName, soil, farmSize);
  trace.push(makeTraceEntry(iter, 'get_irrigation_schedule', { crop: chosenCropName, soilType: soil, farmSizeDecimal: farmSize }, irrigation, Date.now() - irrigationStart));

  // 8. Weather-grounded risk and proactive rule evaluation
  const growthStage = chosenCropRecord?.growthStages?.[0]?.name || 'Sowing';
  iter++;
  const riskStart = Date.now();
  const risk = assessPestDiseaseRisk(
    chosenCropName,
    growthStage,
    weather?.summary?.avgTempC,
    weather?.summary?.avgHumidityPercent ?? undefined,
    weather?.summary?.totalRain7dMm,
    farmSize,
  );
  trace.push(makeTraceEntry(iter, 'assess_pest_disease_risk', {
    crop: chosenCropName,
    growthStage,
    temperatureC: weather?.summary?.avgTempC,
    humidityPercent: weather?.summary?.avgHumidityPercent,
    rainfallMm: weather?.summary?.totalRain7dMm,
    farmSizeDecimal: farmSize,
  }, risk, Date.now() - riskStart));

  iter++;
  const triggerStart = Date.now();
  const triggers = checkWeatherTriggers(chosenCropName, growthStage, weather?.forecast);
  trace.push(makeTraceEntry(iter, 'check_weather_triggers', { crop: chosenCropName, growthStage, weatherForecast: '(from get_weather)' }, triggers, Date.now() - triggerStart));

  // 9. A deterministic scenario demonstrates changed, inspectable numbers.
  iter++;
  const scenarioStart = Date.now();
  const scenario = simulateScenario({ cropId: chosenCropId, farmSizeDecimal: farmSize, scenarioType: 'budget_cut_percent', changeValue: 30, sowingDate });
  trace.push(makeTraceEntry(iter, 'simulate_scenario', { cropId: chosenCropId, farmSizeDecimal: farmSize, scenarioType: 'budget_cut_percent', changeValue: 30, sowingDate }, scenario, Date.now() - scenarioStart));

  // Build a summary answer
  const answer = `## Demo Plan (no LLM — tools only)

**Profile**: ${farmSize} decimal in ${location}, ${soil} soil, ${water} water, ${season} season, ৳${budget.toLocaleString()} budget.

**Weather**: ${weather?.location ? `${weather.location} — ${weather.summary.totalRain7dMm.toFixed(0)}mm rain in 7 days, avg ${weather.summary.avgTempC.toFixed(1)}°C` : 'unavailable'}.

**Top recommended crop**: ${topCrop?.cropName || chosenCropRecord?.name} (suitability ${topCrop?.suitabilityScore || '?'}/100, ROI ${topCrop?.roiPercent || '?'}%).

**Calendar**: ${calendar?.totalDays || '?'} days from ${calendar?.sowingDate} to ${calendar?.harvestDate}. ${calendar?.weatherAdvisories?.length || 0} weather advisories.

**Financials**: Total cost ৳${financials?.totals?.totalCost?.toLocaleString() || '?'}, revenue ৳${financials?.totals?.totalRevenue?.toLocaleString() || '?'}, profit ৳${financials?.totals?.totalProfit?.toLocaleString() || '?'}, ROI ${financials?.perAcre?.roiPercent || '?'}%.

**Tier 1 checks**: ${fertilizer?.fertilizerSchedule?.length || 0} verified fertilizer quantities, ${irrigation?.irrigationRecords?.length || 0} irrigation records, ${risk?.alerts?.length || 0} pest/disease risks assessed, and ${triggers?.triggeredRulesCount || 0} proactive weather rules triggered. A 30% budget cut leaves a ৳${scenario.simulated.fundingShortfallBdt.toLocaleString()} funding shortfall without silently reducing agronomic inputs.

See the Crops / Calendar / Financials tabs on the right for full visualizations. Each tool call is in the Trace tab.`;

  return NextResponse.json({
    sessionId: `demo-${Date.now()}`,
    answer,
    trace,
    iterations: iter,
  });
}
