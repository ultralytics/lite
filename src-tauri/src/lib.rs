// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
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
use tungstenite::Message;

const MAX_FILE_BYTES: u64 = 500_000;
const DIRECTORY_PAGE_SIZE: usize = 250;
const MAX_GIT_CHANGES: usize = 500;
const CODEX_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

struct PtySession {
    child: Box<dyn Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    run_id: String,
}

fn stop_pty(session: &mut PtySession) -> Result<(), String> {
    let running = session
        .child
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_none();
    let kill_error = running
        .then(|| session.child.kill().err().map(|error| error.to_string()))
        .flatten();
    match session.child.wait() {
        Ok(_) => Ok(()),
        Err(error) => Err(kill_error.unwrap_or_else(|| error.to_string())),
    }
}

#[derive(Default)]
struct Sessions(Mutex<HashMap<String, PtySession>>);

#[derive(Default)]
struct Roots(Mutex<HashMap<String, PathBuf>>);

#[derive(Default)]
struct ProviderSessions(Mutex<HashMap<String, String>>);

struct CodexServer(Mutex<CodexServerState>);

struct CodexServerState {
    child: Option<std::process::Child>,
    endpoint: String,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryGrant {
    id: String,
    path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    name: String,
    path: String,
    is_directory: bool,
    is_symlink: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryCursor {
    name: String,
    path: String,
    is_directory: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryListing {
    entries: Vec<FileEntry>,
    next_cursor: Option<DirectoryCursor>,
}

fn directory_key(name: &str, path: &str, is_directory: bool) -> (u8, String, String) {
    (
        u8::from(!is_directory),
        name.to_lowercase(),
        path.to_owned(),
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitStatus {
    branch: String,
    worktree: String,
    changes: Vec<String>,
    changes_truncated: bool,
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
    let path = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(path) = path.strip_prefix("\\\\?\\UNC\\") {
            return format!("\\\\{path}");
        }
        if let Some(path) = path.strip_prefix("\\\\?\\") {
            return path.to_owned();
        }
    }
    path.into_owned()
}

fn root_path(roots: &Roots, root_id: &str) -> Result<PathBuf, String> {
    let roots = roots.0.lock().map_err(|error| error.to_string())?;
    let root = roots
        .get(root_id)
        .ok_or("Folder permission is no longer available")?;
    let root =
        fs::canonicalize(root).map_err(|_| "The selected folder no longer exists".to_owned())?;
    if is_sensitive_root(&root) {
        Err("Credential and configuration folders cannot be opened".into())
    } else {
        Ok(root)
    }
}

fn scoped_path(root: &Path, path: &str) -> Result<PathBuf, String> {
    let path = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if path.starts_with(root) {
        Ok(path)
    } else {
        Err("Path is outside the selected folder".into())
    }
}

fn is_sensitive_component(component: &std::ffi::OsStr) -> bool {
    let name = component.to_string_lossy().to_lowercase();
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
}

fn is_sensitive_root(path: &Path) -> bool {
    path.components()
        .any(|component| is_sensitive_component(component.as_os_str()))
}

fn is_sensitive_path(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root).is_ok_and(|relative| {
        relative
            .components()
            .any(|component| is_sensitive_component(component.as_os_str()))
    })
}

fn command_output(directory: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path_text(directory))
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

fn provider_sessions_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("provider-sessions"))
}

fn load_roots(app: &AppHandle) -> Roots {
    let roots = roots_path(app)
        .ok()
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<HashMap<String, PathBuf>>(&bytes).ok())
        .unwrap_or_default();
    Roots(Mutex::new(roots))
}

fn load_provider_sessions(app: &AppHandle) -> ProviderSessions {
    let mut sessions = HashMap::new();
    if let Ok(entries) = provider_sessions_path(app)
        .and_then(|path| fs::read_dir(path).map_err(|error| error.to_string()))
    {
        for entry in entries.flatten() {
            let Some(session_id) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if uuid::Uuid::parse_str(&session_id).is_err() {
                continue;
            }
            if let Ok(provider_session_id) = fs::read_to_string(entry.path()) {
                let provider_session_id = provider_session_id.trim();
                if uuid::Uuid::parse_str(provider_session_id).is_ok() {
                    sessions.insert(session_id, provider_session_id.to_owned());
                }
            }
        }
    }
    ProviderSessions(Mutex::new(sessions))
}

fn load_codex_server(app: &AppHandle) -> Result<CodexServer, String> {
    #[cfg(unix)]
    let endpoint = {
        let home = std::env::var_os("CODEX_HOME")
            .filter(|home| !home.is_empty())
            .map(PathBuf::from)
            .map(|home| home.canonicalize().map_err(|error| error.to_string()))
            .unwrap_or_else(|| {
                app.path()
                    .home_dir()
                    .map(|home| home.join(".codex"))
                    .map_err(|error| error.to_string())
            })?;
        format!(
            "unix://{}",
            path_text(&home.join("app-server-control/app-server-control.sock"))
        )
    };
    #[cfg(windows)]
    let endpoint = String::new();
    Ok(CodexServer(Mutex::new(CodexServerState {
        child: None,
        endpoint,
    })))
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

fn update_provider_session(
    app: &AppHandle,
    sessions: &ProviderSessions,
    session_id: &str,
    provider_session_id: Option<String>,
) -> Result<(), String> {
    uuid::Uuid::parse_str(session_id).map_err(|_| "Invalid session ID")?;
    let directory = provider_sessions_path(app)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(session_id);
    let mut sessions = sessions.0.lock().map_err(|error| error.to_string())?;
    if let Some(provider_session_id) = provider_session_id {
        if let Some(existing) = sessions.get(session_id) {
            if existing == &provider_session_id {
                return Ok(());
            }
        }
        let temporary = directory.join(format!(".{session_id}.tmp"));
        let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
        file.write_all(provider_session_id.as_bytes())
            .and_then(|()| file.sync_all())
            .map_err(|error| error.to_string())?;
        #[cfg(windows)]
        if path.exists() {
            fs::remove_file(&path).map_err(|error| error.to_string())?;
        }
        fs::rename(&temporary, &path).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        fs::File::open(&directory)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| error.to_string())?;
        sessions.insert(session_id.to_owned(), provider_session_id);
    } else {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        sessions.remove(session_id);
    }
    Ok(())
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
    if is_sensitive_root(&path) {
        return Err("Credential and configuration folders cannot be opened".into());
    }
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

fn codex_exchange<S: Read + Write, F: FnOnce(&S) -> Result<(), String>>(
    mut socket: tungstenite::WebSocket<S>,
    requests: &[(u64, &str, serde_json::Value)],
    clear_read_timeout: F,
) -> Result<HashMap<u64, serde_json::Value>, String> {
    socket
        .send(Message::Text(
            serde_json::json!({"method":"initialize","id":0,"params":{"clientInfo":{"name":"ultralytics_lite","title":"Lite","version":"0.1.0"}}})
                .to_string()
                .into(),
        ))
        .map_err(|error| error.to_string())?;
    loop {
        let message = socket.read().map_err(|error| error.to_string())?;
        let Ok(message) = message.to_text() else {
            continue;
        };
        let response: serde_json::Value =
            serde_json::from_str(message).map_err(|error| error.to_string())?;
        if response.get("id").and_then(serde_json::Value::as_u64) == Some(0) {
            if let Some(error) = response.get("error") {
                return Err(format!("Codex app server rejected initialization: {error}"));
            }
            break;
        }
    }
    clear_read_timeout(socket.get_ref())?;
    socket
        .send(Message::Text(
            serde_json::json!({"method":"initialized","params":{}})
                .to_string()
                .into(),
        ))
        .map_err(|error| error.to_string())?;
    for (id, method, params) in requests {
        socket
            .send(Message::Text(
                serde_json::json!({"method":method,"id":id,"params":params})
                    .to_string()
                    .into(),
            ))
            .map_err(|error| error.to_string())?;
    }

    let mut responses = HashMap::new();
    while responses.len() < requests.len() {
        let message = socket.read().map_err(|error| error.to_string())?;
        let Ok(message) = message.to_text() else {
            continue;
        };
        let message: serde_json::Value =
            serde_json::from_str(message).map_err(|error| error.to_string())?;
        let Some(id) = message.get("id").and_then(serde_json::Value::as_u64) else {
            continue;
        };
        if requests.iter().any(|request| request.0 == id) {
            if let Some(error) = message.get("error") {
                let missing_thread = requests.iter().find(|request| request.0 == id).is_some_and(
                    |(_, method, params)| {
                        let Some(thread_id) =
                            params.get("threadId").and_then(serde_json::Value::as_str)
                        else {
                            return false;
                        };
                        method == &"thread/read"
                            && error.get("code").and_then(serde_json::Value::as_i64) == Some(-32600)
                            && error.get("message").and_then(serde_json::Value::as_str)
                                == Some(&format!("thread not loaded: {thread_id}"))
                    },
                );
                if missing_thread {
                    responses.insert(id, serde_json::Value::Null);
                    continue;
                }
                return Err(format!("Codex app server request failed: {error}"));
            }
            responses.insert(id, message.get("result").cloned().unwrap_or_default());
        }
    }
    Ok(responses)
}

fn codex_requests_once(
    endpoint: &str,
    requests: &[(u64, &str, serde_json::Value)],
) -> Result<HashMap<u64, serde_json::Value>, String> {
    #[cfg(unix)]
    {
        let path = endpoint
            .strip_prefix("unix://")
            .ok_or("Invalid Codex endpoint")?;
        let stream =
            std::os::unix::net::UnixStream::connect(path).map_err(|error| error.to_string())?;
        stream
            .set_read_timeout(Some(CODEX_CONNECT_TIMEOUT))
            .map_err(|error| error.to_string())?;
        let (socket, _) =
            tungstenite::client("ws://localhost/", stream).map_err(|error| error.to_string())?;
        codex_exchange(socket, requests, |stream| {
            stream
                .set_read_timeout(None)
                .map_err(|error| error.to_string())
        })
    }
    #[cfg(windows)]
    {
        let (socket, _) = tungstenite::connect(endpoint).map_err(|error| error.to_string())?;
        codex_exchange(socket, requests, |_| Ok(()))
    }
}

fn ensure_codex_server(server: &CodexServer) -> Result<(), String> {
    let mut server = server.0.lock().map_err(|error| error.to_string())?;
    let endpoint = server.endpoint.clone();
    if let Some(child) = server.child.as_mut() {
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
            && codex_requests_once(&endpoint, &[]).is_ok()
        {
            return Ok(());
        }
        let _ = child.kill();
        let _ = child.wait();
        server.child = None;
    }
    if !server.endpoint.is_empty() && codex_requests_once(&server.endpoint, &[]).is_ok() {
        return Ok(());
    }

    #[cfg(windows)]
    {
        let mut login = Command::new("codex");
        login.args(["login", "status"]);
        if let Some(path) = user_path() {
            login.env("PATH", path);
        }
        if !login
            .status()
            .map_err(|error| format!("Could not check Codex login: {error}"))?
            .success()
        {
            return Err("Sign in once with `codex login`, then reopen this tab".into());
        }
        let listener =
            std::net::TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
        server.endpoint = format!(
            "ws://{}",
            listener.local_addr().map_err(|error| error.to_string())?
        );
        drop(listener);
    }
    let mut command = Command::new("codex");
    #[cfg(unix)]
    command.args(["app-server", "--listen", "unix://"]);
    #[cfg(windows)]
    command.args(["app-server", "--listen", &server.endpoint]);
    if let Some(path) = user_path() {
        command.env("PATH", path);
    }
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start Codex app server: {error}"))?;
    server.child = Some(child);
    for _ in 0..100 {
        let ready = codex_requests_once(&server.endpoint, &[]).is_ok();
        let exited = server
            .child
            .as_mut()
            .expect("stored above")
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some();
        if ready {
            if exited {
                server.child = None;
            }
            return Ok(());
        }
        if exited {
            server.child = None;
            return Err("Codex app server exited before it was ready".into());
        }
        thread::sleep(Duration::from_millis(50));
    }
    Err("Codex app server did not become ready".into())
}

fn codex_requests(
    server: &CodexServer,
    requests: &[(u64, &str, serde_json::Value)],
) -> Result<HashMap<u64, serde_json::Value>, String> {
    ensure_codex_server(server)?;
    let endpoint = server
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .endpoint
        .clone();
    codex_requests_once(&endpoint, requests)
}

fn codex_usage(server: &CodexServer) -> Result<UsageSnapshot, String> {
    let responses = codex_requests(
        server,
        &[
            (1, "account/rateLimits/read", serde_json::json!({})),
            (2, "account/usage/read", serde_json::json!({})),
        ],
    )?;
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

fn start_codex_thread(server: &CodexServer, cwd: &Path) -> Result<String, String> {
    let responses = codex_requests(
        server,
        &[(
            3,
            "thread/start",
            serde_json::json!({"cwd": path_text(cwd), "serviceName": "ultralytics_lite"}),
        )],
    )?;
    responses
        .get(&3)
        .and_then(|response| response.pointer("/thread/id"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or("Codex app server did not return a thread ID".into())
}

fn codex_thread_loaded(server: &CodexServer, thread_id: &str) -> Result<bool, String> {
    codex_requests(
        server,
        &[(
            4,
            "thread/read",
            serde_json::json!({"threadId": thread_id, "includeTurns": false}),
        )],
    )
    .map(|responses| {
        responses
            .get(&4)
            .is_some_and(|response| !response.is_null())
    })
}

fn archive_codex_thread(server: &CodexServer, thread_id: &str) -> Result<(), String> {
    codex_requests(
        server,
        &[(
            3,
            "thread/archive",
            serde_json::json!({"threadId": thread_id}),
        )],
    )
    .map(|_| ())
}

fn stop_codex_server(server: &CodexServer) {
    let Ok(mut server) = server.0.lock() else {
        return;
    };
    let Some(mut child) = server.child.take() else {
        return;
    };
    #[cfg(unix)]
    {
        for attempts in [500, 40] {
            let _ = Command::new("kill")
                .args(["-TERM", &child.id().to_string()])
                .status();
            for _ in 0..attempts {
                if child.try_wait().ok().flatten().is_some() {
                    return;
                }
                thread::sleep(Duration::from_millis(50));
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    }
    #[cfg(windows)]
    {
        let _ = child.kill();
        let _ = child.wait();
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
    codex_endpoint: Option<&str>,
    name: &str,
) -> Result<CommandBuilder, String> {
    #[cfg(unix)]
    let _ = codex_endpoint;
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
                #[cfg(unix)]
                command.args(["resume", provider_session_id]);
                #[cfg(windows)]
                command.args([
                    "--remote",
                    codex_endpoint.expect("Codex server is running"),
                    "resume",
                    provider_session_id,
                ]);
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
    provider_sessions: State<'_, ProviderSessions>,
    codex_server: State<'_, CodexServer>,
    session_id: String,
    run_id: String,
    root_id: String,
    mut provider_session_id: Option<String>,
    agent: String,
    name: String,
    resume: bool,
    cols: u16,
    rows: u16,
) -> Result<Option<String>, String> {
    let cwd = root_path(&roots, &root_id)?;
    if agent == "codex" {
        if let Some(saved_provider_session_id) = provider_sessions
            .0
            .lock()
            .map_err(|error| error.to_string())?
            .get(&session_id)
            .cloned()
        {
            provider_session_id = Some(saved_provider_session_id);
        }
    }
    let stale = {
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
            running.remove(&session_id)
        } else {
            None
        }
    };
    if let Some(mut session) = stale {
        stop_pty(&mut session)?;
    }

    if agent == "codex" && resume && provider_session_id.is_none() {
        return Err("This Codex tab has no exact session ID. Start a new session instead.".into());
    }
    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;
    let mut codex_created = agent == "codex" && provider_session_id.is_none();
    if codex_created {
        provider_session_id = Some(start_codex_thread(&codex_server, &cwd)?);
    } else if agent == "codex" {
        if !codex_thread_loaded(
            &codex_server,
            provider_session_id.as_deref().expect("restored above"),
        )? {
            provider_session_id = Some(start_codex_thread(&codex_server, &cwd)?);
            codex_created = true;
        }
    }
    if agent == "codex" {
        let provider_session_id = provider_session_id
            .as_ref()
            .expect("created or restored above");
        if let Err(error) = update_provider_session(
            &app,
            &provider_sessions,
            &session_id,
            Some(provider_session_id.clone()),
        ) {
            if codex_created {
                archive_codex_thread(&codex_server, provider_session_id).map_err(|cleanup| {
                    format!("{error}. Could not archive the new Codex thread: {cleanup}")
                })?;
            }
            return Err(error);
        }
    }
    let codex_endpoint = if agent == "codex" {
        Some(
            codex_server
                .0
                .lock()
                .map_err(|error| error.to_string())?
                .endpoint
                .clone(),
        )
    } else {
        None
    };
    let mut command = agent_command(
        &agent,
        resume,
        &session_id,
        provider_session_id.as_deref(),
        codex_endpoint.as_deref(),
        &name,
    )?;
    if agent == "claude" {
        let settings = claude_settings(&app, &session_id)?;
        command.args(["--settings", &path_text(&settings)]);
    }
    command.cwd(path_text(&cwd));
    command.env("TERM", "xterm-256color");
    let mut child = match pair.slave.spawn_command(command) {
        Ok(child) => child,
        Err(error) => {
            return Err(if agent == "shell" {
                error.to_string()
            } else {
                format!("Could not start {agent}. Install its CLI and make sure it is available in your PATH. {error}")
            });
        }
    };
    drop(pair.slave);
    let mut reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error.to_string());
        }
    };
    let writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error.to_string());
        }
    };
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
            },
        );

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
            let _ = stop_pty(&mut session);
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
    session.writer.flush().map_err(|error| error.to_string())
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
fn stop_session(sessions: State<Sessions>, session_id: String) -> Result<(), String> {
    if let Some(mut session) = sessions
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&session_id)
    {
        stop_pty(&mut session)?;
    }
    Ok(())
}

#[tauri::command]
fn delete_session_data(
    app: AppHandle,
    provider_sessions: State<ProviderSessions>,
    session_id: String,
) -> Result<(), String> {
    uuid::Uuid::parse_str(&session_id).map_err(|_| "Invalid session ID")?;
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    for name in [
        format!("claude-{session_id}.json"),
        format!("usage-{session_id}.json"),
    ] {
        match fs::remove_file(directory.join(name)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    update_provider_session(&app, &provider_sessions, &session_id, None)
}

#[tauri::command]
async fn list_directory(
    roots: State<'_, Roots>,
    root_id: String,
    path: String,
    after: Option<DirectoryCursor>,
) -> Result<DirectoryListing, String> {
    let root = root_path(&roots, &root_id)?;
    let path = scoped_path(&root, &path)?;
    let after = after.map(|cursor| directory_key(&cursor.name, &cursor.path, cursor.is_directory));
    let mut page = BTreeMap::new();
    let mut has_more = false;
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let Ok(entry) = entry else { continue };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".git"
            || name == "node_modules"
            || name == "target"
            || is_sensitive_path(&root, &entry.path())
        {
            continue;
        }
        let entry = FileEntry {
            name,
            path: path_text(&entry.path()),
            is_directory: file_type.is_dir(),
            is_symlink: file_type.is_symlink(),
        };
        let key = directory_key(&entry.name, &entry.path, entry.is_directory);
        if after.as_ref().is_some_and(|after| key <= *after) {
            continue;
        }
        page.insert(key, entry);
        if page.len() > DIRECTORY_PAGE_SIZE {
            page.pop_last();
            has_more = true;
        }
    }
    let entries = page.into_values().collect::<Vec<_>>();
    let next_cursor = has_more.then(|| {
        let entry = entries.last().expect("a truncated page is not empty");
        DirectoryCursor {
            name: entry.name.clone(),
            path: entry.path.clone(),
            is_directory: entry.is_directory,
        }
    });
    Ok(DirectoryListing {
        entries,
        next_cursor,
    })
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
    let mut child = Command::new("git")
        .arg("-C")
        .arg(path_text(&path))
        .args(["status", "--short"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| error.to_string())?;
    let stdout = child.stdout.take().ok_or("Could not read Git status")?;
    let mut changes = BufReader::new(stdout)
        .lines()
        .take(MAX_GIT_CHANGES + 1)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let changes_truncated = changes.len() > MAX_GIT_CHANGES;
    if changes_truncated {
        changes.truncate(MAX_GIT_CHANGES);
        let _ = child.kill();
    }
    let status = child.wait().map_err(|error| error.to_string())?;
    if !status.success() && !changes_truncated {
        return Err("Could not read Git status".into());
    }
    Ok(Some(GitStatus {
        branch: if branch.is_empty() {
            "Detached HEAD".into()
        } else {
            branch
        },
        worktree: root,
        changes,
        changes_truncated,
    }))
}

#[tauri::command]
async fn read_usage(
    app: AppHandle,
    codex_server: State<'_, CodexServer>,
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
        "codex" => codex_usage(&codex_server).map(Some),
        "shell" => Ok(None),
        _ => Err("Unknown session type".into()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Sessions::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(load_roots(app.handle()));
            app.manage(load_provider_sessions(app.handle()));
            app.manage(load_codex_server(app.handle())?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            choose_directory,
            revoke_directory,
            spawn_session,
            write_session,
            resize_session,
            stop_session,
            delete_session_data,
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
                stop_codex_server(&app.state::<CodexServer>());
            }
        });
}
