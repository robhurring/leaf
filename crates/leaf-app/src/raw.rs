//! The app's `leaf-raw://` URLs: a window's file bytes, read from disk, as the server's
//! `/raw/<path>` serves them in a browser. Images and media of any size load this way,
//! not inside messages.

use std::path::Path;

use tokio::io::{AsyncReadExt, AsyncSeekExt};

/// The URL scheme the app registers.
pub const RAW_SCHEME: &str = "leaf-raw";

/// Where a window's files are: what the page puts before a file's path. Windows'
/// WebView2 reaches custom schemes over http; WebKit names them directly.
#[cfg(windows)]
pub const RAW_BASE: &str = "http://leaf-raw.localhost/";
#[cfg(not(windows))]
pub const RAW_BASE: &str = "leaf-raw://localhost/";

/// A reply to a `leaf-raw://` request.
#[derive(Debug)]
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
}

/// The file path in a request's URL path (`/pics/a%20b.png` → `pics/a b.png`).
pub fn path_of(url_path: &str) -> Option<String> {
    let path = crate::http::percent_decode(url_path.trim_start_matches('/'));
    (!path.is_empty()).then_some(path)
}

/// The inclusive byte range a `Range` header asks for in a file of `len` bytes; one
/// range only (what media elements send), clamped to the file.
pub fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    if spec.contains(',') || len == 0 {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    let (start, end) = match (start.trim(), end.trim()) {
        ("", n) => {
            let n: u64 = n.parse().ok()?;
            (len.saturating_sub(n), len - 1)
        }
        (s, "") => (s.parse().ok()?, len - 1),
        (s, e) => (s.parse().ok()?, e.parse::<u64>().ok()?.min(len - 1)),
    };
    (start <= end && start < len).then_some((start, end))
}

fn text(status: u16, body: &str) -> Reply {
    Reply {
        status,
        headers: vec![("Content-Type", "text/plain".into())],
        body: body.as_bytes().to_vec(),
    }
}

/// A file opened for a reply: the status and headers to send, and `file` positioned at
/// the first byte to send with `remaining` bytes to go. No file for a 404, 416 or 500.
pub struct Opened {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub file: Option<tokio::fs::File>,
    pub remaining: u64,
}

fn failed(status: u16) -> Opened {
    Opened {
        status,
        headers: vec![("Content-Type", "text/plain".into())],
        file: None,
        remaining: 0,
    }
}

/// Opens `abs` (the file at `path`) for the whole of it or the part `range` asks for.
pub async fn open(abs: &Path, path: &str, range: Option<&str>) -> Opened {
    let Ok(mut file) = tokio::fs::File::open(abs).await else {
        return failed(404);
    };
    let len = file.metadata().await.map(|m| m.len()).unwrap_or(0);
    let mime = leaf_core::classify::classify(Path::new(path)).mime;
    let mut headers = vec![
        ("Content-Type", mime.clone()),
        ("X-Content-Type-Options", "nosniff".into()),
        ("Cache-Control", "no-cache".into()),
        ("Accept-Ranges", "bytes".into()),
    ];
    if crate::http::scriptable(&mime) {
        headers.push(("Content-Security-Policy", "sandbox".into()));
    }
    let (status, start, end) = match range.map(|r| parse_range(r, len)) {
        Some(Some((s, e))) => {
            headers.push(("Content-Range", format!("bytes {s}-{e}/{len}")));
            (206, s, e)
        }
        Some(None) => {
            headers.push(("Content-Range", format!("bytes */{len}")));
            return Opened {
                status: 416,
                headers,
                file: None,
                remaining: 0,
            };
        }
        None => (200, 0, len.saturating_sub(1)),
    };
    if file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
        return failed(500);
    }
    Opened {
        status,
        headers,
        file: Some(file),
        remaining: if len == 0 { 0 } else { end - start + 1 },
    }
}

/// The bytes of `abs` (the file at `path`), or the part `range` asks for.
pub async fn respond(abs: &Path, path: &str, range: Option<&str>) -> Reply {
    let Opened {
        status,
        mut headers,
        file,
        remaining,
    } = open(abs, path, range).await;
    let Some(file) = file else {
        return match status {
            404 => text(404, "not found"),
            416 => Reply {
                status,
                headers,
                body: vec![],
            },
            _ => text(500, "could not read the file"),
        };
    };
    let mut body = Vec::with_capacity(remaining as usize);
    if file.take(remaining).read_to_end(&mut body).await.is_err() {
        return text(500, "could not read the file");
    }
    headers.push(("Content-Length", body.len().to_string()));
    Reply {
        status,
        headers,
        body,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_cover_what_media_asks_for() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=900-5000", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=5-2", 1000), None);
        assert_eq!(parse_range("lines=0-1", 1000), None);
        assert_eq!(parse_range("bytes=0-1,5-6", 1000), None);
    }

    #[tokio::test]
    async fn a_file_comes_whole_or_in_the_part_asked_for() {
        let dir = tempfile::tempdir().unwrap();
        let abs = dir.path().join("clip.mp4");
        std::fs::write(&abs, b"0123456789").unwrap();
        let whole = respond(&abs, "clip.mp4", None).await;
        assert_eq!(
            (whole.status, whole.body.as_slice()),
            (200, &b"0123456789"[..])
        );
        assert!(
            whole
                .headers
                .contains(&("Content-Type", "video/mp4".into()))
        );
        let part = respond(&abs, "clip.mp4", Some("bytes=2-4")).await;
        assert_eq!((part.status, part.body.as_slice()), (206, &b"234"[..]));
        assert!(
            part.headers
                .contains(&("Content-Range", "bytes 2-4/10".into()))
        );
        assert_eq!(
            respond(&abs, "clip.mp4", Some("bytes=20-")).await.status,
            416
        );
        assert_eq!(
            respond(&dir.path().join("gone"), "gone", None).await.status,
            404
        );
    }

    #[tokio::test]
    async fn open_positions_the_file_for_a_range() {
        let dir = tempfile::tempdir().unwrap();
        let abs = dir.path().join("clip.mp4");
        std::fs::write(&abs, b"0123456789").unwrap();
        let o = open(&abs, "clip.mp4", Some("bytes=2-4")).await;
        assert_eq!((o.status, o.remaining), (206, 3));
        let mut got = Vec::new();
        o.file
            .expect("an open file")
            .take(o.remaining)
            .read_to_end(&mut got)
            .await
            .unwrap();
        assert_eq!(got, b"234");
    }

    #[test]
    fn the_path_is_read_back_from_the_url() {
        assert_eq!(path_of("/pics/a%20b.png").as_deref(), Some("pics/a b.png"));
        assert_eq!(path_of("/pics%2Fa.png").as_deref(), Some("pics/a.png"));
        assert_eq!(path_of("/").as_deref(), None);
    }
}
