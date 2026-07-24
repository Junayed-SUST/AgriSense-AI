import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// GET /api/trace?sessionId=... — fetch the agent's tool-call trace (Tier 0 #8)
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const farmer = await db.farmer.findUnique({
    where: { sessionId },
    include: {
      traces: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!farmer) {
    return NextResponse.json({ trace: [] });
  }

  return NextResponse.json({
    trace: farmer.traces.map(t => ({
      id: t.id,
      toolName: t.toolName,
      toolArgs: tryParse(t.toolArgs),
      toolResult: tryParse(t.toolResult),
      durationMs: t.durationMs,
      at: t.createdAt,
    })),
  });
}

function tryParse(s: string | null): any {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
}
