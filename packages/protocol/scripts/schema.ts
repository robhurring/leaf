// Writes one JSON Schema per message plus the two unions, so a server in any
// language can implement the protocol.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as p from '../src/index.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'schema');
mkdirSync(out, { recursive: true });

const singles: Record<string, Parameters<typeof zodToJsonSchema>[0]> = {
  hello: p.HelloMessage,
  list: p.ListMessage,
  read: p.ReadMessage,
  subscribe: p.SubscribeMessage,
  unsubscribe: p.UnsubscribeMessage,
  search: p.SearchMessage,
  searchText: p.SearchTextMessage,
  preferences: p.PreferencesMessage,
  blame: p.BlameMessage,
  welcome: p.WelcomeMessage,
  tree: p.TreeMessage,
  file: p.FileMessage,
  changed: p.ChangedMessage,
  matches: p.MatchesMessage,
  textMatches: p.TextMatchesMessage,
  blameHunks: p.BlameHunksMessage,
  presence: p.PresenceMessage,
  shareStatus: p.ShareStatusMessage,
  error: p.ErrorMessage,
  client: p.ClientMessage,
  server: p.ServerMessage,
};
for (const [name, schema] of Object.entries(singles)) {
  writeFileSync(
    join(out, `${name}.json`),
    JSON.stringify(zodToJsonSchema(schema, name), null, 2) + '\n',
  );
}
console.log(`wrote ${Object.keys(singles).length} schemas to ${out}`);
