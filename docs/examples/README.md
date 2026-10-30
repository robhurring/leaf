# leaf

This folder is leaf's living demo: everything leaf can show is somewhere in here. Open it with `leaf docs/examples`, and edit any file while it's open: the page follows.

> [!TIP]
> Start with [Markdown](./markdown.md) for the basics, then try the pages below.

## Markdown

[markdown.md](./markdown.md) is everything GitHub renders, on one long page: text, lists, tables, every heading level, alerts, code, math, links, images, HTML, and frontmatter. It's also the page for trying the reader itself: the outline, heading numbers, Go to, Find, and Properties.

## Beyond Markdown

- **[Diagrams](./diagrams.md)**: Mermaid, PlantUML, and Excalidraw blocks, drawn in place. Hover one to zoom and pan, or open the zoomed view to draw on it. The [diagrams folder](./diagrams/flow.mmd) has the same three as files of their own.
- **[Animations](./animations.md)**: ` ```three ` and ` ```canvas ` blocks that run, for illustrating ideas: a shape to turn around, a sine wave from a circle, a sort stepping through. [Updraft](./animations/updraft.md) is a whole game in one block.

## Other files

leaf opens any file in the folder, not only markdown:

- Code and text in a read-only editor with line numbers you can link to: [script.py](./files/script.py), [config.toml](./files/config.toml), [notes.txt](./files/notes.txt).
- A CSV as a sortable, filterable table: [data.csv](./files/data.csv).
- Images on a checkerboard: [logo.svg](./files/logo.svg), [photo.jpg](./files/photo.jpg).
- Anything else as a card with its facts: [blob.bin](./files/blob.bin).

The file tree hides what git ignores (`files/build/` here) and reaches as deep as the folders go ([three folders down](./files/nested/deep/deeper/leaf.md)).

## Keys

| Key       | Action                                      |
| --------- | ------------------------------------------- |
| `⌘K`      | go to a heading, a file, or text anywhere   |
| `⌘O`      | go to a file                                |
| `⌘F`      | find in the document                        |
| `j` `k`   | scroll a line; `^d` `^u` half a page        |
| `^n` `^p` | next and previous heading                   |
| `[` `]`   | the file tree, the outline                  |
| `n` `t`   | number the headings, switch light and dark  |
| `⌘[` `⌘]` | back and forward through the files you read |
| `esc`     | close whatever is open                      |
