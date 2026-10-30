---
title: Everything in GitHub Markdown
tags: [examples, markdown]
---

# Markdown

Everything GitHub renders in a `.md` file, on one page. It's long on purpose: try the outline (the list icon at the top right), numbering (press `n`), Go to (`⌘K`, type "grand"), and Find (`⌘F`). The frontmatter above isn't shown in the page; open **Properties** in the file header to see it as a table.

## Text

**Bold**, _italic_, ~~struck through~~, `inline code`, and a footnote.[^note] Shortcodes like :tada: and :leaves: become emoji. Bare links turn into links: https://example.com and a@b.com.

[^note]: The footnote's text, linked back to where it was cited.

Mentions and topics light up: ask @rob about #rendering. Inside a GitHub checkout they link to that host. They never fire in code (`@notamention`, `#notatopic`), in emails, in URLs (https://example.com/#fragment), or inside a link: [talk to @someone](https://example.com).

## Lists

1. First
   - an inner bullet
   - another
2. Second
   1. deep ordered

- [x] A done thing
- [ ] An open thing
  - [ ] Nested and open

## Tables

| Left   |  Center  | Right |
| :----- | :------: | ----: |
| a      |    b     |     c |
| `code` | **bold** |  _em_ |

Put `<!--table:filter-->` on the line before a table to give it a filter; it's an HTML comment, so GitHub shows the plain table:

<!--table:filter-->

| Service | Owner  | Status      |
| :------ | :----- | :---------- |
| `api`   | @rob   | **healthy** |
| `auth`  | @ana   | degraded    |
| `queue` | @rob   | **healthy** |
| `web`   | @jules | down        |

A fenced ` ```csv ` block becomes a table you can sort and filter:

```csv
name,kind,size
README.md,markdown,1024
logo.svg,image,2048
blob.bin,binary,4096
```

## Headings

Every level, names that repeat, and punctuation. Repeated names get their own anchors, and numbering follows the nesting even when a level is skipped.

### Setup

The first one.

### Setup

The second, with the same name.

### What's new? (v2)

#### Child

##### Grandchild

###### The sixth level

### A skipped level

##### Skips from three to five

It's numbered under its nearest parent.

## Quotes and alerts

> A plain quote, with **emphasis**.
>
> ### And a heading inside

> [!NOTE]
> A note.

> [!TIP]
> A tip.

> [!IMPORTANT]
> Important.

> [!WARNING]
> A warning.

> [!CAUTION]
> Caution.

## Code

```typescript
export interface DocumentSource {
  send(msg: ClientMessage): void;
}
```

```python title="hello.py"
print("hi")
```

```
no language
```

Hover a block to copy it. Code files open in a read-only editor: [script.py](./files/script.py).

## Math

Inline $E = mc^2$ and a display:

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

## Links and images

- [A heading on this page](#tables)
- [A heading in another document](./diagrams.md#mermaid)
- [A document three folders down](./files/nested/deep/deeper/leaf.md)
- [A file that isn't markdown](./files/notes.txt), opened in the code viewer
- [A broken link](./missing.md), which shows the not-found page
- [An external site](https://example.com), opened in your browser

![leaf's logo](./files/logo.svg)

![a photo](./files/photo.jpg)

## HTML

<details>
<summary>Click to open</summary>

Hidden **markdown**.

</details>

Scripts and event handlers are removed; the image below is still an image.

<script>alert('x')</script>

<img src="./files/logo.svg" alt="still an image" width="48" onerror="alert(1)">
