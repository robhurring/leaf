//! HTTP: `/healthz`, `/raw/<path>` (file bytes), and the embedded UI with an
//! SPA fallback. The Host header must name this machine (DNS rebinding guard).
use axum::body::Body;
use axum::extract::{Path, Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, Uri, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use leaf_core::classify::classify;
use leaf_protocol::ErrorCode;
use rust_embed::RustEmbed;

use crate::serve::AppState;

#[derive(RustEmbed)]
#[folder = "../../packages/ui/dist/app/"]
struct Assets;

const LOOPBACK: &[&str] = &["localhost", "127.0.0.1", "::1", "[::1]"];

fn host_name(host_header: &str) -> String {
    let name = if host_header.starts_with('[') {
        match host_header.find(']') {
            Some(i) => &host_header[..=i],
            None => host_header,
        }
    } else {
        host_header
            .rsplit_once(':')
            .map(|(h, p)| {
                if p.chars().all(|c| c.is_ascii_digit()) {
                    h
                } else {
                    host_header
                }
            })
            .unwrap_or(host_header)
    };
    name.to_ascii_lowercase()
}

/// Guards against DNS rebinding: the Host header must name this machine.
pub fn host_allowed(host_header: Option<&str>, extra: &[String]) -> bool {
    let Some(h) = host_header else { return false };
    let name = host_name(h);
    LOOPBACK.contains(&name.as_str())
        || extra.iter().any(|e| e.eq_ignore_ascii_case(&name))
        || name.ends_with(".localhost")
}

/// Browsers send Origin; it must be this machine. Non-browser clients (no Origin) are allowed.
pub fn origin_allowed(origin: Option<&str>, extra: &[String]) -> bool {
    let Some(o) = origin else { return true };
    let Some((_, rest)) = o.split_once("://") else {
        return false;
    };
    let host = rest.split('/').next().unwrap_or("");
    host_allowed(Some(host), extra)
}

pub async fn host_guard(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok());
    if !host_allowed(host, &state.allowed_hosts) {
        tracing::warn!(host = ?host, "request rejected: foreign host");
        return (StatusCode::FORBIDDEN, "forbidden host").into_response();
    }
    next.run(req).await
}

pub async fn healthz() -> &'static str {
    "ok"
}

/// Types that could run script if served same-origin get a sandbox.
pub(crate) fn scriptable(mime: &str) -> bool {
    matches!(
        mime,
        "text/html" | "application/xhtml+xml" | "image/svg+xml" | "text/xml" | "application/xml"
    )
}

fn plain(status: StatusCode, text: &'static str) -> Response {
    (status, [(header::CONTENT_TYPE, "text/plain")], text).into_response()
}

/// File bytes, streamed from disk exactly as stored (no decoding, no whole-file buffer).
pub async fn raw(State(state): State<AppState>, Path(path): Path<String>) -> Response {
    let abs = match state.engine.source().locate(&path).await {
        Ok(p) => p,
        Err(e) if e.code == ErrorCode::OutsideRoot => {
            return plain(StatusCode::FORBIDDEN, "forbidden");
        }
        Err(_) => return plain(StatusCode::NOT_FOUND, "not found"),
    };
    let Ok(file) = tokio::fs::File::open(&abs).await else {
        return plain(StatusCode::NOT_FOUND, "not found");
    };
    let len = file.metadata().await.map(|m| m.len()).unwrap_or(0);
    let mime = classify(std::path::Path::new(&path)).mime;
    let mut headers = HeaderMap::new();
    let content_type = if mime.starts_with("text/") {
        format!("{mime}; charset=utf-8")
    } else {
        mime.clone()
    };
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(len));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    if scriptable(&mime) {
        headers.insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static("sandbox"),
        );
    }
    (
        StatusCode::OK,
        headers,
        Body::from_stream(tokio_util::io::ReaderStream::new(file)),
    )
        .into_response()
}

/// The embedded UI: a real file when one exists, else index.html (the router owns the URL).
pub async fn static_file(uri: Uri) -> Response {
    embedded(uri.path())
}

/// The embedded UI under a path prefix (the relay's `/s/<id>`): the prefix is stripped
/// before the lookup, so `/s/<id>/assets/x.js` is the asset and anything else is index.html.
pub async fn static_file_at(uri: Uri, strip: &str) -> Response {
    let path = uri.path();
    embedded(path.strip_prefix(strip).unwrap_or(path))
}

fn embedded(path: &str) -> Response {
    let path = path.trim_start_matches('/');
    let decoded = percent_decode(path);
    let safe = decoded.trim_start_matches("../");
    let (name, cache) = match Assets::get(safe) {
        Some(_) if !safe.is_empty() => (safe.to_string(), "public, max-age=31536000, immutable"),
        _ => ("index.html".to_string(), "no-cache"),
    };
    let Some(file) = Assets::get(&name) else {
        return plain(StatusCode::NOT_FOUND, "not found");
    };
    let mime = mime_guess::from_path(&name)
        .first_raw()
        .unwrap_or("application/octet-stream");
    let content_type = if mime.starts_with("text/") {
        format!("{mime}; charset=utf-8")
    } else {
        mime.to_string()
    };
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, cache.to_string()),
        ],
        Body::from(file.data.into_owned()),
    )
        .into_response()
}

pub(crate) fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let decoded = (bytes[i] == b'%')
            .then(|| hex(bytes.get(i + 1).copied()).zip(hex(bytes.get(i + 2).copied())))
            .flatten();
        match decoded {
            Some((h, l)) => {
                out.push(h * 16 + l);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(b: Option<u8>) -> Option<u8> {
    match b? {
        c @ b'0'..=b'9' => Some(c - b'0'),
        c @ b'a'..=b'f' => Some(c - b'a' + 10),
        c @ b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}
