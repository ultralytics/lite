// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";

import { ProviderIcon } from "@/brand-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type Agent, type ModelProvider, type Session, sessionLabel } from "@/types";

interface Choice {
  id: string;
  agent: Agent;
  provider?: ModelProvider;
  description: string;
  note?: string;
}

const choices: Choice[] = [
  { id: "claude", agent: "claude", description: "Use your Anthropic account" },
  { id: "codex", agent: "codex", provider: "openai", description: "Use your OpenAI account" },
  {
    id: "codex-deepseek",
    agent: "codex",
    provider: "deepseek",
    description: "Codex, billed to DeepSeek",
    note: "Runs the Codex harness against the DeepSeek provider in your Codex configuration. Usage bills DeepSeek, not OpenAI.",
  },
  { id: "kimi", agent: "kimi", description: "Use your Kimi Code account" },
  { id: "shell", agent: "shell", description: "Open your default shell" },
];

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
  const [availability, setAvailability] = useState<Record<string, Availability>>({});
  const [error, setError] = useState("");
  const choice = choices.find((option) => option.id === choiceId) ?? choices[0];
  const status = availability[choice.id];

  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    setError("");
    setAvailability({});
    void invoke<DirectoryGrant>("default_directory")
      .then((selected) => {
        if (disposed) void invoke("revoke_directory", { rootId: selected.id });
        else setDirectory(selected);
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
      }
    } catch (reason) {
      setError(String(reason));
    }
  }

  function changeOpen(open: boolean) {
    if (!open && directory) {
      void invoke("revoke_directory", { rootId: directory.id });
      setDirectory(undefined);
    }
    onOpenChange(open);
  }

  function create() {
    if (!directory) return;
    const project = directory.path.split(/[\\/]/).filter(Boolean).pop() ?? "Session";
    onCreate({
      id: crypto.randomUUID(),
      agent: choice.agent,
      provider: choice.provider,
      cwd: directory.path,
      rootId: directory.id,
      name: project,
      running: false,
    });
    setDirectory(undefined);
    onOpenChange(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>Choose an agent and the folder it should work in.</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 space-y-1">
          {choices.map((option) => {
            const state = availability[option.id];
            const row = (
              <button
                type="button"
                aria-pressed={option.id === choiceId}
                onClick={() => setChoiceId(option.id)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${option.id === choiceId ? "border-foreground bg-muted" : "border-transparent hover:bg-muted/60"}`}
              >
                <ProviderIcon agent={option.agent} provider={option.provider} className="size-5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{sessionLabel(option)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{option.description}</span>
                </span>
                {state && !state.available ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground">Not set up</span>
                ) : null}
              </button>
            );
            return (
              <div key={option.id}>
                {option.note ? (
                  <Tooltip>
                    <TooltipTrigger render={row} />
                    <TooltipContent className="max-w-64">{option.note}</TooltipContent>
                  </Tooltip>
                ) : (
                  row
                )}
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          <Input
            value={directory?.path ?? ""}
            readOnly
            className="font-mono text-xs"
            placeholder="Choose a project folder"
            aria-label="Project folder"
          />
          <Button variant="outline" onClick={chooseFolder} disabled={!directory && !error}>
            <FolderOpen />
            Browse
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {status && !status.available ? <p className="text-xs text-muted-foreground">{status.detail}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => changeOpen(false)}>
            Cancel
          </Button>
          {status && !status.available ? (
            <Button
              onClick={() =>
                void invoke("open_setup_docs", { agent: choice.agent, provider: choice.provider }).catch((reason) =>
                  setError(String(reason)),
                )
              }
            >
              Open setup guide
            </Button>
          ) : (
            <Button disabled={!directory || !status} onClick={create}>
              {status ? null : <Spinner />}
              Start session
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
