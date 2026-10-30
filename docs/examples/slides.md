---
marp: true
theme: default
paginate: true
---

# Slides

A markdown file with `marp: true` in its frontmatter opens as a deck, drawn by [Marp](https://marp.app) so it looks the same as in VS Code or `marp-cli`.

Use **→** or **space** to move on.

<!--
Welcome everyone. These are the **speaker notes** for this slide: they show under the slide while you rehearse, and in the speaker window while you present.

- Notes are Marp comments, written in markdown
- Lists, **bold**, and `code` all work
-->

---

# Writing a deck

- `---` starts a new slide
- `theme:` picks Marp's `default`, `gaia`, or `uncover`
- `paginate: true` numbers the slides
- Comments become the speaker notes

Edit this file while it's open: the deck follows and stays on this slide.

<!--
Walk through the four bullets quickly. The point to land: **a deck is just markdown**, so it diffs, reviews, and lives next to the code.

Try it now: change a bullet and save.
-->

---

<!-- _class: lead -->

# Presenting

**Present** fills the screen with the slide. **Speaker** opens a window with these notes, the next slide, and a timer, and keeps it in step. **All slides** shows every slide at once. **Document** in the file toolbar reads this file as a plain document.

<!--
Click **Present** and press **Esc** to come back.

Then open **Speaker**: move with the arrow keys in either window and the other follows.
-->

---

# Code and math

```ts
const greet = (name: string) => `hello, ${name}`;
```

$$
e^{i\pi} + 1 = 0
$$

<!--
Code is highlighted and math is typeset with KaTeX, offline.

If someone asks: Euler's identity ties together *e*, *i*, *π*, 1, and 0.
-->

---

# Thanks

Slides can also sit inside any document as a ` ```marp ` block: see [animations.md](./animations.md) for blocks that move, and the [README](./README.md) for everything else.

<!--
Wrap up. Point at the README for the rest of what leaf can show, then take questions.
-->
