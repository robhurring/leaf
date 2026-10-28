import type { IconProps } from './types.js';

export function File({ size = 18, ...rest }: IconProps) {
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
      <path d="M6 3h8l5 5v13H6z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}
