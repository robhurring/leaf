use leaf_core::git::remote_to_web_url;

#[test]
fn remote_urls() {
    let cases = [
        (
            "git@github.com:rob/leaf.git",
            Some("https://github.com/rob/leaf"),
        ),
        (
            "https://github.com/rob/leaf.git",
            Some("https://github.com/rob/leaf"),
        ),
        (
            "ssh://git@gitlab.example.com:2222/team/leaf.git",
            Some("https://gitlab.example.com/team/leaf"),
        ),
        (
            "https://user:token@github.com/rob/leaf",
            Some("https://github.com/rob/leaf"),
        ),
        ("/local/path/repo.git", None),
        ("", None),
    ];
    for (remote, want) in cases {
        assert_eq!(remote_to_web_url(remote).as_deref(), want, "{remote}");
    }
}
