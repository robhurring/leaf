# Inline matchers

Mentions and topics are highlighted by built-in matchers. Ask @rob about #rendering, or ping @someone-else about #leaf-ideas.

Inside a GitHub or GitLab checkout, mentions link to that host automatically. Set `LEAF_MENTION_URL=https://example.com/people/{username}` in `.env` to point them elsewhere, or register your own matcher in code for anything fancier.

## Defining your own

A matcher is a global regex plus a function from the match to a link, a styled span, or a React node. Register it once, before the first render, and every document picks it up. Matchers never fire inside code, links, or `<kbd>`.

```ts
import { registries } from '@leaf/ui';

// Ticket keys like LEAF-42 link to the tracker.
registries.inline.register({
  name: 'ticket',
  pattern: /\b([A-Z]{2,}-\d+)\b/g,
  render: ([, key]) => ({
    href: `https://tracker.example.com/browse/${key}`,
    label: key,
    className: 'leaf-topic',
  }),
});

// A bare span with no link: just highlight the word.
registries.inline.register({
  name: 'todo',
  pattern: /\bTODO\b/g,
  render: () => ({ className: 'leaf-mention' }),
});
```

`register` returns an unregister function, and registering the same `name` again replaces the earlier matcher, so the built-in `mention` and `topic` can be swapped out too.

Embedders who only need to decide where a mention or topic points can skip the regex and pass handlers to the Reader. Return a link, a label, or a React node; return `undefined` to fall back to the default.

```tsx
import { Reader } from '@leaf/ui';

<Reader
  source={source}
  handlers={{
    onMention: (username) => ({ href: `/people/${username}`, label: `@${username}` }),
    onTopic: (topic) => ({ href: `/topics/${topic}` }),
  }}
/>;
```

With those registered, LEAF-42 and TODO would light up here.

## Where they must not fire

- Inside code: `@notamention` and `#notatopic`.
- In emails: a@b.com stays plain.
- In URLs: https://example.com/#fragment and https://example.com/@user.
- In a fenced block:

```
@alsonotamention in a block, #alsonotatopic
```

- In a link: [talk to @someone](https://example.com).
