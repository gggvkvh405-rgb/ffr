import type { HnStory, WikiArticle } from './types';

const TIMEOUT = 9000;

async function fetchJson<T>(url: string, signal?: AbortSignal, timeout = TIMEOUT): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(url, { signal: controller.signal, mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function stripHtml(html: string): string {
  const node = document.createElement('div');
  node.innerHTML = html;
  return (node.textContent ?? '').replace(/\s+/g, ' ').trim();
}

interface WikiSearchHit {
  title: string;
  pageid: number;
  snippet: string;
}

interface WikiSearchResponse {
  query?: { search?: WikiSearchHit[] };
}

interface WikiPage {
  pageid?: number;
  title: string;
  extract?: string;
  thumbnail?: { source: string };
  fullurl?: string;
}

interface WikiInfoResponse {
  query?: { pages?: WikiPage[] };
}

async function fetchWikipedia(
  query: string,
  lang: 'ru' | 'en',
  signal?: AbortSignal,
): Promise<WikiArticle[]> {
  const searchParams = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    list: 'search',
    srsearch: query,
    srnamespace: '0',
    srlimit: '6',
  });
  const searchData = await fetchJson<WikiSearchResponse>(
    `https://${lang}.wikipedia.org/w/api.php?${searchParams.toString()}`,
    signal,
  );
  const hits = searchData.query?.search ?? [];
  if (hits.length === 0) return [];

  const infoParams = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    prop: 'pageimages|extracts|info',
    titles: hits.map((hit) => hit.title).join('|'),
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
    piprop: 'thumbnail',
    pithumbsize: '240',
    inprop: 'url',
    redirects: '1',
  });

  let pages: WikiPage[] = [];
  try {
    const infoData = await fetchJson<WikiInfoResponse>(
      `https://${lang}.wikipedia.org/w/api.php?${infoParams.toString()}`,
      signal,
    );
    pages = infoData.query?.pages ?? [];
  } catch {
    // Search snippets are still useful without page details.
    pages = [];
  }

  const byTitle = new Map<string, WikiPage>();
  for (const page of pages) {
    byTitle.set(page.title.replace(/_/g, ' ').toLowerCase(), page);
  }

  return hits.map((hit) => {
    const page = byTitle.get(hit.title.toLowerCase());
    const extract = page?.extract?.trim() || stripHtml(hit.snippet);
    return {
      id: page?.pageid ?? hit.pageid,
      title: hit.title,
      extract,
      snippet: stripHtml(hit.snippet),
      url:
        page?.fullurl ??
        `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`,
      thumbnail: page?.thumbnail?.source,
      lang,
    };
  });
}

export async function fetchWikiArticles(
  query: string,
  signal?: AbortSignal,
): Promise<WikiArticle[]> {
  const russian = await fetchWikipedia(query, 'ru', signal);
  if (russian.length > 0) return russian;
  if (/[a-z]/i.test(query)) return fetchWikipedia(query, 'en', signal);
  return [];
}

export interface WikiSuggestion {
  title: string;
  url: string;
}

export async function fetchWikiSuggestions(
  query: string,
  signal?: AbortSignal,
): Promise<WikiSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const params = new URLSearchParams({
    action: 'opensearch',
    format: 'json',
    origin: '*',
    search: trimmed,
    limit: '6',
    namespace: '0',
  });
  const data = await fetchJson<[string, string[], string[], string[]]>(
    `https://ru.wikipedia.org/w/api.php?${params.toString()}`,
    signal,
    6000,
  );
  const titles = data[1] ?? [];
  const urls = data[3] ?? [];
  return titles
    .map((title, index) => ({
      title,
      url:
        urls[index] ??
        `https://ru.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    }))
    .filter((item) => item.title.toLowerCase() !== trimmed.toLowerCase());
}

interface HnHit {
  objectID: string;
  title: string | null;
  url: string | null;
  points: number | null;
  num_comments: number | null;
  created_at_i: number;
}

interface HnResponse {
  hits?: HnHit[];
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export async function fetchHnStories(query: string, signal?: AbortSignal): Promise<HnStory[]> {
  if (!/[a-z]/i.test(query)) return [];
  const params = new URLSearchParams({
    query,
    tags: 'story',
    hitsPerPage: '4',
    numericFilters: 'points>5',
  });
  const data = await fetchJson<HnResponse>(
    `https://hn.algolia.com/api/v1/search?${params.toString()}`,
    signal,
    7000,
  );
  return (data.hits ?? [])
    .filter((hit): hit is HnHit & { title: string } => Boolean(hit.title))
    .map((hit) => ({
      id: hit.objectID,
      title: hit.title,
      url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
      domain: hit.url ? domainOf(hit.url) : 'news.ycombinator.com',
      points: hit.points ?? 0,
      comments: hit.num_comments ?? 0,
      createdAt: hit.created_at_i * 1000,
      discussionUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    }));
}
