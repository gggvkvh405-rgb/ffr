import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  LoaderCircle,
  Sun,
  Keyboard,
} from 'lucide-react';
import { useBrowser } from '../state/browser-store';
import { useNow } from '../hooks/useUi';
import { formatTime } from '../lib/time';
import { weatherInfo, type WeatherKind } from '../lib/weather';
import { LogoMark } from './ui/Logo';

function WeatherGlyph({ kind, size = 14 }: { kind: WeatherKind; size?: number }) {
  const props = { size, strokeWidth: 1.7 };
  switch (kind) {
    case 'clear':
      return <Sun {...props} />;
    case 'partly':
      return <CloudSun {...props} />;
    case 'cloudy':
      return <Cloud {...props} />;
    case 'fog':
      return <CloudFog {...props} />;
    case 'drizzle':
    case 'rain':
    case 'showers':
      return <CloudRain {...props} />;
    case 'snow':
      return <CloudSnow {...props} />;
    case 'thunder':
      return <CloudLightning {...props} />;
    default:
      return <Cloud {...props} />;
  }
}

function WeatherChip() {
  const { state, weatherLoading, refreshWeather } = useBrowser();
  if (!state.settings.weather) return null;

  const weather = state.weather;
  const info = weather ? weatherInfo(weather.code) : null;

  return (
    <button
      type="button"
      className="weather-chip"
      onClick={() => refreshWeather()}
      aria-label={
        weather && info
          ? `Погода: ${weather.temp} градусов, ${info.label}. Обновить`
          : 'Показать погоду по геолокации'
      }
      data-tip={
        weather
          ? `${weather.place ? `${weather.place} · ` : ''}Обновить погоду`
          : state.settings.weatherPlace
            ? `${state.settings.weatherPlace.label} · загрузить погоду`
            : 'Погода по геолокации'
      }
      data-tip-side="top"
    >
      {weatherLoading ? (
        <LoaderCircle size={14} strokeWidth={1.7} className="spin" />
      ) : info ? (
        <WeatherGlyph kind={info.kind} />
      ) : (
        <CloudSun size={14} strokeWidth={1.7} />
      )}
      {weather && info ? (
        <>
          <span className="weather-temp">
            {weather.temp > 0 ? '+' : ''}
            {weather.temp}°
          </span>
          <span className="weather-label">{info.label}</span>
        </>
      ) : (
        <span className="weather-empty">{weatherLoading ? '···' : 'Погода'}</span>
      )}
    </button>
  );
}

export function StatusBar() {
  const now = useNow(10_000);
  const { state, setShortcutsOpen } = useBrowser();

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        <span className="statusbar-brand">
          <LogoMark size={13} />
          <span>ByAzen</span>
          <span className="statusbar-version">1.0</span>
        </span>
        <span className="statusbar-divider" aria-hidden="true" />
        <span className="statusbar-note">Данные остаются на устройстве</span>
      </div>
      <div className="statusbar-right">
        <WeatherChip />
        {state.settings.showClock ? (
          <time className="statusbar-clock" dateTime={now.toISOString()}>
            {formatTime(now)}
          </time>
        ) : null}
        <button
          type="button"
          className="statusbar-help"
          onClick={() => setShortcutsOpen(true)}
          aria-label="Горячие клавиши"
          data-tip="Горячие клавиши"
          data-tip-side="top"
        >
          <Keyboard size={14} strokeWidth={1.7} />
        </button>
      </div>
    </footer>
  );
}
