use leaf_core::paths::{Confinement, parent_of, resolve_inside};

struct Fx {
    _base: tempfile::TempDir,
    root: std::path::PathBuf,
}
fn fx() -> Fx {
    let base = tempfile::tempdir().unwrap();
    let root = base.path().join("root");
    let outside = base.path().join("outside");
    std::fs::create_dir_all(root.join("docs")).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(root.join("docs/a.md"), "# a").unwrap();
    std::fs::write(outside.join("secret.txt"), "x").unwrap();
    std::os::unix::fs::symlink(&outside, root.join("esc")).unwrap();
    std::os::unix::fs::symlink(root.join("docs"), root.join("docs-link")).unwrap();
    Fx { _base: base, root }
}

#[test]
fn resolves_inside_including_missing_files_and_the_root() {
    let f = fx();
    assert_eq!(
        resolve_inside(&f.root, "docs/a.md").unwrap(),
        f.root.join("docs/a.md")
    );
    assert_eq!(
        resolve_inside(&f.root, "docs/new.md").unwrap(),
        f.root.join("docs/new.md")
    );
    assert_eq!(resolve_inside(&f.root, "").unwrap(), f.root);
    // A symlink that stays inside the root is fine.
    assert_eq!(
        resolve_inside(&f.root, "docs-link/a.md").unwrap(),
        f.root.join("docs-link/a.md")
    );
}

#[test]
fn rejects_escapes() {
    let f = fx();
    assert_eq!(
        resolve_inside(&f.root, "../etc/passwd").unwrap_err(),
        Confinement::Outside
    );
    assert_eq!(
        resolve_inside(&f.root, "/etc/passwd").unwrap_err(),
        Confinement::Outside
    );
    assert_eq!(
        resolve_inside(&f.root, "esc/secret.txt").unwrap_err(),
        Confinement::Outside
    );
    assert_eq!(
        resolve_inside(&f.root, "docs/../../x").unwrap_err(),
        Confinement::Outside
    );
    assert_eq!(
        resolve_inside(&f.root, "a\0b").unwrap_err(),
        Confinement::Invalid
    );
}

#[test]
fn parents() {
    assert_eq!(parent_of("a/b/c.md"), "a/b");
    assert_eq!(parent_of("c.md"), "");
    assert_eq!(parent_of(""), "");
}
