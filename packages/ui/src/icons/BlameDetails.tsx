import type { IconProps } from './types.js';

/** A margin label beside a line: blame expanded to who and when. */
export function BlameDetails({ size = 18, ...rest }: IconProps) {
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
      <rect x="2.5" y="5" width="8" height="5" rx="1.2" />
      <path d="M14 7.5h7.5M14 15h7.5M14 19h5" />
      <path d="M3 15h6" opacity={0.45} />
    </svg>
  );
}
