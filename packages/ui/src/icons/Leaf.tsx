import type { IconProps } from './types.js';

export function Leaf({ size = 18, ...rest }: IconProps) {
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
      <path d="M4 20C4 9.5 10.5 3.5 21 3.5 21 14 14.5 20 4 20Z" />
      <path d="M4 20 15 9" />
    </svg>
  );
}
