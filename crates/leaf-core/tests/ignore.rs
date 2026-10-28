use leaf_core::ignore::Ignorer;

fn root() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(d.path().join("sub")).unwrap();
    std::fs::create_dir_all(d.path().join("dist")).unwrap();
    std::fs::write(d.path().join(".gitignore"), "dist/\n*.log\n").unwrap();
    std::fs::write(d.path().join("sub/.gitignore"), "secret.md\n").unwrap();
    d
}
fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

#[test]
fn always_patterns() {
    let d = root();
    let ig = Ignorer::new(d.path(), &s(&[".git", "node_modules"]), false);
    assert!(ig.ignores("node_modules", true));
    assert!(ig.ignores("node_modules/x/y.js", false));
    assert!(ig.ignores(".git", true));
    assert!(!ig.ignores("src", true));
}

#[test]
fn outside_the_root_is_ignored_never_an_error() {
    let d = root();
    let ig = Ignorer::new(d.path(), &s(&[".git"]), true);
    assert!(ig.ignores("..", true));
    assert!(ig.ignores("../sibling/x.md", false));
    assert!(ig.ignores("/etc/passwd", false));
}

#[test]
fn root_gitignore() {
    let d = root();
    let ig = Ignorer::new(d.path(), &s(&[]), true);
    assert!(ig.ignores("dist", true));
    assert!(ig.ignores("app.log", false));
    assert!(!ig.ignores("app.md", false));
}

#[test]
fn nested_gitignore_is_scoped() {
    let d = root();
    let ig = Ignorer::new(d.path(), &s(&[]), true);
    assert!(ig.ignores("sub/secret.md", false));
    assert!(!ig.ignores("secret.md", false));
}

#[test]
fn children_of_an_ignored_dir_are_ignored() {
    let d = root();
    assert!(Ignorer::new(d.path(), &s(&[]), true).ignores("dist/bundle.js", false));
}

#[test]
fn gitignore_off() {
    let d = root();
    assert!(!Ignorer::new(d.path(), &s(&[]), false).ignores("dist", true));
}
