//! Sharing a tab: the title row's Share button and the app's own menu under it, and the
//! bookkeeping that keeps a tab's `ShareHandle` while it lives. A closed tab's share is
//! released, not ended: the relay keeps it for its grace period and `RecentShares`
//! remembers how to take it back.
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Webview, Wry};

use crate::app::AppState;
use crate::tabbed;
use leaf_app::sharing::{self, HostOptions, LinkStatus, ShareHandle, StartError};
use leaf_protocol::relay::{Peer, Resume};
use leaf_protocol::{ClientMessage, ShareMode, Slide, StageRef};

/// What the title row shows of a tab's share.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TabShare {
    pub id: String,
    pub web_url: String,
    pub app_url: String,
    /// `idle` (not sharing), `live`, `reconnecting` or `ended`.
    pub status: String,
    pub viewers: Vec<Peer>,
    /// An id this tab's root could take back (its tab closed while it was live).
    pub resumable: Option<String>,
    /// Viewers see git history (last commits, blame). Off unless the host includes it.
    pub git: bool,
}

fn status_name(s: LinkStatus) -> &'static str {
    match s {
        LinkStatus::Connected => "live",
        LinkStatus::Reconnecting => "reconnecting",
        LinkStatus::Ended => "ended",
    }
}

fn snapshot(h: &ShareHandle) -> TabShare {
    TabShare {
        id: h.id.clone(),
        web_url: h.web_url.clone(),
        app_url: h.app_url.clone(),
        status: status_name(*h.status.borrow()).to_string(),
        viewers: h.viewers.borrow().clone(),
        resumable: None,
        git: h.git(),
    }
}

fn idle(resumable: Option<String>) -> TabShare {
    TabShare {
        id: String::new(),
        web_url: String::new(),
        app_url: String::new(),
        status: "idle".into(),
        viewers: Vec::new(),
        resumable,
        git: false,
    }
}

/// Tells the chrome of `tab`'s window about its share, as it starts, changes and ends.
fn announce(app: &AppHandle, tab: &str, share: &TabShare) {
    let state = app.state::<AppState>();
    let window = state.tabs.lock().unwrap().window_of(tab);
    let Some(window) = window else { return };
    let _ = app.emit_to(
        EventTarget::AnyLabel {
            label: tabbed::chrome_label(&window),
        },
        &format!("leaf://share/{window}"),
        serde_json::json!({ "tab": tab, "share": share }),
    );
}

/// One line of the Share menu.
#[derive(Debug, PartialEq)]
pub enum MenuEntry {
    Item {
        id: String,
        text: String,
        enabled: bool,
        /// A line with a check mark, and whether it is on.
        checked: Option<bool>,
    },
    Separator,
}

/// What a Share menu line does.
#[derive(Debug, PartialEq, Clone, Copy)]
pub enum ShareAction {
    CopyApp,
    CopyWeb,
    OpenWeb,
    ToggleGit,
    End,
    Resume,
    Start,
}

const COPY_APP: &str = "share:copy-app";
const COPY_WEB: &str = "share:copy-web";
const OPEN_WEB: &str = "share:open-web";
const GIT: &str = "share:git";
const END: &str = "share:end";
const RESUME: &str = "share:resume";
const START: &str = "share:start";

/// The Share menu for a tab's share: its links, the end, and who is watching while it
/// is live; resume or a fresh share after a tab closed on one; nothing while idle (the
/// button starts a share straight away).
pub fn menu_items(share: &TabShare) -> Vec<MenuEntry> {
    let item = |id: &str, text: &str| MenuEntry::Item {
        id: id.into(),
        text: text.into(),
        enabled: true,
        checked: None,
    };
    match share.status.as_str() {
        "live" | "reconnecting" => {
            let mut items = vec![
                item(COPY_APP, "Copy app link"),
                item(COPY_WEB, "Copy web link"),
                item(OPEN_WEB, "Open web link"),
                MenuEntry::Separator,
                MenuEntry::Item {
                    id: GIT.into(),
                    text: "Include git history".into(),
                    enabled: true,
                    checked: Some(share.git),
                },
                MenuEntry::Separator,
                item(END, "End session"),
            ];
            if !share.viewers.is_empty() {
                items.push(MenuEntry::Separator);
                items.extend(share.viewers.iter().map(|v| MenuEntry::Item {
                    id: format!("share:viewer:{}", v.id),
                    text: v.name.clone(),
                    enabled: false,
                    checked: None,
                }));
            }
            items
        }
        _ if share.resumable.is_some() => {
            vec![
                item(RESUME, "Resume sharing"),
                item(START, "Share this tab"),
            ]
        }
        _ => Vec::new(),
    }
}

/// The action a Share menu line's id names; None for a viewer's line or another menu's.
pub fn menu_action(id: &str) -> Option<ShareAction> {
    Some(match id {
        COPY_APP => ShareAction::CopyApp,
        COPY_WEB => ShareAction::CopyWeb,
        OPEN_WEB => ShareAction::OpenWeb,
        GIT => ShareAction::ToggleGit,
        END => ShareAction::End,
        RESUME => ShareAction::Resume,
        START => ShareAction::Start,
        _ => return None,
    })
}

/// The tab's tab closed: let go of its share without ending it, and remember it.
pub fn release(app: &AppHandle, tab: &str) {
    let state = app.state::<AppState>();
    state.presentation.lock().unwrap().remove(tab);
    let handle = state.shares.lock().unwrap().remove(tab);
    let (Some(h), Some(root)) = (handle, state.windows.opened(tab)) else {
        return;
    };
    if *h.status.borrow() != LinkStatus::Ended {
        state.recent.lock().unwrap().remember(
            root,
            h.id.clone(),
            h.host_key.clone(),
            Instant::now(),
        );
    }
}

/// Tells the title row about `tab`'s share as its viewers or link change, until it goes.
fn watch_share(app: &AppHandle, tab: &str, h: &ShareHandle) {
    let runtime = app.state::<AppState>().runtime.clone();
    let (app, tab, id) = (app.clone(), tab.to_string(), h.id.clone());
    let (mut viewers, mut status) = (h.viewers.clone(), h.status.clone());
    runtime.spawn(async move {
        loop {
            let alive = tokio::select! {
                r = viewers.changed() => r.is_ok(),
                r = status.changed() => r.is_ok(),
            };
            let now = {
                let state = app.state::<AppState>();
                let mut shares = state.shares.lock().unwrap();
                let mine = shares.get(&tab).filter(|h| h.id == id).map(snapshot);
                // The relay ended it: the tab stops being shared.
                if mine.as_ref().is_some_and(|s| s.status == "ended") {
                    shares.remove(&tab);
                    Some((mine.unwrap(), true))
                } else {
                    mine.map(|s| (s, false))
                }
            };
            match now {
                Some((s, over)) => {
                    announce(&app, &tab, &s);
                    if over {
                        tabbed::changed(&app);
                        break;
                    }
                }
                None => break,
            }
            if !alive {
                break;
            }
        }
    });
}

async fn start_tab(
    app: &AppHandle,
    tab: &str,
    resume: Option<Resume>,
) -> Result<TabShare, StartError> {
    let soft = |m: &str| StartError {
        message: m.to_string(),
        permanent: false,
    };
    let state = app.state::<AppState>();
    {
        let mut shares = state.shares.lock().unwrap();
        match shares.get(tab) {
            Some(h) if *h.status.borrow() != LinkStatus::Ended => return Ok(snapshot(h)),
            // Ended by the relay and not yet cleared: a new share replaces it.
            Some(_) => {
                shares.remove(tab);
            }
            None => {}
        }
    }
    let relay_url = state
        .windows
        .relay_url()
        .ok_or_else(|| soft("no relay set"))?;
    let engine = state
        .windows
        .engine_of(tab)
        .ok_or_else(|| soft("no such tab"))?;
    let root = state
        .windows
        .root_info(tab)
        .ok_or_else(|| soft("no such tab"))?;
    let handle = sharing::start_checked(HostOptions {
        relay_url,
        name: state.name.clone(),
        root,
        mode: ShareMode::ReadOnly,
        engine,
        resume,
    })
    .await?;
    let path = state
        .tab_state
        .lock()
        .unwrap()
        .get(tab)
        .and_then(|s| s.get("path"))
        .and_then(|p| p.as_str())
        .map(str::to_string);
    if path.is_some() {
        handle.set_path(path);
    }
    let share = {
        let mut shares = state.shares.lock().unwrap();
        if let Some(existing) = shares.get(tab) {
            // Two starts raced: keep the first.
            handle.end();
            return Ok(snapshot(existing));
        }
        let share = snapshot(&handle);
        watch_share(app, tab, &handle);
        forward_inbox(app, tab, &handle);
        shares.insert(tab.to_string(), handle);
        share
    };
    // Announce what the tab already has open (taking `presentation` with `shares` released).
    let known = state.presentation.lock().unwrap().get(tab).cloned();
    if let Some(p) = known.filter(|p| p.slide.is_some() || p.stage.is_some())
        && let Some(h) = state.shares.lock().unwrap().get(tab)
    {
        h.set_slide(p.slide);
        h.set_stage(p.stage);
    }
    tabbed::changed(app);
    Ok(share)
}

/// Whether the host's own tab sends `msg` to its share (its slide, canvas, pointer and
/// ink) rather than to the engine.
pub fn host_bound(msg: &ClientMessage) -> bool {
    matches!(
        msg,
        ClientMessage::Slide { .. }
            | ClientMessage::Stage { .. }
            | ClientMessage::Pointer { .. }
            | ClientMessage::Ink { .. }
            | ClientMessage::Inking { .. }
            | ClientMessage::InkUndo { .. }
            | ClientMessage::InkClear { .. }
    )
}

/// The slide and canvas a tab has open, remembered whether or not it is shared so a
/// share that starts later can announce them at once.
#[derive(Default, Debug, Clone, PartialEq)]
pub struct Presentation {
    pub slide: Option<Slide>,
    pub stage: Option<StageRef>,
}

/// Updates `p` from a `Slide` or `Stage` message (`None` clears); returns whether
/// anything changed. Other messages leave it alone.
pub fn remember(p: &mut Presentation, msg: &ClientMessage) -> bool {
    match msg {
        ClientMessage::Slide { slide } if *slide != p.slide => {
            p.slide = slide.clone();
            true
        }
        ClientMessage::Stage { stage } if *stage != p.stage => {
            p.stage = stage.clone();
            true
        }
        _ => false,
    }
}

/// Hands a host-bound `msg` from `tab` to its share; a tab that isn't shared only has
/// its slide and canvas remembered.
pub fn from_host_tab(app: &AppHandle, tab: &str, msg: ClientMessage) {
    let state = app.state::<AppState>();
    remember(
        state
            .presentation
            .lock()
            .unwrap()
            .entry(tab.to_string())
            .or_default(),
        &msg,
    );
    let shares = state.shares.lock().unwrap();
    let Some(handle) = shares.get(tab) else {
        return;
    };
    match msg {
        ClientMessage::Slide { slide } => handle.set_slide(slide),
        ClientMessage::Stage { stage } => handle.set_stage(stage),
        ClientMessage::Pointer { pointer } => handle.pointer(pointer),
        ClientMessage::Ink { stroke } => handle.ink(stroke),
        ClientMessage::Inking { stroke } => handle.inking(stroke),
        ClientMessage::InkUndo {
            doc_path,
            block_hash,
        } => handle.ink_undo(doc_path, block_hash),
        ClientMessage::InkClear {
            doc_path,
            block_hash,
        } => handle.ink_clear(doc_path, block_hash),
        // `host_bound` lets nothing else through.
        _ => {}
    }
}

/// Pushes what the share tells the host's tab (where viewers are, their pointers and
/// ink) to the tab until the share ends.
fn forward_inbox(app: &AppHandle, tab: &str, handle: &ShareHandle) {
    let Some(mut inbox) = handle.take_inbox() else {
        return;
    };
    let runtime = app.state::<AppState>().runtime.clone();
    let (app, tab) = (app.clone(), tab.to_string());
    runtime.spawn(async move {
        while let Some(msg) = inbox.recv().await {
            crate::app::emit(&app, &tab, msg);
        }
    });
}

/// `tab`'s share; `idle` when it isn't sharing, with `resumable` naming a share its
/// root left when a tab closed (the menu offers to resume it).
fn share_of(app: &AppHandle, tab: &str) -> TabShare {
    let state = app.state::<AppState>();
    if let Some(h) = state.shares.lock().unwrap().get(tab) {
        return snapshot(h);
    }
    let resumable = state.windows.opened(tab).and_then(|root| {
        let recent = state.recent.lock().unwrap();
        recent.peek(&root, Instant::now()).map(|r| r.id.clone())
    });
    idle(resumable)
}

/// `window`'s active tab and its share.
fn active_share_of(app: &AppHandle, window: &str) -> Option<(String, TabShare)> {
    let tab = tabbed::active_tab(app, window)?;
    let share = share_of(app, &tab);
    Some((tab, share))
}

async fn resume_tab(app: &AppHandle, tab: &str) -> Result<TabShare, String> {
    let state = app.state::<AppState>();
    let root = state.windows.opened(tab).ok_or("no such tab")?;
    let recent = state
        .recent
        .lock()
        .unwrap()
        .take(&root, Instant::now())
        .ok_or("nothing to resume")?;
    let resume = Resume {
        id: recent.id.clone(),
        host_key: recent.host_key.clone(),
    };
    // A failure the relay can't recover from drops the entry; a transient one puts it
    // back with its original deadline, so it never outlives the relay's grace period.
    match start_tab(app, tab, Some(resume)).await {
        Ok(share) => Ok(share),
        Err(e) => {
            if !e.permanent {
                state
                    .recent
                    .lock()
                    .unwrap()
                    .put_back(recent, Instant::now());
            }
            Err(e.message)
        }
    }
}

/// Starts (or resumes) `tab`'s share in the background. The title row hears the outcome
/// through the share event; a failure is told in a dialog.
fn begin(app: &AppHandle, tab: &str, resume: bool) {
    let (app, tab) = (app.clone(), tab.to_string());
    let runtime = app.state::<AppState>().runtime.clone();
    runtime.spawn(async move {
        let result = if resume {
            resume_tab(&app, &tab).await
        } else {
            start_tab(&app, &tab, None).await.map_err(|e| e.message)
        };
        match result {
            Ok(share) => announce(&app, &tab, &share),
            Err(message) => {
                use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                app.dialog()
                    .message(message)
                    .title("Sharing")
                    .kind(MessageDialogKind::Error)
                    .show(|_| {});
            }
        }
    });
}

fn end_tab(app: &AppHandle, tab: &str) {
    let state = app.state::<AppState>();
    let removed = state.shares.lock().unwrap().remove(tab);
    let Some(h) = removed else { return };
    h.end();
    let mut ended = snapshot(&h);
    ended.status = "ended".into();
    announce(app, tab, &ended);
    tabbed::changed(app);
}

/// Puts a link on the clipboard and tells `window`'s title row, which shows a check.
fn copy(app: &AppHandle, window: &str, text: &str) {
    let state = app.state::<AppState>();
    let ok = {
        let mut clipboard = state.clipboard.lock().unwrap();
        if clipboard.is_none() {
            *clipboard = arboard::Clipboard::new().ok();
        }
        clipboard.as_mut().is_some_and(|c| c.set_text(text).is_ok())
    };
    if ok {
        let _ = app.emit_to(
            EventTarget::AnyLabel {
                label: tabbed::chrome_label(window),
            },
            &format!("leaf://share-copied/{window}"),
            (),
        );
    }
}

/// The active tab's share, for the title row; None when this leaf has no relay to share
/// through, so the row shows no Share button.
#[tauri::command]
pub fn leaf_active_share(webview: Webview<Wry>) -> Option<TabShare> {
    let app = webview.app_handle();
    app.state::<AppState>().windows.relay_url()?;
    let share = active_share_of(app, webview.window().label()).map(|(_, s)| s);
    Some(share.unwrap_or_else(|| idle(None)))
}

/// The title row's Share button. Idle, it starts sharing the active tab; otherwise the
/// app's own menu at the pointer (a dropdown would be cut off by the title row's height).
#[tauri::command]
pub fn leaf_share_button(webview: Webview<Wry>) {
    use tauri::menu::{CheckMenuItem, MenuBuilder, MenuItem};
    let app = webview.app_handle();
    let window = webview.window();
    let Some((tab, share)) = active_share_of(app, window.label()) else {
        return;
    };
    let entries = menu_items(&share);
    if entries.is_empty() {
        begin(app, &tab, false);
        return;
    }
    let mut menu = MenuBuilder::new(app);
    for entry in entries {
        menu = match entry {
            MenuEntry::Separator => menu.separator(),
            MenuEntry::Item {
                id,
                text,
                enabled,
                checked: Some(on),
            } => match CheckMenuItem::with_id(app, id, text, enabled, on, None::<&str>) {
                Ok(item) => menu.item(&item),
                Err(_) => return,
            },
            MenuEntry::Item {
                id,
                text,
                enabled,
                checked: None,
            } => match MenuItem::with_id(app, id, text, enabled, None::<&str>) {
                Ok(item) => menu.item(&item),
                Err(_) => return,
            },
        };
    }
    if let Ok(menu) = menu.build() {
        let _ = window.popup_menu(&menu);
    }
}

/// Runs a Share menu line for the front window's active tab; false when `id` isn't one.
pub fn on_menu(app: &AppHandle, id: &str) -> bool {
    let Some(action) = menu_action(id) else {
        return false;
    };
    let Some(window) = tabbed::front_window(app) else {
        return true;
    };
    let window = window.label().to_string();
    let Some((tab, share)) = active_share_of(app, &window) else {
        return true;
    };
    match action {
        ShareAction::CopyApp => copy(app, &window, &share.app_url),
        ShareAction::CopyWeb => copy(app, &window, &share.web_url),
        ShareAction::OpenWeb => {
            if !share.web_url.is_empty() {
                let _ = open::that_detached(&share.web_url);
            }
        }
        ShareAction::ToggleGit => {
            let state = app.state::<AppState>();
            if let Some(h) = state.shares.lock().unwrap().get(&tab) {
                h.set_git(!h.git());
            }
        }
        ShareAction::End => end_tab(app, &tab),
        ShareAction::Resume => begin(app, &tab, true),
        ShareAction::Start => begin(app, &tab, false),
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tabs_slide_and_canvas_are_remembered_from_its_messages() {
        let msg = |raw: &str| serde_json::from_str::<ClientMessage>(raw).unwrap();
        let mut p = Presentation::default();
        let slide = msg(r#"{"type":"slide","slide":{"path":"a.md","index":2}}"#);
        assert!(remember(&mut p, &slide));
        assert_eq!(p.slide.as_ref().map(|s| s.index), Some(2));
        assert!(!remember(&mut p, &slide), "the same slide is no change");

        let stage = msg(r#"{"type":"stage","stage":{"docPath":"a.md","blockHash":"h"}}"#);
        assert!(remember(&mut p, &stage));
        assert!(p.stage.is_some());

        assert!(!remember(&mut p, &msg(r#"{"type":"pointer"}"#)));
        assert!(p.slide.is_some() && p.stage.is_some());

        assert!(remember(&mut p, &msg(r#"{"type":"stage"}"#)));
        assert!(p.stage.is_none() && p.slide.is_some());
    }

    #[test]
    fn only_the_hosts_presentation_messages_go_to_its_share() {
        let yes = [
            r#"{"type":"slide"}"#,
            r#"{"type":"stage"}"#,
            r#"{"type":"pointer"}"#,
            r#"{"type":"ink","stroke":{"id":"host:1","docPath":"a.mmd","blockHash":"h","points":[[0.0,0.0],[10.5,4.0]],"color":"red","width":4.0,"sticky":true,"createdAt":1.0}}"#,
            r#"{"type":"inkUndo","docPath":"a","blockHash":"h"}"#,
            r#"{"type":"inkClear","docPath":"a","blockHash":"h"}"#,
        ];
        let no = [
            r#"{"type":"at","path":"a.md"}"#,
            r#"{"type":"read","path":"a.md"}"#,
            r#"{"type":"hello","protocol":1}"#,
        ];
        for raw in yes {
            assert!(host_bound(&serde_json::from_str(raw).unwrap()), "{raw}");
        }
        for raw in no {
            assert!(!host_bound(&serde_json::from_str(raw).unwrap()), "{raw}");
        }
    }

    #[test]
    fn a_tab_share_speaks_camel_case() {
        let json = serde_json::to_value(idle(Some("abc".into()))).unwrap();
        assert_eq!(json["webUrl"], "");
        assert_eq!(json["appUrl"], "");
        assert_eq!(json["resumable"], "abc");
        assert_eq!(json["status"], "idle");
    }

    fn live(viewers: &[&str]) -> TabShare {
        TabShare {
            id: "abc".into(),
            web_url: "https://relay.test/s/abc".into(),
            app_url: "leaf://join/abc".into(),
            status: "live".into(),
            viewers: viewers
                .iter()
                .map(|n| Peer {
                    id: format!("v-{n}"),
                    name: n.to_string(),
                    color: "#e5484d".into(),
                    path: None,
                })
                .collect(),
            resumable: None,
            git: false,
        }
    }

    /// The menu as a reader sees it: `—` a separator, `(off)` a line that can't be
    /// chosen, `[x]`/`[ ]` a line with a check mark.
    fn lines(share: &TabShare) -> Vec<String> {
        menu_items(share)
            .iter()
            .map(|e| match e {
                MenuEntry::Separator => "—".to_string(),
                MenuEntry::Item {
                    text,
                    checked: Some(on),
                    ..
                } => format!("[{}] {text}", if *on { "x" } else { " " }),
                MenuEntry::Item {
                    text,
                    enabled: true,
                    ..
                } => text.clone(),
                MenuEntry::Item {
                    text,
                    enabled: false,
                    ..
                } => format!("{text} (off)"),
            })
            .collect()
    }

    #[test]
    fn a_live_share_offers_its_links_the_end_then_who_is_watching() {
        assert_eq!(
            lines(&live(&["Ada", "Bob"])),
            [
                "Copy app link",
                "Copy web link",
                "Open web link",
                "—",
                "[ ] Include git history",
                "—",
                "End session",
                "—",
                "Ada (off)",
                "Bob (off)"
            ]
        );
    }

    #[test]
    fn the_git_line_shows_its_check_when_the_host_included_it() {
        let mut s = live(&[]);
        s.git = true;
        assert!(lines(&s).contains(&"[x] Include git history".to_string()));
    }

    #[test]
    fn a_reconnecting_share_keeps_its_menu_without_a_watching_section() {
        let mut s = live(&[]);
        s.status = "reconnecting".into();
        assert_eq!(
            lines(&s),
            [
                "Copy app link",
                "Copy web link",
                "Open web link",
                "—",
                "[ ] Include git history",
                "—",
                "End session"
            ]
        );
    }

    #[test]
    fn a_resumable_share_offers_to_resume_or_start_afresh() {
        assert_eq!(
            lines(&idle(Some("abc".into()))),
            ["Resume sharing", "Share this tab"]
        );
    }

    #[test]
    fn an_idle_share_has_no_menu_so_the_button_starts_it() {
        assert!(lines(&idle(None)).is_empty());
    }

    #[test]
    fn menu_ids_name_share_actions_and_nothing_else() {
        let ids: Vec<String> = menu_items(&live(&["Ada"]))
            .into_iter()
            .chain(menu_items(&idle(Some("abc".into()))))
            .filter_map(|e| match e {
                MenuEntry::Item { id, .. } => Some(id),
                MenuEntry::Separator => None,
            })
            .collect();
        let actions: Vec<Option<ShareAction>> = ids.iter().map(|id| menu_action(id)).collect();
        assert_eq!(
            actions,
            [
                Some(ShareAction::CopyApp),
                Some(ShareAction::CopyWeb),
                Some(ShareAction::OpenWeb),
                Some(ShareAction::ToggleGit),
                Some(ShareAction::End),
                None, // a viewer's line
                Some(ShareAction::Resume),
                Some(ShareAction::Start),
            ]
        );
        assert_eq!(menu_action("cmd:openSettings"), None);
        assert_eq!(menu_action("appearance:dark"), None);
    }
}
