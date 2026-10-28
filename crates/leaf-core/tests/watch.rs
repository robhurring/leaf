use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use leaf_core::ignore::Ignorer;
use leaf_core::watch::{ChangeEvent, Watcher};
use leaf_protocol::Change;
use tokio::sync::broadcast;

struct Fx {
    _d: tempfile::TempDir,
    root: PathBuf,
    rx: broadcast::Receiver<ChangeEvent>,
    watcher: Watcher,
}

async fn fx() -> Fx {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().canonicalize().unwrap();
    std::fs::create_dir_all(root.join("node_modules")).unwrap();
    std::fs::write(root.join("a.md"), "# a").unwrap();
    let (tx, rx) = broadcast::channel(64);
    std::fs::create_dir_all(root.join("build")).unwrap();
    std::fs::write(root.join(".gitignore"), "build/\n").unwrap();
    let ignorer = Arc::new(Ignorer::new(&root, &["node_modules".to_string()], true));
    let watcher = Watcher::start(root.clone(), ignorer, tx).unwrap();
    // The OS may still report the fixture writes made just before watching started.
    tokio::time::sleep(Duration::from_millis(300)).await;
    let mut fx = Fx {
        _d: d,
        root,
        rx,
        watcher,
    };
    while fx.rx.try_recv().is_ok() {}
    fx
}

async fn collect(rx: &mut broadcast::Receiver<ChangeEvent>, settle_ms: u64) -> Vec<ChangeEvent> {
    let mut out = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_millis(settle_ms);
    while let Ok(Ok(ev)) = tokio::time::timeout_at(deadline, rx.recv()).await {
        out.push(ev);
    }
    out
}

async fn wait_for(
    rx: &mut broadcast::Receiver<ChangeEvent>,
    ms: u64,
    pred: impl Fn(&ChangeEvent) -> bool,
) -> Vec<ChangeEvent> {
    let mut seen = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_millis(ms);
    loop {
        match tokio::time::timeout_at(deadline, rx.recv()).await {
            Ok(Ok(ev)) => {
                let hit = pred(&ev);
                seen.push(ev);
                if hit {
                    return seen;
                }
            }
            _ => return seen,
        }
    }
}

#[tokio::test]
async fn collapses_rapid_writes_into_one_modified() {
    let mut f = fx().await;
    for i in 0..5 {
        std::fs::write(f.root.join("a.md"), format!("# a {i}")).unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let events = collect(&mut f.rx, 1500).await;
    assert_eq!(
        events,
        vec![ChangeEvent {
            path: "a.md".into(),
            change: Change::Modified,
            from: None
        }]
    );
    f.watcher.stop();
}

#[tokio::test]
async fn emits_created_and_deleted() {
    let mut f = fx().await;
    std::fs::write(f.root.join("b.md"), "# b").unwrap();
    let seen = wait_for(&mut f.rx, 3000, |e| {
        e.change == Change::Created && e.path == "b.md"
    })
    .await;
    assert!(
        seen.iter()
            .any(|e| e.change == Change::Created && e.path == "b.md"),
        "{seen:?}"
    );
    std::fs::remove_file(f.root.join("b.md")).unwrap();
    let seen = wait_for(&mut f.rx, 3000, |e| {
        e.change == Change::Deleted && e.path == "b.md"
    })
    .await;
    assert!(
        seen.iter()
            .any(|e| e.change == Change::Deleted && e.path == "b.md"),
        "{seen:?}"
    );
    f.watcher.stop();
}

#[tokio::test]
async fn ignores_ignored_paths() {
    let mut f = fx().await;
    std::fs::write(f.root.join("node_modules/x.js"), "x").unwrap();
    assert_eq!(collect(&mut f.rx, 700).await, vec![]);
    f.watcher.stop();
}

#[tokio::test]
async fn rename_is_one_event_with_from() {
    let mut f = fx().await;
    std::fs::rename(f.root.join("a.md"), f.root.join("b.md")).unwrap();
    let events = collect(&mut f.rx, 1500).await;
    assert_eq!(
        events,
        vec![ChangeEvent {
            path: "b.md".into(),
            change: Change::Renamed,
            from: Some("a.md".into())
        }]
    );
    f.watcher.stop();
}

#[tokio::test]
async fn an_editor_safe_write_is_one_modified_for_the_real_path() {
    let mut f = fx().await;
    // vim / VS Code style: write a temp file beside, then rename it over the original.
    std::fs::write(f.root.join(".a.md.tmp"), "# a (new)").unwrap();
    tokio::time::sleep(Duration::from_millis(30)).await;
    std::fs::rename(f.root.join(".a.md.tmp"), f.root.join("a.md")).unwrap();
    let events = collect(&mut f.rx, 1500).await;
    assert!(
        events
            .iter()
            .any(|e| e.path == "a.md" && e.change == Change::Modified),
        "expected a modified for a.md, got {events:?}"
    );
    assert!(
        !events
            .iter()
            .any(|e| e.path == "a.md" && e.change == Change::Deleted),
        "{events:?}"
    );
    assert!(
        !events
            .iter()
            .any(|e| e.change == Change::Renamed && e.path == "a.md"),
        "{events:?}"
    );
    f.watcher.stop();
}

#[tokio::test]
async fn stop_ends_the_stream() {
    let mut f = fx().await;
    f.watcher.stop();
    tokio::time::sleep(Duration::from_millis(100)).await;
    std::fs::write(f.root.join("c.md"), "# c").unwrap();
    assert_eq!(collect(&mut f.rx, 500).await, vec![]);
}

#[tokio::test]
async fn deleting_a_folder_ignored_by_a_folder_only_rule_is_silent() {
    let mut f = fx().await;
    std::fs::remove_dir_all(f.root.join("build")).unwrap();
    let events = collect(&mut f.rx, 1000).await;
    assert!(!events.iter().any(|e| e.path == "build"), "{events:?}");
    f.watcher.stop();
}
