//! The `leaf` command. `leaf [open] <path>` behaves like a command: start (or
//! reuse) a server, print the URL, open the browser, return. `leaf serve <path>`
//! stays in the foreground with the logs; so does an explicit -l on the command line.
mod app;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use leaf_app::cli::HELP_TEXT;
use leaf_app::idle::IdleGuard;
use leaf_app::instances::{Instance, remove_instance, write_instance};
use leaf_app::launch::{
    OPEN_IDLE_DEFAULT, READY_FILE_ENV, child_args, find_running, launch_detached,
};
use leaf_app::serve::{self, Hooks};
use leaf_core::config::{Command, Config, ConfigSource, Sources, load, parse_duration};

const STARTUP_GRACE: Duration = Duration::from_secs(120);

fn open_browser(url: &str) {
    if let Err(e) = open::that_detached(url) {
        tracing::warn!(error = %e, "could not open a browser; visit {url}");
    }
}

async fn run_server(config: Config, sources: Sources) -> i32 {
    leaf_app::log::init(config.log_level, config.log_format);
    // `open` stops with the last tab unless told otherwise; `serve` runs until ctrl-c.
    let idle_ms =
        if sources.idle_timeout_ms == ConfigSource::Default && config.command == Command::Open {
            parse_duration(OPEN_IDLE_DEFAULT).unwrap_or(10_000)
        } else {
            config.idle_timeout_ms
        };
    let (idle_tx, mut idle_rx) = tokio::sync::mpsc::channel::<()>(1);
    let guard = (idle_ms > 0).then(|| {
        let tx = idle_tx.clone();
        IdleGuard::new(
            STARTUP_GRACE.max(Duration::from_millis(idle_ms)),
            Duration::from_millis(idle_ms),
            Arc::new(move || {
                let _ = tx.try_send(());
            }),
        )
    });
    let hooks = Hooks {
        on_clients: guard
            .clone()
            .map(|g| Arc::new(move |n: usize| g.clients(n)) as Arc<dyn Fn(usize) + Send + Sync>),
    };
    let started = match serve::start(&config, &sources, hooks).await {
        Ok(s) => s,
        Err(e) => {
            let hint = if e.0.contains("in use") {
                format!(
                    " (port {} is in use; pick another with --port)",
                    config.port
                )
            } else {
                String::new()
            };
            tracing::error!(error = %e, "cannot start{hint}");
            eprintln!("leaf: cannot start: {e}{hint}");
            return 1;
        }
    };
    let root = config
        .target
        .canonicalize()
        .unwrap_or_else(|_| config.target.clone());
    let instance = Instance {
        pid: std::process::id(),
        root: root.to_string_lossy().into_owned(),
        url: started.url.clone(),
        started_at: chrono::Utc::now().timestamp_millis() as u64,
    };
    if let Err(e) = write_instance(&config.config_dir, &instance) {
        tracing::warn!(error = %e, "could not register this instance");
    }
    // The URL is the command's output, not a log line: it shows at every log level.
    println!("{}", started.url);
    if let Ok(ready) = std::env::var(READY_FILE_ENV) {
        let _ = std::fs::write(ready, format!("{}\n", started.url));
    }
    if leaf_app::launch::opens_browser(config.command, config.open, sources.open) {
        open_browser(&started.url);
    }
    let reason = tokio::select! {
        _ = tokio::signal::ctrl_c() => "SIGINT",
        _ = async {
            let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("signal");
            term.recv().await
        } => "SIGTERM",
        _ = idle_rx.recv() => "idle",
    };
    tracing::info!(reason, "shutting down");
    if let Some(g) = &guard {
        g.stop();
    }
    remove_instance(&config.config_dir, std::process::id());
    started.stop().await;
    0
}

async fn run_command(config: Config, sources: Sources, argv: Vec<String>) -> i32 {
    // The command's stdout is the URL; its logs go to stderr.
    leaf_app::log::init_to(
        config.log_level,
        config.log_format,
        leaf_app::log::Stream::Stderr,
    );
    let target = config
        .target
        .canonicalize()
        .unwrap_or_else(|_| config.target.clone());
    let url = match find_running(&config.config_dir, &target).await {
        Some((inst, url)) => {
            tracing::info!(pid = inst.pid, "reusing the running server");
            url
        }
        None => {
            let idle =
                (sources.idle_timeout_ms == ConfigSource::Default).then_some(OPEN_IDLE_DEFAULT);
            let exe = match std::env::current_exe() {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("leaf: cannot find my own executable: {e}");
                    return 1;
                }
            };
            match launch_detached(
                &exe,
                &child_args(&argv, &target, idle),
                &config.config_dir,
                Duration::from_secs(15),
            )
            .await
            {
                Ok((url, pid)) => {
                    tracing::info!(pid, url = %url, "started");
                    url
                }
                Err(e) => {
                    eprintln!("leaf: {e}");
                    return 1;
                }
            }
        }
    };
    println!("{url}");
    if config.open {
        open_browser(&url);
    }
    0
}

/// `leaf open` without --browser: start the app detached (or hand the path to the
/// running one, which the single-instance plugin does inside the child) and return.
fn launch_app(config: &Config, argv: &[String]) -> i32 {
    use std::os::unix::process::CommandExt;
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("leaf: cannot find my own executable: {e}");
            return 1;
        }
    };
    let log = leaf_app::launch::log_file_for(&config.config_dir);
    let _ = std::fs::create_dir_all(log.parent().unwrap_or(&config.config_dir));
    leaf_app::launch::rotate_log(&log, leaf_app::launch::LOG_MAX_BYTES);
    let out = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log);
    let mut cmd = std::process::Command::new(exe);
    cmd.args(leaf_app::launch::app_args(argv, &config.target));
    cmd.stdin(std::process::Stdio::null()).process_group(0);
    if let Ok(f) = out
        && let Ok(f2) = f.try_clone()
    {
        cmd.stdout(f).stderr(f2);
    }
    match cmd.spawn() {
        Ok(_) => 0,
        Err(e) => {
            eprintln!("leaf: could not start the app: {e}");
            1
        }
    }
}

#[tokio::main]
async fn main() {
    let mut argv: Vec<String> = std::env::args().skip(1).collect();
    // Internal: this process is the app itself (spawned by `leaf open`).
    let as_app = argv.first().is_some_and(|a| a == "__app");
    if as_app {
        argv.remove(0);
    }
    // `leaf open --browser`: the browser path (a detached server and a tab).
    let browser = argv.iter().any(|a| a == "--browser");
    argv.retain(|a| a != "--browser");
    let env: HashMap<String, String> = std::env::vars().collect();
    let cwd = std::env::current_dir().unwrap_or_else(|_| "/".into());
    let (config, sources) = match load(&argv, &env, &cwd) {
        Ok(v) => v,
        Err(e) => {
            let text = e.to_string();
            if text.starts_with("unknown flag")
                || text.contains("needs a value")
                || text.starts_with("unexpected argument")
            {
                eprintln!("leaf: {text}\n\n{HELP_TEXT}");
            } else {
                eprintln!("leaf: {text}");
            }
            std::process::exit(2);
        }
    };
    use leaf_app::launch::{Route, route};
    let log_flag = sources.log_level == ConfigSource::Flag;
    let code = match route(config.command, as_app, browser, log_flag) {
        Route::Help => {
            print!("{HELP_TEXT}");
            0
        }
        Route::Version => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            0
        }
        Route::Share => {
            eprintln!("leaf share is not yet available");
            2
        }
        Route::Serve => run_server(config, sources).await,
        Route::AppForeground => {
            leaf_app::log::init(config.log_level, config.log_format);
            app::run(config)
        }
        Route::Browser => run_command(config, sources, argv).await,
        Route::LaunchApp => launch_app(&config, &argv),
    };
    std::process::exit(code);
}
