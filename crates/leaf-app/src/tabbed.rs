//! Windows of tabs. Every app window is a plain window holding the chrome (a small
//! webview with the title row over the tab row) and one webview per tab, each a reader
//! with its own session in the core. `leaf_app::tabs` keeps which tabs each window
//! holds; this applies it to the webviews: which one shows, where they sit, and the
//! commands the chrome and the readers send.
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, Webview,
    WebviewBuilder, WebviewUrl, Window, Wry,
};

use crate::app::{AppState, READY_FALLBACK, geometry_of, screens};
use leaf_app::launch::route_for;
use leaf_app::tabs::{Workspace, label};
use leaf_app::window::Windows;
use leaf_app::window_state::Geometry;
use leaf_protocol::{OpenIn, Preferences};

/// The title row's height (the app's bar), and the tab row's under it.
pub const TITLE: f64 = 44.0;
pub const ROW: f64 = 32.0;
/// Where windows holding several tabs are remembered in the places file: one place for
/// "the last tabbed window", as Safari and Finder do.
pub const PLACE_KEY: &str = "/(leaf tabbed window)";

#[derive(Serialize)]
pub struct TabInfo {
    id: String,
    label: String,
    path: String,
    kind: &'static str,
    name: String,
    active: bool,
}

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn chrome_label(window: &str) -> String {
    format!("{window}-chrome")
}

/// The preferences as stored now. Read straight from the file: windows open from the
/// main thread, which can't wait on the async store.
fn prefs(app: &AppHandle) -> Preferences {
    let state = app.state::<AppState>();
    std::fs::read_to_string(state.prefs.path())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn logical_size(window: &Window<Wry>) -> (f64, f64) {
    let scale = window.scale_factor().unwrap_or(1.0);
    window
        .inner_size()
        .map(|s| s.to_logical::<f64>(scale))
        .map(|s| (s.width, s.height))
        .unwrap_or((1240.0, 860.0))
}

/// The chrome's height in `window`: the title row, plus the tab row when the window
/// has two or more tabs or a dragged tab is over it.
fn chrome_height(app: &AppHandle, window: &str) -> f64 {
    let state = app.state::<AppState>();
    let many = state.tabs.lock().unwrap().tabs_of(window).len() > 1;
    let hovered = state
        .hovered
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|(w, _)| w == window);
    if many || hovered { TITLE + ROW } else { TITLE }
}

/// Lays out the chrome and the tabs of `window` for its size and tab count.
pub fn relayout(app: &AppHandle, window: &Window<Wry>) {
    let (w, h) = logical_size(window);
    let top = chrome_height(app, window.label());
    if let Some(chrome) = app.get_webview(&chrome_label(window.label())) {
        let _ = chrome.set_size(LogicalSize::new(w, top));
    }
    let tabs = app
        .state::<AppState>()
        .tabs
        .lock()
        .unwrap()
        .tabs_of(window.label());
    for t in tabs {
        if let Some(v) = app.get_webview(&t) {
            let _ = v.set_position(LogicalPosition::new(0.0, top));
            let _ = v.set_size(LogicalSize::new(w, (h - top).max(0.0)));
        }
    }
}

/// Tells every chrome the tabs changed.
pub fn changed(app: &AppHandle) {
    let _ = app.emit("leaf://tabs", ());
}

/// Sends a reader command (`{name, arg}`) to one tab.
pub fn command_to(app: &AppHandle, tab: &str, payload: serde_json::Value) {
    let _ = app.emit_to(
        EventTarget::AnyLabel {
            label: tab.to_string(),
        },
        "leaf://command",
        payload,
    );
}

/// The active tab of `window`.
pub fn active_tab(app: &AppHandle, window: &str) -> Option<String> {
    app.state::<AppState>().tabs.lock().unwrap().active(window)
}

/// The window the person is in: the focused one, else the one focused last.
pub fn front_window(app: &AppHandle) -> Option<Window<Wry>> {
    let windows = app.windows();
    let state = app.state::<AppState>();
    let ours = state.tabs.lock().unwrap().windows();
    if let Some(w) = ours
        .iter()
        .filter_map(|l| windows.get(l))
        .find(|w| w.is_focused().unwrap_or(false))
    {
        return Some(w.clone());
    }
    let last = state.front.lock().unwrap().clone();
    last.and_then(|l| windows.get(&l).cloned())
        .or_else(|| ours.iter().find_map(|l| windows.get(l).cloned()))
}

/// Shows `target` (a file or folder): in the tab already covering it, else in a new
/// tab of the front window or a new window, as the person's setting says.
pub fn open(app: &AppHandle, target: &Path, route: Option<String>, heading: Option<String>) {
    let covering = app
        .state::<AppState>()
        .tabs
        .lock()
        .unwrap()
        .covering(target);
    if let Some(tab) = covering {
        return show_in(app, &tab, target, heading);
    }
    let window = match prefs(app).open_in_or_default() {
        OpenIn::Tab => front_window(app),
        OpenIn::Window => None,
    };
    let window = match window {
        Some(w) => Some(w),
        None => new_window(app, place_for(app, Some(target))),
    };
    if let Some(w) = window {
        add_tab(app, &w, target, None, route, None);
    }
}

/// Brings `tab` forward and moves it to `target` (and `heading`).
pub fn show_in(app: &AppHandle, tab: &str, target: &Path, heading: Option<String>) {
    let state = app.state::<AppState>();
    let (window, root) = {
        let tabs = state.tabs.lock().unwrap();
        let Some(w) = tabs.window_of(tab) else { return };
        let Some(root) = tabs.workspace(tab).and_then(|ws| ws.roots.first().cloned()) else {
            return;
        };
        (w, root)
    };
    select(app, tab);
    if let Some(w) = app.get_window(&window) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    // The document, relative to what the tab opened.
    let doc = if root.is_dir() {
        target
            .strip_prefix(&root)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default()
    } else {
        root.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    };
    if doc.is_empty() && heading.is_none() {
        return;
    }
    command_to(
        app,
        tab,
        serde_json::json!({ "name": "openPath", "arg": { "path": doc, "slug": heading } }),
    );
}

/// Where a new window goes: where `target`'s window last was, else the last tabbed
/// window's place, stepped aside from the windows already open.
pub fn place_for(app: &AppHandle, target: Option<&Path>) -> Option<Geometry> {
    let state = app.state::<AppState>();
    let open: Vec<Geometry> = app.windows().values().filter_map(geometry_of).collect();
    let places = state.places.lock().unwrap_or_else(|e| e.into_inner());
    let key = Path::new(PLACE_KEY);
    target
        .and_then(|t| places.place(t, &open, &screens(app)))
        .or_else(|| places.place(key, &open, &screens(app)))
}

/// A new window with its chrome and no tabs yet, hidden until its first tab has painted.
pub fn new_window(app: &AppHandle, place: Option<Geometry>) -> Option<Window<Wry>> {
    let state = app.state::<AppState>();
    let label = format!("w{}", state.next.fetch_add(1, Ordering::Relaxed));
    let mut b = tauri::window::WindowBuilder::new(app, &label)
        .title("leaf")
        .min_inner_size(640.0, 420.0)
        .visible(false);
    b = match place {
        Some(g) => b.inner_size(g.width, g.height).position(g.x, g.y),
        None => b.inner_size(1240.0, 860.0),
    };
    #[cfg(target_os = "macos")]
    let b = b
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    let window = match b.build() {
        Ok(w) => w,
        Err(e) => {
            tracing::error!(error = %e, "could not create a window");
            return None;
        }
    };
    if place.is_some_and(|g| g.maximized) {
        let _ = window.maximize();
    }
    let (w, _) = logical_size(&window);
    let chrome = WebviewBuilder::new(
        chrome_label(&label),
        WebviewUrl::App(PathBuf::from("chrome.html")),
    )
    .initialization_script(format!("window.__LEAF_CHROME__ = {label:?};"))
    .on_navigation(|url| {
        leaf_app::launch::navigation_allowed(url.as_str(), cfg!(debug_assertions))
    });
    if let Err(e) = window.add_child(
        chrome,
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(w, TITLE),
    ) {
        tracing::error!(error = %e, "could not add the window's title row");
    }
    state.tabs.lock().unwrap().add_window(&label);
    let shown = window.clone();
    state.runtime.spawn(async move {
        tokio::time::sleep(READY_FALLBACK).await;
        show(&shown);
    });
    Some(window)
}

/// Shows a window that opened hidden (once its first tab painted, or after a while).
pub fn show(window: &Window<Wry>) {
    if !window.is_visible().unwrap_or(true) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Adds a tab on `root` to `window` at `at` (the end when `None`) and shows it. With
/// `opened_at`, the tab is a clone opened on that document; `route` overrides the first
/// document. Returns the new tab's id.
pub fn add_tab(
    app: &AppHandle,
    window: &Window<Wry>,
    root: &Path,
    opened_at: Option<String>,
    route: Option<String>,
    at: Option<usize>,
) -> Option<String> {
    let state = app.state::<AppState>();
    let id = format!("t{}", state.next.fetch_add(1, Ordering::Relaxed));
    {
        let _rt = state.runtime.enter();
        if let Err(e) = state.windows.open(&id, root) {
            tracing::error!(target = %root.display(), error = %e, "cannot open");
            return None;
        }
    }
    let folder = Windows::folder_of(root);
    let doc = match &opened_at {
        Some(d) => d.clone(),
        None if root.is_file() => root
            .strip_prefix(&folder)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
        None => String::new(),
    };
    let route = route.unwrap_or_else(|| route_for(&doc));
    // The tab learns its id and its first document before the UI runs.
    let init = format!(
        "window.__LEAF_WINDOW__ = {id:?}; window.__LEAF_TAB__ = true; history.replaceState(null, '', {route:?});"
    );
    let (w, h) = logical_size(window);
    let top = chrome_height(app, window.label());
    let builder = WebviewBuilder::new(&id, WebviewUrl::App(PathBuf::from("index.html")))
        .initialization_script(&init)
        // Nothing in a tab, a live pane's frame included, navigates to the network.
        .on_navigation(|url| {
            let ok = leaf_app::launch::navigation_allowed(url.as_str(), cfg!(debug_assertions));
            if !ok {
                tracing::info!(%url, "navigation refused");
            }
            ok
        });
    if let Err(e) = window.add_child(
        builder,
        LogicalPosition::new(0.0, top),
        LogicalSize::new(w, (h - top).max(0.0)),
    ) {
        tracing::error!(error = %e, "could not add a tab");
        state.windows.close(&id);
        return None;
    }
    state.tabs.lock().unwrap().add_tab(
        window.label(),
        Workspace {
            id: id.clone(),
            roots: vec![root.to_path_buf()],
            opened_at,
        },
        at,
    );
    select(app, &id);
    relayout(app, window);
    Some(id)
}

/// Shows `tab` in its window and hides the others; the chrome follows it.
pub fn select(app: &AppHandle, tab: &str) {
    let state = app.state::<AppState>();
    let (window, others, title) = {
        let mut tabs = state.tabs.lock().unwrap();
        tabs.select(tab);
        let Some(w) = tabs.window_of(tab) else { return };
        let title = tabs
            .workspace(tab)
            .map(|ws| label(ws, &home()))
            .unwrap_or_default();
        (w.clone(), tabs.tabs_of(&w), title)
    };
    for t in &others {
        if let Some(v) = app.get_webview(t) {
            let _ = if t == tab { v.show() } else { v.hide() };
        }
    }
    if let Some(v) = app.get_webview(tab) {
        let _ = v.set_focus();
    }
    if let Some(w) = app.get_window(&window) {
        // The window's name in the Window menu and Mission Control.
        let _ = w.set_title(&title);
    }
    send_state(app, &window, tab);
    changed(app);
}

/// Gives `window`'s chrome the state `tab` last reported.
fn send_state(app: &AppHandle, window: &str, tab: &str) {
    let state = app.state::<AppState>();
    let s = state.tab_state.lock().unwrap().get(tab).cloned();
    if let Some(s) = s {
        let _ = app.emit_to(
            EventTarget::AnyLabel {
                label: chrome_label(window),
            },
            &format!("leaf://tab-state/{window}"),
            s,
        );
    }
}

/// Closes `tab`; a window's last tab closes the window.
pub fn close_tab(app: &AppHandle, tab: &str) {
    let state = app.state::<AppState>();
    let window = state.tabs.lock().unwrap().close_tab(tab);
    if let Some(v) = app.get_webview(tab) {
        let _ = v.close();
    }
    state.windows.close(tab);
    state.tab_state.lock().unwrap().remove(tab);
    let Some(window) = window else { return };
    let next = active_tab(app, &window);
    match (next, app.get_window(&window)) {
        (Some(next), Some(w)) => {
            select(app, &next);
            relayout(app, &w);
        }
        (None, Some(w)) => {
            let _ = w.destroy();
        }
        _ => {}
    }
    changed(app);
}

/// A window went away (its close button, or its last tab): its tabs' sessions go too.
pub fn window_gone(app: &AppHandle, window: &str) {
    let state = app.state::<AppState>();
    let tabs = state.tabs.lock().unwrap().tabs_of(window);
    for t in tabs {
        state.tabs.lock().unwrap().close_tab(&t);
        state.windows.close(&t);
        state.tab_state.lock().unwrap().remove(&t);
    }
    let mut front = state.front.lock().unwrap();
    if front.as_deref() == Some(window) {
        *front = None;
    }
}

/// What a window's place is remembered under: its one tab's root, else the shared key.
pub fn place_key(app: &AppHandle, window: &str) -> Option<PathBuf> {
    let state = app.state::<AppState>();
    let tabs = state.tabs.lock().unwrap();
    match tabs.tabs_of(window).as_slice() {
        [] => None,
        [one] => tabs.workspace(one).and_then(|ws| ws.roots.first().cloned()),
        _ => Some(PathBuf::from(PLACE_KEY)),
    }
}

fn window_of_webview(webview: &Webview<Wry>) -> String {
    webview.window().label().to_string()
}

#[tauri::command]
pub fn leaf_tabs(webview: Webview<Wry>) -> Vec<TabInfo> {
    let app = webview.app_handle();
    let window = window_of_webview(&webview);
    let state = app.state::<AppState>();
    let tabs = state.tabs.lock().unwrap();
    let active = tabs.active(&window);
    let home = home();
    tabs.tabs_of(&window)
        .into_iter()
        .filter_map(|id| {
            let ws = tabs.workspace(&id)?;
            let root = ws.roots.first()?;
            let path = label(
                &Workspace {
                    opened_at: None,
                    ..ws.clone()
                },
                &home,
            );
            Some(TabInfo {
                label: label(ws, &home),
                path,
                kind: if root.is_dir() { "folder" } else { "file" },
                name: root
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                active: active.as_deref() == Some(id.as_str()),
                id,
            })
        })
        .collect()
}

#[tauri::command]
pub fn leaf_select_tab(webview: Webview<Wry>, id: String) {
    select(webview.app_handle(), &id);
}

#[tauri::command]
pub fn leaf_close_tab(webview: Webview<Wry>, id: String) {
    close_tab(webview.app_handle(), &id);
}

/// + and ⌘T: a tab on the active tab's folder, at its first document, after it.
pub fn new_tab(app: &AppHandle, window: &Window<Wry>) {
    let state = app.state::<AppState>();
    let (root, at) = {
        let tabs = state.tabs.lock().unwrap();
        let Some(active) = tabs.active(window.label()) else {
            return;
        };
        let Some(root) = tabs
            .workspace(&active)
            .and_then(|ws| ws.roots.first().cloned())
        else {
            return;
        };
        let at = tabs
            .tabs_of(window.label())
            .iter()
            .position(|t| *t == active);
        (Windows::folder_of(&root), at.map(|i| i + 1))
    };
    add_tab(app, window, &root, None, None, at);
}

#[tauri::command]
pub fn leaf_new_tab(webview: Webview<Wry>) {
    new_tab(webview.app_handle(), &webview.window());
}

#[tauri::command]
pub fn leaf_tab_command(webview: Webview<Wry>, name: String, arg: Option<serde_json::Value>) {
    let app = webview.app_handle();
    if let Some(tab) = active_tab(app, &window_of_webview(&webview)) {
        command_to(app, &tab, serde_json::json!({ "name": name, "arg": arg }));
    }
}

/// A tab's reader reports what the title row shows for it.
#[tauri::command]
pub fn leaf_tab_state(webview: Webview<Wry>, state: serde_json::Value) {
    let app = webview.app_handle();
    let tab = webview.label().to_string();
    app.state::<AppState>()
        .tab_state
        .lock()
        .unwrap()
        .insert(tab.clone(), state);
    let window = window_of_webview(&webview);
    if active_tab(app, &window).as_deref() == Some(tab.as_str()) {
        send_state(app, &window, &tab);
    }
}

#[tauri::command]
pub fn leaf_reorder(webview: Webview<Wry>, tab: String, index: usize) {
    let app = webview.app_handle();
    let window = window_of_webview(&webview);
    app.state::<AppState>()
        .tabs
        .lock()
        .unwrap()
        .move_tab(&tab, &window, Some(index));
    // Dragging a tab picks it, as in browsers.
    select(app, &tab);
}
