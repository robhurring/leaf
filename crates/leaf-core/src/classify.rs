//! Maps a path to a file kind (which viewer shows it), a highlighting language,
//! and a MIME type. Pure; no filesystem access. The table mirrors the one the
//! UI's viewers were built against.
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Classified {
    pub kind: &'static str,
    pub lang: Option<&'static str>,
    pub mime: String,
}

const IMAGE: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico",
];
const MEDIA: &[&str] = &["mp4", "webm", "mov", "mp3", "wav", "ogg", "m4a", "flac"];

/// extension → highlighting language for text files
const TEXT_LANG: &[(&str, &str)] = &[
    ("ts", "typescript"),
    ("tsx", "tsx"),
    ("js", "javascript"),
    ("mjs", "javascript"),
    ("cjs", "javascript"),
    ("jsx", "jsx"),
    ("json", "json"),
    ("yaml", "yaml"),
    ("yml", "yaml"),
    ("toml", "toml"),
    ("py", "python"),
    ("rb", "ruby"),
    ("go", "go"),
    ("rs", "rust"),
    ("sh", "bash"),
    ("bash", "bash"),
    ("zsh", "bash"),
    ("css", "css"),
    ("scss", "scss"),
    ("html", "html"),
    ("htm", "html"),
    ("txt", "text"),
    ("env", "dotenv"),
    ("sql", "sql"),
    ("c", "c"),
    ("h", "c"),
    ("cpp", "cpp"),
    ("hpp", "cpp"),
    ("java", "java"),
    ("kt", "kotlin"),
    ("swift", "swift"),
    ("lua", "lua"),
    ("ini", "ini"),
    ("cfg", "ini"),
    ("xml", "xml"),
    ("csv", "csv"),
    ("tsv", "tsv"),
    ("mmd", "mermaid"),
    ("mermaid", "mermaid"),
    ("puml", "plantuml"),
    ("plantuml", "plantuml"),
    ("geojson", "json"),
    ("topojson", "json"),
    ("ipynb", "json"),
    ("excalidraw", "json"),
    ("graphql", "graphql"),
    ("proto", "protobuf"),
    ("diff", "diff"),
    ("patch", "diff"),
    ("log", "log"),
];

/// extensionless file name → language
const NAME_LANG: &[(&str, &str)] = &[
    ("Dockerfile", "dockerfile"),
    ("Makefile", "makefile"),
    ("LICENSE", "text"),
    ("README", "text"),
    ("CHANGELOG", "text"),
    (".gitignore", "gitignore"),
    (".env", "dotenv"),
];

fn lookup(table: &[(&str, &'static str)], key: &str) -> Option<&'static str> {
    table.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}

/// True when the bytes look like text: valid UTF-8 with no NUL and little control noise.
pub fn looks_like_text(sample: &[u8]) -> bool {
    if sample.is_empty() {
        return true;
    }
    let mut suspicious = 0usize;
    for &b in sample {
        if b == 0 {
            return false;
        }
        if b < 0x20 && !matches!(b, 0x09 | 0x0a | 0x0d | 0x0c) {
            suspicious += 1;
        }
    }
    if suspicious as f64 / sample.len() as f64 > 0.05 {
        return false;
    }
    std::str::from_utf8(sample).is_ok()
}

pub fn classify(path: &Path) -> Classified {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let ext = name
        .rsplit_once('.')
        .filter(|(stem, _)| !stem.is_empty())
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    let mime_of = |fallback: &str| -> String {
        mime_guess::from_path(name)
            .first()
            .map(|m| m.essence_str().to_string())
            .unwrap_or_else(|| fallback.to_string())
    };

    if ext == "md" || ext == "markdown" {
        return Classified {
            kind: "markdown",
            lang: Some("markdown"),
            mime: "text/markdown".into(),
        };
    }
    if IMAGE.contains(&ext.as_str()) {
        return Classified {
            kind: "image",
            lang: None,
            mime: mime_of("application/octet-stream"),
        };
    }
    if MEDIA.contains(&ext.as_str()) {
        return Classified {
            kind: "media",
            lang: None,
            mime: mime_of("application/octet-stream"),
        };
    }
    if ext == "pdf" {
        return Classified {
            kind: "pdf",
            lang: None,
            mime: "application/pdf".into(),
        };
    }
    let lang = lookup(TEXT_LANG, &ext).or_else(|| lookup(NAME_LANG, name));
    match lang {
        Some(lang) => Classified {
            kind: "text",
            lang: Some(lang),
            mime: text_mime(mime_of),
        },
        None => Classified {
            kind: "binary",
            lang: None,
            mime: mime_of("application/octet-stream"),
        },
    }
}

/// Text files: the registry's type when it is textual, else `text/plain`.
fn text_mime(mime_of: impl Fn(&str) -> String) -> String {
    let m = mime_of("text/plain");
    if m.starts_with("text/")
        || m.ends_with("/json")
        || m.ends_with("+json")
        || m.ends_with("/xml")
        || m.ends_with("+xml")
        || m.contains("javascript")
        || m.contains("yaml")
        || m.contains("toml")
    {
        m
    } else {
        "text/plain".into()
    }
}
