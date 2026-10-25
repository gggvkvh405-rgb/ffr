export type EngineId = 'duckduckgo' | 'google' | 'yandex' | 'brave';
export type WallpaperId = 'obsidian' | 'midnight' | 'ember' | 'graphite';
export type AccentId = 'lime' | 'ice' | 'amber' | 'rose';
export type LinkTarget = 'inline' | 'external';

export interface WeatherPlace {
  label: string;
  detail?: string;
  lat: number;
  lon: number;
}

export interface Settings {
  engine: EngineId;
  wallpaper: WallpaperId;
  accent: AccentId;
  grain: boolean;
  showClock: boolean;
  weather: boolean;
  weatherPlace: WeatherPlace | null;
  linkTarget: LinkTarget;
  searchDirectly: boolean;
}

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  addedAt: number;
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
  type: 'page' | 'search';
}

export interface RecentSearch {
  query: string;
  at: number;
}

export interface NavEntry {
  url: string;
  title: string;
}

export interface Tab {
  id: string;
  entries: NavEntry[];
  index: number;
}

export interface WeatherData {
  temp: number;
  code: number;
  at: number;
  place?: string;
}

export interface WikiArticle {
  id: number;
  title: string;
  extract: string;
  snippet: string;
  url: string;
  thumbnail?: string;
  lang: 'ru' | 'en';
}

export interface HnStory {
  id: string;
  title: string;
  url: string;
  domain: string;
  points: number;
  comments: number;
  createdAt: number;
  discussionUrl: string;
}

export interface SearchData {
  query: string;
  articles: WikiArticle[];
  stories: HnStory[];
}

export interface WeatherState {
  data: WeatherData | null;
  loading: boolean;
  error: boolean;
}

export type InternalPage = 'newtab' | 'search' | 'bookmarks' | 'history' | 'settings';
