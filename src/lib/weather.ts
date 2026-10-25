import type { WeatherData, WeatherPlace } from './types';

export type WeatherKind =
  | 'clear'
  | 'partly'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'showers'
  | 'thunder';

const CODE_MAP: Record<number, { label: string; kind: WeatherKind }> = {
  0: { label: 'ясно', kind: 'clear' },
  1: { label: 'почти ясно', kind: 'partly' },
  2: { label: 'переменная облачность', kind: 'partly' },
  3: { label: 'пасмурно', kind: 'cloudy' },
  45: { label: 'туман', kind: 'fog' },
  48: { label: 'изморозь', kind: 'fog' },
  51: { label: 'лёгкая морось', kind: 'drizzle' },
  53: { label: 'морось', kind: 'drizzle' },
  55: { label: 'сильная морось', kind: 'drizzle' },
  56: { label: 'ледяная морось', kind: 'drizzle' },
  57: { label: 'ледяная морось', kind: 'drizzle' },
  61: { label: 'небольшой дождь', kind: 'rain' },
  63: { label: 'дождь', kind: 'rain' },
  65: { label: 'сильный дождь', kind: 'rain' },
  66: { label: 'ледяной дождь', kind: 'rain' },
  67: { label: 'ледяной дождь', kind: 'rain' },
  71: { label: 'небольшой снег', kind: 'snow' },
  73: { label: 'снег', kind: 'snow' },
  75: { label: 'сильный снег', kind: 'snow' },
  77: { label: 'снежная крупа', kind: 'snow' },
  80: { label: 'небольшой ливень', kind: 'showers' },
  81: { label: 'ливень', kind: 'showers' },
  82: { label: 'сильный ливень', kind: 'showers' },
  85: { label: 'снегопад', kind: 'snow' },
  86: { label: 'сильный снегопад', kind: 'snow' },
  95: { label: 'гроза', kind: 'thunder' },
  96: { label: 'гроза с градом', kind: 'thunder' },
  99: { label: 'сильная гроза', kind: 'thunder' },
};

export function weatherInfo(code: number): { label: string; kind: WeatherKind } {
  return CODE_MAP[code] ?? { label: 'облачно', kind: 'cloudy' };
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
  };
}

interface GeocodeResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

interface GeocodeResponse {
  results?: GeocodeResult[];
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<WeatherPlace[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const params = new URLSearchParams({
    name: trimmed,
    count: '5',
    language: 'ru',
    format: 'json',
  });
  const response = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`,
    { signal },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as GeocodeResponse;
  return (data.results ?? []).map((item) => ({
    label: item.name,
    detail: [item.admin1, item.country].filter(Boolean).join(', '),
    lat: item.latitude,
    lon: item.longitude,
  }));
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherData> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    current: 'temperature_2m,weather_code',
    timezone: 'auto',
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as OpenMeteoResponse;
  const temp = data.current?.temperature_2m;
  const code = data.current?.weather_code;
  if (typeof temp !== 'number' || typeof code !== 'number') throw new Error('Bad weather data');
  return { temp: Math.round(temp), code, at: Date.now() };
}

export function requestCoordinates(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      (error) => reject(error),
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 30 * 60_000 },
    );
  });
}
