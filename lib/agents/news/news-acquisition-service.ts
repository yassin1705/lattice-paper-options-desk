import type {
  NewsAcquisitionResult,
  NewsArticle,
  NewsSourcePort,
  NewsSourceRequest,
  NewsStory,
} from '@/lib/agents/news/types';

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function canonicalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.startsWith('utm_') ||
        ['ref', 'source', 'campaign'].includes(key)
      ) {
        url.searchParams.delete(key);
      }
    }
    url.hash = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function normalizedTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 16)
    .join(' ');
}

function dedupeKey(article: NewsArticle): string {
  return canonicalUrl(article.url) ?? normalizedTitle(article.title);
}

function mergeArticles(articles: NewsArticle[]): NewsStory[] {
  const groups = new Map<string, NewsArticle[]>();
  for (const article of articles) {
    const key = dedupeKey(article);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), article]);
  }
  return [...groups.entries()]
    .map(([key, grouped]) => {
      const ordered = [...grouped].sort((left, right) =>
        right.publishedAt.localeCompare(left.publishedAt),
      );
      const primary = ordered[0]!;
      return {
        storyId: `story:${stableHash(key)}`,
        articleIds: [...new Set(ordered.map((item) => item.articleId))],
        sourceIds: [...new Set(ordered.map((item) => item.sourceId))],
        publishers: [
          ...new Set(ordered.map((item) => item.publisher).filter(Boolean)),
        ],
        symbols: [...new Set(ordered.flatMap((item) => item.symbols))],
        title: primary.title,
        summary: ordered.find((item) => item.summary)?.summary ?? '',
        content: ordered.find((item) => item.content)?.content ?? null,
        url: primary.url,
        publishedAt: primary.publishedAt,
      } satisfies NewsStory;
    })
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
}

export class NewsAcquisitionService {
  constructor(
    private readonly sources: NewsSourcePort[],
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async collect(request: NewsSourceRequest): Promise<NewsAcquisitionResult> {
    const settled = await Promise.allSettled(
      this.sources.map((source) => source.fetch(request)),
    );
    const articles: NewsArticle[] = [];
    const sourceReports = settled.map((result, index) => {
      const sourceId = this.sources[index]!.sourceId;
      if (result.status === 'fulfilled') {
        articles.push(...result.value);
        return {
          sourceId,
          status: 'available' as const,
          articlesReceived: result.value.length,
          error: null,
        };
      }
      return {
        sourceId,
        status: 'failed' as const,
        articlesReceived: 0,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : 'News source failed.',
      };
    });
    const stories = mergeArticles(articles);
    return {
      collectedAt: this.clock().toISOString(),
      articlesReceived: articles.length,
      duplicatesRemoved: Math.max(0, articles.length - stories.length),
      stories,
      sourceReports,
    };
  }
}
