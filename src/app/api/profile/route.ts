import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// GET /api/profile?sessionId=... — fetch farmer profile + conversation history
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const farmer = await db.farmer.findUnique({
    where: { sessionId },
    include: {
      conversations: { orderBy: { createdAt: 'asc' }, take: 100 },
    },
  });

  if (!farmer) {
    return NextResponse.json({ profile: null, conversations: [], trace: [] });
  }

  return NextResponse.json({
    profile: {
      sessionId: farmer.sessionId,
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
    },
    conversations: farmer.conversations.map(c => ({ role: c.role, content: c.content, at: c.createdAt })),
  });
}
