// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

use std::process::Command;

fn main() {
    // The release workflow builds an official version, and anything else came off a working tree, so
    // it is stamped with the commit it was built from and says so in the window.
    println!("cargo:rerun-if-env-changed=GITHUB_ACTIONS");
    println!("cargo:rerun-if-changed=../.git/HEAD");
    if std::env::var_os("GITHUB_ACTIONS").is_none()
        && let Some(commit) = Command::new("git")
            .args(["rev-parse", "--short", "HEAD"])
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        && !commit.is_empty()
    {
        println!("cargo:rustc-env=LITE_COMMIT={commit}");
        // Where it was built, so it can ask that tree whether it has moved on.
        if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR")
            && let Some(repo) = std::path::Path::new(&manifest).parent()
        {
            println!("cargo:rustc-env=LITE_REPO={}", repo.display());
        }
    }
    tauri_build::build()
}
