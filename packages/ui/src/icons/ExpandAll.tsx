import type { IconProps } from './types.js';

export function ExpandAll({ size = 18, ...rest }: IconProps) {
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
      <path d="m7 9 5 5 5-5" />
      <path d="m7 4 5 5 5-5" opacity={0.45} />
    </svg>
  );
}
