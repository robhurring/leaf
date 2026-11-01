//! The page leaf shows when it's opened with nothing to open (from Finder or the
//! Dock): how to open things, and the `leaf` command to install when it's missing.

use std::path::{Path, PathBuf};

/// The link on the page that installs the command (handled by the app, never opened).
pub const INSTALL_LINK: &str = "leaf://install-cli";

/// Where the install link puts the command.
pub const CLI_PATH: &str = "/usr/local/bin/leaf";

/// Whether there's a `leaf` command, and where.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Cli {
    Installed(PathBuf),
    /// Not found; `error` is why the last install didn't work.
    Missing {
        error: Option<String>,
    },
}

/// The first `leaf` in the places installs put it: the install link, Homebrew, and
/// `bin/install` (the app's own PATH is too short to search).
pub fn find_cli(home: &Path, exists: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    [
        PathBuf::from(CLI_PATH),
        PathBuf::from("/opt/homebrew/bin/leaf"),
        home.join(".local/bin/leaf"),
        home.join("bin/leaf"),
    ]
    .into_iter()
    .find(|p| exists(p))
}

/// The AppleScript that links `exe` as the command, asking for an admin password.
pub fn install_script(exe: &Path) -> String {
    let shell = format!(
        "mkdir -p /usr/local/bin && ln -sf '{}' {CLI_PATH}",
        exe.to_string_lossy().replace('\'', r"'\''")
    );
    let quoted = shell.replace('\\', r"\\").replace('"', r#"\""#);
    format!("do shell script \"{quoted}\" with administrator privileges")
}

/// The welcome page's markdown.
pub fn page(cli: &Cli) -> String {
    let mut s = String::from(
        "# Welcome to leaf\n\n\
         leaf reads the files next to your code: markdown, diagrams, slides, notebooks, \
         charts, and more. It opens a folder or a file; this page is what it shows when \
         it's started with neither.\n\n\
         ## Open something\n\n\
         - **File > Open Folder…** (⌘⇧O) picks a folder or a file.\n\
         - From a terminal, `leaf` opens what you name and hands the terminal back:\n\n\
         ```sh\n\
         leaf README.md        # one file\n\
         leaf open ~/notes     # a folder: tree, outline, search\n\
         leaf .                # a whole repo, .gitignore respected\n\
         ```\n\n\
         - A `leaf://open/` link opens in leaf from anywhere, for example \
         `leaf://open/~/notes/plan.md`.\n\n\
         ## The `leaf` command\n\n",
    );
    match cli {
        Cli::Installed(at) => s.push_str(&format!(
            "Installed at `{}`. Try `leaf open .` in a project.\n",
            at.display()
        )),
        Cli::Missing { error } => {
            if let Some(e) = error {
                s.push_str(&format!("> The command didn't install: {e}\n\n"));
            }
            s.push_str(&format!(
                "It isn't installed yet. **[Install the leaf command]({INSTALL_LINK})** \
                 links `{CLI_PATH}` to this app; macOS asks for your password once.\n\n\
                 Or link it yourself:\n\n\
                 ```sh\n\
                 ln -s \"/Applications/leaf reader.app/Contents/MacOS/leaf\" {CLI_PATH}\n\
                 ```\n\n\
                 With Homebrew, `brew install --cask robhurring/tap/leaf` installs both.\n"
            ));
        }
    }
    s
}

/// Writes the page under `config_dir`, replacing the last one, and returns its path.
pub fn write(config_dir: &Path, cli: &Cli) -> std::io::Result<PathBuf> {
    let dir = config_dir.join("welcome");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("Welcome to leaf.md");
    std::fs::write(&path, page(cli))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_page_says_how_to_open_things() {
        let page = page(&Cli::Installed(PathBuf::from("/usr/local/bin/leaf")));
        assert!(page.starts_with("# Welcome to leaf\n"));
        assert!(page.contains("**File > Open Folder…** (⌘⇧O)"));
        assert!(page.contains("leaf open ~/notes"));
        assert!(page.contains("`/usr/local/bin/leaf`"));
        assert!(!page.contains(INSTALL_LINK));
    }

    #[test]
    fn a_missing_command_gets_an_install_link() {
        let page = page(&Cli::Missing { error: None });
        assert!(page.contains(&format!("]({INSTALL_LINK})")));
        assert!(!page.contains("didn't install"));
    }

    #[test]
    fn a_failed_install_says_why_and_how_to_do_it_by_hand() {
        let page = page(&Cli::Missing {
            error: Some("User canceled.".into()),
        });
        assert!(page.contains("didn't install: User canceled."));
        assert!(page.contains("ln -s"));
    }

    #[test]
    fn the_command_is_found_where_installs_put_it() {
        let home = Path::new("/Users/me");
        let at = |hit: &'static str| move |p: &Path| p == Path::new(hit);
        assert_eq!(
            find_cli(home, at("/opt/homebrew/bin/leaf")),
            Some(PathBuf::from("/opt/homebrew/bin/leaf"))
        );
        assert_eq!(
            find_cli(home, at("/Users/me/.local/bin/leaf")),
            Some(PathBuf::from("/Users/me/.local/bin/leaf"))
        );
        assert_eq!(find_cli(home, |_| false), None);
    }

    #[test]
    fn the_install_script_quotes_the_app_path() {
        let s = install_script(Path::new(
            "/Applications/leaf reader.app/Contents/MacOS/leaf",
        ));
        assert_eq!(
            s,
            "do shell script \"mkdir -p /usr/local/bin && ln -sf '/Applications/leaf reader.app/Contents/MacOS/leaf' /usr/local/bin/leaf\" with administrator privileges"
        );
        // A quote in the path can't end the shell string or the AppleScript one.
        let odd = install_script(Path::new("/A/it's \"x\"/leaf"));
        assert!(odd.contains(r#"'/A/it'\\''s \"x\"/leaf'"#), "{odd}");
    }

    #[test]
    fn writing_the_page_replaces_the_last_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(dir.path(), &Cli::Missing { error: None }).unwrap();
        assert_eq!(path, dir.path().join("welcome").join("Welcome to leaf.md"));
        write(
            dir.path(),
            &Cli::Installed(PathBuf::from("/usr/local/bin/leaf")),
        )
        .unwrap();
        assert!(
            !std::fs::read_to_string(&path)
                .unwrap()
                .contains(INSTALL_LINK)
        );
    }
}
