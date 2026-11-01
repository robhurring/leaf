//! Sharing a tab: the commands the page sends, and the bookkeeping that keeps a tab's
//! `ShareHandle` while it lives. A closed tab's share is released, not ended: the relay
//! keeps it for its grace period and `RecentShares` remembers how to take it back.
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Webview, Wry};

use crate::app::AppState;
use crate::tabbed;
use leaf_app::sharing::{self, HostOptions, LinkStatus, ShareHandle, StartError};
use leaf_protocol::ShareMode;
use leaf_protocol::relay::{Peer, Resume};

/// What the page shows of a tab's share.
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

fn idle(resumable: Option<String>) -> TabShare {
    TabShare {
        id: String::new(),
        web_url: String::new(),
        app_url: String::new(),
        status: "idle".into(),
        viewers: Vec::new(),
        resumable,
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
        shares.insert(tab.to_string(), handle);
        share
    };
    tabbed::changed(app);
    Ok(share)
}

/// The tab's share; `idle` when it isn't sharing, with `resumable` naming a share its
/// root left when a tab closed (the page offers to resume it).
#[tauri::command]
pub fn leaf_share_state(webview: Webview<Wry>) -> TabShare {
    let tab = webview.label();
    let state = webview.app_handle().state::<AppState>();
    if let Some(h) = state.shares.lock().unwrap().get(tab) {
        return snapshot(h);
    }
    let resumable = state.windows.opened(tab).and_then(|root| {
        let recent = state.recent.lock().unwrap();
        recent.peek(&root, Instant::now()).map(|r| r.id.clone())
    });
    idle(resumable)
}

#[tauri::command]
pub async fn leaf_share_start(webview: Webview<Wry>) -> Result<TabShare, String> {
    start_tab(webview.app_handle(), webview.label(), None)
        .await
        .map_err(|e| e.message)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tab_share_speaks_camel_case() {
        let json = serde_json::to_value(idle(Some("abc".into()))).unwrap();
        assert_eq!(json["webUrl"], "");
        assert_eq!(json["appUrl"], "");
        assert_eq!(json["resumable"], "abc");
        assert_eq!(json["status"], "idle");
    }
}
