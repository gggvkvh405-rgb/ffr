import type { EngineId } from '../../lib/types';
import { siDuckduckgo, siGoogle } from '../../lib/brands';
import { siBrave } from 'simple-icons';

export function EngineIcon({ id, size = 15 }: { id: EngineId; size?: number }) {
  if (id === 'yandex') {
    return (
      <span
        className="engine-glyph engine-glyph--yandex"
        style={{ width: size, height: size, fontSize: size * 0.92 }}
        aria-hidden="true"
      >
        Я
      </span>
    );
  }
  const icon = id === 'duckduckgo' ? siDuckduckgo : id === 'google' ? siGoogle : siBrave;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="engine-glyph"
    >
      <path d={icon.path} />
    </svg>
  );
}
