import { useMemo, useState } from 'react';
import { ArrowUpRight, Clock, History, Search, Trash2, X } from 'lucide-react';
import { useBrowser } from '../../state/browser-store';
import { parseInternal, prettyUrl } from '../../lib/url';
import { historyGroupLabel, historyTime, plural } from '../../lib/time';
import type { HistoryEntry } from '../../lib/types';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { IconButton } from '../ui/IconButton';
import { SiteIcon } from '../ui/SiteIcon';

interface Group {
  label: string;
  entries: HistoryEntry[];
}

export function HistoryPage() {
  const {
    state,
    navigate,
    openExternalLink,
    removeHistory,
    clearHistory,
    showToast,
  } = useBrowser();
  const [query, setQuery] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const filtered = useMemo(() => {
    const lower = query.trim().toLowerCase();
    if (!lower) return state.history;
    return state.history.filter(
      (entry) =>
        entry.title.toLowerCase().includes(lower) || entry.url.toLowerCase().includes(lower),
    );
  }, [query, state.history]);

  const groups = useMemo<Group[]>(() => {
    const result: Group[] = [];
    for (const entry of filtered) {
      const label = historyGroupLabel(entry.visitedAt);
      const group = result[result.length - 1];
      if (group && group.label === label) group.entries.push(entry);
      else result.push({ label, entries: [entry] });
    }
    return result;
  }, [filtered]);

  return (
    <div className="page-scroll">
      <div className="page">
        <header className="library-head">
          <div>
            <div className="page-eyebrow">
              <span className="micro-label">Активность</span>
              <span className="eyebrow-slash">/</span>
              <span className="micro-label">Только на устройстве</span>
            </div>
            <h1 className="page-title">История</h1>
            <p className="page-sub">
              Всё, что вы открывали в ByAzen. Записи не покидают это устройство и легко удаляются.
            </p>
          </div>
          <div className="library-stat">
            <span className="library-stat-number">
              {String(state.history.length).padStart(2, '0')}
            </span>
            <span className="library-stat-label">
              {plural(state.history.length, 'запись', 'записи', 'записей')}
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
              placeholder="Найти в истории"
              aria-label="Найти в истории"
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
            className="button button--soft button--small button--quiet-danger"
            onClick={() => setConfirmOpen(true)}
            disabled={state.history.length === 0}
          >
            <Trash2 size={14} strokeWidth={1.8} />
            Очистить
          </button>
        </div>

        {groups.length > 0 ? (
          <div className="history-groups">
            {groups.map((group) => (
              <section className="history-group" key={group.label}>
                <div className="history-date">
                  <span>{group.label}</span>
                  <span className="history-line" aria-hidden="true" />
                  <span className="history-date-count">
                    {String(group.entries.length).padStart(2, '0')}
                  </span>
                </div>
                <div className="history-list">
                  {group.entries.map((entry) => {
                    const route = parseInternal(entry.url);
                    return (
                      <div className="history-row" key={entry.id}>
                        <time className="history-time" dateTime={new Date(entry.visitedAt).toISOString()}>
                          {historyTime(entry.visitedAt)}
                        </time>
                        <span className="history-icon">
                          {route?.page === 'search' ? (
                            <Search size={14} strokeWidth={1.8} />
                          ) : (
                            <SiteIcon url={entry.url} size={15} />
                          )}
                        </span>
                        <button
                          type="button"
                          className="history-main"
                          onClick={() => navigate(entry.url, { title: entry.title })}
                        >
                          <span className="history-title">{entry.title}</span>
                          <span className="history-url">
                            {route?.page === 'search' ? 'Поиск в ByAzen' : prettyUrl(entry.url)}
                          </span>
                        </button>
                        {entry.type === 'page' ? (
                          <div className="history-actions">
                            <IconButton
                              label="Открыть в новой вкладке"
                              size="sm"
                              onClick={() => openExternalLink(entry.url, entry.title)}
                            >
                              <ArrowUpRight size={14} strokeWidth={1.8} />
                            </IconButton>
                            <IconButton
                              label="Удалить из истории"
                              size="sm"
                              onClick={() => removeHistory(entry.id)}
                            >
                              <X size={14} strokeWidth={1.9} />
                            </IconButton>
                          </div>
                        ) : (
                          <div className="history-actions">
                            <IconButton
                              label="Удалить из истории"
                              size="sm"
                              onClick={() => removeHistory(entry.id)}
                            >
                              <X size={14} strokeWidth={1.9} />
                            </IconButton>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : state.history.length === 0 ? (
          <div className="empty-card">
            <span className="empty-icon">
              <History size={21} strokeWidth={1.6} />
            </span>
            <h2>История пуста</h2>
            <p>
              Здесь появятся страницы и поисковые запросы. ByAzen хранит их только на этом
              устройстве.
            </p>
            <span className="empty-note">
              <Clock size={13} strokeWidth={1.8} />
              Начните с новой вкладки
            </span>
          </div>
        ) : (
          <div className="empty-card empty-card--compact">
            <span className="empty-icon">
              <Search size={20} strokeWidth={1.6} />
            </span>
            <h2>Ничего не нашлось</h2>
            <p>По запросу «{query.trim()}» нет записей в истории.</p>
            <button type="button" className="button button--soft" onClick={() => setQuery('')}>
              Очистить поиск
            </button>
          </div>
        )}

        <footer className="page-footer">
          <span>Локальная история · до 500 записей</span>
          <span>{state.history.length > 0 ? 'Удаление необратимо' : 'Всё чисто'}</span>
        </footer>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Очистить историю?"
        description="Все записи о посещениях и поисковых запросах будут удалены с этого устройства. Отменить это действие не получится."
        confirmLabel="Очистить историю"
        tone="danger"
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          clearHistory();
          showToast('История очищена');
        }}
      />
    </div>
  );
}
