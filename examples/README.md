# leaf

A first-class markdown reader in the browser. This folder is the living demo: every rendering capability leaf has is shown somewhere in here, and `leaf open examples` is the primary way to try it by hand.

> [!TIP]
> Edit any file in this folder while it is open and the page updates live.

## Markdown

- [GitHub flavored markdown](./gfm.md): tables, task lists, strikethrough, footnotes, autolinks, nested lists, emoji.
- [Headings](./headings.md): duplicate heading names, punctuation, deep nesting.
- [Code](./code.md): fenced blocks with and without a language, highlighted by shiki.
- [Inline matchers](./inline-matchers.md): `@user` and `#topic` highlighting and where it must not fire.
- [Links and images](./links-and-images.md): relative links between documents, images, anchors, a broken link.
- [Alerts](./alerts.md): all five GitHub alert types.
- [Math](./math.md): inline and display KaTeX.
- [Frontmatter](./frontmatter.md): YAML frontmatter parsed and removed.
- [HTML passthrough](./html.md): `<details>` kept, scripts stripped.
- [Outline and numbering](./outline-and-numbering.md): heading levels that jump, for the numbering toggle.
- [Diagrams](./diagrams.md): mermaid, PlantUML, and Excalidraw blocks, a broken one, and the zoom-in Stage with drawing tools.
- [Animations](./animations.md): live three.js and canvas blocks for illustrating ideas, a broken one, and presenting them in the Stage.

## Other files

Open these from the file tree to see each viewer.

- `files/script.py`, `files/config.toml`, `files/notes.txt`: text files in a read-only editor with line numbers and search.
- `viewers/flow.mmd`, `viewers/sequence.puml`, `viewers/sketch.excalidraw`: diagram files, each with the zoom-in Stage.
- `files/data.csv`: a CSV, shown as a sortable, filterable table. Fenced ` ```csv ` blocks render the same way.
- `files/blob.bin`: a binary file, shown as a card with its facts.
- `assets/logo.svg`, `assets/photo.jpg`: images on a transparent checkerboard.

Every file has a collapsed **Properties** panel at the top: path, size, type, modified time, the last git commit when the folder is a repository, and any frontmatter.

- `nested/deep/deeper/leaf.md`: a document three folders down, for the tree and the filter.
- `build/ignored.md`: listed in `.gitignore`, so it must not appear in the tree.

## Keyboard

| Key                 | Action                                                    |
| ------------------- | --------------------------------------------------------- |
| `⌘K` / `Ctrl+K`     | Jump to a heading in this file (`Ctrl+N` / `Ctrl+P` move) |
| `⌘O` / `Ctrl+O`     | Open another file                                         |
| `j` / `k`           | Scroll a line down / up                                   |
| `Ctrl+D` / `Ctrl+U` | Scroll half a page down / up                              |
| `[`                 | Toggle the file tree                                      |
| `]`                 | Toggle the outline                                        |
| `n`                 | Toggle heading numbers                                    |
| `t`                 | Toggle light and dark                                     |
