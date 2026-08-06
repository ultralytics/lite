// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import { Check, Eye, EyeOff, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
import type { Agent, ModelProvider } from "@/types";

// Each CLI signs in on its own; a key here is the alternative for anyone who would rather not.
const providers: {
  id: string;
  agent: Agent;
  provider?: ModelProvider;
  label: string;
  variable: string;
  signedIn: string;
}[] = [
  {
    id: "claude",
    agent: "claude",
    label: "Anthropic",
    variable: "ANTHROPIC_API_KEY",
    signedIn: "Signed in through Claude Code",
  },
  {
    id: "codex",
    agent: "codex",
    provider: "openai",
    label: "OpenAI",
    variable: "OPENAI_API_KEY",
    signedIn: "Signed in through Codex",
  },
  {
    id: "deepseek",
    agent: "codex",
    provider: "deepseek",
    label: "DeepSeek",
    variable: "DEEPSEEK_API_KEY",
    signedIn: "Configured in your Codex settings",
  },
  {
    id: "kimi",
    agent: "kimi",
    label: "Moonshot",
    variable: "MOONSHOT_API_KEY",
    signedIn: "Configured in Kimi Code",
  },
];

interface ProviderAuth {
  name: string;
  keyHint: string | null;
  cliSignedIn: boolean;
}

export function SettingsDialog({
  open: isOpen,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [auth, setAuth] = useState<ProviderAuth[]>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const read = useCallback(async () => {
    setAuth(await invoke<ProviderAuth[]>("provider_auth"));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setDrafts({});
    setEditing(new Set());
    setRevealed(new Set());
    void read().catch((reason) => setError(String(reason)));
  }, [isOpen, read]);

  function edit(id: string, open: boolean) {
    setEditing((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
    if (!open) setDrafts((current) => ({ ...current, [id]: "" }));
  }

  async function save(id: string) {
    setError("");
    setBusy(id);
    try {
      await invoke("save_api_key", { name: id, key: drafts[id] ?? "" });
      setDrafts((current) => ({ ...current, [id]: "" }));
      edit(id, false);
      await read();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function remove(id: string) {
    setError("");
    setBusy(id);
    try {
      await invoke("delete_api_key", { name: id });
      await read();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>API keys</DialogTitle>
          <DialogDescription>
            Sessions use the key saved here when one exists, and the provider's own sign-in when it does not. Keys stay
            on this computer in Lite's data folder and reach a session through its provider's environment variable.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {providers.map((option) => {
            const status = auth?.find((entry) => entry.name === option.id);
            const open = editing.has(option.id) || (auth !== undefined && !status?.keyHint && !status?.cliSignedIn);
            const draft = drafts[option.id] ?? "";
            return (
              <div key={option.id} className="flex items-center gap-3">
                <ProviderIcon agent={option.agent} provider={option.provider} className="size-5 shrink-0" />
                <span className="w-32 shrink-0">
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="block font-mono text-[10px] text-muted-foreground">{option.variable}</span>
                </span>
                {open ? (
                  <>
                    <span className="relative flex min-w-0 flex-1 items-center">
                      <Input
                        autoFocus={editing.has(option.id)}
                        type={revealed.has(option.id) ? "text" : "password"}
                        value={draft}
                        className="min-w-0 flex-1 pr-8 font-mono text-xs"
                        placeholder="Paste a key"
                        aria-label={`${option.label} API key`}
                        onChange={(event) => setDrafts((current) => ({ ...current, [option.id]: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && draft.trim()) void save(option.id);
                          if (event.key === "Escape") edit(option.id, false);
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="absolute right-1"
                        aria-label={revealed.has(option.id) ? "Hide the key" : "Show the key"}
                        onClick={() =>
                          setRevealed((current) => {
                            const next = new Set(current);
                            if (next.has(option.id)) next.delete(option.id);
                            else next.add(option.id);
                            return next;
                          })
                        }
                      >
                        {revealed.has(option.id) ? <EyeOff /> : <Eye />}
                      </Button>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!draft.trim() || busy === option.id}
                      onClick={() => void save(option.id)}
                    >
                      {busy === option.id ? <Spinner /> : null}
                      Save
                    </Button>
                    {status?.keyHint || status?.cliSignedIn ? (
                      <Button variant="ghost" size="sm" onClick={() => edit(option.id, false)}>
                        Cancel
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
                      {status?.keyHint ? (
                        <>
                          <Check className="size-3.5 shrink-0 text-emerald-500" />
                          <span>Key saved</span>
                          <span className="font-mono">••••{status.keyHint}</span>
                        </>
                      ) : (
                        <span className="truncate">{status ? option.signedIn : "Checking…"}</span>
                      )}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => edit(option.id, true)}>
                      {status?.keyHint ? "Replace" : "Use a key"}
                    </Button>
                    {status?.keyHint ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy === option.id}
                        onClick={() => void remove(option.id)}
                        aria-label={`Delete the ${option.label} key`}
                      >
                        {busy === option.id ? <Spinner /> : <Trash2 />}
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
