// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

use atomicwrites::{AllowOverwrite, AtomicFile};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    thread,
    time::{Duration, SystemTime},
};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;
use tungstenite::Message;

const MAX_FILE_BYTES: u64 = 500_000;
const DIRECTORY_PAGE_SIZE: usize = 250;
const MAX_GIT_CHANGES: usize = 500;
const MAX_GIT_DIFF_BYTES: u64 = 1_000_000;
const MISSING_DIRECTORY: &str = "The selected folder no longer exists";
const CODEX_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
// Requests stay bounded so an app server that never answers surfaces an error instead of a stuck tab.
const CODEX_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const DEEPSEEK_MODEL: &str = "deepseek-v4-flash";
const SUPPORTED_KEYS: [&str; 6] = [
    "claude",
    "codex",
    "deepseek",
    "openrouter",
    "gemini",
    "kimi",
];

#[derive(Clone, Copy)]
struct CodexProvider {
    id: &'static str,
    name: &'static str,
    base_url: &'static str,
    env_key: &'static str,
    model: &'static str,
    setup_url: &'static str,
}

const CODEX_PROVIDERS: [CodexProvider; 2] = [
    CodexProvider {
        id: "deepseek",
        name: "DeepSeek",
        base_url: "https://api.deepseek.com/",
        env_key: "DEEPSEEK_API_KEY",
        model: DEEPSEEK_MODEL,
        setup_url: "https://api-docs.deepseek.com/quick_start/agent_integrations/codex",
    },
    CodexProvider {
        id: "openrouter",
        name: "OpenRouter",
        base_url: "https://openrouter.ai/api/v1",
        env_key: "OPENROUTER_API_KEY",
        model: "~openai/gpt-latest",
        setup_url: "https://openrouter.ai/docs/cookbook/coding-agents/codex-cli",
    },
];

struct PtySession {
    child: Box<dyn Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    run_id: String,
    alive: Arc<AtomicBool>,
    agent_watch: Arc<AtomicU64>,
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
    session
        .child
        .wait()
        .map_err(|error| kill_error.unwrap_or_else(|| error.to_string()))?;
    session.alive.store(false, Ordering::Relaxed);
    Ok(())
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellAgent {
    session_id: String,
    run_id: String,
    agent: Option<String>,
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
    line_diffs: BTreeMap<String, LineDiff>,
    changes_truncated: bool,
}

#[derive(Serialize)]
struct LineDiff {
    additions: u64,
    deletions: u64,
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
    let root = fs::canonicalize(root).map_err(|_| MISSING_DIRECTORY.to_owned())?;
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
            ".gemini",
            ".git-credentials",
            ".gnupg",
            ".kimi-code",
            ".netrc",
            ".npmrc",
            ".pypirc",
            ".qwen",
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

fn read_roots(path: &Path) -> HashMap<String, PathBuf> {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn load_roots(app: &AppHandle) -> Roots {
    Roots(Mutex::new(
        roots_path(app)
            .as_deref()
            .map(read_roots)
            .unwrap_or_default(),
    ))
}

// The worktrees Lite created, one file per grant id like provider sessions: two copies of Lite
// never share a file to race over, and a shell session's grant following its cd never touches
// them, so cleanup can only ever remove the exact folder Lite made for that grant.
fn worktrees_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("worktrees"))
}

// What Lite records about each worktree it creates: the folder, the branch it made for it, the
// main checkout it belongs to, its administrative git folder, and the commit the branch started at —
// all used at removal time and none trusted to the caller again. The administrative folder and the
// repository's info folder carry Lite's marks: a folder or repository that merely sits at a recorded
// path never has them.
#[derive(Clone, Deserialize, Serialize)]
struct WorktreeRecord {
    path: String,
    branch: String,
    main: String,
    admin: String,
    head: String,
}

fn record_worktree(
    app: &AppHandle,
    root_id: &str,
    worktree: &Path,
    branch: &str,
    main: &Path,
    admin: &Path,
    head: &str,
) -> Result<(), String> {
    uuid::Uuid::parse_str(root_id).map_err(|_| "Invalid grant ID")?;
    let directory = worktrees_path(app)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let record = WorktreeRecord {
        path: path_text(worktree),
        branch: branch.to_owned(),
        main: path_text(main),
        admin: path_text(admin),
        head: head.to_owned(),
    };
    write_atomic(
        &directory.join(root_id),
        serde_json::to_vec(&record)
            .map_err(|error| error.to_string())?
            .as_slice(),
    )
}

fn read_worktree_record(record: &Path) -> Option<WorktreeRecord> {
    fs::read(record)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

// Lite's mark on the repository itself, written at creation into git's own place for repo-local
// metadata. The worktree's mark dies with the worktree, so this is what a branch deletion asks
// for once the folder is gone: a replacement repository at the same path has no mark.
fn repo_mark_present(git: &Path, main: &Path, root_id: &str, branch: &str) -> bool {
    let Ok(main_git) = command_output(git, main, &["rev-parse", "--absolute-git-dir"]) else {
        return false;
    };
    fs::read_to_string(
        PathBuf::from(main_git)
            .join("info")
            .join(format!("lite-{root_id}")),
    )
    .map(|content| content.trim() == branch)
    .unwrap_or(false)
}

// The repository's mark goes when nothing Lite owns is left; a stale one is inert.
fn remove_repo_mark(git: &Path, main: &Path, root_id: &str) {
    if let Ok(main_git) = command_output(git, main, &["rev-parse", "--absolute-git-dir"]) {
        let _ = fs::remove_file(
            PathBuf::from(main_git)
                .join("info")
                .join(format!("lite-{root_id}")),
        );
    }
}

// A grant id proves its session is the one asking; where the grant points is irrelevant, since
// the recorded path — never the grant's — is what removal targets.
fn grant_known(roots: &Roots, root_id: &str) -> Result<(), String> {
    let roots = roots.0.lock().map_err(|error| error.to_string())?;
    if roots.contains_key(root_id) {
        Ok(())
    } else {
        Err("Folder permission is no longer available".into())
    }
}

// The user chose to keep a worktree Lite made: Lite forgets it made it. From here the folder is
// the user's own worktree, never offered for deletion again.
#[tauri::command]
async fn forget_worktree(
    app: AppHandle,
    roots: State<'_, Roots>,
    root_id: String,
) -> Result<(), String> {
    uuid::Uuid::parse_str(&root_id).map_err(|_| "Invalid grant ID")?;
    grant_known(&roots, &root_id)?;
    let record = worktrees_path(&app)?.join(&root_id);
    // The folder is the user's now, and Lite's marks go with the record: nothing says the
    // worktree or its repository was ever Lite's to remove. Prune is safe here — it only drops
    // registrations whose folders are missing, so a kept worktree that is still in place keeps
    // its registration, while a manually deleted one stops claiming the branch.
    if let Some(recorded) = read_worktree_record(&record) {
        let _ = fs::remove_file(PathBuf::from(&recorded.admin).join("lite"));
        let git = resolve_executable("git").unwrap_or_else(|| "git".into());
        let main = PathBuf::from(&recorded.main);
        remove_repo_mark(&git, &main, &root_id);
        let _ = command_output(&git, &main, &["worktree", "prune"]);
    }
    forget_record(&record)
}

// worktree add has already run when these are reached, so a failure after it puts the folder and
// newly made branch back rather than leaving an orphan nothing can clean up. A branch that survived
// a missing worktree is preserved, and a rollback that fails says where the folder may remain.
fn undo_worktree(
    git: &Path,
    repo: &Path,
    worktree: &Path,
    branch: &str,
    delete_branch: bool,
) -> Result<(), String> {
    let target = path_text(worktree);
    let removed = command_output(git, repo, &["worktree", "remove", "--force", &target]);
    if delete_branch {
        let branch_gone = command_output(git, repo, &["branch", "-D", branch]);
        removed.and(branch_gone).map(|_| ())
    } else {
        removed.map(|_| ())
    }
}

// On a clean rollback the repository's mark goes too: nothing is left to prove. On a failed one
// it stays — the worktree and branch are still there, and the mark is the only way a later
// attempt can prove they are Lite's.
fn fail_with_rollback(
    error: String,
    git: &Path,
    repo: &Path,
    worktree: &Path,
    branch: &str,
    root_id: &str,
    rollback: Option<(bool, bool)>,
) -> String {
    let Some((delete_branch, remove_mark)) = rollback else {
        return error;
    };
    match undo_worktree(git, repo, worktree, branch, delete_branch) {
        Ok(()) => {
            if remove_mark {
                remove_repo_mark(git, repo, root_id);
            }
            error
        }
        Err(rollback) => format!(
            "{error}; rollback also failed ({rollback}); the worktree or branch may remain from {}",
            path_text(worktree)
        ),
    }
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
    // A second copy of Lite writes this same file — a shell session inside Lite that launches the app
    // is enough to make two. Writing this process's map alone would drop every grant the other one has
    // made since startup, and the sessions holding them would be told their folder is no longer theirs.
    // So the change is made against the file rather than against the map this copy loaded at startup,
    // and only the one grant it is adding or removing goes with it: re-asserting the rest would hand
    // back the grants another copy has since revoked, which is the opposite of closing a session.
    let mut next = read_roots(&path);
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
    root_id: Option<String>,
) -> Result<DirectoryGrant, String> {
    let path = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if is_sensitive_root(&path) {
        return Err("Credential and configuration folders cannot be opened".into());
    }
    let id = root_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    update_roots(app, roots, |roots| {
        roots.insert(id.clone(), path.clone());
    })?;
    Ok(DirectoryGrant {
        id,
        path: path_text(&path),
    })
}

fn default_directory_path(app: &AppHandle) -> Option<PathBuf> {
    let path = last_directory_path(app)
        .and_then(|path| fs::read_to_string(path).map_err(|error| error.to_string()))
        .ok()
        .map(PathBuf::from)?;
    path.is_dir().then_some(path)
}

#[cfg(unix)]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(windows)]
fn shell_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

fn provider_home(app: &AppHandle, variable: &str, fallback: &str) -> Result<PathBuf, String> {
    std::env::var_os(variable)
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
        .map_or_else(
            || {
                app.path()
                    .home_dir()
                    .map(|home| home.join(fallback))
                    .map_err(|error| error.to_string())
            },
            Ok,
        )
}

fn claude_transcript_lines(path: &Path) -> impl Iterator<Item = String> {
    fs::File::open(path)
        .map(|file| BufReader::new(file).lines().map_while(Result::ok))
        .into_iter()
        .flatten()
}

// Only the stamped field is a link, since ordinary output quotes ids too, a directory listing among it.
fn claude_transcript_quotes(path: &Path, session_id: &str) -> bool {
    claude_transcript_lines(path)
        .filter(|line| line.contains(session_id))
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(&line).ok())
        .any(|record| {
            record.get("session_id").and_then(serde_json::Value::as_str) == Some(session_id)
        })
}

fn claude_transcript_has_messages(path: &Path) -> bool {
    claude_transcript_lines(path)
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(&line).ok())
        .any(|record| {
            matches!(
                record.get("type").and_then(serde_json::Value::as_str),
                Some("user" | "assistant" | "system")
            )
        })
}

// `/resume` leaves the launched id as a marker holding no message and stamps the turns that follow into
// the conversation it moved to. Returns the id to launch and whether it names one to resume.
fn claude_launch_id(app: &AppHandle, session_id: &str) -> (String, bool) {
    let transcript = format!("{session_id}.jsonl");
    let Some(project) = provider_home(app, "CLAUDE_CONFIG_DIR", ".claude")
        .ok()
        .and_then(|home| fs::read_dir(home.join("projects")).ok())
        .and_then(|projects| {
            projects
                .flatten()
                .map(|project| project.path())
                .find(|project| project.join(&transcript).is_file())
        })
    else {
        return (session_id.to_owned(), false);
    };
    let marker = project.join(&transcript);
    if claude_transcript_has_messages(&marker) {
        return (session_id.to_owned(), true);
    }
    fs::read_dir(&project)
        .into_iter()
        .flatten()
        .flatten()
        .map(|conversation| conversation.path())
        .filter(|path| path.extension() == Some("jsonl".as_ref()) && path != &marker)
        .find(|path| claude_transcript_quotes(path, session_id))
        .and_then(|path| Some((path.file_stem()?.to_str()?.to_owned(), true)))
        .unwrap_or_else(|| (uuid::Uuid::new_v4().to_string(), false))
}

fn claude_settings(app: &AppHandle, session_id: &str, run_id: &str) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let settings_path = directory.join(format!("claude-{session_id}.json"));
    let usage_path = directory.join(format!("usage-{session_id}.json"));
    let activity_directory = directory.join(format!("activity-{session_id}"));
    if activity_directory.exists() {
        fs::remove_dir_all(&activity_directory).map_err(|error| error.to_string())?;
    }
    let activity_path = activity_directory.join(run_id);
    fs::create_dir_all(&activity_path).map_err(|error| error.to_string())?;
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let status = format!(
        "{} --claude-statusline {} {}",
        shell_quote(&path_text(&executable)),
        shell_quote(&path_text(&usage_path)),
        shell_quote(&path_text(&activity_path))
    );
    let activity = format!(
        "{} --claude-activity {}",
        shell_quote(&path_text(&executable)),
        shell_quote(&path_text(&activity_path))
    );
    write_atomic(
        &settings_path,
        serde_json::json!({
            "preferredNotifChannel": "iterm2",
            "statusLine": { "type": "command", "command": status, "refreshInterval": 1 },
            "hooks": {
                "SubagentStart": [{ "hooks": [{ "type": "command", "command": activity }] }],
                "SubagentStop": [{ "hooks": [{ "type": "command", "command": activity }] }]
            }
        })
        .to_string()
        .as_bytes(),
    )?;
    Ok(settings_path)
}

fn activity_key(input: &serde_json::Value) -> Option<&str> {
    input
        .get("agent_id")
        .and_then(serde_json::Value::as_str)
        .filter(|value| {
            value.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
            })
        })
}

pub fn capture_claude_activity(path: &str) -> Result<(), String> {
    let input: serde_json::Value =
        serde_json::from_reader(std::io::stdin()).map_err(|error| error.to_string())?;
    let directory = Path::new(path);
    if !directory.is_dir() {
        return Ok(());
    }
    let event = input
        .get("hook_event_name")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    match event {
        "SubagentStart" => {
            if let Some(key) = activity_key(&input) {
                fs::write(directory.join(key), []).map_err(|error| error.to_string())?;
            }
        }
        "SubagentStop" => {
            if let Some(key) = activity_key(&input)
                && let Err(error) = fs::remove_file(directory.join(key))
                && error.kind() != std::io::ErrorKind::NotFound
            {
                return Err(error.to_string());
            }
        }
        _ => {}
    }
    Ok(())
}

fn claude_shell_running() -> bool {
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().without_tasks(),
    );
    let Ok(current) = sysinfo::get_current_pid() else {
        return false;
    };
    let mut ancestors = HashSet::from([current]);
    let mut parent = system.process(current).and_then(|process| process.parent());
    let claude = loop {
        let Some(pid) = parent else { return false };
        ancestors.insert(pid);
        let Some(process) = system.process(pid) else {
            return false;
        };
        let name = process.name().to_string_lossy().to_ascii_lowercase();
        if name.strip_suffix(".exe").unwrap_or(&name) == "claude" {
            break pid;
        }
        parent = process.parent();
    };
    system.processes().iter().any(|(pid, process)| {
        let name = process.name().to_string_lossy().to_ascii_lowercase();
        if ancestors.contains(pid)
            || !matches!(
                name.strip_suffix(".exe").unwrap_or(&name),
                "bash" | "cmd" | "dash" | "fish" | "nu" | "powershell" | "pwsh" | "sh" | "zsh"
            )
        {
            return false;
        }
        let mut parent = process.parent();
        while let Some(pid) = parent {
            if pid == claude {
                return true;
            }
            parent = system.process(pid).and_then(|process| process.parent());
        }
        false
    })
}

pub fn capture_claude_status(path: &str, activity_path: &str) -> Result<(), String> {
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
    for (key, label) in [
        ("five_hour", "Current session"),
        ("seven_day", "Current week"),
    ] {
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
    let usage = serde_json::to_vec(&snapshot).map_err(|error| error.to_string())?;
    if !fs::read(path).is_ok_and(|current| current == usage) {
        write_atomic(Path::new(path), &usage)?;
    }
    let working = fs::read_dir(activity_path).is_ok_and(|mut entries| entries.next().is_some())
        || claude_shell_running();
    let activity = if working { "working" } else { "idle" };
    if let Some(percent) = snapshot.context_used_percent {
        println!("\x1b]6973;lite-{activity}\x07Lite · {percent:.0}% context");
    } else {
        println!("\x1b]6973;lite-{activity}\x07Lite");
    }
    Ok(())
}

#[tauri::command]
fn default_directory(
    app: AppHandle,
    roots: State<Roots>,
) -> Result<Option<DirectoryGrant>, String> {
    default_directory_path(&app)
        .map(|path| grant_directory(&app, &roots, path, None))
        .transpose()
}

#[tauri::command]
async fn choose_directory(
    app: AppHandle,
    roots: State<'_, Roots>,
) -> Result<Option<DirectoryGrant>, String> {
    let mut dialog = app.dialog().file().set_title("Choose a project");
    if let Some(path) = default_directory_path(&app) {
        dialog = dialog.set_directory(path);
    }
    let Some(path) = dialog.blocking_pick_folder() else {
        return Ok(None);
    };
    let path = fs::canonicalize(path.into_path().map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    write_atomic(&last_directory_path(&app)?, path_text(&path).as_bytes())?;
    grant_directory(&app, &roots, path, None).map(Some)
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
    grant_directory(&app, &roots, path, None)
}

#[tauri::command]
async fn follow_directory(
    app: AppHandle,
    roots: State<'_, Roots>,
    root_id: String,
    path: String,
) -> Result<DirectoryGrant, String> {
    root_path(&roots, &root_id)?;
    grant_directory(&app, &roots, PathBuf::from(path), Some(root_id))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitHubItem {
    url: String,
    title: Option<String>,
    state: Option<String>,
    occurred_at: Option<String>,
}

// The repository and number a GitHub work-item link names, or nothing if the link is not one. Owner
// and name are embedded in a GraphQL query, so only the characters GitHub itself allows in them pass,
// and the number has to fit the Int the API takes.
fn github_item_parts(url: &str) -> Option<(String, String, String)> {
    let mut parts = url.strip_prefix("https://github.com/")?.split('/');
    let owner = parts.next().filter(|part| !part.is_empty())?;
    let repository = parts.next().filter(|part| !part.is_empty())?;
    if [owner, repository].iter().any(|part| {
        !part
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-._".contains(character))
    }) {
        return None;
    }
    if !matches!(parts.next()?, "pull" | "issues") {
        return None;
    }
    // A leading zero would also make the number an invalid GraphQL Int literal, poisoning the batch.
    let number = parts.next()?;
    if !matches!(number.chars().next(), Some('1'..='9'))
        || number.len() > 9
        || !number.chars().all(|digit| digit.is_ascii_digit())
    {
        return None;
    }
    Some((owner.to_owned(), repository.to_owned(), number.to_owned()))
}

// An explicit reference waiting on GitHub's answer.
struct Lookup {
    owner: String,
    repository: String,
    number: String,
    url: String,
}

// A session prints as many references as it prints, and all of them are asked about in one request;
// the cap is what one request comfortably carries rather than how long the panel is allowed to wait.
const CHECKED_GITHUB_ITEMS: usize = 100;

// gh carries the user's sign-in without Lite reading it. Every explicit reference goes into one
// GraphQL request, because a process and network round trip per item would make the panel wait. A
// reference is dropped only when GitHub confirms the repository exists and the item does not;
// otherwise an unavailable or private item remains visible as the command or link named it.
fn check_github_items(urls: Vec<String>) -> Vec<GitHubItem> {
    let mut lookups: Vec<Lookup> = Vec::new();
    let mut seen = HashSet::new();
    for url in urls {
        let Some((owner, repository, number)) = github_item_parts(&url) else {
            continue;
        };
        // Repository identity is case-insensitive, and an issue and pull request cannot share a
        // number, so repeated command and URL forms collapse to one item.
        if seen.insert((
            owner.to_lowercase(),
            repository.to_lowercase(),
            number.clone(),
        )) {
            lookups.push(Lookup {
                owner,
                repository,
                number,
                url,
            });
        }
    }
    if lookups.is_empty() {
        return Vec::new();
    }
    let answer = resolve_executable("gh").and_then(|gh| {
        let mut query = String::from("query {\n");
        for (index, lookup) in lookups.iter().take(CHECKED_GITHUB_ITEMS).enumerate() {
            let Lookup {
                owner,
                repository,
                number,
                ..
            } = lookup;
            query.push_str(&format!(
                "q{index}: repository(owner: \"{owner}\", name: \"{repository}\") {{ issueOrPullRequest(number: {number}) {{ ...f }} }}\n"
            ));
        }
        query.push_str(
            "}\nfragment f on IssueOrPullRequest {\n... on Issue { title url state createdAt closedAt }\n... on PullRequest { title url state isDraft createdAt closedAt mergedAt }\n}",
        );
        let output = Command::new(gh)
            .args(["api", "graphql", "-f", &format!("query={query}")])
            .output()
            .ok()?;
        // GraphQL answers what it could resolve and lists the rest as errors in the same body, and gh
        // prints that body either way; only a body that never arrived is no answer at all.
        serde_json::from_slice::<serde_json::Value>(&output.stdout).ok()
    });
    // Dropping a reference takes GitHub's word for it: a NOT_FOUND filed against the alias. An item
    // that is merely null — a resolver that failed some other way in an otherwise partial answer —
    // proved nothing.
    let not_found: HashSet<&str> = answer
        .as_ref()
        .and_then(|body| body["errors"].as_array())
        .map(|errors| {
            errors
                .iter()
                .filter(|error| error["type"].as_str() == Some("NOT_FOUND"))
                .filter_map(|error| error["path"][0].as_str())
                .collect()
        })
        .unwrap_or_default();
    let mut found = Vec::new();
    for (index, lookup) in lookups.iter().enumerate() {
        let alias = format!("q{index}");
        let repository = answer
            .as_ref()
            .filter(|_| index < CHECKED_GITHUB_ITEMS)
            .map(|body| &body["data"][alias.as_str()]);
        match repository {
            Some(repository) if repository["issueOrPullRequest"].is_object() => {
                let item = &repository["issueOrPullRequest"];
                // Merged and draft are pull-request states of their own; issues only answer open or
                // closed, and only a pull request carries isDraft at all.
                let state = match item["state"].as_str() {
                    Some("MERGED") => "merged",
                    Some("CLOSED") => "closed",
                    _ if item["isDraft"].as_bool() == Some(true) => "draft",
                    _ => "open",
                };
                let occurred_at = item[match state {
                    "merged" => "mergedAt",
                    "closed" => "closedAt",
                    _ => "createdAt",
                }]
                .as_str()
                .map(str::to_owned);
                found.push(GitHubItem {
                    url: item["url"]
                        .as_str()
                        .map_or_else(|| lookup.url.clone(), str::to_owned),
                    title: item["title"].as_str().map(str::to_owned),
                    state: Some(state.to_owned()),
                    occurred_at,
                });
            }
            // The repository was read and searched, and the number names nothing in it.
            Some(repository) if !repository.is_null() && not_found.contains(alias.as_str()) => {}
            _ => found.push(GitHubItem {
                url: lookup.url.clone(),
                title: None,
                state: None,
                occurred_at: None,
            }),
        }
    }
    found
}

// The check waits on a process and a network round trip, so the run is moved off the runtime the rest
// of Lite's commands share rather than holding one of its workers for the length of it.
#[tauri::command]
async fn github_items(urls: Vec<String>) -> Vec<GitHubItem> {
    // A run that never finished answered nothing, and nothing is not evidence that a link names
    // nothing, so the links come back the way they were printed rather than as an empty panel.
    let unanswered: Vec<GitHubItem> = urls
        .iter()
        .filter(|url| github_item_parts(url).is_some())
        .map(|url| GitHubItem {
            url: url.clone(),
            title: None,
            state: None,
            occurred_at: None,
        })
        .collect();
    tauri::async_runtime::spawn_blocking(move || check_github_items(urls))
        .await
        .unwrap_or(unanswered)
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
    // Each platform opens the stream itself so there is something for the read timeouts to apply to.
    // Handing the address straight to the websocket leaves the stream out of reach, and a server that
    // stops answering then holds the session tab open with nothing left to time it out.
    #[cfg(unix)]
    let (address, stream) = (
        "ws://localhost/",
        std::os::unix::net::UnixStream::connect(
            endpoint
                .strip_prefix("unix://")
                .ok_or("Invalid Codex endpoint")?,
        )
        .map_err(|error| error.to_string())?,
    );
    #[cfg(windows)]
    let (address, stream) = (
        endpoint,
        std::net::TcpStream::connect(
            endpoint
                .strip_prefix("ws://")
                .ok_or("Invalid Codex endpoint")?,
        )
        .map_err(|error| error.to_string())?,
    );
    stream
        .set_read_timeout(Some(CODEX_CONNECT_TIMEOUT))
        .map_err(|error| error.to_string())?;
    let (socket, _) = tungstenite::client(address, stream).map_err(|error| error.to_string())?;
    codex_exchange(socket, requests, |stream| {
        stream
            .set_read_timeout(Some(CODEX_REQUEST_TIMEOUT))
            .map_err(|error| error.to_string())
    })
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

fn file_tail(path: &Path) -> Option<String> {
    const TAIL_BYTES: u64 = 256 * 1024;
    let mut file = fs::File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    file.seek(SeekFrom::Start(length.saturating_sub(TAIL_BYTES)))
        .ok()?;
    let mut tail = Vec::new();
    file.take(TAIL_BYTES).read_to_end(&mut tail).ok()?;
    Some(String::from_utf8_lossy(&tail).into_owned())
}

// Codex defines context as raw total tokens, including reasoning, less its discounted baseline.
fn codex_context(path: &Path) -> Option<UsageSnapshot> {
    const BASELINE_TOKENS: u64 = 12_000;
    let (tokens, window) = file_tail(path)?
        .lines()
        .rev()
        .filter(|line| line.contains("token_count"))
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .find_map(|event| {
            let info = event.pointer("/payload/info")?;
            Some((
                info.pointer("/last_token_usage/total_tokens")
                    .and_then(serde_json::Value::as_u64)?,
                info.get("model_context_window")
                    .and_then(serde_json::Value::as_u64)?,
            ))
        })?;
    let effective = window
        .checked_sub(BASELINE_TOKENS)
        .filter(|effective| *effective > 0)?;
    Some(UsageSnapshot {
        context_used_percent: Some(
            (tokens.saturating_sub(BASELINE_TOKENS) as f64 / effective as f64 * 100.0)
                .clamp(0.0, 100.0),
        ),
        context_window: Some(window),
        context_tokens: Some(tokens),
        ..UsageSnapshot::default()
    })
}

fn native_context(path: &Path, agent: &str) -> Option<UsageSnapshot> {
    file_tail(path)?
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .find_map(|record| match agent {
            "gemini"
                if record.get("type").and_then(serde_json::Value::as_str) == Some("gemini") =>
            {
                let tokens = record.pointer("/tokens/input")?.as_u64()?;
                (tokens > 0).then(|| UsageSnapshot {
                    context_tokens: Some(tokens),
                    ..UsageSnapshot::default()
                })
            }
            "qwen"
                if record.get("type").and_then(serde_json::Value::as_str) == Some("assistant") =>
            {
                let tokens = record
                    .pointer("/usageMetadata/promptTokenCount")?
                    .as_u64()?;
                let window = record.get("contextWindowSize")?.as_u64()?;
                (tokens > 0 && window > 0).then(|| UsageSnapshot {
                    context_used_percent: Some(
                        (tokens as f64 / window as f64 * 100.0).clamp(0.0, 100.0),
                    ),
                    context_window: Some(window),
                    context_tokens: Some(tokens),
                    ..UsageSnapshot::default()
                })
            }
            _ => None,
        })
}

fn codex_usage(
    server: &CodexServer,
    thread_id: Option<&str>,
    account: bool,
) -> Result<UsageSnapshot, String> {
    let mut requests = Vec::new();
    if account {
        requests.extend([
            (1, "account/rateLimits/read", serde_json::json!({})),
            (2, "account/usage/read", serde_json::json!({})),
        ]);
    }
    if let Some(thread_id) = thread_id {
        requests.push((
            3,
            "thread/read",
            serde_json::json!({"threadId": thread_id, "includeTurns": false}),
        ));
    }
    let responses = codex_requests(server, &requests)?;
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
    let context = responses
        .get(&3)
        .and_then(|response| response.pointer("/thread/path"))
        .and_then(serde_json::Value::as_str)
        .and_then(|path| codex_context(Path::new(path)));
    Ok(UsageSnapshot {
        lifetime_tokens: summary
            .and_then(|value| value.pointer("/summary/lifetimeTokens"))
            .and_then(serde_json::Value::as_u64),
        windows,
        ..context.unwrap_or_default()
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
// Asking costs a login shell, so the answer is cached until Lite itself installs a CLI that changes it.
#[cfg(unix)]
fn user_path() -> Option<String> {
    path_cache().lock().ok().and_then(|path| path.clone())
}

#[cfg(unix)]
fn path_cache() -> &'static Mutex<Option<String>> {
    static PATH: std::sync::OnceLock<Mutex<Option<String>>> = std::sync::OnceLock::new();
    PATH.get_or_init(|| {
        Mutex::new(
            shell_path(&CommandBuilder::new_default_prog().get_shell())
                .or_else(|| shell_path("/bin/sh")),
        )
    })
}

#[cfg(unix)]
fn refresh_user_path() {
    let refreshed = shell_path(&CommandBuilder::new_default_prog().get_shell())
        .or_else(|| shell_path("/bin/sh"));
    if let Ok(mut path) = path_cache().lock() {
        *path = refreshed;
    }
}

#[cfg(windows)]
fn user_path() -> Option<String> {
    path_cache()
        .lock()
        .ok()
        .and_then(|path| path.clone())
        .or_else(|| std::env::var("PATH").ok())
}

#[cfg(windows)]
fn path_cache() -> &'static Mutex<Option<String>> {
    static PATH: std::sync::OnceLock<Mutex<Option<String>>> = std::sync::OnceLock::new();
    PATH.get_or_init(|| Mutex::new(None))
}

#[cfg(windows)]
fn refresh_user_path() {
    let refreshed = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "[Environment]::GetEnvironmentVariable('Path','User')",
        ])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|path| path.trim().to_owned())
        .filter(|path| !path.is_empty());
    if let Some(refreshed) = refreshed
        && let Ok(mut path) = path_cache().lock()
    {
        *path = Some(format!(
            "{refreshed};{}",
            std::env::var("PATH").unwrap_or_default()
        ));
    }
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

fn codex_provider(id: Option<&str>) -> Option<CodexProvider> {
    CODEX_PROVIDERS
        .iter()
        .copied()
        .find(|provider| Some(provider.id) == id)
}

fn api_key_env(agent: &str, provider: Option<&str>) -> Option<(&'static str, &'static str)> {
    if agent == "codex"
        && let Some(provider) = codex_provider(provider)
    {
        return Some((provider.id, provider.env_key));
    }
    match (agent, provider) {
        ("claude", _) => Some(("claude", "ANTHROPIC_API_KEY")),
        ("codex", _) => Some(("codex", "OPENAI_API_KEY")),
        ("gemini", _) => Some(("gemini", "GEMINI_API_KEY")),
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

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum CliAuthMethod {
    Provider,
    ApiKey,
}

struct CliAuth {
    method: CliAuthMethod,
    key_hint: Option<String>,
}

fn key_hint(key: &str) -> String {
    let key = key.trim();
    key.chars()
        .skip(key.chars().count().saturating_sub(4))
        .collect()
}

fn kimi_provider_name(config: &toml_edit::DocumentMut) -> Option<String> {
    let model = config.get("default_model")?.as_str()?;
    config
        .get("models")?
        .get(model)?
        .get("provider")?
        .as_str()
        .map(str::to_owned)
}

fn kimi_env_api_key(provider: &dyn toml_edit::TableLike) -> Option<&'static str> {
    match provider.get("type")?.as_str()? {
        "kimi" => Some("KIMI_API_KEY"),
        "anthropic" => Some("ANTHROPIC_API_KEY"),
        "openai" | "openai_responses" => Some("OPENAI_API_KEY"),
        "google-genai" => Some("GOOGLE_API_KEY"),
        "vertexai" => Some("VERTEXAI_API_KEY"),
        _ => None,
    }
}

fn kimi_auth(app: &AppHandle) -> Option<CliAuth> {
    let config = fs::read_to_string(kimi_home(app).ok()?.join("config.toml")).ok()?;
    let config = config.parse::<toml_edit::DocumentMut>().ok()?;
    let provider = kimi_provider_name(&config)?;
    let provider = config.get("providers")?.get(&provider)?.as_table_like()?;

    let api_key = provider
        .get("api_key")
        .and_then(toml_edit::Item::as_str)
        .filter(|key| !key.trim().is_empty())
        .or_else(|| {
            let name = kimi_env_api_key(provider)?;
            provider
                .get("env")
                .and_then(toml_edit::Item::as_table_like)
                .and_then(|env| env.get(name))
                .and_then(toml_edit::Item::as_str)
                .filter(|key| !key.trim().is_empty())
        });
    if let Some(api_key) = api_key {
        Some(CliAuth {
            method: CliAuthMethod::ApiKey,
            key_hint: Some(key_hint(api_key)),
        })
    } else if provider.get("oauth").is_some() {
        Some(CliAuth {
            method: CliAuthMethod::Provider,
            key_hint: None,
        })
    } else {
        None
    }
}

fn delete_kimi_api_key(app: &AppHandle) -> Result<(), String> {
    let path = kimi_home(app)?.join("config.toml");
    let permissions = fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .permissions();
    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mut config = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|error| error.to_string())?;
    let provider = kimi_provider_name(&config).ok_or("Kimi's default provider is missing")?;
    let provider = config
        .get_mut("providers")
        .and_then(toml_edit::Item::as_table_like_mut)
        .and_then(|providers| providers.get_mut(&provider))
        .and_then(toml_edit::Item::as_table_like_mut)
        .ok_or("Kimi's default provider is missing")?;

    let env_api_key = kimi_env_api_key(provider);
    let removed_env = env_api_key.is_some_and(|name| {
        provider
            .get_mut("env")
            .and_then(toml_edit::Item::as_table_like_mut)
            .is_some_and(|env| env.remove(name).is_some())
    });
    let removed = provider.remove("api_key").is_some() || removed_env;
    if removed {
        write_atomic(&path, config.to_string().as_bytes())?;
        fs::set_permissions(&path, permissions).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn cli_auth(app: &AppHandle, name: &str) -> Option<CliAuth> {
    match name {
        "claude" => claude_signed_in(app).then_some(CliAuth {
            method: CliAuthMethod::Provider,
            key_hint: None,
        }),
        "codex" => codex_home(app)
            .is_ok_and(|home| home.join("auth.json").is_file())
            .then_some(CliAuth {
                method: CliAuthMethod::Provider,
                key_hint: None,
            }),
        name if CODEX_PROVIDERS.iter().any(|provider| provider.id == name) => {
            let provider = codex_provider(Some(name))?;
            (codex_profile_exists(app, provider.id) || codex_declares_provider(app, provider.id))
                .then_some(CliAuth {
                    method: CliAuthMethod::ApiKey,
                    key_hint: None,
                })
        }
        "gemini" => gemini_home(app)
            .is_ok_and(|home| home.join("oauth_creds.json").is_file())
            .then_some(CliAuth {
                method: CliAuthMethod::Provider,
                key_hint: None,
            }),
        "kimi" => kimi_auth(app),
        "qwen" => qwen_home(app)
            .is_ok_and(|home| home.join("oauth_creds.json").is_file())
            .then_some(CliAuth {
                method: CliAuthMethod::Provider,
                key_hint: None,
            }),
        _ => None,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderAuth {
    name: String,
    key_hint: Option<String>,
    cli_auth_method: Option<CliAuthMethod>,
    cli_key_hint: Option<String>,
}

#[tauri::command]
async fn provider_auth(app: AppHandle) -> Result<Vec<ProviderAuth>, String> {
    let keys = load_api_keys(&app);
    Ok(SUPPORTED_KEYS
        .iter()
        .copied()
        .chain(["qwen"])
        .map(|name| {
            let cli_auth = cli_auth(&app, name);
            ProviderAuth {
                name: name.to_owned(),
                // Only the last characters travel to the interface, enough to tell two keys apart.
                key_hint: keys.get(name).map(|key| key_hint(key)),
                cli_auth_method: cli_auth.as_ref().map(|auth| auth.method),
                cli_key_hint: cli_auth.and_then(|auth| auth.key_hint),
            }
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
    if keys.remove(&name).is_some() {
        return write_api_keys(&app, &keys);
    }
    if name == "kimi" {
        return delete_kimi_api_key(&app);
    }
    Ok(())
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

fn agent_executable(agent: &str) -> Option<&'static str> {
    match agent {
        "claude" => Some("claude"),
        "codex" => Some("codex"),
        "gemini" => Some("gemini"),
        "kimi" => Some("kimi"),
        "qwen" => Some("qwen"),
        _ => None,
    }
}

fn agent_builder(agent: &str) -> Result<CommandBuilder, String> {
    let executable = agent_executable(agent).ok_or("Unknown session type")?;
    let path = resolve_executable(executable)
        .ok_or_else(|| format!("Could not find {executable} in your PATH"))?;
    Ok(CommandBuilder::new(path))
}

fn codex_home(app: &AppHandle) -> Result<PathBuf, String> {
    provider_home(app, "CODEX_HOME", ".codex")
}

// Looks only for the section header. Provider credentials in that file are never read.
fn codex_declares_provider(app: &AppHandle, provider: &str) -> bool {
    let Ok(home) = codex_home(app) else {
        return false;
    };
    let Ok(file) = fs::File::open(home.join("config.toml")) else {
        return false;
    };
    BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .any(|line| line.trim() == format!("[model_providers.{provider}]"))
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

fn codex_profile_exists(app: &AppHandle, provider: &str) -> bool {
    codex_home(app).is_ok_and(|home| home.join(format!("{provider}.config.toml")).is_file())
}

fn gemini_home(app: &AppHandle) -> Result<PathBuf, String> {
    provider_home(app, "GEMINI_CLI_HOME", ".gemini")
}

fn qwen_home(app: &AppHandle) -> Result<PathBuf, String> {
    provider_home(app, "QWEN_HOME", ".qwen")
}

fn native_session_path(app: &AppHandle, agent: &str, session_id: &str) -> Option<PathBuf> {
    let (home, directory) = match agent {
        "gemini" => (gemini_home(app), "tmp"),
        "qwen" => (qwen_home(app), "projects"),
        _ => return None,
    };
    let projects = home
        .and_then(|home| fs::read_dir(home.join(directory)).map_err(|error| error.to_string()))
        .ok()?;
    let expected = if agent == "qwen" {
        format!("{session_id}.jsonl")
    } else {
        format!("-{}.jsonl", session_id.chars().take(8).collect::<String>())
    };
    projects.flatten().take(512).find_map(|project| {
        if agent == "qwen" {
            let path = project.path().join("chats").join(&expected);
            return path.is_file().then_some(path);
        }
        fs::read_dir(project.path().join("chats"))
            .ok()?
            .flatten()
            .take(512)
            .find_map(|chat| {
                let name = chat.file_name();
                let name = name.to_string_lossy();
                if name.ends_with(&expected)
                    && fs::File::open(chat.path()).is_ok_and(|file| {
                        BufReader::new(file)
                            .lines()
                            .next()
                            .and_then(Result::ok)
                            .and_then(|line| serde_json::from_str::<serde_json::Value>(&line).ok())
                            .and_then(|value| {
                                value
                                    .get("sessionId")
                                    .and_then(serde_json::Value::as_str)
                                    .map(str::to_owned)
                            })
                            .is_some_and(|id| id == session_id)
                    })
                {
                    Some(chat.path())
                } else {
                    None
                }
            })
    })
}

fn native_session_exists(app: &AppHandle, agent: &str, session_id: &str) -> bool {
    native_session_path(app, agent, session_id).is_some()
}

fn kimi_home(app: &AppHandle) -> Result<PathBuf, String> {
    provider_home(app, "KIMI_CODE_HOME", ".kimi-code")
}

fn kimi_context(app: &AppHandle, session_id: &str) -> Option<UsageSnapshot> {
    let sessions = fs::read_dir(kimi_home(app).ok()?.join("sessions")).ok()?;
    let path = sessions
        .flatten()
        .take(512)
        .map(|workspace| {
            workspace
                .path()
                .join(session_id)
                .join("agents/main/wire.jsonl")
        })
        .find(|path| path.is_file())?;
    file_tail(&path)?
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .find_map(|record| {
            if record.get("type").and_then(serde_json::Value::as_str) != Some("usage.record")
                || record.get("usageScope").and_then(serde_json::Value::as_str) != Some("turn")
            {
                return None;
            }
            let usage = record.get("usage")?;
            let tokens = [
                "inputOther",
                "inputCacheRead",
                "inputCacheCreation",
                "output",
            ]
            .iter()
            .filter_map(|key| usage.get(key).and_then(serde_json::Value::as_u64))
            .sum();
            (tokens > 0).then(|| UsageSnapshot {
                context_tokens: Some(tokens),
                ..UsageSnapshot::default()
            })
        })
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
) -> Result<CommandBuilder, String> {
    let mut command = match agent {
        "claude" => {
            let mut command = agent_builder(agent)?;
            let session_id = provider_session_id.unwrap_or(session_id);
            if resume {
                command.args(["--resume", session_id]);
            } else {
                // Naming the session after its folder is the one thing that stops Claude Code from
                // naming it after what it is doing, and that name is what the tab is titled with.
                command.args(["--session-id", session_id]);
            }
            command
        }
        "codex" => {
            let mut command = agent_builder(agent)?;
            // Codex otherwise suppresses notifications while its terminal is focused and its automatic
            // method falls back to BEL for Lite's generic TERM. Keep the override local to this launch.
            command.args(["-c", r#"tui.notification_method="osc9""#]);
            command.args(["-c", r#"tui.notification_condition="always""#]);
            // Providers are selected per launch so the user's default Codex provider stays untouched.
            if let Some(provider) = codex_provider(provider) {
                let key = saved_api_key(app, agent, Some(provider.id)).is_some();
                if !key && codex_profile_exists(app, provider.id) {
                    // A profile the user wrote owns the whole model configuration, catalog included.
                    command.args(["--profile", provider.id]);
                } else {
                    if key {
                        // A key held by Lite defines the provider inline and is read from the
                        // environment, so no Codex configuration file has to exist or be written.
                        for override_value in [
                            format!("model_providers.{}.name=\"{}\"", provider.id, provider.name),
                            format!(
                                "model_providers.{}.base_url=\"{}\"",
                                provider.id, provider.base_url
                            ),
                            format!("model_providers.{}.wire_api=\"responses\"", provider.id),
                            format!(
                                "model_providers.{}.env_key=\"{}\"",
                                provider.id, provider.env_key
                            ),
                        ] {
                            command.args(["-c", &override_value]);
                        }
                    }
                    command.args(["-c", &format!("model_provider=\"{}\"", provider.id)]);
                    command.args(["-c", &format!("model=\"{}\"", provider.model)]);
                    if let Some(catalog) = (provider.id == "deepseek"
                        && !codex_declares_catalog(app))
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
        "gemini" => {
            let mut command = agent_builder(agent)?;
            command.args(if resume {
                ["--resume", session_id]
            } else {
                ["--session-id", session_id]
            });
            command
        }
        "kimi" => {
            // Only an exact id resumes. `--continue` would reopen whatever ran last in the directory,
            // which two tabs there would both land on, and it creates no entry for discovery to record,
            // so the tab could never learn which session it is showing.
            let mut command = agent_builder(agent)?;
            if let Some(provider_session_id) = provider_session_id {
                command.args(["--session", provider_session_id]);
            }
            command
        }
        "qwen" => {
            let mut command = agent_builder(agent)?;
            command.args(if resume {
                ["--resume", session_id]
            } else {
                ["--session-id", session_id]
            });
            command
        }
        "shell" => {
            let mut command = CommandBuilder::new_default_prog();
            #[cfg(target_os = "macos")]
            command.env("TERM_PROGRAM", "Apple_Terminal");
            #[cfg(target_os = "macos")]
            command.env("TERM_SESSION_ID", session_id);
            command
        }
        _ => return Err("Unknown session type".into()),
    };
    if let Some(path) = user_path() {
        command.env("PATH", path);
    }
    // The key reaches the CLI through the variable it already reads, and only for this session.
    if let Some((_, variable)) = api_key_env(agent, provider)
        && let Some(key) = saved_api_key(app, agent, provider)
    {
        command.env(variable, &key);
        if agent == "gemini" {
            command.env("GEMINI_DEFAULT_AUTH_TYPE", "gemini-api-key");
        }
    }
    Ok(command)
}

// Each CLI owns its sign-in and opens the browser itself, so Lite only runs the command and shows it.
fn login_command(agent: &str) -> Result<CommandBuilder, String> {
    let mut command = match agent {
        "claude" => {
            let mut command = agent_builder(agent)?;
            command.args(["auth", "login"]);
            command
        }
        "codex" => {
            let mut command = agent_builder(agent)?;
            command.arg("login");
            command
        }
        "gemini" => agent_builder(agent)?,
        "kimi" => {
            let mut command = agent_builder(agent)?;
            command.arg("login");
            command
        }
        "qwen" => agent_builder(agent)?,
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
    installable: bool,
    detail: String,
}

#[tauri::command]
async fn agent_availability(
    app: AppHandle,
    agent: String,
    provider: Option<String>,
) -> Result<Availability, String> {
    let missing = match agent.as_str() {
        "claude" => "Install the Claude Code CLI, then sign in with `claude`.",
        "codex" => "Install the Codex CLI, then sign in with `codex login`.",
        "gemini" => {
            "Install Gemini CLI with `npm install -g @google/gemini-cli`, then run `gemini`."
        }
        "kimi" => {
            if cfg!(windows) {
                "Install Git for Windows, then run `irm https://code.kimi.com/kimi-code/install.ps1 | iex` in PowerShell."
            } else {
                "Install Kimi Code with `curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash`."
            }
        }
        "qwen" => {
            "Install Qwen Code with `npm install -g @qwen-code/qwen-code@latest`, then run `qwen`."
        }
        "shell" => {
            return Ok(Availability {
                available: true,
                installable: false,
                detail: String::new(),
            });
        }
        _ => return Err("Unknown session type".into()),
    };
    if !agent_executable(&agent).is_some_and(executable_exists) {
        return Ok(Availability {
            available: false,
            installable: true,
            detail: missing.into(),
        });
    }
    if agent == "codex"
        && let Some(codex_provider) = codex_provider(provider.as_deref())
    {
        let configured = saved_api_key(&app, &agent, provider.as_deref()).is_some()
            || codex_profile_exists(&app, codex_provider.id)
            || codex_declares_provider(&app, codex_provider.id);
        return Ok(Availability {
            available: configured,
            installable: false,
            detail: if configured {
                String::new()
            } else {
                format!(
                    "Save a {} key in Lite's settings, or add a {} provider to your Codex configuration. Either way Lite launches `{}` through it.",
                    codex_provider.name, codex_provider.name, codex_provider.model
                )
            },
        });
    }
    Ok(Availability {
        available: true,
        installable: false,
        detail: String::new(),
    })
}

#[tauri::command]
async fn install_agent(agent: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut command = if agent == "kimi" || agent == "claude" {
            let url = if agent == "kimi" {
                "https://code.kimi.com/kimi-code/install"
            } else {
                "https://claude.ai/install"
            };
            #[cfg(windows)]
            {
                let powershell = resolve_executable("powershell")
                    .ok_or("Could not find PowerShell in your PATH")?;
                let mut command = Command::new(powershell);
                command
                    .args(["-NoProfile", "-Command"])
                    .arg(format!("irm {url}.ps1 | iex"));
                command
            }
            #[cfg(unix)]
            {
                let mut command = Command::new("/bin/sh");
                command.arg("-c").arg(format!("curl -fsSL {url}.sh | bash"));
                command
            }
        } else {
            let package = match agent.as_str() {
                "codex" => "@openai/codex@latest",
                "gemini" => "@google/gemini-cli@latest",
                "qwen" => "@qwen-code/qwen-code@latest",
                _ => return Err("This session type cannot be installed automatically".into()),
            };
            let npm = resolve_executable("npm").ok_or("Install Node.js and npm first")?;
            let mut command = Command::new(npm);
            command.args(["install", "-g", package]);
            command
        };
        if let Some(path) = user_path() {
            command.env("PATH", path);
        }
        command.stdout(Stdio::null()).stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not run the installer: {error}"))?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or("Could not read installer errors")?;
        let mut detail = Vec::with_capacity(16_384);
        let mut buffer = [0_u8; 4096];
        while let Ok(count) = stderr.read(&mut buffer) {
            if count == 0 {
                break;
            }
            detail.extend_from_slice(&buffer[..count]);
            if detail.len() > 16_384 {
                detail.drain(..detail.len() - 16_384);
            }
        }
        let status = child
            .wait()
            .map_err(|error| format!("Could not finish the installer: {error}"))?;
        if status.success() {
            refresh_user_path();
            let executable = agent_executable(&agent).ok_or("Unknown session type")?;
            let path = resolve_executable(executable)
                .ok_or_else(|| format!("Installed {agent}, but could not find it in your PATH"))?;
            let mut probe = Command::new(path);
            probe
                .arg("--version")
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            if let Some(path) = user_path() {
                probe.env("PATH", path);
            }
            return probe
                .status()
                .map_err(|error| format!("Installed {agent}, but could not run it: {error}"))?
                .success()
                .then_some(())
                .ok_or_else(|| {
                    format!(
                        "Installed {agent}, but it cannot run with the current system requirements"
                    )
                });
        }
        let detail = String::from_utf8_lossy(&detail);
        let detail = detail.trim();
        Err(if detail.is_empty() {
            format!("The {agent} installer exited with {status}")
        } else {
            detail.to_owned()
        })
    })
    .await
    .map_err(|error| format!("Could not finish the install: {error}"))?
}

#[tauri::command]
async fn agent_update_available(agent: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let executable = agent_executable(&agent).ok_or("Unknown session type")?;
        let Some(executable) = resolve_executable(executable) else {
            return Ok(false);
        };
        let package = match agent.as_str() {
            "claude" => "@anthropic-ai/claude-code",
            "codex" => "@openai/codex",
            "gemini" => "@google/gemini-cli",
            "kimi" => "@moonshot-ai/kimi-code",
            "qwen" => "@qwen-code/qwen-code",
            _ => return Err("Unknown session type".into()),
        };
        let npm = resolve_executable("npm").ok_or("Could not check for updates without npm")?;
        let run = |program: &Path, args: &[&str]| -> Result<String, String> {
            let mut command = Command::new(program);
            command.args(args);
            if let Some(path) = user_path() {
                command.env("PATH", path);
            }
            let output = command.output().map_err(|error| error.to_string())?;
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
            } else {
                Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
            }
        };
        let version = |output: &str| {
            output.split_whitespace().find_map(|word| {
                let word = word.trim_matches(|character: char| {
                    !character.is_ascii_alphanumeric() && !['.', '-', '+'].contains(&character)
                });
                (word.contains('.')
                    && word.starts_with(|character: char| character.is_ascii_digit()))
                .then(|| word.to_owned())
            })
        };
        let current = version(&run(&executable, &["--version"])?)
            .ok_or("Could not read the installed version")?;
        let latest = version(&run(
            &npm,
            &[
                "view",
                package,
                "version",
                "--fetch-timeout=5000",
                "--fetch-retries=0",
            ],
        )?)
        .ok_or("Could not read the latest version")?;
        Ok(current != latest)
    })
    .await
    .map_err(|error| format!("Could not check for updates: {error}"))?
}

#[tauri::command]
async fn open_setup_docs(agent: String, provider: Option<String>) -> Result<(), String> {
    if agent == "codex"
        && let Some(provider) = codex_provider(provider.as_deref())
    {
        return open_external(provider.setup_url);
    }
    let url = match (agent.as_str(), provider.as_deref()) {
        ("claude", _) => "https://code.claude.com/docs/en/setup",
        ("codex", _) => "https://developers.openai.com/codex/cli",
        ("gemini", _) => "https://google-gemini.github.io/gemini-cli/",
        ("kimi", _) => {
            "https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html"
        }
        ("qwen", _) => "https://qwenlm.github.io/qwen-code-docs/en/",
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

// A session root has already been chosen by the user and registered with Lite. Resolve that grant
// again here so the interface cannot ask the operating system to open an arbitrary path.
#[tauri::command]
fn open_directory(root_id: String, roots: State<'_, Roots>) -> Result<(), String> {
    let path = root_path(&roots, &root_id)?;
    open_external(&path_text(&path))
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

fn configure_session_command(command: &mut CommandBuilder, cwd: &Path, theme: Option<&str>) {
    command.cwd(path_text(cwd));
    command.env("TERM", "xterm-256color");
    // A launched app inherits no locale, so a session copies its own UTF-8 as Mac Roman: `─` as `‚îÄ`.
    #[cfg(target_os = "macos")]
    command.env("LC_CTYPE", "UTF-8");
    // The conventional hint for which way a terminal is shaded, so a CLI picks a readable palette.
    command.env(
        "COLORFGBG",
        if theme == Some("light") {
            "0;15"
        } else {
            "15;0"
        },
    );
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
    cwd: String,
    mut provider_session_id: Option<String>,
    agent: String,
    provider: Option<String>,
    mode: Option<String>,
    theme: Option<String>,
    resume: bool,
    cols: u16,
    rows: u16,
) -> Result<Option<String>, String> {
    if !roots
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .contains_key(&root_id)
    {
        uuid::Uuid::parse_str(&root_id).map_err(|_| "Invalid folder permission")?;
        let path = fs::canonicalize(cwd).map_err(|_| MISSING_DIRECTORY)?;
        if is_sensitive_root(&path) {
            return Err("Credential and configuration folders cannot be opened".into());
        }
        update_roots(&app, &roots, |roots| {
            roots.entry(root_id.clone()).or_insert(path);
        })?;
    }
    let cwd = root_path(&roots, &root_id)?;
    // A sign-in runs the provider's own login command and owns no session of its own.
    let signing_in = mode.as_deref() == Some("login");
    // A tab whose provider history was removed starts again instead of becoming permanently unusable.
    let claude_launch = (resume && !signing_in && agent == "claude")
        .then(|| claude_launch_id(&app, provider_session_id.as_deref().unwrap_or(&session_id)));
    let mut resume = resume
        && match agent.as_str() {
            "claude" => claude_launch.as_ref().is_some_and(|(_, resume)| *resume),
            "gemini" | "qwen" => native_session_exists(&app, &agent, &session_id),
            _ => true,
        };
    // The tab keeps the id it was given so the next launch reopens the same conversation, and a
    // conversation another tab already owns is left to it rather than written by both.
    if let Some((claude_id, _)) = claude_launch.filter(|(id, _)| id != &session_id) {
        let claimed = update_provider_session(
            &app,
            &provider_sessions,
            &session_id,
            Some(claude_id.clone()),
        )?;
        provider_session_id = Some(if claimed {
            claude_id
        } else {
            resume = false;
            uuid::Uuid::new_v4().to_string()
        });
    }
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
        )?
    };
    if !signing_in && agent == "claude" {
        let settings = claude_settings(&app, &session_id, &run_id)?;
        command.args(["--settings", &path_text(&settings)]);
    }
    configure_session_command(&mut command, &cwd, theme.as_deref());
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
            alive: Arc::new(AtomicBool::new(true)),
            agent_watch: Arc::new(AtomicU64::new(0)),
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

fn is_agent_process(process: &sysinfo::Process, agent: &str) -> bool {
    let name = process.name().to_string_lossy().to_ascii_lowercase();
    if name.strip_suffix(".exe").unwrap_or(&name) == agent {
        return true;
    }
    process.cmd().iter().any(|argument| {
        let argument = argument.to_string_lossy().to_ascii_lowercase();
        let executable = Path::new(&argument)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        executable.strip_suffix(".exe").unwrap_or(executable) == agent
            || (agent == "codex" && executable == "codex.js")
            || (agent == "gemini" && executable == "gemini.js")
            || (agent == "kimi" && argument.contains("kimi-code"))
            || (agent == "qwen" && argument.contains("qwen-code"))
    })
}

fn agent_descendants(system: &System, root: sysinfo::Pid, agent: &str) -> Vec<sysinfo::Pid> {
    system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            if !is_agent_process(process, agent) {
                return None;
            }
            let mut parent = process.parent();
            while let Some(ancestor) = parent {
                if ancestor == root {
                    return Some(*pid);
                }
                parent = system
                    .process(ancestor)
                    .and_then(|process| process.parent());
            }
            None
        })
        .collect()
}

#[tauri::command]
fn watch_shell_agent(
    app: AppHandle,
    sessions: State<Sessions>,
    session_id: String,
    agent: String,
) -> Result<(), String> {
    if !matches!(
        agent.as_str(),
        "claude" | "codex" | "gemini" | "kimi" | "qwen"
    ) {
        return Err("Unknown agent".into());
    }
    let (root, run_id, alive, agent_watch) = {
        let sessions = sessions.0.lock().map_err(|error| error.to_string())?;
        let session = sessions.get(&session_id).ok_or("Session is not running")?;
        let root = session
            .child
            .process_id()
            .ok_or("Session has no process id")?;
        (
            sysinfo::Pid::from_u32(root),
            session.run_id.clone(),
            Arc::clone(&session.alive),
            Arc::clone(&session.agent_watch),
        )
    };
    thread::spawn(move || {
        let discover = ProcessRefreshKind::nothing()
            .with_cmd(UpdateKind::OnlyIfNotSet)
            .without_tasks();
        let mut system = System::new();
        let mut processes = Vec::new();
        for _ in 0..10 {
            if !alive.load(Ordering::Relaxed) {
                return;
            }
            system.refresh_processes_specifics(ProcessesToUpdate::All, true, discover);
            processes = agent_descendants(&system, root, &agent);
            if !processes.is_empty() {
                break;
            }
            thread::sleep(Duration::from_millis(500));
        }
        if processes.is_empty() || !alive.load(Ordering::Relaxed) {
            return;
        }
        let watch = agent_watch.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = app.emit(
            "shell-agent",
            ShellAgent {
                session_id: session_id.clone(),
                run_id: run_id.clone(),
                agent: Some(agent),
            },
        );
        // Discovery is brief; a long-running agent retains and refreshes only its matching child PIDs.
        system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&processes),
            true,
            ProcessRefreshKind::nothing().without_tasks(),
        );
        loop {
            thread::sleep(Duration::from_secs(1));
            if !alive.load(Ordering::Relaxed) || agent_watch.load(Ordering::Relaxed) != watch {
                return;
            }
            system.refresh_processes_specifics(
                ProcessesToUpdate::Some(&processes),
                true,
                ProcessRefreshKind::nothing().without_tasks(),
            );
            processes.retain(|pid| system.process(*pid).is_some());
            if processes.is_empty() {
                let _ = app.emit(
                    "shell-agent",
                    ShellAgent {
                        session_id,
                        run_id,
                        agent: None,
                    },
                );
                return;
            }
        }
    });
    Ok(())
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
    let mut sessions = sessions.0.lock().map_err(|error| error.to_string())?;
    if let Some(session) = sessions.get_mut(&session_id) {
        stop_pty(session)?;
        sessions.remove(&session_id);
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
    if let Err(error) = fs::remove_dir_all(directory.join(format!("activity-{session_id}")))
        && error.kind() != std::io::ErrorKind::NotFound
    {
        return Err(error.to_string());
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
            || name == ".venv"
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

fn bounded_git_lines(
    git: &Path,
    path: &Path,
    args: &[&str],
) -> Result<(Vec<String>, bool), String> {
    let mut child = Command::new(git)
        .arg("-C")
        .arg(path_text(path))
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| error.to_string())?;
    let stdout = child.stdout.take().ok_or("Could not read Git status")?;
    let mut lines = BufReader::new(stdout)
        .lines()
        .take(MAX_GIT_CHANGES + 1)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let truncated = lines.len() > MAX_GIT_CHANGES;
    if truncated {
        lines.truncate(MAX_GIT_CHANGES);
        let _ = child.kill();
    }
    let status = child.wait().map_err(|error| error.to_string())?;
    if !status.success() && !truncated {
        return Err("Could not read Git status".into());
    }
    Ok((lines, truncated))
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
    let (changes, changes_truncated) = bounded_git_lines(&git, &path, &["status", "--short"])?;
    let line_diffs = Command::new(&git)
        .arg("-C")
        .arg(&root)
        .args(["diff", "--numstat", "-z", "HEAD"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()
        .and_then(|mut child| {
            let stdout = child.stdout.take()?;
            let mut output = Vec::new();
            if stdout
                .take(MAX_GIT_DIFF_BYTES + 1)
                .read_to_end(&mut output)
                .is_err()
            {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            if output.len() > MAX_GIT_DIFF_BYTES as usize {
                output.truncate(MAX_GIT_DIFF_BYTES as usize);
                let _ = child.kill();
                let _ = child.wait();
            } else if !child.wait().ok()?.success() {
                return None;
            }
            if output.last() != Some(&0) {
                output.truncate(
                    output
                        .iter()
                        .rposition(|byte| *byte == 0)
                        .map_or(0, |i| i + 1),
                );
            }
            Some(output)
        })
        .map(|output| {
            let mut diffs = BTreeMap::<String, LineDiff>::new();
            let mut records = output.split(|byte| *byte == 0);
            while let Some(header) = records.next().filter(|record| !record.is_empty()) {
                let mut fields = header.splitn(3, |byte| *byte == b'\t');
                let Some(additions) = fields
                    .next()
                    .and_then(|value| String::from_utf8_lossy(value).parse::<u64>().ok())
                else {
                    continue;
                };
                let Some(deletions) = fields
                    .next()
                    .and_then(|value| String::from_utf8_lossy(value).parse::<u64>().ok())
                else {
                    continue;
                };
                let Some(path) = fields.next() else { continue };
                // With -z, a rename leaves the header path empty and follows it with old and new paths.
                let path = if path.is_empty() {
                    let _ = records.next();
                    records.next()
                } else {
                    Some(path)
                };
                let Some(path) = path else { continue };
                diffs.insert(
                    String::from_utf8_lossy(path).into_owned(),
                    LineDiff {
                        additions,
                        deletions,
                    },
                );
            }
            diffs
        })
        .unwrap_or_default();
    Ok(Some(GitStatus {
        branch: if branch.is_empty() {
            "Detached HEAD".into()
        } else {
            branch
        },
        worktree: root,
        changes,
        line_diffs,
        changes_truncated,
    }))
}

// A remote is stored the way the repository was cloned, and only its https form opens in a browser.
// Anything else is left alone rather than guessed at, so a link is offered only when it will work.
fn browse_url(remote: &str) -> Option<String> {
    let remote = remote.trim().trim_end_matches('/');
    let remote = remote.strip_suffix(".git").unwrap_or(remote);
    // The scp form names a user, and not everyone's is git.
    if !remote.contains("://") {
        let (authority, repository) = remote.split_once(':')?;
        let host = authority
            .rsplit_once('@')
            .map_or(authority, |(_, host)| host);
        return Some(format!("https://{host}/{repository}"));
    }
    let ssh = remote.strip_prefix("ssh://");
    let rest = ssh.or_else(|| remote.strip_prefix("https://"))?;
    let (authority, repository) = rest.split_once('/')?;
    // Whatever the clone was made with — a token, an account name — is Git's business and has none in a
    // link, still less in a browser's address bar and history. An ssh port reaches nothing a browser
    // can read, where an https one is the site itself.
    let host = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    if ssh.is_some() && host.contains(':') {
        return None;
    }
    Some(format!("https://{host}/{repository}"))
}

// The repository a folder was cloned from, asked for on its own: naming it costs one git call, where
// the full status reads the whole worktree.
#[tauri::command]
async fn git_remote(roots: State<'_, Roots>, root_id: String) -> Result<Option<String>, String> {
    let path = root_path(&roots, &root_id)?;
    let git = resolve_executable("git").unwrap_or_else(|| "git".into());
    Ok(
        command_output(&git, &path, &["remote", "get-url", "origin"])
            .ok()
            .and_then(|remote| browse_url(&remote)),
    )
}

// The repository that owns a path's worktrees, reached from any of them: a normal repository's
// common git dir is its main checkout's .git, so the checkout is the owner and this — not the
// path's own toplevel — is the identity sessions sharing a repository agree on. A bare
// repository has no checkout, so the common dir itself is the owner and git commands run there.
fn main_checkout(git: &Path, path: &Path) -> Result<PathBuf, String> {
    let common = command_output(git, path, &["rev-parse", "--git-common-dir"])?;
    let common = match Path::new(&common).is_absolute() {
        true => PathBuf::from(common),
        false => path.join(common),
    };
    let common = fs::canonicalize(common).map_err(|error| error.to_string())?;
    if common.file_name() == Some(std::ffi::OsStr::new(".git")) {
        return common
            .parent()
            .map(|parent| parent.to_path_buf())
            .ok_or("The repository's git folder has no parent".into());
    }
    Ok(common)
}

struct WorktreeCandidate {
    path: PathBuf,
    branch: String,
}

fn next_worktree(git: &Path, repo: &Path, checkout: &Path) -> Result<WorktreeCandidate, String> {
    let parent = checkout
        .parent()
        .ok_or("The repository root has no parent folder")?;
    let name = checkout
        .file_name()
        .ok_or("The repository root names no folder")?
        .to_string_lossy();
    let registered = command_output(git, repo, &["worktree", "list", "--porcelain"])?;
    let branches: HashSet<String> = command_output(
        git,
        repo,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/heads/lite/worktree-*",
        ],
    )?
    .lines()
    .map(str::to_owned)
    .collect();
    for index in 1.. {
        let candidate = parent.join(format!("{name}-worktree-{index}"));
        let registration = format!("worktree {}", path_text(&candidate));
        let branch = format!("lite/worktree-{index}");
        if !candidate.exists()
            && !registered.lines().any(|line| line == registration)
            && !branches.contains(&branch)
        {
            return Ok(WorktreeCandidate {
                path: candidate,
                branch,
            });
        }
    }
    unreachable!()
}

fn owned_worktree(git: &Path, repo: &Path, root_id: &str, branch: &str) -> Option<PathBuf> {
    command_output(git, repo, &["worktree", "list", "--porcelain"])
        .ok()?
        .lines()
        .filter_map(|line| line.strip_prefix("worktree "))
        .map(PathBuf::from)
        .find(|worktree| {
            command_output(git, worktree, &["symbolic-ref", "--short", "HEAD"])
                .is_ok_and(|current| current == branch)
                && command_output(git, worktree, &["rev-parse", "--absolute-git-dir"])
                    .ok()
                    .and_then(|admin| fs::read_to_string(PathBuf::from(admin).join("lite")).ok())
                    .is_some_and(|owner| owner.trim() == root_id)
        })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Repository {
    branch: String,
    root: String,
    worktree: String,
}

// Whether a folder sits inside a repository, where its main checkout is, and the next sibling path
// available for a Lite worktree. The new-session dialog asks before it has granted anything, so this
// takes the bare path — the same folder the grant would name — and only reads from it.
#[tauri::command]
async fn git_repo(app: AppHandle, path: String) -> Result<Option<Repository>, String> {
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
        return Ok(None);
    }
    // Canonicalized like the grant's path would be, so the root can be compared with session cwds.
    let path = fs::canonicalize(path).map_err(|error| error.to_string())?;
    let git = resolve_executable("git").unwrap_or_else(|| "git".into());
    let Ok(root) = main_checkout(&git, &path) else {
        return Ok(None);
    };
    let checkout = command_output(&git, &path, &["rev-parse", "--show-toplevel"])
        .map(PathBuf::from)
        .unwrap_or_else(|_| root.clone());
    let candidate = next_worktree(&git, &root, &checkout)?;
    Ok(Some(Repository {
        worktree: path_text(&candidate.path),
        branch: candidate.branch,
        root: path_text(&root),
    }))
}

// A session that shares its project with another gets the next numbered sibling folder. A missing
// worktree this grant already owns is recreated here too, through the same marks and transaction.
#[tauri::command]
async fn create_worktree(
    app: AppHandle,
    roots: State<'_, Roots>,
    root_id: String,
    branch: String,
) -> Result<DirectoryGrant, String> {
    grant_known(roots.inner(), &root_id)?;
    create_worktree_inner(&app, roots.inner(), root_id, branch)
}

fn create_worktree_inner(
    app: &AppHandle,
    roots: &Roots,
    root_id: String,
    branch: String,
) -> Result<DirectoryGrant, String> {
    let (folder, recovery) = match root_path(roots, &root_id) {
        Ok(folder) => (folder, None),
        Err(error) => {
            let record = worktrees_path(app)?.join(&root_id);
            let recorded = read_worktree_record(&record).ok_or(error)?;
            (PathBuf::from(&recorded.main), Some(recorded))
        }
    };
    let restoring = recovery.is_some();
    let git = resolve_executable("git").unwrap_or_else(|| "git".into());
    // Anchored at the main checkout even when the session's folder is itself a linked worktree.
    let repo = main_checkout(&git, &folder)?;
    let candidate = match recovery.as_ref() {
        Some(recorded) => {
            if !repo_mark_present(&git, &repo, &root_id, &recorded.branch) {
                return Err(
                    "Lite cannot prove this repository is the one it created the worktree in; nothing is restored"
                        .into(),
                );
            }
            let path = PathBuf::from(&recorded.path);
            if !path.is_dir() && worktree_registered(&git, &repo, &path)? {
                return Err(
                    "Git still registers this missing worktree; repair or remove it with Git before restoring the session"
                        .into(),
                );
            }
            WorktreeCandidate {
                path,
                branch: recorded.branch.clone(),
            }
        }
        None => {
            let checkout = command_output(&git, &folder, &["rev-parse", "--show-toplevel"])
                .map(PathBuf::from)
                .unwrap_or_else(|_| repo.clone());
            next_worktree(&git, &repo, &checkout)?
        }
    };
    let branch = match recovery.as_ref() {
        Some(_) => candidate.branch.as_str(),
        None => match branch.trim() {
            "" => candidate.branch.as_str(),
            branch => branch,
        },
    };
    command_output(&git, &repo, &["check-ref-format", "--branch", branch])
        .map_err(|_| format!("“{branch}” is not a valid branch name"))?;
    // A retry resumes the worktree this grant already marked; a new create takes the next free
    // numbered sibling. Nothing else at a candidate path is ever adopted.
    let owned = owned_worktree(&git, &repo, &root_id, branch);
    let created = owned.is_none();
    let worktree = match owned.as_ref() {
        Some(worktree) => worktree.clone(),
        None => candidate.path,
    };
    // A new branch starts where the selected folder is, not where the main checkout happens to
    // be: a worktree made from a feature worktree keeps the feature's commits. An empty
    // repository has no HEAD; current git starts the unborn branch without a start point, older
    // git needs --orphan for the same start, and the record simply has no ancestor to check later.
    let head = match recovery.as_ref() {
        Some(recorded) => (!recorded.head.is_empty()).then(|| recorded.head.clone()),
        None => command_output(&git, &folder, &["rev-parse", "HEAD"]).ok(),
    };
    let delete_branch = !restoring || !branch_exists(&git, &repo, branch)?;
    let rollback = created.then_some((delete_branch, !restoring));
    let target = path_text(&worktree);
    let mut args = vec!["worktree", "add", "-b", branch, &target];
    if let Some(head) = head.as_deref() {
        args.push(head);
    }
    if owned.is_none() {
        match command_output(&git, &repo, &args) {
            Ok(_) => {}
            // A previous attempt created the branch and lost everything after it — folder,
            // worktree mark, record. The repository's mark vouches for the name, and a branch
            // checked out nowhere is resumed directly instead of failing on it.
            Err(error)
                if branch_exists(&git, &repo, branch)?
                    && repo_mark_present(&git, &repo, &root_id, branch)
                    && !command_output(&git, &repo, &["worktree", "list", "--porcelain"])?
                        .lines()
                        .any(|line| line == format!("branch refs/heads/{branch}")) =>
            {
                if command_output(&git, &repo, &["worktree", "add", &target, branch]).is_err() {
                    return Err(error);
                }
            }
            Err(error) if head.is_none() => {
                if command_output(
                    &git,
                    &repo,
                    &["worktree", "add", "--orphan", "-b", branch, &target],
                )
                .is_err()
                {
                    return Err(error);
                }
            }
            Err(error) => return Err(error),
        }
    }
    // Lite marks the worktrees it makes inside their administrative folder, where git status
    // cannot see it, and the repository itself in its info folder — git's own place for
    // repo-local metadata. Removal asks for these marks: whatever else comes to sit at a
    // recorded path — a main checkout, a planted worktree, a re-clone's — has neither.
    let admin = match command_output(&git, &worktree, &["rev-parse", "--absolute-git-dir"]) {
        Ok(admin) => PathBuf::from(admin),
        Err(error) => {
            return Err(fail_with_rollback(
                error, &git, &repo, &worktree, branch, &root_id, rollback,
            ));
        }
    };
    if let Err(error) = fs::write(admin.join("lite"), &root_id) {
        return Err(fail_with_rollback(
            error.to_string(),
            &git,
            &repo,
            &worktree,
            branch,
            &root_id,
            rollback,
        ));
    }
    let main_git = match command_output(&git, &repo, &["rev-parse", "--absolute-git-dir"]) {
        Ok(main_git) => PathBuf::from(main_git),
        Err(error) => {
            return Err(fail_with_rollback(
                error, &git, &repo, &worktree, branch, &root_id, rollback,
            ));
        }
    };
    if let Err(error) = write_atomic(
        &main_git.join("info").join(format!("lite-{root_id}")),
        branch.as_bytes(),
    ) {
        return Err(fail_with_rollback(
            error, &git, &repo, &worktree, branch, &root_id, rollback,
        ));
    }
    if let Err(error) = record_worktree(
        app,
        &root_id,
        &worktree,
        branch,
        &repo,
        &admin,
        head.as_deref().unwrap_or(""),
    ) {
        return Err(fail_with_rollback(
            error, &git, &repo, &worktree, branch, &root_id, rollback,
        ));
    }
    match grant_directory(app, roots, worktree.clone(), Some(root_id.clone())) {
        Ok(grant) => Ok(grant),
        Err(error) => {
            if !restoring
                && created
                && let Ok(directory) = worktrees_path(app)
            {
                let _ = forget_record(&directory.join(&root_id));
            }
            Err(fail_with_rollback(
                error, &git, &repo, &worktree, branch, &root_id, rollback,
            ))
        }
    }
}

#[tauri::command]
async fn restore_worktree(
    app: AppHandle,
    roots: State<'_, Roots>,
    root_id: String,
    owned_only: bool,
) -> Result<Option<DirectoryGrant>, String> {
    uuid::Uuid::parse_str(&root_id).map_err(|_| "Invalid grant ID")?;
    if !roots
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .contains_key(&root_id)
    {
        return Ok(None);
    }
    match root_path(roots.inner(), &root_id) {
        Ok(_) => return Ok(None),
        Err(error) if error == MISSING_DIRECTORY => {}
        Err(error) => return Err(error),
    }
    let record = worktrees_path(&app)?.join(&root_id);
    let recorded = read_worktree_record(&record).ok_or(MISSING_DIRECTORY)?;
    // A running shell may have left its healthy owned tree and lost only the folder it cd'd into;
    // live recovery leaves that process alone, while startup returns it to the tree it can launch in.
    if Path::new(&recorded.path).is_dir() {
        if owned_only {
            return Ok(None);
        }
        return grant_directory(
            &app,
            roots.inner(),
            PathBuf::from(recorded.path),
            Some(root_id),
        )
        .map(Some);
    }
    create_worktree_inner(&app, roots.inner(), root_id, String::new()).map(Some)
}

// What closing a worktree session needs to know before it asks. recorded is false when Lite has
// no record for the grant — nothing Lite can clean up, the folder is the user's. gone is true
// when the worktree folder is verified deleted, so only metadata is left to prune. force says
// removal will need --force; changes counts the real changes in the way — ignored files and
// submodules only force removal, but are nothing to warn about losing. damaged says the folder's
// git data could not be read: keeping needs no git, but deletion then runs without force so
// git's own checks are the gate. The explicit flags keep user status configuration from hiding
// untracked or ignored files.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeState {
    recorded: bool,
    gone: bool,
    force: bool,
    changes: usize,
    changes_truncated: bool,
    damaged: bool,
    branch: String,
    // The removal target itself, so the close dialog names the folder deletion would actually
    // take: a shell session's cwd may have moved anywhere since the worktree was made.
    path: String,
}

// The state of the recorded worktree — the removal target — not of wherever the session's grant
// points now. Answers for the close dialog; the removal itself re-validates regardless.
#[tauri::command]
async fn worktree_state(
    app: AppHandle,
    roots: State<'_, Roots>,
    root_id: String,
) -> Result<WorktreeState, String> {
    const EMPTY: WorktreeState = WorktreeState {
        recorded: false,
        gone: false,
        force: false,
        changes: 0,
        changes_truncated: false,
        damaged: false,
        branch: String::new(),
        path: String::new(),
    };
    uuid::Uuid::parse_str(&root_id).map_err(|_| "Invalid grant ID")?;
    grant_known(&roots, &root_id)?;
    let record = worktrees_path(&app)?.join(&root_id);
    let Some(recorded) = read_worktree_record(&record) else {
        return Ok(EMPTY);
    };
    // An unborn branch has no immutable ancestor with which Lite can prove ownership, so the
    // dialog names only the folder deletion and the branch is intentionally preserved.
    let branch = if recorded.head.is_empty() {
        String::new()
    } else {
        recorded.branch.clone()
    };
    if !PathBuf::from(&recorded.path).is_dir() {
        return Ok(WorktreeState {
            recorded: true,
            gone: true,
            branch,
            path: recorded.path,
            ..EMPTY
        });
    }
    let path = PathBuf::from(&recorded.path);
    let git = resolve_executable("git").unwrap_or_else(|| "git".into());
    let (lines, changes_truncated) = match bounded_git_lines(
        &git,
        &path,
        &[
            "status",
            "--porcelain",
            "--untracked-files=all",
            "--ignored=matching",
        ],
    ) {
        Ok(result) => result,
        // A folder whose git data cannot be read has nothing to report — but keeping it needs
        // no git, so the close dialog still gets the record.
        Err(_) => {
            return Ok(WorktreeState {
                recorded: true,
                damaged: true,
                branch,
                path: recorded.path,
                ..EMPTY
            });
        }
    };
    let changes = lines.iter().filter(|line| !line.starts_with("!!")).count();
    let ignored = lines.iter().any(|line| line.starts_with("!!"));
    let submodules = !command_output(&git, &path, &["submodule", "status"])
        .unwrap_or_default()
        .is_empty();
    Ok(WorktreeState {
        recorded: true,
        gone: false,
        force: changes > 0 || ignored || submodules,
        changes,
        changes_truncated,
        damaged: false,
        branch,
        path: recorded.path,
    })
}

// Whether the branch exists, asked structurally rather than read from an error message: git
// localizes those. Only exit 1 means absent; a repository that cannot answer is reported.
fn branch_exists(git: &Path, main: &Path, branch: &str) -> Result<bool, String> {
    let reference = format!("refs/heads/{branch}");
    let status = Command::new(git)
        .arg("-C")
        .arg(path_text(main))
        .args(["show-ref", "--verify", "--quiet", &reference])
        .status()
        .map_err(|error| error.to_string())?;
    match status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(format!(
            "Could not check whether branch {branch} exists: {status}"
        )),
    }
}

// Deleting Lite's branch: the name alone is not proof, so the tip is validated first — it must
// exist and still descend from the commit Lite started it at (an agent's own commits on top are
// descendants and go with it as intended). A branch started in an empty repository is retained
// because it has no immutable ancestor to prove ownership. The deletion itself is compare-and-delete:
// the branch goes only if it still points at the tip that was just validated, so a repoint or
// recreation in between is never taken with it. An already-gone or foreign branch is skipped, not
// an error; a validation that cannot answer is reported.
fn delete_branch(git: &Path, main: &Path, branch: &str, head: &str) -> Result<(), String> {
    if branch.is_empty() || head.is_empty() {
        return Ok(());
    }
    let reference = format!("refs/heads/{branch}");
    let tip = match command_output(git, main, &["rev-parse", "--verify", &reference]) {
        Ok(tip) => tip,
        Err(_) => return Ok(()),
    };
    if !head.is_empty()
        && command_output(git, main, &["merge-base", "--is-ancestor", head, &tip]).is_err()
    {
        return Ok(());
    }
    // A branch checked out in another worktree — say, Lite's own worktree moved elsewhere by
    // hand — is not deleted: the record keeps a way back, and the close dialog offers keep.
    let worktrees = command_output(git, main, &["worktree", "list", "--porcelain"])?;
    let checked_out = format!("branch refs/heads/{branch}");
    if worktrees.lines().any(|line| line == checked_out) {
        return Err(format!(
            "Branch {branch} is checked out in a worktree; it is left in place"
        ));
    }
    command_output(git, main, &["update-ref", "-d", &reference, &tip]).map(|_| ())
}

// Whether the repository still registers the path as a worktree. A manual folder deletion
// leaves the registration until it is pruned; Lite's own removal takes it.
fn worktree_registered(git: &Path, main: &Path, path: &Path) -> Result<bool, String> {
    let list = command_output(git, main, &["worktree", "list", "--porcelain"])?;
    let target = format!("worktree {}", path_text(path));
    Ok(list.lines().any(|line| line == target))
}

fn forget_record(record: &Path) -> Result<(), String> {
    match fs::remove_file(record) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

// Removing a worktree is the mirror of creating one, guarded by things the caller cannot shape.
// Everything removal touches — folder, branch, main checkout — comes from the record Lite wrote
// at creation, never from arguments: the caller names only the grant, and the path the grant
// holds now (which a shell session's cd may have moved anywhere) is never a target. The folder
// must carry Lite's mark in its administrative git folder, and the repository Lite's mark in its
// info folder, so anything merely sitting at a recorded path is refused no matter which session
// asks. Force is only as broad as the confirmation it came from, and the tree answers here —
// not from renderer state sampled earlier. An already-gone or recreated branch is no failure;
// any other deletion error is reported.
#[tauri::command]
async fn remove_worktree(
    app: AppHandle,
    roots: State<'_, Roots>,
    root_id: String,
    force: bool,
    dirty_covered: bool,
) -> Result<(), String> {
    uuid::Uuid::parse_str(&root_id).map_err(|_| "Invalid grant ID")?;
    grant_known(&roots, &root_id)?;
    let record = worktrees_path(&app)?.join(&root_id);
    let recorded = read_worktree_record(&record)
        .ok_or("This session's worktree is not one Lite created".to_owned())?;
    let path = PathBuf::from(&recorded.path);
    let git = resolve_executable("git").unwrap_or_else(|| "git".into());
    if !path.is_dir() {
        // The folder went away, and the worktree's own mark went with it, so every destructive
        // step below first asks the repository for Lite's other mark: a replacement repository
        // at the same path has none, and nothing is removed without it.
        let main = PathBuf::from(&recorded.main);
        if !repo_mark_present(&git, &main, &root_id, &recorded.branch) {
            return Err(
                "Lite cannot prove this repository is the one it created the worktree in; nothing is removed"
                    .into(),
            );
        }
        if worktree_registered(&git, &main, &path)? {
            // A filesystem move and a manual deletion both leave this registration behind. Lite
            // cannot distinguish them, so pruning could break a moved worktree that still uses
            // the branch. Retain every ownership record until Git no longer registers the path.
            let owner =
                fs::read_to_string(PathBuf::from(&recorded.admin).join("lite")).map_err(|_| {
                    "The recorded worktree is no longer one Lite can prove it created".to_owned()
                })?;
            if owner.trim() != root_id {
                return Err(
                    "The recorded worktree is no longer one Lite can prove it created".into(),
                );
            }
            return Err(
                "Git still registers this missing worktree; repair or remove it with Git before closing the session"
                    .into(),
            );
        } else if !branch_exists(&git, &main, &recorded.branch)? {
            // Neither registration nor branch: only the record — and the mark — are left.
            remove_repo_mark(&git, &main, &root_id);
            return forget_record(&record);
        }
        // Only the branch, the mark, and the record are left either way, and the branch goes
        // first so a failure can retry.
        delete_branch(&git, &main, &recorded.branch, &recorded.head)?;
        remove_repo_mark(&git, &main, &root_id);
        return forget_record(&record);
    }
    let git_dir = PathBuf::from(command_output(
        &git,
        &path,
        &["rev-parse", "--absolute-git-dir"],
    )?);
    // Only the worktree git made for this grant carries its mark. The folder's own git dir is
    // asked rather than the record, so a main checkout or a planted worktree sitting at the
    // recorded path — neither of which has the mark — is refused no matter what the caller says.
    let owner = fs::read_to_string(git_dir.join("lite")).map_err(|_| {
        "The folder at the recorded path is not the worktree Lite created".to_owned()
    })?;
    if owner.trim() != root_id {
        return Err("The folder at the recorded path is not the worktree Lite created".into());
    }
    // Force is only as broad as the confirmation it came from, and the tree answers here — not
    // from renderer state sampled earlier — so changes written after a narrower approval are
    // never taken. A tree that cannot answer is not force-removed at all.
    if force {
        let status = command_output(
            &git,
            &path,
            &[
                "status",
                "--porcelain",
                "--untracked-files=all",
                "--ignored=matching",
            ],
        )?;
        if !dirty_covered && status.lines().any(|line| !line.starts_with("!!")) {
            return Err(
                "The worktree has changes the confirmation did not cover; close the session again to re-confirm"
                    .into(),
            );
        }
    }
    // Cleanup runs against the owner recorded at creation: the main checkout for a normal
    // repository, the bare directory itself for a bare one.
    let main = PathBuf::from(&recorded.main);
    let target = path_text(&path);
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&target);
    command_output(&git, &main, &args)?;
    // The worktree's mark died with it, so before the branch goes the repository proves itself
    // again with its own mark: a replacement at the same path keeps its branch, and the
    // surviving record lets a retry through the gone path finish the work.
    if !repo_mark_present(&git, &main, &root_id, &recorded.branch) {
        return Err(
            "Lite cannot prove this repository is the one it created the worktree in; the branch is left in place"
                .into(),
        );
    }
    delete_branch(&git, &main, &recorded.branch, &recorded.head)?;
    remove_repo_mark(&git, &main, &root_id);
    forget_record(&record)
}

#[tauri::command]
async fn read_usage(
    app: AppHandle,
    codex_server: State<'_, CodexServer>,
    provider_sessions: State<'_, ProviderSessions>,
    agent: String,
    provider: Option<String>,
    session_id: String,
) -> Result<Option<UsageSnapshot>, String> {
    let provider_session_id = if agent == "codex" || agent == "kimi" {
        provider_sessions
            .0
            .lock()
            .map_err(|error| error.to_string())?
            .get(&session_id)
            .cloned()
    } else {
        None
    };
    match agent.as_str() {
        "claude" => {
            let directory = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            let path = directory.join(format!("usage-{session_id}.json"));
            let mut usage = match fs::read(path) {
                Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string())?,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    UsageSnapshot::default()
                }
                Err(error) => return Err(error.to_string()),
            };
            // Claude's limits are account-wide, while its context and cost belong to this session.
            // Use Claude's newest report for each account-wide limit rather than hiding one when the
            // selected session has not sent a message yet or another report omitted that window.
            if let Ok(entries) = fs::read_dir(directory) {
                let mut latest = [None, None];
                for (modified, window) in entries
                    .flatten()
                    .filter(|entry| {
                        entry.file_name().to_str().is_some_and(|name| {
                            name.starts_with("usage-") && name.ends_with(".json")
                        })
                    })
                    .filter_map(|entry| {
                        let modified = entry.metadata().ok()?.modified().ok()?;
                        let snapshot: UsageSnapshot =
                            serde_json::from_slice(&fs::read(entry.path()).ok()?).ok()?;
                        Some((modified, snapshot.windows))
                    })
                    .flat_map(|(modified, windows)| {
                        windows.into_iter().map(move |window| (modified, window))
                    })
                {
                    let index = match window.label.as_str() {
                        "Current session" | "5 hour" => 0,
                        "Current week" | "7 day" => 1,
                        _ => continue,
                    };
                    if latest[index]
                        .as_ref()
                        .is_none_or(|(current, _)| modified > *current)
                    {
                        latest[index] = Some((modified, window));
                    }
                }
                let windows: Vec<_> = latest
                    .into_iter()
                    .flatten()
                    .map(|(_, window)| window)
                    .collect();
                if !windows.is_empty() {
                    usage.windows = windows;
                }
            }
            for window in &mut usage.windows {
                window.label = match window.label.as_str() {
                    "5 hour" => "Current session".into(),
                    "7 day" => "Current week".into(),
                    _ => continue,
                };
            }
            let now = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map_or(0, |duration| duration.as_secs());
            usage
                .windows
                .retain(|window| window.resets_at.is_none_or(|reset| reset > now));
            Ok((usage.context_used_percent.is_some()
                || usage.context_tokens.is_some_and(|tokens| tokens > 0)
                || usage.cost_usd.is_some_and(|cost| cost > 0.0)
                || !usage.windows.is_empty())
            .then_some(usage))
        }
        "codex" => {
            // Custom providers have local thread context but do not bill OpenAI, so omit only the
            // account requests rather than omitting the whole session.
            let account = codex_provider(provider.as_deref()).is_none();
            if !account && provider_session_id.is_none() {
                return Ok(None);
            }
            codex_usage(&codex_server, provider_session_id.as_deref(), account).map(Some)
        }
        "gemini" | "qwen" => Ok(native_session_path(&app, &agent, &session_id)
            .and_then(|path| native_context(&path, &agent))),
        "kimi" => Ok(provider_session_id
            .as_deref()
            .and_then(|id| kimi_context(&app, id))),
        "shell" => Ok(None),
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

// A local build names the commit it came from instead of the release version it would otherwise be
// mistaken for. It follows main directly so fixes can be used before release assets exist.
#[tauri::command]
fn local_update() -> Result<Option<String>, String> {
    let built = option_env!("LITE_COMMIT").ok_or("This is not a local build")?;
    let repo = option_env!("LITE_REPO").ok_or("This build did not record where it came from")?;
    let git = resolve_executable("git").unwrap_or_else(|| "git".into());
    command_output(
        &git,
        Path::new(repo),
        &["fetch", "--quiet", "origin", "main"],
    )
    .map_err(|_| "Could not fetch origin/main".to_string())?;
    let head = command_output(
        &git,
        Path::new(repo),
        &["rev-parse", "--short", "origin/main"],
    )
    .map_err(|_| format!("Could not read {repo}"))?;
    Ok((head != built).then_some(head))
}

// When this build was made, which for a release is the day it was published.
#[tauri::command]
fn build_date() -> Option<&'static str> {
    option_env!("LITE_DATE")
}

#[tauri::command]
fn local_commit() -> Option<&'static str> {
    option_env!("LITE_COMMIT")
}

// The tree a local build came from, which is the one place a rebuild of it can be run.
#[tauri::command]
fn local_repo() -> Option<&'static str> {
    option_env!("LITE_REPO")
}

// That same tree, opened for the one thing Lite does with it. The path is the one compiled into this
// build rather than one handed in, and it deliberately does not go through use_directory: that records
// what it opens as the folder to offer next, and rebuilding Lite is not the same as choosing to work
// in it. The sensitive-folder rule still applies, as it does to every other grant.
#[tauri::command]
async fn grant_repo(app: AppHandle, roots: State<'_, Roots>) -> Result<DirectoryGrant, String> {
    let repo = option_env!("LITE_REPO").ok_or("This build did not record where it came from")?;
    grant_directory(&app, &roots, PathBuf::from(repo), None)
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
    // The download reports every chunk it receives, which is thousands of messages for a bar with a
    // hundred steps it can show, so only a percent the dialog has not already been given is worth
    // sending. A server that never said how large the update is says nothing rather than filling a
    // bar against a size nobody knows, and the dialog keeps its spinner for that download.
    let progress_app = app.clone();
    let mut downloaded = 0u64;
    let mut sent = 0;
    update
        .download_and_install(
            move |chunk_length, total| {
                downloaded += chunk_length as u64;
                let Some(total) = total.filter(|total| *total > 0) else {
                    return;
                };
                let percent = (downloaded * 100 / total).min(100);
                if percent == sent {
                    return;
                }
                sent = percent;
                let _ = progress_app.emit("update-progress", percent);
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())?;
    app.restart()
}

#[tauri::command]
fn startup_ready(app: AppHandle) {
    // Showing owns focus as well: a relaunch inherits no activation from the process an update replaced.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Some(window) = app.get_webview_window("splash") {
        let _ = window.close();
    }
}

// Tauri fills the About panel from the bundle config, which reaches it with only a name and version,
// so the panel read as bare. macOS only: it is the one platform Tauri gives an application menu, and
// setting one on Windows or Linux would put a native menu bar on a window that draws its own chrome.
// Those platforms carry the same details in the installer metadata from tauri.conf.json instead.
//
// Only the fields NSAboutPanel actually renders are set. It ignores authors, comments, license and
// website, so setting those here would look thorough and show nothing.
#[cfg(target_os = "macos")]
fn describe_app(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItemKind, PredefinedMenuItem};

    let about = AboutMetadata {
        name: Some("Lite".into()),
        version: Some(app.package_info().version.to_string()),
        copyright: Some("© 2026 Ultralytics Inc.".into()),
        // Credits are a plain NSAttributedString in a short scroll view: no link attributes, so a URL
        // is dead text, and more than a line or two becomes a wall behind a scrollbar. The panel
        // already states the name, version and copyright, so this only says what Lite is. The
        // clickable way to the repository is the logomark in the top bar.
        credits: Some("A fast, local workspace for AI coding agents.".into()),
        ..Default::default()
    };

    let menu = Menu::default(app)?;
    // About is the first item of the application submenu, which is the first submenu on macOS.
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.first() {
        app_menu.remove_at(0)?;
        app_menu.insert(&PredefinedMenuItem::about(app, None, Some(about))?, 0)?;
    }
    app.set_menu(menu)?;
    Ok(())
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
            #[cfg(target_os = "macos")]
            describe_app(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            choose_directory,
            follow_directory,
            github_items,
            use_directory,
            default_directory,
            revoke_directory,
            spawn_session,
            write_session,
            watch_shell_agent,
            resize_session,
            stop_session,
            delete_session_data,
            list_directory,
            read_text_file,
            git_status,
            git_remote,
            git_repo,
            create_worktree,
            restore_worktree,
            worktree_state,
            remove_worktree,
            forget_worktree,
            read_usage,
            agent_availability,
            agent_update_available,
            install_agent,
            open_setup_docs,
            open_url,
            open_directory,
            provider_auth,
            save_api_key,
            delete_api_key,
            check_update,
            install_update,
            local_commit,
            grant_repo,
            local_repo,
            build_date,
            local_update,
            startup_ready
        ])
        .build(tauri::generate_context!())
        .expect("error while building Lite")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                stop_runtime(app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    #[test]
    fn session_locale_is_utf8_only_on_macos() {
        let mut command = CommandBuilder::new("test");
        command.env_clear();

        configure_session_command(&mut command, Path::new("."), None);

        assert_eq!(
            command.get_env("LC_CTYPE"),
            cfg!(target_os = "macos").then_some(OsStr::new("UTF-8"))
        );
    }
}
