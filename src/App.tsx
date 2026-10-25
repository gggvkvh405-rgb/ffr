import { useEffect } from 'react';
import { useBrowser } from './state/browser-store';
import { buildInternal, isWebUrl } from './lib/url';
import { TabStrip } from './components/TabStrip';
import { Toolbar } from './components/Toolbar';
import { StatusBar } from './components/StatusBar';
import { NewTabPage } from './components/newtab/NewTabPage';
import { SearchPage } from './components/pages/SearchPage';
import { BookmarksPage } from './components/pages/BookmarksPage';
import { HistoryPage } from './components/pages/HistoryPage';
import { SettingsPage } from './components/pages/SettingsPage';
import { SiteView } from './components/pages/SiteView';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { Toasts } from './components/Toasts';

function PageView() {
  const { activeTab, activeEntry, route, state } = useBrowser();
  const pageKey = `${activeTab.id}:${state.reloadTick}:${activeEntry.url}`;

  if (route) {
    switch (route.page) {
      case 'newtab':
        return <NewTabPage key={pageKey} />;
      case 'search':
        return <SearchPage key={pageKey} query={route.query ?? ''} />;
      case 'bookmarks':
        return <BookmarksPage key={pageKey} />;
      case 'history':
        return <HistoryPage key={pageKey} />;
      case 'settings':
        return <SettingsPage key={pageKey} />;
      default:
        return <NewTabPage key={pageKey} />;
    }
  }

  if (isWebUrl(activeEntry.url)) {
    return <SiteView key={pageKey} url={activeEntry.url} />;
  }

  return <NewTabPage key={pageKey} />;
}

function useKeyboardShortcuts() {
  const {
    focusSearch,
    newTab,
    closeTab,
    back,
    forward,
    activateTab,
    navigate,
    activeTab,
    state,
    shortcutsOpen,
    setShortcutsOpen,
  } = useBrowser();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      const mod = event.metaKey || event.ctrlKey;

      if (mod && !event.altKey && (event.code === 'KeyL' || event.code === 'KeyK')) {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (mod && !event.altKey && !typing) {
        if (event.code === 'KeyT') {
          event.preventDefault();
          newTab();
          return;
        }
        if (event.code === 'KeyW') {
          event.preventDefault();
          closeTab(activeTab.id);
          return;
        }
      }

      if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        if (event.key === 'ArrowLeft') back();
        else forward();
        return;
      }

      if (typing || mod || event.altKey) return;
      if (shortcutsOpen || document.body.classList.contains('has-dialog')) return;

      const key = event.key;
      if (key === '/') {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      const lower = key.toLowerCase();
      if (lower === 't') {
        event.preventDefault();
        newTab();
        return;
      }
      if (lower === 'w') {
        event.preventDefault();
        closeTab(activeTab.id);
        return;
      }
      if (lower === 'b') {
        event.preventDefault();
        navigate(buildInternal('bookmarks'));
        return;
      }
      if (lower === 'h') {
        event.preventDefault();
        navigate(buildInternal('history'));
        return;
      }
      if (key === ',') {
        event.preventDefault();
        navigate(buildInternal('settings'));
        return;
      }
      if (/^[1-9]$/.test(key)) {
        const index = key === '9' ? state.tabs.length - 1 : Number(key) - 1;
        const tab = state.tabs[index];
        if (tab) {
          event.preventDefault();
          activateTab(tab.id);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activateTab,
    activeTab.id,
    back,
    closeTab,
    focusSearch,
    forward,
    navigate,
    newTab,
    setShortcutsOpen,
    shortcutsOpen,
    state.tabs,
  ]);
}

function Shell() {
  const { route, activeEntry } = useBrowser();
  const hasToolbar = route?.page !== 'newtab';
  useKeyboardShortcuts();

  useEffect(() => {
    document.title =
      activeEntry.title === 'Новая вкладка'
        ? 'ByAzen — тихий браузер'
        : `${activeEntry.title} — ByAzen`;
  }, [activeEntry.title]);

  return (
    <div className={`app ${hasToolbar ? 'app--chrome' : ''}`}>
      <a className="skip-link" href="#main-content">
        К содержимому
      </a>
      <div className="ambient" aria-hidden="true">
        <div className="ambient-noise" />
      </div>
      <TabStrip />
      {hasToolbar ? <Toolbar /> : null}
      <main className="stage" id="main-content">
        <PageView />
      </main>
      <StatusBar />
      <Toasts />
      <ShortcutsDialog />
    </div>
  );
}

export function App() {
  return <Shell />;
}
