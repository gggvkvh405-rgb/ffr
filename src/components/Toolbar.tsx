import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  RotateCw,
  Star,
} from 'lucide-react';
import { useBrowser } from '../state/browser-store';
import { isWebUrl } from '../lib/url';
import { getEngine } from '../lib/engines';
import { Omnibox } from './Omnibox';
import { IconButton } from './ui/IconButton';

export function Toolbar() {
  const {
    activeEntry,
    route,
    canGoBack,
    canGoForward,
    back,
    forward,
    reload,
    isBookmarked,
    toggleBookmark,
    openExternalLink,
    state,
  } = useBrowser();

  const isWeb = isWebUrl(activeEntry.url);
  const bookmarked = isWeb && isBookmarked(activeEntry.url);
  const engine = getEngine(state.settings.engine);

  const externalTarget =
    route?.page === 'search' && route.query?.trim()
      ? { url: engine.searchUrl(route.query.trim()), title: route.query.trim() }
      : isWeb
        ? { url: activeEntry.url, title: activeEntry.title }
        : null;

  return (
    <div className="toolbar">
      <div className="toolbar-nav">
        <IconButton label="Назад" size="sm" onClick={back} disabled={!canGoBack}>
          <ArrowLeft size={16} strokeWidth={1.8} />
        </IconButton>
        <IconButton
          label="Вперёд"
          size="sm"
          onClick={forward}
          disabled={!canGoForward}
        >
          <ArrowRight size={16} strokeWidth={1.8} />
        </IconButton>
        <IconButton label="Обновить" size="sm" onClick={reload}>
          <RotateCw size={14} strokeWidth={1.8} />
        </IconButton>
      </div>

      <Omnibox
        variant="toolbar"
        placeholder={route?.page === 'search' ? 'Поиск' : 'Введите адрес или запрос'}
      />

      <div className="toolbar-actions">
        <IconButton
          label={bookmarked ? 'Убрать из закладок' : 'Добавить в закладки'}
          size="sm"
          active={bookmarked}
          disabled={!isWeb}
          onClick={() => toggleBookmark(activeEntry.url, activeEntry.title)}
        >
          <Star
            size={16}
            strokeWidth={1.7}
            fill={bookmarked ? 'currentColor' : 'none'}
          />
        </IconButton>
        {externalTarget ? (
          <IconButton
            label={route?.page === 'search' ? 'Открыть в поисковике' : 'Открыть в новой вкладке'}
            size="sm"
            onClick={() => openExternalLink(externalTarget.url, externalTarget.title)}
          >
            <ExternalLink size={15} strokeWidth={1.8} />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}
