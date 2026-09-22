// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { Check } from "lucide-react";

import { ItemDescription } from "@/components/ui/item";
import { type Agent, agentLabel, type ModelProvider } from "@/types";

export const AUTH_PROVIDERS = {
  codex: {
    id: "codex",
    agent: "codex",
    provider: "openai",
    label: "OpenAI",
    variable: "OPENAI_API_KEY",
    signIn: true,
  },
  claude: {
    id: "claude",
    agent: "claude",
    provider: undefined,
    label: "Anthropic",
    variable: "ANTHROPIC_API_KEY",
    signIn: true,
  },
  deepseek: {
    id: "deepseek",
    agent: "codex",
    provider: "deepseek",
    label: "DeepSeek",
    variable: "DEEPSEEK_API_KEY",
    signIn: false,
    note: "Runs Codex against DeepSeek. Usage bills DeepSeek, not OpenAI.",
  },
  zai: {
    id: "zai",
    agent: "codex",
    provider: "zai",
    label: "Z.ai",
    variable: "ZAI_API_KEY",
    signIn: false,
    note: "Runs Codex against Z.ai. Usage bills Z.ai, not OpenAI.",
  },
  mimo: {
    id: "mimo",
    agent: "codex",
    provider: "mimo",
    label: "Xiaomi MiMo",
    variable: "MIMO_API_KEY",
    signIn: false,
    note: "Runs Codex against Xiaomi MiMo. Usage bills Xiaomi, not OpenAI.",
  },
  openrouter: {
    id: "openrouter",
    agent: "codex",
    provider: "openrouter",
    label: "OpenRouter",
    variable: "OPENROUTER_API_KEY",
    signIn: false,
    note: "Runs Codex against OpenRouter. Usage bills OpenRouter, not OpenAI.",
  },
  gemini: {
    id: "gemini",
    agent: "gemini",
    provider: undefined,
    label: "Google Gemini",
    variable: "GEMINI_API_KEY",
    signIn: true,
  },
  kimi: {
    id: "kimi",
    agent: "kimi",
    provider: undefined,
    label: "Moonshot AI",
    variable: "MOONSHOT_API_KEY",
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
    label: string;
    variable?: string;
    signIn: boolean;
    note?: string;
  }
>;

export interface ProviderAuth {
  name: string;
  keyHint: string | null;
  cliAuthMethod: "provider" | "apiKey" | null;
}

// Every card states the state and nothing else: an API key is in play, or the CLI owns the sign-in. Which
// file the key sits in does not change that sentence, because the actions beside it already say so — a key
// Lite holds is the one that offers Replace and Delete. So no provider carries status prose of its own.
export function ProviderAuthDescription({
  provider,
  status,
}: {
  provider: (typeof AUTH_PROVIDERS)[keyof typeof AUTH_PROVIDERS];
  status?: ProviderAuth;
}) {
  const hint = status?.keyHint;
  const cli = agentLabel(provider.agent);
  return (
    <ItemDescription className="truncate text-xs leading-4">
      {status && (hint || status.cliAuthMethod) ? (
        <span className="flex items-center gap-1.5">
          <Check className="size-3.5 shrink-0" />
          {hint || status.cliAuthMethod === "apiKey" ? "Using API key" : `Signed in through ${cli}`}
        </span>
      ) : status ? (
        "Not set up"
      ) : (
        "Checking…"
      )}
    </ItemDescription>
  );
}
