// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { ProviderIcon } from "@/brand-icons";
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { type Agent, agentLabel, type ModelProvider, providerLabel, sessionLabel } from "@/types";

export const AUTH_PROVIDERS = {
  codex: {
    id: "codex",
    agent: "codex",
    provider: "openai",
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
    variable: "DEEPSEEK_API_KEY",
    signIn: false,
    note: "Runs Codex against DeepSeek. Usage bills DeepSeek, not OpenAI.",
  },
  zai: {
    id: "zai",
    agent: "codex",
    provider: "zai",
    variable: "ZAI_API_KEY",
    signIn: false,
    note: "Runs Codex against Z.ai. Usage bills Z.ai, not OpenAI.",
  },
  mimo: {
    id: "mimo",
    agent: "codex",
    provider: "mimo",
    variable: "MIMO_API_KEY",
    signIn: false,
    note: "Runs Codex against Xiaomi MiMo. Usage bills Xiaomi, not OpenAI.",
  },
  openrouter: {
    id: "openrouter",
    agent: "codex",
    provider: "openrouter",
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
    label?: string;
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

// The vendor a provider belongs to. A Codex provider is named by types.ts, which owns every ModelProvider
// label already; only a harness Lite has no ModelProvider for carries a name of its own.
export function providerName(option: { provider?: ModelProvider; label?: string }): string {
  return option.provider ? providerLabel(option.provider) : (option.label ?? "");
}

// The one way a provider is drawn anywhere in Lite: its mark, its name, and a single line beneath. The
// welcome grid, the new-session dialog, and the settings list all render this, so the mark size, the name,
// and the line's type can only be changed for all three at once. Each passes its own words as children.
export function ProviderRow({
  option,
  children,
}: {
  option: { agent: Agent; provider?: ModelProvider };
  children?: ReactNode;
}) {
  return (
    <>
      <ItemMedia variant="icon">
        <ProviderIcon agent={option.agent} provider={option.provider} className="size-5" />
      </ItemMedia>
      <ItemContent className="gap-0.5">
        <ItemTitle className="w-full truncate">{sessionLabel(option)}</ItemTitle>
        <ItemDescription className="truncate text-xs leading-4">{children}</ItemDescription>
      </ItemContent>
    </>
  );
}

// The words for that line when the provider is one Lite authenticates: the state and nothing else. An API
// key is in play, or the CLI owns the sign-in. Which file the key sits in does not change the sentence,
// because the actions beside it already say so — a key Lite holds is the one that offers Replace and Delete.
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
      {hint || status.cliAuthMethod === "apiKey" ? "Using API key" : `Signed in through ${agentLabel(provider.agent)}`}
    </span>
  );
}
