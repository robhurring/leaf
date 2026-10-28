import type { IconProps } from './types.js';

export function CollapseAll({ size = 18, ...rest }: IconProps) {
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
      <path d="m7 15 5-5 5 5" />
      <path d="m7 20 5-5 5 5" opacity={0.45} />
    </svg>
  );
}
