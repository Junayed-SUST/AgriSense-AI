'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Sprout, Cloud, Calculator, CalendarDays, Search, Database, Loader2, ChevronRight, Activity, MapPin, User, Send, RefreshCw, Wrench } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

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

const TOOL_ICONS: Record<string, any> = {
  get_weather: Cloud,
  rag_search: Search,
  recommend_crops: Sprout,
  compute_financials: Calculator,
  get_crop_calendar: CalendarDays,
  save_profile: Database,
};

const TOOL_COLORS: Record<string, string> = {
  get_weather: 'bg-sky-100 text-sky-700 border-sky-200',
  rag_search: 'bg-purple-100 text-purple-700 border-purple-200',
  recommend_crops: 'bg-green-100 text-green-700 border-green-200',
  compute_financials: 'bg-amber-100 text-amber-700 border-amber-200',
  get_crop_calendar: 'bg-rose-100 text-rose-700 border-rose-200',
  save_profile: 'bg-slate-100 text-slate-700 border-slate-200',
};

function newSessionId(): string {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function Home() {
  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<FarmerProfile | null>(null);
  const [allTraces, setAllTraces] = useState<ToolTrace[]>([]);
  const [activeTraceTab, setActiveTraceTab] = useState<'current' | 'all'>('current');
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
    (async () => {
      try {
        const res = await fetch(`/api/profile?sessionId=${encodeURIComponent(sessionId)}`);
        const data = await res.json();
        if (data.profile) {
          setProfile(data.profile);
          const convos = (data.conversations || []).map((c: any) => ({ role: c.role, content: c.content }));
          setMessages(convos);
        }
        const tres = await fetch(`/api/trace?sessionId=${encodeURIComponent(sessionId)}`);
        const tdata = await tres.json();
        setAllTraces(tdata.trace || []);
      } catch (err) {
        console.error('Failed to load session:', err);
      }
    })();
  }, [sessionId]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

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
      setAllTraces(prev => [...prev, ...(data.trace || [])]);

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
  };

  // Get the most recent message's trace for the "current" tab
  const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
  const currentTrace = lastAssistantMsg?.trace || [];
  const displayedTrace = activeTraceTab === 'current' ? currentTrace : allTraces;

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
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-amber-50 border-amber-300 text-amber-800">Tier 0 — Core Build</Badge>
            <Badge variant="outline" className="bg-emerald-50 border-emerald-300 text-emerald-800">1000+ verified facts (BARI · BWMRI · BRRI · FAO)</Badge>
            <Button variant="outline" size="sm" onClick={startNewSession}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              New Farmer
            </Button>
          </div>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex-1 max-w-[1600px] mx-auto w-full px-4 py-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Chat */}
        <div className="lg:col-span-7 flex flex-col">
          <Card className="flex-1 flex flex-col min-h-[600px]">
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
                      <p className="text-sm mt-1">Tell me about your farm — location, size, soil, water, budget, season — and I&apos;ll build you a costed, weather-aware plan.</p>
                      <div className="mt-4 text-xs text-stone-400">
                        Try: <em>&quot;I have 50 decimal in Jashore, loamy soil, tubewell water, want to grow something this Rabi season with 20000 taka budget&quot;</em>
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

        {/* Right: Profile + Trace */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Farmer profile card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-stone-800">
                <User className="w-4 h-4 text-green-700" />
                Farmer Profile (Memory)
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

          {/* Visible Agent Trace panel */}
          <Card className="flex-1 flex flex-col min-h-[400px]">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2 text-stone-800">
                  <Activity className="w-4 h-4 text-green-700" />
                  Visible Agent Trace
                </CardTitle>
                <Tabs value={activeTraceTab} onValueChange={(v) => setActiveTraceTab(v as 'current' | 'all')}>
                  <TabsList className="h-7">
                    <TabsTrigger value="current" className="text-xs px-2 py-0.5">Latest</TabsTrigger>
                    <TabsTrigger value="all" className="text-xs px-2 py-0.5">All ({allTraces.length})</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden">
              <ScrollArea className="h-[500px] pr-2">
                {displayedTrace.length === 0 ? (
                  <div className="text-center py-8 text-stone-400 text-sm">
                    <Wrench className="w-8 h-8 mx-auto mb-2 text-stone-300" />
                    <p>No tool calls yet.</p>
                    <p className="text-xs mt-1">Every tool call will appear here with parameters and raw return values — visible proof the agent uses real APIs.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {displayedTrace.map((t, i) => (
                      <TraceItem key={i} trace={t} />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t bg-white/60 py-3">
        <div className="max-w-[1600px] mx-auto px-4 text-center text-xs text-stone-500">
          Real weather via Open-Meteo · 1000+ verified facts from BARI · BWMRI · BRRI · FAO · LLM via OpenAI GPT-4o · Built for Bdapps Agentic AI Hackathon
        </div>
      </footer>
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

            {/* If this is a rag_search result, show retrieved chunks with source citations */}
            {trace.toolResult?.rawChunks && Array.isArray(trace.toolResult.rawChunks) && trace.toolResult.rawChunks.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 mb-1">
                  Retrieved facts ({trace.toolResult.rawChunks.length})
                </div>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {trace.toolResult.rawChunks.map((chunk: any, i: number) => (
                    <div key={i} className="text-[11px] bg-white border border-stone-200 rounded p-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Badge variant="outline" className="text-[9px] px-1 py-0 bg-purple-50 border-purple-200 text-purple-700">
                          score={chunk.score}
                        </Badge>
                        {chunk.crop && (
                          <span className="text-[10px] font-semibold text-stone-700">{chunk.crop}</span>
                        )}
                        {chunk.category && (
                          <span className="text-[10px] text-stone-500">· {chunk.category}</span>
                        )}
                      </div>
                      <div className="text-stone-700 leading-relaxed mb-1">{chunk.text}</div>
                      <div className="text-[10px] text-stone-500 flex items-center gap-1 flex-wrap">
                        <span className="font-medium">Source:</span>
                        <span className="truncate">{chunk.source}</span>
                        {chunk.sourceUrl && (
                          <a
                            href={chunk.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-700 hover:text-emerald-900 underline truncate max-w-[200px]"
                          >
                            ↗ {chunk.sourceUrl.replace(/^https?:\/\//, '').slice(0, 40)}
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* If this is a get_kb_facts_by_crop result, show the facts list */}
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
                          <Badge variant="outline" className="text-[9px] px-1 py-0 bg-emerald-50 border-emerald-200 text-emerald-700">
                            {fact.category}
                          </Badge>
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
                          <a
                            href={fact.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-700 hover:text-emerald-900 underline truncate max-w-[200px]"
                          >
                            ↗ source
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
