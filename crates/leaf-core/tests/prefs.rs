use leaf_core::prefs::PreferencesStore;
use leaf_protocol::{Appearance, Preferences, Theme};

#[tokio::test]
async fn starts_empty_and_creates_the_directory_on_first_save() {
    let d = tempfile::tempdir().unwrap();
    let file = d.path().join("nested").join("preferences.json");
    let store = PreferencesStore::new(file.clone());
    assert_eq!(store.load().await, Preferences::default());
    store
        .save(Preferences {
            theme: Some(Theme::Paper),
            ..Default::default()
        })
        .await;
    let text = std::fs::read_to_string(&file).unwrap();
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v, serde_json::json!({ "theme": "paper" }));
}

#[tokio::test]
async fn merges_patches_and_drops_unknown_or_invalid_fields() {
    let d = tempfile::tempdir().unwrap();
    let file = d.path().join("p.json");
    std::fs::write(
        &file,
        r#"{"theme":"card","appearance":"light","bogus":1,"textPct":"big"}"#,
    )
    .unwrap();
    let store = PreferencesStore::new(file);
    assert_eq!(
        store.load().await,
        Preferences {
            theme: Some(Theme::Card),
            appearance: Some(Appearance::Light),
            ..Default::default()
        }
    );
    let after = store
        .save(Preferences {
            numbering: Some(true),
            ..Default::default()
        })
        .await;
    assert_eq!(
        after,
        Preferences {
            theme: Some(Theme::Card),
            appearance: Some(Appearance::Light),
            numbering: Some(true),
            ..Default::default()
        }
    );
    assert_eq!(store.load().await, after);
}

#[tokio::test]
async fn a_corrupt_file_reads_as_empty_and_is_replaced_on_save() {
    let d = tempfile::tempdir().unwrap();
    let file = d.path().join("p.json");
    std::fs::write(&file, "{not json").unwrap();
    let store = PreferencesStore::new(file.clone());
    assert_eq!(store.load().await, Preferences::default());
    store
        .save(Preferences {
            text_pct: Some(110),
            ..Default::default()
        })
        .await;
    assert_eq!(store.load().await.text_pct, Some(110));
    assert!(
        !d.path().read_dir().unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp"))
    );
}

#[tokio::test]
async fn out_of_range_text_size_is_dropped_on_load_and_on_save() {
    let d = tempfile::tempdir().unwrap();
    let file = d.path().join("p.json");
    std::fs::write(&file, r#"{"textPct":300,"theme":"card"}"#).unwrap();
    let store = PreferencesStore::new(file);
    assert_eq!(
        store.load().await,
        Preferences {
            theme: Some(Theme::Card),
            ..Default::default()
        }
    );
    let after = store
        .save(Preferences {
            text_pct: Some(10),
            numbering: Some(true),
            ..Default::default()
        })
        .await;
    assert_eq!(after.text_pct, None);
    assert_eq!(after.numbering, Some(true));
    assert_eq!(
        store
            .save(Preferences {
                text_pct: Some(120),
                ..Default::default()
            })
            .await
            .text_pct,
        Some(120)
    );
}

#[tokio::test]
async fn sidebar_widths_round_trip_and_out_of_range_is_dropped() {
    let d = tempfile::tempdir().unwrap();
    let store = PreferencesStore::new(d.path().join("p.json"));
    let after = store
        .save(Preferences {
            tree_width: Some(300),
            outline_width: Some(1000),
            ..Default::default()
        })
        .await;
    assert_eq!(after.tree_width, Some(300));
    assert_eq!(after.outline_width, None);
    assert_eq!(store.load().await.tree_width, Some(300));
}

#[tokio::test]
async fn link_kinds_are_kept_clean() {
    let d = tempfile::tempdir().unwrap();
    let store = PreferencesStore::new(d.path().join("preferences.json"));
    let saved = store
        .save(Preferences {
            link_schemes: Some(
                ["VSCode", "cursor", "cursor", "not a scheme", "zed://", ""]
                    .map(String::from)
                    .to_vec(),
            ),
            ..Default::default()
        })
        .await;
    assert_eq!(
        saved.link_schemes,
        Some(vec!["vscode".to_string(), "cursor".to_string()])
    );
}

#[tokio::test]
async fn link_kinds_and_window_settings_survive_a_reload() {
    use leaf_protocol::OpenIn;
    let d = tempfile::tempdir().unwrap();
    let store = PreferencesStore::new(d.path().join("preferences.json"));
    store
        .save(Preferences {
            link_schemes: Some(vec!["https".into(), "obsidian".into()]),
            open_in: Some(OpenIn::Tab),
            reopen_tabs: Some(true),
            ..Default::default()
        })
        .await;
    // Another setting saved later keeps them too.
    store
        .save(Preferences {
            text_pct: Some(110),
            ..Default::default()
        })
        .await;
    let loaded = store.load().await;
    assert_eq!(
        loaded.link_schemes,
        Some(vec!["https".to_string(), "obsidian".to_string()])
    );
    assert_eq!(loaded.open_in, Some(OpenIn::Tab));
    assert_eq!(loaded.reopen_tabs, Some(true));
    assert_eq!(loaded.text_pct, Some(110));
}
