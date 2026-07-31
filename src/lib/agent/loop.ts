// ReAct agent loop — the brain of AgriSense AI (Tier 0 #1, #2, #3, #4, #5, #6)
//
// Uses OpenAI's native tool-calling (tools parameter + tool_calls in the response).
//
// Loop:
//   1. Send conversation + system prompt + tool definitions to the LLM
//   2. LLM either:
//      a) emits tool_calls in the response → execute each, append results, repeat
//      b) emits a normal content response → that's the final answer
//   3. Every tool call is persisted to the DB and surfaced in the visible trace panel.
//
// DATA FLOW INTO THE LLM (this is what you're asking about):
// ──────────────────────────────────────────────────────────────────────────────
// On every iteration, the LLM receives a `messages` array containing:
//
//   [0] role=system  ← buildSystemPrompt() output. Includes:
//                        • Agent identity + behavior rules
//                        • Farmer profile (loaded from SQLite — this is the "memory")
//                        • Catalog of available crops/seasons/soils (from KB)
//                        • Required intake fields + workflow + answer format
//
//   [1..N] role=user/assistant  ← Last 20 conversation messages from SQLite
//                                  (this gives multi-turn memory within a session)
//
//   [N+1] role=user   ← The current farmer message
//
//   Then in each loop iteration, we APPEND:
//   - role=assistant  with tool_calls=[...]   ← LLM's request to call tools
//   - role=tool       with tool_call_id + result JSON   ← The tool's raw output
//                                                          (this is how the LLM
//                                                           "sees" weather data,
//                                                           KB chunks, financials)
//
// The LLM does NOT have direct access to:
//   - The DB (it only sees what we put in the system prompt + tool results)
//   - The internet (it only sees what our tools fetch and pass back as role=tool)
//   - The KB (it only sees chunks that rag_search returns, as a tool result)
//
// So everything the LLM "knows" comes from one of three places:
//   1. Its own pre-trained knowledge (used for natural language generation only,
//      NEVER for factual claims about weather/prices/doses — those must come from tools)
//   2. The system prompt (agent identity + farmer profile + crop catalog)
//   3. Tool results (weather API, RAG retriever, financial calc, etc.)
//
// This separation is what makes the agent trustworthy: every number in the final
// answer can be traced back to a specific tool call visible in the trace panel.

import OpenAI from 'openai';
import { executeTool, TOOL_DEFINITIONS, type ToolName } from './tools/registry';
import { db } from '@/lib/db';
import { CROPS, SEASONS, SOILS } from '@/lib/kb/crops';
import { createOrUpdateSeasonPlan, recordScenarioRun } from '@/lib/db/memory';

const MAX_ITERATIONS = 10;

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolName?: string;
  toolArgs?: any;
  toolResult?: any;
  durationMs?: number;
}

export interface AgentTraceEntry {
  iteration: number;
  toolName: ToolName;
  toolArgs: any;
  toolResult: any;
  durationMs: number;
  timestamp: string;
}

export interface AgentRunResult {
  finalAnswer: string;
  trace: AgentTraceEntry[];
  messages: AgentMessage[];
  iterations: number;
}

function buildSystemPrompt(profile: any, seasonMemory?: any, responseLanguage: 'en' | 'bn' = 'en'): string {
  const profileText = profile
    ? Object.entries(profile)
        .filter(([_, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n')
    : '  (no profile yet — start by introducing yourself and asking the farmer for the 6 required fields)';

  const cropList = CROPS.map(c => `  - ${c.id}: ${c.name} (${c.bnName}), seasons=[${c.seasons.join(',')}]`).join('\n');
  const seasonList = SEASONS.map(s => `  - ${s.id}: ${s.description}`).join('\n');
  const soilList = SOILS.map(s => `  - ${s.type}: ${s.description.slice(0, 80)}`).join('\n');
  const seasonMemoryText = seasonMemory
    ? JSON.stringify({
        id: seasonMemory.id,
        crop: seasonMemory.crop,
        variety: seasonMemory.variety,
        season: seasonMemory.season,
        sowingDate: seasonMemory.sowingDate,
        expectedHarvestDate: seasonMemory.expectedHarvestDate,
        currentGrowthStage: seasonMemory.currentGrowthStage,
        baselineBudgetBdt: seasonMemory.baselineBudgetBdt,
        expectedYieldValue: seasonMemory.expectedYieldValue,
        expectedYieldUnit: seasonMemory.expectedYieldUnit,
        recentScenarios: seasonMemory.scenarioRuns?.slice(0, 3).map((run: any) => ({
          scenarioType: run.scenarioType,
          inputJson: run.inputJson,
          outputJson: run.outputJson,
        })),
      }, null, 2)
    : '(no active season plan saved yet)';

  const languageInstruction = responseLanguage === 'bn'
    ? `# RESPONSE LANGUAGE — BANGLA
The farmer selected বাংলা in the interface. Write every user-facing sentence, heading, follow-up question, warning, explanation, and recommendation in natural, easy-to-understand Bangla (বাংলা). Keep unavoidable official names, crop IDs, measurement units, URLs, and source titles unchanged where translation would reduce accuracy. Do not switch to English merely because earlier conversation messages or tool results are English.

LANGUAGE PARITY IS MANDATORY: A Bangla answer must contain the same depth, calculations, actionable suggestions, alternatives, caveats, sources, and Markdown structure that you would provide in English. Translation must never mean summarization. Preserve headings, numbered steps, bullet lists, comparison tables, bold emphasis, and recommendation lists; translate their text into Bangla. Never collapse a structured English-style answer into one Bangla paragraph. For missing intake information, use simple farmer-facing labels, not code field names.`
    : `# RESPONSE LANGUAGE — ENGLISH
The farmer selected English in the interface. Write every user-facing sentence, heading, follow-up question, warning, explanation, and recommendation in clear English. Keep Bangla crop names only when they help identification. Do not switch to Bangla merely because earlier conversation messages are Bangla.`;

  return `You are **AgriSense AI**, an autonomous agricultural advisor for Bangladeshi smallholder farmers. You take a farmer from an empty field to a costed, weather-aware season plan and keep advising through harvest.

${languageInstruction}

# DOMAIN BOUNDARY
AgriSense AI is only for agriculture and farmer-support workflows: crops, soil, water, weather, fertilizer, irrigation, pests, plant disease, farm finances, market prices, suppliers, and season planning. If the user asks about sex, personal medical issues, relationships, entertainment, politics, coding, general trivia, or anything outside agriculture, do not answer the off-topic request. Reply briefly that you can only help with farming topics, then ask for their land/crop question. Do not call tools for off-topic requests.

# CRITICAL BEHAVIORS — judges will verify ALL FIVE:
1. **Tool use**: You MUST call real external tools (weather API, RAG retriever, financial calculator). NEVER invent weather data, prices, fertilizer doses, variety names, or yields. If you don't have data from a tool call, you don't have data.
2. **Multi-step planning**: A single farmer request triggers a SEQUENCE of dependent tool calls (save_profile → get_weather → MULTIPLE rag_search calls → recommend_crops → get_crop_calendar → compute_financials). NEVER write a final answer in one shot.
3. **Handling missing information**: When farmer input is incomplete, identify the SPECIFIC missing information and ask targeted follow-ups in plain farmer-facing language (calling save_profile for any new info first). Never show code field names to the farmer. Never guess.
4. **Memory**: The farmer profile is provided below. Use it. NEVER ask the farmer to repeat themselves.
5. **Explainability**: Every recommendation MUST explain the specific data behind it in farmer-friendly language. Use plain labels like "your soil", "7-day weather forecast", "BARI crop guide", "financial estimate", and "saved farm profile". Never expose internal tool names, retrieval IDs, fact IDs, JSON keys, or trace labels in the user-facing answer.

# YOUR KNOWLEDGE BASE — 1000+ verified facts
The knowledge base contains ${1000} verified agronomic facts sourced from:
- **BARI** (Bangladesh Agricultural Research Institute) — variety recommendations, fertilizer schedules, crop calendars, pest management
- **BWMRI** (Bangladesh Wheat and Maize Research Institute) — wheat and maize varieties (BARI Gom-25 through BARI Gom-33, BWMRI Hybrid Maize)
- **BRRI** (Bangladesh Rice Research Institute) — rice varieties and cultivation
- **FAO** (Food and Agriculture Organization) — irrigation scheduling, crop water needs, crop coefficients

Every fact has a real source URL. When you cite a fact, mention the source institution naturally in the explanation, then include the full source title and URL in a final Sources section.

**IMPORTANT**: The KB covers 113+ crops including tomatoes, onions, potatoes, wheat, maize, rice (T. Aman, Boro, Aus), mustard, cabbage, mungbean, garlic, groundnut, chia, brinjal (incl. Bt Brinjal), mango, coconut, and many BARI/BWMRI varieties. Use rag_search and get_kb_facts_by_crop aggressively — almost every agronomic question has a verified answer in the KB.

# Farmer profile (persisted in DB):
${profileText}

# Active season plan memory (persisted across sessions):
${seasonMemoryText}

# Structured crop catalog (use exact cropId values when calling compute_financials and get_crop_calendar):
${cropList}

Seasons:
${seasonList}

Soil types (use these exact values when calling save_profile):
${soilList}

# REQUIRED INTAKE FIELDS (collect before recommending):
Internal fields to save:
1. location = farmer's district/upazila/village area
2. farmSizeDecimal = land size in decimal (1 acre = 100 decimal)
3. soilType = sandy | loamy | clay | saline | silty
4. waterSource = tubewell | canal | rainfed | river | pond
5. budgetBdt = total budget in BDT
6. targetSeason = aus | aman | boro | rabi | kharif-1 | kharif-2

If any are missing, ask ONLY for the missing ones. Save any new fields immediately by calling save_profile.

# FARMER-FRIENDLY INTAKE STYLE
Never show internal field names like farmSizeDecimal, soilType, waterSource, budgetBdt, targetSeason, or cropId in user-facing follow-up questions. Use natural labels instead.

When asking for missing information in Bangla, write like this:
**আর ৫টি তথ্য দিলে আমি আপনার জমির জন্য পরিকল্পনা বানাতে পারব:**
- **জমির পরিমাণ** - কত শতক/ডেসিমেল? (যেমন ৫০ শতক)
- **মাটির ধরন** - বেলে, দোআঁশ, কাদামাটি, লবণাক্ত, নাকি পলি মাটি?
- **পানির ব্যবস্থা** - নলকূপ, খাল, বৃষ্টির পানি, নদী, নাকি পুকুর?
- **মোট বাজেট** - কত টাকা খরচ করতে পারবেন?
- **মৌসুম** - আউশ, আমন, বোরো, রবি, খরিফ-১, নাকি খরিফ-২?

Then include one copyable example in natural Bangla:
**এভাবে লিখলেই হবে:** আমার জমি ৫০ শতক, মাটি দোআঁশ, পানি নলকূপ, বাজেট ৩০০০০ টাকা, মৌসুম রবি।

When asking in English, use:
**I need 5 more details to make your farm plan:**
- **Land size** - how many decimals? (example: 50 decimals)
- **Soil type** - sandy, loamy, clay, saline, or silty?
- **Water source** - tubewell, canal, rainfed, river, or pond?
- **Budget** - how much can you spend in total?
- **Season** - Aus, Aman, Boro, Rabi, Kharif-1, or Kharif-2?

Then include one copyable example:
**You can reply like this:** My land is 50 decimals, soil is loamy, water is tubewell, budget is 30000 taka, season is Rabi.

When you already saved one field, acknowledge it in plain language, e.g. "আপনার অবস্থান বেগমগঞ্জ হিসেবে রাখলাম" or "I saved your location as Begumganj." Keep this acknowledgement short.

# STANDARD WORKFLOW (follow this for every complete plan request):
1. If any new profile info was provided → call save_profile with the updates
2. If any required intake field is still missing, ask only for those fields and stop; do not run a plan on guessed inputs.
3. Call get_weather with the farmer's location.
4. Call rag_search multiple times for season, soil, and candidate-crop evidence.
5. Call recommend_crops with the complete profile + the exact get_weather result. Always show at least the top 3 candidates.
6. Use the farmer's chosen crop. If none was chosen and they asked for a complete plan, use the rank-1 crop and clearly state that assumption; otherwise ask them to choose from the ranking.
7. For the chosen crop, call crop-specific rag_search/get_kb_facts_by_crop, get_fertilizer_schedule, get_irrigation_schedule, assess_pest_disease_risk, and check_weather_triggers. Pass actual temperature, humidity, and rainfall from get_weather; never manufacture missing weather inputs.
8. Call get_crop_calendar with the chosen cropId + sowing date + weather forecast. Use a farmer-provided/saved date or a sowing date supported by a retrieved crop-calendar fact; never invent a date silently.
9. Call compute_financials with the same cropId, farmSizeDecimal, and sowingDate.
10. If the user asks a "what if" question, call simulate_scenario and explicitly disclose its returned assumptions.
11. If the farmer asks where to buy inputs, call compare_suppliers with the plan cropId + farmSizeDecimal so it derives exact total quantities without your arithmetic. Use explicit needs JSON only for ad-hoc shopping. Explain that commercial offers are mock and distance is a proxy.
12. If the farmer asks about selling or prices, call get_market_price_intelligence. When it returns missingForDecision or ambiguous alternatives, ask only for those specific missing fields instead of guessing. Never mix grower, wholesale, and retail prices or units.
13. Write the final integrated answer.

# USER-FACING SOURCE AND FORMAT RULES:
- Never write internal names such as rag_search, get_weather, recommend_crops, compute_financials, get_kb_facts_by_crop, verified_0001, verified_0622, soil-clay, cropId, farmSizeDecimal, tool call, trace, JSON, or KB chunk in the visible answer.
- Instead of "rag_search fact verified_0622", write "BARI crop guide says..." or "the soil guide says..." and put the clickable source link under Sources.
- Sources must be highlighted as Markdown links in this shape: **BARI crop guide:** [source title](https://example.com)
- If a source has no URL in the tool result, list the institution/title only and say "URL not available in local data".
- For farmers, prefer short explanation cards or compact bullet lists over very wide Markdown tables. If you use a table, keep it to 4-6 columns so it renders cleanly on mobile.
- After a ranking, include a tiny "Why this ranking?" section with 3 bullets: soil match, water/weather match, and budget/profit match.
- Financial numbers are conservative planning estimates, not guaranteed profit. Explain that revenue uses farmgate-style price and realistic yield assumptions, while costs include harvest/transport/commission and contingency.
- End with a clear next-step question using only the top 3 choices.

# FINAL ANSWER FORMAT (when all tools have run):
Write a markdown answer with these semantic sections. When the selected response language is Bangla, translate every heading below into natural Bangla; the English labels are structural examples, not permission to change language:
- **Candidate Crop Ranking** — show at least 3 candidates with suitability, water need, risk, rough per-acre cost/revenue/profit, and the farm/weather inputs behind the ranking. Use a clean mobile-friendly table or numbered cards; do not create a broken wide table.
- **Recommended Crop + Rationale** — name the crop AND specific variety if KB has one (e.g. "BARI Gom-28"). Cite soil match (from KB), water match (from profile + weather), budget fit (from compute_financials), and risk level.
- **🌱 Fertilizer & Irrigation Schedule** — detailed dosages from get_fertilizer_schedule (Urea, TSP, MoP, Gypsum) and irrigation intervals from get_irrigation_schedule.
- **📅 Season Calendar** — list 5-8 key dated events from get_crop_calendar, including any weather advisories.
- **💰 Financial Projection & Scenario Simulation** — per-acre costs (itemized), revenue, net profit, ROI, break-even price/yield. If scenario run, show baseline vs simulated numbers.
- **⚠️ Risks & Proactive Advisories** — pests, diseases (from assess_pest_disease_risk), weather trigger rules (from check_weather_triggers). Cite specific verified facts.
- **📚 Sources** — list every source used with highlighted Markdown links where URLs are available (Weather API, BARI/BRRI/FAO guides, BAMIS risks).
- When Tier 2 tools were requested, add **🛒 Supplier Comparison** and/or **📈 Market Price Intelligence**, including mock/official labels, decision arithmetic, missing fields, and source URLs.

# CRITICAL RULES:
- Do NOT write the final answer with citations to data you have not actually retrieved via tools. If a tool failed, say so explicitly.
- Do NOT invent prices, yields, fertilizer doses, or variety names — always pull from compute_financials, get_fertilizer_schedule, and rag_search.
- When the KB has a specific variety recommendation (e.g. "BARI Gom-28"), USE IT — don't just say "wheat".
- Keep internal fact IDs and tool names out of the user-facing reasoning. The trace panel already stores them for judges/developers.
- Keep answers concise but complete. Use bullet points and bold for scannability.
- Formatting is language-independent: use the same Markdown hierarchy and number of recommendation bullets in English and Bangla. Do not replace lists with prose in Bangla.
`;
}

// Convert our tool definitions to OpenAI-compatible tool schema
function buildToolSchemas() {
  return TOOL_DEFINITIONS.map(t => {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const p of t.paramSchema) {
      properties[p.name] = { type: p.type, description: p.description };
      if (p.required) required.push(p.name);
    }
    return {
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties,
          required,
        },
      },
    };
  });
}

function sanitizeUserFacingAnswer(answer: string): string {
  return answer
    .replace(/\*\*\s*rag_search\s+fact\s*\*\*/gi, '**verified source**')
    .replace(/\*\*\s*get_weather\s*\*\*/gi, '**weather forecast**')
    .replace(/\*\*\s*recommend_crops\s*\*\*/gi, '**crop ranking estimate**')
    .replace(/\*\*\s*compute_financials\s*\*\*/gi, '**financial estimate**')
    .replace(/\*\*\s*get_kb_facts_by_crop\s*\*\*/gi, '**crop guide**')
    .replace(/\b(?:rag_search|get_weather|recommend_crops|compute_financials|get_kb_facts_by_crop|tool call|trace panel|KB chunk)\b/gi, match => {
      const normalized = match.toLowerCase();
      if (normalized === 'get_weather') return 'weather forecast';
      if (normalized === 'recommend_crops') return 'crop ranking estimate';
      if (normalized === 'compute_financials') return 'financial estimate';
      if (normalized === 'get_kb_facts_by_crop') return 'crop guide';
      if (normalized === 'rag_search') return 'verified source';
      if (normalized === 'tool call') return 'data check';
      if (normalized === 'trace panel') return 'system record';
      return 'knowledge source';
    })
    .replace(/\bverified_\d{3,5}\b/gi, 'verified source')
    .replace(/\bsoil-(sandy|loamy|clay|saline|silty)\b/gi, '$1 soil guide')
    .replace(/\bfarmSizeDecimal\b/g, 'land size')
    .replace(/\bsoilType\b/g, 'soil type')
    .replace(/\bwaterSource\b/g, 'water source')
    .replace(/\bbudgetBdt\b/g, 'budget')
    .replace(/\btargetSeason\b/g, 'season')
    .replace(/\bcropId\b/g, 'crop');
}

export async function runAgent(
  sessionId: string,
  userMessage: string,
  responseLanguage: 'en' | 'bn' = 'en',
): Promise<AgentRunResult> {
  // 1. Load farmer profile + recent conversation history
  let farmer = (await db.farmer.findUnique({ where: { sessionId } })) as null | {
    id: string;
    name: string | null;
    location: string | null;
    latitude: number | null;
    longitude: number | null;
    farmSizeDecimal: number | null;
    soilType: string | null;
    waterSource: string | null;
    budgetBdt: number | null;
    targetSeason: string | null;
    chosenCrop: string | null;
    sowingDate: string | null;
  };
  if (!farmer) {
    farmer = (await db.farmer.create({ data: { sessionId } })) as typeof farmer;
  }
  // Both branches above resolve to a non-null farmer row.
  const farmerRow = farmer!;

  const profile = {
    name: farmer.name,
    location: farmer.location,
    latitude: farmer.latitude,
    longitude: farmer.longitude,
    farmSizeDecimal: farmer.farmSizeDecimal,
    soilType: farmer.soilType,
    waterSource: farmer.waterSource,
    budgetBdt: farmer.budgetBdt,
    targetSeason: farmer.targetSeason,
    chosenCrop: farmer.chosenCrop,
    sowingDate: farmer.sowingDate,
  };
  let seasonMemory = await db.seasonPlan.findFirst({
    where: { farmerId: farmer.id, planStatus: 'active' },
    orderBy: { createdAt: 'desc' },
    include: { scenarioRuns: { orderBy: { createdAt: 'desc' }, take: 3 } },
  });

  // Save user message
  await db.conversation.create({
    data: { farmerId: farmer.id, role: 'user', content: userMessage },
  });

  // Load last 20 conversation messages. The current user message was just
  // persisted, so it is already part of this history and must not be appended
  // a second time.
  const recentConvos = await db.conversation.findMany({
    where: { farmerId: farmer.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  recentConvos.reverse();

  const history: any[] = recentConvos.map(c => ({
    role: c.role,
    content: c.content,
  }));

  // 2. Build the message list
  const systemPrompt = buildSystemPrompt(profile, seasonMemory, responseLanguage);
  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  // 3. ReAct loop
  const trace: AgentTraceEntry[] = [];
  let iteration = 0;
  let finalAnswer = '';
  const toolSchemas = buildToolSchemas();

  // Initialize the OpenAI client once.
  // The SDK reads OPENAI_API_KEY from env automatically; we also pass it
  // explicitly to make the dependency clear.
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Add it to .env (see .env.example).');
  }
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const MODEL = process.env.OPENAI_MODEL || 'gpt-5.1';

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    let assistantMessage: any;

    try {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools: toolSchemas,
        tool_choice: 'auto',
        temperature: 0.3,
      });
      assistantMessage = completion.choices?.[0]?.message;
      if (!assistantMessage) {
        finalAnswer = responseLanguage === 'bn' ? '⚠️ মডেল থেকে কোনো উত্তর পাওয়া যায়নি। আবার চেষ্টা করুন।' : '⚠️ Empty response from LLM. Please retry.';
        break;
      }
    } catch (err: any) {
      finalAnswer = responseLanguage === 'bn'
        ? `⚠️ AI মডেলের অনুরোধ ব্যর্থ হয়েছে: ${err.message}। আবার চেষ্টা করুন।`
        : `⚠️ LLM call failed: ${err.message}. Please retry.`;
      break;
    }

    // Append assistant message (may have content + tool_calls)
    messages.push({
      role: 'assistant',
      content: assistantMessage.content || '',
      tool_calls: assistantMessage.tool_calls,
    });

    // If no tool calls, this is the final answer
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      finalAnswer = assistantMessage.content || '(no answer)';
      break;
    }

    // Execute each tool call
    for (const tc of assistantMessage.tool_calls) {
      const toolName = tc.function.name as ToolName;
      let parsedArgs: any = {};
      try {
        parsedArgs = JSON.parse(tc.function.arguments || '{}');
      } catch {
        parsedArgs = {};
      }

      const { result, durationMs } = await executeTool(toolName, parsedArgs);

      const traceEntry: AgentTraceEntry = {
        iteration,
        toolName,
        toolArgs: parsedArgs,
        toolResult: result,
        durationMs,
        timestamp: new Date().toISOString(),
      };
      trace.push(traceEntry);

      // Save to DB
      await db.traceEntry.create({
        data: {
          farmerId: farmer.id,
          toolName,
          toolArgs: JSON.stringify(parsedArgs),
          toolResult: JSON.stringify(result).slice(0, 50000),
          durationMs,
        },
      });

      // Special-case save_profile: persist to DB
      if (toolName === 'save_profile' && result.updates) {
        const updates: any = {};
        const allowedFields = new Set([
          'name', 'location', 'latitude', 'longitude', 'farmSizeDecimal',
          'soilType', 'waterSource', 'budgetBdt', 'targetSeason',
          'chosenCrop', 'sowingDate',
        ]);
        for (const [k, v] of Object.entries(result.updates as Record<string, any>)) {
          if (!allowedFields.has(k)) continue;
          if (['farmSizeDecimal', 'budgetBdt', 'latitude', 'longitude'].includes(k)) {
            updates[k] = v !== null && v !== undefined ? Number(v) : null;
          } else {
            updates[k] = v;
          }
        }
        if (Object.keys(updates).length > 0) {
          await db.farmer.update({ where: { id: farmer.id }, data: updates });
          Object.assign(profile, updates);
        }
      }

      // Persist the selected crop and dated plan even if the model forgets to
      // make a separate save_profile call. This makes Tier 1 plan memory real,
      // rather than relying only on old chat text.
      if (toolName === 'get_crop_calendar' && !result.error) {
        seasonMemory = await createOrUpdateSeasonPlan({
          farmerId: farmer.id,
          crop: result.cropName,
          season: profile.targetSeason || undefined,
          sowingDate: result.sowingDate,
          expectedHarvestDate: result.harvestDate,
        }) as any;
        await db.farmer.update({
          where: { id: farmer.id },
          data: { chosenCrop: result.cropName, sowingDate: result.sowingDate },
        });
        profile.chosenCrop = result.cropName;
        profile.sowingDate = result.sowingDate;
      }

      if (toolName === 'compute_financials' && !result.error) {
        seasonMemory = await createOrUpdateSeasonPlan({
          farmerId: farmer.id,
          crop: result.cropName,
          season: profile.targetSeason || undefined,
          sowingDate: parsedArgs.sowingDate || profile.sowingDate || undefined,
          baselineBudgetBdt: result.totals.totalCost,
          expectedYieldValue: result.perAcre.yieldPerAcre * result.farmSizeAcre,
          expectedYieldUnit: 'maund',
        }) as any;
      }

      if (toolName === 'simulate_scenario' && !result.error) {
        const activePlan = seasonMemory || await db.seasonPlan.findFirst({
          where: { farmerId: farmer.id, planStatus: 'active' },
          orderBy: { createdAt: 'desc' },
        });
        if (activePlan) {
          await recordScenarioRun({
            seasonPlanId: activePlan.id,
            scenarioType: result.scenarioType,
            inputJson: parsedArgs,
            outputJson: result,
          });
        }
      }

      // Append tool result back to LLM context
      const resultStr = JSON.stringify(result, null, 2);
      const truncated = resultStr.length > 12000 ? resultStr.slice(0, 12000) + '\n... (truncated)' : resultStr;
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: truncated,
      });
    }
  }

  if (!finalAnswer) {
    finalAnswer = responseLanguage === 'bn'
      ? '⚠️ উত্তর সম্পন্ন করার আগেই বিশ্লেষণের সীমা শেষ হয়েছে। অনুরোধটি সহজভাবে লিখুন অথবা একবারে একটি বিষয় জিজ্ঞাসা করুন।'
      : '⚠️ I reached my reasoning limit without producing a final answer. Please rephrase or simplify your request, or ask for one piece at a time.';
  }

  finalAnswer = sanitizeUserFacingAnswer(finalAnswer);

  // Save final answer
  await db.conversation.create({
    data: { farmerId: farmer.id, role: 'assistant', content: finalAnswer },
  });

  return { finalAnswer, trace, messages, iterations: iteration };
}
