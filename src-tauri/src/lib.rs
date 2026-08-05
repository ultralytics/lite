// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

const MAX_FILE_BYTES: u64 = 500_000;

struct ProcessGuard(std::process::Child);

impl Drop for ProcessGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct PtySession {
    child: Box<dyn Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    run_id: String,
    pending_codex_root: Option<PathBuf>,
    codex_before: HashSet<String>,
    codex_input: Vec<char>,
    codex_cursor: usize,
    codex_escape: String,
    codex_bracketed_paste: bool,
    codex_candidates: Vec<String>,
    codex_discovery_started: bool,
}

fn stop_pty(session: &mut PtySession) -> Result<(), String> {
    if session
        .child
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_none()
    {
        session.child.kill().map_err(|error| error.to_string())?;
    }
    session.child.wait().map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Default)]
struct Sessions(Mutex<HashMap<String, PtySession>>);

#[derive(Default)]
struct Roots(Mutex<HashMap<String, PathBuf>>);

#[derive(Default)]
struct CodexReservations(Mutex<HashSet<PathBuf>>);

struct CodexReservation<'a> {
    reservations: &'a CodexReservations,
    root: PathBuf,
    keep: bool,
}

impl Drop for CodexReservation<'_> {
    fn drop(&mut self) {
        if !self.keep {
            if let Ok(mut roots) = self.reservations.0.lock() {
                roots.remove(&self.root);
            }
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyOutput {
    session_id: String,
    run_id: String,
    data: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExit {
    session_id: String,
    run_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderSession {
    session_id: String,
    run_id: String,
    provider_session_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryGrant {
    id: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    name: String,
    path: String,
    is_directory: bool,
    is_symlink: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitStatus {
    root: String,
    branch: String,
    worktree: String,
    changes: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    label: String,
    used_percent: f64,
    resets_at: Option<u64>,
    window_minutes: Option<u64>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    context_used_percent: Option<f64>,
    context_window: Option<u64>,
    context_tokens: Option<u64>,
    cost_usd: Option<f64>,
    lifetime_tokens: Option<u64>,
    windows: Vec<UsageWindow>,
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn root_path(roots: &Roots, root_id: &str) -> Result<PathBuf, String> {
    let roots = roots.0.lock().map_err(|error| error.to_string())?;
    let root = roots
        .get(root_id)
        .ok_or("Folder permission is no longer available")?;
    fs::canonicalize(root).map_err(|_| "The selected folder no longer exists".into())
}

fn scoped_path(root: &Path, path: &str) -> Result<PathBuf, String> {
    let path = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if path.starts_with(root) {
        Ok(path)
    } else {
        Err("Path is outside the selected folder".into())
    }
}

fn is_sensitive_path(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root).is_ok_and(|relative| {
        relative.components().any(|component| {
            let name = component.as_os_str().to_string_lossy().to_lowercase();
            name == ".env"
                || name.starts_with(".env.")
                || [
                    ".aws",
                    ".azure",
                    ".claude",
                    ".codex",
                    ".config",
                    ".docker",
                    ".git-credentials",
                    ".gnupg",
                    ".netrc",
                    ".npmrc",
                    ".pypirc",
                    ".ssh",
                    "id_ed25519",
                    "id_rsa",
                ]
                .contains(&name.as_str())
        })
    })
}

fn command_output(directory: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(directory)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
    }
}

fn roots_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("roots.json"))
}

fn load_roots(app: &AppHandle) -> Roots {
    let roots = roots_path(app)
        .ok()
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<HashMap<String, PathBuf>>(&bytes).ok())
        .unwrap_or_default();
    Roots(Mutex::new(roots))
}

fn save_roots(app: &AppHandle, roots: &Roots) -> Result<(), String> {
    let path = roots_path(app)?;
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    }
    let roots = roots.0.lock().map_err(|error| error.to_string())?;
    fs::write(
        path,
        serde_json::to_vec(&*roots).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

#[cfg(unix)]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(windows)]
fn shell_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

fn claude_settings(app: &AppHandle, session_id: &str) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let settings_path = directory.join(format!("claude-{session_id}.json"));
    let usage_path = directory.join(format!("usage-{session_id}.json"));
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let command = format!(
        "{} --claude-statusline {}",
        shell_quote(&path_text(&executable)),
        shell_quote(&path_text(&usage_path))
    );
    fs::write(
        &settings_path,
        serde_json::json!({ "statusLine": { "type": "command", "command": command } }).to_string(),
    )
    .map_err(|error| error.to_string())?;
    Ok(settings_path)
}

pub fn capture_claude_status(path: &str) -> Result<(), String> {
    let input: serde_json::Value =
        serde_json::from_reader(std::io::stdin()).map_err(|error| error.to_string())?;
    let context = input
        .get("context_window")
        .unwrap_or(&serde_json::Value::Null);
    let input_tokens = context
        .get("total_input_tokens")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let output_tokens = context
        .get("total_output_tokens")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let mut windows = Vec::new();
    for (key, label) in [("five_hour", "5 hour"), ("seven_day", "7 day")] {
        if let Some(window) = input.get("rate_limits").and_then(|limits| limits.get(key)) {
            if let Some(used_percent) = window
                .get("used_percentage")
                .and_then(serde_json::Value::as_f64)
            {
                windows.push(UsageWindow {
                    label: label.into(),
                    used_percent,
                    resets_at: window.get("resets_at").and_then(serde_json::Value::as_u64),
                    window_minutes: None,
                });
            }
        }
    }
    let snapshot = UsageSnapshot {
        context_used_percent: context
            .get("used_percentage")
            .and_then(serde_json::Value::as_f64),
        context_window: context
            .get("context_window_size")
            .and_then(serde_json::Value::as_u64),
        context_tokens: Some(input_tokens + output_tokens),
        cost_usd: input
            .pointer("/cost/total_cost_usd")
            .and_then(serde_json::Value::as_f64),
        lifetime_tokens: None,
        windows,
    };
    fs::write(
        path,
        serde_json::to_vec(&snapshot).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if let Some(percent) = snapshot.context_used_percent {
        println!("Lite · {percent:.0}% context");
    } else {
        println!("Lite");
    }
    Ok(())
}

#[tauri::command]
async fn choose_directory(
    app: AppHandle,
    roots: State<'_, Roots>,
) -> Result<Option<DirectoryGrant>, String> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("Choose a project")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let path = fs::canonicalize(path.into_path().map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    roots
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .insert(id.clone(), path.clone());
    save_roots(&app, &roots)?;
    Ok(Some(DirectoryGrant {
        id,
        path: path_text(&path),
    }))
}

#[tauri::command]
fn revoke_directory(app: AppHandle, roots: State<Roots>, root_id: String) -> Result<(), String> {
    roots
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&root_id);
    save_roots(&app, &roots)
}

fn codex_requests(
    requests: &[(u64, &str, serde_json::Value)],
) -> Result<HashMap<u64, serde_json::Value>, String> {
    let mut command = Command::new("codex");
    command.args(["app-server"]);
    if let Some(path) = user_path() {
        command.env("PATH", path);
    }
    let mut child = ProcessGuard(
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Could not start Codex app server: {error}"))?,
    );
    let mut stdin = child
        .0
        .stdin
        .take()
        .ok_or("Codex app server did not open stdin")?;
    let stdout = child
        .0
        .stdout
        .take()
        .ok_or("Codex app server did not open stdout")?;
    let (sender, receiver) = std::sync::mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(message) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            let Some(id) = message.get("id").and_then(serde_json::Value::as_u64) else {
                continue;
            };
            let response = if let Some(error) = message.get("error") {
                Err(error.to_string())
            } else {
                Ok(message.get("result").cloned().unwrap_or_default())
            };
            if sender.send((id, response)).is_err() {
                break;
            }
        }
    });

    writeln!(
        stdin,
        "{}",
        serde_json::json!({"method":"initialize","id":0,"params":{"clientInfo":{"name":"ultralytics_lite","title":"Lite","version":"0.1.0"}}})
    )
    .map_err(|error| error.to_string())?;
    stdin.flush().map_err(|error| error.to_string())?;
    loop {
        let (id, response) = receiver
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "Codex app server did not initialize")?;
        if id == 0 {
            response
                .map_err(|error| format!("Codex app server rejected initialization: {error}"))?;
            break;
        }
    }
    writeln!(
        stdin,
        "{}",
        serde_json::json!({"method":"initialized","params":{}})
    )
    .map_err(|error| error.to_string())?;
    for (id, method, params) in requests {
        writeln!(
            stdin,
            "{}",
            serde_json::json!({"method":method,"id":id,"params":params})
        )
        .map_err(|error| error.to_string())?;
    }
    stdin.flush().map_err(|error| error.to_string())?;

    let mut responses = HashMap::new();
    while responses.len() < requests.len() {
        let (id, result) = receiver
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "Codex app server did not return a response")?;
        if requests.iter().any(|request| request.0 == id) {
            responses.insert(
                id,
                result.map_err(|error| format!("Codex app server request failed: {error}"))?,
            );
        }
    }
    Ok(responses)
}

fn codex_usage() -> Result<UsageSnapshot, String> {
    let responses = codex_requests(&[
        (1, "account/rateLimits/read", serde_json::json!({})),
        (2, "account/usage/read", serde_json::json!({})),
    ])?;
    let rates = responses.get(&1);
    let summary = responses.get(&2);

    let mut windows = Vec::new();
    if let Some(buckets) = rates
        .and_then(|value| value.get("rateLimitsByLimitId"))
        .and_then(serde_json::Value::as_object)
    {
        for bucket in buckets.values() {
            let name = bucket
                .get("limitName")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("Codex");
            for (key, suffix) in [("primary", ""), ("secondary", " secondary")] {
                if let Some(window) = bucket.get(key).filter(|value| !value.is_null()) {
                    if let Some(used_percent) = window
                        .get("usedPercent")
                        .and_then(serde_json::Value::as_f64)
                    {
                        windows.push(UsageWindow {
                            label: format!("{name}{suffix}"),
                            used_percent,
                            resets_at: window.get("resetsAt").and_then(serde_json::Value::as_u64),
                            window_minutes: window
                                .get("windowDurationMins")
                                .and_then(serde_json::Value::as_u64),
                        });
                    }
                }
            }
        }
    } else if let Some(window) = rates.and_then(|value| value.pointer("/rateLimits/primary")) {
        if let Some(used_percent) = window
            .get("usedPercent")
            .and_then(serde_json::Value::as_f64)
        {
            windows.push(UsageWindow {
                label: "Codex".into(),
                used_percent,
                resets_at: window.get("resetsAt").and_then(serde_json::Value::as_u64),
                window_minutes: window
                    .get("windowDurationMins")
                    .and_then(serde_json::Value::as_u64),
            });
        }
    }
    Ok(UsageSnapshot {
        lifetime_tokens: summary
            .and_then(|value| value.pointer("/summary/lifetimeTokens"))
            .and_then(serde_json::Value::as_u64),
        windows,
        ..UsageSnapshot::default()
    })
}

fn codex_threads(cwd: &Path) -> Result<HashMap<String, String>, String> {
    let cwd = path_text(cwd);
    let responses = codex_requests(&[(
        3,
        "thread/list",
        serde_json::json!({"limit": 100, "sortKey": "created_at"}),
    )])?;
    Ok(responses
        .get(&3)
        .and_then(|response| response.get("data"))
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|thread| {
            thread.get("cwd").and_then(serde_json::Value::as_str) == Some(cwd.as_str())
        })
        .filter_map(|thread| {
            Some((
                thread.get("id")?.as_str()?.to_owned(),
                thread.get("preview")?.as_str()?.trim().to_owned(),
            ))
        })
        .collect())
}

fn release_codex_root(app: &AppHandle, root: Option<PathBuf>) {
    let Some(root) = root else {
        return;
    };
    if let Ok(mut roots) = app.state::<CodexReservations>().0.lock() {
        roots.remove(&root);
    }
}

fn discover_codex_session(
    app: AppHandle,
    session_id: String,
    run_id: String,
    cwd: PathBuf,
    before: HashSet<String>,
) {
    thread::spawn(move || {
        for delay in [500, 1_000, 2_000, 4_000] {
            thread::sleep(Duration::from_millis(delay));
            let candidates = app.state::<Sessions>().0.lock().ok().and_then(|sessions| {
                sessions
                    .get(&session_id)
                    .filter(|session| session.run_id == run_id)
                    .map(|session| session.codex_candidates.clone())
            });
            let Some(candidates) = candidates else {
                return;
            };
            let Ok(after) = codex_threads(&cwd) else {
                continue;
            };
            let mut matches = after
                .iter()
                .filter(|(id, preview)| !before.contains(*id) && candidates.contains(preview))
                .map(|(id, _)| id.clone());
            let Some(exact_id) = matches.next() else {
                continue;
            };
            if matches.next().is_some() {
                break;
            }
            let root = if let Ok(mut sessions) = app.state::<Sessions>().0.lock() {
                let Some(session) = sessions.get_mut(&session_id) else {
                    return;
                };
                if session.run_id != run_id {
                    return;
                }
                session.pending_codex_root.take()
            } else {
                return;
            };
            release_codex_root(&app, root);
            let _ = app.emit(
                "provider-session",
                ProviderSession {
                    session_id,
                    run_id,
                    provider_session_id: exact_id,
                },
            );
            return;
        }
        if let Ok(mut sessions) = app.state::<Sessions>().0.lock() {
            if let Some(session) = sessions
                .get_mut(&session_id)
                .filter(|session| session.run_id == run_id)
            {
                session.codex_discovery_started = false;
            }
        }
    });
}

fn apply_codex_escape(session: &mut PtySession) {
    match session.codex_escape.as_str() {
        "\u{1b}[D" => session.codex_cursor = session.codex_cursor.saturating_sub(1),
        "\u{1b}[C" => {
            session.codex_cursor = (session.codex_cursor + 1).min(session.codex_input.len())
        }
        "\u{1b}[H" | "\u{1b}[1~" => session.codex_cursor = 0,
        "\u{1b}[F" | "\u{1b}[4~" => session.codex_cursor = session.codex_input.len(),
        "\u{1b}[3~" if session.codex_cursor < session.codex_input.len() => {
            session.codex_input.remove(session.codex_cursor);
        }
        "\u{1b}[200~" => session.codex_bracketed_paste = true,
        "\u{1b}[201~" => session.codex_bracketed_paste = false,
        _ => {}
    }
    session.codex_escape.clear();
}

fn capture_codex_input(session: &mut PtySession, data: &[u8]) {
    for character in String::from_utf8_lossy(data).chars() {
        if !session.codex_escape.is_empty() {
            session.codex_escape.push(character);
            let complete = character.is_ascii_alphabetic()
                || character == '~'
                || (session.codex_escape.len() == 2 && character != '[' && character != ']');
            if complete {
                apply_codex_escape(session);
            }
            continue;
        }
        match character {
            '\u{1b}' => session.codex_escape.push(character),
            '\r' | '\n' => {
                if session.codex_bracketed_paste {
                    session.codex_input.insert(session.codex_cursor, '\n');
                    session.codex_cursor += 1;
                    continue;
                }
                let prompt = session.codex_input.iter().collect::<String>();
                let prompt = prompt.trim();
                if !prompt.is_empty() && !session.codex_candidates.iter().any(|item| item == prompt)
                {
                    session.codex_candidates.push(prompt.to_owned());
                }
                session.codex_input.clear();
                session.codex_cursor = 0;
            }
            '\u{7f}' | '\u{8}' if session.codex_cursor > 0 => {
                session.codex_cursor -= 1;
                session.codex_input.remove(session.codex_cursor);
            }
            character if !character.is_control() => {
                session.codex_input.insert(session.codex_cursor, character);
                session.codex_cursor += 1;
            }
            _ => {}
        }
    }
}

#[cfg(unix)]
fn user_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    Command::new(shell)
        .args(["-lc", "printf %s \"$PATH\""])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(windows)]
fn user_path() -> Option<String> {
    std::env::var("PATH").ok()
}

fn agent_command(
    agent: &str,
    resume: bool,
    session_id: &str,
    provider_session_id: Option<&str>,
    name: &str,
) -> Result<CommandBuilder, String> {
    let mut command = match agent {
        "claude" => {
            let mut command = CommandBuilder::new("claude");
            if resume {
                command.args(["--resume", session_id]);
            } else {
                command.args(["--session-id", session_id, "--name", name]);
            }
            command
        }
        "codex" => {
            let mut command = CommandBuilder::new("codex");
            if let Some(provider_session_id) = provider_session_id {
                command.args(["resume", provider_session_id]);
            } else if resume {
                return Err("Codex session ID is unavailable".into());
            }
            command
        }
        "shell" => CommandBuilder::new_default_prog(),
        _ => return Err("Unknown session type".into()),
    };
    if let Some(path) = user_path() {
        command.env("PATH", path);
    }
    Ok(command)
}

#[tauri::command]
async fn spawn_session(
    app: AppHandle,
    sessions: State<'_, Sessions>,
    roots: State<'_, Roots>,
    codex_reservations: State<'_, CodexReservations>,
    session_id: String,
    run_id: String,
    root_id: String,
    provider_session_id: Option<String>,
    agent: String,
    name: String,
    resume: bool,
    cols: u16,
    rows: u16,
) -> Result<Option<String>, String> {
    let cwd = root_path(&roots, &root_id)?;
    {
        let mut running = sessions.0.lock().map_err(|error| error.to_string())?;
        if let Some(session) = running.get_mut(&session_id) {
            if session
                .child
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_none()
            {
                return Ok(provider_session_id);
            }
            running.remove(&session_id);
        }
    }

    if agent == "codex" && resume && provider_session_id.is_none() {
        return Err("This Codex tab has no exact session ID. Start a new session instead.".into());
    }
    let codex_new = agent == "codex" && provider_session_id.is_none();
    let mut reservation = if codex_new {
        let inserted = codex_reservations
            .0
            .lock()
            .map_err(|error| error.to_string())?
            .insert(cwd.clone());
        if !inserted {
            return Err("Send a first prompt in the other new Codex tab for this project before opening another.".into());
        }
        Some(CodexReservation {
            reservations: &codex_reservations,
            root: cwd.clone(),
            keep: false,
        })
    } else {
        None
    };
    let codex_before = if codex_new {
        codex_threads(&cwd)?.into_keys().collect()
    } else {
        HashSet::new()
    };

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;
    let mut command = agent_command(
        &agent,
        resume,
        &session_id,
        provider_session_id.as_deref(),
        &name,
    )?;
    if agent == "claude" {
        let settings = claude_settings(&app, &session_id)?;
        command.args(["--settings", &path_text(&settings)]);
    }
    command.cwd(&cwd);
    command.env("TERM", "xterm-256color");
    let child = pair.slave.spawn_command(command).map_err(|error| {
        if agent == "shell" {
            error.to_string()
        } else {
            format!("Could not start {agent}. Install its CLI and make sure it is available in your PATH. {error}")
        }
    })?;
    drop(pair.slave);
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    sessions
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .insert(
            session_id.clone(),
            PtySession {
                child,
                master: pair.master,
                writer,
                run_id: run_id.clone(),
                pending_codex_root: codex_new.then(|| cwd.clone()),
                codex_before,
                codex_input: Vec::new(),
                codex_cursor: 0,
                codex_escape: String::new(),
                codex_bracketed_paste: false,
                codex_candidates: Vec::new(),
                codex_discovery_started: false,
            },
        );
    if let Some(reservation) = reservation.as_mut() {
        reservation.keep = true;
    }

    let event_session_id = session_id.clone();
    let event_run_id = run_id.clone();
    let output_app = app.clone();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        while let Ok(count) = reader.read(&mut buffer) {
            if count == 0 {
                break;
            }
            if output_app
                .emit(
                    "pty-output",
                    PtyOutput {
                        session_id: event_session_id.clone(),
                        run_id: event_run_id.clone(),
                        data: buffer[..count].to_vec(),
                    },
                )
                .is_err()
            {
                break;
            }
        }
        let completed = output_app
            .state::<Sessions>()
            .0
            .lock()
            .ok()
            .and_then(|mut sessions| {
                if sessions
                    .get(&event_session_id)
                    .is_some_and(|session| session.run_id == event_run_id)
                {
                    sessions.remove(&event_session_id)
                } else {
                    None
                }
            });
        if let Some(mut session) = completed {
            let pending_root = session.pending_codex_root.take();
            let _ = stop_pty(&mut session);
            release_codex_root(&output_app, pending_root);
        }
        let _ = output_app.emit(
            "pty-exit",
            PtyExit {
                session_id: event_session_id,
                run_id: event_run_id,
            },
        );
    });

    Ok(provider_session_id)
}

#[tauri::command]
fn write_session(
    app: AppHandle,
    sessions: State<Sessions>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut sessions = sessions.0.lock().map_err(|error| error.to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or("Session is not running")?;
    session
        .writer
        .write_all(&data)
        .map_err(|error| error.to_string())?;
    session.writer.flush().map_err(|error| error.to_string())?;
    let mut discovery = None;
    if session.pending_codex_root.is_some() {
        capture_codex_input(session, &data);
        if !session.codex_discovery_started && !session.codex_candidates.is_empty() {
            let cwd = session.pending_codex_root.clone().expect("checked above");
            session.codex_discovery_started = true;
            discovery = Some((session.run_id.clone(), cwd, session.codex_before.clone()));
        }
    }
    drop(sessions);
    if let Some((run_id, cwd, before)) = discovery {
        discover_codex_session(app, session_id, run_id, cwd, before);
    }
    Ok(())
}

#[tauri::command]
fn resize_session(
    sessions: State<Sessions>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = sessions.0.lock().map_err(|error| error.to_string())?;
    let session = sessions.get(&session_id).ok_or("Session is not running")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn stop_session(
    app: AppHandle,
    sessions: State<Sessions>,
    session_id: String,
) -> Result<(), String> {
    if let Some(mut session) = sessions
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&session_id)
    {
        let pending_root = session.pending_codex_root.take();
        let result = stop_pty(&mut session);
        release_codex_root(&app, pending_root);
        result?;
    }
    Ok(())
}

#[tauri::command]
async fn list_directory(
    roots: State<'_, Roots>,
    root_id: String,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    let root = root_path(&roots, &root_id)?;
    let path = scoped_path(&root, &path)?;
    let mut entries = fs::read_dir(path)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == ".git"
                || name == "node_modules"
                || name == "target"
                || is_sensitive_path(&root, &entry.path())
            {
                return None;
            }
            Some(FileEntry {
                name,
                path: path_text(&entry.path()),
                is_directory: file_type.is_dir(),
                is_symlink: file_type.is_symlink(),
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
async fn read_text_file(
    roots: State<'_, Roots>,
    root_id: String,
    path: String,
) -> Result<String, String> {
    let root = root_path(&roots, &root_id)?;
    let path = scoped_path(&root, &path)?;
    if is_sensitive_path(&root, &path) {
        return Err("Sensitive files are hidden from preview".into());
    }
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err("File is larger than 500 KB".into());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    if bytes.contains(&0) {
        return Err("Binary files cannot be previewed".into());
    }
    String::from_utf8(bytes).map_err(|_| "File is not UTF-8 text".into())
}

#[tauri::command]
async fn git_status(roots: State<'_, Roots>, root_id: String) -> Result<Option<GitStatus>, String> {
    let path = root_path(&roots, &root_id)?;
    let root = match command_output(&path, &["rev-parse", "--show-toplevel"]) {
        Ok(root) => root,
        Err(_) => return Ok(None),
    };
    let branch = command_output(&path, &["branch", "--show-current"])?;
    let status = command_output(&path, &["status", "--short"])?;
    Ok(Some(GitStatus {
        root,
        branch: if branch.is_empty() {
            "Detached HEAD".into()
        } else {
            branch
        },
        worktree: path_text(&path),
        changes: status.lines().map(str::to_owned).collect(),
    }))
}

#[tauri::command]
async fn read_usage(
    app: AppHandle,
    agent: String,
    session_id: String,
) -> Result<Option<UsageSnapshot>, String> {
    match agent.as_str() {
        "claude" => {
            let path = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?
                .join(format!("usage-{session_id}.json"));
            match fs::read(path) {
                Ok(bytes) => serde_json::from_slice(&bytes)
                    .map(Some)
                    .map_err(|error| error.to_string()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(error) => Err(error.to_string()),
            }
        }
        "codex" => codex_usage().map(Some),
        "shell" => Ok(None),
        _ => Err("Unknown session type".into()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Sessions::default())
        .manage(CodexReservations::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(load_roots(app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            choose_directory,
            revoke_directory,
            spawn_session,
            write_session,
            resize_session,
            stop_session,
            list_directory,
            read_text_file,
            git_status,
            read_usage
        ])
        .build(tauri::generate_context!())
        .expect("error while building Lite")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                let sessions = app
                    .state::<Sessions>()
                    .0
                    .lock()
                    .map(|mut sessions| {
                        sessions
                            .drain()
                            .map(|(_, session)| session)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                for mut session in sessions {
                    let _ = stop_pty(&mut session);
                }
            }
        });
}
