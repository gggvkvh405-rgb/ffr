import { useEffect, useState } from 'react';
import { ArrowUpRight, Copy, Info, X } from 'lucide-react';
import { useBrowser } from '../../state/browser-store';
import { hostOf, likelyBlocksFrames, prettyUrl } from '../../lib/url';
import { SiteIcon } from '../ui/SiteIcon';

function BlockedSite({ url }: { url: string }) {
  const { openExternalLink, copy } = useBrowser();
  const host = hostOf(url);

  return (
    <div className="site-fallback">
      <div className="fallback-card">
        <div className="page-eyebrow fallback-eyebrow">
          <span className="micro-label">Внешний адрес</span>
        </div>
        <div className="fallback-icon">
          <SiteIcon url={url} size={32} />
        </div>
        <h1 className="fallback-title">{host}</h1>
        <p className="fallback-url">{prettyUrl(url)}</p>
        <p className="fallback-text">
          Этот сайт не разрешает открывать себя внутри других приложений. Продолжите в новой
          вкладке браузера — адрес останется в истории ByAzen.
        </p>
        <div className="fallback-actions">
          <button
            type="button"
            className="button button--accent"
            onClick={() => openExternalLink(url, host)}
          >
            Открыть сайт
            <ArrowUpRight size={16} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="button button--soft"
            onClick={() => copy(url, 'Ссылка скопирована')}
          >
            <Copy size={15} strokeWidth={1.8} />
            Скопировать ссылку
          </button>
        </div>
        <div className="fallback-note">
          <Info size={14} strokeWidth={1.7} />
          <span>ByAzen не ограничивает сайты — это правило самого сайта.</span>
        </div>
      </div>
    </div>
  );
}

export function SiteView({ url }: { url: string }) {
  const { openExternalLink, activeEntry } = useBrowser();
  const [loaded, setLoaded] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);
  const blocked = likelyBlocksFrames(url);

  useEffect(() => {
    setShowHint(false);
    setHintDismissed(false);
    if (blocked) return;
    const showTimer = window.setTimeout(() => setShowHint(true), 4200);
    const hideTimer = window.setTimeout(() => setShowHint(false), 15_000);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [blocked, url]);

  if (blocked) return <BlockedSite url={url} />;

  return (
    <div className="site-view">
      <div className={`frame-progress ${loaded ? '' : 'is-loading'}`} aria-hidden="true" />
      <iframe
        key={url}
        className="site-frame"
        src={url}
        title={activeEntry.title}
        onLoad={() => setLoaded(true)}
        referrerPolicy="no-referrer"
        allow="clipboard-write; fullscreen"
      />
      {showHint && !hintDismissed ? (
        <div className="frame-hint">
          <span>Сайт не отображается?</span>
          <button
            type="button"
            className="frame-hint-action"
            onClick={() => openExternalLink(url, activeEntry.title)}
          >
            Открыть в новой вкладке
            <ArrowUpRight size={12} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="frame-hint-close"
            aria-label="Скрыть подсказку"
            onClick={() => setHintDismissed(true)}
          >
            <X size={11} strokeWidth={2} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
