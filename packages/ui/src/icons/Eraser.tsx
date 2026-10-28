import type { IconProps } from './types.js';

export function Eraser({ size = 18, ...rest }: IconProps) {
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
      <path d="m14 4 6 6-9 9H8l-4-4z" />
      <path d="M9 10l5 5M5 20h15" />
    </svg>
  );
}
