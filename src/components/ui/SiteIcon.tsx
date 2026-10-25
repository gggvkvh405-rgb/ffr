import { useEffect, useState } from 'react';
import { brandForUrl } from '../../lib/brands';
import { hostOf } from '../../lib/url';

interface SiteIconProps {
  url: string;
  size?: number;
  className?: string;
}

export function SiteIcon({ url, size = 18, className = '' }: SiteIconProps) {
  const brand = brandForUrl(url);
  const host = hostOf(url);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (brand) {
    return (
      <svg
        className={`site-icon ${className}`}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d={brand.path} />
      </svg>
    );
  }

  if (failed || !host) {
    return (
      <span
        className={`site-icon site-icon--letter ${className}`}
        style={{ width: size, height: size, fontSize: Math.max(9, size * 0.46) }}
        aria-hidden="true"
      >
        {(host || '?').charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      className={`site-icon ${className}`}
      src={`https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
