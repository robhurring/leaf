//! Sharing a tab: the commands the page sends, and the bookkeeping that keeps a tab's
//! `ShareHandle` while it lives. A closed tab's share is released, not ended: the relay
//! keeps it for its grace period and `RecentShares` remembers how to take it back.
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Webview, Wry};

use crate::app::AppState;
use crate::tabbed;
use leaf_app::sharing::{self, HostOptions, LinkStatus, ShareHandle};
use leaf_protocol::ShareMode;
use leaf_protocol::relay::{Peer, Resume};

/// What the page shows of a tab's share.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TabShare {
    pub id: String,
    pub web_url: String,
    pub app_url: String,
    /// `live`, `reconnecting` or `ended`.
    pub status: String,
    pub viewers: Vec<Peer>,
    /// An id this tab's root could take back (its tab closed while it was live).
    pub resumable: Option<String>,
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
    }
}

fn announce(app: &AppHandle, tab: &str, share: &TabShare) {
    let _ = app.emit_to(
        EventTarget::AnyLabel { label: tab.into() },
        &format!("leaf://share/{tab}"),
        share.clone(),
    );
}

/// The tab's tab closed: let go of its share without ending it, and remember it.
pub fn release(app: &AppHandle, tab: &str) {
    let state = app.state::<AppState>();
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

/// Tells the page about `tab`'s share as its viewers or link change, until it goes.
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
                let shares = state.shares.lock().unwrap();
                shares.get(&tab).filter(|h| h.id == id).map(snapshot)
            };
            match now {
                Some(s) => announce(&app, &tab, &s),
                None => break,
            }
            if !alive {
                break;
            }
        }
    });
}

async fn start_tab(app: &AppHandle, tab: &str, resume: Option<Resume>) -> Result<TabShare, String> {
    let state = app.state::<AppState>();
    if let Some(h) = state.shares.lock().unwrap().get(tab) {
        return Ok(snapshot(h));
    }
    let relay_url = state.windows.relay_url().ok_or("no relay set")?;
    let engine = state.windows.engine_of(tab).ok_or("no such tab")?;
    let root = state.windows.root_info(tab).ok_or("no such tab")?;
    let handle = sharing::start(HostOptions {
        relay_url,
        name: state.name.clone(),
        root,
        mode: ShareMode::ReadOnly,
        engine,
        resume,
    })
    .await?;
    let share = {
        let mut shares = state.shares.lock().unwrap();
        if let Some(existing) = shares.get(tab) {
            // Two starts raced: keep the first.
            handle.end();
            return Ok(snapshot(existing));
        }
        let share = snapshot(&handle);
        watch_share(app, tab, &handle);
        shares.insert(tab.to_string(), handle);
        share
    };
    tabbed::changed(app);
    Ok(share)
}

/// The tab's share. Not sharing: none, unless its root left a share when a tab closed,
/// which comes as an `ended` share carrying only `resumable` (the page offers to resume).
#[tauri::command]
pub fn leaf_share_state(webview: Webview<Wry>) -> Option<TabShare> {
    let tab = webview.label();
    let state = webview.app_handle().state::<AppState>();
    if let Some(h) = state.shares.lock().unwrap().get(tab) {
        return Some(snapshot(h));
    }
    let root = state.windows.opened(tab)?;
    let recent = state.recent.lock().unwrap();
    let r = recent.peek(&root, Instant::now())?;
    Some(TabShare {
        id: String::new(),
        web_url: String::new(),
        app_url: String::new(),
        status: "ended".into(),
        viewers: Vec::new(),
        resumable: Some(r.id.clone()),
    })
}

#[tauri::command]
pub async fn leaf_share_start(webview: Webview<Wry>) -> Result<TabShare, String> {
    start_tab(webview.app_handle(), webview.label(), None).await
}

#[tauri::command]
pub async fn leaf_share_resume(webview: Webview<Wry>) -> Result<TabShare, String> {
    let app = webview.app_handle();
    let tab = webview.label();
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
    let started = start_tab(app, tab, Some(resume)).await;
    if started.is_err() {
        // It may still be resumable later: put it back.
        state
            .recent
            .lock()
            .unwrap()
            .remember(root, recent.id, recent.host_key, Instant::now());
    }
    started
}

#[tauri::command]
pub fn leaf_share_end(webview: Webview<Wry>) {
    let app = webview.app_handle();
    let tab = webview.label();
    let state = app.state::<AppState>();
    let Some(h) = state.shares.lock().unwrap().remove(tab) else {
        return;
    };
    h.end();
    let mut ended = snapshot(&h);
    ended.status = "ended".into();
    announce(app, tab, &ended);
    tabbed::changed(app);
}
