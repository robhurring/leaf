//! gitignore-aware ignore rules. `always` patterns apply everywhere; each
//! directory's `.gitignore` is read lazily, cached, and scoped to that directory.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use ignore::gitignore::{Gitignore, GitignoreBuilder};

pub struct Ignorer {
    root: PathBuf,
    always: Gitignore,
    use_gitignore: bool,
    cache: Mutex<HashMap<String, Option<Gitignore>>>,
}

impl Ignorer {
    pub fn new(root: &Path, always: &[String], use_gitignore: bool) -> Ignorer {
        let mut b = GitignoreBuilder::new(root);
        for p in always {
            // A bad pattern is a configuration mistake, not a crash: skip it.
            let _ = b.add_line(None, p);
        }
        Ignorer {
            root: root.to_path_buf(),
            always: b.build().unwrap_or_else(|_| Gitignore::empty()),
            use_gitignore,
            cache: Mutex::new(HashMap::new()),
        }
    }

    fn rules_for(&self, dir: &str) -> Option<Gitignore> {
        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(hit) = cache.get(dir) {
            return hit.clone();
        }
        let file = self.root.join(dir).join(".gitignore");
        let rules = if file.is_file() {
            let (gi, _err) = Gitignore::new(&file);
            Some(gi)
        } else {
            None
        };
        cache.insert(dir.to_string(), rules.clone());
        rules
    }

    /// True when `rel` (a protocol path) should be hidden. Paths outside the root are
    /// always ignored and never an error: the watcher can ask about the parent.
    pub fn ignores(&self, rel: &str, is_dir: bool) -> bool {
        if rel.is_empty() {
            return false;
        }
        if rel == ".." || rel.starts_with("../") || rel.starts_with('/') {
            return true;
        }
        if self
            .always
            .matched_path_or_any_parents(rel, is_dir)
            .is_ignore()
        {
            return true;
        }
        if !self.use_gitignore {
            return false;
        }
        // Walk from the root to the entry's parent; each .gitignore sees the path relative to its dir.
        let segments: Vec<&str> = rel.split('/').collect();
        for depth in 0..segments.len() {
            let dir = segments[..depth].join("/");
            let Some(rules) = self.rules_for(&dir) else {
                continue;
            };
            let inside = segments[depth..].join("/");
            if rules
                .matched_path_or_any_parents(&inside, is_dir)
                .is_ignore()
            {
                return true;
            }
        }
        false
    }
}
