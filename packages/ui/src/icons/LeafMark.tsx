import { useId } from 'react';
import type { IconProps } from './types.js';

/** leaf's own mark: a filled leaf with its midrib and veins, in the brand greens. */
export function LeafMark({ size = 18, ...rest }: IconProps) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...rest}>
      <defs>
        <linearGradient id={`${id}-g`} x1="4" y1="21" x2="21" y2="3" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1e8e4d" />
          <stop offset="1" stopColor="#4cd27a" />
        </linearGradient>
      </defs>
      <path
        d="M3.6 20.4C2.9 12 7.6 4.2 20.8 3.2c.6 12.6-6.2 18.1-14.9 17.6-.9 0-1.7-.2-2.3-.4Z"
        fill={`url(#${id}-g)`}
      />
      <path
        d="M3.8 20.2C8 15.6 12 11 17.6 6.6M9.2 14.9l-.4-4.1M12.4 11.6l-.2-3.6M11.6 15.6l3.7-.5M14.8 12.4l3.1-.6"
        fill="none"
        stroke="#fff"
        strokeOpacity={0.85}
        strokeWidth={1.25}
        strokeLinecap="round"
      />
    </svg>
  );
}
