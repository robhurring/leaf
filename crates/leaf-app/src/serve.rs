//! Serve mode: binds HTTP + WebSocket on loopback over one Engine on one folder.
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::Router;
use axum::routing::get;
use leaf_core::config::{Config, ConfigSource, Sources};
use leaf_core::disk::{DiskOptions, DiskSource};
use leaf_core::engine::{Engine, EngineConfig};
use leaf_core::ignore::Ignorer;
use leaf_core::prefs::PreferencesStore;
use leaf_core::source::Source as _;
use leaf_core::watch::Watcher;
use tokio::sync::{broadcast, watch};

#[derive(Default)]
pub struct Hooks {
    /// Called with the number of connected clients whenever it changes.
    pub on_clients: Option<Arc<dyn Fn(usize) + Send + Sync>>,
}

#[derive(Clone)]
pub struct AppState {
    pub engine: Arc<Engine>,
    pub root_dir: std::path::PathBuf,
    pub allowed_hosts: Vec<String>,
    pub shutdown: watch::Receiver<bool>,
    clients: Arc<AtomicUsize>,
    hooks: Arc<Hooks>,
}

impl AppState {
    pub fn clients_changed(&self, delta: isize) {
        let n = if delta >= 0 {
            self.clients.fetch_add(delta as usize, Ordering::SeqCst) + delta as usize
        } else {
            self.clients.fetch_sub((-delta) as usize, Ordering::SeqCst) - (-delta) as usize
        };
        if let Some(f) = &self.hooks.on_clients {
            f(n);
        }
    }
}

#[derive(Debug)]
pub struct ServeError(pub String);
impl std::fmt::Display for ServeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for ServeError {}

pub struct Started {
    pub url: String,
    pub port: u16,
    pub engine: Arc<Engine>,
    shutdown: watch::Sender<bool>,
    server: tokio::task::JoinHandle<()>,
    watcher: Option<Watcher>,
}

impl Started {
    pub async fn stop(mut self) {
        let _ = self.shutdown.send(true);
        if let Some(w) = self.watcher.take() {
            w.stop();
        }
        self.server.abort();
        let _ = self.server.await;
        tracing::info!("stopped");
    }
}

/// One Engine on one folder, fed by a watcher. Shared by serve mode and app windows.
pub struct Built {
    pub engine: Arc<Engine>,
    pub root_dir: std::path::PathBuf,
    pub watcher: Option<Watcher>,
}

pub fn build_engine(config: &Config, raw_base: Option<&str>) -> Result<Built, ServeError> {
    let source = Arc::new(
        DiskSource::new(DiskOptions {
            target: config.target.clone(),
            ignore: config.ignore.clone(),
            gitignore: config.gitignore,
            max_entries: config.max_entries,
            max_inline_bytes: config.max_inline_bytes,
        })
        .map_err(|e| ServeError(e.message))?,
    );
    let root_dir = source.root_dir().to_path_buf();
    tracing::info!(root = %root_dir.display(), kind = ?source.root().kind, "root resolved");
    let prefs = Arc::new(PreferencesStore::new(
        config.config_dir.join("preferences.json"),
    ));
    let engine = Engine::new(
        source.clone(),
        prefs,
        EngineConfig {
            plantuml_url: config.plantuml_url.clone(),
            mention_url: config.mention_url.clone(),
            topic_url: config.topic_url.clone(),
            max_entries: config.max_entries,
            raw_base: raw_base.map(str::to_string),
            relay_url: config.relay_url.clone(),
        },
    );

    // Disk changes flow into the Engine, which fans them out per subscription.
    let (tx, mut rx) = broadcast::channel(256);
    let ignorer = Arc::new(Ignorer::new(&root_dir, &config.ignore, config.gitignore));
    let watch_root = root_dir.canonicalize().unwrap_or_else(|_| root_dir.clone());
    let watcher = match Watcher::start(watch_root, ignorer, tx) {
        Ok(w) => Some(w),
        Err(e) => {
            tracing::warn!(error = %e, "could not watch the folder; live updates are off");
            None
        }
    };
    {
        let engine = engine.clone();
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(ev) => engine.feed_change(ev),
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
        });
    }

    Ok(Built {
        engine,
        root_dir,
        watcher,
    })
}

pub async fn start(
    config: &Config,
    sources: &Sources,
    hooks: Hooks,
) -> Result<Started, ServeError> {
    let Built {
        engine,
        root_dir,
        watcher,
    } = build_engine(config, None)?;
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let state = AppState {
        engine: engine.clone(),
        root_dir,
        allowed_hosts: vec![config.host.clone()],
        shutdown: shutdown_rx,
        clients: Arc::new(AtomicUsize::new(0)),
        hooks: Arc::new(hooks),
    };
    let app = Router::new()
        .route("/healthz", get(crate::http::healthz))
        .route("/raw/{*path}", get(crate::http::raw))
        .route("/ws", get(crate::ws::upgrade))
        .fallback(crate::http::static_file)
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::http::host_guard,
        ))
        .with_state(state);

    let listener = match tokio::net::TcpListener::bind((config.host.as_str(), config.port)).await {
        Ok(l) => l,
        Err(e)
            if e.kind() == std::io::ErrorKind::AddrInUse
                && sources.port == ConfigSource::Default =>
        {
            // The default port keeps things predictable; when it is taken, any port will do.
            tracing::warn!(
                port = config.port,
                "default port in use; picking a free one"
            );
            tokio::net::TcpListener::bind((config.host.as_str(), 0))
                .await
                .map_err(|e| ServeError(e.to_string()))?
        }
        Err(e) => {
            return Err(ServeError(format!(
                "listen {}:{}: {e}",
                config.host, config.port
            )));
        }
    };
    let port = listener
        .local_addr()
        .map_err(|e| ServeError(e.to_string()))?
        .port();
    let url = format!("http://{}:{}", config.host, port);
    let server = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!(error = %e, "server failed");
        }
    });
    tracing::info!(host = %config.host, port, url = %url, "listening");
    Ok(Started {
        url,
        port,
        engine,
        shutdown: shutdown_tx,
        server,
        watcher,
    })
}
