// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import {
  Bell,
  Coffee,
  ExternalLink,
  EyeOff,
  FolderCog,
  Info,
  Keyboard,
  KeyRound,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  ProviderRow,
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
import { type Agent, agentLabel } from "@/types";

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
    <li className="flex items-center gap-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
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
    </li>
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
      <DialogContent className="sm:h-[36rem] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Personalize Lite and manage how agent sessions sign in.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex">
          <Tabs defaultValue={tab} orientation="vertical" className="min-h-full w-full gap-6">
            <TabsList variant="line" className="w-36 shrink-0 items-stretch justify-start border-r pr-4">
              <TabsTrigger value="general">
                <SlidersHorizontal />
                General
              </TabsTrigger>
              <TabsTrigger value="keys">
                <KeyRound />
                API keys
              </TabsTrigger>
              <TabsTrigger value="files">
                <FolderCog />
                Files
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
            <TabsContent value="general" className="min-w-0">
              <h2 className="text-base font-semibold">General</h2>
              <p className="mt-1 mb-4 text-sm text-muted-foreground">Personalize how Lite looks and responds.</p>
              <ItemGroup>
                <Item variant="outline">
                  <ItemMedia variant="icon">{theme === "dark" ? <Moon /> : <Sun />}</ItemMedia>
                  <ItemContent>
                    <ItemTitle>Dark mode</ItemTitle>
                    <ItemDescription>Use Lite’s dark appearance.</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Switch
                      aria-label="Dark mode"
                      checked={theme === "dark"}
                      onCheckedChange={(checked) => onThemeChange(checked ? "dark" : "light")}
                    />
                  </ItemActions>
                </Item>
                <Item variant="outline">
                  <ItemMedia variant="icon">
                    <Coffee />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>Keep system awake</ItemTitle>
                    <ItemDescription>
                      Prevent automatic sleep and display shutoff while a session is active.
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Switch aria-label="Keep system awake" checked={keepAwake} onCheckedChange={onKeepAwakeChange} />
                  </ItemActions>
                </Item>
                <Item variant="outline">
                  <ItemMedia variant="icon">
                    <Server />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>Remote SSH</ItemTitle>
                    <ItemDescription>Show Remote SSH workspaces when creating a session.</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Switch aria-label="Remote SSH" checked={remoteSsh} onCheckedChange={onRemoteSshChange} />
                  </ItemActions>
                </Item>
                {notificationsSupported ? (
                  <Item variant="outline">
                    <ItemMedia variant="icon">
                      <Bell />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>macOS notifications</ItemTitle>
                      <ItemDescription>Notify you when a background session is ready.</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        aria-label="macOS notifications"
                        checked={notifications}
                        disabled={busy === "notifications"}
                        onCheckedChange={(checked) => void changeNotifications(checked)}
                      />
                    </ItemActions>
                  </Item>
                ) : null}
              </ItemGroup>
            </TabsContent>
            <TabsContent value="keys" className="min-w-0">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold">API keys</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    One key per vendor, kept on this computer. A saved key comes before the vendor’s own sign-in.
                  </p>
                </div>
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
              </div>
              {saved.length ? (
                <ItemGroup>
                  {saved.map(({ option, status }) => (
                    <Item key={option.id} variant="outline">
                      <ProviderRow option={option} title={providerName(option)}>
                        <span className="font-mono">{status.keyHint}…</span> · Used by {agentLabel(option.agent)}
                      </ProviderRow>
                      <ItemActions>
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
                      </ItemActions>
                    </Item>
                  ))}
                </ItemGroup>
              ) : (
                <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  {auth ? "No API keys yet. Add one to use a vendor without signing in through its CLI." : "…"}
                </p>
              )}
              <h3 className="mt-8 text-sm font-semibold">Sign-ins</h3>
              <p className="mt-1 mb-3 text-sm text-muted-foreground">
                Each CLI keeps its own sign-in. Lite only runs the sign-in and never reads it.
              </p>
              <ItemGroup>
                {SIGN_INS.map((option) => {
                  const signedIn = auth?.find((entry) => entry.name === option.id)?.cliAuthMethod === "provider";
                  return (
                    <Item key={option.id} variant="outline">
                      <ProviderRow option={option}>
                        {auth ? (signedIn ? "Signed in" : "Not signed in") : "Checking…"}
                      </ProviderRow>
                      <ItemActions>
                        <Button variant="outline" size="sm" onClick={() => onSignIn(option.agent)}>
                          {signedIn ? "Sign in again" : "Sign in"}
                        </Button>
                      </ItemActions>
                    </Item>
                  );
                })}
              </ItemGroup>
              <ApiKeyDialog
                provider={keying}
                replacing={saved.some(({ option }) => option.id === keying?.id)}
                onClose={() => setKeying(undefined)}
                onSaved={read}
              />
            </TabsContent>
            <TabsContent value="files" className="min-w-0">
              <h2 className="text-base font-semibold">Files</h2>
              <p className="mt-1 mb-4 text-sm text-muted-foreground">
                Choose which files appear in the browser and where Lite keeps the repositories it clones.
              </p>
              <ItemGroup>
                <Item variant="outline">
                  <ItemMedia variant="icon">
                    <EyeOff />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>Hide hidden files</ItemTitle>
                    <ItemDescription>Hide files and folders whose names begin with a period.</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Switch
                      aria-label="Hide hidden files"
                      checked={hideHidden ?? false}
                      disabled={hideHidden === undefined || busy === "hidden-files"}
                      onCheckedChange={(hide) => void changeHideHidden(hide)}
                    />
                  </ItemActions>
                </Item>
                <Item variant="outline">
                  <ItemMedia variant="icon">
                    <GitHubLogomark />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>Repositories folder</ItemTitle>
                    <ItemDescription className="truncate font-mono text-xs" title={repositories}>
                      {repositories || "…"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button variant="outline" size="sm" onClick={() => void changeRepositories()}>
                      Change…
                    </Button>
                  </ItemActions>
                </Item>
              </ItemGroup>
            </TabsContent>
            <TabsContent value="shortcuts" className="min-w-0">
              <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
              <p className="mt-1 mb-2 text-sm text-muted-foreground">
                Click a shortcut and press the keys you would rather use.
              </p>
              <ul className="divide-y">
                {SHORTCUT_IDS.map((id) => (
                  <ShortcutRow
                    key={id}
                    id={id}
                    recording={recording === id}
                    onRecord={(on) => setRecording((current) => (on ? id : current === id ? null : current))}
                  />
                ))}
              </ul>
              {FIXED_SHORTCUTS.map(({ title, rows }) => (
                <div key={title}>
                  <h3 className="mt-5 mb-1 text-xs font-medium text-muted-foreground">{title}</h3>
                  <ul className="divide-y">
                    {rows.map(({ label, keys }) => (
                      <li key={label} className="flex items-center gap-3 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
                        <span className="flex items-center gap-1.5 pr-1.5">
                          {keys.map((combo, index) => (
                            <span key={combo} className="flex items-center gap-1.5">
                              {index ? <span className="text-xs text-muted-foreground">/</span> : null}
                              <ShortcutCaps keys={combo} />
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </TabsContent>
            <TabsContent value="about" className="min-w-0">
              <div className="flex flex-col items-center pt-3 text-center">
                <UltralyticsLogomark className="size-14" />
                <div className="mt-3 flex items-center gap-2">
                  <h2 className="text-xl font-semibold">Lite</h2>
                  {versionBadge}
                </div>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  A fast, local workspace for AI coding agents, with no indexing, telemetry, or cloud service.
                </p>
              </div>
              <ItemGroup className="mt-6 gap-2.5">
                <Item variant="outline">
                  <ItemMedia variant="icon">
                    <GitHubLogomark />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>Open source</ItemTitle>
                    <ItemDescription>AGPL-3.0 · github.com/ultralytics/lite</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void invoke("open_url", { url: "https://github.com/ultralytics/lite" })}
                    >
                      View repository
                      <ExternalLink />
                    </Button>
                  </ItemActions>
                </Item>
              </ItemGroup>
              <div className="mt-4 flex items-start justify-between gap-4">
                <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
                  {commit ? (
                    <>
                      <dt className="text-muted-foreground">Revision</dt>
                      <dd className="truncate font-mono">{commit}</dd>
                    </>
                  ) : null}
                  {built ? (
                    <>
                      <dt className="text-muted-foreground">Built</dt>
                      <dd className="truncate">{built}</dd>
                    </>
                  ) : null}
                  {repo ? (
                    <>
                      <dt className="text-muted-foreground">Working tree</dt>
                      <dd className="truncate font-mono" title={repo}>
                        {repo}
                      </dd>
                    </>
                  ) : null}
                </dl>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    onCheckForUpdates();
                  }}
                >
                  <RefreshCw />
                  Check for updates
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogBody>
        <DialogFooter className={error ? "sm:justify-between" : undefined}>
          {error ? (
            <p role="alert" className="self-center text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
