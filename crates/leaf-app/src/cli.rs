//! The help text. Parsing lives in leaf-core's config so the app and tests share it.
pub const HELP_TEXT: &str = "leaf — view markdown beautifully

usage:
  leaf [open] [path]          open a file or folder in a leaf reader window and return (default: .)
  leaf open --browser [path]  open it in your browser instead; the server goes away when the tab closes
  leaf serve [path]           same, but stay in the foreground and stream the logs (ctrl-c stops)
  leaf share [path]           share with others (not yet available)
  leaf 'leaf://open/<path>'   open a link: an absolute path (or ~/…), then any of ?root=<folder> (show the
                              file inside that folder), &browser, #heading. bin/install registers the
                              installed app, so `open 'leaf://…'` and links in other apps land here; a
                              window already showing the file or its folder comes forward instead.
  leaf --help | --version

flags (each overrides the matching variable in the environment or .env):
  -l, --log-level <level>     LOG_LEVEL           error|warn|info|debug (default warn; info shows the traffic,
                                                  debug every payload). Given on the command line, leaf stays
                                                  in the foreground with the logs on the terminal.
  --log-format <fmt>          LOG_FORMAT          text|json (default text)
  --port <n>                  PORT                bind port (default 4321, falls back to a free one; 0 = random)
  --host <addr>               HOST                bind address (default 127.0.0.1)
  --open / --no-open          LEAF_OPEN           open a browser tab (open --browser: on; serve: off unless set)
  --idle-timeout <dur>        LEAF_IDLE_TIMEOUT   exit after this long with no client connected
                                                  (open: 10s; serve: never; 0 = never)
  --plantuml-url <url>        PLANTUML_URL        PlantUML server; unset shows plantuml source
  --ignore <patterns>         LEAF_IGNORE         comma-separated gitignore patterns always skipped
  --gitignore / --no-gitignore  LEAF_GITIGNORE    honor .gitignore files (default on)
  --config-dir <dir>          LEAF_CONFIG_DIR     preferences, instance list, logs (default ~/.config/leaf)

a detached server logs to <config-dir>/logs/leaf.log.
";
