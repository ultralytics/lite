// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import { Check, FolderOpen } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

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
import { AUTH_PROVIDERS, type AuthProviderId, type ProviderAuth, ProviderAuthDescription } from "@/provider-auth";
import { type Agent, type ModelProvider, type Session, sessionLabel } from "@/types";

interface Choice {
  id: string;
  agent: Agent;
  provider?: ModelProvider;
  auth?: AuthProviderId;
  description?: string;
  note?: string;
}

const choices: Choice[] = [
  { id: "claude", agent: "claude", auth: "claude" },
  { id: "codex", agent: "codex", provider: "openai", auth: "codex" },
  {
    id: "codex-deepseek",
    agent: "codex",
    provider: "deepseek",
    auth: "deepseek",
    note: "Runs the Codex harness against the DeepSeek provider in your Codex configuration. Usage bills DeepSeek, not OpenAI.",
  },
  { id: "kimi", agent: "kimi", auth: "kimi" },
  { id: "shell", agent: "shell", description: "Open your default shell" },
];

// The quiet heading that separates the two questions the dialog asks, in the sidebar's own label style.
const SECTION = "text-[11px] font-medium tracking-wide text-muted-foreground uppercase";

interface DirectoryGrant {
  id: string;
  path: string;
}

interface Availability {
  available: boolean;
  detail: string;
}

export function NewSessionDialog({
  open: isOpen,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (session: Session) => void;
}) {
  const [choiceId, setChoiceId] = useState(choices[0].id);
  const [directory, setDirectory] = useState<DirectoryGrant>();
  const [path, setPath] = useState("");
  const [availability, setAvailability] = useState<Record<string, Availability>>({});
  const [auth, setAuth] = useState<ProviderAuth[]>();
  const [error, setError] = useState("");
  const choice = choices.find((option) => option.id === choiceId) ?? choices[0];
  const status = availability[choice.id];
  // An agent that is not installed cannot take a session yet, so the dialog offers its setup guide instead.
  const missing = status && !status.available ? status : undefined;

  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    setError("");
    setAvailability({});
    setAuth(undefined);
    void invoke<DirectoryGrant>("default_directory")
      .then((selected) => {
        if (disposed) void invoke("revoke_directory", { rootId: selected.id });
        else {
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
      .catch(() => {
        if (!disposed) setAuth([]);
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
    if (!open && directory) {
      void invoke("revoke_directory", { rootId: directory.id });
      setDirectory(undefined);
    }
    onOpenChange(open);
  }

  async function create() {
    const folder = await grant();
    if (!folder) return;
    const project = folder.path.split(/[\\/]/).filter(Boolean).pop() ?? "Session";
    onCreate({
      id: crypto.randomUUID(),
      agent: choice.agent,
      provider: choice.provider,
      cwd: folder.path,
      rootId: folder.id,
      name: project,
      running: false,
    });
    setDirectory(undefined);
    onOpenChange(false);
  }

  // Everything the dialog can be asked for arrives here: the submit button, Enter from the folder field,
  // and a second click on the agent already chosen. An agent that is not installed reads them all as a
  // request for its setup guide, which is the only one of the two it can answer.
  const ready = Boolean(missing || (path.trim() && status));
  function start() {
    if (missing)
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
            <fieldset className="space-y-1.5">
              <legend className={SECTION}>Agent</legend>
              <div className="space-y-1">
                {choices.map((option) => {
                  const state = availability[option.id];
                  const active = option.id === choiceId;
                  const authProvider = option.auth ? AUTH_PROVIDERS[option.auth] : undefined;
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
                          <ItemDescription>{option.description}</ItemDescription>
                        )}
                      </ItemContent>
                      <ItemActions>
                        {state && !state.available ? <Badge variant="outline">Not installed</Badge> : null}
                        <Check className={`size-4 shrink-0 ${active ? "" : "invisible"}`} />
                      </ItemActions>
                    </Item>
                  );
                  return option.note ? (
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
            <Button variant="outline" onClick={() => changeOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              {status ? null : <Spinner />}
              {missing ? "Open setup guide" : "Start session"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
