import { runSync } from '@/lib/sync';

declare global {
  var __followBuildersSyncPromise:
    | Promise<Awaited<ReturnType<typeof runSync>>>
    | undefined;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST() {
  if (globalThis.__followBuildersSyncPromise) {
    return Response.json(
      {
        status: 'accepted',
        message: '同步已在进行中，请稍后刷新页面。'
      },
      { status: 202 }
    );
  }

  const syncPromise = runSync({ announce: false });
  globalThis.__followBuildersSyncPromise = syncPromise;

  try {
    const result = await syncPromise;

    return Response.json({
      status: 'ok',
      message: `同步完成：新增 ${result.newTweets} 条推文，${result.newPodcastEpisodes} 条播客，${result.newBlogPosts} 篇博客。`,
      result
    });
  } catch (error) {
    console.error('[sync] error:', error);
    const message = error instanceof Error ? error.message : String(error);

    return Response.json(
      {
        status: 'error',
        message
      },
      { status: 500 }
    );
  } finally {
    if (globalThis.__followBuildersSyncPromise === syncPromise) {
      globalThis.__followBuildersSyncPromise = undefined;
    }
  }
}
