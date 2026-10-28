//! Which leaf servers are running, so `leaf <file>` can reuse one that already
//! serves that folder. One JSON file per instance under `<config dir>/instances`.
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub pid: u32,
    pub root: String,
    pub url: String,
    pub started_at: u64,
}

fn dir_of(config_dir: &Path) -> PathBuf {
    config_dir.join("instances")
}

pub fn write_instance(config_dir: &Path, instance: &Instance) -> std::io::Result<()> {
    let dir = dir_of(config_dir);
    std::fs::create_dir_all(&dir)?;
    let text = serde_json::to_string_pretty(instance).unwrap_or_default() + "\n";
    std::fs::write(dir.join(format!("{}.json", instance.pid)), text)
}

pub fn remove_instance(config_dir: &Path, pid: u32) {
    let _ = std::fs::remove_file(dir_of(config_dir).join(format!("{pid}.json")));
}

pub fn read_instances(config_dir: &Path) -> Vec<Instance> {
    let Ok(rd) = std::fs::read_dir(dir_of(config_dir)) else {
        return vec![];
    };
    rd.filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .filter_map(|text| serde_json::from_str::<Instance>(&text).ok())
        .collect()
}

/// The instance whose root contains `target` (deepest wins) and the path of `target` inside it.
pub fn find_serving<'a>(instances: &'a [Instance], target: &str) -> Option<(&'a Instance, String)> {
    let mut best: Option<(&Instance, String)> = None;
    for inst in instances {
        let root = inst.root.trim_end_matches('/');
        let path = if target == root {
            String::new()
        } else if let Some(rest) = target.strip_prefix(&format!("{root}/")) {
            rest.to_string()
        } else {
            continue;
        };
        if best
            .as_ref()
            .is_none_or(|(b, _)| root.len() > b.root.trim_end_matches('/').len())
        {
            best = Some((inst, path));
        }
    }
    best
}
