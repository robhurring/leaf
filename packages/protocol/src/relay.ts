import { z } from 'zod';

/** Who may do what in a shared session. */
export const ShareMode = z.enum(['read-only']);
export type ShareMode = z.infer<typeof ShareMode>;

/** Someone in a shared session: the host or a viewer. */
export const Peer = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});
export type Peer = z.infer<typeof Peer>;

export const ShareInfo = z.object({
  id: z.string(),
  host: Peer,
  mode: ShareMode,
  webUrl: z.string(),
  appUrl: z.string(),
});
export type ShareInfo = z.infer<typeof ShareInfo>;
