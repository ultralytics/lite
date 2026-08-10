// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import { Check, FolderOpen, GitBranch } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { ProviderIcon } from "@/brand-icons";
import { Badge } from "@/components/ui/badge";
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
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AUTH_PROVIDERS, type ProviderAuth, ProviderAuthDescription } from "@/provider-auth";
import { defaultSessionName, folderName, type Session, sessionLabel } from "@/types";

const choices = [
  ...Object.values(AUTH_PROVIDERS),
  { id: "shell", agent: "shell" as const, provider: undefined, description: "Open your default shell" },
];

// The quiet heading that separates the two questions the dialog asks, in the sidebar's own label style.
const SECTION = "text-[11px] font-medium tracking-wide text-muted-foreground uppercase";

// The branch a new worktree starts from, named for the repository and the moment so two sessions
// created on the same project never collide: lite/<repo>-<yyyymmdd-hhmmss>.
function suggestedBranch(repo: string) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `lite/${folderName(repo) || "project"}-${stamp.slice(0, 8)}-${stamp.slice(8)}`;
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
  existingCwds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (session: Session) => void;
  existingCwds: string[];
}) {
  const [choiceId, setChoiceId] = useState(choices[0].id);
  const [directory, setDirectory] = useState<DirectoryGrant>();
  const [path, setPath] = useState("");
  const [availability, setAvailability] = useState<Record<string, Availability>>({});
  const [auth, setAuth] = useState<ProviderAuth[]>();
  const [installing, setInstalling] = useState("");
  const [error, setError] = useState("");
  // The repository the chosen folder sits in, empty while asking or when it sits in none.
  const [repo, setRepo] = useState("");
  const [worktreeOn, setWorktreeOn] = useState(false);
  const [branch, setBranch] = useState("");
  const choice = choices.find((option) => option.id === choiceId) ?? choices[0];
  const status = availability[choice.id];
  // An agent that is not installed cannot take a session yet, so the dialog offers to install it instead.
  const missing = status && !status.available ? status : undefined;
  // Sessions already working in this repository, which is the case a worktree exists for.
  const sharing = repo ? existingCwds.filter((cwd) => cwd === repo || cwd.startsWith(`${repo}/`)).length : 0;
  // The probe reads this rather than depending on it: a session updating elsewhere must not reset
  // the toggle the user has already answered.
  const existingCwdsRef = useRef(existingCwds);
  existingCwdsRef.current = existingCwds;

  // A typed path settles for a moment before it is probed, so a folder is never looked up once per
  // keystroke. The probe is read-only and needs no grant: it asks git about the folder the grant
  // would name.
  useEffect(() => {
    if (!isOpen || !path.trim()) {
      setRepo("");
      setWorktreeOn(false);
      return;
    }
    let disposed = false;
    const probe = window.setTimeout(() => {
      void invoke<string | null>("git_repo", { path: path.trim() })
        .then((root) => {
          if (disposed) return;
          setRepo(root ?? "");
          // Sessions already sharing this repository make the worktree the default rather than the
          // option; a fresh repository leaves the choice with the main checkout.
          setWorktreeOn(
            Boolean(root && existingCwdsRef.current.some((cwd) => cwd === root || cwd.startsWith(`${root}/`))),
          );
          setBranch(root ? suggestedBranch(root) : "");
        })
        .catch(() => {
          if (!disposed) setRepo("");
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
    setAuth(undefined);
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
    void invoke<ProviderAuth[]>("provider_auth")
      .then((result) => {
        if (!disposed) setAuth(result);
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
    if (repo && worktreeOn) {
      try {
        const granted = await invoke<DirectoryGrant>("create_worktree", { rootId: folder.id, branch });
        // The worktree's grant replaces the repository's: the session belongs to the folder it
        // runs in, and the main checkout was only the way to make it.
        void invoke("revoke_directory", { rootId: folder.id });
        folder = granted;
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
  const ready = Boolean(!installing && (missing || (path.trim() && status && (!repo || !worktreeOn || branch.trim()))));
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
      <DialogContent className="sm:max-w-lg">
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
                  placeholder="Type or choose a project folder"
                  onChange={(event) => setPath(event.target.value)}
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
              <fieldset className="space-y-1.5">
                <legend className={SECTION}>Git worktree</legend>
                <Item
                  size="xs"
                  variant={worktreeOn ? "outline" : "default"}
                  className={worktreeOn ? "border-ring bg-accent" : "hover:bg-muted/60"}
                  render={
                    <button
                      type="button"
                      aria-pressed={worktreeOn}
                      onClick={() => setWorktreeOn((current) => !current)}
                    />
                  }
                >
                  <ItemMedia variant="icon" className="size-7 rounded-md border bg-background">
                    <GitBranch />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>Start in a new worktree</ItemTitle>
                    {sharing ? (
                      <ItemDescription>
                        {`${sharing} session${sharing === 1 ? "" : "s"} already work${sharing === 1 ? "s" : ""} in this project — a worktree keeps them separate`}
                      </ItemDescription>
                    ) : null}
                  </ItemContent>
                  <ItemActions>
                    <Check className={`size-4 shrink-0 ${worktreeOn ? "" : "invisible"}`} />
                  </ItemActions>
                </Item>
                {worktreeOn ? (
                  <Input
                    value={branch}
                    className="font-mono"
                    placeholder="Branch for the worktree"
                    aria-label="Branch for the worktree"
                    onChange={(event) => setBranch(event.target.value)}
                  />
                ) : null}
              </fieldset>
            ) : null}
            <fieldset className="space-y-1.5">
              <legend className={SECTION}>Agent</legend>
              <div className="space-y-1">
                {choices.map((option) => {
                  const state = availability[option.id];
                  const active = option.id === choiceId;
                  const authProvider = "configured" in option ? option : undefined;
                  const authStatus = authProvider ? auth?.find((entry) => entry.name === authProvider.id) : undefined;
                  const row = (
                    <Item
                      key={option.id}
                      size="xs"
                      variant={active ? "outline" : "default"}
                      className={active ? "border-ring bg-accent" : "hover:bg-muted/60"}
                      render={
                        <button
                          type="button"
                          aria-pressed={active}
                          disabled={Boolean(installing)}
                          onClick={() => (active && ready ? start() : setChoiceId(option.id))}
                        />
                      }
                    >
                      {/* The same tile the session wears in the sidebar, so the choice looks like its result. */}
                      <ItemMedia variant="icon" className="size-7 rounded-md border bg-background">
                        <ProviderIcon agent={option.agent} provider={option.provider} />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{sessionLabel(option)}</ItemTitle>
                        {authProvider ? (
                          <ProviderAuthDescription provider={authProvider} status={authStatus} />
                        ) : (
                          <ItemDescription>{"description" in option ? option.description : undefined}</ItemDescription>
                        )}
                      </ItemContent>
                      <ItemActions>
                        {state && !state.available ? <Badge variant="outline">Not installed</Badge> : null}
                        <Check className={`size-4 shrink-0 ${active ? "" : "invisible"}`} />
                      </ItemActions>
                    </Item>
                  );
                  return "note" in option ? (
                    <Tooltip key={option.id}>
                      <TooltipTrigger render={row} />
                      <TooltipContent className="max-w-64">{option.note}</TooltipContent>
                    </Tooltip>
                  ) : (
                    row
                  );
                })}
              </div>
              {missing ? <p className="text-xs text-muted-foreground">{missing.detail}</p> : null}
            </fieldset>
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
