import type { IconProps } from './types.js';

/** A commit on a branch, git style: blame, who changed what. */
export function Blame({ size = 18, ...rest }: IconProps) {
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
      <circle cx="7" cy="12" r="2.6" />
      <path d="M7 3v6.4M7 14.6V21" />
      <circle cx="17" cy="7" r="2.6" />
      <path d="M17 9.6c0 4.4-4 4.4-7.4 2.4" />
    </svg>
  );
}
