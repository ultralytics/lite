// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { Check } from "lucide-react";

import { ItemDescription } from "@/components/ui/item";
import type { Agent, ModelProvider } from "@/types";

export const AUTH_PROVIDERS = {
  codex: {
    id: "codex",
    agent: "codex",
    provider: "openai",
    label: "OpenAI",
    variable: "OPENAI_API_KEY",
    configured: "Signed in through Codex",
    signIn: true,
  },
  claude: {
    id: "claude",
    agent: "claude",
    provider: undefined,
    label: "Anthropic",
    variable: "ANTHROPIC_API_KEY",
    configured: "Signed in through Claude Code",
    signIn: true,
  },
  deepseek: {
    id: "deepseek",
    agent: "codex",
    provider: "deepseek",
    label: "DeepSeek",
    variable: "DEEPSEEK_API_KEY",
    configured: "Using API key",
    signIn: false,
    note: "Runs Codex against DeepSeek. Usage bills DeepSeek, not OpenAI.",
  },
  openrouter: {
    id: "openrouter",
    agent: "codex",
    provider: "openrouter",
    label: "OpenRouter",
    variable: "OPENROUTER_API_KEY",
    configured: "Using API key",
    signIn: false,
    note: "Runs Codex against OpenRouter. Usage bills OpenRouter, not OpenAI.",
  },
  gemini: {
    id: "gemini",
    agent: "gemini",
    provider: undefined,
    label: "Google Gemini",
    variable: "GEMINI_API_KEY",
    configured: "Signed in through Gemini CLI",
    signIn: true,
  },
  kimi: {
    id: "kimi",
    agent: "kimi",
    provider: undefined,
    label: "Moonshot AI",
    variable: "MOONSHOT_API_KEY",
    configured: "Configured through Kimi Code",
    signIn: true,
  },
  qwen: {
    id: "qwen",
    agent: "qwen",
    provider: undefined,
    label: "Alibaba ModelStudio",
    configured: "Set up through Qwen Code",
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
    configured: string;
    signIn: boolean;
    note?: string;
  }
>;

export interface ProviderAuth {
  name: string;
  keyHint: string | null;
  cliAuthMethod: "provider" | "apiKey" | null;
}

export function ProviderAuthDescription({
  provider,
  status,
}: {
  provider: (typeof AUTH_PROVIDERS)[keyof typeof AUTH_PROVIDERS];
  status?: ProviderAuth;
}) {
  const hint = status?.keyHint;
  const configured = status?.keyHint ? "Using API key" : provider.configured;
  return (
    <ItemDescription className="truncate text-xs leading-4">
      {status && (hint || status.cliAuthMethod) ? (
        <span className="flex items-center gap-1.5">
          <Check className="size-3.5 shrink-0" />
          {configured}
          {hint ? <span className="font-mono">••••{hint}</span> : null}
        </span>
      ) : status ? (
        "Not set up"
      ) : (
        "Checking…"
      )}
    </ItemDescription>
  );
}
