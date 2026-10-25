import { LayoutGrid, Plus } from 'lucide-react';
import { useBrowser } from '../../state/browser-store';
import { useNow } from '../../hooks/useUi';
import { formatDate, formatTime, getGreeting } from '../../lib/time';
import { buildInternal } from '../../lib/url';
import { Omnibox } from '../Omnibox';
import { Kbd } from '../ui/Kbd';
import { SiteIcon } from '../ui/SiteIcon';

function SearchHints() {
  return (
    <div className="search-hints" aria-hidden="true">
      <span className="hint">
        <Kbd>/</Kbd>
        <span>поиск</span>
      </span>
      <span className="hint-sep" />
      <span className="hint">
        <Kbd>T</Kbd>
        <span>вкладка</span>
      </span>
      <span className="hint-sep" />
      <span className="hint">
        <Kbd>?</Kbd>
        <span>клавиши</span>
      </span>
    </div>
  );
}

function FavoritesDock() {
  const { state, openLink, newTab, navigate } = useBrowser();
  const favorites = state.bookmarks.slice(0, 8);

  return (
    <section className="dock" aria-label="Избранное">
      <div className="dock-inner">
        <div className="dock-heading">
          <span className="micro-label">Избранное</span>
        </div>
        <div className="dock-grid">
        {favorites.length === 0 ? (
          <button
            type="button"
            className="dock-item dock-item--ghost"
            onClick={() => navigate(buildInternal('bookmarks'))}
            style={{ animationDelay: '0ms' }}
          >
            <span className="dock-tile">
              <Plus size={20} strokeWidth={1.6} />
            </span>
            <span className="dock-label">Добавить</span>
          </button>
        ) : (
          favorites.map((bookmark, index) => (
            <button
              type="button"
              className="dock-item"
              key={bookmark.id}
              title={bookmark.title}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey) {
                  newTab(bookmark.url, bookmark.title);
                  return;
                }
                openLink(bookmark.url, bookmark.title);
              }}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  newTab(bookmark.url, bookmark.title);
                }
              }}
              style={{ animationDelay: `${index * 34}ms` }}
            >
              <span className="dock-tile">
                <SiteIcon url={bookmark.url} size={23} />
              </span>
              <span className="dock-label">{bookmark.title}</span>
            </button>
          ))
        )}
        <button
          type="button"
          className="dock-item dock-item--all"
          onClick={() => navigate(buildInternal('bookmarks'))}
          style={{ animationDelay: `${Math.min(favorites.length, 8) * 34}ms` }}
        >
          <span className="dock-tile">
            <LayoutGrid size={19} strokeWidth={1.6} />
          </span>
          <span className="dock-label">Все</span>
        </button>
        </div>
      </div>
    </section>
  );
}

export function NewTabPage() {
  const now = useNow(15_000);
  const greeting = getGreeting(now);

  return (
    <div className="newtab">
      <div className="newtab-bg" aria-hidden="true" />
      <div className="newtab-main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-eyebrow">
            <span className="status-dot" aria-hidden="true" />
            <time dateTime={now.toISOString()}>{formatDate(now)}</time>
            <span className="hero-eyebrow-sep" aria-hidden="true" />
            <span className="hero-eyebrow-time">{formatTime(now)}</span>
          </div>
          <h1 className="hero-title" id="hero-title">
            {greeting.lead} <em>{greeting.accent}</em>
            <span className="hero-period">.</span>
          </h1>
          <p className="hero-sub">Интернет — без лишнего шума.</p>
          <Omnibox variant="hero" autoFocus showEngine />
          <SearchHints />
        </section>
        <FavoritesDock />
      </div>
    </div>
  );
}
