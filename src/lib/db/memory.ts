import { db as prisma } from '@/lib/db';

// Memory store — in-memory fallback for Vercel serverless where DATABASE_URL
// is not configured (SQLite is not viable in serverless because the
// filesystem is ephemeral). The fallback mirrors the subset of Prisma
// operations used by the chat/trace/profile routes and degrades gracefully —
// data is lost on cold starts but the agent, tools, and demo flow still work.

type FarmerRow = {
  id: string;
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
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
};

type ConversationRow = {
  id: string;
  farmerId: string;
  role: string;
  content: string;
  createdAt: Date;
  [key: string]: unknown;
};

type TraceRow = {
  id: string;
  farmerId: string;
  toolName: string;
  toolArgs: string;
  toolResult: string;
  durationMs: number;
  createdAt: Date;
  [key: string]: unknown;
};

type AnyArgs = Record<string, unknown>;
type AnyResult = unknown;

interface ModelOps {
  [method: string]: (...args: unknown[]) => Promise<AnyResult>;
}

interface MemoryDb {
  farmer: ModelOps;
  conversation: ModelOps;
  trace: ModelOps;
  traceEntry: ModelOps;
  $transaction: <T extends unknown[]>(ops: T) => Promise<T>;
  readonly backend: 'prisma' | 'memory';
}

function createMemoryBackend(): MemoryDb {
  const farmers = new Map<string, FarmerRow>(); // by sessionId
  const farmersById = new Map<string, FarmerRow>(); // by id
  const conversations: ConversationRow[] = [];
  const traces: TraceRow[] = [];
  const seasonPlans: Array<Record<string, unknown> & { id: string; farmerId: string }> = [];
  let counter = 0;
  const newId = () => `mem_${Date.now().toString(36)}_${(counter++).toString(36)}`;

  function getArg(args: unknown[]): AnyArgs {
    return (args[0] as AnyArgs) ?? {};
  }

  function applyInclude(target: FarmerRow, include: unknown): AnyResult {
    if (!include) return target;
    const result: Record<string, unknown> = { ...target };
    const inc = include as Record<string, unknown>;

    if (inc.seasonPlans) {
      const cfg = inc.seasonPlans as { orderBy?: Record<string, string>; take?: number };
      let sp = seasonPlans.filter((p) => p.farmerId === target.id);
      if (cfg?.orderBy) {
        const key = Object.keys(cfg.orderBy)[0];
        const dir = cfg.orderBy[key];
        sp = sp.slice().sort((a, b) => {
          const av = (a as Record<string, unknown>)[key];
          const bv = (b as Record<string, unknown>)[key];
          if (av === bv) return 0;
          const less = (av ?? '') < (bv ?? '');
          return dir === 'desc' ? (less ? 1 : -1) : less ? -1 : 1;
        });
      }
      if (cfg?.take) sp = sp.slice(0, cfg.take);
      result.seasonPlans = sp;
    }
    if (inc.conversations) {
      let cs = conversations.filter((c) => c.farmerId === target.id);
      const cfg = inc.conversations as { orderBy?: Record<string, string>; take?: number };
      if (cfg?.orderBy) {
        const key = Object.keys(cfg.orderBy)[0] as keyof ConversationRow;
        const dir = cfg.orderBy[key as string];
        cs = cs.slice().sort((a, b) => {
          if (a[key] === b[key]) return 0;
          const less = (a[key] ?? '') < (b[key] ?? '');
          return dir === 'desc' ? (less ? 1 : -1) : less ? -1 : 1;
        });
      }
      if (cfg?.take) cs = cs.slice(0, cfg.take);
      result.conversations = cs;
    }
    if (inc.traceEntries) {
      let ts = traces.filter((t) => t.farmerId === target.id);
      const cfg = inc.traceEntries as { orderBy?: Record<string, string>; take?: number };
      if (cfg?.orderBy) {
        const key = Object.keys(cfg.orderBy)[0] as keyof TraceRow;
        const dir = cfg.orderBy[key as string];
        ts = ts.slice().sort((a, b) => {
          if (a[key] === b[key]) return 0;
          const less = (a[key] ?? '') < (b[key] ?? '');
          return dir === 'desc' ? (less ? 1 : -1) : less ? -1 : 1;
        });
      }
      if (cfg?.take) ts = ts.slice(0, cfg.take);
      result.traceEntries = ts;
    }
    return result;
  }

  // ---------- farmer ----------
  const farmerOps: ModelOps = {
    async upsert(...args: unknown[]): Promise<AnyResult> {
      const { where, update = {}, create = {} } = getArg(args);
      const sessionId = (where as { sessionId: string }).sessionId;
      const existing = farmers.get(sessionId);
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        farmersById.set(existing.id, existing);
        return existing;
      }
      const merged: FarmerRow = {
        id: newId(),
        sessionId,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(update as Partial<FarmerRow>),
        ...(create as Partial<FarmerRow>),
      };
      farmers.set(sessionId, merged);
      farmersById.set(merged.id, merged);
      return merged;
    },
    async update(...args: unknown[]): Promise<AnyResult> {
      const { where, data = {} } = getArg(args);
      const w = where as { id?: string; sessionId?: string };
      let target: FarmerRow | undefined;
      if (w.id) target = farmersById.get(w.id);
      if (!target && w.sessionId) target = farmers.get(w.sessionId);
      if (!target) {
        return {
          id: w.id ?? newId(),
          sessionId: w.sessionId ?? '',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(data as object),
        };
      }
      Object.assign(target, data, { updatedAt: new Date() });
      return target;
    },
    async create(...args: unknown[]): Promise<AnyResult> {
      const { data = {} } = getArg(args);
      const sessionId = (data as { sessionId?: string }).sessionId ?? newId();
      const merged: FarmerRow = {
        id: newId(),
        sessionId,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(data as Partial<FarmerRow>),
      };
      farmers.set(sessionId, merged);
      farmersById.set(merged.id, merged);
      return merged;
    },
    async findUnique(...args: unknown[]): Promise<AnyResult> {
      const { where, include } = getArg(args);
      const w = where as { id?: string; sessionId?: string };
      let target: FarmerRow | undefined;
      if (w.id) target = farmersById.get(w.id);
      if (!target && w.sessionId) target = farmers.get(w.sessionId);
      if (!target) return null;
      return applyInclude(target, include);
    },
    async findFirst(...args: unknown[]): Promise<AnyResult> {
      const { where, include } = getArg(args);
      const w = (where as { id?: string; sessionId?: string } | undefined) ?? {};
      let target: FarmerRow | undefined;
      if (w.id) target = farmersById.get(w.id);
      if (!target && w.sessionId) target = farmers.get(w.sessionId);
      if (!target && farmers.size > 0) target = farmers.values().next().value;
      if (!target) return null;
      return applyInclude(target, include);
    },
    async findMany(...args: unknown[]): Promise<AnyResult> {
      const { where, take, orderBy } = getArg(args);
      const w = where as { sessionId?: string; id?: { in?: string[] } } | undefined;
      let list = Array.from(farmers.values());
      if (w?.sessionId) list = list.filter((f) => f.sessionId === w.sessionId);
      if (w?.id?.in) list = list.filter((f) => w.id!.in!.includes(f.id));
      if (orderBy && typeof orderBy === 'object') {
        const key = Object.keys(orderBy)[0] as keyof FarmerRow;
        const dir = (orderBy as Record<string, 'asc' | 'desc'>)[key as string];
        list = list.slice().sort((a, b) => {
          const av = a[key] as unknown;
          const bv = b[key] as unknown;
          if (av === bv) return 0;
          const less = (av ?? '') < (bv ?? '');
          return dir === 'desc' ? (less ? 1 : -1) : less ? -1 : 1;
        });
      }
      if (typeof take === 'number') list = list.slice(0, take);
      return list;
    },
    async delete(...args: unknown[]): Promise<AnyResult> {
      const { where } = getArg(args);
      const w = where as { id?: string; sessionId?: string };
      let r: FarmerRow | undefined;
      if (w.id) r = farmersById.get(w.id);
      if (!r && w.sessionId) r = farmers.get(w.sessionId);
      if (r) {
        farmersById.delete(r.id);
        farmers.delete(r.sessionId);
      }
      return r ?? null;
    },
  };

  // ---------- conversation ----------
  const conversationOps: ModelOps = {
    async create(...args: unknown[]): Promise<AnyResult> {
      const { data = {} } = getArg(args);
      const r = {
        id: newId(),
        createdAt: new Date(),
        ...(data as Partial<ConversationRow>),
      } as ConversationRow;
      conversations.push(r);
      return r;
    },
    async findMany(...args: unknown[]): Promise<AnyResult> {
      const { where, orderBy, take } = getArg(args);
      const w = where as { farmerId?: string } | undefined;
      let result = w?.farmerId ? conversations.filter((c) => c.farmerId === w.farmerId) : conversations;
      if (orderBy && typeof orderBy === 'object') {
        const key = Object.keys(orderBy)[0] as keyof ConversationRow;
        const dir = (orderBy as Record<string, 'asc' | 'desc'>)[key as string];
        result = result.slice().sort((a, b) => {
          if (a[key] === b[key]) return 0;
          const less = (a[key] ?? '') < (b[key] ?? '');
          return dir === 'desc' ? (less ? 1 : -1) : less ? -1 : 1;
        });
      }
      if (typeof take === 'number') result = result.slice(0, take);
      return result;
    },
    async findFirst(...args: unknown[]): Promise<AnyResult> {
      const list = (await conversationOps.findMany(...args)) as ConversationRow[];
      return list[0] ?? null;
    },
    async findUnique(...args: unknown[]): Promise<AnyResult> {
      const { where } = getArg(args);
      const id = (where as { id: string }).id;
      return conversations.find((c) => c.id === id) ?? null;
    },
    async count(...args: unknown[]): Promise<AnyResult> {
      const { where } = getArg(args);
      const w = where as { farmerId?: string } | undefined;
      return w?.farmerId ? conversations.filter((c) => c.farmerId === w.farmerId).length : conversations.length;
    },
  };

  // ---------- trace (and traceEntry alias) ----------
  const traceOps: ModelOps = {
    async create(...args: unknown[]): Promise<AnyResult> {
      const { data = {} } = getArg(args);
      const r = {
        id: newId(),
        createdAt: new Date(),
        ...(data as Partial<TraceRow>),
      } as TraceRow;
      traces.push(r);
      return r;
    },
    async findMany(...args: unknown[]): Promise<AnyResult> {
      const { where, orderBy, take } = getArg(args);
      const w = where as { farmerId?: string } | undefined;
      let result = w?.farmerId ? traces.filter((t) => t.farmerId === w.farmerId) : traces;
      if (orderBy && typeof orderBy === 'object') {
        const key = Object.keys(orderBy)[0] as keyof TraceRow;
        const dir = (orderBy as Record<string, 'asc' | 'desc'>)[key as string];
        result = result.slice().sort((a, b) => {
          if (a[key] === b[key]) return 0;
          const less = (a[key] ?? '') < (b[key] ?? '');
          return dir === 'desc' ? (less ? 1 : -1) : less ? -1 : 1;
        });
      }
      if (typeof take === 'number') result = result.slice(0, take);
      return result;
    },
    async findFirst(...args: unknown[]): Promise<AnyResult> {
      const list = (await traceOps.findMany(...args)) as TraceRow[];
      return list[0] ?? null;
    },
    async findUnique(...args: unknown[]): Promise<AnyResult> {
      const { where } = getArg(args);
      const id = (where as { id: string }).id;
      return traces.find((t) => t.id === id) ?? null;
    },
    async count(...args: unknown[]): Promise<AnyResult> {
      const { where } = getArg(args);
      const w = where as { farmerId?: string } | undefined;
      return w?.farmerId ? traces.filter((t) => t.farmerId === w.farmerId).length : traces.length;
    },
  };

  return {
    farmer: farmerOps,
    conversation: conversationOps,
    trace: traceOps,
    traceEntry: traceOps,
    async $transaction<T extends unknown[]>(ops: T): Promise<T> {
      return (await Promise.all(ops as unknown as Promise<unknown>[])) as T;
    },
    backend: 'memory',
  };
}

let cachedDb: MemoryDb | null = null;
let initAttempted = false;

async function buildDb(): Promise<MemoryDb> {
  if (cachedDb) return cachedDb;
  if (initAttempted) return cachedDb ?? createMemoryBackend();
  initAttempted = true;

  const hasDatabaseUrl =
    typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
  if (!hasDatabaseUrl) {
    cachedDb = createMemoryBackend();
    return cachedDb;
  }

  try {
    const mod = await import('@prisma/client');
    const PrismaClient = (mod as { PrismaClient: new (opts?: unknown) => unknown }).PrismaClient;
    const prisma = new PrismaClient({ log: ['error', 'warn'] }) as {
      farmer: ModelOps;
      conversation: ModelOps;
      trace: ModelOps;
      $transaction: <T extends unknown[]>(ops: T) => Promise<T>;
    };
    cachedDb = {
      farmer: prisma.farmer,
      conversation: prisma.conversation,
      trace: prisma.trace,
      traceEntry: prisma.trace,
      $transaction: prisma.$transaction.bind(prisma),
      backend: 'prisma',
    };
    return cachedDb;
  } catch (err) {
    console.warn(
      '[db] Prisma unavailable, using in-memory fallback:',
      (err as Error)?.message ?? err,
    );
    cachedDb = createMemoryBackend();
    return cachedDb;
  }
}

export async function getDb(): Promise<MemoryDb> {
  return buildDb();
}

// Higher-level helpers used by the agent loop. They operate against whichever
// backend is active — Prisma when DATABASE_URL is configured (local dev), or
// the in-memory store on Vercel serverless. The shape of the data is identical
// so callers can `await` the result and pass it back to Prisma-compatible
// queries without changes.

export async function createOrUpdateSeasonPlan(args: {
  farmerId: string;
  crop: string;
  season?: string;
  sowingDate?: string;
  expectedHarvestDate?: string;
  baselineBudgetBdt?: number;
  expectedYieldValue?: number;
  expectedYieldUnit?: string;
}) {
  const resolved = await getDb();
  if (resolved.backend === 'prisma') {
    // Dynamic import to avoid bundling Prisma when DATABASE_URL is absent.
    const { PrismaClient } = await import('@prisma/client');
    // Reuse the already-instantiated client by relying on Prisma's runtime
    // upsert semantics; the Prisma instance is reachable via the resolved
    // facade for richer queries.
    const client: PrismaClient = (resolved as unknown as { __prisma?: PrismaClient }).__prisma ?? new PrismaClient();
    return client.seasonPlan.upsert({
      where: { id: args.crop ? `${args.farmerId}_${args.crop}` : args.farmerId },
      update: {
        season: args.season ?? null,
        sowingDate: args.sowingDate ?? null,
        expectedHarvestDate: args.expectedHarvestDate ?? null,
        baselineBudgetBdt: args.baselineBudgetBdt ?? null,
        expectedYieldValue: args.expectedYieldValue ?? null,
        expectedYieldUnit: args.expectedYieldUnit ?? null,
      },
      create: {
        id: `${args.farmerId}_${args.crop}_${Date.now()}`,
        farmerId: args.farmerId,
        crop: args.crop,
        season: args.season ?? null,
        sowingDate: args.sowingDate ?? null,
        expectedHarvestDate: args.expectedHarvestDate ?? null,
        baselineBudgetBdt: args.baselineBudgetBdt ?? null,
        expectedYieldValue: args.expectedYieldValue ?? null,
        expectedYieldUnit: args.expectedYieldUnit ?? null,
      },
    });
  }
  // In-memory: append or update by farmerId+crop key.
  const id = `${args.farmerId}_${args.crop}`;
  const store = (globalThis as unknown as { __memSeasonPlans?: Array<Record<string, unknown> & { id: string; farmerId: string; crop: string }> }).__memSeasonPlans;
  const list = store ?? ((globalThis as unknown as { __memSeasonPlans: Array<Record<string, unknown> & { id: string; farmerId: string; crop: string }> }).__memSeasonPlans = []);
  const existing = list.find((p) => p.id === id);
  const row = {
    id,
    farmerId: args.farmerId,
    crop: args.crop,
    season: args.season ?? null,
    sowingDate: args.sowingDate ?? null,
    expectedHarvestDate: args.expectedHarvestDate ?? null,
    baselineBudgetBdt: args.baselineBudgetBdt ?? null,
    expectedYieldValue: args.expectedYieldValue ?? null,
    expectedYieldUnit: args.expectedYieldUnit ?? null,
    currentGrowthStage: existing?.currentGrowthStage ?? 'Sowing',
    planStatus: existing?.planStatus ?? 'active',
    createdAt: existing?.createdAt ?? new Date(),
    updatedAt: new Date(),
  };
  if (existing) Object.assign(existing, row);
  else list.push(row);
  return row;
}

export async function recordScenarioRun(args: {
  seasonPlanId: string;
  scenarioType: string;
  inputJson: unknown;
  outputJson: unknown;
}) {
  const resolved = await getDb();
  if (resolved.backend === 'prisma') {
    const { PrismaClient } = await import('@prisma/client');
    const client: PrismaClient = (resolved as unknown as { __prisma?: PrismaClient }).__prisma ?? new PrismaClient();
    return client.scenarioRun.create({
      data: {
        seasonPlanId: args.seasonPlanId,
        scenarioType: args.scenarioType,
        inputJson: JSON.stringify(args.inputJson ?? {}),
        outputJson: JSON.stringify(args.outputJson ?? {}),
      },
    });
  }
  const store = (globalThis as unknown as { __memScenarioRuns?: Array<Record<string, unknown> & { id: string; seasonPlanId: string }> }).__memScenarioRuns;
  const list = store ?? ((globalThis as unknown as { __memScenarioRuns: Array<Record<string, unknown> & { id: string; seasonPlanId: string }> }).__memScenarioRuns = []);
  const row = {
    id: `scn_${Date.now().toString(36)}_${list.length}`,
    seasonPlanId: args.seasonPlanId,
    scenarioType: args.scenarioType,
    inputJson: JSON.stringify(args.inputJson ?? {}),
    outputJson: JSON.stringify(args.outputJson ?? {}),
    createdAt: new Date(),
  };
  list.push(row);
  return row;
}

export type { MemoryDb, FarmerRow, ConversationRow, TraceRow };
