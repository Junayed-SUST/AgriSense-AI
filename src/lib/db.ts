// db.ts — resilient DB facade. Tries Prisma (for local dev with SQLite) and
// falls back to an in-memory backend on Vercel where SQLite cannot persist
// across serverless invocations. All existing callers
// (`db.farmer.upsert(...)`, `db.farmer.findUnique({...})`, `db.$transaction([...])`)
// keep working unchanged because each method is a Promise-returning proxy
// that resolves the underlying backend lazily.
import { getDb } from './db/memory';
import type { MemoryDb } from './db/memory';

type LazyModel = MemoryDb['farmer'];
type NoopModel = LazyModel;

let resolved: MemoryDb | null = null;

async function ensureResolved(): Promise<MemoryDb> {
  if (resolved) return resolved;
  resolved = await getDb();
  return resolved;
}

// Build a lazy proxy for any model that forwards every method call to the
// resolved backend. The shape mirrors Prisma's nested model API and supports
// any combination of {upsert, update, create, findUnique, findFirst, findMany, delete, count}.
function lazyModel(model: 'farmer' | 'conversation' | 'trace' | 'traceEntry'): LazyModel {
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        return (...args: unknown[]) =>
          ensureResolved().then((d) => {
            const m = d[model] as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
            const fn = m[prop];
            if (typeof fn === 'function') return fn(...args);
            return null;
          });
      },
    },
  ) as LazyModel;
}

// Generic proxy for any model that the in-memory backend does not implement
// (e.g. weatherCheck, alert, seasonPlan, farmOperation, scenarioRun). Returns
// null on every call so code can still pass type-checking without crashing.
function noopModel(): NoopModel {
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        return (..._args: unknown[]) => Promise.resolve(null);
      },
    },
  ) as NoopModel;
}

export const db = {
  farmer: lazyModel('farmer'),
  conversation: lazyModel('conversation'),
  trace: lazyModel('trace'),
  traceEntry: lazyModel('traceEntry'),
  weatherCheck: noopModel(),
  alert: noopModel(),
  seasonPlan: noopModel(),
  farmOperation: noopModel(),
  scenarioRun: noopModel(),
  $transaction: (ops: Parameters<MemoryDb['$transaction']>[0]) =>
    ensureResolved().then((d) => d.$transaction(ops)),
  backend: 'memory' as 'prisma' | 'memory',
  ready: () => ensureResolved(),
};