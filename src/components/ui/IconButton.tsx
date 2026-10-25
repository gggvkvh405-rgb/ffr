import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  tooltipSide?: 'top' | 'bottom';
  active?: boolean;
  tone?: 'default' | 'accent';
  size?: 'sm' | 'md';
}

export function IconButton({
  label,
  children,
  className = '',
  tooltipSide = 'bottom',
  active = false,
  tone = 'default',
  size = 'md',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={[
        'icon-btn',
        size === 'sm' ? 'icon-btn--sm' : '',
        active ? 'is-active' : '',
        tone === 'accent' ? 'is-accent' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={label}
      data-tip={label}
      data-tip-side={tooltipSide}
      {...rest}
    >
      {children}
    </button>
  );
}
