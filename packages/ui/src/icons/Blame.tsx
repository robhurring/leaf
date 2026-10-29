import type { IconProps } from './types.js';

/** Lines of text with a bar in the margin beside them: blame. */
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
      <path d="M4 5v6" strokeWidth={2.6} />
      <path d="M4 15v4" strokeWidth={2.6} opacity={0.45} />
      <path d="M9 6h11M9 10h8M9 15h11M9 19h7" />
    </svg>
  );
}
