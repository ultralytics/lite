// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

use atomicwrites::{AllowOverwrite, AtomicFile};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
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
use tauri_plugin_updater::UpdaterExt;
use tungstenite::Message;

const MAX_FILE_BYTES: u64 = 500_000;
const DIRECTORY_PAGE_SIZE: usize = 250;
const MAX_GIT_CHANGES: usize = 500;
const CODEX_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
// Requests stay bounded so an app server that never answers surfaces an error instead of a stuck tab.
const CODEX_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const DEEPSEEK_PROFILE: &str = "deepseek";
const DEEPSEEK_MODEL: &str = "deepseek-v4-flash";
const SUPPORTED_KEYS: [&str; 4] = ["claude", "codex", "deepseek", "kimi"];

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
            ".kimi-code",
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

fn command_output(git: &Path, directory: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new(git)
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

fn last_directory_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("last-directory"))
}

fn load_roots(app: &AppHandle) -> Roots {
    let roots = roots_path(app)
        .ok()
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<HashMap<String, PathBuf>>(&bytes).ok())
        .unwrap_or_default();
    Roots(Mutex::new(roots))
}

// Codex threads are UUIDs and Kimi sessions are short opaque ids, so both are held to a safe file-name charset.
fn is_provider_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
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
                if is_provider_session_id(provider_session_id) {
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

fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    }
    AtomicFile::new(path, AllowOverwrite)
        .write(|file| file.write_all(contents))
        .map_err(|error| error.to_string())
}

fn update_roots(
    app: &AppHandle,
    roots: &Roots,
    update: impl FnOnce(&mut HashMap<String, PathBuf>),
) -> Result<(), String> {
    let path = roots_path(app)?;
    let mut roots = roots.0.lock().map_err(|error| error.to_string())?;
    let mut next = roots.clone();
    update(&mut next);
    write_atomic(
        &path,
        &serde_json::to_vec(&next).map_err(|error| error.to_string())?,
    )?;
    *roots = next;
    Ok(())
}

fn update_provider_session(
    app: &AppHandle,
    sessions: &ProviderSessions,
    session_id: &str,
    provider_session_id: Option<String>,
) -> Result<bool, String> {
    uuid::Uuid::parse_str(session_id).map_err(|_| "Invalid session ID")?;
    let directory = provider_sessions_path(app)?;
    let path = directory.join(session_id);
    let mut sessions = sessions.0.lock().map_err(|error| error.to_string())?;
    if let Some(provider_session_id) = provider_session_id {
        if !is_provider_session_id(&provider_session_id) {
            return Err("Invalid provider session ID".into());
        }
        if let Some(existing) = sessions.get(session_id) {
            if existing == &provider_session_id {
                return Ok(true);
            }
        }
        // Claiming under the lock lets concurrent discoveries run without one stealing the other's session.
        if sessions
            .iter()
            .any(|(owner, claimed)| owner != session_id && claimed == &provider_session_id)
        {
            return Ok(false);
        }
        write_atomic(&path, provider_session_id.as_bytes())?;
        sessions.insert(session_id.to_owned(), provider_session_id);
    } else {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        sessions.remove(session_id);
    }
    Ok(true)
}

fn grant_directory(
    app: &AppHandle,
    roots: &Roots,
    path: PathBuf,
) -> Result<DirectoryGrant, String> {
    let path = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if is_sensitive_root(&path) {
        return Err("Credential and configuration folders cannot be opened".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    update_roots(app, roots, |roots| {
        roots.insert(id.clone(), path.clone());
    })?;
    Ok(DirectoryGrant {
        id,
        path: path_text(&path),
    })
}

fn default_directory_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = last_directory_path(app)
        .and_then(|path| fs::read_to_string(path).map_err(|error| error.to_string()))
    {
        let path = PathBuf::from(path);
        if path.is_dir() {
            return Ok(path);
        }
    }
    app.path().home_dir().map_err(|error| error.to_string())
}

#[cfg(unix)]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(windows)]
fn shell_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

// Claude files a session under a key derived from its working directory. Searching for the transcript
// by name avoids depending on how that key is spelled, and a session it never wrote cannot be resumed.
fn claude_session_exists(app: &AppHandle, session_id: &str) -> bool {
    let Ok(home) = std::env::var_os("CLAUDE_CONFIG_DIR")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .map_or_else(
            || app.path().home_dir().map(|home| home.join(".claude")),
            Ok,
        )
    else {
        return false;
    };
    let transcript = format!("{session_id}.jsonl");
    fs::read_dir(home.join("projects")).is_ok_and(|projects| {
        projects
            .flatten()
            .any(|project| project.path().join(&transcript).is_file())
    })
}

fn claude_settings(app: &AppHandle, session_id: &str) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let settings_path = directory.join(format!("claude-{session_id}.json"));
    let usage_path = directory.join(format!("usage-{session_id}.json"));
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let command = format!(
        "{} --claude-statusline {}",
        shell_quote(&path_text(&executable)),
        shell_quote(&path_text(&usage_path))
    );
    write_atomic(
        &settings_path,
        serde_json::json!({ "statusLine": { "type": "command", "command": command } })
            .to_string()
            .as_bytes(),
    )?;
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
    write_atomic(
        Path::new(path),
        &serde_json::to_vec(&snapshot).map_err(|error| error.to_string())?,
    )?;
    if let Some(percent) = snapshot.context_used_percent {
        println!("Lite · {percent:.0}% context");
    } else {
        println!("Lite");
    }
    Ok(())
}

#[tauri::command]
fn default_directory(app: AppHandle, roots: State<Roots>) -> Result<DirectoryGrant, String> {
    grant_directory(&app, &roots, default_directory_path(&app)?)
}

#[tauri::command]
async fn choose_directory(
    app: AppHandle,
    roots: State<'_, Roots>,
) -> Result<Option<DirectoryGrant>, String> {
    let mut dialog = app.dialog().file().set_title("Choose a project");
    if let Ok(path) = default_directory_path(&app) {
        dialog = dialog.set_directory(path);
    }
    let Some(path) = dialog.blocking_pick_folder() else {
        return Ok(None);
    };
    let path = fs::canonicalize(path.into_path().map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    write_atomic(&last_directory_path(&app)?, path_text(&path).as_bytes())?;
    grant_directory(&app, &roots, path).map(Some)
}

// A typed path is a folder like any other: it has to exist and it goes through the same grant.
#[tauri::command]
async fn use_directory(
    app: AppHandle,
    roots: State<'_, Roots>,
    path: String,
) -> Result<DirectoryGrant, String> {
    let path = path.trim();
    let path = match path.strip_prefix('~') {
        Some(rest) => app
            .path()
            .home_dir()
            .map_err(|error| error.to_string())?
            .join(rest.trim_start_matches(['/', '\\'])),
        None => PathBuf::from(path),
    };
    if !path.is_dir() {
        return Err("That folder does not exist".into());
    }
    let path = fs::canonicalize(path).map_err(|error| error.to_string())?;
    write_atomic(&last_directory_path(&app)?, path_text(&path).as_bytes())?;
    grant_directory(&app, &roots, path)
}

#[tauri::command]
fn revoke_directory(app: AppHandle, roots: State<Roots>, root_id: String) -> Result<(), String> {
    update_roots(&app, &roots, |roots| {
        roots.remove(&root_id);
    })
}

fn codex_exchange<S: Read + Write, F: FnOnce(&S) -> Result<(), String>>(
    mut socket: tungstenite::WebSocket<S>,
    requests: &[(u64, &str, serde_json::Value)],
    extend_read_timeout: F,
) -> Result<HashMap<u64, serde_json::Value>, String> {
    socket
        .send(Message::Text(
            serde_json::json!({"method":"initialize","id":0,"params":{"clientInfo":{"name":"ultralytics_lite","title":"Lite","version":env!("CARGO_PKG_VERSION")}}})
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
    extend_read_timeout(socket.get_ref())?;
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
                .set_read_timeout(Some(CODEX_REQUEST_TIMEOUT))
                .map_err(|error| error.to_string())
        })
    }
    #[cfg(windows)]
    {
        let (socket, _) = tungstenite::connect(endpoint).map_err(|error| error.to_string())?;
        codex_exchange(socket, requests, |_| Ok(()))
    }
}

fn codex_executable() -> Result<PathBuf, String> {
    resolve_executable("codex").ok_or_else(|| {
        "Could not find the Codex CLI in your PATH. Install it, then reopen this tab.".to_owned()
    })
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
        let mut login = Command::new(codex_executable()?);
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
    let mut command = Command::new(codex_executable()?);
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

fn codex_thread_ids(server: &CodexServer, cwd: &Path) -> Result<HashSet<String>, String> {
    let responses = codex_requests(
        server,
        &[(
            3,
            "thread/list",
            serde_json::json!({"cwd": path_text(cwd), "limit": 100}),
        )],
    )?;
    Ok(responses
        .get(&3)
        .and_then(|response| response.get("data"))
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|thread| thread.get("id").and_then(serde_json::Value::as_str))
        .map(str::to_owned)
        .collect())
}

fn codex_thread_resumable(server: &CodexServer, thread_id: &str) -> Result<bool, String> {
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
            .and_then(|response| response.pointer("/thread/source"))
            .and_then(serde_json::Value::as_str)
            .is_some_and(|source| source == "cli" || source == "vscode")
    })
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

// An interactive login shell is what loads the configuration that puts version-manager directories on
// PATH, so it is the only lookup that finds a CLI installed through nvm. Bash reads its login profile
// instead of its rc file when it is both, and nvm installs into the rc file, so Bash sources that file
// itself. NULs fence the PATH off from whatever startup files print ahead of it and exit traps print
// after it.
#[cfg(unix)]
fn shell_path(shell: &str) -> Option<String> {
    Command::new(shell)
        .args([
            "-lic",
            "[ -n \"$BASH_VERSION\" ] && [ -f \"$HOME/.bashrc\" ] && . \"$HOME/.bashrc\"; printf '\\0%s\\0' \"$PATH\"",
        ])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            let text = String::from_utf8_lossy(&output.stdout);
            text.split('\0')
                .nth(1)
                .filter(|path| !path.is_empty())
                .map(str::to_owned)
        })
}

// An account shell that does not speak this command leaves nothing usable, so the search falls back to
// the POSIX shell rather than losing every provider CLI.
#[cfg(unix)]
fn user_path() -> Option<String> {
    shell_path(&CommandBuilder::new_default_prog().get_shell()).or_else(|| shell_path("/bin/sh"))
}

#[cfg(windows)]
fn user_path() -> Option<String> {
    std::env::var("PATH").ok()
}

// Keys live in one owner-only file beside Lite's other local state, which is what the Codex and Kimi
// CLIs already do with their own credentials, and it survives updates because the updater replaces the
// bundle and not the data directory. A key is handed to a session through the environment variable its
// CLI already reads, so nothing is copied into provider configuration.
// Codex only knows the models in its own catalog, and it warns and guesses the limits for any other
// one. It reads a replacement catalog from a file, so the bundled catalog is read back and the DeepSeek
// model appended to it: cloning an entry keeps whatever shape that Codex version expects, and keeping
// the built-in models leaves the rest of Codex working. The bundled catalog is asked for by name so a
// launch never waits on Codex refreshing its models over the network. Every failure here returns None
// and leaves the warning in place, because a catalog Codex cannot parse would stop it from starting.
fn deepseek_catalog(app: &AppHandle) -> Option<PathBuf> {
    let mut probe = Command::new(resolve_executable("codex")?);
    probe.args(["debug", "models", "--bundled"]);
    // The CLI is a Node launcher, so without the user PATH its shebang cannot find Node.
    if let Some(path) = user_path() {
        probe.env("PATH", path);
    }
    let output = probe
        .output()
        .ok()
        .filter(|output| output.status.success())?;
    let mut catalog: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    let models = catalog.get_mut("models")?.as_array_mut()?;
    if models
        .iter()
        .any(|model| model.get("slug").and_then(serde_json::Value::as_str) == Some(DEEPSEEK_MODEL))
    {
        return None;
    }
    let mut model = models.first()?.clone();
    let entry = model.as_object_mut()?;
    for (key, value) in [
        ("slug", serde_json::json!(DEEPSEEK_MODEL)),
        ("display_name", serde_json::json!("DeepSeek-V4-Flash")),
        (
            "description",
            serde_json::json!("DeepSeek V4 Flash, served by the DeepSeek API."),
        ),
        ("context_window", serde_json::json!(1_048_576)),
        ("max_context_window", serde_json::json!(1_048_576)),
        ("default_reasoning_level", serde_json::json!("high")),
        ("visibility", serde_json::json!("hide")),
        ("input_modalities", serde_json::json!(["text"])),
        // Capabilities and cache keys that belong to the model this entry was cloned from.
        ("comp_hash", serde_json::Value::Null),
        ("availability_nux", serde_json::Value::Null),
        ("upgrade", serde_json::Value::Null),
        ("tool_mode", serde_json::Value::Null),
        ("multi_agent_version", serde_json::Value::Null),
        ("use_responses_lite", serde_json::json!(false)),
        ("supports_search_tool", serde_json::json!(false)),
        ("support_verbosity", serde_json::json!(false)),
        ("default_verbosity", serde_json::Value::Null),
        ("supports_image_detail_original", serde_json::json!(false)),
        (
            "supports_reasoning_summary_parameter",
            serde_json::json!(false),
        ),
        ("default_reasoning_summary", serde_json::json!("none")),
        ("web_search_tool_type", serde_json::json!("text")),
        (
            "include_skills_usage_instructions",
            serde_json::json!(false),
        ),
        (
            "include_plugin_usage_instructions",
            serde_json::json!(false),
        ),
        ("include_apps_usage_instructions", serde_json::json!(false)),
        // DeepSeek documents parallel tool calls, and the entry states that rather than inheriting it.
        ("supports_parallel_tool_calls", serde_json::json!(true)),
        ("additional_speed_tiers", serde_json::json!([])),
        ("service_tiers", serde_json::json!([])),
    ] {
        if entry.contains_key(key) {
            entry.insert(key.to_owned(), value);
        }
    }
    // Reasoning levels describe the provider, not the model this entry was cloned from, so they are
    // stated rather than inherited: DeepSeek documents these three and a template missing one of them
    // would otherwise leave it unreachable.
    entry.insert(
        "supported_reasoning_levels".to_owned(),
        serde_json::json!([
            {"effort": "low", "description": "Fast responses with lighter reasoning"},
            {"effort": "high", "description": "Greater reasoning depth for complex problems"},
            {"effort": "max", "description": "Maximum reasoning depth for the hardest problems"},
        ]),
    );
    models.push(model);
    let path = app.path().app_data_dir().ok()?.join("codex-models.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok()?;
    }
    let text = serde_json::to_string(&catalog).ok()?;
    AtomicFile::new(&path, AllowOverwrite)
        .write(|file| file.write_all(text.as_bytes()))
        .ok()?;
    Some(path)
}

fn api_keys_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("api-keys.json"))
}

fn api_key_env(agent: &str, provider: Option<&str>) -> Option<(&'static str, &'static str)> {
    match (agent, provider) {
        ("claude", _) => Some(("claude", "ANTHROPIC_API_KEY")),
        ("codex", Some("deepseek")) => Some(("deepseek", "DEEPSEEK_API_KEY")),
        ("codex", _) => Some(("codex", "OPENAI_API_KEY")),
        ("kimi", _) => Some(("kimi", "MOONSHOT_API_KEY")),
        _ => None,
    }
}

fn saved_api_key(app: &AppHandle, agent: &str, provider: Option<&str>) -> Option<String> {
    let (name, _) = api_key_env(agent, provider)?;
    load_api_keys(app).remove(name)
}

fn load_api_keys(app: &AppHandle) -> HashMap<String, String> {
    api_keys_path(app)
        .ok()
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_api_keys(app: &AppHandle, keys: &HashMap<String, String>) -> Result<(), String> {
    let path = api_keys_path(app)?;
    write_atomic(
        &path,
        &serde_json::to_vec(keys).map_err(|error| error.to_string())?,
    )?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

// macOS keeps Claude Code's credentials in the login keychain; other platforms write a file. Presence is
// all that is read here, never the credential itself.
fn claude_signed_in(app: &AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        Command::new("security")
            .args(["find-generic-password", "-s", "Claude Code-credentials"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }
    #[cfg(not(target_os = "macos"))]
    {
        app.path()
            .home_dir()
            .is_ok_and(|home| home.join(".claude").join(".credentials.json").is_file())
    }
}

fn cli_signed_in(app: &AppHandle, name: &str) -> bool {
    match name {
        "claude" => claude_signed_in(app),
        "codex" => codex_home(app).is_ok_and(|home| home.join("auth.json").is_file()),
        "deepseek" => deepseek_profile_exists(app) || codex_declares_deepseek(app),
        "kimi" => kimi_home(app).is_ok_and(|home| home.join("config.toml").is_file()),
        _ => false,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderAuth {
    name: String,
    key_hint: Option<String>,
    cli_signed_in: bool,
}

#[tauri::command]
async fn provider_auth(app: AppHandle) -> Result<Vec<ProviderAuth>, String> {
    let keys = load_api_keys(&app);
    Ok(SUPPORTED_KEYS
        .iter()
        .map(|name| ProviderAuth {
            name: (*name).to_owned(),
            // Only the last characters travel to the interface, enough to tell two keys apart.
            key_hint: keys.get(*name).map(|key| {
                key.chars()
                    .skip(key.chars().count().saturating_sub(4))
                    .collect()
            }),
            cli_signed_in: cli_signed_in(&app, name),
        })
        .collect())
}

#[tauri::command]
async fn save_api_key(app: AppHandle, name: String, key: String) -> Result<(), String> {
    let key = key.trim().to_owned();
    if key.is_empty() {
        return Err("Enter an API key".into());
    }
    if !SUPPORTED_KEYS.contains(&name.as_str()) {
        return Err("Unknown provider".into());
    }
    let mut keys = load_api_keys(&app);
    keys.insert(name, key);
    write_api_keys(&app, &keys)
}

#[tauri::command]
async fn delete_api_key(app: AppHandle, name: String) -> Result<(), String> {
    let mut keys = load_api_keys(&app);
    if keys.remove(&name).is_none() {
        return Ok(());
    }
    write_api_keys(&app, &keys)
}

// A launched app inherits a bare PATH, and the PATH given to a child is not used to find the program
// itself, so anything Lite runs has to be located in the user's own PATH first and run by full path.
fn resolve_executable(name: &str) -> Option<PathBuf> {
    let path = user_path()?;
    std::env::split_paths(&path).find_map(|directory| {
        #[cfg(windows)]
        {
            ["exe", "cmd", "bat"]
                .iter()
                .map(|extension| directory.join(format!("{name}.{extension}")))
                .find(|candidate| candidate.is_file())
        }
        #[cfg(unix)]
        {
            let candidate = directory.join(name);
            candidate.is_file().then_some(candidate)
        }
    })
}

fn executable_exists(name: &str) -> bool {
    resolve_executable(name).is_some()
}

fn codex_home(app: &AppHandle) -> Result<PathBuf, String> {
    std::env::var_os("CODEX_HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .map_or_else(
            || {
                app.path()
                    .home_dir()
                    .map(|home| home.join(".codex"))
                    .map_err(|error| error.to_string())
            },
            Ok,
        )
}

// Looks only for the section header. The DeepSeek credential lives in that file and is never read.
fn codex_declares_deepseek(app: &AppHandle) -> bool {
    let Ok(home) = codex_home(app) else {
        return false;
    };
    let Ok(file) = fs::File::open(home.join("config.toml")) else {
        return false;
    };
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .any(|line| line.trim() == "[model_providers.deepseek]")
}

// A catalog is a replacement rather than a merge, so one the user configured is left to win.
fn codex_declares_catalog(app: &AppHandle) -> bool {
    let Ok(home) = codex_home(app) else {
        return false;
    };
    let Ok(file) = fs::File::open(home.join("config.toml")) else {
        return false;
    };
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .any(|line| line.trim_start().starts_with("model_catalog_json"))
}

fn deepseek_profile_exists(app: &AppHandle) -> bool {
    codex_home(app).is_ok_and(|home| {
        home.join(format!("{DEEPSEEK_PROFILE}.config.toml"))
            .is_file()
    })
}

fn kimi_home(app: &AppHandle) -> Result<PathBuf, String> {
    std::env::var_os("KIMI_CODE_HOME")
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .map_or_else(
            || {
                app.path()
                    .home_dir()
                    .map(|home| home.join(".kimi-code"))
                    .map_err(|error| error.to_string())
            },
            Ok,
        )
}

// Kimi groups sessions under an opaque per-directory key that its workspace index maps back to a path.
fn kimi_workspace_key(app: &AppHandle, cwd: &Path) -> Option<String> {
    let bytes = fs::read(kimi_home(app).ok()?.join("workspaces.json")).ok()?;
    let index: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    index
        .get("workspaces")?
        .as_object()?
        .iter()
        .find(|(key, workspace)| {
            is_provider_session_id(key)
                && workspace
                    .get("root")
                    .and_then(serde_json::Value::as_str)
                    .and_then(|root| fs::canonicalize(root).ok())
                    .is_some_and(|root| root == cwd)
        })
        .map(|(key, _)| key.clone())
}

// Launching Kimi without an id attaches to whatever session the directory already has rather than making
// one, so the session a tab is showing is that directory's most recent, and a tab records it by claiming
// it. A second tab there attaches to the same session until `/new` gives it one of its own to claim.
fn kimi_current_session(app: &AppHandle, cwd: &Path) -> Option<String> {
    let key = kimi_workspace_key(app, cwd)?;
    let home = kimi_home(app).ok()?;
    fs::read_dir(home.join("sessions").join(key))
        .ok()?
        .flatten()
        .filter_map(|session| {
            let name = session.file_name().to_str()?.to_owned();
            if !session.file_type().ok()?.is_dir() || !is_provider_session_id(&name) {
                return None;
            }
            Some((session.metadata().ok()?.modified().ok()?, name))
        })
        .max_by(|left, right| left.0.cmp(&right.0))
        .map(|(_, name)| name)
}

// Only this directory's group is read, so a Kimi session started elsewhere is never claimed by this tab.
fn kimi_session_ids(app: &AppHandle, cwd: &Path) -> HashSet<String> {
    let mut ids = HashSet::new();
    let Some(key) = kimi_workspace_key(app, cwd) else {
        return ids;
    };
    let Ok(home) = kimi_home(app) else {
        return ids;
    };
    let Ok(sessions) = fs::read_dir(home.join("sessions").join(key)) else {
        return ids;
    };
    for session in sessions.flatten() {
        if !session.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        if let Some(name) = session.file_name().to_str()
            && is_provider_session_id(name)
        {
            ids.insert(name.to_owned());
        }
    }
    ids
}

fn agent_command(
    app: &AppHandle,
    agent: &str,
    provider: Option<&str>,
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
            // DeepSeek is selected per launch so the default Codex provider stays whatever the user set.
            if provider == Some("deepseek") {
                let key = saved_api_key(app, agent, provider).is_some();
                if !key && deepseek_profile_exists(app) {
                    // A profile the user wrote owns the whole model configuration, catalog included.
                    command.args(["--profile", DEEPSEEK_PROFILE]);
                } else {
                    if key {
                        // A key held by Lite defines the provider inline and is read from the
                        // environment, so no Codex configuration file has to exist or be written.
                        for override_value in [
                            "model_providers.deepseek.name=\"deepseek\"",
                            "model_providers.deepseek.base_url=\"https://api.deepseek.com/\"",
                            "model_providers.deepseek.wire_api=\"responses\"",
                            "model_providers.deepseek.env_key=\"DEEPSEEK_API_KEY\"",
                        ] {
                            command.args(["-c", override_value]);
                        }
                    }
                    command.args(["-c", "model_provider=\"deepseek\""]);
                    command.args(["-c", &format!("model=\"{DEEPSEEK_MODEL}\"")]);
                    if let Some(catalog) = (!codex_declares_catalog(app))
                        .then(|| deepseek_catalog(app))
                        .flatten()
                    {
                        // A Windows path is full of backslashes, which TOML reads as escapes.
                        let catalog = path_text(&catalog)
                            .replace('\\', "\\\\")
                            .replace('"', "\\\"");
                        command.args(["-c", &format!("model_catalog_json=\"{catalog}\"")]);
                    }
                }
            }
            if let Some(provider_session_id) = provider_session_id {
                command.args(["resume", provider_session_id]);
            }
            command
        }
        "kimi" => {
            // Only an exact id resumes. `--continue` would reopen whatever ran last in the directory,
            // which two tabs there would both land on, and it creates no entry for discovery to record,
            // so the tab could never learn which session it is showing.
            let mut command = CommandBuilder::new("kimi");
            if let Some(provider_session_id) = provider_session_id {
                command.args(["--session", provider_session_id]);
            }
            command
        }
        "shell" => CommandBuilder::new_default_prog(),
        _ => return Err("Unknown session type".into()),
    };
    if let Some(path) = user_path() {
        command.env("PATH", path);
    }
    // The key reaches the CLI through the variable it already reads, and only for this session.
    if let Some((_, variable)) = api_key_env(agent, provider)
        && let Some(key) = saved_api_key(app, agent, provider)
    {
        command.env(variable, key);
    }
    Ok(command)
}

// Each CLI owns its sign-in and opens the browser itself, so Lite only runs the command and shows it.
fn login_command(agent: &str) -> Result<CommandBuilder, String> {
    let mut command = match agent {
        "claude" => {
            let mut command = CommandBuilder::new("claude");
            command.args(["auth", "login"]);
            command
        }
        "codex" => {
            let mut command = CommandBuilder::new("codex");
            command.arg("login");
            command
        }
        "kimi" => {
            let mut command = CommandBuilder::new("kimi");
            command.arg("login");
            command
        }
        _ => return Err("This provider signs in with an API key".into()),
    };
    if let Some(path) = user_path() {
        command.env("PATH", path);
    }
    Ok(command)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Availability {
    available: bool,
    detail: String,
}

#[tauri::command]
async fn agent_availability(
    app: AppHandle,
    agent: String,
    provider: Option<String>,
) -> Result<Availability, String> {
    let (executable, missing) = match agent.as_str() {
        "claude" => (
            "claude",
            "Install the Claude Code CLI, then sign in with `claude`.",
        ),
        "codex" => (
            "codex",
            "Install the Codex CLI, then sign in with `codex login`.",
        ),
        "kimi" => (
            "kimi",
            if cfg!(windows) {
                "Install Git for Windows, then run `irm https://code.kimi.com/kimi-code/install.ps1 | iex` in PowerShell."
            } else {
                "Install Kimi Code with `curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash`."
            },
        ),
        "shell" => {
            return Ok(Availability {
                available: true,
                detail: String::new(),
            });
        }
        _ => return Err("Unknown session type".into()),
    };
    if !executable_exists(executable) {
        return Ok(Availability {
            available: false,
            detail: missing.into(),
        });
    }
    if agent == "codex" && provider.as_deref() == Some("deepseek") {
        let configured = saved_api_key(&app, &agent, provider.as_deref()).is_some()
            || deepseek_profile_exists(&app)
            || codex_declares_deepseek(&app);
        return Ok(Availability {
            available: configured,
            detail: if configured {
                String::new()
            } else {
                format!(
                    "Save a DeepSeek key in Lite's settings, or add a DeepSeek provider to your Codex configuration. Either way Lite launches `{DEEPSEEK_MODEL}` through it."
                )
            },
        });
    }
    Ok(Availability {
        available: true,
        detail: String::new(),
    })
}

#[tauri::command]
async fn open_setup_docs(agent: String, provider: Option<String>) -> Result<(), String> {
    let url = match (agent.as_str(), provider.as_deref()) {
        ("claude", _) => "https://code.claude.com/docs/en/setup",
        ("codex", Some("deepseek")) => {
            "https://api-docs.deepseek.com/quick_start/agent_integrations/codex"
        }
        ("codex", _) => "https://developers.openai.com/codex/cli",
        ("kimi", _) => {
            "https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html"
        }
        _ => return Err("No setup guide for this session type".into()),
    };
    open_external(url)
}

// Terminals make their links clickable, and a provider's sign-in URL is the reason people want that.
// Only web schemes open, so terminal output cannot talk the browser into anything else.
#[tauri::command]
async fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Only web links can be opened".into());
    }
    open_external(&url)
}

fn open_external(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/c", "start", ""]);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");
    command
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|_| ())
        .map_err(|error| format!("Could not open the link: {error}"))
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
    provider: Option<String>,
    mode: Option<String>,
    theme: Option<String>,
    name: String,
    resume: bool,
    cols: u16,
    rows: u16,
) -> Result<Option<String>, String> {
    let cwd = root_path(&roots, &root_id)?;
    // A sign-in runs the provider's own login command and owns no session of its own.
    let signing_in = mode.as_deref() == Some("login");
    // Resuming a Claude session it never recorded fails outright, so that tab starts one instead.
    let resume = resume && (agent != "claude" || claude_session_exists(&app, &session_id));
    if !signing_in && (agent == "codex" || agent == "kimi") {
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
    // An id the tab already holds is recorded here too, so no other tab claims that same session.
    if let Some(known) = provider_session_id.as_deref() {
        let _ = update_provider_session(
            &app,
            &provider_sessions,
            &session_id,
            Some(known.to_owned()),
        );
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

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;
    if !signing_in
        && agent == "codex"
        && provider_session_id.is_some()
        && !codex_thread_resumable(
            &codex_server,
            provider_session_id.as_deref().expect("restored above"),
        )?
    {
        update_provider_session(&app, &provider_sessions, &session_id, None)?;
        provider_session_id = None;
    }
    // A Kimi session the user deleted should start a new one instead of failing the terminal.
    if !signing_in
        && agent == "kimi"
        && let Some(known) = provider_session_id.as_deref()
        && !kimi_session_ids(&app, &cwd).contains(known)
    {
        update_provider_session(&app, &provider_sessions, &session_id, None)?;
        provider_session_id = None;
    }
    let mut command = if signing_in {
        login_command(&agent)?
    } else {
        agent_command(
            &app,
            &agent,
            provider.as_deref(),
            resume,
            &session_id,
            provider_session_id.as_deref(),
            &name,
        )?
    };
    if !signing_in && agent == "claude" {
        let settings = claude_settings(&app, &session_id)?;
        command.args(["--settings", &path_text(&settings)]);
    }
    command.cwd(path_text(&cwd));
    command.env("TERM", "xterm-256color");
    // The conventional hint for which way a terminal is shaded, so a CLI picks a readable palette.
    command.env(
        "COLORFGBG",
        if theme.as_deref() == Some("light") {
            "0;15"
        } else {
            "15;0"
        },
    );
    // Codex records a new thread per launch, so its discovery watches for one the tab did not start with.
    // Kimi attaches to the directory's session instead, so its discovery reads that session directly.
    let known_sessions =
        if !signing_in && provider_session_id.is_none() && (agent == "codex" || agent == "kimi") {
            if agent == "kimi" {
                Some(HashSet::new())
            } else {
                // Losing discovery costs exact resume, not the session, so a failure still opens the terminal.
                codex_thread_ids(&codex_server, &cwd).ok()
            }
        } else {
            None
        };
    let mut child = match pair.slave.spawn_command(command) {
        Ok(child) => child,
        Err(error) => {
            return Err(if agent == "shell" {
                error.to_string()
            } else {
                format!(
                    "Could not start {agent}. Install its CLI and make sure it is available in your PATH. {error}"
                )
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
    let mut running = match sessions.0.lock() {
        Ok(running) => running,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error.to_string());
        }
    };
    running.insert(
        session_id.clone(),
        PtySession {
            child,
            master: pair.master,
            writer,
            run_id: run_id.clone(),
        },
    );
    drop(running);

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

    if let Some(existing) = known_sessions {
        let discovery_app = app.clone();
        let discovery_session_id = session_id.clone();
        let discovery_agent = agent.clone();
        thread::spawn(move || {
            loop {
                let candidates = if discovery_agent == "kimi" {
                    Ok(kimi_current_session(&discovery_app, &cwd)
                        .into_iter()
                        .collect::<HashSet<_>>())
                } else {
                    codex_thread_ids(&discovery_app.state::<CodexServer>(), &cwd)
                        .map(|current| current.difference(&existing).cloned().collect())
                };
                // Whatever another tab already claimed is skipped, so overlapping launches settle apart.
                if let Ok(candidates) = candidates
                    && candidates.iter().any(|provider_session_id| {
                        update_provider_session(
                            &discovery_app,
                            &discovery_app.state::<ProviderSessions>(),
                            &discovery_session_id,
                            Some(provider_session_id.clone()),
                        )
                        .unwrap_or(false)
                    })
                {
                    break;
                }
                let running = discovery_app
                    .state::<Sessions>()
                    .0
                    .lock()
                    .is_ok_and(|sessions| sessions.contains_key(&discovery_session_id));
                if !running {
                    break;
                }
                thread::sleep(Duration::from_secs(1));
            }
        });
    }

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
    update_provider_session(&app, &provider_sessions, &session_id, None).map(|_| ())
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
    // Locating Git runs a login shell, so one refresh resolves it once rather than once per command.
    let git = resolve_executable("git").unwrap_or_else(|| "git".into());
    let root = match command_output(&git, &path, &["rev-parse", "--show-toplevel"]) {
        Ok(root) => root,
        Err(_) => return Ok(None),
    };
    let branch = command_output(&git, &path, &["branch", "--show-current"])?;
    let mut child = Command::new(&git)
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
    provider: Option<String>,
    session_id: String,
) -> Result<Option<UsageSnapshot>, String> {
    // A DeepSeek-backed Codex session bills DeepSeek, so the OpenAI account limits are not its usage.
    if agent == "codex" && provider.as_deref() == Some("deepseek") {
        return Ok(None);
    }
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
        "kimi" | "shell" => Ok(None),
        _ => Err("Unknown session type".into()),
    }
}

fn stop_runtime(app: &AppHandle) {
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

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<String>, String> {
    app.updater_builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map(|update| update.map(|update| update.version))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let cleanup_app = app.clone();
    let update = app
        .updater_builder()
        .on_before_exit(move || {
            stop_runtime(&cleanup_app);
            cleanup_app.cleanup_before_exit();
        })
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "No update is available.".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    app.restart()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            use_directory,
            default_directory,
            revoke_directory,
            spawn_session,
            write_session,
            resize_session,
            stop_session,
            delete_session_data,
            list_directory,
            read_text_file,
            git_status,
            read_usage,
            agent_availability,
            open_setup_docs,
            open_url,
            provider_auth,
            save_api_key,
            delete_api_key,
            check_update,
            install_update
        ])
        .build(tauri::generate_context!())
        .expect("error while building Lite")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                stop_runtime(app);
            }
        });
}
