import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_SETTINGS, SEED_BOOKMARKS } from '../lib/defaults';
import { ACCENTS, ENGINES, WALLPAPERS, getEngine } from '../lib/engines';
import { buildInternal, hostOf, isWebUrl, openExternal, parseInternal, copyText } from '../lib/url';
import {
  clearStored,
  readSession,
  readStored,
  writeSession,
  writeStored,
} from '../lib/storage';
import type {
  Bookmark,
  EngineId,
  HistoryEntry,
  LinkTarget,
  NavEntry,
  RecentSearch,
  Settings,
  Tab,
  WeatherData,
  WeatherPlace,
} from '../lib/types';
import { fetchWeather, requestCoordinates } from '../lib/weather';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastMessage {
  id: string;
  message: string;
  action?: ToastAction;
}

interface BrowserState {
  tabs: Tab[];
  activeTabId: string;
  bookmarks: Bookmark[];
  history: HistoryEntry[];
  recentSearches: RecentSearch[];
  settings: Settings;
  weather: WeatherData | null;
  reloadTick: number;
}

type Action =
  | { type: 'new-tab'; url: string; title?: string; activate: boolean }
  | { type: 'close-tab'; id: string }
  | { type: 'activate-tab'; id: string }
  | {
      type: 'navigate';
      tabId: string;
      url: string;
      title?: string;
      replace?: boolean;
      record?: boolean;
    }
  | { type: 'back'; tabId: string }
  | { type: 'forward'; tabId: string }
  | { type: 'reload' }
  | { type: 'add-bookmark'; bookmark: Bookmark }
  | { type: 'remove-bookmark'; id: string }
  | { type: 'add-history'; entry: HistoryEntry }
  | { type: 'remove-history'; id: string }
  | { type: 'clear-history' }
  | { type: 'add-recent'; query: string }
  | { type: 'clear-recent' }
  | { type: 'update-settings'; patch: Partial<Settings> }
  | { type: 'set-weather'; data: WeatherData | null }
  | { type: 'reset' };

const MAX_TABS = 16;
const MAX_HISTORY = 500;
const MAX_BOOKMARKS = 120;
const MAX_RECENT = 8;

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function titleForUrl(url: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const route = parseInternal(url);
  if (route) {
    if (route.page === 'newtab') return 'Новая вкладка';
    if (route.page === 'search') return route.query ? `Поиск: ${route.query}` : 'Поиск';
    if (route.page === 'bookmarks') return 'Закладки';
    if (route.page === 'history') return 'История';
    if (route.page === 'settings') return 'Настройки';
  }
  return hostOf(url).replace(/^www\./, '');
}

function entryFor(url: string, title?: string): NavEntry {
  return { url, title: titleForUrl(url, title) };
}

function makeTab(url: string, title?: string): Tab {
  return { id: uid(), entries: [entryFor(url, title)], index: 0 };
}

function historyFor(entry: NavEntry): HistoryEntry | null {
  const route = parseInternal(entry.url);
  if (route) {
    if (route.page === 'search' && route.query?.trim()) {
      return {
        id: uid(),
        url: entry.url,
        title: route.query.trim(),
        visitedAt: Date.now(),
        type: 'search',
      };
    }
    return null;
  }
  if (!isWebUrl(entry.url)) return null;
  return {
    id: uid(),
    url: entry.url,
    title: entry.title,
    visitedAt: Date.now(),
    type: 'page',
  };
}

function withHistory(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...history.filter((item) => item.url !== entry.url)].slice(0, MAX_HISTORY);
}

function openNewTab(): Tab {
  return makeTab(buildInternal('newtab'));
}

function freshState(): BrowserState {
  const tab = makeTab(buildInternal('newtab'));
  return {
    tabs: [tab],
    activeTabId: tab.id,
    bookmarks: SEED_BOOKMARKS.map((bookmark) => ({ ...bookmark })),
    history: [],
    recentSearches: [],
    settings: { ...DEFAULT_SETTINGS },
    weather: null,
    reloadTick: 0,
  };
}

function reducer(state: BrowserState, action: Action): BrowserState {
  switch (action.type) {
    case 'new-tab': {
      const tab = makeTab(action.url, action.title);
      let next: BrowserState = {
        ...state,
        tabs: [...state.tabs, tab].slice(-MAX_TABS),
      };
      if (action.activate) next = { ...next, activeTabId: tab.id };
      const history = historyFor(tab.entries[0]);
      if (history) next = { ...next, history: withHistory(next.history, history) };
      return next;
    }
    case 'close-tab': {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index < 0) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      if (tabs.length === 0) {
        const tab = openNewTab();
        return { ...state, tabs: [tab], activeTabId: tab.id };
      }
      let activeTabId = state.activeTabId;
      if (state.activeTabId === action.id) {
        activeTabId = tabs[Math.max(0, index - 1)]?.id ?? tabs[0].id;
      }
      return { ...state, tabs, activeTabId };
    }
    case 'activate-tab':
      return state.tabs.some((tab) => tab.id === action.id)
        ? { ...state, activeTabId: action.id }
        : state;
    case 'navigate': {
      const tab = state.tabs.find((item) => item.id === action.tabId);
      if (!tab) return state;
      const entry = entryFor(action.url, action.title);
      const entries = tab.entries.slice(0, tab.index + 1);
      if (action.replace && entries.length > 0) entries[entries.length - 1] = entry;
      else entries.push(entry);
      const capped = entries.slice(-50);
      const tabs = state.tabs.map((item) =>
        item.id === tab.id ? { ...item, entries: capped, index: capped.length - 1 } : item,
      );
      let next: BrowserState = { ...state, tabs };
      if (action.record !== false) {
        const history = historyFor(entry);
        if (history) next = { ...next, history: withHistory(next.history, history) };
      }
      return next;
    }
    case 'back': {
      const tab = state.tabs.find((item) => item.id === action.tabId);
      if (!tab || tab.index <= 0) return state;
      return {
        ...state,
        tabs: state.tabs.map((item) =>
          item.id === tab.id ? { ...item, index: item.index - 1 } : item,
        ),
      };
    }
    case 'forward': {
      const tab = state.tabs.find((item) => item.id === action.tabId);
      if (!tab || tab.index >= tab.entries.length - 1) return state;
      return {
        ...state,
        tabs: state.tabs.map((item) =>
          item.id === tab.id ? { ...item, index: item.index + 1 } : item,
        ),
      };
    }
    case 'reload':
      return { ...state, reloadTick: state.reloadTick + 1 };
    case 'add-bookmark':
      if (state.bookmarks.some((bookmark) => bookmark.url === action.bookmark.url)) return state;
      return {
        ...state,
        bookmarks: [action.bookmark, ...state.bookmarks].slice(0, MAX_BOOKMARKS),
      };
    case 'remove-bookmark':
      return { ...state, bookmarks: state.bookmarks.filter((item) => item.id !== action.id) };
    case 'add-history':
      return { ...state, history: withHistory(state.history, action.entry) };
    case 'remove-history':
      return { ...state, history: state.history.filter((item) => item.id !== action.id) };
    case 'clear-history':
      return { ...state, history: [] };
    case 'add-recent': {
      const query = action.query.trim();
      if (!query) return state;
      const rest = state.recentSearches.filter(
        (item) => item.query.toLowerCase() !== query.toLowerCase(),
      );
      return {
        ...state,
        recentSearches: [{ query, at: Date.now() }, ...rest].slice(0, MAX_RECENT),
      };
    }
    case 'clear-recent':
      return { ...state, recentSearches: [] };
    case 'update-settings':
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case 'set-weather':
      return { ...state, weather: action.data };
    case 'reset':
      return freshState();
    default:
      return state;
  }
}

function sanitizePlace(raw: unknown): WeatherPlace | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as WeatherPlace;
  if (
    typeof value.label !== 'string' ||
    typeof value.lat !== 'number' ||
    typeof value.lon !== 'number' ||
    !Number.isFinite(value.lat) ||
    !Number.isFinite(value.lon)
  ) {
    return null;
  }
  return {
    label: value.label,
    detail: typeof value.detail === 'string' ? value.detail : undefined,
    lat: value.lat,
    lon: value.lon,
  };
}

function sanitizeSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const value = raw as Record<string, unknown>;
  const bool = (key: keyof Settings) =>
    typeof value[key] === 'boolean' ? (value[key] as boolean) : (DEFAULT_SETTINGS[key] as boolean);
  return {
    engine: ENGINES.some((engine) => engine.id === value.engine)
      ? (value.engine as EngineId)
      : DEFAULT_SETTINGS.engine,
    wallpaper: WALLPAPERS.some((wallpaper) => wallpaper.id === value.wallpaper)
      ? (value.wallpaper as Settings['wallpaper'])
      : DEFAULT_SETTINGS.wallpaper,
    accent: ACCENTS.some((accent) => accent.id === value.accent)
      ? (value.accent as Settings['accent'])
      : DEFAULT_SETTINGS.accent,
    grain: bool('grain'),
    showClock: bool('showClock'),
    weather: bool('weather'),
    weatherPlace: sanitizePlace(value.weatherPlace),
    linkTarget:
      value.linkTarget === 'inline' || value.linkTarget === 'external'
        ? (value.linkTarget as LinkTarget)
        : DEFAULT_SETTINGS.linkTarget,
    searchDirectly: bool('searchDirectly'),
  };
}

function sanitizeBookmarks(raw: unknown): Bookmark[] {
  if (!Array.isArray(raw)) return SEED_BOOKMARKS.map((item) => ({ ...item }));
  return raw
    .filter(
      (item): item is Bookmark =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as Bookmark).id === 'string' &&
        typeof (item as Bookmark).title === 'string' &&
        typeof (item as Bookmark).url === 'string' &&
        isWebUrl((item as Bookmark).url),
    )
    .slice(0, MAX_BOOKMARKS);
}

function sanitizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is HistoryEntry =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as HistoryEntry).url === 'string' &&
        typeof (item as HistoryEntry).title === 'string' &&
        typeof (item as HistoryEntry).visitedAt === 'number' &&
        ((item as HistoryEntry).type === 'page' || (item as HistoryEntry).type === 'search'),
    )
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, MAX_HISTORY);
}

function sanitizeRecent(raw: unknown): RecentSearch[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is RecentSearch =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as RecentSearch).query === 'string' &&
        typeof (item as RecentSearch).at === 'number',
    )
    .slice(0, MAX_RECENT);
}

function sanitizeWeather(raw: unknown): WeatherData | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as WeatherData;
  if (
    typeof value.temp !== 'number' ||
    typeof value.code !== 'number' ||
    typeof value.at !== 'number'
  ) {
    return null;
  }
  if (Date.now() - value.at > 6 * 60 * 60 * 1000) return null;
  return value;
}

function sanitizeTab(raw: unknown): Tab | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Tab;
  if (typeof value.id !== 'string' || !Array.isArray(value.entries) || value.entries.length === 0) {
    return null;
  }
  const entries = value.entries
    .filter(
      (entry): entry is NavEntry =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof entry.url === 'string' &&
        typeof entry.title === 'string' &&
        (isWebUrl(entry.url) || Boolean(parseInternal(entry.url))),
    )
    .slice(-50);
  if (entries.length === 0) return null;
  const index = Math.min(Math.max(0, Number(value.index) || 0), entries.length - 1);
  return { id: value.id, entries, index };
}

function loadTabs(): { tabs: Tab[]; activeTabId: string } {
  const saved = readSession<{ tabs?: unknown; activeTabId?: unknown } | null>('tabs', null);
  if (saved && Array.isArray(saved.tabs)) {
    const tabs = saved.tabs
      .map(sanitizeTab)
      .filter((tab): tab is Tab => Boolean(tab))
      .slice(0, MAX_TABS);
    if (tabs.length > 0) {
      const activeTabId =
        typeof saved.activeTabId === 'string' && tabs.some((tab) => tab.id === saved.activeTabId)
          ? saved.activeTabId
          : tabs[0].id;
      return { tabs, activeTabId };
    }
  }
  const tab = makeTab(buildInternal('newtab'));
  return { tabs: [tab], activeTabId: tab.id };
}

function createInitialState(): BrowserState {
  const { tabs, activeTabId } = loadTabs();
  return {
    tabs,
    activeTabId,
    bookmarks: sanitizeBookmarks(readStored<unknown>('bookmarks', null)),
    history: sanitizeHistory(readStored<unknown>('history', null)),
    recentSearches: sanitizeRecent(readStored<unknown>('recent', null)),
    settings: sanitizeSettings(readStored<unknown>('settings', null)),
    weather: sanitizeWeather(readStored<unknown>('weather', null)),
    reloadTick: 0,
  };
}

function canonical(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return url;
  }
}

export interface NavigateOptions {
  tabId?: string;
  newTab?: boolean;
  replace?: boolean;
  record?: boolean;
  title?: string;
}

export interface BrowserContextValue {
  state: BrowserState;
  activeTab: Tab;
  activeEntry: NavEntry;
  route: ReturnType<typeof parseInternal>;
  canGoBack: boolean;
  canGoForward: boolean;
  focusTick: number;
  toasts: ToastMessage[];
  weatherLoading: boolean;
  newTab: (url?: string, title?: string) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  navigate: (url: string, options?: NavigateOptions) => void;
  search: (query: string) => void;
  openLink: (url: string, title?: string) => void;
  openExternalLink: (url: string, title?: string) => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  focusSearch: () => void;
  toggleBookmark: (url?: string, title?: string) => void;
  removeBookmark: (id: string) => void;
  isBookmarked: (url: string) => boolean;
  setSettings: (patch: Partial<Settings>) => void;
  removeHistory: (id: string) => void;
  clearHistory: () => void;
  clearRecent: () => void;
  refreshWeather: (place?: WeatherPlace | null) => void;
  resetAll: () => void;
  showToast: (message: string, action?: ToastAction) => void;
  dismissToast: (id: string) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  copy: (text: string, message?: string) => void;
}

const BrowserContext = createContext<BrowserContextValue | null>(null);

export function BrowserProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [focusTick, setFocusTick] = useState(0);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const timers = useRef<number[]>([]);
  const autoWeatherDone = useRef(false);

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
  const activeEntry = activeTab.entries[activeTab.index] ?? activeTab.entries[0];
  const route = parseInternal(activeEntry.url);

  useEffect(() => {
    writeStored('settings', state.settings);
  }, [state.settings]);

  useEffect(() => {
    writeStored('bookmarks', state.bookmarks);
  }, [state.bookmarks]);

  useEffect(() => {
    writeStored('history', state.history);
  }, [state.history]);

  useEffect(() => {
    writeStored('recent', state.recentSearches);
  }, [state.recentSearches]);

  useEffect(() => {
    writeStored('weather', state.weather);
  }, [state.weather]);

  useEffect(() => {
    writeSession('tabs', { tabs: state.tabs, activeTabId: state.activeTabId });
  }, [state.tabs, state.activeTabId]);

  useEffect(() => {
    if (autoWeatherDone.current) return;
    autoWeatherDone.current = true;
    if (!state.settings.weather || !state.settings.weatherPlace || state.weather) return;
    refreshWeather(state.settings.weatherPlace);
    // Runs once for the saved place; later refreshes stay manual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.accent = state.settings.accent;
    root.dataset.wallpaper = state.settings.wallpaper;
    root.dataset.grain = state.settings.grain ? 'on' : 'off';
  }, [state.settings.accent, state.settings.wallpaper, state.settings.grain]);

  useEffect(() => {
    return () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, action?: ToastAction) => {
      const id = uid();
      setToasts((current) => [...current.slice(-2), { id, message, action }]);
      const timer = window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 4600);
      timers.current.push(timer);
    },
    [],
  );

  const copy = useCallback(
    (text: string, message = 'Скопировано') => {
      void copyText(text).then((ok) => {
        showToast(ok ? message : 'Не удалось скопировать');
      });
    },
    [showToast],
  );

  const newTab = useCallback((url = buildInternal('newtab'), title?: string) => {
    dispatch({ type: 'new-tab', url, title, activate: true });
  }, []);

  const closeTab = useCallback((id: string) => {
    dispatch({ type: 'close-tab', id });
  }, []);

  const activateTab = useCallback((id: string) => {
    dispatch({ type: 'activate-tab', id });
  }, []);

  const navigate = useCallback(
    (url: string, options: NavigateOptions = {}) => {
      const parsedRoute = parseInternal(url);
      if (parsedRoute?.page === 'search' && parsedRoute.query?.trim()) {
        dispatch({ type: 'add-recent', query: parsedRoute.query.trim() });
      }
      if (options.newTab) {
        dispatch({
          type: 'new-tab',
          url,
          title: options.title,
          activate: true,
        });
        return;
      }
      dispatch({
        type: 'navigate',
        tabId: options.tabId ?? activeTab.id,
        url,
        title: options.title,
        replace: options.replace,
        record: options.record,
      });
    },
    [activeTab.id],
  );

  const tryExternal = useCallback(
    (url: string, title?: string): boolean => {
      if (!isWebUrl(url)) return false;
      if (!openExternal(url)) return false;
      const entry: HistoryEntry = {
        id: uid(),
        url,
        title: title?.trim() || hostOf(url),
        visitedAt: Date.now(),
        type: 'page',
      };
      dispatch({ type: 'add-history', entry });
      return true;
    },
    [],
  );

  const openExternalLink = useCallback(
    (url: string, title?: string) => {
      if (tryExternal(url, title)) return;
      showToast('Браузер заблокировал новую вкладку', {
        label: 'Скопировать ссылку',
        onClick: () => copy(url, 'Ссылка скопирована'),
      });
    },
    [copy, showToast, tryExternal],
  );

  const openLink = useCallback(
    (url: string, title?: string) => {
      if (state.settings.linkTarget === 'external') {
        if (tryExternal(url, title)) return;
        navigate(url, { title });
        return;
      }
      navigate(url, { title });
    },
    [navigate, state.settings.linkTarget, tryExternal],
  );

  const search = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      dispatch({ type: 'add-recent', query: trimmed });
      const engine = getEngine(state.settings.engine);
      if (state.settings.searchDirectly) {
        if (tryExternal(engine.searchUrl(trimmed), trimmed)) return;
      }
      navigate(buildInternal('search', trimmed), { record: true });
    },
    [navigate, state.settings.engine, state.settings.searchDirectly, tryExternal],
  );

  const back = useCallback(() => {
    dispatch({ type: 'back', tabId: activeTab.id });
  }, [activeTab.id]);

  const forward = useCallback(() => {
    dispatch({ type: 'forward', tabId: activeTab.id });
  }, [activeTab.id]);

  const reload = useCallback(() => {
    dispatch({ type: 'reload' });
  }, []);

  const focusSearch = useCallback(() => {
    setFocusTick((tick) => tick + 1);
  }, []);

  const isBookmarked = useCallback(
    (url: string) => state.bookmarks.some((bookmark) => canonical(bookmark.url) === canonical(url)),
    [state.bookmarks],
  );

  const toggleBookmark = useCallback(
    (url?: string, title?: string) => {
      const targetUrl = url ?? activeEntry.url;
      if (!isWebUrl(targetUrl)) {
        showToast('Эту страницу нельзя добавить в закладки');
        return;
      }
      const existing = state.bookmarks.find(
        (bookmark) => canonical(bookmark.url) === canonical(targetUrl),
      );
      if (existing) {
        dispatch({ type: 'remove-bookmark', id: existing.id });
        showToast('Удалено из закладок');
        return;
      }
      dispatch({
        type: 'add-bookmark',
        bookmark: {
          id: uid(),
          title: title?.trim() || titleForUrl(targetUrl),
          url: targetUrl,
          addedAt: Date.now(),
        },
      });
      showToast('Добавлено в закладки');
    },
    [activeEntry.url, showToast, state.bookmarks],
  );

  const removeBookmark = useCallback(
    (id: string) => {
      const bookmark = state.bookmarks.find((item) => item.id === id);
      if (!bookmark) return;
      dispatch({ type: 'remove-bookmark', id });
      showToast('Удалено из закладок', {
        label: 'Вернуть',
        onClick: () => dispatch({ type: 'add-bookmark', bookmark }),
      });
    },
    [showToast, state.bookmarks],
  );

  const setSettings = useCallback((patch: Partial<Settings>) => {
    dispatch({ type: 'update-settings', patch });
  }, []);

  const removeHistory = useCallback((id: string) => {
    dispatch({ type: 'remove-history', id });
  }, []);

  const clearHistory = useCallback(() => {
    dispatch({ type: 'clear-history' });
  }, []);

  const clearRecent = useCallback(() => {
    dispatch({ type: 'clear-recent' });
  }, []);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const refreshWeather = useCallback(
    (placeOverride?: WeatherPlace | null) => {
      if (weatherLoading) return;
      const place =
        placeOverride === undefined ? state.settings.weatherPlace : placeOverride;
      setWeatherLoading(true);
      const task = place
        ? fetchWeather(place.lat, place.lon).then((data) => ({
            ...data,
            place: place.label,
          }))
        : requestCoordinates().then((coords) =>
            fetchWeather(coords.lat, coords.lon).then((data) => ({ ...data })),
          );
      task
        .then((data) => {
          dispatch({ type: 'set-weather', data });
        })
        .catch((error: unknown) => {
          const denied =
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            (error as GeolocationPositionError).code === 1;
          showToast(
            denied
              ? 'Геолокация закрыта — выберите город вручную'
              : 'Не удалось получить погоду. Попробуйте позже',
            denied
              ? {
                  label: 'Выбрать город',
                  onClick: () => navigateRef.current(buildInternal('settings')),
                }
              : undefined,
          );
        })
        .finally(() => {
          setWeatherLoading(false);
        });
    },
    [showToast, state.settings.weatherPlace, weatherLoading],
  );

  const resetAll = useCallback(() => {
    clearStored();
    dispatch({ type: 'reset' });
    showToast('Все данные ByAzen сброшены');
  }, [showToast]);

  const value = useMemo<BrowserContextValue>(
    () => ({
      state,
      activeTab,
      activeEntry,
      route,
      canGoBack: activeTab.index > 0,
      canGoForward: activeTab.index < activeTab.entries.length - 1,
      focusTick,
      toasts,
      weatherLoading,
      newTab,
      closeTab,
      activateTab,
      navigate,
      search,
      openLink,
      openExternalLink,
      back,
      forward,
      reload,
      focusSearch,
      toggleBookmark,
      removeBookmark,
      isBookmarked,
      setSettings,
      removeHistory,
      clearHistory,
      clearRecent,
      refreshWeather,
      resetAll,
      showToast,
      dismissToast,
      shortcutsOpen,
      setShortcutsOpen,
      copy,
    }),
    [
      state,
      activeTab,
      activeEntry,
      route,
      focusTick,
      toasts,
      weatherLoading,
      newTab,
      closeTab,
      activateTab,
      navigate,
      search,
      openLink,
      openExternalLink,
      back,
      forward,
      reload,
      focusSearch,
      toggleBookmark,
      removeBookmark,
      isBookmarked,
      setSettings,
      removeHistory,
      clearHistory,
      clearRecent,
      refreshWeather,
      resetAll,
      showToast,
      dismissToast,
      shortcutsOpen,
      copy,
    ],
  );

  return <BrowserContext.Provider value={value}>{children}</BrowserContext.Provider>;
}

export function useBrowser(): BrowserContextValue {
  const context = useContext(BrowserContext);
  if (!context) throw new Error('useBrowser must be used inside BrowserProvider');
  return context;
}
