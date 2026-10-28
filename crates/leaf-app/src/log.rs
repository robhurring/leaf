//! Logs: one event per line on stdout. Text for people (`[HH:MM:SS] LEVEL: msg {fields}`),
//! JSON for pipes (`{"time","level","msg",...fields}`).
use std::fmt;

use leaf_core::config::{LogFormat, LogLevel};
use tracing::{Event, Subscriber};
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields};
use tracing_subscriber::registry::LookupSpan;

struct Fields {
    message: String,
    rest: serde_json::Map<String, serde_json::Value>,
}

impl tracing::field::Visit for Fields {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn fmt::Debug) {
        let v = format!("{value:?}");
        if field.name() == "message" {
            self.message = v;
        } else {
            self.rest
                .insert(field.name().to_string(), serde_json::Value::String(v));
        }
    }
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_string();
        } else {
            self.rest.insert(
                field.name().to_string(),
                serde_json::Value::String(value.to_string()),
            );
        }
    }
    fn record_i64(&mut self, field: &tracing::field::Field, value: i64) {
        self.rest
            .insert(field.name().to_string(), serde_json::Value::from(value));
    }
    fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
        self.rest
            .insert(field.name().to_string(), serde_json::Value::from(value));
    }
    fn record_bool(&mut self, field: &tracing::field::Field, value: bool) {
        self.rest
            .insert(field.name().to_string(), serde_json::Value::from(value));
    }
}

struct LeafFormat {
    json: bool,
}

impl<S, N> FormatEvent<S, N> for LeafFormat
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        _ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> fmt::Result {
        let mut fields = Fields {
            message: String::new(),
            rest: serde_json::Map::new(),
        };
        event.record(&mut fields);
        let level = event.metadata().level().as_str().to_ascii_lowercase();
        if self.json {
            let mut obj = serde_json::Map::new();
            obj.insert(
                "time".into(),
                serde_json::Value::from(chrono::Utc::now().timestamp_millis()),
            );
            obj.insert("level".into(), serde_json::Value::String(level));
            obj.insert("msg".into(), serde_json::Value::String(fields.message));
            for (k, v) in fields.rest {
                obj.insert(k, v);
            }
            writeln!(writer, "{}", serde_json::Value::Object(obj))
        } else {
            let time = chrono::Local::now().format("%H:%M:%S");
            let extra = if fields.rest.is_empty() {
                String::new()
            } else {
                format!(" {}", serde_json::Value::Object(fields.rest))
            };
            writeln!(
                writer,
                "[{time}] {}: {}{extra}",
                level.to_ascii_uppercase(),
                fields.message
            )
        }
    }
}

/// Where the log stream goes: stdout for a server (12-factor), stderr for the command
/// whose stdout is its result (the URL).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Stream {
    Stdout,
    Stderr,
}

pub fn init(level: LogLevel, format: LogFormat) {
    init_to(level, format, Stream::Stdout);
}

pub fn init_to(level: LogLevel, format: LogFormat, stream: Stream) {
    let filter = match level {
        LogLevel::Error => tracing::level_filters::LevelFilter::ERROR,
        LogLevel::Warn => tracing::level_filters::LevelFilter::WARN,
        LogLevel::Info => tracing::level_filters::LevelFilter::INFO,
        LogLevel::Debug => tracing::level_filters::LevelFilter::DEBUG,
    };
    let json = format == LogFormat::Json;
    let _ = match stream {
        Stream::Stdout => tracing_subscriber::fmt()
            .with_max_level(filter)
            .with_writer(std::io::stdout)
            .event_format(LeafFormat { json })
            .try_init(),
        Stream::Stderr => tracing_subscriber::fmt()
            .with_max_level(filter)
            .with_writer(std::io::stderr)
            .event_format(LeafFormat { json })
            .try_init(),
    };
}
