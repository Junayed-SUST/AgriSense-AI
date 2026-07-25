# AgriSense AI Technical Documentation

This document explains how the AgriSense AI project works internally: the app architecture, agent loop, tools, RAG knowledge system, calculations, weather-aware crop recommendation, financial model, memory, disease detection, and UI data flow.

The goal of the system is to help Bangladeshi smallholder farmers make crop-planning decisions using:

- Farmer profile memory
- Weather forecast
- Local crop knowledge
- Verified agriculture facts
- Rule-based crop scoring
- Conservative financial estimates
- GPT-based conversational reasoning
- GPT vision-based leaf triage

## 1. High-Level Architecture

AgriSense AI is a Next.js application with a React frontend, API routes, a local SQLite database through Prisma, a deterministic tool layer, and OpenAI model calls for conversation and disease-image triage.

Main layers:

| Layer | Main files | Responsibility |
|---|---|---|
| Frontend | `src/app/page.tsx`, `src/components/PlantDiseaseDetector.tsx`, `src/components/ScenarioSimulator.tsx` | Chat UI, profile panel, crop cards, calendar, financial views, disease upload UI |
| API routes | `src/app/api/chat/route.ts`, `src/app/api/disease-detection/route.ts`, `src/app/api/profile/route.ts`, `src/app/api/trace/route.ts`, `src/app/api/demo-plan/route.ts` | HTTP endpoints used by the frontend |
| Agent loop | `src/lib/agent/loop.ts` | ReAct-style GPT tool-calling loop, prompt, memory loading, final answer generation |
| Tool registry | `src/lib/agent/tools/registry.ts` | Defines all callable tools and maps tool names to executors |
| Tool implementations | `src/lib/agent/tools/*.ts` | Weather, recommendation, finance, calendar, fertilizer, irrigation, disease risk, scenario, supplier, market tools |
| Knowledge base | `src/lib/kb/*.ts`, `data/AgriSense_Verified_1000.csv`, root JSON data packs | Crop catalog, soil/season records, verified facts, Tier 1/Tier 2 data |
| Persistence | `prisma/schema.prisma`, `src/lib/db.ts`, `src/lib/db/memory.ts` | Farmer profile, chat history, trace logs, active season plan, scenario runs |

Basic request path:

```text
User message
  -> React UI
  -> POST /api/chat
  -> runAgent()
  -> GPT decides tool calls
  -> executeTool()
  -> tool result saved to TraceEntry
  -> result returned to GPT as tool context
  -> GPT final answer
  -> answer saved to Conversation
  -> frontend renders answer + trace-derived panels
```

## 2. Frontend

### Main UI

File: `src/app/page.tsx`

The homepage is a client component. It manages:

- Session ID
- Chat messages
- Current farmer profile
- Active language (`en` or `bn`)
- Loading state
- Right-side visualization tabs
- Trace aggregation

Important frontend state:

```ts
const [sessionId, setSessionId] = useState<string>('');
const [messages, setMessages] = useState<ChatMessage[]>([]);
const [input, setInput] = useState('');
const [loading, setLoading] = useState(false);
const [profile, setProfile] = useState<FarmerProfile | null>(null);
const [language, setLanguage] = useState<AppLanguage>('en');
```

### Sending a chat message

The `sendMessage` function sends the user message to `/api/chat`:

```ts
fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId, message: text, language }),
});
```

The response contains:

- `answer`: final assistant text
- `trace`: all tool calls from that turn
- `iterations`: agent-loop iteration count

The frontend stores the returned trace on the assistant message. This makes the app able to show both natural chat and structured panels.

### Trace-derived UI panels

The frontend scans all traces and extracts the latest structured results:

- `recommend_crops` -> crop recommendation cards
- `get_crop_calendar` -> calendar panel
- `compute_financials` -> financial panel
- `compare_suppliers` -> supplier panel
- `get_market_price_intelligence` -> market panel

This means the chat answer is not the only output. Tool results also drive visual UI components.

### Markdown rendering and source links

Assistant answers are rendered with `ReactMarkdown`. Custom markdown components style:

- Links as highlighted external source links
- Tables with horizontal scrolling
- Table cells with cleaner spacing

This is defined in `MARKDOWN_COMPONENTS` inside `src/app/page.tsx`.

## 3. API Routes

### `/api/chat`

File: `src/app/api/chat/route.ts`

Responsibilities:

1. Validate request body.
2. Generate session ID if missing.
3. Enforce supported language: `en` or `bn`.
4. Block sensitive off-topic messages before invoking the agent.
5. Call `runAgent(sessionId, message, language)`.
6. Return final answer and trace.

Off-topic guard:

```ts
const SENSITIVE_OFF_TOPIC_PATTERNS = [
  /\bpenis\b/i,
  /\bsexual?\b/i,
  /\bsex\b/i,
  ...
];
```

If blocked, it saves the user message and a safe agriculture-only response, then returns without calling GPT tools.

### `/api/disease-detection`

File: `src/app/api/disease-detection/route.ts`

Responsibilities:

1. Accept leaf image upload.
2. Validate MIME type and file size.
3. Validate image format/dimensions with `sharp`.
4. Normalize image to JPEG, max 1280x1280.
5. Send image to GPT vision model.
6. Force JSON response.
7. Sanitize and format result into farmer-friendly markdown.
8. Save the analysis to conversation history.

Important design choice:

The current disease detector does not use PlantVillage or a closed disease dataset. It performs GPT vision-assisted triage from visible symptoms only. It is intentionally framed as "visual triage", not a confirmed lab diagnosis.

## 4. Database and Memory

### Prisma client

File: `src/lib/db.ts`

The Prisma client is instantiated once and reused globally during development:

```ts
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({ log: ['error', 'warn'] });
```

### Schema

File: `prisma/schema.prisma`

Core models:

| Model | Purpose |
|---|---|
| `Farmer` | Persistent farmer profile |
| `Conversation` | User/assistant chat history |
| `TraceEntry` | Every tool call with args/result/duration |
| `SeasonPlan` | Active crop plan memory |
| `FarmOperation` | Planned operations such as fertilizer/irrigation |
| `WeatherCheck` | Weather-check metadata |
| `Alert` | Proactive warnings |
| `ScenarioRun` | Stored what-if simulation results |

### Farmer profile fields

The agent collects these before recommending crops:

| Field | Meaning |
|---|---|
| `location` | District/upazila/village |
| `farmSizeDecimal` | Land size in decimal; 100 decimal = 1 acre |
| `soilType` | `sandy`, `loamy`, `clay`, `saline`, `silty` |
| `waterSource` | `tubewell`, `canal`, `rainfed`, `river`, `pond` |
| `budgetBdt` | Farmer budget in BDT |
| `targetSeason` | `aus`, `aman`, `boro`, `rabi`, `kharif-1`, `kharif-2` |
| `chosenCrop` | Crop selected for planning |
| `sowingDate` | ISO date used for calendar generation |

### Memory helper

File: `src/lib/db/memory.ts`

Important functions:

- `createOrUpdateSeasonPlan()`
- `recordFarmOperation()`
- `createAlert()`
- `recordScenarioRun()`
- `getFarmerMemory()`

The agent updates season-plan memory when calendar and financial tools run, so later turns can continue from the same plan.

## 5. Agent Loop

File: `src/lib/agent/loop.ts`

The agent uses a ReAct-style OpenAI tool-calling loop.

### What the system prompt contains

`buildSystemPrompt()` builds the system prompt. It includes:

- Language instruction
- Agriculture-only domain boundary
- Required behavior rules
- Farmer profile memory
- Active season plan memory
- Structured crop catalog
- Supported seasons and soils
- Required intake fields
- Farmer-friendly response style
- Tool-use workflow
- Final-answer formatting rules
- Rule to hide internal tool names/fact IDs from user-facing answers

### Loop flow

The loop starts with:

```ts
messages = [
  { role: 'system', content: buildSystemPrompt(...) },
  ...recentConversation,
  { role: 'user', content: userMessage },
]
```

Then it repeats:

1. Send `messages` and tool schemas to OpenAI.
2. If GPT returns tool calls:
   - Execute each tool.
   - Save trace entry to database.
   - Append tool result back into `messages`.
3. If GPT returns normal content:
   - Treat it as final answer.
   - Sanitize user-facing internal labels.
   - Save answer to conversation.

Maximum loop iterations:

```ts
const MAX_ITERATIONS = 10;
```

### Why the trace matters

Every tool call is saved:

```ts
await db.traceEntry.create({
  data: {
    farmerId: farmer.id,
    toolName,
    toolArgs: JSON.stringify(parsedArgs),
    toolResult: JSON.stringify(result).slice(0, 50000),
    durationMs,
  },
});
```

This gives:

- Debugging visibility
- Judge/verifier transparency
- Data for frontend panels
- Accountability for weather, price, finance, and recommendation claims

## 6. Tool Registry

File: `src/lib/agent/tools/registry.ts`

The registry is the single source of truth for available agent tools.

Each tool has:

- `name`
- `description`
- `paramSchema`
- executor switch-case inside `executeTool()`

Main tools:

| Tool | File | Purpose |
|---|---|---|
| `get_weather` | `weather.ts` | Fetch 7-day weather forecast |
| `rag_search` | `rag.ts` | Retrieve relevant KB chunks |
| `get_kb_facts_by_crop` | `registry.ts` + `verified_facts.ts` | Retrieve verified facts by crop/category |
| `recommend_crops` | `recommend.ts` | Rank crop candidates |
| `compute_financials` | `financials.ts` | Cost/revenue/profit/ROI |
| `get_crop_calendar` | `calendar.ts` | Dated crop plan |
| `save_profile` | `registry.ts` + `loop.ts` | Persist profile fields |
| `get_fertilizer_schedule` | `tier1_tools.ts` | Verified fertilizer schedule |
| `get_irrigation_schedule` | `tier1_tools.ts` | Verified irrigation schedule |
| `assess_pest_disease_risk` | `tier1_tools.ts` | Weather-aware pest/disease scouting risk |
| `check_weather_triggers` | `tier1_tools.ts` | Weather-triggered advisories |
| `simulate_scenario` | `tier1_tools.ts` | What-if financial simulations |
| `compare_suppliers` | `tier2_tools.ts` | Mock supplier comparison |
| `get_market_price_intelligence` | `tier2_tools.ts` | DAM market-price intelligence |

## 7. Knowledge Base

The knowledge system has two main sources.

### Structured crop catalog

File: `src/lib/kb/crops.ts`

This contains:

- Crop records
- Soil records
- Season records
- Input-cost references
- Conversion constants

Each `CropRecord` includes:

```ts
id
name
bnName
scientificName
seasons
durationDays
growthStages
waterNeedMm
waterSourcePreference
suitableSoils
rainfallTolerance
fertilizerKgPerAcre
typicalYieldPerAcre
typicalPricePerUnit
majorPests
majorDiseases
riskLevel
riskNotes
notes
source
```

This catalog is used by:

- Recommendation scoring
- Financial calculation
- Crop calendar
- RAG structured corpus
- UI crop cards

### Verified facts

File: `src/lib/kb/verified_facts.ts`

Generated from:

- `data/AgriSense_Verified_1000.csv`
- `scripts/build_verified_facts.py`

The generated facts include source metadata:

- Crop
- Category
- Fact name
- Value
- Unit
- Context
- Source institution
- Source title
- Source URL
- Searchable text

The code treats these as verified local facts from BARI, BWMRI, BRRI, FAO, and related agricultural sources.

## 8. RAG System

File: `src/lib/kb/rag.ts`

Important: the current RAG implementation is TF-IDF based, not embedding-vector based.

It builds two corpora:

1. Structured corpus from `CROPS`, `SOILS`, and `SEASONS`
2. Verified corpus from `VERIFIED_FACTS`

### Corpus building

For each crop, the structured corpus creates chunks like:

- Overview
- Fertilizer
- Calendar
- Pest management
- Irrigation/water

For each soil, it creates a soil chunk.

For each season, it creates a season classification chunk.

For verified facts, it maps each fact into a searchable `KbChunk` with preserved source URL.

### Tokenization

The retriever:

- Lowercases text
- Preserves Bengali Unicode
- Removes punctuation
- Splits into tokens
- Applies light stemming to Latin tokens

Examples:

- `irrigation` -> `irrigate`
- `fertilizer` -> `fertilize`
- `sandy` -> `sand`
- `loamy` -> `loam`
- Bengali words are preserved as-is

### Synonym expansion

`CROP_SYNONYMS` improves recall:

```ts
'maize': ['corn', 'ভুট্টা']
'brinjal': ['eggplant', 'begun', 'বেগুন', 'bt brinjal']
'rice': ['paddy', 'dhan', 'ধান']
```

When a query contains a crop or synonym, related tokens are added before scoring.

### TF-IDF scoring

The retriever computes:

```text
term frequency * inverse document frequency
```

Then normalizes vectors and uses cosine similarity:

```text
score = cosine(queryVector, documentVector)
```

### Category boosting

If a query includes words like fertilizer, irrigation, pest, disease, soil, season, sowing, harvest, etc., chunks from matching categories are boosted.

Example:

```ts
'fertilize': ['Fertilizer']
'irrigate': ['Irrigation']
'pest': ['Pest management']
'soil': ['Soil']
```

### Source diversity

The retriever caps results per source:

```ts
const MAX_PER_SOURCE = 3;
```

This prevents one BARI page or one source from dominating all top results.

### RAG output

`ragSearch(query, topK)` returns:

```ts
{
  chunk: KbChunk,
  score: number
}
```

`formatRetrievedContext()` turns results into text for GPT:

```text
[1] (score=0.123, source=BARI ... URL)
chunk text
```

### How the agent uses RAG

The agent is instructed to call RAG before final recommendations. Retrieved facts are sent back to GPT as tool results, so final claims can be grounded in local data instead of only model memory.

Example workflow:

```text
User gives farm info
  -> save_profile
  -> get_weather
  -> rag_search("kharif-1 clay soil jute variety")
  -> recommend_crops
  -> get_kb_facts_by_crop("Jute")
  -> get_fertilizer_schedule
  -> compute_financials
  -> final answer with sources
```

## 9. Weather System

File: `src/lib/agent/tools/weather.ts`

The weather tool uses Open-Meteo:

- Geocoding API to convert location to lat/lon
- Forecast API for 7-day weather

It retrieves:

- Daily max temperature
- Daily min temperature
- Daily precipitation
- Precipitation probability
- Max wind speed
- FAO ET0 evapotranspiration
- Hourly humidity, aggregated into daily mean humidity

### Location normalization

Bangladesh aliases are handled:

```ts
'bogura' -> 'Bogra'
'jashore' -> 'Jessore'
'chattogram' -> 'Chittagong'
```

### Weather summary

The tool returns:

```ts
summary: {
  totalRain7dMm,
  avgTempC,
  avgHumidityPercent,
  totalEt0Mm,
  rainyDays,
  nextRainEvent
}
```

### Agronomic alerts

The tool generates rule-based alerts:

| Alert | Trigger |
|---|---|
| Heat stress | 2+ consecutive days above 35 C |
| Cold snap | Any day below 10 C |
| Flood/waterlogging | More than 150 mm total rain or a day above 80 mm |
| Storm risk | Wind above 50 km/h |
| Drought signal | 5+ dry days and high ET0 |
| High humidity | 3+ days above 85% humidity |

These alerts are used by the agent and calendar to explain risks.

## 10. Crop Recommendation Engine

File: `src/lib/agent/tools/recommend.ts`

The recommendation engine ranks crop candidates from the farmer profile and weather.

### Required profile

The tool requires a valid positive `farmSizeDecimal`. It expects:

- Season
- Soil type
- Water source
- Budget
- Weather result

### Candidate selection

The system first selects crops for the requested season:

```ts
getCropsForSeason(season)
```

To avoid returning only one crop for sparse seasons, it backfills nearby seasons:

```ts
const SEASON_BACKFILL_ORDER = {
  aus: ['kharif-1', 'aman', 'rabi'],
  aman: ['kharif-2', 'aus', 'rabi'],
  boro: ['rabi', 'aus', 'kharif-1'],
  rabi: ['boro', 'kharif-1', 'kharif-2'],
  'kharif-1': ['aus', 'rabi', 'kharif-2'],
  'kharif-2': ['aman', 'kharif-1', 'rabi'],
};
```

Candidate types:

- `exact`: crop directly matches requested season
- `nearby`: crop from nearby season, with penalty
- `fallback`: broad fallback, with stronger penalty

The tool guarantees at least 3 recommendations when enough crop records exist.

### Scoring model

Each crop starts with:

```text
score = 50
```

Then rules adjust the score:

| Factor | Effect |
|---|---|
| Exact season match | No penalty |
| Nearby-season crop | -8 |
| Fallback crop | -18 |
| Soil match | +20 |
| Soil mismatch | -25 |
| Preferred water source | +15 |
| Rainfed but high-water crop | -20 |
| Weather suitability | Variable |
| Budget fit | -20, +5, or +10 |
| ROI | +15, +8, or -15 |
| Low risk | +5 |
| High risk | -10 |
| Sowing window timing | +15, -5, or -20 |
| Same crop/family rotation | -10 to -15 |
| Good rotation | +5 |
| Market volatility notes | -10 |

Final score is clamped:

```ts
score = Math.max(0, Math.min(100, score));
```

### Weather scoring in recommendations

`applyWeatherScore()` uses:

- 7-day rainfall
- Rainy days
- Average humidity
- Average temperature
- Crop rainfall tolerance
- Crop risk level

Examples:

- Low rainfall tolerance + more than 50 mm rain -> negative adjustment
- High rainfall tolerance + 25-120 mm rain -> positive adjustment
- 5+ rainy days + high-risk crop -> negative adjustment
- Humidity >= 85% + high-risk crop -> negative adjustment
- Warm-season crops get a small positive adjustment if average temperature is suitable

This makes recommendations weather-aware, not only soil/budget based.

### Recommendation financial estimate

Recommendation uses the same conservative assumptions as the financial calculator:

- Yield factor
- Farmgate price factor
- Harvest/marketing cost
- Contingency buffer

This avoids inflated ROI in the ranking.

## 11. Financial Model

Files:

- `src/lib/agent/tools/financials.ts`
- `src/lib/agent/tools/recommend.ts`
- `src/lib/kb/crops.ts`

### Unit conversion

The system uses:

```text
1 acre = 100 decimal
farmSizeAcre = farmSizeDecimal / 100
```

### Cost categories

The per-acre financial model includes:

1. Fertilizer
2. Seed
3. Labour
4. Irrigation
5. Land preparation diesel
6. Pest/IPM management
7. Harvesting, sorting, transport, commission
8. Contingency

### Fertilizer cost

For each fertilizer:

```text
fertilizerCost = kgPerAcre * ratePerKg
```

Example:

```ts
if (f.urea) {
  total += f.urea * INPUT_COSTS.ureaPerKg;
}
```

Input rates are stored in `INPUT_COSTS`:

```ts
ureaPerKg
tspPerKg
mopPerKg
npk15PerKg
gypsumPerKg
zincPerKg
boronPerKg
dieselPerLitre
labourPerDay
irrigationPerApplication
seed... rates
```

### Seed cost

Seed cost is crop-specific:

```text
seedCost = seedQuantityPerAcre * seedRate
```

For example:

- Rice uses `seedRicePerKg`
- Wheat uses `seedWheatPerKg`
- Maize uses `seedMaizePerKg`
- Potato uses `seedPotatoPerKg`
- Tomato/brinjal/chili seed uses converted per-10g rates

### Labour cost

Labour cost:

```text
labourCost = labourDaysPerAcre * labourPerDay
```

Labour days vary by crop. Vegetables have higher labour days because they need more management and repeated harvesting.

### Irrigation cost

Irrigation cost:

```text
irrigationCost = irrigationEventsPerAcre * irrigationPerApplication
```

High-water crops like Boro rice have many irrigation events. Low-water crops like lentil or sesame have fewer.

### Land preparation

Land preparation is estimated using diesel:

```text
landPrepCost = 18 litres * dieselPerLitre
```

### Pest/IPM cost

Each crop has a flat pest/IPM allowance based on risk and expected management intensity.

High-risk vegetables have larger pest/IPM allowance.

### Harvest and market cost

The updated model adds:

```text
harvestMarketingCostBdt
```

This covers:

- Harvesting
- Sorting/grading
- Packing
- Transport
- Market commission
- Handling losses

Vegetables have higher harvest/market cost because they are bulky, perishable, and harvested repeatedly.

### Contingency

After base costs, the model adds a contingency:

```text
contingency = subtotal * contingencyRate
```

Contingency rate:

| Crop risk | Contingency |
|---|---:|
| Low | 8% |
| Medium | 10% |
| High | 12% |

This makes planning more realistic for Bangladesh field conditions.

### Conservative yield and price

The system does not use the full midpoint yield and full midpoint market price directly. It applies:

```text
conservativeYield = midpointYield * yieldFactor
conservativePrice = midpointPrice * priceFactor
```

Different crops have different factors.

Example assumptions:

| Crop type | Yield factor | Price factor | Why |
|---|---:|---:|---|
| Rice | around 0.92 | around 0.90 | More stable |
| Maize | 0.90 | 0.85 | Moderately stable |
| Jute | 0.88 | 0.85 | Retting/quality risk |
| Potato | 0.82 | 0.72 | Strong market volatility |
| Tomato/brinjal/cucumber | 0.72-0.76 | 0.62-0.68 | High spoilage and price volatility |
| Onion | 0.82 | 0.70 | Volatile price/storage quality |

### Revenue

```text
revenuePerAcre = conservativeYieldPerAcre * conservativePricePerUnit
```

### Profit

```text
profitPerAcre = revenuePerAcre - totalCostPerAcre
```

### ROI

```text
roiPercent = (profitPerAcre / totalCostPerAcre) * 100
```

The system rounds displayed values and derives displayed totals from displayed inputs to avoid arithmetic inconsistencies in the UI.

### Farm total

```text
totalCost = totalCostPerAcre * farmSizeAcre
totalRevenue = revenuePerAcre * farmSizeAcre
totalProfit = totalRevenue - totalCost
```

### Break-even price

```text
breakEvenPricePerUnit = totalCostPerAcre / yieldPerAcre
```

This tells the farmer the minimum selling price needed to cover cost.

### Break-even yield

```text
breakEvenYield = totalCostPerAcre / pricePerUnit
```

This tells the farmer the minimum yield needed to cover cost at the expected selling price.

### Risk-adjusted ROI

The financial tool also computes risk-adjusted ROI:

```text
riskAdjustedRoi = baseRoi * (1 - riskPenalty)
```

Risk penalty:

| Risk level | Penalty |
|---|---:|
| Low | 5% |
| Medium | 20% |
| High | 35% |

### Worst-case and best-case sensitivity

Worst case:

```text
worstCaseRevenue = yield * 0.8 * price * 0.8
```

Best case:

```text
bestCaseRevenue = yield * 1.2 * price * 1.2
```

This shows how profit changes if both yield and price move together.

## 12. Crop Calendar

File: `src/lib/agent/tools/calendar.ts`

The calendar tool uses:

- Crop growth stages from `CROPS`
- Farmer sowing date
- Optional weather forecast

For each crop stage and action:

```text
eventDate = sowingDate + stageStartDay
```

The harvest date:

```text
harvestDate = sowingDate + crop.durationDays
```

### Weather-aware calendar advisories

If forecast overlaps a crop stage, the calendar can add advisories:

- Delay urea if rain overlaps top-dressing window
- Reduce/skip irrigation if rain is forecast
- Warn about waterlogging for low-rain-tolerance crops
- Warn about heat during flowering/grain filling
- Warn about cold during nursery/seedling stage
- Warn about high humidity during vegetative/flowering stages

## 13. Tier 1 Tools

File: `src/lib/agent/tools/tier1_tools.ts`

Data source:

File: `src/lib/kb/tier1.ts`

Root data packs include:

- `AgriSense_Tier1_Verified_Fertilizer_Scheduler.json`
- `AgriSense_Tier1_Verified_Irrigation_Scheduler.json`
- `AgriSense_Tier1_Verified_Pest_Disease_Weather_Risks.json`
- `AgriSense_Tier1_Weather_Trigger_Rules.json`
- `AgriSense_Tier1_Scenario_Simulation_Data.json`

### Fertilizer schedule

`getFertilizerSchedule(crop, soilType, farmSizeDecimal)`:

- Finds verified fertilizer records matching the crop.
- Scales quantities by farm size.
- Uses `INPUT_COSTS` for cost estimates.
- Returns source metadata where available.

Scaling:

```text
farmAcres = farmSizeDecimal / 100
totalQuantity = quantityPerAcre * farmAcres
```

### Irrigation schedule

`getIrrigationSchedule(crop, soilType, farmSizeDecimal)`:

- Retrieves verified irrigation records.
- Looks up irrigation cost from `computeFinancials()`.
- Scales estimated cost to farm size.

### Pest and disease risk

`assessPestDiseaseRisk()`:

- Matches crop against pest/disease records.
- Uses temperature, humidity, and rainfall when supplied.
- Produces scouting alerts, not diagnosis.
- Estimates management cost using financial IPM line items.

### Weather triggers

`checkWeatherTriggers()`:

- Normalizes forecast input.
- Computes total rain, max temperature, min temperature, humidity, dry days.
- Compares against trigger rules.
- Returns schedule adjustment advice.

### Scenario simulation

`simulateScenario()`:

Supported scenario types:

- `budget_cut_percent`
- `rainfall_change_percent`
- `selling_price_change_percent`
- `input_price_change_percent`
- `sowing_delay_days`

It starts from `computeFinancials()` baseline and adjusts cost/revenue/profit/ROI deterministically.

## 14. Tier 2 Tools

File: `src/lib/agent/tools/tier2_tools.ts`

### Supplier comparison

`compareSuppliers()` ranks mock supplier offers.

It considers:

- Price
- Stock availability
- Delivery time
- Rating
- Market-distance proxy

The commercial supplier data is mock and should be presented as such.

`compareSuppliersForPlan()` derives input needs from the chosen crop's financial line items and farm size, then compares suppliers.

### Market price intelligence

`getMarketPriceIntelligence()` integrates with the Bangladesh Department of Agricultural Marketing website.

It can:

- Parse live ticker prices
- Discover commodity options
- Fetch historical series
- Apply deterministic sell/store/wait rules

It refuses decision math when required values are missing, such as:

- Confirmed current price
- Unit
- Price type
- Market
- Storage cost
- Spoilage loss
- Future price assumption

This prevents unsafe or misleading market advice.

## 15. Disease Detection

Files:

- `src/components/PlantDiseaseDetector.tsx`
- `src/app/api/disease-detection/route.ts`

### Flow

```text
User uploads image
  -> frontend sends FormData to /api/disease-detection
  -> API validates file
  -> sharp normalizes image
  -> OpenAI vision model analyzes image
  -> JSON parsed and sanitized
  -> markdown answer generated
  -> answer saved to conversation
```

### Safety design

The model is instructed:

- Use only visible evidence.
- Do not assume a closed dataset.
- Do not claim lab certainty.
- Distinguish disease from nutrient stress, pest damage, sunscald, water stress, physical injury, aging, and artifacts.
- Do not prescribe chemical product names or doses.
- Output visual-similarity scores, not probabilities.

### Diagnosis status

Supported statuses:

- `healthy`
- `possible_disease`
- `uncertain`
- `not_leaf`

The API downgrades confidence when:

- Image quality is poor
- Candidate score is too low
- Top candidates are too close together
- Image is not a plant leaf

## 16. Data Generation

### Verified facts generation

File: `scripts/build_verified_facts.py`

This script regenerates `src/lib/kb/verified_facts.ts` from CSV data.

The generated TypeScript file embeds the verified facts so the app can use them locally without requiring a database lookup or external RAG service.

### Static JSON data packs

Root JSON files provide Tier 1/Tier 2 data:

- Fertilizer scheduler
- Irrigation scheduler
- Pest/disease weather risks
- Weather trigger rules
- Scenario simulation data
- Persistent memory examples
- Market intelligence rules
- Supplier directory samples

## 17. Why The System Uses Deterministic Tools

The GPT model is not trusted to invent numeric claims. Instead:

- Weather comes from `get_weather`.
- Crop ranking comes from `recommend_crops`.
- Financial math comes from `compute_financials`.
- Calendar dates come from `get_crop_calendar`.
- Fertilizer/irrigation schedules come from Tier 1 verified data.
- Sources come from RAG/verified facts.

GPT's main role is:

- Decide which tools to call
- Interpret structured results
- Write farmer-friendly explanations
- Ask for missing information
- Maintain conversational flow

This separation makes the system more inspectable and safer.

## 18. Current RAG Limitations and Future Embedding Upgrade

Current RAG:

- TF-IDF lexical retrieval
- Local in-memory corpus
- Fast and deterministic
- Works offline after build
- Good for exact crop/source/category terms

Limitations:

- No semantic vector similarity
- Query wording still matters
- Bengali semantic matching is limited compared with embeddings
- Does not rerank with a cross-encoder or LLM

Recommended future upgrade:

1. Generate embeddings for every `KbChunk`.
2. Store embeddings in a vector database or local vector index.
3. Use hybrid retrieval:
   - TF-IDF/BM25 for exact terms
   - Embeddings for semantic similarity
4. Rerank top 20 results using a lightweight reranker or GPT.
5. Keep source metadata exactly as now.

A future retrieval flow could be:

```text
query
  -> normalize + synonym expansion
  -> lexical search top 20
  -> embedding search top 20
  -> merge and deduplicate
  -> source-diversity cap
  -> rerank
  -> top K chunks to agent
```

## 19. Important Environment Variables

Common variables:

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Required for chat and disease detection |
| `OPENAI_MODEL` | Chat model, default in code if absent |
| `OPENAI_VISION_MODEL` | Optional model override for disease detection |
| `DATABASE_URL` | Prisma SQLite connection |

## 20. Development Commands

Install dependencies:

```powershell
npm install
```

Run development server:

```powershell
npm run dev
```

Build:

```powershell
npm run build
```

Lint:

```powershell
npm run lint
```

Type check:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
```

Prisma generate:

```powershell
npm run db:generate
```

Push schema:

```powershell
npm run db:push
```

## 21. Known Engineering Notes

- The app uses SQLite, which is good for a hackathon/demo. Production would likely use Postgres.
- Trace entries are capped to 50,000 characters per tool result when saved.
- RAG is local and deterministic, not a hosted vector service.
- Supplier data is mock and must remain labeled as mock.
- Market intelligence depends on live DAM site availability.
- Disease detection is visual triage, not a lab diagnosis.
- Financial output is a conservative planning estimate, not a guaranteed profit.
- The full `npm run lint` may show unrelated existing lint issues if other files are changed; focused lint has been used during recent changes.

## 22. End-to-End Example

User:

```text
4 decimal, kada mati, khaler pani, 1 lac, kharif 1
```

Expected internal flow:

1. `/api/chat` receives the message.
2. `runAgent()` loads or creates the farmer profile.
3. GPT calls `save_profile` with:
   - `farmSizeDecimal = 4`
   - `soilType = clay`
   - `waterSource = canal`
   - `budgetBdt = 100000`
   - `targetSeason = kharif-1`
4. GPT calls `get_weather` for saved location.
5. GPT calls `rag_search` for season/soil/crop evidence.
6. GPT calls `recommend_crops`.
7. Recommendation scoring uses:
   - Kharif-1 season match
   - Clay soil match/mismatch
   - Canal water source
   - 7-day rainfall/humidity/temperature
   - Budget fit
   - Conservative ROI
   - Crop risk
8. GPT asks the farmer to choose among top crops or proceeds with a chosen crop if requested.
9. For a full plan, GPT calls:
   - `get_kb_facts_by_crop`
   - `get_fertilizer_schedule`
   - `get_irrigation_schedule`
   - `assess_pest_disease_risk`
   - `check_weather_triggers`
   - `get_crop_calendar`
   - `compute_financials`
10. Final answer is rendered in Bangla or English with sources.
11. Frontend extracts trace results into cards, calendar, and financial tabs.

## 23. File Map

| File | What it does |
|---|---|
| `src/app/page.tsx` | Main app UI and trace-driven panels |
| `src/app/api/chat/route.ts` | Chat endpoint and off-topic guard |
| `src/app/api/disease-detection/route.ts` | GPT vision leaf triage endpoint |
| `src/lib/agent/loop.ts` | Main GPT tool-calling loop |
| `src/lib/agent/tools/registry.ts` | Tool definitions and executor |
| `src/lib/agent/tools/weather.ts` | Open-Meteo weather fetch and alerts |
| `src/lib/agent/tools/recommend.ts` | Crop scoring/ranking engine |
| `src/lib/agent/tools/financials.ts` | Conservative financial calculator |
| `src/lib/agent/tools/calendar.ts` | Dated crop calendar |
| `src/lib/agent/tools/tier1_tools.ts` | Fertilizer, irrigation, risk, triggers, scenarios |
| `src/lib/agent/tools/tier2_tools.ts` | Supplier and market tools |
| `src/lib/kb/crops.ts` | Structured crop/soil/season/cost catalog |
| `src/lib/kb/rag.ts` | TF-IDF RAG retriever |
| `src/lib/kb/verified_facts.ts` | Generated verified facts |
| `src/lib/kb/tier1.ts` | Tier 1 data loading/helpers |
| `src/lib/kb/tier2.ts` | Tier 2 data loading/helpers |
| `src/lib/db.ts` | Prisma client |
| `src/lib/db/memory.ts` | Season-plan memory helpers |
| `prisma/schema.prisma` | Database schema |
| `scripts/build_verified_facts.py` | Verified facts generator |

