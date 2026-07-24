// Tool registry: single source of truth for the agent's available tools.
// Each tool has: name, description (for LLM prompt), param schema, executor.

import { getWeather, type WeatherResult } from './weather';
import { recommendCrops, type FarmProfile, type RecommendResult } from './recommend';
import { computeFinancials, type FinancialResult } from './financials';
import { getCropCalendar, type CropCalendarResult } from './calendar';
import { ragSearch, formatRetrievedContext, KB_STATS, type RetrievalResult } from '@/lib/kb/rag';
import { VERIFIED_FACTS } from '@/lib/kb/verified_facts';

export type ToolName =
  | 'get_weather'
  | 'rag_search'
  | 'get_kb_facts_by_crop'
  | 'recommend_crops'
  | 'compute_financials'
  | 'get_crop_calendar'
  | 'save_profile';

export interface ToolDefinition {
  name: ToolName;
  description: string;
  paramSchema: { name: string; type: 'string' | 'number'; required: boolean; description: string }[];
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_weather',
    description: 'Fetch real 7-day weather forecast (temperature, rainfall, wind) for a Bangladesh location using Open-Meteo. Use this whenever the farmer mentions a location and we need to ground recommendations in actual weather. Returns lat/long, daily forecast, and a summary (total rain, avg temp, next rain event).',
    paramSchema: [
      { name: 'location', type: 'string', required: true, description: 'District or upazila name, e.g. "Jashore", "Bogura", "Mymensingh"' },
    ],
  },
  {
    name: 'rag_search',
    description: `Search the local Bangladesh agriculture knowledge base (${KB_STATS.verifiedChunks} verified facts from BARI/BWMRI/BRRI/FAO + structured crop calendars) for crop/soil/fertilizer/pest/season/irrigation information. Use this AGGRESSIVELY — call it multiple times per plan with different query angles (e.g. once for fertilizer, once for pests, once for variety recommendations). Returns ranked text chunks with source citations including URLs. Every agronomic claim in your final answer MUST trace back to a rag_search result.`,
    paramSchema: [
      { name: 'query', type: 'string', required: true, description: 'Natural-language query. Be specific: include crop name + topic. Examples: "T. Aman rice fertilizer schedule", "wheat variety BARI Gom-28 yield", "potato late blight disease management", "mustard irrigation schedule loamy soil", "maize stem borer pest scouting"' },
    ],
  },
  {
    name: 'get_kb_facts_by_crop',
    description: `Retrieve ALL verified facts for a specific crop from the knowledge base (${KB_STATS.verifiedChunks} facts total). Use this when you need comprehensive coverage of one crop — varieties, fertilizer, calendar, irrigation, pests, diseases, yield. Returns up to 50 facts with full source citations. Use rag_search for targeted topical queries; use this tool when you want exhaustive coverage of one crop.`,
    paramSchema: [
      { name: 'crop', type: 'string', required: true, description: 'Crop name as it appears in the KB. Examples: "Tomato", "T. Aman Rice", "Potato", "Maize", "Wheat", "BARI Gom-28", "Bt Brinjal", "Onion", "Mustard", "Mungbean". Use exact casing from the crop list in your system prompt.' },
      { name: 'category', type: 'string', required: false, description: 'Optional category filter. Examples: "Fertilizer", "Variety trait", "Crop calendar", "Irrigation", "Pest management", "Disease management", "Yield", "Soil". Omit to return all categories.' },
    ],
  },
  {
    name: 'recommend_crops',
    description: 'Rank at least 3 candidate crops for the current farm profile + season + retrieved weather. Returns each crop with suitability score, water need, risk level, profit estimate, and rationale citing soil/weather/KB evidence. Call AFTER get_weather and at least one rag_search.',
    paramSchema: [
      { name: 'profile', type: 'string', required: true, description: 'JSON object: {location, farmSizeDecimal, soilType, waterSource, budgetBdt, targetSeason}' },
      { name: 'weather', type: 'string', required: false, description: 'JSON of the weather result (omit if not yet fetched)' },
    ],
  },
  {
    name: 'compute_financials',
    description: 'Compute itemized per-acre cost breakdown (fertilizer, seed, labour, irrigation, land prep, pest mgmt), revenue, net profit, ROI, and break-even price/yield for a chosen crop and farm size. Math is inspectable and internally consistent.',
    paramSchema: [
      { name: 'cropId', type: 'string', required: true, description: 'Crop ID, e.g. "rice-boro", "wheat", "potato", "mustard"' },
      { name: 'farmSizeDecimal', type: 'number', required: true, description: 'Farm size in decimal (1 acre = 100 decimal)' },
      { name: 'sowingDate', type: 'string', required: false, description: 'ISO date string e.g. "2025-11-20"' },
    ],
  },
  {
    name: 'get_crop_calendar',
    description: 'Produce a dated season calendar (land preparation → harvest) for a chosen crop, anchored on the farmer\'s sowing date. Includes weather-aware advisories for fertilizer timing, irrigation, etc. Returns dated events and proactive weather alerts.',
    paramSchema: [
      { name: 'cropId', type: 'string', required: true, description: 'Crop ID, e.g. "rice-aman"' },
      { name: 'sowingDate', type: 'string', required: true, description: 'ISO date string' },
      { name: 'weatherForecast', type: 'string', required: false, description: 'JSON array of forecast days from get_weather (omit if unavailable)' },
    ],
  },
  {
    name: 'save_profile',
    description: 'Save or update farmer profile fields (location, soilType, waterSource, budgetBdt, targetSeason, farmSizeDecimal, chosenCrop, sowingDate). Use this whenever the farmer provides new profile information so it persists across turns.',
    paramSchema: [
      { name: 'updates', type: 'string', required: true, description: 'JSON object with any subset of the profile fields to update' },
    ],
  },
];

// Execute a tool by name. Returns the raw result (will be JSON-serialized for the trace + LLM context).
export async function executeTool(name: ToolName, args: Record<string, any>): Promise<{
  result: any;
  durationMs: number;
}> {
  const start = Date.now();
  let result: any;

  try {
    switch (name) {
      case 'get_weather': {
        result = await getWeather(args.location);
        break;
      }
      case 'rag_search': {
        const results: RetrievalResult[] = ragSearch(args.query, 8);
        result = {
          query: args.query,
          numResults: results.length,
          formattedContext: formatRetrievedContext(results),
          rawChunks: results.map(r => ({
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
        break;
      }
      case 'get_kb_facts_by_crop': {
        const cropQuery = String(args.crop || '').toLowerCase().trim();
        const categoryQuery = args.category ? String(args.category).toLowerCase().trim() : null;

        // Match crops that contain the query (case-insensitive)
        let matching = VERIFIED_FACTS.filter(f =>
          f.crop.toLowerCase().includes(cropQuery) || cropQuery.includes(f.crop.toLowerCase())
        );

        if (categoryQuery) {
          matching = matching.filter(f =>
            f.category.toLowerCase().includes(categoryQuery)
          );
        }

        // Cap at 50 facts to keep token budget reasonable
        const capped = matching.slice(0, 50);

        result = {
          crop: args.crop,
          category: args.category || null,
          totalMatches: matching.length,
          returned: capped.length,
          facts: capped.map(f => ({
            id: f.id,
            crop: f.crop,
            category: f.category,
            factName: f.factName,
            value: f.value,
            unit: f.unit,
            context: f.context,
            source: f.sourceInstitution,
            sourceTitle: f.sourceTitle,
            sourceUrl: f.sourceUrl,
          })),
        };
        break;
      }
      case 'recommend_crops': {
        const profile: FarmProfile = typeof args.profile === 'string' ? JSON.parse(args.profile) : args.profile;
        const weather = args.weather ? (typeof args.weather === 'string' ? JSON.parse(args.weather) : args.weather) as WeatherResult : null;
        result = await recommendCrops(profile, weather);
        break;
      }
      case 'compute_financials': {
        result = computeFinancials(args.cropId, Number(args.farmSizeDecimal), args.sowingDate);
        break;
      }
      case 'get_crop_calendar': {
        const cropId: string = args.cropId;
        const sowingDate: string = args.sowingDate;
        const weatherForecast = args.weatherForecast
          ? (typeof args.weatherForecast === 'string' ? JSON.parse(args.weatherForecast) : args.weatherForecast)
          : undefined;
        result = getCropCalendar(cropId, sowingDate, weatherForecast);
        break;
      }
      case 'save_profile': {
        const updates = typeof args.updates === 'string' ? JSON.parse(args.updates) : args.updates;
        result = { saved: true, fields: Object.keys(updates), updates };
        break;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    result = { error: err.message, stack: err.stack };
  }

  const durationMs = Date.now() - start;
  return { result, durationMs };
}

// Pretty-print tool list for the system prompt
export function formatToolListForPrompt(): string {
  return TOOL_DEFINITIONS.map(t => {
    const params = t.paramSchema.map(p => `${p.name}${p.required ? '*' : ''}: ${p.type} — ${p.description}`).join('\n    ');
    return `### ${t.name}\n  ${t.description}\n  Parameters:\n    ${params}`;
  }).join('\n\n');
}
