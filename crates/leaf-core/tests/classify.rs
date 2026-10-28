use std::path::Path;

use leaf_core::classify::{classify, looks_like_text};

#[test]
fn kinds_and_languages() {
    let cases: &[(&str, &str, Option<&str>)] = &[
        ("a.md", "markdown", Some("markdown")),
        ("x/b.PNG", "image", None),
        ("c.ts", "text", Some("typescript")),
        ("flow.mmd", "text", Some("mermaid")),
        ("Dockerfile", "text", Some("dockerfile")),
        ("blob.bin", "binary", None),
        ("clip.mp4", "media", None),
        ("paper.pdf", "pdf", None),
        ("sketch.excalidraw", "text", Some("json")),
        ("seq.puml", "text", Some("plantuml")),
        ("data.csv", "text", Some("csv")),
        (".gitignore", "text", Some("gitignore")),
    ];
    for (path, kind, lang) in cases {
        let c = classify(Path::new(path));
        assert_eq!(c.kind, *kind, "{path}");
        assert_eq!(c.lang, *lang, "{path}");
    }
}

#[test]
fn mime_types() {
    assert_eq!(classify(Path::new("logo.svg")).mime, "image/svg+xml");
    assert_eq!(classify(Path::new("notes.env")).mime, "text/plain");
    assert_eq!(classify(Path::new("a.md")).mime, "text/markdown");
    assert_eq!(classify(Path::new("paper.pdf")).mime, "application/pdf");
    assert_eq!(
        classify(Path::new("blob.bin")).mime,
        "application/octet-stream"
    );
    assert_eq!(classify(Path::new("x.png")).mime, "image/png");
}

#[test]
fn text_sniffing() {
    assert!(looks_like_text(
        b"source 'https://rubygems.org'\ngem 'rails'\n"
    ));
    assert!(looks_like_text(b""));
    assert!(!looks_like_text(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"));
    assert!(!looks_like_text(&[
        0xff, 0xfe, 0xfd, 0x01, 0x02, 0x03, 0x04, 0x05
    ]));
    assert!(looks_like_text("héllo wörld\n".as_bytes()));
}
