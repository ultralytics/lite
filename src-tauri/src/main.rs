// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut arguments = std::env::args().skip(1);
    if arguments.next().as_deref() == Some("--claude-statusline") {
        if let Some(path) = arguments.next() {
            let _ = lite_lib::capture_claude_status(&path);
        }
        return;
    }
    lite_lib::run()
}
