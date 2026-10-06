// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Info,
  Keyboard,
  KeyRound,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sun,
  Trash2,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { GitHubLogomark, ProviderIcon, UltralyticsLogomark } from "@/brand-icons";
import { ActionIconButton, Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ApiKeyDialog,
  AUTH_PROVIDERS,
  KEY_PROVIDERS,
  type KeyProvider,
  type ProviderAuth,
  providerName,
} from "@/provider-auth";
import {
  eventCombo,
  FIXED_SHORTCUTS,
  fixedShortcut,
  IS_MAC,
  SHORTCUT_IDS,
  SHORTCUTS,
  ShortcutCaps,
  type ShortcutId,
  setShortcutKeys,
  shortcutKeys,
  useShortcutKeys,
} from "@/shortcuts";
import type { Theme } from "@/theme";
import { type Agent, agentLabel, tilde } from "@/types";

// A row inside a section's list: the list draws the frame, each row only the line above it.
const ROW = "rounded-none border-x-0 border-b-0 first:border-t-0";

const SIGN_INS = Object.values(AUTH_PROVIDERS).filter((option) => option.signIn);

// One shortcut row: the caps it answers to, which turn into a recorder on a click and take the next
// chord pressed. A chord another shortcut already holds, or one without a modifier, is refused with a
// reason; Escape or leaving the row keeps what was there.
function ShortcutRow({
  id,
  recording,
  onRecord,
}: {
  id: ShortcutId;
  recording: boolean;
  onRecord: (recording: boolean) => void;
}) {
  const keys = useShortcutKeys(id);
  const [error, setError] = useState("");
  const { label } = SHORTCUTS[id];
  return (
    <Item role="listitem" variant="outline" size="xs" className={ROW}>
      <ItemContent>
        <ItemTitle className="font-normal">{label}</ItemTitle>
      </ItemContent>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      {keys !== SHORTCUTS[id].keys ? (
        <ActionIconButton
          size="icon-xs"
          tooltip="Reset to default"
          aria-label={`Reset the ${label} shortcut`}
          onClick={() => {
            setError("");
            setShortcutKeys(id, null);
          }}
        >
          <RotateCcw />
        </ActionIconButton>
      ) : null}
      <button
        type="button"
        aria-label={recording ? `Press the new keys for ${label}` : `Change the ${label} shortcut`}
        className={`flex h-7 min-w-24 items-center justify-end rounded-md px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring ${recording ? "bg-muted text-xs text-muted-foreground" : "hover:bg-muted"}`}
        onClick={() => {
          setError("");
          onRecord(!recording);
        }}
        onBlur={() => onRecord(false)}
        onKeyDown={(event) => {
          if (!recording) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") {
            onRecord(false);
            return;
          }
          if (IS_MAC ? event.ctrlKey : event.metaKey) {
            setError(`Do not hold ${IS_MAC ? "Control" : "Meta"} with the shortcut.`);
            return;
          }
          const combo = eventCombo(event.nativeEvent);
          if (!combo) return;
          if (!/^(Mod|Alt)\+/.test(combo)) {
            setError(`Hold ${IS_MAC ? "⌘ or ⌥" : "Ctrl or Alt"} with the key.`);
            return;
          }
          const taken = SHORTCUT_IDS.find((other) => other !== id && shortcutKeys(other) === combo);
          const fixed = fixedShortcut(combo);
          if (taken || fixed) {
            setError(`Already used by ${taken ? SHORTCUTS[taken].label : fixed?.label}.`);
            return;
          }
          setError("");
          setShortcutKeys(id, combo);
          onRecord(false);
        }}
      >
        {recording ? "Press keys…" : <ShortcutCaps keys={keys} />}
      </button>
    </Item>
  );
}

// A titled group of settings drawn as one list with divided rows, the way system settings group them.
function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-4 px-1">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      <ItemGroup className="gap-0 rounded-lg border">{children}</ItemGroup>
    </section>
  );
}

// One setting: what it is and what it does on the left, its control on the right.
function Setting({
  title,
  description,
  media,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  media?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Item role="listitem" variant="outline" className={ROW}>
      {media ? <ItemMedia variant="icon">{media}</ItemMedia> : null}
      <ItemContent className="min-w-0">
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription className="truncate">{description}</ItemDescription>
      </ItemContent>
      <ItemActions>{children}</ItemActions>
    </Item>
  );
}

export function SettingsDialog({
  open: isOpen,
  tab = "general",
  onOpenChange,
  onSignIn,
  notifications,
  onNotificationsChange,
  keepAwake,
  onKeepAwakeChange,
  remoteSsh,
  onRemoteSshChange,
  theme,
  onThemeChange,
  terminalFont,
  onTerminalFontChange,
  versionBadge,
  commit,
  built,
  repo,
  onCheckForUpdates,
  onFileBrowserChange,
}: {
  open: boolean;
  // The tab the dialog opens on.
  tab?: string;
  onOpenChange: (open: boolean) => void;
  onSignIn: (agent: Agent) => void;
  notifications: boolean;
  onNotificationsChange: (enabled: boolean) => Promise<void>;
  keepAwake: boolean;
  onKeepAwakeChange: (enabled: boolean) => void;
  remoteSsh: boolean;
  onRemoteSshChange: (enabled: boolean) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  terminalFont: string;
  onTerminalFontChange: (font: string) => void;
  versionBadge: ReactNode;
  commit?: string;
  built: string;
  repo: string;
  onCheckForUpdates: () => void;
  onFileBrowserChange: () => void;
}) {
  const [auth, setAuth] = useState<ProviderAuth[]>();
  const [hideHidden, setHideHidden] = useState<boolean>();
  const [repositories, setRepositories] = useState("");
  const [fonts, setFonts] = useState<string[]>([]);
  // The vendor whose key is being added or replaced.
  const [keying, setKeying] = useState<KeyProvider>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notificationsSupported, setNotificationsSupported] = useState<boolean>();
  const [recording, setRecording] = useState<ShortcutId | null>(null);

  // The keys Lite holds, one per vendor, in the vendors' own order.
  const saved = KEY_PROVIDERS.flatMap((option) => {
    const status = auth?.find((entry) => entry.name === option.id);
    return status?.keyHint ? [{ option, status }] : [];
  });

  const read = useCallback(async () => {
    setAuth(await invoke<ProviderAuth[]>("provider_auth"));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    void Promise.all([
      read(),
      invoke<boolean>("notifications_supported").then(setNotificationsSupported),
      invoke<boolean>("hide_hidden_files").then(setHideHidden),
      invoke<string>("repositories_directory").then(setRepositories),
    ]).catch((reason) => setError(String(reason)));
  }, [isOpen, read]);

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

  async function changeNotifications(enabled: boolean) {
    setError("");
    setBusy("notifications");
    try {
      await onNotificationsChange(enabled);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  async function changeRepositories() {
    setError("");
    try {
      const chosen = await invoke<string | null>("choose_repositories_directory");
      if (chosen) setRepositories(chosen);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function changeHideHidden(hide: boolean) {
    setError("");
    setBusy("hidden-files");
    try {
      await invoke("set_hide_hidden_files", { hide });
      setHideHidden(hide);
      onFileBrowserChange();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:h-[38rem] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Change how Lite looks, runs sessions, signs in, and answers the keyboard.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogBody className="flex">
          <Tabs defaultValue={tab} orientation="vertical" className="min-h-full w-full gap-6">
            <TabsList variant="line" className="w-36 shrink-0 items-stretch justify-start border-r pr-4">
              <TabsTrigger value="general">
                <SlidersHorizontal />
                General
              </TabsTrigger>
              <TabsTrigger value="accounts">
                <KeyRound />
                Accounts
              </TabsTrigger>
              <TabsTrigger value="shortcuts">
                <Keyboard />
                Shortcuts
              </TabsTrigger>
              <TabsTrigger value="about">
                <Info />
                About
              </TabsTrigger>
            </TabsList>
            <TabsContent value="general" className="min-w-0 space-y-6">
              <Section title="Appearance">
                <Setting title="Theme" description="How Lite and its terminals look.">
                  <fieldset aria-label="Theme" className="flex rounded-lg border-0 bg-muted p-0.5">
                    {(
                      [
                        ["light", Sun, "Light"],
                        ["dark", Moon, "Dark"],
                      ] as const
                    ).map(([value, Icon, label]) => (
                      <Button
                        key={value}
                        size="sm"
                        variant={theme === value ? "outline" : "ghost"}
                        aria-pressed={theme === value}
                        className={theme === value ? "shadow-xs" : "text-muted-foreground"}
                        onClick={() => onThemeChange(value)}
                      >
                        <Icon />
                        {label}
                      </Button>
                    ))}
                  </fieldset>
                </Setting>
                <Setting title="Terminal font" description="The monospace font terminals use.">
                  {/* The installed fonts are read when the menu opens, so a font installed since shows up. */}
                  <DropdownMenu
                    onOpenChange={(open) => {
                      if (open)
                        void invoke<string[]>("monospace_fonts")
                          .then(setFonts)
                          .catch((reason) => setError(String(reason)));
                    }}
                  >
                    <DropdownMenuTrigger
                      render={
                        <Button variant="outline" size="sm" className="max-w-48">
                          <span className="truncate">{terminalFont || "System default"}</span>
                          <ChevronDown />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuRadioGroup
                        value={terminalFont}
                        onValueChange={(font) => onTerminalFontChange(font as string)}
                      >
                        <DropdownMenuRadioItem value="">System default</DropdownMenuRadioItem>
                        {fonts.map((font) => (
                          <DropdownMenuRadioItem key={font} value={font} style={{ fontFamily: `"${font}"` }}>
                            <span className="truncate" title={font}>
                              {font}
                            </span>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Setting>
              </Section>
              <Section title="Sessions">
                <Setting
                  title="Repositories folder"
                  description={
                    <span className="font-mono text-xs" title={repositories}>
                      {repositories ? tilde(repositories) : "…"}
                    </span>
                  }
                >
                  <Button variant="outline" size="sm" onClick={() => void changeRepositories()}>
                    Change…
                  </Button>
                </Setting>
                <Setting title="SSH hosts" description="Offer an SSH tab when starting a session.">
                  <Switch aria-label="SSH hosts" checked={remoteSsh} onCheckedChange={onRemoteSshChange} />
                </Setting>
                <Setting title="Keep computer awake" description="Prevent sleep while any session is working.">
                  <Switch aria-label="Keep computer awake" checked={keepAwake} onCheckedChange={onKeepAwakeChange} />
                </Setting>
                {notificationsSupported ? (
                  <Setting title="Notifications" description="Tell you when a background session is ready.">
                    <Switch
                      aria-label="Notifications"
                      checked={notifications}
                      disabled={busy === "notifications"}
                      onCheckedChange={(checked) => void changeNotifications(checked)}
                    />
                  </Setting>
                ) : null}
              </Section>
              <Section title="File browser">
                <Setting
                  title="Show hidden files"
                  description="Include files and folders whose names begin with a period."
                >
                  <Switch
                    aria-label="Show hidden files"
                    checked={hideHidden === false}
                    disabled={hideHidden === undefined || busy === "hidden-files"}
                    onCheckedChange={(show) => void changeHideHidden(!show)}
                  />
                </Setting>
              </Section>
            </TabsContent>
            <TabsContent value="accounts" className="min-w-0 space-y-6">
              <Section
                title="API keys"
                description="One key per vendor, kept on this computer. A saved key comes before the vendor’s sign-in."
                action={
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button size="sm" className="shrink-0">
                          <Plus />
                          Add key
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="w-52">
                      {KEY_PROVIDERS.map((option) => (
                        <DropdownMenuItem key={option.id} onClick={() => setKeying(option)}>
                          <ProviderIcon agent={option.agent} provider={option.provider} className="size-4" />
                          {providerName(option)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              >
                {saved.length ? (
                  saved.map(({ option, status }) => (
                    <Setting
                      key={option.id}
                      media={<ProviderIcon agent={option.agent} provider={option.provider} className="size-5" />}
                      title={providerName(option)}
                      description={
                        <>
                          <span className="font-mono">{status.keyHint}…</span> · Used by {agentLabel(option.agent)}
                        </>
                      }
                    >
                      <ActionIconButton
                        size="icon-sm"
                        tooltip={`Replace the ${providerName(option)} key`}
                        aria-label={`Replace the ${providerName(option)} key`}
                        onClick={() => setKeying(option)}
                      >
                        <Pencil />
                      </ActionIconButton>
                      <ActionIconButton
                        size="icon-sm"
                        className="hover:text-destructive"
                        tooltip={`Remove the ${providerName(option)} key`}
                        aria-label={`Remove the ${providerName(option)} key`}
                        disabled={busy === option.id}
                        onClick={() => void remove(option.id)}
                      >
                        {busy === option.id ? <Spinner /> : <Trash2 />}
                      </ActionIconButton>
                    </Setting>
                  ))
                ) : (
                  <Item role="listitem" className="justify-center py-6 text-muted-foreground">
                    {auth ? "No API keys yet. Add one to use a vendor without signing in through its CLI." : "…"}
                  </Item>
                )}
              </Section>
              <Section
                title="Sign-ins"
                description="Each CLI keeps its own sign-in. Lite runs the sign-in and never reads it."
              >
                {SIGN_INS.map((option) => {
                  const signedIn = auth?.find((entry) => entry.name === option.id)?.cliAuthMethod === "provider";
                  return (
                    <Setting
                      key={option.id}
                      media={<ProviderIcon agent={option.agent} provider={option.provider} className="size-5" />}
                      title={agentLabel(option.agent)}
                      description={
                        !auth ? (
                          "Checking…"
                        ) : signedIn ? (
                          <span className="flex items-center gap-1.5">
                            <Check className="size-3.5 text-success" />
                            Signed in
                          </span>
                        ) : (
                          "Not signed in"
                        )
                      }
                    >
                      <Button variant="outline" size="sm" onClick={() => onSignIn(option.agent)}>
                        {signedIn ? "Sign in again" : "Sign in"}
                      </Button>
                    </Setting>
                  );
                })}
              </Section>
              <ApiKeyDialog
                provider={keying}
                replacing={saved.some(({ option }) => option.id === keying?.id)}
                onClose={() => setKeying(undefined)}
                onSaved={read}
              />
            </TabsContent>
            <TabsContent value="shortcuts" className="min-w-0 space-y-6">
              <Section title="Customizable" description="Click a shortcut, then press the keys you would rather use.">
                {SHORTCUT_IDS.map((id) => (
                  <ShortcutRow
                    key={id}
                    id={id}
                    recording={recording === id}
                    onRecord={(on) => setRecording((current) => (on ? id : current === id ? null : current))}
                  />
                ))}
              </Section>
              {FIXED_SHORTCUTS.map(({ title, rows }) => (
                <Section key={title} title={title}>
                  {rows.map(({ label, keys }) => (
                    <Item key={label} role="listitem" variant="outline" size="xs" className={ROW}>
                      <ItemContent>
                        <ItemTitle className="font-normal">{label}</ItemTitle>
                      </ItemContent>
                      <span className="flex items-center gap-1.5 pr-1.5">
                        {keys.map((combo, index) => (
                          <span key={combo} className="flex items-center gap-1.5">
                            {index ? <span className="text-xs text-muted-foreground">/</span> : null}
                            <ShortcutCaps keys={combo} />
                          </span>
                        ))}
                      </span>
                    </Item>
                  ))}
                </Section>
              ))}
            </TabsContent>
            <TabsContent value="about" className="min-w-0 space-y-6">
              <div className="flex flex-col items-center pt-2 text-center">
                <UltralyticsLogomark className="size-14" />
                <div className="mt-3 flex items-center gap-2">
                  <h2 className="text-xl font-semibold">Lite</h2>
                  {versionBadge}
                </div>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  A fast, local workspace for AI coding agents, with no indexing, telemetry, or cloud service.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    onOpenChange(false);
                    onCheckForUpdates();
                  }}
                >
                  <RefreshCw />
                  Check for updates
                </Button>
              </div>
              <Section title="Details">
                {commit ? (
                  <Setting title="Revision" description={<span className="font-mono">{commit}</span>}>
                    {null}
                  </Setting>
                ) : null}
                {built ? (
                  <Setting title="Built" description={built}>
                    {null}
                  </Setting>
                ) : null}
                {repo ? (
                  <Setting
                    title="Working tree"
                    description={
                      <span className="font-mono" title={repo}>
                        {repo}
                      </span>
                    }
                  >
                    {null}
                  </Setting>
                ) : null}
                <Setting
                  media={<GitHubLogomark />}
                  title="Open source"
                  description="AGPL-3.0 · github.com/ultralytics/lite"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void invoke("open_url", { url: "https://github.com/ultralytics/lite" })}
                  >
                    View repository
                    <ExternalLink />
                  </Button>
                </Setting>
              </Section>
            </TabsContent>
          </Tabs>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
