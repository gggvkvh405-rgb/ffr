import type { AccentId, EngineId, WallpaperId } from './types';

export interface Engine {
  id: EngineId;
  name: string;
  host: string;
  searchUrl: (query: string) => string;
}

export const ENGINES: Engine[] = [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    host: 'duckduckgo.com',
    searchUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'google',
    name: 'Google',
    host: 'google.com',
    searchUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'yandex',
    name: 'Яндекс',
    host: 'yandex.ru',
    searchUrl: (q) => `https://yandex.ru/search/?text=${encodeURIComponent(q)}`,
  },
  {
    id: 'brave',
    name: 'Brave',
    host: 'search.brave.com',
    searchUrl: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
  },
];

export function getEngine(id: EngineId): Engine {
  return ENGINES.find((engine) => engine.id === id) ?? ENGINES[0];
}

export const WALLPAPERS: { id: WallpaperId; name: string; note: string }[] = [
  { id: 'obsidian', name: 'Обсидиан', note: 'тёплый сумрак' },
  { id: 'midnight', name: 'Полночь', note: 'холодный синий' },
  { id: 'ember', name: 'Уголь', note: 'мягкое тепло' },
  { id: 'graphite', name: 'Графит', note: 'чистая нейтраль' },
];

export const ACCENTS: { id: AccentId; name: string; hex: string }[] = [
  { id: 'lime', name: 'Лайм', hex: '#d9f27c' },
  { id: 'ice', name: 'Лёд', hex: '#a9cdff' },
  { id: 'amber', name: 'Амбра', hex: '#f0c88c' },
  { id: 'rose', name: 'Роза', hex: '#f2b6c4' },
];
