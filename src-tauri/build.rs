// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    Command::new("git")
        .args(args)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn main() {
    println!("cargo:rerun-if-env-changed=GITHUB_ACTIONS");
    println!("cargo:rerun-if-changed=../.git/HEAD");
    // When the build was made, which for a release the workflow builds is the day it was published.
    if let Some(date) = git(&["log", "-1", "--format=%cs"]) {
        println!("cargo:rustc-env=LITE_DATE={date}");
    }
    // A release is what the workflow builds, and anything else came off a working tree, so it carries
    // the commit it was built from and the tree it can ask whether that tree has moved on.
    if std::env::var_os("GITHUB_ACTIONS").is_none()
        && let Some(commit) = git(&["rev-parse", "--short", "HEAD"])
    {
        println!("cargo:rustc-env=LITE_COMMIT={commit}");
        if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR")
            && let Some(repo) = std::path::Path::new(&manifest).parent()
        {
            println!("cargo:rustc-env=LITE_REPO={}", repo.display());
        }
    }
    tauri_build::build()
}
