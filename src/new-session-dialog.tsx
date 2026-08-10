// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import { FolderOpen } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { ProviderIcon } from "@/brand-icons";
import { ActionIconButton, Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { AUTH_PROVIDERS } from "@/provider-auth";
import { defaultSessionName, folderName, type Session, sessionLabel } from "@/types";

const choices = [
  ...Object.values(AUTH_PROVIDERS),
  { id: "shell", agent: "shell" as const, provider: undefined, description: "Open your default shell" },
];

// The quiet heading that separates the two questions the dialog asks, in the sidebar's own label style.
const SECTION = "text-[11px] font-medium tracking-wide text-muted-foreground uppercase";

// The branch a new worktree starts from: lite/<repo>-<date>-<time>-<random>. The folder component
// is reduced to a branch-safe alphabet (a folder named "my project" must not fail git's own
// check), and the random tail keeps two Lite instances starting in the same second apart.
function suggestedBranch(repo: string) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const name = folderName(repo).replace(/[^A-Za-z0-9_-]/g, "-") || "project";
  return `lite/${name}-${stamp.slice(0, 8)}-${stamp.slice(8)}-${crypto.randomUUID().slice(0, 8)}`;
}

function worktreePath(repo: string, branch: string) {
  const name = folderName(repo);
  const index = repo.length - name.length - 1;
  const separator = repo[index] || "/";
  return `${repo.slice(0, index)}${separator}${name}-worktrees${separator}${branch.replace(/\//g, "-")}`;
}

// Two sessions share a project when they sit in the same repository — which a worktree's path
// cannot say, since Lite worktrees live beside the checkout rather than under it, so the repo
// recorded at creation answers. Sessions older than that record fall back to their path.
function sharesRepo(session: Session, repo: string) {
  if (session.repo) return session.repo === repo;
  return session.cwd === repo || session.cwd.startsWith(`${repo}/`) || session.cwd.startsWith(`${repo}\\`);
}

interface DirectoryGrant {
  id: string;
  path: string;
}

interface Availability {
  available: boolean;
  installable: boolean;
  detail: string;
}

export function NewSessionDialog({
  open: isOpen,
  onOpenChange,
  onCreate,
  sessions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (session: Session) => void;
  sessions: Session[];
}) {
  const [choiceId, setChoiceId] = useState(choices[0].id);
  const [directory, setDirectory] = useState<DirectoryGrant>();
  const [path, setPath] = useState("");
  const [availability, setAvailability] = useState<Record<string, Availability>>({});
  const [installing, setInstalling] = useState("");
  const [error, setError] = useState("");
  // Undefined while checking, null outside a repository, otherwise the repository's main checkout.
  const [repo, setRepo] = useState<string | null>();
  const [worktreeOn, setWorktreeOn] = useState(false);
  const [branch, setBranch] = useState("");
  const choice = choices.find((option) => option.id === choiceId) ?? choices[0];
  const status = availability[choice.id];
  // An agent that is not installed cannot take a session yet, so the dialog offers to install it instead.
  const missing = status && !status.available ? status : undefined;
  // Sessions already working in this repository, which is the case a worktree exists for.
  const sharing = repo ? sessions.filter((session) => sharesRepo(session, repo)).length : 0;
  // The probe reads this rather than depending on it: a session updating elsewhere must not reset
  // the toggle the user has already answered.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  // A typed path settles for a moment before it is probed, so a folder is never looked up once per
  // keystroke. The probe is read-only and needs no grant: it asks git about the folder the grant
  // would name.
  useEffect(() => {
    if (!isOpen || !path.trim()) {
      setRepo(null);
      setWorktreeOn(false);
      return;
    }
    setRepo(undefined);
    let disposed = false;
    const probe = window.setTimeout(() => {
      void invoke<string | null>("git_repo", { path: path.trim() })
        .then((root) => {
          if (disposed) return;
          setRepo(root);
          // Sessions already sharing this repository make the worktree the default rather than the
          // option; a fresh repository leaves the choice with the main checkout.
          setWorktreeOn(Boolean(root && sessionsRef.current.some((session) => sharesRepo(session, root))));
          setBranch(root ? suggestedBranch(root) : "");
        })
        .catch(() => {
          if (!disposed) setRepo(null);
        });
    }, 250);
    return () => {
      disposed = true;
      window.clearTimeout(probe);
    };
  }, [isOpen, path]);

  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    setError("");
    setAvailability({});
    void invoke<DirectoryGrant | null>("default_directory")
      .then((selected) => {
        if (disposed && selected) void invoke("revoke_directory", { rootId: selected.id });
        else if (selected) {
          setDirectory(selected);
          setPath(selected.path);
        }
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    // Checked only while the dialog is open, so Lite never probes the system in the background.
    for (const option of choices) {
      void invoke<Availability>("agent_availability", { agent: option.agent, provider: option.provider })
        .then((result) => {
          if (!disposed) setAvailability((current) => ({ ...current, [option.id]: result }));
        })
        .catch(() => {});
    }
    return () => {
      disposed = true;
    };
  }, [isOpen]);

  async function chooseFolder() {
    setError("");
    try {
      const selected = await invoke<DirectoryGrant | null>("choose_directory");
      if (selected) {
        if (directory) void invoke("revoke_directory", { rootId: directory.id });
        setDirectory(selected);
        setPath(selected.path);
        setRepo(undefined);
      }
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function grant(): Promise<DirectoryGrant | undefined> {
    if (directory && directory.path === path.trim()) return directory;
    try {
      const selected = await invoke<DirectoryGrant>("use_directory", { path });
      if (directory) void invoke("revoke_directory", { rootId: directory.id });
      setDirectory(selected);
      setPath(selected.path);
      setError("");
      return selected;
    } catch (reason) {
      setError(String(reason));
      return undefined;
    }
  }

  function changeOpen(open: boolean) {
    if (!open && installing) return;
    if (!open && directory) {
      void invoke("revoke_directory", { rootId: directory.id });
      setDirectory(undefined);
    }
    onOpenChange(open);
  }

  async function create() {
    let folder = await grant();
    if (!folder) return;
    let worktree = false;
    // The probe's answer can lag the folder field, so the granted folder is asked directly:
    // the worktree and the recorded repository always describe where the session will run.
    let root: string | null;
    try {
      root = await invoke<string | null>("git_repo", { path: folder.path });
    } catch (reason) {
      setError(String(reason));
      return;
    }
    // The toggle must still describe this folder: root === repo fails when the folder changed
    // after the probe that enabled the option, and a worktree is never made on a stale answer.
    if (root && root === repo && worktreeOn) {
      try {
        folder = await invoke<DirectoryGrant>("create_worktree", {
          rootId: folder.id,
          branch: branch.trim() || suggestedBranch(root),
        });
        worktree = true;
      } catch (reason) {
        setError(String(reason));
        return;
      }
    }
    const project = defaultSessionName(folder.path);
    onCreate({
      id: crypto.randomUUID(),
      agent: choice.agent,
      provider: choice.provider,
      cwd: folder.path,
      rootId: folder.id,
      name: project,
      running: false,
      worktree,
      repo: root || undefined,
    });
    setDirectory(undefined);
    onOpenChange(false);
  }

  async function install() {
    setInstalling(choice.id);
    setError("");
    try {
      await invoke("install_agent", { agent: choice.agent });
      const results = await Promise.all(
        choices
          .filter((option) => option.agent === choice.agent)
          .map(
            async (option) =>
              [
                option.id,
                await invoke<Availability>("agent_availability", {
                  agent: option.agent,
                  provider: option.provider,
                }),
              ] as const,
          ),
      );
      setAvailability((current) => ({ ...current, ...Object.fromEntries(results) }));
      const result = results.find(([id]) => id === choice.id)?.[1];
      if (result && !result.available) setError(result.detail);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setInstalling("");
    }
  }

  // Everything the dialog can be asked for arrives here: the submit button, Enter from the folder field,
  // and a second click on the agent already chosen. An agent that is not installed reads them all as a
  // request to install it, which is the only one of the two it can answer.
  const ready =
    !installing &&
    Boolean(missing || (path.trim() && status && repo !== undefined && (!repo || !worktreeOn || branch.trim())));
  function start() {
    if (missing?.installable) void install();
    else if (missing)
      void invoke("open_setup_docs", { agent: choice.agent, provider: choice.provider }).catch((reason) =>
        setError(String(reason)),
      );
    else void create();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    start();
  }

  return (
    <Dialog open={isOpen} onOpenChange={changeOpen}>
      <DialogContent className="sm:min-h-[32rem] sm:max-w-xl">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New session</DialogTitle>
            <DialogDescription>Pick a project folder, then choose the agent that should work in it.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="project-folder" className={SECTION}>
                Project folder
              </Label>
              <div className="flex gap-2">
                <Input
                  id="project-folder"
                  value={path}
                  className="min-w-0 flex-1 font-mono"
                  placeholder="Type or choose a project folder…"
                  name="project-folder"
                  autoComplete="off"
                  onChange={(event) => {
                    setPath(event.target.value);
                    // The worktree section describes the probed folder; while a new one is being
                    // typed there is nothing true to show, so it hides until the probe answers.
                    setRepo(undefined);
                  }}
                />
                <ActionIconButton
                  variant="outline"
                  size="icon"
                  tooltip="Browse"
                  aria-label="Browse for a folder"
                  onClick={() => void chooseFolder()}
                >
                  <FolderOpen />
                </ActionIconButton>
              </div>
            </div>
            {repo ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Label htmlFor="new-worktree" className={SECTION}>
                      Worktree
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {sharing
                        ? `${sharing} session${sharing === 1 ? "" : "s"} already work${sharing === 1 ? "s" : ""} in this project`
                        : "Isolate this session from the main checkout"}
                    </p>
                  </div>
                  <Switch id="new-worktree" checked={worktreeOn} onCheckedChange={setWorktreeOn} />
                </div>
                {worktreeOn ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="worktree-branch">Branch</Label>
                    <Input
                      id="worktree-branch"
                      value={branch}
                      className="font-mono"
                      placeholder="Branch for the worktree…"
                      name="worktree-branch"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => setBranch(event.target.value)}
                    />
                    <p className="truncate font-mono text-xs text-muted-foreground" title={worktreePath(repo, branch)}>
                      {worktreePath(repo, branch)}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="space-y-1.5">
              <p className={SECTION}>Agent</p>
              <div className="grid grid-cols-4 gap-2">
                {choices.map((option) => {
                  const active = choiceId === option.id;
                  return (
                    <Button
                      key={option.id}
                      type="button"
                      size="lg"
                      variant={active ? "secondary" : "outline"}
                      className="min-w-0 justify-start px-2"
                      aria-pressed={active}
                      disabled={Boolean(installing)}
                      title={sessionLabel(option)}
                      onClick={() => setChoiceId(option.id)}
                    >
                      <ProviderIcon agent={option.agent} provider={option.provider} />
                      <span className="truncate">{sessionLabel(option)}</span>
                    </Button>
                  );
                })}
              </div>
              {missing ? <p className="text-xs text-muted-foreground">{missing.detail}</p> : null}
            </div>
            {/* Written by the folder and by the setup guide alike, so it sits with neither and above both. */}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={Boolean(installing)} onClick={() => changeOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              {!status || installing ? <Spinner /> : null}
              {installing
                ? `Installing ${sessionLabel(choice)}…`
                : missing?.installable
                  ? `Install ${sessionLabel(choice)}`
                  : missing
                    ? "Open setup guide"
                    : "Start session"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
