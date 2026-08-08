// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

// A harness runs the session; a model provider bills it. Codex is the one harness that supports both.
export type Agent = "claude" | "codex" | "kimi" | "shell";
export type ModelProvider = "openai" | "deepseek";

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
  kimi: "Kimi Code",
  shell: "Shell",
};

export function sessionLabel({ agent, provider }: Pick<Session, "agent" | "provider">): string {
  if (agent === "codex" && provider === "deepseek") return "Codex · DeepSeek";
  return agentLabels[agent];
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
  changesTruncated: boolean;
}
