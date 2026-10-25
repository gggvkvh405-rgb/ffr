export function getGreeting(date = new Date()): { lead: string; accent: string } {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return { lead: 'Доброе', accent: 'утро' };
  if (hour >= 12 && hour < 17) return { lead: 'Добрый', accent: 'день' };
  if (hour >= 17 && hour < 23) return { lead: 'Добрый', accent: 'вечер' };
  return { lead: 'Доброй', accent: 'ночи' };
}

export function formatDate(date = new Date()): string {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
}

export function formatTime(date = new Date()): string {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function startOfDay(date: Date): number {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

export function historyGroupLabel(timestamp: number): string {
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  if (timestamp >= today) return 'Сегодня';
  if (timestamp >= yesterday) return 'Вчера';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(new Date(timestamp).getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  }).format(new Date(timestamp));
}

export function historyTime(timestamp: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

export function relativeDay(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн. назад`;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(
    new Date(timestamp),
  );
}

export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
