# Slides

leaf shows [Marp](https://marp.app) decks three ways:

- **[slides/marp.md](./slides/marp.md)** is a markdown file with `marp: true` in its frontmatter. It opens as a deck; the page button in the file toolbar reads it as a document instead.
- **[slides/launch.marp](./slides/launch.marp)** is a `.marp` file. It is always a deck.
- A ` ```marp ` block, like the one below, is a deck inside an ordinary document.

## A deck in a document

The block has the same tools as a whole deck: **‹ ›** to move (or click the slide, or focus it and use the arrow keys), **All slides**, **Notes** for the speaker notes, and **Present** to fill the screen. **Esc** comes back.

```marp
---
theme: gaia
paginate: true
---

# Quarterly review

Embedded in `slides.md`

<!--
These notes are hidden in the document until you press **Notes**.
-->

---

## Numbers

- Revenue up **12%**
- Two launches shipped
- One incident, fixed in an hour

<!--
Pause on the incident: what we changed afterwards matters more than the hour.
-->

---

<!-- _class: lead -->

# Questions?
```

The text around the deck is plain markdown, so a deck can sit in a design doc or a README next to the prose that explains it.
