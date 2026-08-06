// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

export type Agent = "claude" | "codex" | "shell";

export const agentLabels: Record<Agent, string> = {
  claude: "Claude Code",
  codex: "Codex",
  shell: "Shell",
};

export interface Session {
  id: string;
  agent: Agent;
  name: string;
  cwd: string;
  rootId: string;
  running: boolean;
  providerSessionId?: string;
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
