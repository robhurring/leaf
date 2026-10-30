//! The leaf reader app: one process, many windows, a native menu. Each window
//! loads the built UI, which talks to the core through `leaf_send` and listens on
//! its own event channel. A second `leaf open` hands its path to this process.
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use leaf_core::config::Config;
use leaf_core::prefs::PreferencesStore;
use leaf_protocol::{ClientMessage, DEFAULT_LINK_SCHEMES, ServerMessage};
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewUrl, WebviewWindowBuilder, Wry};

use leaf_app::launch::{link_in_argv, parse_deep_link, route_for};
use leaf_app::window::Windows;
use leaf_app::window_state::{Geometry, Rect, WindowStates};

struct AppState {
    windows: Arc<Windows>,
    runtime: tokio::runtime::Handle,
    next: AtomicU32,
    /// Where each file or folder's window was, kept in `<config-dir>/windows.json`.
    places: std::sync::Mutex<WindowStates>,
    places_file: PathBuf,
    /// A save is scheduled; moves and resizes come in bursts.
    save_pending: std::sync::atomic::AtomicBool,
    /// The stored preferences: which kinds of link open.
    prefs: PreferencesStore,
}

/// How long after the last move or resize the window places are written.
const SAVE_AFTER: std::time::Duration = std::time::Duration::from_millis(500);

/// The screens' usable areas, in logical pixels.
fn screens(app: &AppHandle) -> Vec<Rect> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let area = m.work_area();
            let scale = m.scale_factor();
            Rect {
                x: area.position.x as f64 / scale,
                y: area.position.y as f64 / scale,
                width: area.size.width as f64 / scale,
                height: area.size.height as f64 / scale,
            }
        })
        .collect()
}

/// A window's geometry now, in logical pixels.
fn geometry_of(window: &tauri::Window) -> Option<Geometry> {
    let scale = window.scale_factor().ok()?;
    let pos = window.outer_position().ok()?.to_logical::<f64>(scale);
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    Some(Geometry {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        maximized: false,
    })
}

/// Remembers where `window` is, under what it opened, and schedules a save.
fn record_place(window: &tauri::Window) {
    let app = window.app_handle();
    let state = app.state::<AppState>();
    let Some(opened) = state.windows.opened(window.label()) else {
        return;
    };
    // Full screen is a mode, not a place; a maximized window keeps its normal size
    // to come back to, marked maximized.
    if window.is_fullscreen().unwrap_or(false) {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    {
        let mut places = state.places.lock().unwrap_or_else(|e| e.into_inner());
        let g = if maximized {
            match places.place(&opened, &[], &[]) {
                Some(prev) => Geometry {
                    maximized: true,
                    ..prev
                },
                None => return,
            }
        } else {
            match geometry_of(window) {
                Some(g) => g,
                None => return,
            }
        };
        places.record(&opened, g);
    }
    if state.save_pending.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    state.runtime.spawn(async move {
        tokio::time::sleep(SAVE_AFTER).await;
        let state = app.state::<AppState>();
        state.save_pending.store(false, Ordering::SeqCst);
        let places = state.places.lock().unwrap_or_else(|e| e.into_inner());
        if let Err(e) = places.save(&state.places_file) {
            tracing::warn!(error = %e, "could not save window places");
        }
    });
}

fn emit(app: &AppHandle, label: &str, msg: ServerMessage) {
    if let Err(e) = app.emit_to(
        EventTarget::webview_window(label),
        &Windows::event_name(label),
        msg,
    ) {
        tracing::warn!(window = label, error = %e, "could not deliver to window");
    }
}

#[tauri::command]
async fn leaf_send(
    window: String,
    msg: ClientMessage,
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    for reply in state.windows.send(&window, msg).await {
        emit(&app, &window, reply);
    }
    Ok(())
}

/// A link clicked in a window opens in the app the system has for it (a browser, mail,
/// an editor), when its kind is one the person allows in Settings.
#[tauri::command]
async fn leaf_open_url(url: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let allowed: Vec<String> = match state.prefs.load().await.link_schemes {
        Some(list) => list,
        None => DEFAULT_LINK_SCHEMES.iter().map(|s| s.to_string()).collect(),
    };
    if !leaf_app::launch::link_allowed(&url, &allowed) {
        return Err(format!("not an allowed kind of link: {url}"));
    }
    open::that_detached(&url).map_err(|e| e.to_string())
}

/// Opens the speaker view for a deck shown in `window`, in a window of its own on the
/// same file. `path` is the deck's path within the window's folder.
#[tauri::command]
fn leaf_open_speaker(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    let app = window.app_handle().clone();
    let state = app.state::<AppState>();
    let opened = state
        .windows
        .opened(window.label())
        .ok_or("this window has nothing open")?;
    // The same folder as this window, so the deck's path means the same thing there.
    let (folder, route) = leaf_app::launch::speaker_target(&opened, &path)?;
    open_window_at(&app, &folder, Some(route));
    Ok(())
}

/// The UI has painted: show its window. Windows open hidden so they never flash blank.
#[tauri::command]
fn leaf_ready(window: tauri::WebviewWindow) {
    if !window.is_visible().unwrap_or(true) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// How long a window may stay hidden waiting for its UI before it is shown anyway.
const READY_FALLBACK: std::time::Duration = std::time::Duration::from_millis(1500);

/// Opens a window on `target`: a folder, or a file shown inside its folder.
pub fn open_window(app: &AppHandle, target: &Path) {
    open_window_at(app, target, None);
}

/// Opens a window on `target` showing `route` (a UI route such as `/docs/a.md#setup`)
/// instead of the document the target names.
fn open_window_at(app: &AppHandle, target: &Path, route: Option<String>) {
    let state = app.state::<AppState>();
    let label = format!("w{}", state.next.fetch_add(1, Ordering::Relaxed));
    let _rt = state.runtime.enter();
    if let Err(e) = state.windows.open(&label, target) {
        tracing::error!(target = %target.display(), error = %e, "cannot open");
        return;
    }
    let folder = Windows::folder_of(target);
    let path = if target.is_file() {
        target
            .strip_prefix(&folder)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default()
    } else {
        String::new()
    };
    // The window is named for what was opened: the file, or the folder.
    let title = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "leaf".into());
    // The window learns its label and its first document before the UI runs.
    let init = format!(
        "window.__LEAF_WINDOW__ = {label:?}; history.replaceState(null, '', {route:?});",
        route = route.unwrap_or_else(|| route_for(&path))
    );
    // Where this file or folder's window last was, else the last window's size, stepped
    // aside from the windows already open; the default size otherwise.
    let open: Vec<Geometry> = app
        .webview_windows()
        .values()
        .filter_map(|w| geometry_of(&w.as_ref().window()))
        .collect();
    let place = state
        .places
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .place(target, &open, &screens(app));
    let builder =
        WebviewWindowBuilder::new(app, &label, WebviewUrl::App(PathBuf::from("index.html")))
            .title(&title)
            .min_inner_size(640.0, 420.0)
            .visible(false)
            .initialization_script(&init)
            // Nothing in the window, a live pane's frame included, navigates to the network.
            .on_navigation(|url| {
                let ok = leaf_app::launch::navigation_allowed(url.as_str(), cfg!(debug_assertions));
                if !ok {
                    tracing::info!(%url, "navigation refused");
                }
                ok
            });
    let builder = match place {
        Some(g) => builder.inner_size(g.width, g.height).position(g.x, g.y),
        None => builder.inner_size(1240.0, 860.0),
    };
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    match builder.build() {
        Ok(window) => {
            if place.is_some_and(|g| g.maximized) {
                let _ = window.maximize();
            }
            state.runtime.spawn(async move {
                tokio::time::sleep(READY_FALLBACK).await;
                leaf_ready(window);
            });
        }
        Err(e) => {
            tracing::error!(error = %e, "could not create a window");
            state.windows.close(&label);
        }
    }
}

fn item(
    app: &AppHandle,
    id: &str,
    text: &str,
    accel: Option<&str>,
) -> tauri::Result<tauri::menu::MenuItem<Wry>> {
    let b = MenuItemBuilder::with_id(id, text);
    match accel {
        Some(a) => b.accelerator(a).build(app),
        None => b.build(app),
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let app_menu = SubmenuBuilder::new(app, "leaf reader")
        .about(None)
        .separator()
        .item(&item(
            app,
            "cmd:openSettings",
            "Settings…",
            Some("CmdOrCtrl+,"),
        )?)
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&item(
            app,
            "open-folder",
            "Open Folder…",
            Some("CmdOrCtrl+Shift+O"),
        )?)
        .separator()
        .close_window()
        .build()?;
    // Cmd only: on other platforms ctrl-f stays the reader's page-down key.
    let find_key = cfg!(target_os = "macos").then_some("Cmd+F");
    let edit = SubmenuBuilder::new(app, "Edit")
        .copy()
        .select_all()
        .separator()
        .item(&item(app, "cmd:openFind", "Find…", find_key)?)
        .item(&item(
            app,
            "cmd:openPalette",
            "Go To…",
            Some("CmdOrCtrl+K"),
        )?)
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item(app, "appearance:light", "Light", None)?)
        .item(&item(app, "appearance:dark", "Dark", None)?)
        .item(&item(app, "appearance:auto", "System", None)?)
        .separator()
        .item(&item(app, "cmd:toggleTree", "Files", None)?)
        .item(&item(app, "cmd:toggleOutline", "Outline", None)?)
        .item(&item(app, "cmd:toggleNumbering", "Number Headings", None)?)
        .separator()
        .item(&item(
            app,
            "cmd:textLarger",
            "Larger Text",
            Some("CmdOrCtrl+="),
        )?)
        .item(&item(
            app,
            "cmd:textSmaller",
            "Smaller Text",
            Some("CmdOrCtrl+-"),
        )?)
        .item(&item(
            app,
            "cmd:textReset",
            "Actual Text Size",
            Some("CmdOrCtrl+0"),
        )?)
        .build()?;
    let go = SubmenuBuilder::new(app, "Go")
        .item(&item(app, "cmd:goBack", "Back", Some("CmdOrCtrl+["))?)
        .item(&item(app, "cmd:goForward", "Forward", Some("CmdOrCtrl+]"))?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .build()?;
    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &go, &window])
        .build()
}

/// Menu items name commands; the focused window runs them.
fn on_menu(app: &AppHandle, id: &str) {
    if id == "open-folder" {
        use tauri_plugin_dialog::DialogExt;
        let handle = app.clone();
        app.dialog().file().pick_folder(move |picked| {
            if let Some(path) = picked.and_then(|p| p.into_path().ok()) {
                open_window(&handle, &path);
            }
        });
        return;
    }
    let payload = if let Some(a) = id.strip_prefix("appearance:") {
        serde_json::json!({ "name": "setAppearance", "arg": a })
    } else if let Some(c) = id.strip_prefix("cmd:") {
        serde_json::json!({ "name": c })
    } else {
        return;
    };
    let focused = app
        .webview_windows()
        .into_iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false));
    if let Some((label, _)) = focused {
        let _ = app.emit_to(
            EventTarget::webview_window(&label),
            "leaf://command",
            payload,
        );
    }
}

/// Shows a `leaf://` link: in the window already showing that file or folder (brought
/// forward, and moved to the document), else in a new window. Browser links go to the
/// command, which knows how to start a server.
fn open_link(app: &AppHandle, url: &str) {
    let link = match parse_deep_link(url) {
        Ok(l) => l,
        Err(e) => return tracing::warn!(url, error = %e, "ignoring a leaf:// link"),
    };
    tracing::info!(url, "opening a link");
    if link.browser {
        return relaunch_with(url);
    }
    // Window keys are canonical paths; a link may name /tmp for /private/tmp.
    let link = link.canonical();
    let (source, _) = link.opening();
    let state = app.state::<AppState>();
    let Some((label, opened)) = state.windows.find_for(&source) else {
        return open_window_at(app, &source, Some(link.route()));
    };
    let Some(window) = app.get_webview_window(&label) else {
        return open_window_at(app, &source, Some(link.route()));
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    // The document, relative to what that window opened.
    let doc = if opened.is_dir() {
        link.target
            .strip_prefix(&opened)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default()
    } else {
        opened
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    };
    if doc.is_empty() && link.heading.is_none() {
        return;
    }
    let _ = app.emit_to(
        EventTarget::webview_window(&label),
        "leaf://command",
        serde_json::json!({ "name": "openPath", "arg": { "path": doc, "slug": link.heading } }),
    );
}

/// Hands a link to a fresh `leaf <link>`, which opens the browser or the app as asked.
fn relaunch_with(url: &str) {
    use std::os::unix::process::CommandExt;
    match std::env::current_exe() {
        Ok(exe) => {
            if let Err(e) = std::process::Command::new(exe)
                .arg(url)
                .stdin(std::process::Stdio::null())
                .process_group(0)
                .spawn()
            {
                tracing::error!(url, error = %e, "could not open the link");
            }
        }
        Err(e) => tracing::error!(error = %e, "cannot find my own executable"),
    }
}

/// macOS starts the installed app to deliver a link when no leaf is running. That
/// process only receives: it passes each link to `leaf <link>` (which starts the app,
/// or hands off to one that started meanwhile) and quits.
pub fn receive_links() -> i32 {
    let app = match tauri::Builder::default().build(context()) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("leaf: the app failed: {e}");
            return 1;
        }
    };
    #[cfg(target_os = "macos")]
    let mut app = app;
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    // Opened without a link (from Finder, say): nothing to do.
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(5));
        handle.exit(0);
    });
    app.run(|app, event| {
        // Only macOS hands a running app the links it was opened with.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            for url in urls.iter().filter(|u| u.scheme() == "leaf") {
                relaunch_with(url.as_str());
            }
            app.exit(0);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
    0
}

// The app's config and assets, embedded once (the macro may appear only once per binary).
fn context() -> tauri::Context<Wry> {
    tauri::generate_context!()
}

/// Runs the app until its last window closes. Call on the main thread inside a
/// multi-thread tokio runtime: `run` blocks this thread for the event loop while
/// commands (`leaf_send`) run on the runtime's workers; a current-thread runtime
/// would deadlock them.
pub fn run(config: Config, link: Option<String>) -> i32 {
    let runtime = tokio::runtime::Handle::current();
    tauri::async_runtime::set(runtime.clone());
    let first = config.target.clone();
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(i) = link_in_argv(&argv) {
                return open_link(app, &argv[i]);
            }
            match leaf_app::launch::target_from_argv(&argv, Path::new(&cwd)) {
                Some(t) => open_window(app, &t),
                None => tracing::warn!(?argv, "second launch without a path"),
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            leaf_send,
            leaf_ready,
            leaf_open_url,
            leaf_open_speaker
        ])
        .menu(build_menu)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) = event {
                record_place(window);
            }
            if let tauri::WindowEvent::Destroyed = event {
                window
                    .app_handle()
                    .state::<AppState>()
                    .windows
                    .close(window.label());
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            let emit_handle = handle.clone();
            let windows = Arc::new(Windows::new(
                config.clone(),
                Arc::new(move |label: &str, msg: ServerMessage| emit(&emit_handle, label, msg)),
            ));
            let places_file = config.config_dir.join("windows.json");
            app.manage(AppState {
                windows,
                runtime: runtime.clone(),
                next: AtomicU32::new(1),
                places: std::sync::Mutex::new(WindowStates::load(&places_file)),
                places_file,
                save_pending: std::sync::atomic::AtomicBool::new(false),
                prefs: PreferencesStore::new(config.config_dir.join("preferences.json")),
            });
            match &link {
                Some(url) => open_link(&handle, url),
                None => open_window(&handle, &first),
            }
            Ok(())
        })
        .build(context())
        .map(|app| {
            // Links clicked elsewhere while this app runs (macOS delivers them here).
            app.run(|app, event| {
                #[cfg(target_os = "macos")]
                if let tauri::RunEvent::Opened { urls } = event {
                    for url in urls.iter().filter(|u| u.scheme() == "leaf") {
                        open_link(app, url.as_str());
                    }
                }
                #[cfg(not(target_os = "macos"))]
                let _ = (app, event);
            })
        });
    match result {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("leaf: the app failed: {e}");
            1
        }
    }
}
