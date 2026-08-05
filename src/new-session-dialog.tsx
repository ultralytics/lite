import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, TerminalSquare } from "lucide-react";

import { ClaudeLogomark, OpenAILogomark } from "@/brand-icons";
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
import type { Agent, Session } from "@/types";

const agents: {
  id: Agent;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "claude",
    label: "Claude Code",
    description: "Use your Anthropic account",
    icon: <ClaudeLogomark className="size-5" />,
  },
  {
    id: "codex",
    label: "Codex",
    description: "Use your OpenAI account",
    icon: <OpenAILogomark className="size-5" />,
  },
  {
    id: "shell",
    label: "Shell",
    description: "Open your default shell",
    icon: <TerminalSquare className="size-5" />,
  },
];

interface DirectoryGrant {
  id: string;
  path: string;
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
  const [agent, setAgent] = useState<Agent>("claude");
  const [directory, setDirectory] = useState<DirectoryGrant>();
  const [error, setError] = useState("");

  async function chooseFolder() {
    setError("");
    try {
      const selected = await invoke<DirectoryGrant | null>("choose_directory");
      if (selected) {
        if (directory)
          void invoke("revoke_directory", { rootId: directory.id });
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
    const project =
      directory.path.split(/[\\/]/).filter(Boolean).pop() ?? "Session";
    onCreate({
      id: crypto.randomUUID(),
      agent,
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
          <DialogDescription>
            Choose an agent and the folder it should work in.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          {agents.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setAgent(option.id)}
              className={`flex min-h-24 flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors ${agent === option.id ? "border-foreground bg-muted" : "hover:bg-muted/60"}`}
            >
              {option.icon}
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-xs leading-4 text-muted-foreground">
                {option.description}
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={directory?.path ?? ""}
            readOnly
            placeholder="Choose a project folder"
            aria-label="Project folder"
          />
          <Button variant="outline" onClick={chooseFolder}>
            <FolderOpen />
            Browse
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => changeOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!directory} onClick={create}>
            Start session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
