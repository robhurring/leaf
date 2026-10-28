import type { IconProps } from './types.js';

export function Numbering({ size = 18, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d="M10 6h10M10 12h10M10 18h10" />
      <path d="M4 5h1.5v4M4 9h3" />
      <path d="M4 15.5a1.5 1.5 0 0 1 3 0c0 1-3 2-3 3.5h3" />
    </svg>
  );
}
