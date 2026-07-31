// db.ts — resilient DB facade. Tries Prisma (for local dev with SQLite) and
// falls back to an in-memory backend on Vercel where SQLite cannot persist
// across serverless invocations. All existing callers (`db.farmer.upsert(...)`,
// `db.$transaction([...])`) keep working unchanged because we synchronously
// resolve the backend on first access.
import { getDb } from './db/memory';
import type { MemoryDb } from './db/memory';

let resolved: MemoryDb | null = null;

async function ensureResolved(): Promise<MemoryDb> {
  if (resolved) return resolved;
  resolved = await getDb();
  return resolved;
}

// We expose `db` as a thin object whose methods synchronously trigger the
// async backend resolution implicitly. Because every existing route uses
// `await` before touching db properties, the first `await` inside the
// handler gives us time to resolve.
export const db = {
  farmer: {
    upsert: (...args: Parameters<MemoryDb['farmer']['upsert']>) =>
      ensureResolved().then(d => d.farmer.upsert(...args)),
    update: (...args: Parameters<MemoryDb['farmer']['update']>) =>
      ensureResolved().then(d => d.farmer.update(...args)),
  },
  conversation: {
    create: (...args: Parameters<MemoryDb['conversation']['create']>) =>
      ensureResolved().then(d => d.conversation.create(...args)),
    findMany: (...args: Parameters<MemoryDb['conversation']['findMany']>) =>
      ensureResolved().then(d => d.conversation.findMany(...args)),
  },
  trace: {
    create: (...args: Parameters<MemoryDb['trace']['create']>) =>
      ensureResolved().then(d => d.trace.create(...args)),
    findMany: (...args: Parameters<MemoryDb['trace']['findMany']>) =>
      ensureResolved().then(d => d.trace.findMany(...args)),
  },
  traceEntry: {
    create: (...args: Parameters<MemoryDb['trace']['create']>) =>
      ensureResolved().then(d => d.trace.create(...args)),
    findMany: (...args: Parameters<MemoryDb['trace']['findMany']>) =>
      ensureResolved().then(d => d.trace.findMany(...args)),
  },
  $transaction: (ops: Parameters<MemoryDb['$transaction']>[0]) =>
    ensureResolved().then(d => d.$transaction(ops)),
  backend: 'memory' as const,
  ready: () => ensureResolved(),
};