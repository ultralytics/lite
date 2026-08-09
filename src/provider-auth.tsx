// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { Check } from "lucide-react";

import { ItemDescription } from "@/components/ui/item";
import type { Agent, ModelProvider } from "@/types";

export const AUTH_PROVIDERS = {
  claude: {
    id: "claude",
    agent: "claude",
    provider: undefined,
    label: "Anthropic",
    variable: "ANTHROPIC_API_KEY",
    configured: "Signed in through Claude Code",
    signIn: true,
  },
  codex: {
    id: "codex",
    agent: "codex",
    provider: "openai",
    label: "OpenAI",
    variable: "OPENAI_API_KEY",
    configured: "Signed in through Codex",
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
  },
  kimi: {
    id: "kimi",
    agent: "kimi",
    provider: undefined,
    label: "Kimi Code",
    variable: "MOONSHOT_API_KEY",
    configured: "Signed in through Kimi Code",
    signIn: true,
  },
} as const satisfies Record<
  string,
  {
    id: string;
    agent: Agent;
    provider?: ModelProvider;
    label: string;
    variable: string;
    configured: string;
    signIn: boolean;
  }
>;

export type AuthProviderId = keyof typeof AUTH_PROVIDERS;

export interface ProviderAuth {
  name: string;
  keyHint: string | null;
  cliAuthMethod: "provider" | "apiKey" | null;
  cliKeyHint: string | null;
}

export function ProviderAuthDescription({
  provider,
  status,
}: {
  provider: (typeof AUTH_PROVIDERS)[AuthProviderId];
  status?: ProviderAuth;
}) {
  const hint = status?.keyHint ?? status?.cliKeyHint;
  const configured = status?.keyHint || status?.cliKeyHint ? "Using API key" : provider.configured;
  return (
    <ItemDescription>
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
