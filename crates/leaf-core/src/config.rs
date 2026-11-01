//! Configuration, 12-factor style: flags > environment > `.env` in the working
//! directory > defaults. Every value remembers where it came from, so callers
//! can tell an explicit `--port` from the default (the port fallback depends on it).
use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    Open,
    Serve,
    Share,
    /// `leaf relay start`: the sharing relay server.
    Relay,
    Help,
    Version,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogFormat {
    Text,
    Json,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConfigSource {
    Default,
    Dotenv,
    Env,
    Flag,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub command: Command,
    /// Absolute, existing (for open/serve/share).
    pub target: PathBuf,
    pub host: String,
    pub port: u16,
    pub log_level: LogLevel,
    pub log_format: LogFormat,
    pub plantuml_url: Option<String>,
    /// The relay that Share uses; no Share button when unset. No trailing `/`.
    pub relay_url: Option<String>,
    pub open: bool,
    pub ignore: Vec<String>,
    pub gitignore: bool,
    pub max_entries: usize,
    pub max_inline_bytes: u64,
    pub mention_url: Option<String>,
    pub topic_url: Option<String>,
    pub config_dir: PathBuf,
    /// 0 = never.
    pub idle_timeout_ms: u64,
}

/// Where each value came from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sources {
    pub host: ConfigSource,
    pub port: ConfigSource,
    pub log_level: ConfigSource,
    pub log_format: ConfigSource,
    pub plantuml_url: ConfigSource,
    pub relay_url: ConfigSource,
    pub open: ConfigSource,
    pub ignore: ConfigSource,
    pub gitignore: ConfigSource,
    pub max_entries: ConfigSource,
    pub max_inline_bytes: ConfigSource,
    pub mention_url: ConfigSource,
    pub topic_url: ConfigSource,
    pub config_dir: ConfigSource,
    pub idle_timeout_ms: ConfigSource,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError(pub String);
impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for ConfigError {}

/// (key, environment variable name) for every value that can come from the environment.
const KEYS: &[(&str, &str)] = &[
    ("host", "HOST"),
    ("port", "PORT"),
    ("log_level", "LOG_LEVEL"),
    ("log_format", "LOG_FORMAT"),
    ("plantuml_url", "PLANTUML_URL"),
    ("relay_url", "LEAF_RELAY_URL"),
    ("open", "LEAF_OPEN"),
    ("ignore", "LEAF_IGNORE"),
    ("gitignore", "LEAF_GITIGNORE"),
    ("max_entries", "LEAF_MAX_ENTRIES"),
    ("max_inline_bytes", "LEAF_MAX_INLINE_BYTES"),
    ("mention_url", "LEAF_MENTION_URL"),
    ("topic_url", "LEAF_TOPIC_URL"),
    ("config_dir", "LEAF_CONFIG_DIR"),
    ("idle_timeout_ms", "LEAF_IDLE_TIMEOUT"),
];

/// `$XDG_CONFIG_HOME/leaf`, else `~/.config/leaf`.
pub fn default_config_dir(env: &HashMap<String, String>) -> PathBuf {
    match env.get("XDG_CONFIG_HOME").filter(|v| !v.is_empty()) {
        Some(xdg) => Path::new(xdg).join("leaf"),
        None => {
            let home = env
                .get("HOME")
                .cloned()
                .or_else(|| std::env::var("HOME").ok())
                .unwrap_or_else(|| "/".into());
            Path::new(&home).join(".config").join("leaf")
        }
    }
}

/// Accepts `24h`, `90m`, `3600s`, or plain milliseconds.
pub fn parse_duration(raw: &str) -> Result<u64, ConfigError> {
    let raw = raw.trim();
    let (num, unit) = match raw.chars().last() {
        Some(c) if c.is_ascii_alphabetic() => (&raw[..raw.len() - 1], Some(c)),
        _ => (raw, None),
    };
    let n: u64 = num
        .parse()
        .map_err(|_| ConfigError(format!("not a duration: {raw} (use 250, 90s, 5m, 24h)")))?;
    Ok(match unit {
        None => n,
        Some('s') => n * 1000,
        Some('m') => n * 60_000,
        Some('h') => n * 3_600_000,
        Some(_) => {
            return Err(ConfigError(format!(
                "not a duration: {raw} (use 250, 90s, 5m, 24h)"
            )));
        }
    })
}

struct Parsed {
    command: Option<Command>,
    target: Option<String>,
    flags: Vec<(&'static str, String)>,
}

fn parse_args(argv: &[String]) -> Result<Parsed, ConfigError> {
    let mut p = Parsed {
        command: None,
        target: None,
        flags: Vec::new(),
    };
    let mut i = 0;
    let value = |i: &mut usize, flag: &str| -> Result<String, ConfigError> {
        *i += 1;
        argv.get(*i)
            .cloned()
            .ok_or_else(|| ConfigError(format!("{flag} needs a value")))
    };
    while i < argv.len() {
        let a = argv[i].as_str();
        match a {
            "-h" | "--help" => {
                p.command = Some(Command::Help);
                return Ok(p);
            }
            "-V" | "--version" => {
                p.command = Some(Command::Version);
                return Ok(p);
            }
            "--host" => p.flags.push(("host", value(&mut i, a)?)),
            "--port" => p.flags.push(("port", value(&mut i, a)?)),
            "-l" | "--log-level" => p.flags.push(("log_level", value(&mut i, a)?)),
            "--log-format" => p.flags.push(("log_format", value(&mut i, a)?)),
            "--plantuml-url" => p.flags.push(("plantuml_url", value(&mut i, a)?)),
            "--relay-url" => p.flags.push(("relay_url", value(&mut i, a)?)),
            "--open" => p.flags.push(("open", "true".into())),
            "--no-open" => p.flags.push(("open", "false".into())),
            "--ignore" => p.flags.push(("ignore", value(&mut i, a)?)),
            "--gitignore" => p.flags.push(("gitignore", "true".into())),
            "--no-gitignore" => p.flags.push(("gitignore", "false".into())),
            "--config-dir" => p.flags.push(("config_dir", value(&mut i, a)?)),
            "--idle-timeout" => p.flags.push(("idle_timeout_ms", value(&mut i, a)?)),
            _ if a.starts_with('-') => return Err(ConfigError(format!("unknown flag: {a}"))),
            "relay" if p.command.is_none() && p.target.is_none() => {
                if argv.get(i + 1).map(String::as_str) != Some("start") {
                    return Err(ConfigError("relay takes one subcommand: start".into()));
                }
                i += 1;
                p.command = Some(Command::Relay);
            }
            "open" | "serve" | "share" if p.command.is_none() && p.target.is_none() => {
                p.command = Some(match a {
                    "open" => Command::Open,
                    "serve" => Command::Serve,
                    _ => Command::Share,
                });
            }
            _ if p.target.is_none() => p.target = Some(a.to_string()),
            _ => return Err(ConfigError(format!("unexpected argument: {a}"))),
        }
        i += 1;
    }
    Ok(p)
}

fn parse_bool(v: &str) -> bool {
    !matches!(
        v.trim().to_ascii_lowercase().as_str(),
        "false" | "0" | "no" | "off" | ""
    )
}

fn parse_list(v: &str) -> Vec<String> {
    v.split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn optional(v: &str) -> Option<String> {
    if v.is_empty() {
        None
    } else {
        Some(v.to_string())
    }
}

/// Loads the configuration for one invocation. `env` is the process environment
/// (passed in, never read globally, so tests and the app stay deterministic).
pub fn load(
    argv: &[String],
    env: &HashMap<String, String>,
    cwd: &Path,
) -> Result<(Config, Sources), ConfigError> {
    let args = parse_args(argv)?;
    let command = args.command.unwrap_or(Command::Open);

    // Defaults.
    let mut raw: HashMap<&'static str, (String, ConfigSource)> = HashMap::new();
    let defaults: &[(&str, String)] = &[
        ("host", "127.0.0.1".into()),
        ("port", "4321".into()),
        ("log_level", "warn".into()),
        ("log_format", "text".into()),
        ("plantuml_url", String::new()),
        ("relay_url", String::new()),
        ("open", "true".into()),
        ("ignore", ".git,node_modules,.DS_Store".into()),
        ("gitignore", "true".into()),
        ("max_entries", "5000".into()),
        ("max_inline_bytes", "2097152".into()),
        ("mention_url", String::new()),
        ("topic_url", String::new()),
        (
            "config_dir",
            default_config_dir(env).to_string_lossy().into_owned(),
        ),
        ("idle_timeout_ms", "0".into()),
    ];
    for (k, v) in defaults {
        raw.insert(k, (v.clone(), ConfigSource::Default));
    }
    // .env in the working directory, then the environment.
    let dotenv: HashMap<String, String> = match dotenvy::from_path_iter(cwd.join(".env")) {
        Ok(iter) => iter.filter_map(Result::ok).collect(),
        Err(_) => HashMap::new(),
    };
    for (key, name) in KEYS {
        if let Some(v) = dotenv.get(*name) {
            raw.insert(key, (v.clone(), ConfigSource::Dotenv));
        }
        if let Some(v) = env.get(*name) {
            raw.insert(key, (v.clone(), ConfigSource::Env));
        }
    }
    for (key, v) in &args.flags {
        raw.insert(key, (v.clone(), ConfigSource::Flag));
    }

    let get = |k: &str| -> (String, ConfigSource) { raw[k].clone() };
    let name_of = |k: &str| -> String {
        KEYS.iter()
            .find(|(key, _)| *key == k)
            .map(|(_, n)| n.to_string())
            .unwrap_or_else(|| k.to_string())
    };
    let invalid = |k: &str, src: ConfigSource, msg: String| {
        ConfigError(format!(
            "invalid config for {} ({:?}): {}",
            name_of(k),
            src,
            msg
        ))
    };

    let (mut host, host_src) = get("host");
    // A relay is a server for others (Heroku sets only PORT): all interfaces unless told.
    if command == Command::Relay && host_src == ConfigSource::Default {
        host = "0.0.0.0".into();
    }
    let (port_raw, port_src) = get("port");
    let port: u16 = port_raw
        .trim()
        .parse()
        .map_err(|_| invalid("port", port_src, format!("not a port: {port_raw}")))?;
    let (level_raw, level_src) = get("log_level");
    let log_level = match level_raw.trim() {
        "error" => LogLevel::Error,
        "warn" => LogLevel::Warn,
        "info" => LogLevel::Info,
        "debug" => LogLevel::Debug,
        other => {
            return Err(invalid(
                "log_level",
                level_src,
                format!("expected error|warn|info|debug, got {other}"),
            ));
        }
    };
    let (format_raw, format_src) = get("log_format");
    let log_format = match format_raw.trim() {
        "text" => LogFormat::Text,
        "json" => LogFormat::Json,
        other => {
            return Err(invalid(
                "log_format",
                format_src,
                format!("expected text|json, got {other}"),
            ));
        }
    };
    let (plantuml, plantuml_src) = get("plantuml_url");
    let (relay, relay_src) = get("relay_url");
    let (open_raw, open_src) = get("open");
    let (ignore_raw, ignore_src) = get("ignore");
    let (gitignore_raw, gitignore_src) = get("gitignore");
    let (max_entries_raw, max_entries_src) = get("max_entries");
    let max_entries: usize = max_entries_raw
        .trim()
        .parse()
        .ok()
        .filter(|n| *n >= 1)
        .ok_or_else(|| {
            invalid(
                "max_entries",
                max_entries_src,
                format!("expected a positive integer, got {max_entries_raw}"),
            )
        })?;
    let (max_inline_raw, max_inline_src) = get("max_inline_bytes");
    let max_inline_bytes: u64 = max_inline_raw.trim().parse().map_err(|_| {
        invalid(
            "max_inline_bytes",
            max_inline_src,
            format!("expected an integer, got {max_inline_raw}"),
        )
    })?;
    let (mention, mention_src) = get("mention_url");
    let (topic, topic_src) = get("topic_url");
    let (config_dir_raw, config_dir_src) = get("config_dir");
    if config_dir_raw.trim().is_empty() {
        return Err(invalid(
            "config_dir",
            config_dir_src,
            "must not be empty".into(),
        ));
    }
    let (idle_raw, idle_src) = get("idle_timeout_ms");
    let idle_timeout_ms =
        parse_duration(&idle_raw).map_err(|e| invalid("idle_timeout_ms", idle_src, e.0))?;

    let target = match command {
        Command::Help | Command::Version | Command::Relay => cwd.to_path_buf(),
        _ => {
            let joined = cwd.join(args.target.as_deref().unwrap_or("."));
            joined.canonicalize().map_err(|_| {
                ConfigError(format!("no such file or directory: {}", joined.display()))
            })?
        }
    };

    Ok((
        Config {
            command,
            target,
            host,
            port,
            log_level,
            log_format,
            plantuml_url: optional(plantuml.trim()),
            relay_url: optional(relay.trim().trim_end_matches('/')),
            open: parse_bool(&open_raw),
            ignore: parse_list(&ignore_raw),
            gitignore: parse_bool(&gitignore_raw),
            max_entries,
            max_inline_bytes,
            mention_url: optional(mention.trim()),
            topic_url: optional(topic.trim()),
            config_dir: PathBuf::from(config_dir_raw.trim()),
            idle_timeout_ms,
        },
        Sources {
            host: host_src,
            port: port_src,
            log_level: level_src,
            log_format: format_src,
            plantuml_url: plantuml_src,
            relay_url: relay_src,
            open: open_src,
            ignore: ignore_src,
            gitignore: gitignore_src,
            max_entries: max_entries_src,
            max_inline_bytes: max_inline_src,
            mention_url: mention_src,
            topic_url: topic_src,
            config_dir: config_dir_src,
            idle_timeout_ms: idle_src,
        },
    ))
}
