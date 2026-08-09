// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

// A harness runs the session; a model provider bills it. Codex can run against multiple providers.
export type Agent = "claude" | "codex" | "gemini" | "kimi" | "qwen" | "shell";
export type ModelProvider = "openai" | "deepseek" | "openrouter";

export interface Session {
  id: string;
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
  changes: string[];
  lineDiffs: Record<string, { additions: number; deletions: number }>;
  changesTruncated: boolean;
}
