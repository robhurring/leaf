use std::collections::HashMap;
use std::path::Path;

use leaf_core::config::{Command, ConfigSource, LogFormat, LogLevel, load, parse_duration};

fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}
fn args(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| s.to_string()).collect()
}
fn tmp() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(d.path().join("README.md"), "# hi\n").unwrap();
    d
}

#[test]
fn precedence_flag_env_dotenv_default() {
    let d = tmp();
    std::fs::write(d.path().join(".env"), "PORT=5000\nLOG_LEVEL=warn\n").unwrap();
    let (c, s) = load(&args(["open", "."].as_ref()), &env(&[]), d.path()).unwrap();
    assert_eq!((c.port, s.port), (5000, ConfigSource::Dotenv));
    let (c, s) = load(
        &args(&["open", "."]),
        &env(&[("PORT", "6000"), ("LOG_LEVEL", "debug")]),
        d.path(),
    )
    .unwrap();
    assert_eq!((c.port, s.port), (6000, ConfigSource::Env));
    assert_eq!(
        (c.log_level, s.log_level),
        (LogLevel::Debug, ConfigSource::Env)
    );
    let (c, s) = load(
        &args(&["open", ".", "--port", "7000"]),
        &env(&[("PORT", "6000")]),
        d.path(),
    )
    .unwrap();
    assert_eq!((c.port, s.port), (7000, ConfigSource::Flag));
}

#[test]
fn defaults() {
    let d = tmp();
    let (c, s) = load(
        &args(&["open", "."]),
        &env(&[("HOME", "/Users/x")]),
        d.path(),
    )
    .unwrap();
    assert_eq!(c.port, 4321);
    assert_eq!(s.port, ConfigSource::Default);
    assert_eq!(c.host, "127.0.0.1");
    assert_eq!(c.log_level, LogLevel::Warn);
    assert_eq!(c.log_format, LogFormat::Text);
    assert!(c.open);
    assert_eq!(c.ignore, vec![".git", "node_modules", ".DS_Store"]);
    assert!(c.gitignore);
    assert_eq!(c.max_entries, 5000);
    assert_eq!(c.max_inline_bytes, 2_097_152);
    assert_eq!(c.idle_timeout_ms, 0);
    assert_eq!(c.config_dir, Path::new("/Users/x/.config/leaf"));
    assert!(c.plantuml_url.is_none());
    assert_eq!(c.command, Command::Open);
    assert!(c.target.is_absolute());
    assert_eq!(c.target, d.path().canonicalize().unwrap());
}

#[test]
fn config_dir_from_xdg_or_override() {
    let d = tmp();
    let (c, _) = load(
        &args(&["open", "."]),
        &env(&[("HOME", "/h"), ("XDG_CONFIG_HOME", "/xdg")]),
        d.path(),
    )
    .unwrap();
    assert_eq!(c.config_dir, Path::new("/xdg/leaf"));
    let (c, _) = load(
        &args(&["open", "."]),
        &env(&[("HOME", "/h"), ("LEAF_CONFIG_DIR", "/custom")]),
        d.path(),
    )
    .unwrap();
    assert_eq!(c.config_dir, Path::new("/custom"));
    let (c, _) = load(
        &args(&["open", ".", "--config-dir", "/flag"]),
        &env(&[("HOME", "/h")]),
        d.path(),
    )
    .unwrap();
    assert_eq!(c.config_dir, Path::new("/flag"));
}

#[test]
fn durations() {
    assert_eq!(parse_duration("24h").unwrap(), 86_400_000);
    assert_eq!(parse_duration("90s").unwrap(), 90_000);
    assert_eq!(parse_duration("5m").unwrap(), 300_000);
    assert_eq!(parse_duration("250").unwrap(), 250);
    assert!(parse_duration("soon").is_err());
    let d = tmp();
    let (c, _) = load(
        &args(&["open", ".", "--idle-timeout", "2m"]),
        &env(&[]),
        d.path(),
    )
    .unwrap();
    assert_eq!(c.idle_timeout_ms, 120_000);
    let (c, _) = load(
        &args(&["open", "."]),
        &env(&[("LEAF_IDLE_TIMEOUT", "5m")]),
        d.path(),
    )
    .unwrap();
    assert_eq!(c.idle_timeout_ms, 300_000);
}

#[test]
fn commands_and_targets() {
    let d = tmp();
    let (c, _) = load(&args(&["serve", "."]), &env(&[]), d.path()).unwrap();
    assert_eq!(c.command, Command::Serve);
    let (c, _) = load(&args(&["README.md"]), &env(&[]), d.path()).unwrap();
    assert_eq!(c.command, Command::Open);
    assert_eq!(c.target, d.path().canonicalize().unwrap().join("README.md"));
    let (c, _) = load(&args(&["--help"]), &env(&[]), d.path()).unwrap();
    assert_eq!(c.command, Command::Help);
    let (c, _) = load(&args(&["--version"]), &env(&[]), d.path()).unwrap();
    assert_eq!(c.command, Command::Version);
    let (c, _) = load(
        &args(&[
            "serve",
            ".",
            "--log-format",
            "json",
            "--no-open",
            "--no-gitignore",
        ]),
        &env(&[]),
        d.path(),
    )
    .unwrap();
    assert_eq!(c.log_format, LogFormat::Json);
    assert!(!c.open && !c.gitignore);
}

#[test]
fn errors_name_the_variable_or_the_path() {
    let d = tmp();
    let err = load(&args(&["open", "."]), &env(&[("PORT", "abc")]), d.path()).unwrap_err();
    assert!(err.to_string().contains("PORT"), "{err}");
    let err = load(&args(&["open", "nope-such-dir"]), &env(&[]), d.path()).unwrap_err();
    assert!(
        err.to_string().contains("no such file or directory"),
        "{err}"
    );
    let err = load(&args(&["open", ".", "--bogus"]), &env(&[]), d.path()).unwrap_err();
    assert!(err.to_string().contains("--bogus"), "{err}");
}
