// The window layer without a webview: each window is an Engine session, windows on
// the same folder share one Engine, and pushes reach only the window they belong to.
use std::sync::{Arc, Mutex};
use std::time::Duration;

use leaf_app::window::Windows;
use leaf_protocol::{ClientMessage, ServerMessage};

fn config_for(cfg: &std::path::Path) -> leaf_core::config::Config {
    let env: std::collections::HashMap<String, String> = [(
        "LEAF_CONFIG_DIR".to_string(),
        cfg.to_string_lossy().into_owned(),
    )]
    .into();
    leaf_core::config::load(&["open".into(), ".".into()], &env, cfg)
        .unwrap()
        .0
}

#[tokio::test]
async fn windows_are_sessions_sharing_an_engine_per_folder() {
    let root = tempfile::tempdir().unwrap();
    let r = root.path().canonicalize().unwrap();
    std::fs::write(r.join("README.md"), "# hi\n").unwrap();
    std::fs::write(r.join("pic.png"), [0x89, 0x50, 0x4e, 0x47]).unwrap();
    let cfg = tempfile::tempdir().unwrap();
    let emitted: Arc<Mutex<Vec<(String, ServerMessage)>>> = Arc::default();
    let sink = emitted.clone();
    let windows = Windows::new(
        config_for(cfg.path()),
        Arc::new(move |label: &str, msg: ServerMessage| {
            sink.lock().unwrap().push((label.to_string(), msg))
        }),
    );
    windows.open("w1", &r).unwrap();
    windows.open("w2", &r).unwrap();
    assert_eq!(windows.engine_count(), 1, "same folder, one engine");
    assert_eq!(Windows::event_name("w1"), "leaf://message/w1");

    let welcome = windows
        .send(
            "w1",
            ClientMessage::Hello {
                protocol: 1,
                id: Some("h".into()),
            },
        )
        .await;
    match &welcome[0] {
        ServerMessage::Welcome { capabilities, .. } => {
            assert_eq!(capabilities.raw_urls, Some(false), "no /raw in a window")
        }
        other => panic!("{other:?}"),
    }
    windows
        .send(
            "w2",
            ClientMessage::Hello {
                protocol: 1,
                id: None,
            },
        )
        .await;
    windows
        .send(
            "w1",
            ClientMessage::Subscribe {
                path: "".into(),
                id: None,
            },
        )
        .await;
    let png = windows
        .send(
            "w1",
            ClientMessage::Read {
                path: "pic.png".into(),
                id: None,
            },
        )
        .await;
    assert!(matches!(
        &png[0],
        ServerMessage::File {
            encoding: leaf_protocol::Encoding::Base64,
            ..
        }
    ));

    std::fs::write(r.join("README.md"), "# hi again\n").unwrap();
    let mut seen = false;
    for _ in 0..40 {
        tokio::time::sleep(Duration::from_millis(50)).await;
        let got = emitted.lock().unwrap();
        if got.iter().any(|(l, m)| {
            l == "w1" && matches!(m, ServerMessage::Changed { path, .. } if path == "README.md")
        }) {
            assert!(!got.iter().any(|(l, _)| l == "w2"), "w2 never subscribed");
            seen = true;
            break;
        }
    }
    assert!(seen, "the change reached w1");

    windows.close("w1");
    windows.close("w2");
    assert_eq!(
        windows.engine_count(),
        0,
        "the last window on a folder releases its engine"
    );
    assert!(
        windows
            .send(
                "w1",
                ClientMessage::List {
                    path: None,
                    id: None
                }
            )
            .await
            .is_empty()
    );
}

#[tokio::test]
async fn a_single_file_window_shows_that_file_not_its_folder() {
    let root = tempfile::tempdir().unwrap();
    let r = root.path().canonicalize().unwrap();
    std::fs::write(r.join("README.md"), "# hi\n").unwrap();
    std::fs::write(r.join("other.md"), "# other\n").unwrap();
    let cfg = tempfile::tempdir().unwrap();
    let windows = Windows::new(
        config_for(cfg.path()),
        Arc::new(|_: &str, _: ServerMessage| {}),
    );
    windows.open("f", &r.join("README.md")).unwrap();
    let welcome = windows
        .send(
            "f",
            ClientMessage::Hello {
                protocol: 1,
                id: None,
            },
        )
        .await;
    match &welcome[0] {
        ServerMessage::Welcome { root, .. } => {
            assert_eq!(root.kind, leaf_protocol::EntryKind::File);
            assert_eq!(root.name, "README.md");
        }
        other => panic!("{other:?}"),
    }
    let tree = windows
        .send(
            "f",
            ClientMessage::List {
                path: None,
                id: None,
            },
        )
        .await;
    match &tree[0] {
        ServerMessage::Tree { entries, .. } => {
            assert_eq!(
                entries.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(),
                ["README.md"]
            )
        }
        other => panic!("{other:?}"),
    }
    // The folder opened on its own is a different window with the full tree.
    windows.open("d", &r).unwrap();
    assert_eq!(windows.engine_count(), 2);
}
