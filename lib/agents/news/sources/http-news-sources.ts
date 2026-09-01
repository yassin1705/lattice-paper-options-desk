import type {
  NewsArticle,
  NewsSourceId,
  NewsSourcePort,
  NewsSourceRequest,
  NewsStockConfig,
} from '@/lib/agents/news/types';

type JsonRecord = Record<string, unknown>;

type HttpSourceOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? (value as JsonRecord) : {};
}

function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function iso(value: unknown): string {
  const raw = text(value);
  if (!raw) return new Date(0).toISOString();
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? new Date(0).toISOString()
    : date.toISOString();
}

function unixIso(value: unknown): string {
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : new Date(0).toISOString();
}

function cleanText(value: unknown, maximumLength = 6_000): string {
  return text(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximumLength);
}

function alphaVantageTime(value: string): string {
  const date = new Date(value);
  return [
    date.getUTCFullYear().toString().padStart(4, '0'),
    (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    date.getUTCDate().toString().padStart(2, '0'),
    'T',
    date.getUTCHours().toString().padStart(2, '0'),
    date.getUTCMinutes().toString().padStart(2, '0'),
  ].join('');
}

function gdeltTime(value: string): string {
  const date = new Date(value);
  return [
    date.getUTCFullYear().toString().padStart(4, '0'),
    (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    date.getUTCDate().toString().padStart(2, '0'),
    date.getUTCHours().toString().padStart(2, '0'),
    date.getUTCMinutes().toString().padStart(2, '0'),
    date.getUTCSeconds().toString().padStart(2, '0'),
  ].join('');
}

function day(value: string): string {
  return value.slice(0, 10);
}

function sourceArticleId(sourceId: NewsSourceId, value: string): string {
  return `${sourceId}:${value}`;
}

abstract class HttpNewsSource implements NewsSourcePort {
  abstract readonly sourceId: NewsSourceId;
  protected readonly fetcher: typeof fetch;
  protected readonly timeoutMs: number;

  constructor(options: HttpSourceOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  abstract fetch(request: NewsSourceRequest): Promise<NewsArticle[]>;

  protected async json(url: string, headers?: HeadersInit): Promise<unknown> {
    const response = await this.request(url, headers);
    return response.json();
  }

  protected async body(url: string): Promise<string> {
    const response = await this.request(url);
    return response.text();
  }

  private async request(url: string, headers?: HeadersInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        headers,
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`${this.sourceId} returned HTTP ${response.status}.`);
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class AlpacaNewsSource extends HttpNewsSource {
  readonly sourceId = 'alpaca' as const;

  constructor(
    private readonly apiKey: string,
    private readonly secretKey: string,
    private readonly baseUrl = 'https://data.alpaca.markets',
    options: HttpSourceOptions = {},
  ) {
    super(options);
  }

  async fetch(request: NewsSourceRequest): Promise<NewsArticle[]> {
    const query = new URLSearchParams({
      symbols: request.stocks.map((stock) => stock.symbol).join(','),
      start: request.from,
      end: request.to,
      sort: 'desc',
      limit: String(
        Math.min(50, request.limitPerSymbol * request.stocks.length),
      ),
      include_content: 'true',
    });
    const payload = record(
      await this.json(
        `${this.baseUrl.replace(/\/$/, '')}/v1beta1/news?${query}`,
        {
          'APCA-API-KEY-ID': this.apiKey,
          'APCA-API-SECRET-KEY': this.secretKey,
        },
      ),
    );
    return values(payload.news).map((value) => {
      const item = record(value);
      const id = text(item.id) || text(item.url) || text(item.headline);
      return {
        articleId: sourceArticleId(this.sourceId, id),
        sourceId: this.sourceId,
        publisher: text(item.source) || 'Alpaca News',
        symbols: values(item.symbols).map(text).filter(Boolean),
        title: cleanText(item.headline, 500),
        summary: cleanText(item.summary, 2_000),
        content: cleanText(item.content) || null,
        url: text(item.url) || null,
        publishedAt: iso(item.created_at),
        updatedAt: text(item.updated_at) ? iso(item.updated_at) : null,
      };
    });
  }
}

export class FinnhubNewsSource extends HttpNewsSource {
  readonly sourceId = 'finnhub' as const;

  constructor(
    private readonly apiKey: string,
    options: HttpSourceOptions = {},
  ) {
    super(options);
  }

  async fetch(request: NewsSourceRequest): Promise<NewsArticle[]> {
    const batches = await Promise.all(
      request.stocks.map(async (stock) => {
        const query = new URLSearchParams({
          symbol: stock.symbol,
          from: day(request.from),
          to: day(request.to),
          token: this.apiKey,
        });
        const payload = await this.json(
          `https://finnhub.io/api/v1/company-news?${query}`,
        );
        return values(payload)
          .slice(0, request.limitPerSymbol)
          .map((value) => {
            const item = record(value);
            const id = text(item.id) || text(item.url) || text(item.headline);
            return {
              articleId: sourceArticleId(this.sourceId, id),
              sourceId: this.sourceId,
              publisher: text(item.source) || 'Finnhub',
              symbols: [stock.symbol],
              title: cleanText(item.headline, 500),
              summary: cleanText(item.summary, 2_000),
              content: null,
              url: text(item.url) || null,
              publishedAt: unixIso(item.datetime),
              updatedAt: null,
            } satisfies NewsArticle;
          });
      }),
    );
    return batches.flat();
  }
}

export class AlphaVantageNewsSource extends HttpNewsSource {
  readonly sourceId = 'alpha_vantage' as const;

  constructor(
    private readonly apiKey: string,
    options: HttpSourceOptions = {},
  ) {
    super(options);
  }

  async fetch(request: NewsSourceRequest): Promise<NewsArticle[]> {
    const batches = await Promise.all(
      request.stocks.map(async (stock) => {
        const query = new URLSearchParams({
          function: 'NEWS_SENTIMENT',
          tickers: stock.symbol,
          time_from: alphaVantageTime(request.from),
          time_to: alphaVantageTime(request.to),
          sort: 'LATEST',
          limit: String(request.limitPerSymbol),
          apikey: this.apiKey,
        });
        const payload = record(
          await this.json(`https://www.alphavantage.co/query?${query}`),
        );
        if (text(payload.Note) || text(payload.Information)) {
          throw new Error(text(payload.Note) || text(payload.Information));
        }
        return values(payload.feed).map((value) => {
          const item = record(value);
          const url = text(item.url);
          return {
            articleId: sourceArticleId(
              this.sourceId,
              url || text(item.time_published) || text(item.title),
            ),
            sourceId: this.sourceId,
            publisher: text(item.source) || 'Alpha Vantage',
            symbols: [stock.symbol],
            title: cleanText(item.title, 500),
            summary: cleanText(item.summary, 2_000),
            content: null,
            url: url || null,
            publishedAt: iso(
              text(item.time_published).replace(
                /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/,
                '$1-$2-$3T$4:$5:$6Z',
              ),
            ),
            updatedAt: null,
          } satisfies NewsArticle;
        });
      }),
    );
    return batches.flat();
  }
}

export class GdeltNewsSource extends HttpNewsSource {
  readonly sourceId = 'gdelt' as const;

  async fetch(request: NewsSourceRequest): Promise<NewsArticle[]> {
    const batches = await Promise.all(
      request.stocks.map(async (stock) => {
        const terms = [stock.companyName, ...stock.aliases.slice(0, 2)]
          .map((item) => `"${item.replace(/"/g, '')}"`)
          .join(' OR ');
        const query = new URLSearchParams({
          query: `(${terms})`,
          mode: 'ArtList',
          format: 'json',
          maxrecords: String(Math.min(250, request.limitPerSymbol)),
          sort: 'DateDesc',
          startdatetime: gdeltTime(request.from),
          enddatetime: gdeltTime(request.to),
        });
        const payload = record(
          await this.json(
            `https://api.gdeltproject.org/api/v2/doc/doc?${query}`,
          ),
        );
        return values(payload.articles).map((value) => {
          const item = record(value);
          const url = text(item.url);
          return {
            articleId: sourceArticleId(
              this.sourceId,
              url || text(item.seendate) || text(item.title),
            ),
            sourceId: this.sourceId,
            publisher: text(item.domain) || 'GDELT',
            symbols: [stock.symbol],
            title: cleanText(item.title, 500),
            summary: '',
            content: null,
            url: url || null,
            publishedAt: iso(item.seendate),
            updatedAt: null,
          } satisfies NewsArticle;
        });
      }),
    );
    return batches.flat();
  }
}

export class GoogleNewsRssSource extends HttpNewsSource {
  readonly sourceId = 'google_news' as const;

  async fetch(request: NewsSourceRequest): Promise<NewsArticle[]> {
    const from = new Date(request.from).getTime();
    const to = new Date(request.to).getTime();
    const batches = await Promise.all(
      request.stocks.map(async (stock) => {
        const search = [stock.symbol, stock.companyName]
          .filter(Boolean)
          .join(' ');
        const query = new URLSearchParams({
          q: search,
          hl: 'en-US',
          gl: 'US',
          ceid: 'US:en',
        });
        const feedUrl = `https://news.google.com/rss/search?${query}`;
        const xml = await this.body(feedUrl);
        return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
          .map((match) => {
            const item = match[1] ?? '';
            const title = xmlValue(item, 'title');
            const url = xmlValue(item, 'link');
            const publisher = xmlValue(item, 'source') || 'Google News';
            return {
              articleId: sourceArticleId(
                this.sourceId,
                xmlValue(item, 'guid') || url || `${stock.symbol}:${title}`,
              ),
              sourceId: this.sourceId,
              publisher,
              symbols: [stock.symbol],
              title,
              summary: xmlValue(item, 'description'),
              content: null,
              url: url || feedUrl,
              publishedAt: iso(xmlValue(item, 'pubDate')),
              updatedAt: null,
            } satisfies NewsArticle;
          })
          .filter((article) => {
            const published = new Date(article.publishedAt).getTime();
            return published >= from && published <= to;
          })
          .slice(0, request.limitPerSymbol);
      }),
    );
    return batches.flat();
  }
}

function xmlValue(item: string, tag: string): string {
  const escaped = tag.replace(':', '\\:');
  const match = item.match(
    new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'),
  );
  return cleanText(match?.[1] ?? '');
}

function rssArticles(
  xml: string,
  stock: NewsStockConfig,
  feedUrl: string,
): NewsArticle[] {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(
    (match) => {
      const item = match[1] ?? '';
      const title = xmlValue(item, 'title');
      const url = xmlValue(item, 'link');
      const guid = xmlValue(item, 'guid');
      return {
        articleId: sourceArticleId(
          'official_company',
          guid || url || `${stock.symbol}:${title}`,
        ),
        sourceId: 'official_company',
        publisher: `${stock.companyName} Newsroom`,
        symbols: [stock.symbol],
        title,
        summary: xmlValue(item, 'description'),
        content: xmlValue(item, 'content:encoded') || null,
        url: url || feedUrl,
        publishedAt: iso(xmlValue(item, 'pubDate')),
        updatedAt: null,
      };
    },
  );
}

export class OfficialCompanyNewsSource extends HttpNewsSource {
  readonly sourceId = 'official_company' as const;

  async fetch(request: NewsSourceRequest): Promise<NewsArticle[]> {
    const from = new Date(request.from).getTime();
    const to = new Date(request.to).getTime();
    const feeds = request.stocks.flatMap((stock) =>
      stock.officialFeedUrls.map((feedUrl) => ({ stock, feedUrl })),
    );
    const batches = await Promise.all(
      feeds.map(async ({ stock, feedUrl }) => {
        const xml = await this.body(feedUrl);
        return rssArticles(xml, stock, feedUrl)
          .filter((article) => {
            const published = new Date(article.publishedAt).getTime();
            return published >= from && published <= to;
          })
          .slice(0, request.limitPerSymbol);
      }),
    );
    return batches.flat();
  }
}
