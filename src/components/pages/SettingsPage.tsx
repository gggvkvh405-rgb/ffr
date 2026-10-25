import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bookmark,
  Check,
  Download,
  History,
  Keyboard,
  Laptop,
  RotateCcw,
  MapPin,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useBrowser } from '../../state/browser-store';
import { ACCENTS, ENGINES, WALLPAPERS, getEngine } from '../../lib/engines';
import { APP_VERSION } from '../../lib/defaults';
import { buildInternal } from '../../lib/url';
import { plural } from '../../lib/time';
import type { LinkTarget, Settings, WeatherPlace } from '../../lib/types';
import { searchPlaces } from '../../lib/weather';
import { LogoMark } from '../ui/Logo';
import { EngineIcon } from '../ui/EngineIcon';
import { ConfirmDialog } from '../ui/ConfirmDialog';

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" aria-hidden="true" />
    </button>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <span className="setting-title">{title}</span>
        {description ? <span className="setting-desc">{description}</span> : null}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function SectionHead({
  index,
  title,
  description,
  id,
}: {
  index: string;
  title: string;
  description: string;
  id: string;
}) {
  return (
    <div className="settings-section-head">
      <span className="settings-index">{index}</span>
      <h2 className="settings-section-title" id={id}>
        {title}
      </h2>
      <p className="settings-section-desc">{description}</p>
    </div>
  );
}

export function SettingsPage() {
  const {
    state,
    setSettings,
    navigate,
    clearHistory,
    resetAll,
    showToast,
    setShortcutsOpen,
    refreshWeather,
    weatherLoading,
  } = useBrowser();
  const [confirmHistory, setConfirmHistory] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [cityQuery, setCityQuery] = useState('');
  const [cityResults, setCityResults] = useState<WeatherPlace[]>([]);
  const [cityStatus, setCityStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const cityTimer = useRef<number | null>(null);
  const settings = state.settings;
  const engine = getEngine(settings.engine);

  const update = (patch: Partial<Settings>) => setSettings(patch);

  useEffect(() => {
    if (cityTimer.current) window.clearTimeout(cityTimer.current);
    const trimmed = cityQuery.trim();
    if (trimmed.length < 2) {
      setCityResults([]);
      setCityStatus('idle');
      return;
    }
    const controller = new AbortController();
    setCityStatus('loading');
    cityTimer.current = window.setTimeout(() => {
      searchPlaces(trimmed, controller.signal)
        .then((places) => {
          setCityResults(places);
          setCityStatus('idle');
        })
        .catch((error: unknown) => {
          if ((error as Error)?.name !== 'AbortError') setCityStatus('error');
        });
    }, 320);
    return () => {
      controller.abort();
      if (cityTimer.current) window.clearTimeout(cityTimer.current);
    };
  }, [cityQuery]);

  const chooseCity = (place: WeatherPlace) => {
    update({ weatherPlace: place, weather: true });
    setCityQuery('');
    setCityResults([]);
    setCityStatus('idle');
    refreshWeather(place);
    showToast(`Погода: ${place.label}`);
  };

  const exportData = () => {
    const payload = {
      app: 'ByAzen',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      settings,
      bookmarks: state.bookmarks,
      history: state.history,
    };
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `byazen-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast('Резервная копия сформирована');
    } catch {
      showToast('Не удалось сформировать копию');
    }
  };

  return (
    <div className="page-scroll">
      <div className="page settings-page">
        <header className="settings-head">
          <div>
            <div className="page-eyebrow">
              <span className="micro-label">ByAzen</span>
              <span className="eyebrow-slash">/</span>
              <span className="micro-label">Настройки</span>
            </div>
            <h1 className="page-title">Настройки</h1>
            <p className="page-sub">
              Внешний вид, поиск и приватность — без лишних слов и скрытых переключателей.
            </p>
          </div>
          <div className="autosave">
            <span className="status-dot" aria-hidden="true" />
            Сохраняется автоматически
          </div>
        </header>

        <section className="settings-section" aria-labelledby="settings-appearance">
          <SectionHead
            index="01"
            title="Оформление"
            description="Фон, оттенок акцента и фактура. Достаточно, чтобы интерфейс был вашим."
            id="settings-appearance"
          />
          <div className="settings-content">
            <div className="settings-block">
              <div className="block-label">Фон новой вкладки</div>
              <div className="wallpaper-grid" role="radiogroup" aria-label="Фон новой вкладки">
                {WALLPAPERS.map((wallpaper) => (
                  <button
                    type="button"
                    key={wallpaper.id}
                    role="radio"
                    aria-checked={settings.wallpaper === wallpaper.id}
                    className={`wallpaper-card ${
                      settings.wallpaper === wallpaper.id ? 'is-active' : ''
                    }`}
                    onClick={() => update({ wallpaper: wallpaper.id })}
                  >
                    <span className={`wallpaper-preview wallpaper-preview--${wallpaper.id}`}>
                      <span className="preview-bar" />
                      <span className="preview-tiles">
                        <i />
                        <i />
                        <i />
                      </span>
                    </span>
                    <span className="wallpaper-caption">
                      <span className="wallpaper-name">{wallpaper.name}</span>
                      <span className="wallpaper-note">{wallpaper.note}</span>
                    </span>
                    {settings.wallpaper === wallpaper.id ? (
                      <span className="option-check">
                        <Check size={11} strokeWidth={2.6} />
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-block">
              <div className="block-label">Акцентный цвет</div>
              <div className="accent-row" role="radiogroup" aria-label="Акцентный цвет">
                {ACCENTS.map((accent) => (
                  <button
                    type="button"
                    key={accent.id}
                    role="radio"
                    aria-checked={settings.accent === accent.id}
                    className={`accent-option ${
                      settings.accent === accent.id ? 'is-active' : ''
                    }`}
                    onClick={() => update({ accent: accent.id })}
                  >
                    <span
                      className="accent-swatch"
                      style={{ backgroundColor: accent.hex }}
                      aria-hidden="true"
                    />
                    <span>{accent.name}</span>
                    {settings.accent === accent.id ? (
                      <Check size={12} strokeWidth={2.4} className="accent-check" />
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-block settings-block--rows">
              <SettingRow
                title="Зерно"
                description="Тонкая фактура на фоне — чтобы тёмный экран не выглядел плоским."
              >
                <Toggle
                  checked={settings.grain}
                  onChange={(grain) => update({ grain })}
                  label="Показывать зерно на фоне"
                />
              </SettingRow>
            </div>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="settings-search">
          <SectionHead
            index="02"
            title="Поиск"
            description="Куда отправлять запросы и как открывать найденные страницы."
            id="settings-search"
          />
          <div className="settings-content">
            <div className="settings-block">
              <div className="block-label">Поисковая система</div>
              <div className="engine-grid" role="radiogroup" aria-label="Поисковая система">
                {ENGINES.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    role="radio"
                    aria-checked={settings.engine === item.id}
                    className={`engine-radio ${settings.engine === item.id ? 'is-active' : ''}`}
                    onClick={() => update({ engine: item.id })}
                  >
                    <span className="engine-radio-icon">
                      <EngineIcon id={item.id} size={17} />
                    </span>
                    <span className="engine-radio-copy">
                      <span className="engine-radio-name">{item.name}</span>
                      <span className="engine-radio-host">{item.host}</span>
                    </span>
                    <span className={`radio-dot ${settings.engine === item.id ? 'is-on' : ''}`}>
                      {settings.engine === item.id ? (
                        <span className="radio-dot-core" />
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
              <p className="block-note">
                Сейчас запросы открываются в {engine.name}. Нажатие на «Открыть в поисковике» на
                странице результатов всегда доступно.
              </p>
            </div>

            <div className="settings-block settings-block--rows">
              <SettingRow
                title="Где открывать сайты"
                description="Внутри ByAzen — спокойнее. В новой вкладке — если сайт не любит встраивание."
              >
                <div className="segmented" role="radiogroup" aria-label="Где открывать сайты">
                  {(
                    [
                      { id: 'inline', label: 'Внутри' },
                      { id: 'external', label: 'В новой вкладке' },
                    ] as { id: LinkTarget; label: string }[]
                  ).map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      role="radio"
                      aria-checked={settings.linkTarget === item.id}
                      className={`segmented-item ${
                        settings.linkTarget === item.id ? 'is-active' : ''
                      }`}
                      onClick={() => update({ linkTarget: item.id })}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </SettingRow>
              <SettingRow
                title="Сразу открывать поисковик"
                description="Запрос уйдёт напрямую в поисковую систему, без внутренней страницы с источниками."
              >
                <Toggle
                  checked={settings.searchDirectly}
                  onChange={(searchDirectly) => update({ searchDirectly })}
                  label="Сразу открывать поисковик"
                />
              </SettingRow>
            </div>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="settings-interface">
          <SectionHead
            index="03"
            title="Интерфейс"
            description="Мелочи внизу экрана, которые делают браузер своим."
            id="settings-interface"
          />
          <div className="settings-content">
            <div className="settings-block settings-block--rows">
              <SettingRow
                title="Часы"
                description="Текущее время в строке состояния."
              >
                <Toggle
                  checked={settings.showClock}
                  onChange={(showClock) => update({ showClock })}
                  label="Показывать часы"
                />
              </SettingRow>
              <SettingRow
                title="Погода"
                description="В строке состояния. Без города используется геолокация — по вашему разрешению."
              >
                <Toggle
                  checked={settings.weather}
                  onChange={(weather) => update({ weather })}
                  label="Показывать погоду"
                />
              </SettingRow>
              <SettingRow
                title="Город для погоды"
                description="Надёжнее геолокации: выберите город вручную — координаты останутся на устройстве."
              >
                <div className="city-control">
                  {settings.weatherPlace ? (
                    <span className="city-current">
                      <MapPin size={12} strokeWidth={1.9} />
                      {settings.weatherPlace.label}
                      <button
                        type="button"
                        className="city-clear"
                        aria-label="Сбросить город и использовать геолокацию"
                        onClick={() => {
                          update({ weatherPlace: null });
                          showToast('Снова используется геолокация');
                        }}
                      >
                        <X size={11} strokeWidth={2} />
                      </button>
                    </span>
                  ) : null}
                  <label className="city-input">
                    <Search size={13} strokeWidth={1.8} aria-hidden="true" />
                    <input
                      type="text"
                      value={cityQuery}
                      onChange={(event) => setCityQuery(event.target.value)}
                      placeholder={settings.weatherPlace ? 'Другой город' : 'Например, Нижневартовск'}
                      aria-label="Город для погоды"
                      autoComplete="off"
                    />
                    {cityStatus === 'loading' ? (
                      <span className="city-loading" aria-hidden="true" />
                    ) : null}
                  </label>
                  {cityQuery.trim().length >= 2 ? (
                    <div className="city-results" role="listbox" aria-label="Найденные города">
                      {cityResults.length > 0 ? (
                        cityResults.map((place) => (
                          <button
                            type="button"
                            key={`${place.label}-${place.lat}-${place.lon}`}
                            className="city-result"
                            role="option"
                            aria-selected={false}
                            onClick={() => chooseCity(place)}
                          >
                            <span className="city-result-name">{place.label}</span>
                            {place.detail ? (
                              <span className="city-result-detail">{place.detail}</span>
                            ) : null}
                          </button>
                        ))
                      ) : (
                        <div className="city-empty">
                          {cityStatus === 'loading'
                            ? 'Ищем город…'
                            : cityStatus === 'error'
                              ? 'Сервис недоступен — попробуйте позже'
                              : 'Ничего не найдено'}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </SettingRow>
              <SettingRow
                title="Проверить погоду"
                description="Обновить данные вручную."
              >
                <button
                  type="button"
                  className="button button--soft button--small"
                  onClick={() => refreshWeather()}
                  disabled={weatherLoading}
                >
                  <RotateCcw size={14} strokeWidth={1.8} className={weatherLoading ? 'spin' : ''} />
                  {weatherLoading ? 'Загружаем' : 'Обновить'}
                </button>
              </SettingRow>
            </div>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="settings-data">
          <SectionHead
            index="04"
            title="Данные"
            description="Всё лежит в локальном хранилище браузера. Экспорт и удаление — в ваших руках."
            id="settings-data"
          />
          <div className="settings-content">
            <div className="settings-block settings-block--rows">
              <div className="data-stats">
                <div className="data-stat">
                  <span className="data-stat-value">{state.bookmarks.length}</span>
                  <span className="data-stat-label">
                    {plural(state.bookmarks.length, 'закладка', 'закладки', 'закладок')}
                  </span>
                </div>
                <div className="data-stat">
                  <span className="data-stat-value">{state.history.length}</span>
                  <span className="data-stat-label">
                    {plural(state.history.length, 'запись', 'записи', 'записей')}
                  </span>
                </div>
                <div className="data-stat">
                  <span className="data-stat-value">{state.recentSearches.length}</span>
                  <span className="data-stat-label">недавних запросов</span>
                </div>
              </div>

              <SettingRow
                title="Закладки"
                description="Страницы, сохранённые звёздочкой или вручную."
              >
                <button
                  type="button"
                  className="button button--soft button--small"
                  onClick={() => navigate(buildInternal('bookmarks'))}
                >
                  <Bookmark size={14} strokeWidth={1.8} />
                  Открыть
                </button>
              </SettingRow>
              <SettingRow title="История" description="Посещения и поисковые запросы на устройстве.">
                <div className="row-actions">
                  <button
                    type="button"
                    className="button button--soft button--small"
                    onClick={() => navigate(buildInternal('history'))}
                  >
                    <History size={14} strokeWidth={1.8} />
                    Открыть
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small button--quiet-danger"
                    onClick={() => setConfirmHistory(true)}
                    disabled={state.history.length === 0}
                  >
                    <Trash2 size={14} strokeWidth={1.8} />
                    Очистить
                  </button>
                </div>
              </SettingRow>
              <SettingRow
                title="Резервная копия"
                description="Скачать настройки, закладки и историю одним JSON-файлом."
              >
                <button
                  type="button"
                  className="button button--soft button--small"
                  onClick={exportData}
                >
                  <Download size={14} strokeWidth={1.8} />
                  Экспорт
                </button>
              </SettingRow>
            </div>

            <div className="danger-block">
              <div className="danger-copy">
                <span className="danger-title">Сбросить ByAzen</span>
                <span className="danger-desc">
                  Удалить закладки, историю и вернуть настройки по умолчанию.
                </span>
              </div>
              <button
                type="button"
                className="button button--danger-soft"
                onClick={() => setConfirmReset(true)}
              >
                <RotateCcw size={14} strokeWidth={1.8} />
                Сбросить всё
              </button>
            </div>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="settings-about">
          <SectionHead
            index="05"
            title="О браузере"
            description="ByAzen — тихий вход в большой интернет."
            id="settings-about"
          />
          <div className="settings-content">
            <div className="about-block">
              <div className="about-brand">
                <span className="about-mark">
                  <LogoMark size={26} />
                </span>
                <div className="about-copy">
                  <span className="about-name">ByAzen</span>
                  <span className="about-version">
                    Версия {APP_VERSION} · локальный профиль
                  </span>
                </div>
              </div>
              <p className="about-text">
                Минималистичный браузерный опыт: быстрый поиск, аккуратная библиотека и никаких
                лишних уведомлений. Данные не уходят с устройства, а оформление остаётся спокойным.
              </p>
              <div className="about-actions">
                <button
                  type="button"
                  className="button button--soft button--small"
                  onClick={() => setShortcutsOpen(true)}
                >
                  <Keyboard size={14} strokeWidth={1.8} />
                  Горячие клавиши
                </button>
                <span className="about-meta">
                  <Laptop size={13} strokeWidth={1.7} />
                  Сделано с вниманием к деталям
                </span>
              </div>
            </div>
          </div>
        </section>

        <footer className="settings-footer">
          <span>
            <LogoMark size={13} /> ByAzen {APP_VERSION}
          </span>
          <span>
            <Search size={12} strokeWidth={1.8} />
            {engine.name} по умолчанию
          </span>
          <span>Изменения сохраняются автоматически</span>
        </footer>
      </div>

      <ConfirmDialog
        open={confirmHistory}
        title="Очистить историю?"
        description="Записи о посещениях и запросах будут удалены с этого устройства. Действие необратимо."
        confirmLabel="Очистить"
        tone="danger"
        onClose={() => setConfirmHistory(false)}
        onConfirm={() => {
          clearHistory();
          showToast('История очищена');
        }}
      />
      <ConfirmDialog
        open={confirmReset}
        title="Сбросить ByAzen?"
        description="Настройки вернутся к исходным, закладки и история будут удалены. Это действие нельзя отменить."
        confirmLabel="Сбросить всё"
        tone="danger"
        onClose={() => setConfirmReset(false)}
        onConfirm={resetAll}
      />
    </div>
  );
}
