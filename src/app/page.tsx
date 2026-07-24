'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import {
  Sprout, Cloud, Calculator, CalendarDays, Search, Database, Loader2, ChevronRight,
  Activity, MapPin, User, Send, RefreshCw, Wrench, TrendingUp, AlertTriangle,
  Droplets, Target, Trophy, ExternalLink, Calendar, Coins, ListChecks, Sparkles,
  ShoppingCart, BarChart3,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ScenarioSimulator } from '@/components/ScenarioSimulator';

// ---------- Types ----------

interface ToolTrace {
  id?: string;
  iteration: number;
  toolName: string;
  toolArgs: any;
  toolResult: any;
  durationMs: number;
  timestamp: string;
  at?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  trace?: ToolTrace[];
}

interface FarmerProfile {
  sessionId: string;
  name?: string | null;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  farmSizeDecimal?: number | null;
  soilType?: string | null;
  waterSource?: string | null;
  budgetBdt?: number | null;
  targetSeason?: string | null;
  chosenCrop?: string | null;
  sowingDate?: string | null;
}

interface CropRec {
  rank: number;
  cropId: string;
  cropName: string;
  bnName: string;
  suitabilityScore: number;
  waterNeed: 'low' | 'medium' | 'high';
  riskLevel: 'low' | 'medium' | 'high';
  estimatedYieldMaund: number;
  estimatedRevenueBdt: number;
  estimatedCostBdt: number;
  estimatedProfitBdt: number;
  roiPercent: number;
  rationale: string[];
  kbEvidence: string[];
}

interface CalendarEvent {
  day: number;
  date: string;
  stage: string;
  action: string;
  advisory?: string;
}

interface CalendarResult {
  cropId: string;
  cropName: string;
  sowingDate: string;
  harvestDate: string;
  totalDays: number;
  events: CalendarEvent[];
  weatherAdvisories: string[];
}

interface FinancialLineItem {
  category: string;
  item: string;
  quantityPerAcre: number;
  unit: string;
  rateBdt: number;
  totalBdt: number;
}

interface FinancialResult {
  cropId: string;
  cropName: string;
  farmSizeDecimal: number;
  farmSizeAcre: number;
  perAcre: {
    lineItems: FinancialLineItem[];
    totalCostPerAcre: number;
    yieldPerAcre: number;
    pricePerUnit: number;
    revenuePerAcre: number;
    profitPerAcre: number;
    roiPercent: number;
    breakEvenPricePerUnit: number;
    breakEvenYieldMaund: number;
  };
  totals: {
    totalCost: number;
    totalRevenue: number;
    totalProfit: number;
  };
  scenarioNotes: string[];
}

// ---------- Constants ----------

const TOOL_ICONS: Record<string, any> = {
  get_weather: Cloud,
  rag_search: Search,
  recommend_crops: Sprout,
  compute_financials: Calculator,
  get_crop_calendar: CalendarDays,
  save_profile: Database,
  get_kb_facts_by_crop: Database,
  compare_suppliers: ShoppingCart,
  get_market_price_intelligence: BarChart3,
};

const TOOL_COLORS: Record<string, string> = {
  get_weather: 'bg-sky-100 text-sky-700 border-sky-200',
  rag_search: 'bg-purple-100 text-purple-700 border-purple-200',
  recommend_crops: 'bg-green-100 text-green-700 border-green-200',
  compute_financials: 'bg-amber-100 text-amber-700 border-amber-200',
  get_crop_calendar: 'bg-rose-100 text-rose-700 border-rose-200',
  save_profile: 'bg-slate-100 text-slate-700 border-slate-200',
  get_kb_facts_by_crop: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  compare_suppliers: 'bg-violet-100 text-violet-700 border-violet-200',
  get_market_price_intelligence: 'bg-cyan-100 text-cyan-700 border-cyan-200',
};

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-100 text-green-700 border-green-300',
  medium: 'bg-amber-100 text-amber-700 border-amber-300',
  high: 'bg-red-100 text-red-700 border-red-300',
};

const WATER_COLORS: Record<string, string> = {
  low: 'bg-sky-100 text-sky-700 border-sky-300',
  medium: 'bg-blue-100 text-blue-700 border-blue-300',
  high: 'bg-indigo-100 text-indigo-700 border-indigo-300',
};

function newSessionId(): string {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function fetchJsonWithRetry(url: string, init?: RequestInit, retries = 1): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, init);
      if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise(resolve => window.setTimeout(resolve, 250));
      }
    }
  }
  throw lastError;
}

// ---------- Main Component ----------

export default function Home() {
  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<FarmerProfile | null>(null);
  const [allTraces, setAllTraces] = useState<ToolTrace[]>([]);
  const [activeRightTab, setActiveRightTab] = useState<string>('trace');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initialize session
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('agrisense-session-id') : null;
    const sid = saved || newSessionId();
    setSessionId(sid);
    if (!saved) localStorage.setItem('agrisense-session-id', sid);
  }, []);

  // Load history when sessionId is ready
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      const encodedSessionId = encodeURIComponent(sessionId);
      try {
        const data = await fetchJsonWithRetry(`/api/profile?sessionId=${encodedSessionId}`);
        if (cancelled) return;
        if (data.profile) {
          setProfile(data.profile);
          const convos = (data.conversations || []).map((c: any) => ({ role: c.role, content: c.content }));
          setMessages(convos);
        }
        setAllTraces(data.trace || []);
      } catch (error) {
        console.error('Failed to restore session sidebar:', error);
      }

      // Tier 1 proactive check: whenever a farmer returns, refresh the live
      // forecast for their active saved plan and surface any matched rules.
      try {
        const monitorData = await fetchJsonWithRetry('/api/monitor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        if (cancelled) return;
        if (monitorData.trace?.length) setAllTraces(prev => [...prev, ...monitorData.trace]);
        if (monitorData.alerts?.length) {
          const alertText = monitorData.alerts
            .map((alert: any) => `- ${alert.action} (${alert.reasoning})`)
            .join('\n');
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `### Proactive weather check\n${alertText}`,
            trace: monitorData.trace,
          }]);
        }
      } catch (err) {
        console.error('Failed to run proactive weather check:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Parse the latest tool results from all traces to populate the visualization tabs
  const { latestCrops, latestCalendar, latestFinancials, latestSuppliers, latestMarket } = useMemo(() => {
    let crops: CropRec[] | null = null;
    let calendar: CalendarResult | null = null;
    let financials: FinancialResult | null = null;
    let suppliers: any = null;
    let market: any = null;

    // Walk traces in order; keep the latest of each
    for (const t of allTraces) {
      if (t.toolName === 'recommend_crops' && t.toolResult?.recommendations) {
        crops = t.toolResult.recommendations as CropRec[];
      } else if (t.toolName === 'get_crop_calendar' && t.toolResult?.events) {
        calendar = t.toolResult as CalendarResult;
      } else if (t.toolName === 'compute_financials' && t.toolResult?.perAcre) {
        financials = t.toolResult as FinancialResult;
      } else if (t.toolName === 'compare_suppliers' && t.toolResult?.comparisons) {
        suppliers = t.toolResult;
      } else if (t.toolName === 'get_market_price_intelligence' && t.toolResult?.recommendation) {
        market = t.toolResult;
      }
    }
    return { latestCrops: crops, latestCalendar: calendar, latestFinancials: financials, latestSuppliers: suppliers, latestMarket: market };
  }, [allTraces]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading || !sessionId) return;
    const text = input.trim();
    setInput('');
    setLoading(true);

    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');

      const aiMsg: ChatMessage = {
        role: 'assistant',
        content: data.answer,
        trace: data.trace || [],
      };
      setMessages(prev => [...prev, aiMsg]);
      const newTraces = data.trace || [];
      setAllTraces(prev => [...prev, ...newTraces]);

      // Auto-switch tab based on what tools just ran
      const toolNames = newTraces.map((t: ToolTrace) => t.toolName);
      if (toolNames.includes('recommend_crops')) setActiveRightTab('crops');
      else if (toolNames.includes('get_crop_calendar')) setActiveRightTab('calendar');
      else if (toolNames.includes('compute_financials')) setActiveRightTab('financials');

      // Refresh profile
      const pres = await fetch(`/api/profile?sessionId=${encodeURIComponent(sessionId)}`);
      const pdata = await pres.json();
      if (pdata.profile) setProfile(pdata.profile);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId]);

  const startNewSession = () => {
    const sid = newSessionId();
    setSessionId(sid);
    localStorage.setItem('agrisense-session-id', sid);
    setMessages([]);
    setProfile(null);
    setAllTraces([]);
    setActiveRightTab('trace');
  };

  // Run demo plan (no LLM — for testing visualizations)
  const runDemoPlan = useCallback(async () => {
    if (loading || !sessionId) return;
    setLoading(true);
    setMessages(prev => [...prev, { role: 'user', content: '🌱 [DEMO MODE] Run a sample plan for Jashore / loamy / tubewell / Rabi / 25000 BDT — no LLM needed.' }]);
    try {
      const res = await fetch('/api/demo-plan?location=Jashore&farmSize=50&soil=loamy&water=tubewell&budget=25000&season=rabi');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Demo failed');
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer, trace: data.trace || [] }]);
      setAllTraces(prev => [...prev, ...(data.trace || [])]);
      setActiveRightTab('crops');
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Demo error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [loading, sessionId]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-stone-50 to-amber-50 flex flex-col">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-700 flex items-center justify-center text-white">
              <Sprout className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-stone-800">AgriSense AI</h1>
              <p className="text-xs text-stone-500">Bdapps Agentic AI Hackathon — IUT 12th ICT Fest</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="bg-amber-50 border-amber-300 text-amber-800">Tier 0 — Core Build</Badge>
            <Badge variant="outline" className="bg-emerald-50 border-emerald-300 text-emerald-800">1000+ verified facts (BARI · BWMRI · BRRI · FAO)</Badge>
            <Button variant="outline" size="sm" onClick={runDemoPlan} disabled={loading} title="Run a sample plan without the LLM (useful when OpenAI is region-blocked)">
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              Demo Plan
            </Button>
            <Button variant="outline" size="sm" onClick={startNewSession}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              New Farmer
            </Button>
          </div>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex-1 max-w-[1800px] mx-auto w-full px-4 py-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Chat */}
        <div className="lg:col-span-7 flex flex-col">
          <Card className="flex-1 flex flex-col min-h-[700px]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-stone-800">
                <User className="w-4 h-4 text-green-700" />
                Farmer Conversation
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col gap-3 overflow-hidden">
              <ScrollArea className="flex-1 pr-2" ref={scrollRef as any}>
                <div className="space-y-4 pb-4">
                  {messages.length === 0 && !loading && (
                    <div className="text-center py-12 text-stone-500">
                      <Sprout className="w-12 h-12 mx-auto mb-3 text-green-300" />
                      <p className="font-medium text-stone-700">Welcome to AgriSense AI</p>
                      <p className="text-sm mt-1 max-w-md mx-auto">Tell me about your farm — location, size, soil, water, budget, season — and I&apos;ll build you a costed, weather-aware plan.</p>
                      <div className="mt-4 text-xs text-stone-400 max-w-md mx-auto">
                        <p className="mb-1">Try:</p>
                        <em>&quot;I have 50 decimal in Jashore, loamy soil, tubewell water, want to grow something this Rabi season with 20000 taka budget&quot;</em>
                      </div>
                      <div className="mt-4 text-xs">
                        <Button variant="outline" size="sm" onClick={runDemoPlan}>
                          <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                          Run a demo plan (no LLM needed)
                        </Button>
                      </div>
                    </div>
                  )}
                  {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-green-700 text-white rounded-br-sm'
                          : 'bg-white border border-stone-200 text-stone-800 rounded-bl-sm shadow-sm'
                      }`}>
                        {m.role === 'assistant' ? (
                          <div className="prose prose-sm max-w-none prose-headings:text-stone-800 prose-strong:text-stone-800 prose-code:text-green-700 prose-code:bg-green-50 prose-code:px-1 prose-code:rounded">
                            <ReactMarkdown>{m.content}</ReactMarkdown>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap">{m.content}</p>
                        )}
                        {m.trace && m.trace.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-stone-200/50 text-xs text-stone-500 flex items-center gap-1">
                            <Activity className="w-3 h-3" />
                            {m.trace.length} tool call{m.trace.length !== 1 ? 's' : ''} · view in trace panel →
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex justify-start">
                      <div className="bg-white border border-stone-200 rounded-2xl rounded-bl-sm shadow-sm px-4 py-3 flex items-center gap-2 text-stone-600 text-sm">
                        <Loader2 className="w-4 h-4 animate-spin text-green-700" />
                        Agent is thinking...
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
              <div className="flex gap-2 pt-2 border-t">
                <Input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  placeholder="Type your message... (e.g. 'I want to plant rice in Aman season')"
                  disabled={loading}
                  className="flex-1"
                />
                <Button onClick={sendMessage} disabled={loading || !input.trim()} className="bg-green-700 hover:bg-green-800">
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Profile + Tabbed visualization panel */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Farmer profile card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-stone-800">
                <User className="w-4 h-4 text-green-700" />
                Farmer Profile (Memory)
                {profile?.location && (
                  <Badge variant="outline" className="ml-auto text-[10px] bg-green-50 border-green-200 text-green-700">
                    Persisted in SQLite
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!profile || (!profile.location && !profile.farmSizeDecimal) ? (
                <p className="text-xs text-stone-500 italic">No profile yet. The agent will collect this in conversation.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {profile.location && (
                    <ProfileItem icon={<MapPin className="w-3 h-3" />} label="Location" value={profile.location} />
                  )}
                  {profile.farmSizeDecimal && (
                    <ProfileItem label="Farm size" value={`${profile.farmSizeDecimal} decimal`} />
                  )}
                  {profile.soilType && (
                    <ProfileItem label="Soil" value={profile.soilType} />
                  )}
                  {profile.waterSource && (
                    <ProfileItem label="Water" value={profile.waterSource} />
                  )}
                  {profile.budgetBdt && (
                    <ProfileItem label="Budget" value={`৳${profile.budgetBdt.toLocaleString()}`} />
                  )}
                  {profile.targetSeason && (
                    <ProfileItem label="Season" value={profile.targetSeason.toUpperCase()} />
                  )}
                  {profile.chosenCrop && (
                    <ProfileItem label="Chosen crop" value={profile.chosenCrop} />
                  )}
                  {profile.sowingDate && (
                    <ProfileItem label="Sowing date" value={profile.sowingDate} />
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tabbed visualization panel */}
          <Card className="flex-1 flex flex-col min-h-[500px]">
            <CardHeader className="pb-2">
              <Tabs value={activeRightTab} onValueChange={setActiveRightTab}>
                <TabsList className="grid grid-cols-7 h-auto w-full">
                  <TabsTrigger value="crops" className="text-xs gap-1">
                    <Sprout className="w-3 h-3" /> Crops
                    {latestCrops && <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1">{latestCrops.length}</Badge>}
                  </TabsTrigger>
                  <TabsTrigger value="calendar" className="text-xs gap-1">
                    <CalendarDays className="w-3 h-3" /> Calendar
                    {latestCalendar && <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1">{latestCalendar.events.length}</Badge>}
                  </TabsTrigger>
                  <TabsTrigger value="financials" className="text-xs gap-1">
                    <Calculator className="w-3 h-3" /> Financials
                    {latestFinancials && <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1">✓</Badge>}
                  </TabsTrigger>
                  <TabsTrigger value="scenario" className="text-xs gap-1 text-emerald-600 font-medium">
                    <TrendingUp className="w-3 h-3 text-emerald-600" /> Scenario Simulator
                    <Badge className="bg-emerald-500 text-white text-[9px] px-1 py-0 ml-1">Tier 1</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="marketplace" className="text-xs gap-1 text-violet-700">
                    <ShoppingCart className="w-3 h-3" /> Suppliers
                    {latestSuppliers && <Badge className="bg-violet-600 text-white text-[9px] px-1 py-0">T2</Badge>}
                  </TabsTrigger>
                  <TabsTrigger value="market" className="text-xs gap-1 text-cyan-700">
                    <BarChart3 className="w-3 h-3" /> Market
                    {latestMarket && <Badge className="bg-cyan-600 text-white text-[9px] px-1 py-0">T2</Badge>}
                  </TabsTrigger>
                  <TabsTrigger value="trace" className="text-xs gap-1">
                    <Activity className="w-3 h-3" /> Trace
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1">{allTraces.length}</Badge>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden">
              <Tabs value={activeRightTab} onValueChange={setActiveRightTab} className="h-full">
                {/* CROPS TAB */}
                <TabsContent value="crops" className="mt-0 h-full">
                  <ScrollArea className="h-[600px] pr-2">
                    {!latestCrops ? (
                      <EmptyState
                        icon={<Sprout className="w-8 h-8 text-stone-300" />}
                        title="No crop recommendations yet"
                        hint="The agent will rank 3+ candidate crops here once it calls recommend_crops. Each card shows suitability score, water need, risk level, and profit estimate."
                      />
                    ) : (
                      <div className="space-y-3">
                        <div className="text-xs text-stone-500 italic px-1">
                          <ListChecks className="w-3 h-3 inline mr-1" />
                          {latestCrops.length} candidate crops ranked by soil fit, water match, budget, ROI, and risk. Grounded in retrieved KB facts.
                        </div>
                        {latestCrops.map((rec) => (
                          <CropCard key={rec.cropId} rec={rec} />
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>

                {/* CALENDAR TAB */}
                <TabsContent value="calendar" className="mt-0 h-full">
                  <ScrollArea className="h-[600px] pr-2">
                    {!latestCalendar ? (
                      <EmptyState
                        icon={<CalendarDays className="w-8 h-8 text-stone-300" />}
                        title="No season calendar yet"
                        hint="Once a crop is chosen, the agent will produce a dated calendar from land preparation to harvest, with weather-aware advisories for fertilizer timing and irrigation."
                      />
                    ) : (
                      <CalendarView calendar={latestCalendar} />
                    )}
                  </ScrollArea>
                </TabsContent>

                {/* FINANCIALS TAB */}
                <TabsContent value="financials" className="mt-0 h-full">
                  <ScrollArea className="h-[600px] pr-2">
                    {!latestFinancials ? (
                      <EmptyState
                        icon={<Calculator className="w-8 h-8 text-stone-300" />}
                        title="No financial projection yet"
                        hint="The agent will compute an itemized cost breakdown (fertilizer, seed, labour, irrigation, land prep, pest mgmt), revenue, net profit, ROI, and break-even — all inspectable."
                      />
                    ) : (
                      <FinancialsView financials={latestFinancials} />
                    )}
                  </ScrollArea>
                </TabsContent>

                {/* SCENARIO SIMULATOR TAB */}
                <TabsContent value="scenario" className="mt-0 h-full">
                  <ScrollArea className="h-[600px] pr-2">
                    <ScenarioSimulator />
                  </ScrollArea>
                </TabsContent>

                {/* TIER 2 MARKETPLACE TAB */}
                <TabsContent value="marketplace" className="mt-0 h-full">
                  <ScrollArea className="h-[600px] pr-2">
                    {!latestSuppliers ? (
                      <EmptyState
                        icon={<ShoppingCart className="w-8 h-8 text-stone-300" />}
                        title="No supplier comparison yet"
                        hint="Ask the agent where to buy your planned seed or fertilizer. It will calculate packages, check mock stock, include delivery, and rank suppliers with inspectable weights."
                      />
                    ) : <SupplierComparisonView result={latestSuppliers} />}
                  </ScrollArea>
                </TabsContent>

                {/* TIER 2 MARKET INTELLIGENCE TAB */}
                <TabsContent value="market" className="mt-0 h-full">
                  <ScrollArea className="h-[600px] pr-2">
                    {!latestMarket ? (
                      <EmptyState
                        icon={<BarChart3 className="w-8 h-8 text-stone-300" />}
                        title="No market intelligence yet"
                        hint="Ask whether to sell, store, or wait. The agent will retrieve official DAM current/history data and request any unit, market, or storage assumptions still missing."
                      />
                    ) : <MarketIntelligenceView result={latestMarket} />}
                  </ScrollArea>
                </TabsContent>

                {/* TRACE TAB */}
                <TabsContent value="trace" className="mt-0 h-full">
                  <ScrollArea className="h-[600px] pr-2">
                    {allTraces.length === 0 ? (
                      <EmptyState
                        icon={<Wrench className="w-8 h-8 text-stone-300" />}
                        title="No tool calls yet"
                        hint="Every tool call will appear here with parameters and raw return values — visible proof the agent uses real APIs."
                      />
                    ) : (
                      <div className="space-y-3">
                        {allTraces.map((t, i) => (
                          <TraceItem key={i} trace={t} />
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t bg-white/60 py-3">
        <div className="max-w-[1800px] mx-auto px-4 text-center text-xs text-stone-500">
          Real weather via Open-Meteo · Official DAM market data · Mock supplier marketplace · 1000+ verified facts from BARI · BWMRI · BRRI · FAO · Built for Bdapps Agentic AI Hackathon
        </div>
      </footer>
    </div>
  );
}

// ---------- Sub-components ----------

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="text-center py-8 text-stone-400 text-sm">
      <div className="flex justify-center mb-3">{icon}</div>
      <p className="font-medium text-stone-600">{title}</p>
      <p className="text-xs mt-2 max-w-xs mx-auto leading-relaxed">{hint}</p>
    </div>
  );
}

function ProfileItem({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 p-2 bg-stone-50 rounded-md border border-stone-100">
      <span className="text-stone-500 text-[10px] uppercase tracking-wide flex items-center gap-1">
        {icon}{label}
      </span>
      <span className="font-medium text-stone-800 capitalize">{value}</span>
    </div>
  );
}

// ---------- Crop Card ----------

function CropCard({ rec }: { rec: CropRec }) {
  const [showEvidence, setShowEvidence] = useState(false);
  const isTop = rec.rank === 1;

  return (
    <div className={`border rounded-lg p-3 bg-white transition ${isTop ? 'border-green-400 ring-1 ring-green-200 shadow-sm' : 'border-stone-200'}`}>
      {/* Header: rank + name + suitability */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
            isTop ? 'bg-green-600 text-white' : 'bg-stone-200 text-stone-700'
          }`}>
            {isTop ? <Trophy className="w-4 h-4" /> : rec.rank}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-stone-800 text-sm truncate">{rec.cropName}</div>
            <div className="text-xs text-stone-500">{rec.bnName}</div>
          </div>
        </div>
        {isTop && (
          <Badge className="bg-green-100 text-green-700 border-green-300 text-[10px] shrink-0">
            <Trophy className="w-2.5 h-2.5 mr-0.5" /> Top pick
          </Badge>
        )}
      </div>

      {/* Suitability score bar */}
      <div className="mb-2">
        <div className="flex items-center justify-between text-[10px] text-stone-500 mb-1">
          <span className="flex items-center gap-1"><Target className="w-2.5 h-2.5" /> Suitability score</span>
          <span className="font-bold text-stone-700">{rec.suitabilityScore}/100</span>
        </div>
        <Progress value={rec.suitabilityScore} className="h-2" />
      </div>

      {/* Three badges: water need, risk, ROI */}
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <div className={`p-1.5 rounded border text-center ${WATER_COLORS[rec.waterNeed]}`}>
          <Droplets className="w-3 h-3 mx-auto mb-0.5" />
          <div className="text-[9px] uppercase font-semibold">Water</div>
          <div className="text-[10px] font-bold capitalize">{rec.waterNeed}</div>
        </div>
        <div className={`p-1.5 rounded border text-center ${RISK_COLORS[rec.riskLevel]}`}>
          <AlertTriangle className="w-3 h-3 mx-auto mb-0.5" />
          <div className="text-[9px] uppercase font-semibold">Risk</div>
          <div className="text-[10px] font-bold capitalize">{rec.riskLevel}</div>
        </div>
        <div className="p-1.5 rounded border text-center bg-emerald-50 border-emerald-300 text-emerald-700">
          <TrendingUp className="w-3 h-3 mx-auto mb-0.5" />
          <div className="text-[9px] uppercase font-semibold">ROI</div>
          <div className="text-[10px] font-bold">{rec.roiPercent}%</div>
        </div>
      </div>

      {/* Profit estimate (per acre) */}
      <div className="grid grid-cols-2 gap-2 text-xs mb-2">
        <div className="p-1.5 bg-stone-50 rounded">
          <div className="text-[9px] text-stone-500 uppercase">Revenue/acre</div>
          <div className="font-semibold text-stone-700">৳{rec.estimatedRevenueBdt.toLocaleString()}</div>
        </div>
        <div className="p-1.5 bg-stone-50 rounded">
          <div className="text-[9px] text-stone-500 uppercase">Cost/acre</div>
          <div className="font-semibold text-stone-700">৳{rec.estimatedCostBdt.toLocaleString()}</div>
        </div>
        <div className="p-1.5 bg-green-50 rounded col-span-2">
          <div className="text-[9px] text-green-700 uppercase font-semibold">Estimated profit / acre</div>
          <div className="font-bold text-green-700 text-sm">৳{rec.estimatedProfitBdt.toLocaleString()}</div>
        </div>
      </div>

      {/* Rationale (top 2 reasons) */}
      {rec.rationale && rec.rationale.length > 0 && (
        <div className="text-[11px] text-stone-600 bg-stone-50 rounded p-2 mb-2">
          <div className="font-semibold text-stone-700 mb-1 flex items-center gap-1">
            <Sparkles className="w-2.5 h-2.5" /> Why this crop:
          </div>
          <ul className="space-y-0.5 list-disc list-inside">
            {rec.rationale.slice(0, 3).map((r, i) => (
              <li key={i} className="leading-snug">{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* KB evidence (collapsible) */}
      {rec.kbEvidence && rec.kbEvidence.length > 0 && (
        <Collapsible open={showEvidence} onOpenChange={setShowEvidence}>
          <CollapsibleTrigger className="text-[10px] text-purple-700 hover:text-purple-900 flex items-center gap-1 w-full">
            <ChevronRight className={`w-2.5 h-2.5 transition-transform ${showEvidence ? 'rotate-90' : ''}`} />
            {showEvidence ? 'Hide' : 'Show'} KB evidence ({rec.kbEvidence.length} citations)
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
              {rec.kbEvidence.map((e, i) => (
                <div key={i} className="text-[10px] text-stone-600 bg-purple-50 border border-purple-100 rounded p-1.5">
                  {e}
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// ---------- Calendar View ----------

function CalendarView({ calendar }: { calendar: CalendarResult }) {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-stone-500 uppercase font-semibold flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Season Calendar
            </div>
            <div className="font-bold text-stone-800 text-base">{calendar.cropName}</div>
          </div>
          <div className="text-right text-xs">
            <div className="text-stone-500">Sowing → Harvest</div>
            <div className="font-semibold text-stone-700">{calendar.sowingDate} → {calendar.harvestDate}</div>
            <div className="text-stone-500">{calendar.totalDays} days total</div>
          </div>
        </div>
      </div>

      {/* Weather advisories */}
      {calendar.weatherAdvisories && calendar.weatherAdvisories.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
          <div className="text-[10px] font-semibold uppercase text-amber-800 mb-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Weather Advisories ({calendar.weatherAdvisories.length})
          </div>
          <ul className="space-y-0.5">
            {calendar.weatherAdvisories.map((a, i) => (
              <li key={i} className="text-[11px] text-amber-800 leading-snug">• {a}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-2">
        <div className="text-[10px] font-semibold uppercase text-stone-500 flex items-center gap-1">
          <CalendarDays className="w-3 h-3" /> Timeline ({calendar.events.length} events)
        </div>
        {calendar.events.map((ev, i) => (
          <div key={i} className="flex gap-2">
            {/* Date column */}
            <div className="shrink-0 w-20 text-right">
              <div className="text-[10px] text-stone-500">Day {ev.day}</div>
              <div className="text-xs font-semibold text-stone-700">{ev.date}</div>
            </div>
            {/* Vertical line + dot */}
            <div className="flex flex-col items-center">
              <div className={`w-2.5 h-2.5 rounded-full mt-1.5 ${ev.advisory ? 'bg-amber-500' : 'bg-green-600'}`} />
              {i < calendar.events.length - 1 && <div className="w-px flex-1 bg-stone-200" />}
            </div>
            {/* Content */}
            <div className="flex-1 pb-2 min-w-0">
              <div className="border border-stone-200 rounded p-2 bg-white">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Badge variant="outline" className="text-[9px] px-1 py-0 bg-rose-50 border-rose-200 text-rose-700">
                    {ev.stage}
                  </Badge>
                  {ev.advisory && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 bg-amber-50 border-amber-300 text-amber-700">
                      <AlertTriangle className="w-2 h-2 mr-0.5" /> advisory
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-stone-700">{ev.action}</div>
                {ev.advisory && (
                  <div className="text-[11px] text-amber-800 mt-1 leading-snug bg-amber-50 p-1.5 rounded">
                    {ev.advisory}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Financials View ----------

function FinancialsView({ financials }: { financials: FinancialResult }) {
  const f = financials.perAcre;
  const t = financials.totals;
  const profitColor = t.totalProfit >= 0 ? 'text-green-700' : 'text-red-700';

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-stone-500 uppercase font-semibold flex items-center gap-1">
              <Coins className="w-3 h-3" /> Financial Projection
            </div>
            <div className="font-bold text-stone-800 text-base">{financials.cropName}</div>
            <div className="text-xs text-stone-500">{financials.farmSizeDecimal} decimal ({financials.farmSizeAcre} acre)</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-stone-500 uppercase font-semibold">Net profit (farm total)</div>
            <div className={`font-bold text-lg ${profitColor}`}>
              {t.totalProfit >= 0 ? '+' : ''}৳{t.totalProfit.toLocaleString()}
            </div>
            <div className="text-xs text-stone-500">ROI: <span className="font-bold">{f.roiPercent}%</span></div>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="p-2 bg-red-50 border border-red-200 rounded">
          <div className="text-[9px] text-red-700 uppercase font-semibold">Total cost</div>
          <div className="font-bold text-red-700">৳{t.totalCost.toLocaleString()}</div>
          <div className="text-[10px] text-stone-500">৳{f.totalCostPerAcre.toLocaleString()}/acre</div>
        </div>
        <div className="p-2 bg-green-50 border border-green-200 rounded">
          <div className="text-[9px] text-green-700 uppercase font-semibold">Revenue</div>
          <div className="font-bold text-green-700">৳{t.totalRevenue.toLocaleString()}</div>
          <div className="text-[10px] text-stone-500">৳{f.revenuePerAcre.toLocaleString()}/acre</div>
        </div>
        <div className="p-2 bg-emerald-50 border border-emerald-200 rounded">
          <div className="text-[9px] text-emerald-700 uppercase font-semibold">ROI</div>
          <div className="font-bold text-emerald-700">{f.roiPercent}%</div>
          <div className="text-[10px] text-stone-500">{f.yieldPerAcre} {financials.cropName?.toLowerCase().includes('rice') || financials.cropName?.toLowerCase().includes('wheat') || financials.cropName?.toLowerCase().includes('mustard') ? 'maund' : 'maund'}/acre @ ৳{f.pricePerUnit}</div>
        </div>
      </div>

      {/* Break-even */}
      <div className="bg-stone-50 border border-stone-200 rounded p-2 text-xs">
        <div className="text-[10px] uppercase font-semibold text-stone-600 mb-1 flex items-center gap-1">
          <Target className="w-3 h-3" /> Break-even analysis
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-stone-500">Break-even price: </span>
            <span className="font-mono font-semibold text-stone-800">৳{f.breakEvenPricePerUnit}/maund</span>
          </div>
          <div>
            <span className="text-stone-500">Break-even yield: </span>
            <span className="font-mono font-semibold text-stone-800">{f.breakEvenYieldMaund} maund/acre</span>
          </div>
        </div>
      </div>

      {/* Line items table */}
      <div>
        <div className="text-[10px] font-semibold uppercase text-stone-500 mb-1 flex items-center gap-1">
          <ListChecks className="w-3 h-3" /> Itemized cost breakdown (per acre)
        </div>
        <div className="border border-stone-200 rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-stone-100">
              <tr>
                <th className="text-left p-1.5 font-semibold text-stone-600">Category</th>
                <th className="text-right p-1.5 font-semibold text-stone-600">Qty</th>
                <th className="text-right p-1.5 font-semibold text-stone-600">Rate (৳)</th>
                <th className="text-right p-1.5 font-semibold text-stone-600">Total (৳)</th>
              </tr>
            </thead>
            <tbody>
              {f.lineItems.map((li, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-stone-50/50'}>
                  <td className="p-1.5">
                    <div className="font-medium text-stone-700">{li.item}</div>
                    <div className="text-[10px] text-stone-500">{li.category}</div>
                  </td>
                  <td className="p-1.5 text-right font-mono text-stone-600">{li.quantityPerAcre} {li.unit}</td>
                  <td className="p-1.5 text-right font-mono text-stone-600">{li.rateBdt.toLocaleString()}</td>
                  <td className="p-1.5 text-right font-mono font-semibold text-stone-800">{li.totalBdt.toLocaleString()}</td>
                </tr>
              ))}
              <tr className="bg-stone-100 border-t-2 border-stone-300">
                <td className="p-1.5 font-bold text-stone-800" colSpan={3}>Total cost per acre</td>
                <td className="p-1.5 text-right font-mono font-bold text-stone-800">৳{f.totalCostPerAcre.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Scenario notes */}
      {financials.scenarioNotes && financials.scenarioNotes.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs">
          <div className="text-[10px] uppercase font-semibold text-blue-700 mb-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Scenario notes
          </div>
          <ul className="space-y-0.5">
            {financials.scenarioNotes.map((n, i) => (
              <li key={i} className="text-blue-800 leading-snug">• {n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------- Tier 2 Views ----------

function SupplierComparisonView({ result }: { result: any }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
        <div className="flex items-center gap-2 font-semibold text-violet-900">
          <ShoppingCart className="h-4 w-4" /> Supplier comparison
          <Badge className="ml-auto bg-violet-600">Tier 2 · Mock</Badge>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-violet-800">{result.disclaimer}</p>
      </div>
      {result.comparisons.map((comparison: any, comparisonIndex: number) => (
        <div key={comparisonIndex} className="rounded-lg border border-stone-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="font-semibold text-stone-800">{comparison.need.productName}</div>
              <div className="text-xs text-stone-500">Need: {comparison.need.quantity} {comparison.need.unit}</div>
            </div>
            <Badge variant="outline">{comparison.eligibleInStockOffers} in stock</Badge>
          </div>
          {comparison.missingReason ? (
            <div className="rounded bg-amber-50 p-2 text-xs text-amber-800">{comparison.missingReason}</div>
          ) : (
            <div className="space-y-2">
              {comparison.rankedSuppliers.map((supplier: any) => (
                <div key={supplier.supplierId} className="rounded border border-stone-200 p-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="mr-1 font-bold text-violet-700">#{supplier.rank}</span>
                      <span className="font-semibold text-stone-800">{supplier.supplierName}</span>
                      <div className="text-[10px] text-stone-500">{supplier.marketName}, {supplier.district}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-stone-900">৳{supplier.deliveredCostBdt.toLocaleString()}</div>
                      <div className="text-[10px] text-violet-700">score {supplier.score}/100</div>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-stone-600">
                    <span>{supplier.packagesNeeded} × {supplier.packageSize}{supplier.packageUnit}</span>
                    <span>Delivery: {supplier.deliveryDays}d</span>
                    <span>Rating: {supplier.rating}/5</span>
                    <span>Goods: ৳{supplier.productCostBdt.toLocaleString()}</span>
                    <span>Delivery: ৳{supplier.deliveryChargeBdt.toLocaleString()}</span>
                    <span>Distance proxy: {supplier.distanceProxyKm}km</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function MarketIntelligenceView({ result }: { result: any }) {
  const current = result.currentOfficialTicker?.match;
  const history = result.historicalOfficialSeries;
  const recommendationColor = result.recommendation === 'sell_now'
    ? 'bg-emerald-600' : result.recommendation === 'store_or_wait' ? 'bg-blue-600' : 'bg-amber-600';
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-cyan-800" />
          <div className="font-semibold text-cyan-950">{result.commodityRequested} market intelligence</div>
          <Badge className={`ml-auto ${recommendationColor}`}>{String(result.recommendation).replaceAll('_', ' ').toUpperCase()}</Badge>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-cyan-900">{result.explanation}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded border border-stone-200 bg-white p-2">
          <div className="text-[10px] font-semibold uppercase text-stone-500">Live DAM ticker</div>
          {current ? <>
            <div className="font-semibold text-stone-800">{current.commodity}</div>
            <div className="text-lg font-bold text-cyan-700">৳{current.minimum}–{current.maximum}</div>
          </> : <div className="mt-1 text-amber-700">No unambiguous ticker match</div>}
          <div className="mt-1 text-[10px] text-amber-700">Unit/market scope unresolved—display only.</div>
        </div>
        <div className="rounded border border-stone-200 bg-white p-2">
          <div className="text-[10px] font-semibold uppercase text-stone-500">Official history</div>
          <div className="font-semibold text-stone-800">{history.selectedCommodity?.text || 'Needs commodity clarification'}</div>
          <div className="text-stone-600">{history.year || '—'} · {result.priceType} · {history.unit || 'unit unavailable'}</div>
          <div className="mt-1 text-[10px] text-stone-500">{history.observations.length} monthly observations</div>
        </div>
      </div>

      {history.observations.length > 0 && (
        <div className="rounded border border-stone-200 bg-white p-2">
          <div className="mb-2 text-[10px] font-semibold uppercase text-stone-500">Historical monthly prices</div>
          <div className="grid grid-cols-4 gap-1">
            {history.observations.map((point: any, index: number) => (
              <div key={index} className="rounded bg-cyan-50 px-2 py-1 text-center text-xs">
                <div className="text-[10px] text-stone-500">{point.label}</div>
                <div className="font-semibold text-cyan-800">{point.y}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.missingForDecision?.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <div className="font-semibold">Needed before sell/store decision:</div>
          <ul className="mt-1 list-disc pl-4">
            {result.missingForDecision.map((field: string) => <li key={field}>{field}</li>)}
          </ul>
        </div>
      )}

      {result.decisionMath && (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
          Current net: <strong>৳{result.decisionMath.currentNetPrice}</strong> · Wait net: <strong>৳{result.decisionMath.expectedNetPriceAfterWaiting}</strong> · Difference: <strong>৳{result.decisionMath.differencePerUnit}</strong>/{result.decisionMath.inputs.currentUnit || 'unit'}
        </div>
      )}
    </div>
  );
}

// ---------- Trace Item ----------

function TraceItem({ trace }: { trace: ToolTrace }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[trace.toolName] || Wrench;
  const colorClass = TOOL_COLORS[trace.toolName] || 'bg-slate-100 text-slate-700 border-slate-200';
  const ts = trace.timestamp || trace.at || new Date().toISOString();

  return (
    <div className="border border-stone-200 rounded-lg overflow-hidden bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-stone-50 transition"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-7 h-7 rounded-md flex items-center justify-center border ${colorClass}`}>
            <Icon className="w-3.5 h-3.5" />
          </div>
          <div className="text-left min-w-0">
            <div className="font-mono text-xs font-semibold text-stone-800 truncate">{trace.toolName}</div>
            <div className="text-[10px] text-stone-500">{new Date(ts).toLocaleTimeString()} · {trace.durationMs}ms</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {trace.toolResult?.error ? (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">ERROR</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-green-50 border-green-200 text-green-700">OK</Badge>
          )}
          <ChevronRight className={`w-3.5 h-3.5 text-stone-400 transition-transform ${open ? 'rotate-90' : ''}`} />
        </div>
      </button>
      <Collapsible open={open}>
        <CollapsibleContent>
          <div className="border-t border-stone-100 p-3 space-y-2 bg-stone-50/50">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 mb-1">Parameters</div>
              <pre className="text-[11px] font-mono bg-white border border-stone-200 rounded p-2 overflow-x-auto text-stone-700 max-h-40 overflow-y-auto">
                {JSON.stringify(trace.toolArgs, null, 2)}
              </pre>
            </div>

            {/* rag_search results */}
            {trace.toolResult?.rawChunks && Array.isArray(trace.toolResult.rawChunks) && trace.toolResult.rawChunks.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 mb-1">
                  Retrieved facts ({trace.toolResult.rawChunks.length})
                </div>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {trace.toolResult.rawChunks.map((chunk: any, i: number) => (
                    <div key={i} className="text-[11px] bg-white border border-stone-200 rounded p-2">
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <Badge variant="outline" className="text-[9px] px-1 py-0 bg-purple-50 border-purple-200 text-purple-700">
                          score={chunk.score}
                        </Badge>
                        {chunk.crop && <span className="text-[10px] font-semibold text-stone-700">{chunk.crop}</span>}
                        {chunk.category && <span className="text-[10px] text-stone-500">· {chunk.category}</span>}
                      </div>
                      <div className="text-stone-700 leading-relaxed mb-1">{chunk.text}</div>
                      <div className="text-[10px] text-stone-500 flex items-center gap-1 flex-wrap">
                        <span className="font-medium">Source:</span>
                        <span className="truncate">{chunk.source}</span>
                        {chunk.sourceUrl && (
                          <a href={chunk.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:text-emerald-900 underline truncate max-w-[200px] inline-flex items-center gap-0.5">
                            <ExternalLink className="w-2.5 h-2.5" /> {chunk.sourceUrl.replace(/^https?:\/\//, '').slice(0, 35)}
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* get_kb_facts_by_crop results */}
            {trace.toolResult?.facts && Array.isArray(trace.toolResult.facts) && trace.toolResult.facts.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 mb-1">
                  Verified facts ({trace.toolResult.facts.length} of {trace.toolResult.totalMatches} matches)
                </div>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {trace.toolResult.facts.map((fact: any, i: number) => (
                    <div key={i} className="text-[11px] bg-white border border-stone-200 rounded p-2">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-mono text-[10px] text-stone-500">{fact.id}</span>
                        {fact.category && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 bg-emerald-50 border-emerald-200 text-emerald-700">{fact.category}</Badge>
                        )}
                      </div>
                      <div className="text-stone-800 font-medium">{fact.factName}</div>
                      {fact.value && (
                        <div className="text-stone-700">
                          <span className="font-mono">{fact.value}</span>
                          {fact.unit && <span className="text-stone-500"> {fact.unit}</span>}
                        </div>
                      )}
                      {fact.context && <div className="text-stone-500 italic">{fact.context}</div>}
                      <div className="text-[10px] text-stone-500 flex items-center gap-1 mt-1 flex-wrap">
                        <span className="font-medium">{fact.source}</span>
                        {fact.sourceUrl && (
                          <a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-700 hover:text-emerald-900 underline inline-flex items-center gap-0.5">
                            <ExternalLink className="w-2.5 h-2.5" /> source
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 mb-1">Raw return value</div>
              <pre className="text-[11px] font-mono bg-white border border-stone-200 rounded p-2 overflow-x-auto text-stone-700 max-h-72 overflow-y-auto">
                {JSON.stringify(trace.toolResult, null, 2)}
              </pre>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
