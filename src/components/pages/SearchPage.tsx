import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  ExternalLink,
  MessageSquare,
  SearchX,
} from 'lucide-react';
import { useBrowser } from '../../state/browser-store';
import { getEngine, ENGINES } from '../../lib/engines';
import { fetchHnStories, fetchWikiArticles } from '../../lib/search';
import { buildInternal, prettyUrl } from '../../lib/url';
import { plural, relativeDay } from '../../lib/time';
import type { HnStory, WikiArticle } from '../../lib/types';
import { EngineIcon } from '../ui/EngineIcon';
import { IconButton } from '../ui/IconButton';

const SUGGESTED_QUERIES = ['Байкал', 'марсоход', 'искусственный интеллект', 'Tauri'];

type Status = 'loading' | 'ready' | 'error';

function AnswerCard({ article }: { article: WikiArticle }) {
  const { openLink, openExternalLink } = useBrowser();
  return (
    <article className="answer-card">
      <div className="answer-body">
        <div className="answer-source">
          <span className="source-badge">W</span>
          <span>
            Википедия{article.lang === 'en' ? ' (en)' : ''} · статья
          </span>
        </div>
        <h2 className="answer-title">
          <button
            type="button"
            className="answer-title-button"
            onClick={() => openLink(article.url, article.title)}
          >
            {article.title}
          </button>
        </h2>
        <p className="answer-text">{article.extract}</p>
        <div className="answer-footer">
          <button
            type="button"
            className="text-link"
            onClick={() => openLink(article.url, article.title)}
          >
            Читать статью
            <ArrowRight size={14} strokeWidth={1.9} />
          </button>
          <span className="answer-url">{prettyUrl(article.url)}</span>
          <IconButton
            label="Открыть в новой вкладке"
            size="sm"
            onClick={() => openExternalLink(article.url, article.title)}
          >
            <ExternalLink size={14} strokeWidth={1.8} />
          </IconButton>
        </div>
      </div>
      {article.thumbnail ? (
        <div className="answer-media" aria-hidden="true">
          <img src={article.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
        </div>
      ) : null}
    </article>
  );
}

function ArticleRow({ article, index }: { article: WikiArticle; index: number }) {
  const { openLink, openExternalLink } = useBrowser();
  return (
    <div className="result-row">
      <span className="result-index">{String(index).padStart(2, '0')}</span>
      <button
        type="button"
        className="result-main"
        onClick={() => openLink(article.url, article.title)}
      >
        <span className="result-source">
          <span className="source-badge source-badge--small">W</span>
          Википедия{article.lang === 'en' ? ' · en' : ''}
        </span>
        <span className="result-title">{article.title}</span>
        <span className="result-text">{article.extract}</span>
        <span className="result-url">{prettyUrl(article.url)}</span>
      </button>
      <div className="result-side">
        <IconButton
          label="Открыть в новой вкладке"
          size="sm"
          onClick={() => openExternalLink(article.url, article.title)}
        >
          <ArrowUpRight size={15} strokeWidth={1.8} />
        </IconButton>
      </div>
    </div>
  );
}

function StoryRow({ story, index }: { story: HnStory; index: number }) {
  const { openLink, openExternalLink } = useBrowser();
  return (
    <div className="result-row">
      <span className="result-index">{String(index).padStart(2, '0')}</span>
      <button
        type="button"
        className="result-main"
        onClick={() => openLink(story.url, story.title)}
      >
        <span className="result-source">
          <span className="source-badge source-badge--small source-badge--hn">Y</span>
          Hacker News · {story.domain}
        </span>
        <span className="result-title">{story.title}</span>
        <span className="result-meta">
          ▲ {story.points} · {story.comments}{' '}
          {plural(story.comments, 'комментарий', 'комментария', 'комментариев')} ·{' '}
          {relativeDay(story.createdAt)}
        </span>
        <span className="result-url">{prettyUrl(story.url)}</span>
      </button>
      <div className="result-side">
        <IconButton
          label="Обсуждение на Hacker News"
          size="sm"
          onClick={() => openExternalLink(story.discussionUrl, 'Hacker News')}
        >
          <MessageSquare size={14} strokeWidth={1.8} />
        </IconButton>
        <IconButton
          label="Открыть в новой вкладке"
          size="sm"
          onClick={() => openExternalLink(story.url, story.title)}
        >
          <ArrowUpRight size={15} strokeWidth={1.8} />
        </IconButton>
      </div>
    </div>
  );
}

function SkeletonResults() {
  return (
    <div className="skeleton-stack" aria-hidden="true">
      <div className="skeleton skeleton-answer" />
      {[0, 1, 2].map((item) => (
        <div className="skeleton-row" key={item}>
          <div className="skeleton skeleton-line skeleton-line--short" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line skeleton-line--medium" />
        </div>
      ))}
    </div>
  );
}

function ErrorNote({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="inline-note">
      <AlertCircle size={18} strokeWidth={1.7} />
      <div className="inline-note-body">
        <strong>Источник не отвечает</strong>
        <span>Проверьте соединение и попробуйте ещё раз. Полные веб-результаты доступны в поисковике.</span>
      </div>
      <button type="button" className="button button--small button--soft" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}

export function SearchPage({ query }: { query: string }) {
  const { state, openExternalLink, openLink, navigate } = useBrowser();
  const engine = getEngine(state.settings.engine);
  const [articles, setArticles] = useState<WikiArticle[]>([]);
  const [stories, setStories] = useState<HnStory[]>([]);
  const [wikiStatus, setWikiStatus] = useState<Status>('loading');
  const [hnStatus, setHnStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!query.trim()) {
      setWikiStatus('ready');
      setHnStatus('ready');
      return;
    }
    const controller = new AbortController();
    setArticles([]);
    setStories([]);
    setWikiStatus('loading');
    setHnStatus('loading');

    fetchWikiArticles(query, controller.signal)
      .then((items) => {
        setArticles(items);
        setWikiStatus('ready');
      })
      .catch((error: unknown) => {
        if ((error as Error)?.name !== 'AbortError') setWikiStatus('error');
      });

    fetchHnStories(query, controller.signal)
      .then((items) => {
        setStories(items);
        setHnStatus('ready');
      })
      .catch((error: unknown) => {
        if ((error as Error)?.name !== 'AbortError') setHnStatus('error');
      });

    return () => controller.abort();
  }, [query, attempt]);

  const total = articles.length + stories.length;
  const loading = wikiStatus === 'loading' || hnStatus === 'loading';
  const empty = !loading && wikiStatus !== 'error' && articles.length === 0 && stories.length === 0;
  const answer = articles[0];
  const restArticles = articles.slice(1);

  if (!query.trim()) {
    return (
      <div className="page-scroll">
        <div className="page page--narrow search-page">
          <div className="page-eyebrow">
            <span className="micro-label">Поиск</span>
            <span className="eyebrow-slash">/</span>
            <span className="micro-label">Открытые источники</span>
          </div>
          <h1 className="page-title">Что ищем?</h1>
          <p className="page-sub">
            Введите запрос в адресной строке — ByAzen соберёт мгновенные ответы из открытых
            источников и предложит статьи.
          </p>
          {state.recentSearches.length > 0 ? (
            <div className="quick-searches">
              <span className="micro-label">Недавние запросы</span>
              <div className="chip-row">
                {state.recentSearches.map((item) => (
                  <button
                    type="button"
                    className="chip"
                    key={item.query}
                    onClick={() => navigate(buildInternal('search', item.query))}
                  >
                    {item.query}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="quick-searches">
              <span className="micro-label">Попробуйте</span>
              <div className="chip-row">
                {SUGGESTED_QUERIES.map((item) => (
                  <button
                    type="button"
                    className="chip"
                    key={item}
                    onClick={() => navigate(buildInternal('search', item))}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page-scroll">
      <div className="page search-page" aria-busy={loading}>
        <header className="search-head">
          <div className="page-eyebrow">
            <span className="micro-label">Поиск</span>
            <span className="eyebrow-slash">/</span>
            <span className="micro-label">Открытые источники</span>
          </div>
          <h1 className="page-title page-title--query">«{query}»</h1>
          <p className="page-sub">
            Мгновенные ответы из Википедии и обсуждений Hacker News. Полные веб-результаты — в
            поисковике.
          </p>

          <div className="engine-actions" aria-label="Открыть веб-результаты">
            <button
              type="button"
              className="button button--accent"
              onClick={() => openExternalLink(engine.searchUrl(query), query)}
            >
              <EngineIcon id={engine.id} size={15} />
              <span>Открыть в {engine.name}</span>
              <ArrowUpRight size={15} strokeWidth={2} />
            </button>
            {ENGINES.filter((item) => item.id !== engine.id).map((item) => (
              <button
                type="button"
                key={item.id}
                className="button button--soft button--icon-label"
                onClick={() => openExternalLink(item.searchUrl(query), query)}
                aria-label={`Открыть результаты в ${item.name}`}
              >
                <EngineIcon id={item.id} size={14} />
                <span>{item.name}</span>
              </button>
            ))}
          </div>

          <div className="search-meta">
            {loading ? (
              <span className="search-meta-loading">
                <span className="live-dot" aria-hidden="true" />
                Ищем в открытых источниках
              </span>
            ) : (
              <>
                <span>
                  {total} {plural(total, 'результат', 'результата', 'результатов')}
                </span>
                <span className="meta-dot" aria-hidden="true" />
                <span>Wikipedia · Hacker News</span>
              </>
            )}
          </div>
          <span className="sr-only" role="status">
            {loading ? 'Загружаем результаты' : `Найдено ${total} результатов`}
          </span>
        </header>

        {wikiStatus === 'loading' ? <SkeletonResults /> : null}

        {answer ? (
          <section className="answer-section" aria-label="Быстрый ответ">
            <AnswerCard article={answer} />
          </section>
        ) : null}

        {restArticles.length > 0 ? (
          <section className="results-section" aria-labelledby="articles-heading">
            <div className="results-heading-row">
              <h2 className="results-heading" id="articles-heading">
                Статьи
              </h2>
              <span className="results-count">
                {String(restArticles.length).padStart(2, '0')}
              </span>
            </div>
            <div className="result-list">
              {restArticles.map((article, index) => (
                <ArticleRow article={article} index={index + 2} key={`${article.id}-${article.title}`} />
              ))}
            </div>
          </section>
        ) : null}

        {stories.length > 0 ? (
          <section className="results-section" aria-labelledby="stories-heading">
            <div className="results-heading-row">
              <h2 className="results-heading" id="stories-heading">
                Обсуждения
              </h2>
              <span className="results-count">{String(stories.length).padStart(2, '0')}</span>
            </div>
            <div className="result-list">
              {stories.map((story, index) => (
                <StoryRow story={story} index={index + 1} key={story.id} />
              ))}
            </div>
          </section>
        ) : null}

        {wikiStatus === 'error' ? (
          <ErrorNote onRetry={() => setAttempt((value) => value + 1)} />
        ) : null}

        {empty ? (
          <div className="empty-card">
            <span className="empty-icon">
              <SearchX size={22} strokeWidth={1.6} />
            </span>
            <h2>Ничего не нашлось</h2>
            <p>
              В открытых источниках пока нет подходящих материалов. Сформулируйте иначе или
              откройте полные веб-результаты.
            </p>
            <button
              type="button"
              className="button button--accent"
              onClick={() => openExternalLink(engine.searchUrl(query), query)}
            >
              <EngineIcon id={engine.id} size={15} />
              Открыть в {engine.name}
              <ArrowUpRight size={15} strokeWidth={2} />
            </button>
          </div>
        ) : null}

        <footer className="page-footer">
          <span>Источники: Wikipedia · Hacker News</span>
          <button
            type="button"
            className="text-link text-link--muted"
            onClick={() =>
              openLink(`https://ru.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}`)
            }
          >
            Открыть Википедию
            <ArrowRight size={13} strokeWidth={1.9} />
          </button>
        </footer>
      </div>
    </div>
  );
}
