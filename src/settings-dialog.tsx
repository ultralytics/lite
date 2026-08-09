// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemFooter, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { AUTH_PROVIDERS, type ProviderAuth, ProviderAuthDescription } from "@/provider-auth";
import type { Agent } from "@/types";

// Each CLI signs in on its own; a key here is the alternative for anyone who would rather not.
const providers = Object.values(AUTH_PROVIDERS).filter((provider) => "variable" in provider);

export function SettingsDialog({
  open: isOpen,
  onOpenChange,
  onSignIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignIn: (agent: Agent) => void;
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

  function reveal(id: string) {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
            Each row shows how new sessions sign in. API keys saved here stay on this computer and take priority over
            provider sign-in.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ItemGroup>
            {providers.map((option) => {
              const status = auth?.find((entry) => entry.name === option.id);
              const open = editing.has(option.id);
              const draft = drafts[option.id] ?? "";
              const shown = revealed.has(option.id);
              return (
                <Item key={option.id} variant="outline">
                  <ItemMedia variant="icon">
                    <ProviderIcon agent={option.agent} provider={option.provider} className="size-5" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {option.label}
                      <Badge variant="outline" className="font-mono font-normal">
                        {option.variable}
                      </Badge>
                    </ItemTitle>
                    <ProviderAuthDescription provider={option} status={status} />
                  </ItemContent>
                  {open ? null : (
                    <ItemActions>
                      {!status?.keyHint && !status?.cliAuthMethod && option.signIn ? (
                        <Button variant="outline" size="sm" onClick={() => onSignIn(option.agent)}>
                          Sign in
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="sm" onClick={() => edit(option.id, true)}>
                        {status?.keyHint || status?.cliAuthMethod === "apiKey" ? "Replace API key" : "Use API key"}
                      </Button>
                      {status?.keyHint || status?.cliKeyHint ? (
                        <ActionIconButton
                          size="icon-sm"
                          className="hover:text-destructive"
                          tooltip="Delete this key"
                          aria-label={`Delete the ${option.label} key`}
                          disabled={busy === option.id}
                          onClick={() => void remove(option.id)}
                        >
                          {busy === option.id ? <Spinner /> : <Trash2 />}
                        </ActionIconButton>
                      ) : null}
                    </ItemActions>
                  )}
                  {open ? (
                    <ItemFooter>
                      <InputGroup>
                        <InputGroupInput
                          autoFocus
                          type={shown ? "text" : "password"}
                          value={draft}
                          className="font-mono"
                          placeholder="Paste a key"
                          aria-label={`${option.label} API key`}
                          onChange={(event) =>
                            setDrafts((current) => ({ ...current, [option.id]: event.target.value }))
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && draft.trim()) void save(option.id);
                            if (event.key === "Escape") edit(option.id, false);
                          }}
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupButton
                            size="icon-xs"
                            aria-label={shown ? "Hide the key" : "Show the key"}
                            onClick={() => reveal(option.id)}
                          >
                            {shown ? <EyeOff /> : <Eye />}
                          </InputGroupButton>
                        </InputGroupAddon>
                      </InputGroup>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!draft.trim() || busy === option.id}
                        onClick={() => void save(option.id)}
                      >
                        {busy === option.id ? <Spinner /> : null}
                        Save
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => edit(option.id, false)}>
                        Cancel
                      </Button>
                    </ItemFooter>
                  ) : null}
                </Item>
              );
            })}
          </ItemGroup>
          {error ? (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
