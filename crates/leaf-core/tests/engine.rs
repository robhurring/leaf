use std::sync::Arc;

use leaf_core::engine::{Engine, EngineConfig};
use leaf_core::prefs::PreferencesStore;
use leaf_core::testing::FakeSource;
use leaf_core::watch::ChangeEvent;
use leaf_protocol::{Appearance, Change, ClientMessage, ErrorCode, Preferences, ServerMessage};

async fn engine() -> (Arc<Engine>, tempfile::TempDir) {
    let d = tempfile::tempdir().unwrap();
    let prefs = Arc::new(PreferencesStore::new(d.path().join("preferences.json")));
    prefs
        .save(Preferences {
            appearance: Some(Appearance::Light),
            ..Default::default()
        })
        .await;
    let source = Arc::new(FakeSource::new(&[
        ("README.md", "# hi"),
        ("docs/a.md", "# a"),
    ]));
    let config = EngineConfig {
        plantuml_url: Some("https://p.example".into()),
        mention_url: Some("https://x.com/{username}".into()),
        topic_url: None,
        max_entries: 10,
        raw_base: None,
    };
    (Engine::new(source, prefs, config), d)
}

fn hello(id: &str) -> ClientMessage {
    ClientMessage::Hello {
        protocol: 1,
        id: Some(id.into()),
    }
}

#[tokio::test]
async fn hello_then_welcome_with_config_capabilities_and_preferences() {
    let (e, _d) = engine().await;
    let s = e.connect();
    let out = e.handle(s, hello("1")).await;
    assert_eq!(out.len(), 1);
    match &out[0] {
        ServerMessage::Welcome {
            protocol,
            root,
            config,
            capabilities,
            participant,
            preferences,
            in_reply_to,
        } => {
            assert_eq!(*protocol, 1);
            assert_eq!(root.name, "fake");
            assert_eq!(config.plantuml_url.as_deref(), Some("https://p.example"));
            assert_eq!(config.max_entries, Some(10));
            assert!(capabilities.watch);
            assert_eq!(participant.id, "local");
            assert_eq!(
                preferences.as_ref().unwrap().appearance,
                Some(Appearance::Light)
            );
            assert_eq!(in_reply_to.as_deref(), Some("1"));
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(e.client_count(), 1);
    e.disconnect(s);
    assert_eq!(e.client_count(), 0);
}

#[tokio::test]
async fn anything_before_hello_is_refused_and_the_session_closed() {
    let (e, _d) = engine().await;
    let s = e.connect();
    let out = e
        .handle(
            s,
            ClientMessage::Read {
                path: "README.md".into(),
                id: Some("r".into()),
            },
        )
        .await;
    assert!(
        matches!(&out[0], ServerMessage::Error { code: ErrorCode::BadRequest, in_reply_to, .. } if in_reply_to.as_deref() == Some("r"))
    );
    assert!(e.is_closed(s));
    assert!(e.handle(s, hello("h")).await.is_empty());
    // Nothing was registered: a change does not reach it.
    let mut pushes = e.pushes();
    e.feed_change(ChangeEvent {
        path: "README.md".into(),
        change: Change::Modified,
        from: None,
    });
    assert!(pushes.try_recv().is_err());
}

#[tokio::test]
async fn list_read_search_and_errors_reply_in_kind() {
    let (e, _d) = engine().await;
    let s = e.connect();
    e.handle(s, hello("h")).await;
    let out = e
        .handle(
            s,
            ClientMessage::List {
                path: None,
                id: Some("l".into()),
            },
        )
        .await;
    match &out[0] {
        ServerMessage::Tree {
            path,
            entries,
            in_reply_to,
        } => {
            assert_eq!(path, "");
            assert_eq!(
                entries.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(),
                ["README.md", "docs"]
            );
            assert_eq!(in_reply_to.as_deref(), Some("l"));
        }
        other => panic!("{other:?}"),
    }
    let out = e
        .handle(
            s,
            ClientMessage::Read {
                path: "docs/a.md".into(),
                id: None,
            },
        )
        .await;
    match &out[0] {
        ServerMessage::File {
            path, url, content, ..
        } => {
            assert_eq!(path, "docs/a.md");
            assert_eq!(url, "/raw/docs/a.md");
            assert_eq!(content.as_deref(), Some("# a"));
        }
        other => panic!("{other:?}"),
    }
    let out = e
        .handle(
            s,
            ClientMessage::Read {
                path: "nope.md".into(),
                id: Some("r".into()),
            },
        )
        .await;
    assert!(
        matches!(&out[0], ServerMessage::Error { code: ErrorCode::NotFound, path: Some(p), in_reply_to: Some(id), .. } if p == "nope.md" && id == "r")
    );
    let out = e
        .handle(
            s,
            ClientMessage::Search {
                q: "READ".into(),
                limit: None,
                id: Some("s".into()),
            },
        )
        .await;
    assert!(
        matches!(&out[0], ServerMessage::Matches { q, in_reply_to: Some(id), .. } if q == "READ" && id == "s")
    );
}

#[tokio::test]
async fn search_limit_is_capped_by_max_entries() {
    let d = tempfile::tempdir().unwrap();
    let prefs = Arc::new(PreferencesStore::new(d.path().join("p.json")));
    let files: Vec<(String, String)> = (0..20)
        .map(|i| (format!("f{i}.md"), "#".to_string()))
        .collect();
    let refs: Vec<(&str, &str)> = files
        .iter()
        .map(|(a, b)| (a.as_str(), b.as_str()))
        .collect();
    let e = Engine::new(
        Arc::new(FakeSource::new(&refs)),
        prefs,
        EngineConfig {
            max_entries: 10,
            ..Default::default()
        },
    );
    let s = e.connect();
    e.handle(s, hello("h")).await;
    let out = e
        .handle(
            s,
            ClientMessage::Search {
                q: "f".into(),
                limit: Some(50),
                id: None,
            },
        )
        .await;
    assert!(matches!(&out[0], ServerMessage::Matches { entries, .. } if entries.len() == 10));
}

#[tokio::test]
async fn changes_fan_out_to_subscribers_only_including_the_old_name_of_a_rename() {
    let (e, _d) = engine().await;
    let a = e.connect();
    let b = e.connect();
    let c = e.connect();
    for s in [a, b, c] {
        e.handle(s, hello("h")).await;
    }
    assert!(
        e.handle(
            a,
            ClientMessage::Subscribe {
                path: "docs".into(),
                id: None
            }
        )
        .await
        .is_empty()
    );
    e.handle(
        b,
        ClientMessage::Subscribe {
            path: "".into(),
            id: None,
        },
    )
    .await;
    e.handle(
        c,
        ClientMessage::Subscribe {
            path: "other".into(),
            id: None,
        },
    )
    .await;
    let mut pushes = e.pushes();
    e.feed_change(ChangeEvent {
        path: "docs/a.md".into(),
        change: Change::Modified,
        from: None,
    });
    let mut got = Vec::new();
    while let Ok((s, m)) = pushes.try_recv() {
        got.push((s, m));
    }
    let who: Vec<_> = got.iter().map(|(s, _)| *s).collect();
    assert!(
        who.contains(&a) && who.contains(&b) && !who.contains(&c),
        "{who:?}"
    );
    assert!(got.iter().all(|(_, m)| matches!(m, ServerMessage::Changed { path, change: Change::Modified, .. } if path == "docs/a.md")));
    // A rename out of docs/ still reaches the docs subscriber through `from`.
    e.feed_change(ChangeEvent {
        path: "other/a.md".into(),
        change: Change::Renamed,
        from: Some("docs/a.md".into()),
    });
    let mut who = Vec::new();
    while let Ok((s, _)) = pushes.try_recv() {
        who.push(s);
    }
    assert!(
        who.contains(&a) && who.contains(&b) && who.contains(&c),
        "{who:?}"
    );
    e.handle(
        a,
        ClientMessage::Unsubscribe {
            path: "docs".into(),
            id: None,
        },
    )
    .await;
    e.feed_change(ChangeEvent {
        path: "docs/a.md".into(),
        change: Change::Deleted,
        from: None,
    });
    let mut who = Vec::new();
    while let Ok((s, _)) = pushes.try_recv() {
        who.push(s);
    }
    assert!(!who.contains(&a) && who.contains(&b), "{who:?}");
}

#[tokio::test]
async fn preferences_are_merged_into_the_store() {
    let (e, _d) = engine().await;
    let s = e.connect();
    e.handle(s, hello("h")).await;
    let out = e
        .handle(
            s,
            ClientMessage::Preferences {
                preferences: Preferences {
                    numbering: Some(true),
                    ..Default::default()
                },
                id: None,
            },
        )
        .await;
    assert!(out.is_empty());
    let welcome = e.handle(e.connect(), hello("2")).await;
    match &welcome[0] {
        ServerMessage::Welcome { preferences, .. } => {
            let p = preferences.as_ref().unwrap();
            assert_eq!(
                (p.appearance, p.numbering),
                (Some(Appearance::Light), Some(true))
            );
        }
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn hello_with_another_protocol_version_is_refused() {
    let (e, _d) = engine().await;
    let s = e.connect();
    let out = e
        .handle(
            s,
            ClientMessage::Hello {
                protocol: 2,
                id: Some("h".into()),
            },
        )
        .await;
    assert!(
        matches!(
            &out[0],
            ServerMessage::Error {
                code: ErrorCode::BadRequest,
                ..
            }
        ),
        "{out:?}"
    );
    assert!(e.is_closed(s));
}

#[tokio::test]
async fn search_text_replies_with_text_matches() {
    let (e, _d) = engine().await;
    let s = e.connect();
    e.handle(s, hello("h")).await;
    let out = e
        .handle(
            s,
            ClientMessage::SearchText {
                q: "hi".into(),
                limit: None,
                id: Some("t".into()),
            },
        )
        .await;
    assert!(matches!(
        &out[0],
        ServerMessage::TextMatches { q, hits, in_reply_to: Some(id) }
            if q == "hi" && id == "t" && hits.len() == 1 && hits[0].path == "README.md" && hits[0].line == 1
    ));
}

#[tokio::test]
async fn blame_replies_in_kind_and_empty_when_the_source_has_none() {
    let (e, _d) = engine().await;
    let s = e.connect();
    e.handle(s, hello("h")).await;
    let out = e
        .handle(
            s,
            ClientMessage::Blame {
                path: "README.md".into(),
                id: Some("b".into()),
            },
        )
        .await;
    assert!(matches!(
        &out[0],
        ServerMessage::BlameHunks { path, hunks, repo_url: None, in_reply_to: Some(id) }
            if path == "README.md" && hunks.is_empty() && id == "b"
    ));
}
