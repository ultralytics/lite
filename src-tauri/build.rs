// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

fn main() {
    // Whether the release workflow built this decides the local badge, so a change rebuilds.
    println!("cargo:rerun-if-env-changed=GITHUB_ACTIONS");
    tauri_build::build()
}
