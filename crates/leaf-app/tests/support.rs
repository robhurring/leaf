// Starts the real serve mode on a temp folder for integration tests.
use std::path::PathBuf;

use leaf_app::serve::{self, Started};

pub struct TestServer {
    pub port: u16,
    pub root: PathBuf,
    started: Option<Started>,
    _dir: tempfile::TempDir,
    _cfg: tempfile::TempDir,
}

impl TestServer {
    pub async fn stop(mut self) {
        if let Some(s) = self.started.take() {
            s.stop().await;
        }
    }
}

pub async fn start_test_server() -> TestServer {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    std::fs::create_dir_all(root.join("node_modules")).unwrap();
    std::fs::write(root.join("README.md"), "# hello\n").unwrap();
    std::fs::write(
        root.join("logo.svg"),
        "<svg xmlns='http://www.w3.org/2000/svg'/>",
    )
    .unwrap();
    std::fs::write(root.join("pic.png"), [0x89, 0x50, 0x4e, 0x47]).unwrap();
    std::fs::write(root.join("node_modules/x.js"), "x").unwrap();
    let cfg = tempfile::tempdir().unwrap();
    let env: std::collections::HashMap<String, String> = [(
        "LEAF_CONFIG_DIR".to_string(),
        cfg.path().to_string_lossy().into_owned(),
    )]
    .into();
    let argv: Vec<String> = ["serve", root.to_str().unwrap(), "--port", "0", "--no-open"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let (config, sources) = leaf_core::config::load(&argv, &env, &root).unwrap();
    let started = serve::start(&config, &sources, serve::Hooks::default())
        .await
        .unwrap();
    TestServer {
        port: started.port,
        root,
        started: Some(started),
        _dir: dir,
        _cfg: cfg,
    }
}
