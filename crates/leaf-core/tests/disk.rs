use std::path::{Path, PathBuf};
use std::process::Command;

use leaf_core::disk::{DiskOptions, DiskSource};
use leaf_core::source::{Source, SourceError};
use leaf_protocol::{Encoding, EntryKind, ErrorCode};

struct Fx {
    _d: tempfile::TempDir,
    root: PathBuf,
}
fn fixture() -> Fx {
    let d = tempfile::tempdir().unwrap();
    let r = d.path().canonicalize().unwrap();
    std::fs::create_dir_all(r.join("docs")).unwrap();
    std::fs::create_dir_all(r.join("node_modules")).unwrap();
    std::fs::create_dir_all(r.join("build")).unwrap();
    std::fs::create_dir_all(r.join("sniff")).unwrap();
    std::fs::write(r.join("README.md"), "# readme\n").unwrap();
    std::fs::write(r.join("docs/guide.md"), "# guide\n").unwrap();
    std::fs::write(r.join("docs/img.png"), [0x89, 0x50, 0x4e, 0x47]).unwrap();
    std::fs::write(r.join("big.log"), vec![b'a'; 3 * 1024 * 1024]).unwrap();
    std::fs::write(r.join("node_modules/x.js"), "x").unwrap();
    std::fs::write(r.join(".gitignore"), "build/\n").unwrap();
    std::fs::write(r.join("build/notes.md"), "# notes\n").unwrap();
    std::fs::write(
        r.join("sniff/Gemfile"),
        "source 'https://rubygems.org'\ngem 'rails'\n",
    )
    .unwrap();
    std::fs::write(r.join("sniff/data.xyz"), [0x00, 0x01, 0x02, 0xff, 0x00]).unwrap();
    std::fs::write(r.join("sniff/plain.xyz"), "just text\n").unwrap();
    std::os::unix::fs::symlink(r.join("README.md"), r.join("sniff/LINK.md")).unwrap();
    std::os::unix::fs::symlink("/etc", r.join("sniff/escape")).unwrap();
    Fx { _d: d, root: r }
}
fn opts(target: &Path) -> DiskOptions {
    DiskOptions {
        target: target.to_path_buf(),
        ignore: vec![".git".into(), "node_modules".into(), ".DS_Store".into()],
        gitignore: true,
        max_entries: 5000,
        max_inline_bytes: 2_097_152,
    }
}
fn src(target: &Path) -> DiskSource {
    DiskSource::new(opts(target)).unwrap()
}
fn code(e: SourceError) -> ErrorCode {
    e.code
}

#[tokio::test]
async fn lists_one_level_dirs_first_ignoring() {
    let f = fixture();
    let s = src(&f.root);
    let entries = s.list("").await.unwrap();
    let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
    assert_eq!(
        paths,
        ["docs", "sniff", ".gitignore", "big.log", "README.md"]
    );
    assert_eq!(entries[0].kind, EntryKind::Dir);
    assert_eq!(entries[0].has_children, Some(true));
    assert_eq!(s.root().kind, EntryKind::Dir);
    assert_eq!(s.root().name, f.root.file_name().unwrap().to_str().unwrap());
    assert_eq!(s.capabilities().raw_urls, Some(true));
    let sub: Vec<String> = s
        .list("docs")
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.path)
        .collect();
    assert_eq!(sub, ["docs/guide.md", "docs/img.png"]);
}

#[tokio::test]
async fn reads_text_inline_small_binaries_as_base64_large_as_none() {
    let f = fixture();
    let s = src(&f.root);
    let md = s.read("docs/guide.md").await.unwrap();
    assert_eq!(
        (md.kind.as_str(), md.encoding, md.mime.as_str()),
        ("markdown", Encoding::Utf8, "text/markdown")
    );
    assert!(md.content.unwrap().starts_with('#'));
    let png = s.read("docs/img.png").await.unwrap();
    assert_eq!(png.encoding, Encoding::Base64);
    assert_eq!(png.mime, "image/png");
    assert_eq!(png.content.as_deref(), Some("iVBORw=="));
    let big = s.read("big.log").await.unwrap();
    assert_eq!(big.encoding, Encoding::None);
    assert!(big.content.is_none());
    assert!(big.size > 2_000_000);
}

#[tokio::test]
async fn errors() {
    let f = fixture();
    let s = src(&f.root);
    assert_eq!(
        code(s.read("nope.md").await.unwrap_err()),
        ErrorCode::NotFound
    );
    assert_eq!(
        code(s.read("../x").await.unwrap_err()),
        ErrorCode::OutsideRoot
    );
    assert_eq!(
        code(s.list("../x").await.unwrap_err()),
        ErrorCode::OutsideRoot
    );
    assert_eq!(
        code(s.read("docs").await.unwrap_err()),
        ErrorCode::Unsupported
    );
    assert_eq!(
        code(s.read("build/notes.md").await.unwrap_err()),
        ErrorCode::NotFound
    );
    assert_eq!(
        code(s.read("sniff/escape/passwd").await.unwrap_err()),
        ErrorCode::OutsideRoot
    );
}

#[tokio::test]
async fn single_file_target() {
    let f = fixture();
    let single = src(&f.root.join("build/notes.md"));
    assert_eq!(single.root().kind, EntryKind::File);
    assert_eq!(single.root().name, "notes.md");
    assert_eq!(
        single.read("notes.md").await.unwrap().encoding,
        Encoding::Utf8
    );
    let one = src(&f.root.join("README.md"));
    let paths: Vec<String> = one
        .list("")
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.path)
        .collect();
    assert_eq!(paths, ["README.md"]);
    assert_eq!(one.read("docs/guide.md").await.unwrap().kind, "markdown");
}

#[tokio::test]
async fn search_is_a_subsequence_match_and_capped() {
    let f = fixture();
    let s = src(&f.root);
    let hits: Vec<String> = s
        .search("gd", 10)
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.path)
        .collect();
    assert!(hits.contains(&"docs/guide.md".to_string()));
    assert_eq!(s.search("", 1).await.unwrap().len(), 1);
    let notes: Vec<String> = s
        .search("notes", 10)
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.path)
        .collect();
    assert!(!notes.contains(&"build/notes.md".to_string()));
}

#[tokio::test]
async fn sniffs_unknown_extensions() {
    let f = fixture();
    let s = src(&f.root);
    let g = s.read("sniff/Gemfile").await.unwrap();
    assert_eq!((g.kind.as_str(), g.encoding), ("text", Encoding::Utf8));
    let p = s.read("sniff/plain.xyz").await.unwrap();
    assert_eq!((p.kind.as_str(), p.encoding), ("text", Encoding::Utf8));
    let b = s.read("sniff/data.xyz").await.unwrap();
    assert_eq!((b.kind.as_str(), b.encoding), ("binary", Encoding::Base64));
}

#[tokio::test]
async fn symlinks_inside_are_followed_and_escapes_dropped() {
    let f = fixture();
    let s = src(&f.root);
    let names: Vec<String> = s
        .list("sniff")
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.name)
        .collect();
    assert!(names.contains(&"LINK.md".to_string()));
    assert!(!names.contains(&"escape".to_string()));
    assert_eq!(s.read("sniff/LINK.md").await.unwrap().kind, "markdown");
}

#[tokio::test]
async fn git_info_for_tracked_files_only() {
    let f = fixture();
    assert!(src(&f.root).read("README.md").await.unwrap().git.is_none());
    let repo = tempfile::tempdir().unwrap();
    let r = repo.path().canonicalize().unwrap();
    std::fs::write(r.join("doc.md"), "# doc\n").unwrap();
    std::fs::write(r.join("untracked.md"), "# u\n").unwrap();
    let git = |args: &[&str]| {
        let st = Command::new("git")
            .args(args)
            .current_dir(&r)
            .output()
            .unwrap();
        assert!(
            st.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&st.stderr)
        );
    };
    git(&["init", "-q"]);
    git(&[
        "-c",
        "user.name=Test",
        "-c",
        "user.email=t@example.com",
        "add",
        "doc.md",
    ]);
    git(&[
        "-c",
        "user.name=Test",
        "-c",
        "user.email=t@example.com",
        "commit",
        "-q",
        "-m",
        "docs: first",
    ]);
    let s = src(&r);
    let tracked = s.read("doc.md").await.unwrap();
    let info = tracked.git.expect("git info");
    assert_eq!(
        (info.author.as_str(), info.message.as_str()),
        ("Test", "docs: first")
    );
    assert_eq!(info.commit.len(), 40);
    assert!(info.date > 1_600_000_000_000, "date is unix milliseconds");
    assert!(info.repo_url.is_none());
    assert!(s.read("untracked.md").await.unwrap().git.is_none());
    git(&["remote", "add", "origin", "git@github.com:rob/leaf.git"]);
    let again = src(&r).read("doc.md").await.unwrap();
    assert_eq!(
        again.git.unwrap().repo_url.as_deref(),
        Some("https://github.com/rob/leaf")
    );
}

#[tokio::test]
async fn search_text_finds_lines_case_insensitively_and_skips_ignored_and_binary() {
    let f = fixture();
    std::fs::write(
        f.root.join("docs/setup.md"),
        "# Setup\n\nInstall the Guide first.\nnothing here\nthen GUIDE again\n",
    )
    .unwrap();
    std::fs::write(f.root.join("build/hidden.md"), "guide in ignored dir\n").unwrap();
    let s = src(&f.root);
    let hits = s.search_text("guide", 50).await.unwrap();
    let setup: Vec<_> = hits.iter().filter(|h| h.path == "docs/setup.md").collect();
    assert_eq!(setup.len(), 2);
    assert_eq!(
        (setup[0].line, setup[0].text.as_str()),
        (3, "Install the Guide first.")
    );
    assert_eq!(setup[1].line, 5);
    assert!(
        hits.iter()
            .any(|h| h.path == "docs/guide.md" && h.line == 1)
    );
    assert!(!hits.iter().any(|h| h.path.starts_with("build/")));
    assert!(
        !hits.iter().any(
            |h| h.path.ends_with(".png") || h.path.ends_with(".xyz") && h.path.contains("data")
        )
    );
    assert_eq!(s.search_text("guide", 1).await.unwrap().len(), 1);
    assert!(s.search_text("", 10).await.unwrap().is_empty());
}

#[tokio::test]
async fn read_reports_the_creation_time_where_the_filesystem_has_one() {
    let f = fixture();
    let s = src(&f.root);
    let d = s.read("README.md").await.unwrap();
    if cfg!(target_os = "macos") {
        let created = d.created.expect("APFS records birth times");
        assert!(created > 0.0 && created <= d.mtime + 1.0);
    }
}

#[tokio::test]
async fn blame_groups_lines_by_commit_and_marks_uncommitted_ones() {
    let repo = tempfile::tempdir().unwrap();
    let r = repo.path().canonicalize().unwrap();
    let git = |args: &[&str], who: &str| {
        let st = Command::new("git")
            .args([
                "-c",
                &format!("user.name={who}"),
                "-c",
                "user.email=t@example.com",
            ])
            .args(args)
            .current_dir(&r)
            .output()
            .unwrap();
        assert!(
            st.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&st.stderr)
        );
    };
    git(&["init", "-q"], "A");
    std::fs::write(r.join("doc.md"), "one\ntwo\nthree\n").unwrap();
    std::fs::write(r.join("untracked.md"), "u\n").unwrap();
    git(&["add", "doc.md"], "Ann");
    git(&["commit", "-q", "-m", "first"], "Ann");
    std::fs::write(r.join("doc.md"), "one\nTWO\nthree\nfour\n").unwrap();
    git(&["commit", "-q", "-am", "second"], "Bo");
    std::fs::write(r.join("doc.md"), "one\nTWO\nTHREE\nfour\n").unwrap();

    let s = src(&r);
    let blame = s
        .blame("doc.md")
        .await
        .unwrap()
        .expect("a tracked file has blame");
    let shape: Vec<(u32, u32, &str, &str, bool)> = blame
        .hunks
        .iter()
        .map(|h| {
            (
                h.start,
                h.lines,
                h.author.as_str(),
                h.summary.as_str(),
                h.uncommitted,
            )
        })
        .collect();
    assert_eq!(
        shape,
        vec![
            (1, 1, "Ann", "first", false),
            (2, 1, "Bo", "second", false),
            (3, 1, "", "", true),
            (4, 1, "Bo", "second", false),
        ]
    );
    assert_eq!(blame.hunks[0].commit.len(), 40);
    assert!(blame.hunks[0].date > 1_600_000_000_000, "unix milliseconds");
    assert_eq!(blame.hunks[1].commit, blame.hunks[3].commit);
    // Untracked files and folders outside git have none.
    assert!(s.blame("untracked.md").await.unwrap().is_none());
    assert!(
        src(&fixture().root)
            .blame("README.md")
            .await
            .unwrap()
            .is_none()
    );
    assert!(s.blame("../escape.md").await.is_err());
}
