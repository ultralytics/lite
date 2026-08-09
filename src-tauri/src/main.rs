// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut arguments = std::env::args().skip(1);
    match arguments.next().as_deref() {
        Some("--claude-statusline") => {
            if let (Some(usage), Some(activity)) = (arguments.next(), arguments.next()) {
                let _ = lite_lib::capture_claude_status(&usage, &activity);
            }
            return;
        }
        Some("--claude-activity") => {
            if let Some(path) = arguments.next() {
                let _ = lite_lib::capture_claude_activity(&path);
            }
            return;
        }
        _ => {}
    }
    lite_lib::run()
}
