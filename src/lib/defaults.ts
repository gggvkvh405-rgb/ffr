import type { Bookmark, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  engine: 'duckduckgo',
  wallpaper: 'obsidian',
  accent: 'lime',
  grain: true,
  showClock: true,
  weather: true,
  weatherPlace: null,
  linkTarget: 'inline',
  searchDirectly: false,
};

export const SEED_BOOKMARKS: Bookmark[] = [
  { id: 'seed-github', title: 'GitHub', url: 'https://github.com/', addedAt: 0 },
  { id: 'seed-youtube', title: 'YouTube', url: 'https://www.youtube.com/', addedAt: 0 },
  {
    id: 'seed-wikipedia',
    title: 'Википедия',
    url: 'https://ru.wikipedia.org/',
    addedAt: 0,
  },
  { id: 'seed-telegram', title: 'Telegram', url: 'https://web.telegram.org/', addedAt: 0 },
  { id: 'seed-habr', title: 'Хабр', url: 'https://habr.com/ru/', addedAt: 0 },
  { id: 'seed-vk', title: 'ВКонтакте', url: 'https://vk.com/', addedAt: 0 },
  { id: 'seed-figma', title: 'Figma', url: 'https://www.figma.com/', addedAt: 0 },
  { id: 'seed-notion', title: 'Notion', url: 'https://www.notion.so/', addedAt: 0 },
];

export const APP_VERSION = '1.0';
