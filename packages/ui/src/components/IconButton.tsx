import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  pressed?: boolean;
  children: ReactNode;
  small?: boolean;
};

/** An icon-only button with a tooltip (title) and an accessible name. */
export function IconButton({ label, pressed, children, small, className = '', ...rest }: Props) {
  return (
    <button
      type="button"
      className={`leaf-ib ${small ? 'leaf-ib-sm' : ''} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      {...rest}
    >
      {children}
    </button>
  );
}
