import { NextRequest, NextResponse } from 'next/server';
import { runAgent } from '@/lib/agent/loop';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SENSITIVE_OFF_TOPIC_PATTERNS = [
  /\bpenis\b/i,
  /\bsexual?\b/i,
  /\bsex\b/i,
  /\bporn\b/i,
  /\bmasturbat/i,
  /\berection\b/i,
  /\bbreast\b/i,
  /\bvagina\b/i,
  /\bcondom\b/i,
  /\bpregnan/i,
  /\bstd\b/i,
  /\bsti\b/i,
  /\bsurgery\b/i,
];

function offTopicAnswer(language: 'en' | 'bn') {
  return language === 'bn'
    ? 'আমি শুধু কৃষি, ফসল, আবহাওয়া, মাটি, সেচ, সার, রোগ-পোকা, বাজার এবং কৃষি পরিকল্পনা নিয়ে সাহায্য করতে পারি। আপনার জমি বা ফসল সম্পর্কে বলুন, আমি সেখান থেকে শুরু করব।'
    : 'I can only help with farming topics: crops, soil, irrigation, fertilizer, weather, pests/diseases, markets, and farm planning. Tell me about your land or crop, and I’ll help from there.';
}

function shouldBlockAsOffTopic(message: string) {
  return SENSITIVE_OFF_TOPIC_PATTERNS.some(pattern => pattern.test(message));
}

async function saveGuardedConversation(sessionId: string, userMessage: string, answer: string) {
  const farmer = (await db.farmer.upsert({
    where: { sessionId },
    update: {},
    create: { sessionId },
  })) as { id: string };
  await db.$transaction([
    db.conversation.create({ data: { farmerId: farmer.id, role: 'user', content: userMessage } }),
    db.conversation.create({ data: { farmerId: farmer.id, role: 'assistant', content: answer } }),
  ] as Parameters<typeof db.$transaction>[0]);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, message, language } = body as { sessionId?: string; message?: string; language?: string };

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    // Generate a sessionId if not provided
    const sid = sessionId || `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    if (language !== undefined && language !== 'en' && language !== 'bn') {
      return NextResponse.json({ error: 'language must be en or bn' }, { status: 400 });
    }

    const responseLanguage = language === 'bn' ? 'bn' : 'en';

    if (shouldBlockAsOffTopic(message)) {
      const answer = offTopicAnswer(responseLanguage);
      await saveGuardedConversation(sid, message, answer);
      return NextResponse.json({
        sessionId: sid,
        answer,
        trace: [],
        iterations: 0,
        blocked: true,
      });
    }

    const result = await runAgent(sid, message, responseLanguage);

    return NextResponse.json({
      sessionId: sid,
      answer: result.finalAnswer,
      trace: result.trace,
      iterations: result.iterations,
    });
  } catch (err: any) {
    console.error('[/api/chat] error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'agrisense-chat' });
}
