import type { IconProps } from './types.js';

export function WrapText({ size = 18, ...rest }: IconProps) {
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
      <path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4" />
      <path d="m15 16-2 2 2 2M4 18h5" />
    </svg>
  );
}
