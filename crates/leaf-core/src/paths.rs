//! Path confinement. Every path the protocol sees is relative to the root with
//! `/` separators; nothing outside the root is ever resolved, symlinks included.
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Confinement {
    /// `..`, an absolute path, or a symlink that leaves the root.
    Outside,
    /// Not a path at all (a NUL byte, for example).
    Invalid,
}

/// The parent of a protocol path (`a/b/c.md` → `a/b`, `c.md` → ``).
pub fn parent_of(path: &str) -> &str {
    match path.rfind('/') {
        Some(i) => &path[..i],
        None => "",
    }
}

/// Nearest ancestor of `abs` that exists, resolved through symlinks, plus the rest.
fn real_existing_ancestor(abs: &Path) -> Option<(PathBuf, PathBuf)> {
    let mut current = abs.to_path_buf();
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if let Ok(real) = current.canonicalize() {
            let mut tail = PathBuf::new();
            for seg in rest.iter().rev() {
                tail.push(seg);
            }
            return Some((real, tail));
        }
        let name = current.file_name()?.to_os_string();
        rest.push(name);
        current = current.parent()?.to_path_buf();
    }
}

/// The absolute path for `rel` under `root`, or why it may not be resolved.
pub fn resolve_inside(root: &Path, rel: &str) -> Result<PathBuf, Confinement> {
    if rel.contains('\0') {
        return Err(Confinement::Invalid);
    }
    if rel.starts_with('/') || rel.starts_with('\\') {
        return Err(Confinement::Outside);
    }
    let mut abs = root.to_path_buf();
    for seg in rel.split('/') {
        match seg {
            "" | "." => continue,
            ".." => return Err(Confinement::Outside),
            s => abs.push(s),
        }
    }
    if abs.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(Confinement::Outside);
    }
    let root_real = root.canonicalize().map_err(|_| Confinement::Outside)?;
    let (real, rest) = real_existing_ancestor(&abs).ok_or(Confinement::Outside)?;
    let real_target = real.join(rest);
    if !real_target.starts_with(&root_real) {
        return Err(Confinement::Outside);
    }
    Ok(abs)
}
