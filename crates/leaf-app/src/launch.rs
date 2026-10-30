//! The command side of `leaf open`: find a server already showing this path,
//! or start one detached and hand back its URL once it is listening.
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::instances::{Instance, find_serving, read_instances, remove_instance};

pub const OPEN_IDLE_DEFAULT: &str = "10s";
/// The child tells the parent its URL through this file.
pub const READY_FILE_ENV: &str = "LEAF_READY_FILE";

const VALUE_FLAGS: &[&str] = &[
    "--host",
    "--port",
    "-l",
    "--log-level",
    "--log-format",
    "--plantuml-url",
    "--ignore",
    "--config-dir",
    "--idle-timeout",
];

/// The flags of an invocation, values included, without the command word, the target,
/// `--browser`, or `--open`/`--no-open`. The one place argv is forwarded from.
fn forwarded_flags(argv: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < argv.len() {
        let a = argv[i].as_str();
        if VALUE_FLAGS.contains(&a) {
            out.push(a.to_string());
            out.push(argv.get(i + 1).cloned().unwrap_or_default());
            i += 2;
            continue;
        }
        i += 1;
        if a.starts_with('-') && !matches!(a, "--browser" | "--open" | "--no-open") {
            out.push(a.to_string());
        }
    }
    out
}

/// The app process's argv for `leaf open`: the hidden `__app` command, the target, the flags.
pub fn app_args(argv: &[String], target: &Path) -> Vec<String> {
    let mut out = vec!["__app".to_string(), target.to_string_lossy().into_owned()];
    out.extend(forwarded_flags(argv));
    out
}

/// Whether a server started by this invocation opens a browser tab. `leaf serve` is a
/// server and opens one only when told to (`--open` or `LEAF_OPEN`); `leaf open --browser`
/// opens one unless told not to.
pub fn opens_browser(
    command: leaf_core::config::Command,
    open: bool,
    source: leaf_core::config::ConfigSource,
) -> bool {
    match command {
        leaf_core::config::Command::Serve => {
            open && source != leaf_core::config::ConfigSource::Default
        }
        _ => open,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Help,
    Version,
    Share,
    Serve,
    /// `leaf open`: start the app detached (or hand off to the running one) and return.
    LaunchApp,
    /// The app in this process: the detached child, or `leaf open -l …` watching its logs.
    AppForeground,
    /// `leaf open --browser`.
    Browser,
}

pub fn route(
    command: leaf_core::config::Command,
    as_app: bool,
    browser: bool,
    log_flag: bool,
) -> Route {
    use leaf_core::config::Command;
    match command {
        Command::Help => Route::Help,
        Command::Version => Route::Version,
        Command::Share => Route::Share,
        Command::Serve => Route::Serve,
        Command::Open if as_app => Route::AppForeground,
        Command::Open if browser => Route::Browser,
        Command::Open if log_flag => Route::AppForeground,
        Command::Open => Route::LaunchApp,
    }
}

/// The child's argv: the same flags, but `serve`, no browser, and an explicit idle timeout.
pub fn child_args(argv: &[String], target: &Path, idle_timeout: Option<&str>) -> Vec<String> {
    let mut out = vec!["serve".to_string(), target.to_string_lossy().into_owned()];
    out.extend(forwarded_flags(argv));
    out.push("--no-open".into());
    if let Some(idle) = idle_timeout
        && !argv.iter().any(|a| a == "--idle-timeout")
    {
        out.push("--idle-timeout".into());
        out.push(idle.to_string());
    }
    out
}

pub fn pid_alive(pid: u32) -> bool {
    // Signal 0 checks for existence without sending anything.
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

pub async fn healthy(url: &str) -> bool {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let Some(rest) = url.strip_prefix("http://") else {
        return false;
    };
    let Ok(Ok(mut s)) = tokio::time::timeout(
        Duration::from_millis(1500),
        tokio::net::TcpStream::connect(rest),
    )
    .await
    else {
        return false;
    };
    if s.write_all(b"GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .await
        .is_err()
    {
        return false;
    }
    let mut buf = Vec::new();
    let _ = tokio::time::timeout(Duration::from_millis(1500), s.read_to_end(&mut buf)).await;
    String::from_utf8_lossy(&buf).ends_with("ok")
}

/// A live instance already serving `target`, with the URL to open; stale entries are dropped.
pub async fn find_running(config_dir: &Path, target: &Path) -> Option<(Instance, String)> {
    let mut live = Vec::new();
    for inst in read_instances(config_dir) {
        if pid_alive(inst.pid) && healthy(&inst.url).await {
            live.push(inst);
        } else {
            remove_instance(config_dir, inst.pid);
        }
    }
    let target = target.to_string_lossy();
    let (inst, path) = find_serving(&live, &target)?;
    let url = if path.is_empty() {
        inst.url.clone()
    } else {
        let encoded: Vec<String> = path.split('/').map(encode_segment).collect();
        format!("{}/{}", inst.url, encoded.join("/"))
    };
    Some((inst.clone(), url))
}

fn encode_segment(seg: &str) -> String {
    seg.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Keeps the app log bounded: past `max` bytes it moves to `<log>.1` (replacing the old one).
pub fn rotate_log(log: &Path, max: u64) {
    if std::fs::metadata(log).is_ok_and(|m| m.len() > max) {
        let _ = std::fs::rename(log, log.with_extension("log.1"));
    }
}

pub const LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;

pub fn log_file_for(config_dir: &Path) -> PathBuf {
    config_dir.join("logs").join("leaf.log")
}

/// Spawns `exe args` detached (its own process group, output to the log file) and waits for
/// the URL it writes to a ready file.
pub async fn launch_detached(
    exe: &Path,
    args: &[String],
    config_dir: &Path,
    timeout: Duration,
) -> Result<(String, u32), String> {
    use std::os::unix::process::CommandExt;
    let log_file = log_file_for(config_dir);
    std::fs::create_dir_all(log_file.parent().unwrap_or(config_dir)).map_err(|e| e.to_string())?;
    rotate_log(&log_file, LOG_MAX_BYTES);
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
        .map_err(|e| e.to_string())?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;
    let ready = std::env::temp_dir().join(format!(
        "leaf-ready-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
    ));
    let mut child = Command::new(exe)
        .args(args)
        .env(READY_FILE_ENV, &ready)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .process_group(0)
        .spawn()
        .map_err(|e| format!("could not start the server: {e}"))?;
    let pid = child.id();
    let end = Instant::now() + timeout;
    loop {
        if let Ok(text) = std::fs::read_to_string(&ready) {
            let url = text.trim().to_string();
            if !url.is_empty() {
                let _ = std::fs::remove_file(&ready);
                return Ok((url, pid));
            }
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "server exited early ({status}); see {}",
                log_file.display()
            ));
        }
        if Instant::now() > end {
            let _ = child.kill();
            return Err(format!(
                "server did not start within {}s; see {}",
                timeout.as_secs(),
                log_file.display()
            ));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// The UI route for a document path: `/` plus each segment URL-encoded, as the router builds it.
pub fn route_for(path: &str) -> String {
    let segments: Vec<String> = path
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|seg| {
            seg.bytes()
                .map(|b| match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                        (b as char).to_string()
                    }
                    _ => format!("%{b:02X}"),
                })
                .collect()
        })
        .collect();
    format!("/{}", segments.join("/"))
}

/// The target a `leaf __app <path> …` invocation names (the second launch's argv).
pub fn target_from_argv(argv: &[String], cwd: &Path) -> Option<PathBuf> {
    let mut it = argv.iter().skip_while(|a| *a != "__app").skip(1);
    let raw = it.find(|a| !a.starts_with('-'))?;
    let p = cwd.join(raw);
    p.canonicalize().ok()
}

/// A `leaf://open/<path>` link: what to open, and how.
///
/// `leaf://open/Users/me/notes/plan.md?root=/Users/me/notes&browser#next-steps`
/// - the path after `open` is absolute (`~/` means home); `?path=` works too
/// - `root`: a folder to show around the file, with the file open in it
/// - `browser`: open in the browser instead of a window
/// - `#heading`: the heading to scroll to
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeepLink {
    pub target: PathBuf,
    pub root: Option<PathBuf>,
    pub heading: Option<String>,
    pub browser: bool,
    /// The path ended in `/`: a folder, even before it exists to ask.
    folder: bool,
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = |c: u8| (c as char).to_digit(16);
        if b[i] == b'%'
            && let (Some(h), Some(l)) = (hex(b[i + 1]), b.get(i + 2).and_then(|&c| hex(c)))
        {
            out.push((h * 16 + l) as u8);
            i += 3;
            continue;
        }
        out.push(if b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn absolute(raw: &str) -> Result<PathBuf, String> {
    if let Some(rest) = raw.strip_prefix("~/") {
        let home = std::env::var("HOME").map_err(|_| "no HOME for ~/".to_string())?;
        return Ok(PathBuf::from(home).join(rest));
    }
    if raw.starts_with('/') {
        Ok(PathBuf::from(raw))
    } else {
        Err(format!("the path must be absolute: {raw}"))
    }
}

pub fn parse_deep_link(url: &str) -> Result<DeepLink, String> {
    let rest = url
        .strip_prefix("leaf:")
        .ok_or_else(|| format!("not a leaf:// link: {url}"))?
        .trim_start_matches('/');
    let (rest, heading) = match rest.split_once('#') {
        Some((r, h)) if !h.is_empty() => (r, Some(percent_decode(h))),
        Some((r, _)) => (r, None),
        None => (rest, None),
    };
    let (path_part, query) = rest.split_once('?').unwrap_or((rest, ""));
    let path_part = path_part
        .strip_prefix("open")
        .filter(|p| p.is_empty() || p.starts_with('/'))
        .ok_or_else(|| format!("leaf links start leaf://open/: {url}"))?;
    let mut root = None;
    let mut browser = false;
    let mut from_query = None;
    for pair in query.split('&').filter(|p| !p.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        match k {
            "path" => from_query = Some(percent_decode(v)),
            "root" => root = Some(absolute(&percent_decode(v))?),
            "browser" => browser = !matches!(v, "0" | "false"),
            _ => tracing::warn!(flag = k, "ignoring an unknown leaf:// flag"),
        }
    }
    // `open/Users/x` names /Users/x; `open/~/x` names ~/x.
    let raw = match from_query {
        Some(p) => p,
        None if path_part.len() > 1 => {
            let p = percent_decode(path_part);
            if p.starts_with("/~/") {
                p[1..].to_string()
            } else {
                p
            }
        }
        None => return Err(format!("the link names no path: {url}")),
    };
    Ok(DeepLink {
        folder: raw.ends_with('/'),
        target: absolute(&raw)?,
        root,
        heading,
        browser,
    })
}

impl DeepLink {
    /// What the window opens, and the document to show in it: the root with the file
    /// inside it; a file on its own (routed by its name); or a folder.
    pub fn opening(&self) -> (PathBuf, String) {
        if let Some(root) = &self.root
            && let Ok(rel) = self.target.strip_prefix(root)
        {
            return (root.clone(), rel.to_string_lossy().into_owned());
        }
        if self.folder || self.target.is_dir() {
            return (self.target.clone(), String::new());
        }
        let name = self
            .target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        (self.target.clone(), name)
    }

    /// The same link with its paths resolved as the file system has them (symlinks,
    /// /tmp for /private/tmp); a path that doesn't exist stays as written.
    pub fn canonical(self) -> DeepLink {
        let canon = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
        DeepLink {
            target: canon(&self.target),
            root: self.root.as_deref().map(canon),
            ..self
        }
    }

    /// The UI route for the document, heading included.
    pub fn route(&self) -> String {
        let (_, doc) = self.opening();
        match &self.heading {
            Some(h) => format!("{}#{h}", route_for(&doc)),
            None => route_for(&doc),
        }
    }
}

/// Where in argv a `leaf://` link is, if anywhere.
pub fn link_in_argv(argv: &[String]) -> Option<usize> {
    argv.iter().position(|a| a.starts_with("leaf:"))
}

/// Where `bin/install` puts the app on macOS (`LEAF_APP` overrides).
pub fn installed_app() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("LEAF_APP") {
        return Some(PathBuf::from(p));
    }
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join("Applications/leaf reader.app"))
}

/// The installed app's binary.
pub fn installed_app_exe() -> Option<PathBuf> {
    installed_app().map(|a| a.join("Contents/MacOS/leaf"))
}

/// Whether this process is an app bundle's binary (macOS started it from the bundle).
pub fn running_from_app_bundle() -> bool {
    std::env::current_exe().is_ok_and(|p| is_bundle_exe(&p))
}

fn is_bundle_exe(p: &Path) -> bool {
    p.to_string_lossy().contains(".app/Contents/MacOS/")
}

/// Kinds of link that never leave the window, whatever the settings say: they run code
/// or reach into the machine rather than open another app.
const NEVER_OPEN: &[&str] = &["javascript", "file", "data", "blob", "vbscript", "about"];

/// Whether the app window hands `url` to the system: its scheme is in `allowed` (the
/// person's settings) and isn't one that never opens, and something follows the scheme.
pub fn link_allowed(url: &str, allowed: &[String]) -> bool {
    let url = url.trim_start();
    let Some((scheme, rest)) = url.split_once(':') else {
        return false;
    };
    let scheme = scheme.to_ascii_lowercase();
    let valid = !scheme.is_empty()
        && scheme.starts_with(|c: char| c.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    let body = rest.trim_start_matches('/');
    valid
        && !body.is_empty()
        && !NEVER_OPEN.contains(&scheme.as_str())
        && allowed.iter().any(|a| a.eq_ignore_ascii_case(&scheme))
}

/// Whether a window, or any frame in it, may load `url`. Only the app's own pages
/// and frames it builds itself (a live pane's srcdoc, a file's blob) load; nothing
/// navigates out to the network, so a block in a document can't send a request by
/// pointing its frame somewhere. A dev build also loads its local dev server.
pub fn navigation_allowed(url: &str, dev: bool) -> bool {
    let Some((scheme, rest)) = url.split_once(':') else {
        return false;
    };
    let host = || {
        rest.strip_prefix("//")
            .map(|r| r.split(['/', '?', '#']).next().unwrap_or(""))
            .map(|h| h.rsplit_once(':').map_or(h, |(h, _)| h))
    };
    match scheme.to_ascii_lowercase().as_str() {
        "tauri" => host() == Some("localhost"),
        "about" | "blob" | "data" => true,
        "http" | "https" => match host() {
            Some("tauri.localhost") => true,
            Some("localhost" | "127.0.0.1") => dev,
            _ => false,
        },
        _ => false,
    }
}

/// The route a deck's speaker window opens on: the deck's own, flagged for the speaker view.
pub fn speaker_route(path: &str) -> String {
    format!("{}?speaker", route_for(path))
}

/// Where a deck's speaker window opens: on the same folder as the window showing the
/// deck (`opened`, a folder or a file in it), at the deck's path flagged for the speaker.
/// Only a file inside that folder.
pub fn speaker_target(opened: &Path, path: &str) -> Result<(PathBuf, String), String> {
    if path.is_empty()
        || Path::new(path)
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err(format!("not a path inside the folder: {path}"));
    }
    let folder = if opened.is_dir() {
        opened.to_path_buf()
    } else {
        opened.parent().map(Path::to_path_buf).unwrap_or_default()
    };
    if !folder.join(path).is_file() {
        return Err(format!("no such file: {path}"));
    }
    Ok((folder, speaker_route(path)))
}

#[cfg(test)]
mod speaker_tests {
    use super::{route_for, speaker_route};

    use super::speaker_target;
    use std::path::Path;

    #[test]
    fn the_speaker_window_opens_on_the_same_folder_as_its_deck() {
        let root = std::env::temp_dir().join("leaf-speaker-target");
        std::fs::create_dir_all(root.join("slides")).unwrap();
        std::fs::write(root.join("slides/launch.marp"), "# a").unwrap();
        // A window on the folder, showing a deck in a subfolder.
        let (open, route) = speaker_target(&root, "slides/launch.marp").unwrap();
        assert_eq!(open, root);
        assert_eq!(route, speaker_route("slides/launch.marp"));
        // A window opened on the deck file itself: its folder.
        let (open, _) = speaker_target(&root.join("slides/launch.marp"), "launch.marp").unwrap();
        assert_eq!(open, root.join("slides"));
        assert!(speaker_target(&root, "../etc/passwd").is_err());
        assert!(speaker_target(&root, "slides/missing.marp").is_err());
        assert!(speaker_target(Path::new("/"), "/etc/passwd").is_err());
    }

    #[test]
    fn the_speaker_window_opens_on_the_deck_flagged_for_the_speaker() {
        assert_eq!(
            speaker_route("talks/q3 plan.md"),
            format!("{}?speaker", route_for("talks/q3 plan.md"))
        );
        assert!(speaker_route("a.md").ends_with("/a.md?speaker"));
    }
}

#[cfg(test)]
mod navigation_tests {
    use super::navigation_allowed;

    #[test]
    fn the_app_and_its_own_frames_load() {
        for url in [
            "tauri://localhost/index.html",
            "http://tauri.localhost/index.html",
            "https://tauri.localhost/",
            "about:srcdoc",
            "about:blank",
            "blob:tauri://localhost/2b1c",
            "data:text/html,hi",
        ] {
            assert!(navigation_allowed(url, false), "{url}");
        }
    }

    #[test]
    fn nothing_navigates_out_to_the_network() {
        for url in [
            "https://example.com/?beacon",
            "http://example.com/",
            "https://tauri.localhost.evil.com/",
            "http://127.0.0.1:8080/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "nonsense",
        ] {
            assert!(!navigation_allowed(url, false), "{url}");
        }
    }

    #[test]
    fn a_dev_build_also_loads_its_local_dev_server() {
        assert!(navigation_allowed("http://localhost:5173/", true));
        assert!(navigation_allowed("http://127.0.0.1:5173/", true));
        assert!(!navigation_allowed("https://example.com/", true));
    }
}

#[cfg(test)]
mod external_url_tests {
    use super::link_allowed;

    #[test]
    fn links_open_when_their_kind_is_allowed() {
        let allowed: Vec<String> = ["https", "mailto", "vscode", "cursor"]
            .map(String::from)
            .to_vec();
        assert!(link_allowed("https://github.com/rob/leaf", &allowed));
        assert!(link_allowed("vscode://file/Users/rob/a.rs:12", &allowed));
        assert!(link_allowed("CURSOR://file/x", &allowed));
        assert!(!link_allowed("zed://file/x", &allowed), "not in the list");
        assert!(
            !link_allowed("http://example.com", &allowed),
            "http is a separate kind"
        );
        assert!(
            !link_allowed("vscode:", &allowed),
            "nothing after the scheme"
        );
        assert!(!link_allowed("relative/path.md", &allowed));
    }

    #[test]
    fn some_kinds_never_open_whatever_the_list_says() {
        let all: Vec<String> = ["javascript", "file", "data", "blob", "vbscript", "about"]
            .map(String::from)
            .to_vec();
        for url in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,x",
            "blob:x",
            "vbscript:x",
            "about:blank",
        ] {
            assert!(!link_allowed(url, &all), "{url}");
        }
    }
}

#[cfg(test)]
mod deep_link_tests {
    use super::*;

    #[test]
    fn a_path_after_open_is_absolute() {
        let l = parse_deep_link("leaf://open/Users/rob/notes/plan.md").unwrap();
        assert_eq!(l.target, PathBuf::from("/Users/rob/notes/plan.md"));
        assert_eq!(l.root, None);
        assert_eq!(l.heading, None);
        assert!(!l.browser);
    }

    #[test]
    fn heading_root_and_browser() {
        let l = parse_deep_link(
            "leaf://open/Users/rob/code/leaf/docs/My%20Guide.md?root=/Users/rob/code/leaf&browser#set-up",
        )
        .unwrap();
        assert_eq!(
            l.target,
            PathBuf::from("/Users/rob/code/leaf/docs/My Guide.md")
        );
        assert_eq!(l.root, Some(PathBuf::from("/Users/rob/code/leaf")));
        assert_eq!(l.heading.as_deref(), Some("set-up"));
        assert!(l.browser);
    }

    #[test]
    fn path_can_be_a_query_parameter() {
        let l = parse_deep_link("leaf://open?path=%2FUsers%2Frob%2Fa%20b.md").unwrap();
        assert_eq!(l.target, PathBuf::from("/Users/rob/a b.md"));
        // A triple slash (an empty host) reads the same.
        let l = parse_deep_link("leaf:///open/Users/rob/a.md").unwrap();
        assert_eq!(l.target, PathBuf::from("/Users/rob/a.md"));
    }

    #[test]
    fn a_home_relative_path() {
        let l = parse_deep_link("leaf://open/~/notes/a.md").unwrap();
        assert_eq!(
            l.target,
            PathBuf::from(std::env::var("HOME").unwrap()).join("notes/a.md")
        );
    }

    #[test]
    fn what_is_not_a_link_says_why() {
        assert!(parse_deep_link("https://open/x").is_err());
        assert!(
            parse_deep_link("leaf://share/x")
                .unwrap_err()
                .contains("open")
        );
        assert!(parse_deep_link("leaf://open").unwrap_err().contains("path"));
        assert!(
            parse_deep_link("leaf://open?path=relative.md")
                .unwrap_err()
                .contains("absolute")
        );
        assert!(
            parse_deep_link("leaf://open/a/../../etc").is_ok(),
            "resolved on open, like a typed path"
        );
    }

    #[test]
    fn the_window_shows_the_root_with_the_file_inside() {
        let l = parse_deep_link("leaf://open/r/docs/a.md?root=/r#h").unwrap();
        assert_eq!(l.opening(), (PathBuf::from("/r"), "docs/a.md".to_string()));
        // No root: a file opens on its own (routed by its name), a folder on itself.
        let l = parse_deep_link("leaf://open/r/docs/a.md").unwrap();
        assert_eq!(
            l.opening(),
            (PathBuf::from("/r/docs/a.md"), "a.md".to_string())
        );
        let l = parse_deep_link("leaf://open/r/docs/").unwrap();
        assert_eq!(l.opening(), (PathBuf::from("/r/docs"), String::new()));
        // A root that doesn't hold the file is ignored.
        let l = parse_deep_link("leaf://open/r/docs/a.md?root=/other").unwrap();
        assert_eq!(
            l.opening(),
            (PathBuf::from("/r/docs/a.md"), "a.md".to_string())
        );
    }

    #[test]
    fn a_bundle_binary_is_recognized() {
        assert!(is_bundle_exe(Path::new(
            "/Users/r/Applications/leaf reader.app/Contents/MacOS/leaf"
        )));
        assert!(!is_bundle_exe(Path::new(
            "/Users/r/code/leaf/target/release/leaf"
        )));
    }

    #[test]
    fn the_route_carries_document_and_heading() {
        let l = parse_deep_link("leaf://open/r/docs/my%20a.md?root=/r#set-up").unwrap();
        assert_eq!(l.route(), "/docs/my%20a.md#set-up");
    }

    #[test]
    fn links_are_found_in_argv() {
        let argv: Vec<String> = ["open", "-l", "debug", "leaf://open/x.md"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(link_in_argv(&argv), Some(3));
        assert_eq!(link_in_argv(&["open".into(), ".".into()]), None);
    }
}

/// Held while the app starts, until it can take launches handed to it: a second app
/// started in the same moment waits here, then finds the first and hands over.
pub struct StartupLock(#[allow(dead_code)] std::fs::File);

/// Takes the startup lock at `path` (made if missing), waiting while another app holds it.
pub fn startup_lock(path: &Path) -> std::io::Result<StartupLock> {
    use std::os::fd::AsRawFd;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path)?;
    // flock belongs to this open file, so it also orders threads of one process; the
    // kernel drops it when the file closes, even if the app dies while starting.
    loop {
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } == 0 {
            return Ok(StartupLock(file));
        }
        let e = std::io::Error::last_os_error();
        if e.kind() != std::io::ErrorKind::Interrupted {
            return Err(e);
        }
    }
}

#[cfg(test)]
mod startup_lock_tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn startup_lock_serializes_launches() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("startup.lock");
        let order = Arc::new(Mutex::new(Vec::new()));
        let (p, o) = (path.clone(), order.clone());
        let a = std::thread::spawn(move || {
            let held = startup_lock(&p).unwrap();
            std::thread::sleep(Duration::from_millis(200));
            o.lock().unwrap().push("a-done");
            drop(held);
        });
        std::thread::sleep(Duration::from_millis(20));
        let (p, o) = (path.clone(), order.clone());
        let b = std::thread::spawn(move || {
            let _held = startup_lock(&p).unwrap();
            o.lock().unwrap().push("b");
        });
        a.join().unwrap();
        b.join().unwrap();
        assert_eq!(*order.lock().unwrap(), vec!["a-done", "b"]);
    }
}
