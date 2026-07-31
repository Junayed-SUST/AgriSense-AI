import { db as prisma } from '@/lib/db';

// Memory store — wraps Prisma with an in-memory fallback so the app keeps
// working on Vercel serverless where DATABASE_URL is not configured (SQLite
// is not viable in serverless because the filesystem is ephemeral). The
// fallback mirrors the subset of operations used by the chat/trace/profile
// routes and degrades gracefully — data is lost on cold starts but the
// agent, tools, and demo flow still work.

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
};

type ConversationRow = {
  id: string;
  farmerId: string;
  role: string;
  content: string;
  createdAt: Date;
};

type TraceRow = {
  id: string;
  farmerId: string;
  toolName: string;
  toolArgs: string;
  toolResult: string;
  durationMs: number;
  createdAt: Date;
};

interface FarmerOps {
  upsert(args: { where: { sessionId: string }; update: Partial<FarmerRow>; create: { sessionId: string } }): Promise<FarmerRow>;
  update(args: { where: { id: string }; data: Partial<FarmerRow> }): Promise<FarmerRow>;
}

interface ConversationOps {
  create(args: { data: Omit<ConversationRow, 'id' | 'createdAt'> }): Promise<ConversationRow>;
  findMany(args: { where: { farmerId: string }; orderBy?: { createdAt: 'asc' | 'desc' }; take?: number }): Promise<ConversationRow[]>;
}

interface TraceOps {
  create(args: { data: Omit<TraceRow, 'id' | 'createdAt'> }): Promise<TraceRow>;
  findMany(args: { where: { farmerId: string }; orderBy?: { createdAt: 'asc' | 'desc' }; take?: number }): Promise<TraceRow[]>;
}

interface TransactionOps {
  <T extends unknown[]>(ops: T): Promise<T>;
}

interface MemoryDb {
  farmer: FarmerOps;
  conversation: ConversationOps;
  trace: TraceOps;
  $transaction: TransactionOps;
  readonly backend: 'prisma' | 'memory';
}

function createMemoryBackend(): MemoryDb {
  const farmers = new Map<string, FarmerRow>();
  const conversations: ConversationRow[] = [];
  const traces: TraceRow[] = [];
  let counter = 0;
  const newId = () => `mem_${Date.now().toString(36)}_${(counter++).toString(36)}`;

  const farmerOps: FarmerOps = {
    async upsert({ where, update, create }) {
      const existing = farmers.get(where.sessionId);
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return existing;
      }
      const row: FarmerRow = {
        id: newId(),
        sessionId: create.sessionId,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(update as Partial<FarmerRow>),
      };
      farmers.set(create.sessionId, row);
      return row;
    },
    async update({ where, data }) {
      for (const row of farmers.values()) {
        if (row.id === where.id) {
          Object.assign(row, data, { updatedAt: new Date() });
          return row;
        }
      }
      throw new Error('Farmer not found');
    },
  };

  const conversationOps: ConversationOps = {
    async create({ data }) {
      const row: ConversationRow = { id: newId(), createdAt: new Date(), ...data };
      conversations.push(row);
      return row;
    },
    async findMany({ where, orderBy, take }) {
      let rows = conversations.filter(c => c.farmerId === where.farmerId);
      if (orderBy?.createdAt === 'desc') rows = rows.slice().reverse();
      if (typeof take === 'number') rows = rows.slice(-take);
      return rows;
    },
  };

  const traceOps: TraceOps = {
    async create({ data }) {
      const row: TraceRow = { id: newId(), createdAt: new Date(), ...data };
      traces.push(row);
      return row;
    },
    async findMany({ where, orderBy, take }) {
      let rows = traces.filter(t => t.farmerId === where.farmerId);
      if (orderBy?.createdAt === 'desc') rows = rows.slice().reverse();
      if (typeof take === 'number') rows = rows.slice(-take);
      return rows;
    },
  };

  return {
    farmer: farmerOps,
    conversation: conversationOps,
    trace: traceOps,
    async $transaction(ops) {
      return Promise.all(ops);
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

  const hasDatabaseUrl = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
  if (!hasDatabaseUrl) {
    cachedDb = createMemoryBackend();
    return cachedDb;
  }

  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({ log: ['error', 'warn'] });
    // Smoke test — verify the schema can actually be reached before we commit.
    await prisma.$connect();
    cachedDb = {
      farmer: prisma.farmer as unknown as FarmerOps,
      conversation: prisma.conversation as unknown as ConversationOps,
      trace: prisma.trace as unknown as TraceOps,
      $transaction: prisma.$transaction.bind(prisma) as unknown as TransactionOps,
      backend: 'prisma',
    };
    return cachedDb;
  } catch (err) {
    console.warn('[db] Prisma unavailable, using in-memory fallback:', (err as Error)?.message ?? err);
    cachedDb = createMemoryBackend();
    return cachedDb;
  }
}

export async function getDb(): Promise<MemoryDb> {
  return buildDb();
}

export async function createOrUpdateSeasonPlan(params: {
  farmerId: string;
  crop: string;
  variety?: string;
  season?: string;
  sowingDate?: string;
  expectedHarvestDate?: string;
  currentGrowthStage?: string;
  baselineBudgetBdt?: number;
  expectedYieldValue?: number;
  expectedYieldUnit?: string;
}) {
  const { farmerId, crop, variety, season, sowingDate, expectedHarvestDate, currentGrowthStage, baselineBudgetBdt, expectedYieldValue, expectedYieldUnit } = params;

  // Find active plan or create new
  const existing = await prisma.seasonPlan.findFirst({
    where: { farmerId, planStatus: 'active' },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    return await prisma.seasonPlan.update({
      where: { id: existing.id },
      data: {
        crop,
        variety: variety || existing.variety,
        season: season || existing.season,
        sowingDate: sowingDate || existing.sowingDate,
        expectedHarvestDate: expectedHarvestDate || existing.expectedHarvestDate,
        currentGrowthStage: currentGrowthStage || existing.currentGrowthStage,
        baselineBudgetBdt: baselineBudgetBdt ?? existing.baselineBudgetBdt,
        expectedYieldValue: expectedYieldValue ?? existing.expectedYieldValue,
        expectedYieldUnit: expectedYieldUnit || existing.expectedYieldUnit,
      },
    });
  }

  return await prisma.seasonPlan.create({
    data: {
      farmerId,
      crop,
      variety,
      season,
      sowingDate,
      expectedHarvestDate,
      currentGrowthStage: currentGrowthStage || 'Sowing',
      baselineBudgetBdt,
      expectedYieldValue,
      expectedYieldUnit: expectedYieldUnit || 'kg',
      planStatus: 'active',
    },
  });
}

export async function recordFarmOperation(params: {
  seasonPlanId: string;
  operationType: 'fertilizer' | 'irrigation' | 'weeding' | 'pest_control' | 'harvest';
  plannedDate?: string;
  revisedDate?: string;
  growthStage?: string;
  plannedQuantity?: number;
  quantityUnit?: string;
  estimatedCostBdt?: number;
  reason?: string;
}) {
  return await prisma.farmOperation.create({
    data: params,
  });
}

export async function createAlert(params: {
  seasonPlanId: string;
  alertType: 'pest' | 'disease' | 'heavy_rain' | 'drought' | 'heat';
  severity: 'high' | 'moderate' | 'low';
  messageEn: string;
}) {
  return await prisma.alert.create({
    data: params,
  });
}

export async function recordScenarioRun(params: {
  seasonPlanId: string;
  scenarioType: string;
  inputJson: any;
  outputJson: any;
}) {
  return await prisma.scenarioRun.create({
    data: {
      seasonPlanId: params.seasonPlanId,
      scenarioType: params.scenarioType,
      inputJson: JSON.stringify(params.inputJson),
      outputJson: JSON.stringify(params.outputJson),
    },
  });
}

export async function getFarmerMemory(farmerId: string) {
  const farmer = await prisma.farmer.findUnique({
    where: { id: farmerId },
    include: {
      seasonPlans: {
        include: {
          operations: { orderBy: { createdAt: 'desc' } },
          alerts: { orderBy: { createdAt: 'desc' } },
          scenarioRuns: { orderBy: { createdAt: 'desc' } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
  });

  return farmer;
}

export type { MemoryDb, FarmerRow, ConversationRow, TraceRow };
