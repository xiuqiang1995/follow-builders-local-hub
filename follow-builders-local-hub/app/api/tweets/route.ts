import { getRecentTweets } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get('limit') ?? '100');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 300) : 100;
  const handle = url.searchParams.get('handle') ?? '';

  return Response.json({
    items: await getRecentTweets(limit, handle)
  });
}
