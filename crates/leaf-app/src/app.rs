//! The leaf reader app: one process, many windows, a native menu. Each window
//! loads the built UI, which talks to the core through `leaf_send` and listens on
//! its own event channel. A second `leaf open` hands its path to this process.
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use leaf_core::config::Config;
use leaf_protocol::{ClientMessage, ServerMessage};
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewUrl, WebviewWindowBuilder, Wry};

use leaf_app::launch::route_for;
use leaf_app::window::Windows;

struct AppState {
    windows: Arc<Windows>,
    runtime: tokio::runtime::Handle,
    next: AtomicU32,
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

/// A web or mail link clicked in a window opens in the system's browser or mail client.
#[tauri::command]
fn leaf_open_url(url: String) -> Result<(), String> {
    if !leaf_app::launch::is_external_url(&url) {
        return Err(format!("not a web or mail link: {url}"));
    }
    open::that_detached(&url).map_err(|e| e.to_string())
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
        route = route_for(&path)
    );
    let builder =
        WebviewWindowBuilder::new(app, &label, WebviewUrl::App(PathBuf::from("index.html")))
            .title(&title)
            .inner_size(1240.0, 860.0)
            .min_inner_size(640.0, 420.0)
            .visible(false)
            .initialization_script(&init);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    match builder.build() {
        Ok(window) => {
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
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .build()?;
    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &window])
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

/// Runs the app until its last window closes. Call on the main thread inside a
/// multi-thread tokio runtime: `run` blocks this thread for the event loop while
/// commands (`leaf_send`) run on the runtime's workers; a current-thread runtime
/// would deadlock them.
pub fn run(config: Config) -> i32 {
    let runtime = tokio::runtime::Handle::current();
    tauri::async_runtime::set(runtime.clone());
    let first = config.target.clone();
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            match leaf_app::launch::target_from_argv(&argv, Path::new(&cwd)) {
                Some(t) => open_window(app, &t),
                None => tracing::warn!(?argv, "second launch without a path"),
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            leaf_send,
            leaf_ready,
            leaf_open_url
        ])
        .menu(build_menu)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_window_event(|window, event| {
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
            app.manage(AppState {
                windows,
                runtime: runtime.clone(),
                next: AtomicU32::new(1),
            });
            open_window(&handle, &first);
            Ok(())
        })
        .run(tauri::generate_context!());
    match result {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("leaf: the app failed: {e}");
            1
        }
    }
}
