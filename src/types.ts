// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

// A harness runs the session; a model provider bills it. Codex can run against multiple providers.
export type Agent = "claude" | "codex" | "gemini" | "kimi" | "qwen" | "shell";
export type ModelProvider = "openai" | "deepseek" | "openrouter";

export interface Session {
  id: string;
  // Creation time keeps view sorting stable independently of manual session order. Older persisted
  // sessions receive this once when they are loaded.
  createdAt?: number;
  agent: Agent;
  provider?: ModelProvider;
  // A sign-in session runs the provider's own login command; it is never stored or resumed.
  mode?: "login";
  name: string;
  // A name the user typed is theirs, so nothing the session says about itself overwrites it again.
  renamed?: boolean;
  cwd: string;
  rootId: string;
  running: boolean;
  providerSessionId?: string;
  // Lite created this session its own git worktree, so closing the session offers to remove it.
  // A worktree the user made by hand never carries this flag and is never offered for deletion.
  worktree?: boolean;
  // The repository the session's folder sits in, recorded at creation: worktrees live outside the
  // main checkout, so this — not the path — is how sessions sharing a repository recognize each other.
  repo?: string;
}

const agentLabels: Record<Agent, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  kimi: "Kimi Code",
  qwen: "Qwen Code",
  shell: "Shell",
};

const providerLabels: Record<ModelProvider, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
};

export function providerLabel(provider: ModelProvider): string {
  return providerLabels[provider];
}

export function sessionLabel({ agent, provider }: Pick<Session, "agent" | "provider">): string {
  if (agent === "codex" && provider && provider !== "openai") return `Codex · ${providerLabels[provider]}`;
  return agentLabels[agent];
}

// The last real segment of a path, on either separator; empty when the path has none.
export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

// A session is named for its folder until someone or something names it better; a root path that
// names no folder falls back to "Session". Creation and every is-it-still-the-default comparison
// share this one spelling.
export function defaultSessionName(cwd: string): string {
  return folderName(cwd) || "Session";
}

// A remote names a repository; the scheme and host that reach it are the tooltip's job.
export function repoName(url: string): string {
  return url.replace(/^https:\/\/[^/]+\//, "");
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
}

export interface DirectoryCursor {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface DirectoryListing {
  entries: FileEntry[];
  nextCursor: DirectoryCursor | null;
}

export interface GitStatus {
  branch: string;
  worktree: string;
  changes: { status: string; path: string }[];
  lineDiffs: Record<string, { additions: number; deletions: number }>;
  changesTruncated: boolean;
}
