export function LogoMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9.1" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.3" />
      <path d="M16.2 7.8 13.35 13.35 7.8 16.2l2.85-5.55z" fill="var(--accent)" />
    </svg>
  );
}

export function Wordmark() {
  return <span className="wordmark">ByAzen</span>;
}
