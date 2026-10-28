import type { IconProps } from './types.js';

export function PencilLine({ size = 18, ...rest }: IconProps) {
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
      <path d="m4 20 4-1L19 8l-3-3L5 16z" />
      <path d="m14 7 3 3" />
    </svg>
  );
}
