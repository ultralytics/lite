// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { invoke } from "@tauri-apps/api/core";
import {
  Bell,
  Coffee,
  ExternalLink,
  Eye,
  EyeOff,
  FolderCog,
  Info,
  Keyboard,
  KeyRound,
  Moon,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { including, without } from "@/lib/utils";
import { AUTH_PROVIDERS, type ProviderAuth, ProviderAuthDescription } from "@/provider-auth";
import {
  eventCombo,
  FIXED_SHORTCUTS,
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
import { type Agent, sessionLabel } from "@/types";

const providers = Object.values(AUTH_PROVIDERS);

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
          const combo = eventCombo(event.nativeEvent);
          if (!combo) return;
          if (!/^(Mod|Alt)\+/.test(combo)) {
            setError(`Hold ${IS_MAC ? "⌘ or ⌥" : "Ctrl or Alt"} with the key.`);
            return;
          }
          const taken = SHORTCUT_IDS.find((other) => other !== id && shortcutKeys(other) === combo);
          const fixed = FIXED_SHORTCUTS.flatMap(({ rows }) => rows).find(({ keys }) =>
            keys.some((chord) => chord === combo || (chord === "Mod+1…9" && /^Mod\+[1-9]$/.test(combo))),
          );
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
  onOpenChange,
  onSignIn,
  notifications,
  onNotificationsChange,
  keepAwake,
  onKeepAwakeChange,
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
  onOpenChange: (open: boolean) => void;
  onSignIn: (agent: Agent) => void;
  notifications: boolean;
  onNotificationsChange: (enabled: boolean) => Promise<void>;
  keepAwake: boolean;
  onKeepAwakeChange: (enabled: boolean) => void;
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
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notificationsSupported, setNotificationsSupported] = useState<boolean>();
  const [recording, setRecording] = useState<ShortcutId | null>(null);

  const read = useCallback(async () => {
    setAuth(await invoke<ProviderAuth[]>("provider_auth"));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setDrafts({});
    setEditing(new Set());
    setRevealed(new Set());
    void Promise.all([
      read(),
      invoke<boolean>("notifications_supported").then(setNotificationsSupported),
      invoke<boolean>("hide_hidden_files").then(setHideHidden),
    ]).catch((reason) => setError(String(reason)));
  }, [isOpen, read]);

  function edit(id: string, open: boolean) {
    setEditing((current) => (open ? including(current, id) : without(current, id)));
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
          <Tabs defaultValue="general" orientation="vertical" className="min-h-full w-full gap-6">
            <TabsList variant="line" className="w-36 shrink-0 items-stretch justify-start border-r pr-4">
              <TabsTrigger value="general">
                <SlidersHorizontal />
                General
              </TabsTrigger>
              <TabsTrigger value="keys">
                <KeyRound />
                API Keys
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
                    <ItemTitle>Dark Mode</ItemTitle>
                    <ItemDescription>Use Lite’s dark appearance.</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Switch
                      aria-label="Dark Mode"
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
                    <ItemTitle>Keep System Awake</ItemTitle>
                    <ItemDescription>
                      Prevent automatic sleep and display shutoff while a session is active.
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Switch aria-label="Keep system awake" checked={keepAwake} onCheckedChange={onKeepAwakeChange} />
                  </ItemActions>
                </Item>
                {notificationsSupported ? (
                  <Item variant="outline">
                    <ItemMedia variant="icon">
                      <Bell />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>macOS Notifications</ItemTitle>
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
              <h2 className="text-base font-semibold">API Keys</h2>
              <p className="mt-1 mb-4 text-sm text-muted-foreground">
                Saved keys stay on this computer and take priority over provider sign-in.
              </p>
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
                        <ItemTitle>{sessionLabel(option)}</ItemTitle>
                        <ProviderAuthDescription provider={option} status={status} />
                      </ItemContent>
                      {open ? null : (
                        <ItemActions>
                          {!status?.keyHint && !status?.cliAuthMethod && option.signIn ? (
                            <Button variant="outline" size="sm" onClick={() => onSignIn(option.agent)}>
                              {option.id === "qwen" ? "Set up" : "Sign in"}
                            </Button>
                          ) : null}
                          {"variable" in option ? (
                            <Button variant="ghost" size="sm" onClick={() => edit(option.id, true)}>
                              {status?.keyHint || status?.cliAuthMethod === "apiKey"
                                ? "Replace API key"
                                : "Use API key"}
                            </Button>
                          ) : null}
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
                      {open && "variable" in option ? (
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
            </TabsContent>
            <TabsContent value="files" className="min-w-0">
              <h2 className="text-base font-semibold">Files</h2>
              <p className="mt-1 mb-4 text-sm text-muted-foreground">Choose which files appear in the browser.</p>
              <ItemGroup>
                <Item variant="outline">
                  <ItemMedia variant="icon">
                    <EyeOff />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>Hide Hidden Files</ItemTitle>
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
              </ItemGroup>
            </TabsContent>
            <TabsContent value="shortcuts" className="min-w-0">
              <h2 className="text-base font-semibold">Keyboard Shortcuts</h2>
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
                  Check for Updates
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
