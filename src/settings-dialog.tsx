// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import { Check, Trash2 } from "lucide-react";
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
import type { Agent, ModelProvider } from "@/types";

// Each CLI signs in on its own; a key here is the alternative for anyone who would rather not.
const providers: {
  id: string;
  agent: Agent;
  provider?: ModelProvider;
  label: string;
  variable: string;
}[] = [
  { id: "claude", agent: "claude", label: "Anthropic", variable: "ANTHROPIC_API_KEY" },
  { id: "codex", agent: "codex", provider: "openai", label: "OpenAI", variable: "OPENAI_API_KEY" },
  { id: "deepseek", agent: "codex", provider: "deepseek", label: "DeepSeek", variable: "DEEPSEEK_API_KEY" },
  { id: "kimi", agent: "kimi", label: "Moonshot", variable: "MOONSHOT_API_KEY" },
];

export function SettingsDialog({
  open: isOpen,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [saved, setSaved] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setDrafts({});
    void invoke<string[]>("saved_api_keys")
      .then(setSaved)
      .catch((reason) => setError(String(reason)));
  }, [isOpen]);

  async function save(id: string) {
    setError("");
    try {
      await invoke("save_api_key", { name: id, key: drafts[id] ?? "" });
      setDrafts((current) => ({ ...current, [id]: "" }));
      setSaved(await invoke<string[]>("saved_api_keys"));
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function remove(id: string) {
    setError("");
    try {
      await invoke("delete_api_key", { name: id });
      setSaved(await invoke<string[]>("saved_api_keys"));
    } catch (reason) {
      setError(String(reason));
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
            const stored = saved.includes(option.id);
            return (
              <div key={option.id} className="flex items-center gap-3">
                <ProviderIcon agent={option.agent} provider={option.provider} className="size-5 shrink-0" />
                <span className="w-32 shrink-0">
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="block font-mono text-[10px] text-muted-foreground">{option.variable}</span>
                </span>
                {stored ? (
                  <>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
                      <Check className="size-3.5 text-emerald-500" />
                      Key saved
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void remove(option.id)}
                      aria-label={`Delete the ${option.label} key`}
                    >
                      <Trash2 />
                    </Button>
                  </>
                ) : (
                  <>
                    <Input
                      type="password"
                      value={drafts[option.id] ?? ""}
                      className="min-w-0 flex-1 font-mono text-xs"
                      placeholder="Paste a key"
                      aria-label={`${option.label} API key`}
                      onChange={(event) => setDrafts((current) => ({ ...current, [option.id]: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void save(option.id);
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!drafts[option.id]?.trim()}
                      onClick={() => void save(option.id)}
                    >
                      Save
                    </Button>
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
