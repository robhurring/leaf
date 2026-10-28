# Delivery 1 acceptance: what needs a real display

Automated checks cover the core, serve mode, the CLI, the window layer, and the UI on three browser engines. These need a person at the screen. Build first with `bin/build`, then run `target/release/leaf open examples` (or `bin/install` and `leaf open examples`).

Verified by the agent (Oct 28): the app process starts, its window's session connects through the Tauri bridge, and README.md opens (`client connected`, `opened` in the log). Not verified visually; screen capture is not permitted from the terminal.

- [ ] A window opens on `examples` with README.md, the traffic lights inside leaf's title bar, no browser involved; the terminal returns at once.
- [ ] `leaf open examples/gfm.md` from another terminal opens a second window in the same app (one dock icon), at gfm.md.
- [ ] Editing a file in the folder updates the open window live.
- [ ] Images (`assets/photo.jpg`, `links-and-images.md`) show: they come over the bridge as bytes, not `/raw`.
- [ ] View menu: Light, Dark, System, Files, Outline, Number Headings, text size (⌘= ⌘- ⌘0) each act on the focused window.
- [ ] File > Open Folder… picks a folder and opens a window on it.
- [ ] The Appearance button offers Light, Dark, System only; no theme list.
- [ ] Diagrams: zoom in, trackpad pinch zooms the Stage (not the page), two-finger scroll pans, pencil draws.
- [ ] Copy as image on a mermaid diagram puts a PNG on the clipboard (the WebKit path).
- [ ] Closing the last window quits the app.
- [ ] Logs for the app are in `~/.config/leaf/logs/leaf.log`.

Known gaps carried to later work: files above `LEAF_MAX_INLINE_BYTES` (2 MiB) have no byte path in the window (no `/raw`); the PlantUML/Copy-as-image raster path still awaits before writing the clipboard.
