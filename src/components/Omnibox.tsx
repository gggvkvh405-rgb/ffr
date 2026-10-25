import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  Clock,
  CornerDownLeft,
  ExternalLink,
  Globe,
  History,
  Lock,
  Search,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import { useBrowser } from '../state/browser-store';
import { EngineIcon } from './ui/EngineIcon';
import { SiteIcon } from './ui/SiteIcon';
import { LogoMark } from './ui/Logo';
import { ENGINES, getEngine } from '../lib/engines';
import { buildInternal, hostOf, parseInput, prettyUrl, withoutProtocol } from '../lib/url';
import { fetchWikiSuggestions, type WikiSuggestion } from '../lib/search';
import { useOutsideClick } from '../hooks/useUi';

interface Suggestion {
  key: string;
  title: ReactNode;
  meta?: ReactNode;
  icon: ReactNode;
  action: () => void;
  primary?: boolean;
}

interface Section {
  key: string;
  label: string;
  action?: ReactNode;
  items: Suggestion[];
}

interface OmniboxProps {
  variant: 'hero' | 'toolbar';
  autoFocus?: boolean;
  showEngine?: boolean;
  placeholder?: string;
}

const COMMANDS = [
  {
    key: 'settings',
    label: 'Настройки',
    keywords: 'настройки настройка settings тема оформление поиск данные',
    route: 'settings' as const,
    icon: <Settings2 size={16} strokeWidth={1.7} />,
  },
  {
    key: 'history',
    label: 'История',
    keywords: 'история посещения history активность',
    route: 'history' as const,
    icon: <History size={16} strokeWidth={1.7} />,
  },
  {
    key: 'bookmarks',
    label: 'Закладки',
    keywords: 'закладки избранное bookmark библиотека',
    route: 'bookmarks' as const,
    icon: <Bookmark size={16} strokeWidth={1.7} />,
  },
];

function Highlight({ text, query }: { text: string; query: string }) {
  const index = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (index < 0 || !query) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

export function Omnibox({ variant, autoFocus = false, showEngine = true, placeholder }: OmniboxProps) {
  const {
    activeEntry,
    route,
    navigate,
    search,
    openExternalLink,
    state,
    setSettings,
    clearRecent,
    focusTick,
  } = useBrowser();
  const engine = getEngine(state.settings.engine);
  const displayValue =
    variant === 'toolbar'
      ? route?.page === 'search'
        ? (route.query ?? '')
        : route
          ? activeEntry.url
          : withoutProtocol(activeEntry.url)
      : '';

  const [value, setValue] = useState(displayValue);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [wiki, setWiki] = useState<WikiSuggestion[]>([]);
  const [engineMenu, setEngineMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const rootRef = useOutsideClick<HTMLDivElement>(() => {
    setEngineMenu(false);
    setFocused(false);
  });

  useEffect(() => {
    if (!focused) setValue(displayValue);
  }, [displayValue, focused]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [value]);

  useEffect(() => {
    if (focusTick === 0) return;
    const input = inputRef.current;
    if (!input) return;
    setValue(displayValue);
    setFocused(true);
    input.focus();
    input.select();
    // displayValue intentionally not a dependency: focus shortcuts should re-select current text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  useEffect(() => {
    if (!autoFocus) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 360);
    return () => window.clearTimeout(timer);
  }, [autoFocus]);

  useEffect(() => {
    if (engineMenu) setWiki([]);
  }, [engineMenu]);

  const trimmed = value.trim();
  const commandMode = trimmed.startsWith('>');
  const commandQuery = commandMode ? trimmed.slice(1).trim().toLowerCase() : '';
  const parsed = useMemo(() => parseInput(trimmed), [trimmed]);
  const highlightQuery = commandMode ? '' : trimmed;

  useEffect(() => {
    if (!focused || engineMenu) {
      setWiki([]);
      return;
    }
    if (!trimmed || commandMode || parsed.kind !== 'query' || trimmed.length < 2) {
      setWiki([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchWikiSuggestions(trimmed, controller.signal)
        .then((items) => setWiki(items))
        .catch(() => setWiki([]));
    }, 260);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, focused, engineMenu, commandMode, parsed.kind]);

  const sections = useMemo<Section[]>(() => {
    const result: Section[] = [];
    const lower = highlightQuery.toLowerCase();
    const matches = (text: string) => !lower || text.toLowerCase().includes(lower);

    const commandItems = COMMANDS.filter(
      (command) =>
        !commandQuery ||
        command.label.toLowerCase().includes(commandQuery) ||
        command.keywords.includes(commandQuery),
    ).map<Suggestion>((command) => ({
      key: `command-${command.key}`,
      title: command.label,
      meta: `byazen://${command.route}`,
      icon: command.icon,
      action: () => navigate(buildInternal(command.route)),
    }));

    if (commandMode) {
      if (commandItems.length > 0) {
        result.push({ key: 'commands', label: 'Команды', items: commandItems });
      }
      return result;
    }

    if (trimmed) {
      if (parsed.kind === 'query') {
        result.push({
          key: 'primary',
          label: 'Поиск',
          items: [
            {
              key: 'go-query',
              title: (
                <>
                  Искать <span className="suggestion-query">«{trimmed}»</span>
                </>
              ),
              meta: 'в ByAzen',
              icon: <Search size={16} strokeWidth={1.7} />,
              action: () => search(parsed.query),
              primary: true,
            },
            {
              key: 'go-engine',
              title: `Открыть результаты в ${engine.name}`,
              meta: engine.host,
              icon: <EngineIcon id={engine.id} size={15} />,
              action: () => openExternalLink(engine.searchUrl(parsed.query), parsed.query),
            },
          ],
        });
      } else if (parsed.kind === 'url') {
        const host = hostOf(parsed.url);
        result.push({
          key: 'url',
          label: 'Адрес',
          items: [
            {
              key: 'go-url',
              title: (
                <>
                  Перейти на <span className="suggestion-query">{host}</span>
                </>
              ),
              meta: prettyUrl(parsed.url),
              icon: <Globe size={16} strokeWidth={1.7} />,
              action: () => navigate(parsed.url),
              primary: true,
            },
            {
              key: 'go-url-external',
              title: 'Открыть в новой вкладке браузера',
              meta: host,
              icon: <ExternalLink size={15} strokeWidth={1.7} />,
              action: () => openExternalLink(parsed.url, host),
            },
          ],
        });
      } else {
        const pageLabel =
          parsed.route.page === 'newtab'
            ? 'Новая вкладка'
            : parsed.route.page === 'search'
              ? 'Поиск'
              : parsed.route.page === 'bookmarks'
                ? 'Закладки'
                : parsed.route.page === 'history'
                  ? 'История'
                  : 'Настройки';
        result.push({
          key: 'internal',
          label: 'ByAzen',
          items: [
            {
              key: 'go-internal',
              title: `Открыть «${pageLabel}»`,
              meta: parsed.url,
              icon: <LogoMark size={16} />,
              action: () => navigate(parsed.url),
              primary: true,
            },
          ],
        });
      }
    }

    if (!trimmed) {
      if (state.recentSearches.length > 0) {
        result.push({
          key: 'recent',
          label: 'Недавние запросы',
          action: (
            <button
              type="button"
              className="suggest-clear"
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearRecent}
            >
              Очистить
            </button>
          ),
          items: state.recentSearches.slice(0, 5).map<Suggestion>((item) => ({
            key: `recent-${item.query}`,
            title: item.query,
            meta: 'повторить',
            icon: <Clock size={15} strokeWidth={1.7} />,
            action: () => search(item.query),
          })),
        });
      } else {
        result.push({
          key: 'commands-empty',
          label: 'Быстрые действия',
          items: COMMANDS.map<Suggestion>((command) => ({
            key: `command-empty-${command.key}`,
            title: command.label,
            meta: `byazen://${command.route}`,
            icon: command.icon,
            action: () => navigate(buildInternal(command.route)),
          })),
        });
      }
    }

    if (lower) {
      const historyItems = state.history
        .filter((entry) => matches(entry.title) || matches(entry.url))
        .slice(0, 3)
        .map<Suggestion>((entry) => ({
          key: `history-${entry.id}`,
          title: <Highlight text={entry.title} query={highlightQuery} />,
          meta: entry.type === 'search' ? 'поиск' : prettyUrl(entry.url),
          icon: <History size={15} strokeWidth={1.7} />,
          action: () => navigate(entry.url, { title: entry.title }),
        }));
      if (historyItems.length > 0) {
        result.push({ key: 'history', label: 'История', items: historyItems });
      }

      const bookmarkItems = state.bookmarks
        .filter((bookmark) => matches(bookmark.title) || matches(bookmark.url))
        .slice(0, 3)
        .map<Suggestion>((bookmark) => ({
          key: `bookmark-${bookmark.id}`,
          title: <Highlight text={bookmark.title} query={highlightQuery} />,
          meta: prettyUrl(bookmark.url),
          icon: <SiteIcon url={bookmark.url} size={15} />,
          action: () => navigate(bookmark.url, { title: bookmark.title }),
        }));
      if (bookmarkItems.length > 0) {
        result.push({ key: 'bookmarks', label: 'Закладки', items: bookmarkItems });
      }
    }

    if (parsed.kind === 'query' && wiki.length > 0 && trimmed) {
      result.push({
        key: 'wiki',
        label: 'Википедия',
        items: wiki.slice(0, 5).map<Suggestion>((item) => ({
          key: `wiki-${item.title}`,
          title: <Highlight text={item.title} query={trimmed} />,
          meta: 'ru.wikipedia.org',
          icon: <Sparkles size={15} strokeWidth={1.7} />,
          action: () => navigate(item.url, { title: item.title }),
        })),
      });
    }

    const hasMatches = result.some((section) =>
      ['history', 'bookmarks', 'wiki'].includes(section.key),
    );
    if (trimmed && !hasMatches && commandItems.length > 0) {
      result.push({ key: 'commands', label: 'Быстрые действия', items: commandItems });
    }

    return result;
  }, [
    commandMode,
    commandQuery,
    engine,
    highlightQuery,
    navigate,
    openExternalLink,
    parsed,
    search,
    state.bookmarks,
    state.history,
    state.recentSearches,
    trimmed,
    wiki,
    clearRecent,
  ]);

  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const activeItem = activeIndex >= 0 ? flat[activeIndex] : undefined;
  const showPanel =
    focused &&
    (flat.length > 0 || (commandMode && trimmed.length > 0)) &&
    !engineMenu;
  const showEngineMenu = engineMenu;

  useEffect(() => {
    if (activeIndex < 0) return;
    const node = panelRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const close = () => {
    setFocused(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
  };

  const execute = (item: Suggestion) => {
    close();
    item.action();
  };

  const submit = () => {
    const text = value.trim();
    if (!text) {
      inputRef.current?.focus();
      return;
    }
    if (commandMode) {
      const target = activeItem ?? flat[0];
      if (target) execute(target);
      return;
    }
    close();
    const current = parseInput(text);
    if (current.kind === 'query') {
      if (current.query) search(current.query);
      return;
    }
    navigate(current.url);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const target = activeItem ?? (showPanel ? flat[0] : undefined);
    if (target) {
      if (commandMode || activeItem) {
        execute(target);
        return;
      }
    }
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!showPanel || flat.length === 0) {
        setFocused(true);
        return;
      }
      setActiveIndex((index) => (index + 1) % flat.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!showPanel || flat.length === 0) return;
      setActiveIndex((index) => (index <= 0 ? flat.length - 1 : index - 1));
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (engineMenu) {
        setEngineMenu(false);
        setFocused(true);
        inputRef.current?.focus();
        return;
      }
      setFocused(false);
      setActiveIndex(-1);
      setValue(displayValue);
      inputRef.current?.blur();
    }
  };

  const sectionOffset = (sectionIndex: number) =>
    sections.slice(0, sectionIndex).reduce((sum, section) => sum + section.items.length, 0);

  return (
    <div className={`omnibox-wrap omnibox-wrap--${variant}`} ref={rootRef}>
      <form
        className={`omnibox omnibox--${variant} ${focused ? 'is-focused' : ''}`}
        onSubmit={handleSubmit}
        role="search"
      >
        <span className="omnibox-leading" aria-hidden="true">
          {variant === 'toolbar' ? (
            route ? (
              route.page === 'search' ? (
                <Search size={15} strokeWidth={1.7} />
              ) : (
                <LogoMark size={16} />
              )
            ) : activeEntry.url.startsWith('https://') ? (
              <Lock size={13} strokeWidth={1.8} />
            ) : (
              <Globe size={14} strokeWidth={1.7} />
            )
          ) : (
            <Search size={19} strokeWidth={1.7} />
          )}
        </span>
        <input
          ref={inputRef}
          className="omnibox-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={(event) => {
            setFocused(true);
            if (variant === 'toolbar' && value !== displayValue) setValue(displayValue);
            setActiveIndex(-1);
            if (variant === 'toolbar') {
              window.requestAnimationFrame(() => event.target.select());
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            placeholder ??
            (variant === 'hero' ? 'Поиск или адрес сайта' : 'Введите адрес или запрос')
          }
          aria-label="Поиск или адрес сайта"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeItem && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined
          }
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        {value && focused ? (
          <button
            type="button"
            className="omnibox-clear"
            aria-label="Очистить"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setValue('');
              inputRef.current?.focus();
            }}
          >
            <X size={13} strokeWidth={2} />
          </button>
        ) : null}
        {showEngine ? (
          <button
            type="button"
            className={`engine-chip ${engineMenu ? 'is-open' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setEngineMenu((open) => !open);
              setActiveIndex(-1);
            }}
            aria-label={`Поисковая система: ${engine.name}`}
            aria-haspopup="listbox"
            aria-expanded={engineMenu}
          >
            <EngineIcon id={engine.id} size={14} />
            <span>{engine.name}</span>
            <ChevronDown size={12} strokeWidth={1.8} className="engine-chip-chevron" />
          </button>
        ) : null}
        <button
          type="submit"
          className="omnibox-submit"
          aria-label="Найти"
          tabIndex={-1}
        >
          <ArrowRight size={variant === 'hero' ? 18 : 14} strokeWidth={2} />
        </button>
      </form>

      {showEngineMenu ? (
        <div className="omnibox-popover omnibox-popover--engines" role="listbox" aria-label="Поисковая система">
          <div className="omnibox-section-label">Поисковая система</div>
          {ENGINES.map((item) => (
            <button
              type="button"
              key={item.id}
              role="option"
              aria-selected={item.id === engine.id}
              className={`engine-option ${item.id === engine.id ? 'is-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setSettings({ engine: item.id });
                setEngineMenu(false);
                inputRef.current?.focus();
              }}
            >
              <span className="suggestion-icon">
                <EngineIcon id={item.id} size={16} />
              </span>
              <span className="suggestion-body">
                <span className="suggestion-title">{item.name}</span>
                <span className="suggestion-meta">{item.host}</span>
              </span>
              {item.id === engine.id ? <Check size={15} className="suggestion-check" /> : null}
            </button>
          ))}
        </div>
      ) : null}

      {showPanel ? (
        <div className="omnibox-popover omnibox-popover--suggest" id={listId} role="listbox" ref={panelRef}>
          {sections.map((section, sectionIndex) => (
            <div className="suggest-section" key={section.key}>
              <div className="omnibox-section-label" role="presentation">
                <span>{section.label}</span>
                {section.action}
              </div>
              {section.items.map((item, itemIndex) => {
                const index = sectionOffset(sectionIndex) + itemIndex;
                const isActive = index === activeIndex;
                return (
                  <div
                    key={item.key}
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    className={`suggestion ${item.primary ? 'suggestion--primary' : ''} ${isActive ? 'is-active' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => execute(item)}
                  >
                    <span className="suggestion-icon">{item.icon}</span>
                    <span className="suggestion-body">
                      <span className="suggestion-title">{item.title}</span>
                      {item.meta ? <span className="suggestion-meta">{item.meta}</span> : null}
                    </span>
                    {isActive ? <CornerDownLeft size={14} className="suggestion-enter" /> : null}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="omnibox-foot" role="presentation">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> выбрать
            </span>
            <span>
              <kbd>↵</kbd> открыть
            </span>
            <span>
              <kbd>esc</kbd> закрыть
            </span>
            {commandMode ? (
              <span className="omnibox-foot-command">
                <kbd>&gt;</kbd> команды
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
