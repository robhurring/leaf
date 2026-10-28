// The UI is embedded at compile time; say so plainly when it has not been built.
use std::path::Path;

fn main() {
    // Read at run time, not compile time, so a moved checkout never sees a stale path.
    let manifest = std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR");
    let dir = Path::new(&manifest).join("../../packages/ui/dist/app");
    if !dir.join("index.html").is_file() {
        panic!(
            "leaf-app: build the ui first (bin/build); missing {}",
            dir.display()
        );
    }
    println!("cargo:rerun-if-changed={}", dir.display());
    tauri_build::build();
}
