// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import { Check, CircleAlert, Download, FolderOpen, RefreshCw, TriangleAlert } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

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
import { AUTH_PROVIDERS, type ProviderAuth, ProviderAuthDescription } from "@/provider-auth";
import { defaultSessionName, type Session, sessionLabel } from "@/types";

export const SESSION_CHOICES = [
  ...Object.values(AUTH_PROVIDERS),
  { id: "shell", agent: "shell" as const, provider: undefined, label: "Your login shell" },
];
const harnesses = [...new Set(SESSION_CHOICES.map((option) => option.agent).filter((agent) => agent !== "shell"))];
const CHOICE_KEY = "lite.newSession.choice.v1";
const DEEPSEEK_MODEL_KEY = "lite.newSession.deepseekModel.v1";
const DEEPSEEK_REASONING_KEY = "lite.newSession.deepseekReasoning.v1";
const NAME_KEY = "lite.newSession.name.v1";
const WORKTREE_KEY = "lite.newSession.worktree.v1";
const REMOTE_KEY = "lite.newSession.remote.v1";
const SSH_HOST_KEY = "lite.newSession.sshHost.v1";
const DEEPSEEK_MODELS = [
  { value: "deepseek-v4-flash", label: "Flash" },
  { value: "deepseek-v4-pro", label: "Pro" },
] as const;
type DeepSeekModel = (typeof DEEPSEEK_MODELS)[number]["value"];
const DEEPSEEK_REASONING = ["low", "high", "max"] as const;
type DeepSeekReasoning = (typeof DEEPSEEK_REASONING)[number];

function remoteUnsupported(remote: boolean, choice: (typeof SESSION_CHOICES)[number]) {
  return remote && choice.agent === "codex" && choice.provider !== "openai";
}

let updateChecks: Promise<Record<string, boolean | null>> | undefined;

function checkAgentUpdates() {
  updateChecks ??= Promise.all(
    harnesses.map(async (agent) => {
      try {
        return [agent, await invoke<boolean>("agent_update_available", { agent })] as const;
      } catch {
        return [agent, null] as const;
      }
    }),
  ).then(Object.fromEntries);
  return updateChecks;
}

// The quiet heading that separates the two questions the dialog asks, in the sidebar's own label style.
const SECTION = "text-[11px] font-medium tracking-wide text-muted-foreground uppercase";

interface DirectoryGrant {
  id: string;
  path: string;
  host: string | null;
}

interface Repository {
  branch: string;
  root: string;
  worktree: string;
}

interface DirectoryProbe {
  exists: boolean;
  isDirectory: boolean;
  repository: Repository | null;
}

interface Availability {
  available: boolean;
  installable: boolean;
  detail: string;
}

export function NewSessionDialog({
  open: isOpen,
  choice: chosen,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  // A choice made outside the dialog — a welcome tile — which the dialog opens on.
  choice?: string;
  onOpenChange: (open: boolean) => void;
  onCreate: (session: Session) => void;
}) {
  const [choiceId, setChoiceId] = useState(() => {
    const stored = localStorage.getItem(CHOICE_KEY);
    return SESSION_CHOICES.find((option) => option.id === stored)?.id ?? SESSION_CHOICES[0].id;
  });
  const [deepseekModel, setDeepseekModel] = useState<DeepSeekModel>(() => {
    const stored = localStorage.getItem(DEEPSEEK_MODEL_KEY);
    return DEEPSEEK_MODELS.find(({ value }) => value === stored)?.value ?? DEEPSEEK_MODELS[0].value;
  });
  const [deepseekReasoning, setDeepseekReasoning] = useState<DeepSeekReasoning>(() => {
    const stored = localStorage.getItem(DEEPSEEK_REASONING_KEY);
    return DEEPSEEK_REASONING.find((effort) => effort === stored) ?? "high";
  });
  const [directory, setDirectory] = useState<DirectoryGrant>();
  const [path, setPath] = useState("");
  const [remote, setRemote] = useState(() => localStorage.getItem(REMOTE_KEY) === "true");
  const [host, setHost] = useState(() => localStorage.getItem(SSH_HOST_KEY) ?? "");
  const [availability, setAvailability] = useState<Record<string, Availability>>({});
  const [auth, setAuth] = useState<ProviderAuth[]>();
  const [installing, setInstalling] = useState("");
  // Undefined while checking, null when the registry could not answer, otherwise whether an update exists.
  const [updates, setUpdates] = useState<Record<string, boolean | null>>({});
  // Creation runs the worktree command against the dialog's grant, so closing must wait for it:
  // a Cancel mid-command would revoke the grant the command is still using.
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  // Undefined while checking, null outside a repository, otherwise the repository's main checkout.
  const [repo, setRepo] = useState<string | null>();
  const [folder, setFolder] = useState<"checking" | "missing" | "directory" | "other">("checking");
  const [worktree, setWorktree] = useState("");
  const [worktreeOn, setWorktreeOn] = useState(() => localStorage.getItem(WORKTREE_KEY) === "true");
  const [branch, setBranch] = useState("");
  const [title, setTitle] = useState<string | undefined>(() =>
    localStorage.getItem(NAME_KEY) === "true" ? "" : undefined,
  );
  const choice = SESSION_CHOICES.find((option) => option.id === choiceId) ?? SESSION_CHOICES[0];
  const unsupported = remoteUnsupported(remote, choice);
  const status = availability[choice.id];
  useEffect(() => {
    if (isOpen && chosen) setChoiceId(chosen);
  }, [isOpen, chosen]);
  // An agent that is not installed cannot take a session yet, so the dialog offers to install it instead.
  const missing = !remote && status && !status.available ? status : undefined;
  // The first explicit open asks every harness in parallel. The answer is kept for this app run, so
  // reopening the dialog does not repeat five version processes and five network requests.
  useEffect(() => {
    if (!isOpen || remote) return;
    let disposed = false;
    void checkAgentUpdates().then((result) => {
      if (!disposed) setUpdates(result);
    });
    return () => {
      disposed = true;
    };
  }, [isOpen, remote]);

  // A typed path settles for a moment before it is probed, so a folder is never looked up once per
  // keystroke. The probe is read-only and needs no grant: it asks git about the folder the grant
  // would name.
  useEffect(() => {
    if (!isOpen || !path.trim()) {
      setRepo(null);
      setFolder("checking");
      setWorktree("");
      return;
    }
    if (remote) {
      setFolder("directory");
      setRepo(null);
      setWorktree("");
      return;
    }
    setRepo(undefined);
    let disposed = false;
    const probe = window.setTimeout(() => {
      void invoke<DirectoryProbe>("directory_probe", { path: path.trim() })
        .then(({ exists, isDirectory, repository }) => {
          if (disposed) return;
          setFolder(isDirectory ? "directory" : exists ? "other" : "missing");
          const root = repository?.root ?? null;
          setRepo(root);
          setWorktree(repository?.worktree ?? "");
          setBranch(repository?.branch ?? "");
        })
        .catch(() => {
          if (!disposed) {
            setRepo(null);
            setFolder("other");
            setWorktree("");
          }
        });
    }, 250);
    return () => {
      disposed = true;
      window.clearTimeout(probe);
    };
  }, [isOpen, path, remote]);

  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    setError("");
    setAvailability({});
    setAuth(undefined);
    if (!remote)
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
    if (!remote) {
      void invoke<ProviderAuth[]>("provider_auth")
        .then((result) => {
          if (!disposed) setAuth(result);
        })
        .catch((reason) => {
          if (!disposed) setError(String(reason));
        });
      // Installation and provider setup can change while the app runs, so refresh them on each open.
      for (const option of SESSION_CHOICES) {
        void invoke<Availability>("agent_availability", { agent: option.agent, provider: option.provider })
          .then((result) => {
            if (!disposed) setAvailability((current) => ({ ...current, [option.id]: result }));
          })
          .catch(() => {});
      }
    }
    return () => {
      disposed = true;
    };
  }, [isOpen, remote]);

  async function chooseFolder() {
    setError("");
    try {
      const selected = await invoke<DirectoryGrant | null>("choose_directory");
      if (selected) {
        if (directory) void invoke("revoke_directory", { rootId: directory.id });
        setDirectory(selected);
        setPath(selected.path);
        setFolder("directory");
        setRepo(undefined);
        setWorktree("");
      }
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function grant(): Promise<DirectoryGrant | undefined> {
    if (directory && directory.path === path.trim() && directory.host === (remote ? host.trim() : null))
      return directory;
    try {
      const selected = await invoke<DirectoryGrant>(remote ? "use_ssh_directory" : "use_directory", {
        path,
        ...(remote ? { host: host.trim() } : {}),
      });
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
    if (!open && (installing || creating)) return;
    if (!open && directory) {
      void invoke("revoke_directory", { rootId: directory.id });
      setDirectory(undefined);
    }
    // A cancelled dialog stays mounted, so a name typed into it must not wait for the next session.
    if (!open) setTitle((current) => (current === undefined ? undefined : ""));
    onOpenChange(open);
  }

  async function create() {
    setCreating(true);
    try {
      let folder = await grant();
      if (!folder) return;
      let worktree = false;
      // The probe's answer can lag the folder field, so the granted folder is asked directly:
      // the worktree and the recorded repository always describe where the session will run.
      let root: string | null = null;
      if (!remote)
        try {
          root = (await invoke<DirectoryProbe>("directory_probe", { path: folder.path })).repository?.root ?? null;
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
            branch: branch.trim(),
          });
          worktree = true;
        } catch (reason) {
          setError(String(reason));
          return;
        }
      }
      const name = title?.trim() ?? "";
      onCreate({
        id: crypto.randomUUID(),
        agent: choice.agent,
        provider: choice.provider,
        model: choice.provider === "deepseek" ? deepseekModel : undefined,
        reasoningEffort: choice.provider === "deepseek" ? deepseekReasoning : undefined,
        cwd: folder.path,
        host: folder.host ?? undefined,
        rootId: folder.id,
        name: name || defaultSessionName(folder.path),
        running: false,
        renamed: Boolean(name),
        worktree,
        repo: root || undefined,
      });
      setDirectory(undefined);
      setTitle((current) => (current === undefined ? undefined : ""));
      onOpenChange(false);
    } finally {
      setCreating(false);
    }
  }

  async function install(option: (typeof SESSION_CHOICES)[number] = choice) {
    setInstalling(option.id);
    setError("");
    try {
      await invoke("install_agent", { agent: option.agent });
      const results = await Promise.all(
        SESSION_CHOICES.filter((candidate) => candidate.agent === option.agent).map(
          async (candidate) =>
            [
              candidate.id,
              await invoke<Availability>("agent_availability", {
                agent: candidate.agent,
                provider: candidate.provider,
              }),
            ] as const,
        ),
      );
      setAvailability((current) => ({ ...current, ...Object.fromEntries(results) }));
      const result = results.find(([id]) => id === option.id)?.[1];
      if (result && !result.available && result.installable) setError(result.detail);
      else {
        updateChecks = (updateChecks ?? Promise.resolve(updates)).then((current) => ({
          ...current,
          [option.agent]: false,
        }));
        setUpdates((current) => ({ ...current, [option.agent]: false }));
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setInstalling("");
    }
  }

  // Everything the dialog can be asked for arrives here: the submit button, Enter from the folder field,
  // and a second click on the agent already chosen. An agent that is not installed reads them all as a
  // request to install it, which is the only one of the two it can answer.
  const folderReady = remote
    ? host.trim() && path.trim()
    : path.trim() && folder !== "other" && status && repo !== undefined && (!repo || !worktreeOn || branch.trim());
  const ready = !unsupported && !installing && !creating && Boolean(missing || folderReady);
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
        <form onSubmit={submit} className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New session</DialogTitle>
            <DialogDescription>Pick a project folder, then choose the agent that should work in it.</DialogDescription>
          </DialogHeader>
          <DialogBody className="min-w-0 space-y-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="remote-workspace" className={SECTION}>
                Remote SSH
              </Label>
              <Switch
                id="remote-workspace"
                checked={remote}
                disabled={creating}
                onCheckedChange={(checked) => {
                  localStorage.setItem(REMOTE_KEY, String(checked));
                  if (directory) void invoke("revoke_directory", { rootId: directory.id });
                  setDirectory(undefined);
                  setPath("");
                  setRemote(checked);
                }}
              />
            </div>
            {remote ? (
              <div className="space-y-1.5">
                <Label htmlFor="ssh-host" className={SECTION}>
                  SSH host
                </Label>
                <Input
                  id="ssh-host"
                  value={host}
                  className="font-mono"
                  placeholder="user@server or SSH config name"
                  name="ssh-host"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setHost(event.target.value);
                    localStorage.setItem(SSH_HOST_KEY, event.target.value);
                  }}
                />
                <p className="text-xs text-muted-foreground">Uses your SSH config and agent sign-in on the server.</p>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="project-folder" className={SECTION}>
                Project folder
              </Label>
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Input
                    id="project-folder"
                    value={path}
                    className={`pr-8 font-mono ${folder === "directory" ? "border-success focus-visible:border-success focus-visible:ring-success/20" : folder === "missing" ? "border-amber-500 focus-visible:border-amber-500 focus-visible:ring-amber-500/20" : ""}`}
                    placeholder={remote ? "/home/user/project" : "Type or choose a project folder…"}
                    name="project-folder"
                    autoComplete="off"
                    aria-invalid={folder === "other" || undefined}
                    aria-describedby={folder === "missing" || folder === "other" ? "project-folder-status" : undefined}
                    onChange={(event) => {
                      setPath(event.target.value);
                      // The worktree section describes the probed folder; while a new one is being
                      // typed there is nothing true to show, so it hides until the probe answers.
                      setFolder("checking");
                      setRepo(undefined);
                      setWorktree("");
                    }}
                  />
                  {folder === "directory" ? (
                    <Check
                      className="absolute top-1/2 right-2 size-4 -translate-y-1/2 text-success"
                      aria-hidden="true"
                    />
                  ) : folder === "missing" ? (
                    <TriangleAlert
                      className="absolute top-1/2 right-2 size-4 -translate-y-1/2 text-amber-500"
                      aria-hidden="true"
                    />
                  ) : folder === "other" ? (
                    <CircleAlert
                      className="absolute top-1/2 right-2 size-4 -translate-y-1/2 text-destructive"
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
                <ActionIconButton
                  variant="outline"
                  size="icon"
                  tooltip="Browse"
                  aria-label="Browse for a folder"
                  disabled={remote}
                  onClick={() => void chooseFolder()}
                >
                  <FolderOpen />
                </ActionIconButton>
              </div>
              {folder === "missing" ? (
                <p id="project-folder-status" className="text-xs text-amber-600 dark:text-amber-400">
                  This folder does not exist and will be created.
                </p>
              ) : folder === "other" ? (
                <p id="project-folder-status" className="text-xs text-destructive">
                  This path is not a folder.
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="custom-session-name" className={SECTION}>
                  Name{" "}
                  <span className="text-[10px] font-normal tracking-normal text-muted-foreground/70 normal-case">
                    Optional
                  </span>
                </Label>
                <Switch
                  id="custom-session-name"
                  checked={title !== undefined}
                  onCheckedChange={(checked) => {
                    localStorage.setItem(NAME_KEY, String(checked));
                    setTitle(checked ? "" : undefined);
                  }}
                />
              </div>
              {title !== undefined ? (
                <Input
                  id="session-title"
                  value={title}
                  placeholder="Name this session…"
                  name="session-title"
                  autoComplete="off"
                  aria-label="Session name"
                  onChange={(event) => setTitle(event.target.value)}
                />
              ) : null}
            </div>
            {repo ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="new-worktree" className={SECTION}>
                    Worktree{" "}
                    <span className="text-[10px] font-normal tracking-normal text-muted-foreground/70 normal-case">
                      Optional
                    </span>
                  </Label>
                  <Switch
                    id="new-worktree"
                    checked={worktreeOn}
                    onCheckedChange={(checked) => {
                      localStorage.setItem(WORKTREE_KEY, String(checked));
                      setWorktreeOn(checked);
                    }}
                  />
                </div>
                {worktreeOn ? (
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="worktree-branch">New branch</Label>
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
                    <p className="max-w-full truncate font-mono text-xs text-muted-foreground" title={worktree}>
                      {worktree}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="space-y-1.5">
              <p className={SECTION}>Agent</p>
              <div className="grid min-w-0 grid-cols-2 gap-2">
                {SESSION_CHOICES.map((option) => {
                  const active = choiceId === option.id;
                  const unsupported = remoteUnsupported(remote, option);
                  const deepseek = option.id === "deepseek";
                  const state = availability[option.id];
                  const update = updates[option.agent];
                  const managed = option.agent !== "shell" && state && !state.installable;
                  // A registry that could not answer knows of no update, so only one it reported is
                  // offered — by the button and by the mark beside the version alike.
                  const updatable = managed && update === true;
                  // What the icon offers, if it is there at all.
                  const action = state?.installable
                    ? ({ label: "Install", working: "Installing" } as const)
                    : updatable
                      ? ({ label: "Update", working: "Updating" } as const)
                      : undefined;
                  const busy = installing === option.id;
                  const authProvider = "configured" in option ? option : undefined;
                  const authStatus = authProvider ? auth?.find((entry) => entry.name === authProvider.id) : undefined;
                  return (
                    <div
                      key={option.id}
                      className={`relative min-w-0 ${active && deepseek ? "rounded-lg bg-secondary" : ""}`}
                    >
                      <Button
                        type="button"
                        size="lg"
                        variant={active && !deepseek ? "secondary" : active ? "ghost" : "outline"}
                        className={`h-14 w-full min-w-0 justify-start overflow-hidden pl-3 ${action ? "pr-11" : "pr-3"} ${active && deepseek ? "rounded-b-none" : ""}`}
                        aria-pressed={active}
                        disabled={Boolean(installing) || unsupported}
                        title={"note" in option ? option.note : sessionLabel(option)}
                        onClick={() => {
                          if (active && ready) start();
                          else {
                            localStorage.setItem(CHOICE_KEY, option.id);
                            setChoiceId(option.id);
                          }
                        }}
                      >
                        <ProviderIcon agent={option.agent} provider={option.provider} className="size-5" />
                        <div
                          className={`min-w-0 flex-1 text-left ${managed && update === false ? "[&_[data-slot=item-description]_svg]:text-green-600 dark:[&_[data-slot=item-description]_svg]:text-green-400" : updatable ? "[&_[data-slot=item-description]_svg]:text-amber-600 dark:[&_[data-slot=item-description]_svg]:text-amber-400" : ""}`}
                        >
                          <span className="block truncate">{sessionLabel(option)}</span>
                          {unsupported ? (
                            <span className="block truncate text-xs font-normal text-muted-foreground">
                              Local workspace only
                            </span>
                          ) : remote ? (
                            <span className="block truncate text-xs font-normal text-muted-foreground">
                              Runs on {host.trim() || "SSH host"}
                            </span>
                          ) : state && !state.available ? (
                            <span className="block truncate text-xs font-normal text-muted-foreground">
                              {state.installable ? "Not installed" : "Setup required"}
                            </span>
                          ) : authProvider ? (
                            <ProviderAuthDescription provider={authProvider} status={authStatus} />
                          ) : (
                            <span className="block truncate text-xs font-normal text-muted-foreground">
                              {state ? "Available" : "Checking…"}
                            </span>
                          )}
                        </div>
                      </Button>
                      {active && deepseek ? (
                        <div className="space-y-1 border-t px-3 py-2">
                          <div className="flex items-center">
                            <span id="deepseek-model-label" className="text-xs font-medium text-muted-foreground">
                              Model
                            </span>
                            <fieldset
                              className="ml-auto flex rounded-lg border-0 bg-background/70 p-0.5"
                              aria-labelledby="deepseek-model-label"
                            >
                              {DEEPSEEK_MODELS.map((model) => (
                                <Button
                                  key={model.value}
                                  type="button"
                                  size="xs"
                                  variant={deepseekModel === model.value ? "secondary" : "ghost"}
                                  aria-pressed={deepseekModel === model.value}
                                  onClick={() => {
                                    localStorage.setItem(DEEPSEEK_MODEL_KEY, model.value);
                                    setDeepseekModel(model.value);
                                  }}
                                >
                                  {model.label}
                                </Button>
                              ))}
                            </fieldset>
                          </div>
                          <div className="flex items-center">
                            <span id="deepseek-reasoning-label" className="text-xs font-medium text-muted-foreground">
                              Thinking
                            </span>
                            <fieldset
                              className="ml-auto flex rounded-lg border-0 bg-background/70 p-0.5"
                              aria-labelledby="deepseek-reasoning-label"
                            >
                              {DEEPSEEK_REASONING.map((effort) => (
                                <Button
                                  key={effort}
                                  type="button"
                                  size="xs"
                                  variant={deepseekReasoning === effort ? "secondary" : "ghost"}
                                  className="capitalize"
                                  aria-pressed={deepseekReasoning === effort}
                                  onClick={() => {
                                    localStorage.setItem(DEEPSEEK_REASONING_KEY, effort);
                                    setDeepseekReasoning(effort);
                                  }}
                                >
                                  {effort}
                                </Button>
                              ))}
                            </fieldset>
                          </div>
                        </div>
                      ) : null}
                      {action ? (
                        <ActionIconButton
                          type="button"
                          size="icon"
                          variant="outline"
                          className={`absolute right-2 ${active && deepseek ? "top-3" : "top-1/2 -mt-4"}`}
                          tooltip={
                            busy
                              ? `${action.working} ${sessionLabel(option)}…`
                              : action.label === "Install"
                                ? `Install ${sessionLabel(option)}`
                                : `Update ${sessionLabel(option)} to the latest version`
                          }
                          aria-label={
                            action.label === "Install"
                              ? `Install ${sessionLabel(option)}`
                              : `Update ${sessionLabel(option)} to the latest version`
                          }
                          disabled={Boolean(installing)}
                          onClick={() => void install(option)}
                        >
                          {busy ? <Spinner /> : action.label === "Install" ? <Download /> : <RefreshCw />}
                        </ActionIconButton>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Written by the folder and by the setup guide alike, so it sits with neither and above both. */}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={Boolean(installing) || creating} onClick={() => changeOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              {(!remote && !status) || (installing && missing?.installable) ? <Spinner /> : null}
              {installing && missing?.installable
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
