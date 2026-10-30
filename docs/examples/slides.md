---
marp: true
theme: default
paginate: true
---

# Slides

A markdown file with `marp: true` in its frontmatter opens as a deck, drawn by [Marp](https://marp.app) so it looks the same as in VS Code or `marp-cli`.

Use **→** or **space** to move on.

<!-- Speaker notes live in comments like this one. -->

---

# Writing a deck

- `---` starts a new slide
- `theme:` picks Marp's `default`, `gaia`, or `uncover`
- `paginate: true` numbers the slides
- Comments become the speaker notes

Edit this file while it's open: the deck follows and stays on this slide.

---

<!-- _class: lead -->

# Presenting

**Present** fills the screen with the slide. **Speaker** opens a window with your notes, the next slide, and a timer, and keeps it in step. **All slides** shows every slide at once. **Document** in the file toolbar reads this file as a plain document.

<!-- This note shows in the speaker window. Press the arrow keys there and this window follows. -->

---

# Code and math

```ts
const greet = (name: string) => `hello, ${name}`;
```

$$
e^{i\pi} + 1 = 0
$$

---

# Thanks

Slides can also sit inside any document as a ` ```marp ` block: see [animations.md](./animations.md) for blocks that move, and the [README](./README.md) for everything else.
