import type { IconProps } from './types.js';

/** A stroke that trails off: invisible ink. */
export function Fade({ size = 18, ...rest }: IconProps) {
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
      <path d="M3 16c3-6 6-6 8-2" />
      <path d="M14 11.5c.6-.6 1.2-.9 1.8-.9" strokeOpacity={0.6} />
      <path d="M18.5 10.8c.4 0 .9.1 1.3.3" strokeOpacity={0.3} />
    </svg>
  );
}
