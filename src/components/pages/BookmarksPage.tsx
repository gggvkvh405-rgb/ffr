import { useState } from 'react';
import { ArrowUpRight, Bookmark, Plus, Search, X } from 'lucide-react';
import { useBrowser } from '../../state/browser-store';
import { buildInternal, prettyUrl } from '../../lib/url';
import { plural } from '../../lib/time';
import { IconButton } from '../ui/IconButton';
import { SiteIcon } from '../ui/SiteIcon';

export function BookmarksPage() {
  const { state, openLink, openExternalLink, removeBookmark, navigate } = useBrowser();
  const [query, setQuery] = useState('');

  const lower = query.trim().toLowerCase();
  const filtered = state.bookmarks.filter(
    (bookmark) =>
      !lower ||
      bookmark.title.toLowerCase().includes(lower) ||
      bookmark.url.toLowerCase().includes(lower),
  );
  const total = state.bookmarks.length;

  return (
    <div className="page-scroll">
      <div className="page">
        <header className="library-head">
          <div>
            <div className="page-eyebrow">
              <span className="micro-label">Библиотека</span>
              <span className="eyebrow-slash">/</span>
              <span className="micro-label">Сохранённое</span>
            </div>
            <h1 className="page-title">Закладки</h1>
            <p className="page-sub">
              Страницы, к которым хочется возвращаться. Всё хранится только на этом устройстве.
            </p>
          </div>
          <div className="library-stat">
            <span className="library-stat-number">{String(total).padStart(2, '0')}</span>
            <span className="library-stat-label">
              {plural(total, 'страница', 'страницы', 'страниц')}
            </span>
          </div>
        </header>

        <div className="filter-row">
          <label className="filter-input">
            <Search size={15} strokeWidth={1.8} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти в закладках"
              aria-label="Найти в закладках"
            />
            {query ? (
              <button
                type="button"
                className="filter-clear"
                onClick={() => setQuery('')}
                aria-label="Очистить поиск"
              >
                <X size={13} strokeWidth={2} />
              </button>
            ) : null}
          </label>
          <button
            type="button"
            className="button button--soft button--small"
            onClick={() => navigate(buildInternal('newtab'))}
          >
            <Plus size={14} strokeWidth={1.9} />
            На новую вкладку
          </button>
        </div>

        {filtered.length > 0 ? (
          <div className="bookmark-grid">
            {filtered.map((bookmark) => (
              <div className="bookmark-card" key={bookmark.id}>
                <button
                  type="button"
                  className="bookmark-main"
                  onClick={() => openLink(bookmark.url, bookmark.title)}
                >
                  <span className="bookmark-icon">
                    <SiteIcon url={bookmark.url} size={19} />
                  </span>
                  <span className="bookmark-info">
                    <span className="bookmark-title">{bookmark.title}</span>
                    <span className="bookmark-url">{prettyUrl(bookmark.url)}</span>
                  </span>
                </button>
                <div className="bookmark-actions">
                  <IconButton
                    label="Открыть в новой вкладке"
                    size="sm"
                    onClick={() => openExternalLink(bookmark.url, bookmark.title)}
                  >
                    <ArrowUpRight size={14} strokeWidth={1.8} />
                  </IconButton>
                  <IconButton
                    label="Удалить закладку"
                    size="sm"
                    onClick={() => removeBookmark(bookmark.id)}
                  >
                    <X size={14} strokeWidth={1.9} />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        ) : total === 0 ? (
          <div className="empty-card">
            <span className="empty-icon">
              <Bookmark size={21} strokeWidth={1.6} />
            </span>
            <h2>Пока ни одной закладки</h2>
            <p>
              Откройте страницу и нажмите на звёздочку в адресной строке — она появится здесь и на
              новой вкладке.
            </p>
            <button
              type="button"
              className="button button--accent"
              onClick={() => navigate(buildInternal('newtab'))}
            >
              На новую вкладку
            </button>
          </div>
        ) : (
          <div className="empty-card empty-card--compact">
            <span className="empty-icon">
              <Search size={20} strokeWidth={1.6} />
            </span>
            <h2>Ничего не нашлось</h2>
            <p>
              По запросу «{query.trim()}» нет закладок. Попробуйте другое слово или очистите поиск.
            </p>
            <button
              type="button"
              className="button button--soft"
              onClick={() => setQuery('')}
            >
              Очистить поиск
            </button>
          </div>
        )}

        {filtered.length > 0 && state.bookmarks.length > 0 ? (
          <footer className="page-footer">
            <span>
              {filtered.length} из {total} · локальная библиотека
            </span>
            <span>Хранится на устройстве</span>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
