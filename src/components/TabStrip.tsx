import {
  Bookmark,
  History,
  Plus,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import { useEffect, type KeyboardEvent } from 'react';
import { useBrowser } from '../state/browser-store';
import { buildInternal, isWebUrl, parseInternal } from '../lib/url';
import type { NavEntry } from '../lib/types';
import { LogoMark } from './ui/Logo';
import { SiteIcon } from './ui/SiteIcon';
import { IconButton } from './ui/IconButton';

function TabIcon({ entry }: { entry: NavEntry }) {
  const route = parseInternal(entry.url);
  if (route) {
    if (route.page === 'newtab') return <LogoMark size={14} />;
    if (route.page === 'search') return <Search size={13} strokeWidth={1.9} />;
    if (route.page === 'bookmarks') return <Bookmark size={13} strokeWidth={1.9} />;
    if (route.page === 'history') return <History size={13} strokeWidth={1.9} />;
    return <Settings2 size={13} strokeWidth={1.9} />;
  }
  if (isWebUrl(entry.url)) return <SiteIcon url={entry.url} size={13} />;
  return <LogoMark size={14} />;
}

export function TabStrip() {
  const {
    state,
    activeTab,
    route,
    newTab,
    activateTab,
    closeTab,
    navigate,
  } = useBrowser();

  useEffect(() => {
    const node = document.getElementById(`tab-button-${activeTab.id}`);
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab.id, state.tabs.length]);

  const tabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % state.tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + state.tabs.length) % state.tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = state.tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = state.tabs[nextIndex];
    activateTab(nextTab.id);
    window.requestAnimationFrame(() => {
      document.getElementById(`tab-button-${nextTab.id}`)?.focus();
    });
  };

  return (
    <header className={`topbar ${route?.page === 'newtab' ? '' : 'topbar--chrome'}`}>
      <button
        type="button"
        className="brand"
        onClick={() => navigate(buildInternal('newtab'))}
        aria-label="ByAzen — на главную"
        data-tip="На главную"
        data-tip-side="bottom"
      >
        <span className="brand-mark">
          <LogoMark size={21} />
        </span>
        <span className="wordmark">ByAzen</span>
      </button>

      <div className="tabs-scroll">
        <div className="tabs" role="tablist" aria-label="Вкладки">
          {state.tabs.map((tab, index) => {
            const entry = tab.entries[tab.index] ?? tab.entries[0];
            const active = tab.id === activeTab.id;
            return (
              <div className={`tab ${active ? 'is-active' : ''}`} key={tab.id}>
                <button
                  type="button"
                  role="tab"
                  id={`tab-button-${tab.id}`}
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  className="tab-main"
                  title={entry.title}
                  onClick={() => activateTab(tab.id)}
                  onAuxClick={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                      closeTab(tab.id);
                    }
                  }}
                  onKeyDown={(event) => tabKeyDown(event, index)}
                >
                  <span className="tab-icon">
                    <TabIcon entry={entry} />
                  </span>
                  <span className="tab-title">{entry.title}</span>
                </button>
                <button
                  type="button"
                  className="tab-close"
                  aria-label={`Закрыть вкладку «${entry.title}»`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <IconButton
        label="Новая вкладка"
        size="sm"
        className="new-tab-button"
        onClick={() => newTab()}
      >
        <Plus size={15} strokeWidth={1.9} />
      </IconButton>
      <span className="topbar-spacer" aria-hidden="true" />

      <div className="topbar-actions">
        <IconButton
          label="Закладки"
          size="sm"
          active={route?.page === 'bookmarks'}
          onClick={() => navigate(buildInternal('bookmarks'))}
        >
          <Bookmark size={16} strokeWidth={1.7} />
        </IconButton>
        <IconButton
          label="История"
          size="sm"
          active={route?.page === 'history'}
          onClick={() => navigate(buildInternal('history'))}
        >
          <History size={16} strokeWidth={1.7} />
        </IconButton>
        <IconButton
          label="Настройки"
          size="sm"
          active={route?.page === 'settings'}
          onClick={() => navigate(buildInternal('settings'))}
        >
          <Settings2 size={16} strokeWidth={1.7} />
        </IconButton>
      </div>
    </header>
  );
}
