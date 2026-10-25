import type { InternalPage } from './types';

const PROTOCOL = 'byazen://';

export function buildInternal(page: InternalPage, query?: string): string {
  if (page === 'search') {
    return `${PROTOCOL}search?q=${encodeURIComponent(query ?? '')}`;
  }
  return `${PROTOCOL}${page}`;
}

export interface InternalRoute {
  page: InternalPage;
  query?: string;
}

export function parseInternal(url: string): InternalRoute | null {
  if (!url.startsWith(PROTOCOL)) return null;
  try {
    const parsed = new URL(url);
    const page = parsed.hostname;
    if (page === 'newtab' || page === 'bookmarks' || page === 'history' || page === 'settings') {
      return { page };
    }
    if (page === 'search') {
      return { page: 'search', query: parsed.searchParams.get('q') ?? '' };
    }
  } catch {
    return null;
  }
  return null;
}

const DOMAIN_RE =
  /^(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[\p{L}]{2,}(?::\d{2,5})?(?:[/?#].*)?$/u;
const LOCALHOST_RE = /^localhost(?::\d{2,5})?(?:[/?#].*)?$/i;
const IP_RE = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{2,5})?(?:[/?#].*)?$/;

export type ParsedInput =
  | { kind: 'internal'; url: string; route: InternalRoute }
  | { kind: 'url'; url: string }
  | { kind: 'query'; query: string };

export function parseInput(raw: string): ParsedInput {
  const value = raw.trim();
  if (!value) return { kind: 'query', query: '' };

  if (value.startsWith(PROTOCOL) || value.startsWith('byazen:')) {
    const normalized = value.startsWith('byazen://')
      ? value
      : `byazen://${value.slice('byazen:'.length).replace(/^\/+/, '')}`;
    const route = parseInternal(normalized);
    if (route) return { kind: 'internal', url: normalized, route };
  }

  const withProtocol = /^https?:\/\//i.test(value) ? value : null;
  if (withProtocol) {
    try {
      const parsed = new URL(withProtocol);
      if (parsed.hostname) return { kind: 'url', url: parsed.toString() };
    } catch {
      // falls through to query
    }
  }

  if (!/\s/.test(value) && (DOMAIN_RE.test(value) || LOCALHOST_RE.test(value) || IP_RE.test(value))) {
    try {
      const parsed = new URL(`https://${value}`);
      if (parsed.hostname.includes('.') || parsed.hostname === 'localhost') {
        return { kind: 'url', url: parsed.toString() };
      }
    } catch {
      // falls through to query
    }
  }

  return { kind: 'query', query: value };
}

export function isWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '');
  }
}

function decodeSafe(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

export function prettyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = decodeSafe(parsed.hostname).replace(/^www\./, '');
    const path = parsed.pathname === '/' ? '' : decodeSafe(parsed.pathname);
    return `${host}${path}${decodeSafe(parsed.search)}`;
  } catch {
    return url;
  }
}

export function withoutProtocol(url: string): string {
  const stripped = url.replace(/^https?:\/\//, '');
  return stripped.endsWith('/') && !stripped.slice(0, -1).includes('/') ? stripped.slice(0, -1) : stripped;
}

export function openExternal(url: string): boolean {
  try {
    const win = window.open(url, '_blank');
    if (win) {
      // Break the opener reference immediately: no `window.opener` for the new page.
      win.opener = null;
      return true;
    }
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

const FRAME_BLOCKED = [
  'google.com',
  'google.ru',
  'youtube.com',
  'youtu.be',
  'github.com',
  'mail.google.com',
  'yandex.ru',
  'yandex.com',
  'mail.yandex.ru',
  'vk.com',
  'instagram.com',
  'facebook.com',
  'x.com',
  'twitter.com',
  'discord.com',
  'twitch.tv',
  'figma.com',
  'notion.so',
  'duckduckgo.com',
  'search.brave.com',
  'wildberries.ru',
  'ozon.ru',
  'avito.ru',
  'sberbank.ru',
  'tinkoff.ru',
  'kinopoisk.ru',
  'spotify.com',
  'netflix.com',
];

export function likelyBlocksFrames(url: string): boolean {
  const host = hostOf(url);
  return FRAME_BLOCKED.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}
