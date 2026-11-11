// A reader in a share: a disc in their colour with their initials.
import type { Peer } from '@leaf/protocol';
import { initials } from './presence.js';

export function Avatar({ name, color, size = 16 }: { name: string; color: string; size?: number }) {
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className="leaf-avatar"
      style={{ background: color, width: size, height: size, lineHeight: `${size}px` }}
    >
      {initials(name)}
    </span>
  );
}

/** Up to `max` avatars, then how many more. */
export function AvatarStack({ peers, max = 3 }: { peers: Peer[]; max?: number }) {
  if (peers.length === 0) return null;
  const rest = peers.slice(max);
  return (
    <span className="leaf-avatar-stack">
      {peers.slice(0, max).map((p) => (
        <Avatar key={p.id} name={p.name} color={p.color} />
      ))}
      {rest.length > 0 && (
        <span className="leaf-avatar-more" title={rest.map((p) => p.name).join(', ')}>
          +{rest.length}
        </span>
      )}
    </span>
  );
}
