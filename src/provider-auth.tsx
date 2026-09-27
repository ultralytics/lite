// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import { Check, ExternalLink, Eye, EyeOff } from "lucide-react";
import { type ReactNode, useState } from "react";

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
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { type Agent, agentLabel, type ModelProvider, providerLabel } from "@/types";

export const AUTH_PROVIDERS = {
  codex: {
    id: "codex",
    agent: "codex",
    provider: "openai",
    variable: "OPENAI_API_KEY",
    keys: "https://platform.openai.com/api-keys",
    placeholder: "e.g., sk-proj-…",
    signIn: true,
  },
  claude: {
    id: "claude",
    agent: "claude",
    provider: undefined,
    label: "Anthropic",
    variable: "ANTHROPIC_API_KEY",
    keys: "https://platform.claude.com/settings/keys",
    placeholder: "e.g., sk-ant-api…",
    signIn: true,
  },
  deepseek: {
    id: "deepseek",
    agent: "codex",
    provider: "deepseek",
    variable: "DEEPSEEK_API_KEY",
    keys: "https://platform.deepseek.com/api_keys",
    placeholder: "e.g., sk-…",
    signIn: false,
    note: "Runs Codex against DeepSeek. Usage bills DeepSeek, not OpenAI.",
  },
  zai: {
    id: "zai",
    agent: "codex",
    provider: "zai",
    variable: "ZAI_API_KEY",
    keys: "https://z.ai/manage-apikey/apikey-list",
    placeholder: "e.g., 1a2b3c….AbCd…",
    signIn: false,
    note: "Runs Codex against Z.ai. Usage bills Z.ai, not OpenAI.",
  },
  mimo: {
    id: "mimo",
    agent: "codex",
    provider: "mimo",
    variable: "MIMO_API_KEY",
    keys: "https://platform.xiaomimimo.com/#/console/api-keys",
    placeholder: "e.g., sk-…",
    signIn: false,
    note: "Runs Codex against Xiaomi MiMo. Usage bills Xiaomi, not OpenAI.",
  },
  openrouter: {
    id: "openrouter",
    agent: "codex",
    provider: "openrouter",
    variable: "OPENROUTER_API_KEY",
    keys: "https://openrouter.ai/settings/keys",
    placeholder: "e.g., sk-or-v1-…",
    signIn: false,
    note: "Runs Codex against OpenRouter. Usage bills OpenRouter, not OpenAI.",
  },
  gemini: {
    id: "gemini",
    agent: "gemini",
    provider: undefined,
    label: "Google Gemini",
    variable: "GEMINI_API_KEY",
    keys: "https://aistudio.google.com/apikey",
    placeholder: "e.g., AQ.…",
    signIn: true,
  },
  kimi: {
    id: "kimi",
    agent: "kimi",
    provider: undefined,
    label: "Moonshot AI",
    variable: "MOONSHOT_API_KEY",
    keys: "https://platform.kimi.ai/console/api-keys",
    placeholder: "e.g., sk-…",
    signIn: true,
  },
  qwen: {
    id: "qwen",
    agent: "qwen",
    provider: undefined,
    label: "Alibaba ModelStudio",
    signIn: true,
  },
} as const satisfies Record<
  string,
  {
    id: string;
    agent: Agent;
    provider?: ModelProvider;
    label?: string;
    variable?: string;
    // Where the vendor hands out API keys, and what one of its keys starts like.
    keys?: string;
    placeholder?: string;
    signIn: boolean;
    note?: string;
  }
>;

// A vendor Lite can hold an API key for.
export type KeyProvider = Extract<(typeof AUTH_PROVIDERS)[keyof typeof AUTH_PROVIDERS], { variable: string }>;
export const KEY_PROVIDERS = Object.values(AUTH_PROVIDERS).filter(
  (option): option is KeyProvider => "variable" in option,
);

export interface ProviderAuth {
  name: string;
  keyHint: string | null;
  cliAuthMethod: "provider" | "apiKey" | null;
}

// The vendor a provider belongs to. A Codex provider is named by types.ts, which owns every ModelProvider
// label already; only a harness Lite has no ModelProvider for carries a name of its own.
export function providerName(option: { provider?: ModelProvider; label?: string }): string {
  return option.provider ? providerLabel(option.provider) : (option.label ?? "");
}

// How a new-session row's provider is connected: a key Lite saved, a key in the CLI's own configuration, or
// the CLI's sign-in, in the order they take priority.
export function ProviderAuthDescription({
  provider,
  status,
}: {
  provider: (typeof AUTH_PROVIDERS)[keyof typeof AUTH_PROVIDERS];
  status?: ProviderAuth;
}) {
  const hint = status?.keyHint;
  if (!status) return "Checking…";
  if (!hint && !status.cliAuthMethod) return "Not set up";
  return (
    <span className="flex items-center gap-1.5">
      <Check className="size-3.5 shrink-0" />
      {hint
        ? "API key saved in Lite"
        : status.cliAuthMethod === "apiKey"
          ? `API key in ${agentLabel(provider.agent)}’s configuration`
          : "Signed in"}
    </span>
  );
}

// Adding or replacing one vendor's key: what it is for, where to get one, and the key itself. Settings and
// the new-session dialog both open this, so a vendor's key is only ever entered here. The key is saved
// the moment the user confirms; onSaved then does whatever the key was wanted for.
export function ApiKeyDialog({
  provider,
  replacing,
  saveLabel = replacing ? "Replace key" : "Save key",
  footer,
  onClose,
  onSaved,
}: {
  provider?: KeyProvider;
  replacing: boolean;
  saveLabel?: string;
  footer?: ReactNode;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [key, setKey] = useState("");
  const [shown, setShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  function close() {
    setKey("");
    setError("");
    onClose();
  }
  async function save() {
    if (!provider || !key.trim()) return;
    setSaving(true);
    setError("");
    try {
      await invoke("save_api_key", { name: provider.id, key: key.trim() });
      setKey("");
      onClose();
      await onSaved();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={Boolean(provider)} onOpenChange={(open) => !open && !saving && close()}>
      {provider ? (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ProviderIcon agent={provider.agent} provider={provider.provider} className="size-5" />
              {replacing ? "Replace" : "Add"} {providerName(provider)} API key
            </DialogTitle>
            <DialogDescription>
              {"note" in provider ? provider.note : `${agentLabel(provider.agent)} uses it instead of its own sign-in.`}{" "}
              <button
                type="button"
                className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
                onClick={() => void invoke("open_url", { url: provider.keys })}
              >
                Get an API key
                <ExternalLink aria-hidden="true" className="size-3" />
              </button>
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <InputGroup>
              <InputGroupInput
                autoFocus
                type={shown ? "text" : "password"}
                value={key}
                className="font-mono"
                placeholder={provider.placeholder}
                aria-label={`${providerName(provider)} API key`}
                autoComplete="off"
                disabled={saving}
                onChange={(event) => setKey(event.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label={shown ? "Hide the key" : "Show the key"}
                  onClick={() => setShown((current) => !current)}
                >
                  {shown ? <EyeOff /> : <Eye />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <p className="text-xs text-muted-foreground">
              Kept on this computer and handed to {agentLabel(provider.agent)} as{" "}
              <span className="font-mono">{provider.variable}</span>.
            </p>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </form>
          <DialogFooter className="items-center sm:justify-between">
            <span>{footer}</span>
            <span className="flex gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={close}>
                Cancel
              </Button>
              <Button type="button" disabled={saving || !key.trim()} onClick={() => void save()}>
                {saving ? <Spinner /> : null}
                {saveLabel}
              </Button>
            </span>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
