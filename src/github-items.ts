// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

interface Candidate {
  index: number;
  priority: number;
  url: string;
}

export interface GitHubReferences {
  explicit: string[];
  // One entry per ambiguous reference: the item it would name in each repository the session has named.
  inferred: string[][];
}

// Repository-qualified references are certain. A bare number from user prose or an unqualified GitHub CLI
// command may belong to any repository the session has named, and a short name narrows it to that one
// (the only form output prose may use): GitHub activity must confirm one before the panel shows it.
// biome-ignore lint/suspicious/noControlCharactersInRegex: a color code has to be named to be removed.
const COLOR = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: OSC hyperlinks are terminal framing.
const HYPERLINK = /\u001b]8;[^;]*;([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;
const GITHUB_ITEM = /\bhttps:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/([1-9]\d{0,8})(?!\w)/gi;
const GITHUB_REPOSITORY =
  /\bhttps:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?=\/(?:pulls?|issues)(?:[/?#\s]|$)|\/?(?:[?#\s]|$))/gi;
const QUALIFIED_ITEM = /(?:^|[^\w./-])(\w[\w.-]*)\/(\w[\w.-]*)#([1-9]\d{0,8})(?!\w)/g;
const ITEM_MENTION =
  /(?:^|[^\w./-])(\w[\w.-]*\/\w[\w.-]*)[ \t]+(pull requests?|PRs?|issues?)[ \t]+#?([1-9]\d{0,8})(?!\w|\.\d)/gi;
const ITEM_REFERENCE =
  /(?:^|[^\w./-])(?:(\w[\w.-]*)[ \t]+)?(?:(pull requests?|PRs?|issues?)[ \t]+#?|#)([1-9]\d{0,8})(?!\w|\.\d)/gi;
const GH_COMMAND = /\bgh\s+([\w-]+)\s+([\w-]+)((?:(?!\bgh\s)[^;&|'"\\\r\n]|\\.|'[^']*'|"(?:\\.|[^"\\])*")*)/gi;
const GH_REPOSITORY =
  /^((?:[^'"\\]|\\.|'[^']*'|"(?:\\.|[^"\\])*")*?\s)(?:--repo|-R)(?:=|\s+)(?:([\w.-]+\/[\w.-]+)|'([\w.-]+\/[\w.-]+)'|"([\w.-]+\/[\w.-]+)")/i;
const GH_API =
  /\bgh\s+api\s+["']?(?:https:\/\/api\.github\.com\/)?\/?repos\/([\w.-]+)\/([\w.-]+)\/(issues|pulls)\/([1-9]\d{0,8})(?![\w/])/gi;

const itemKind = (word: string | undefined) => (word?.toLowerCase().startsWith("issue") ? "issues" : "pull");

export function githubItemReferences(
  output: string,
  remote: string,
  terminalStream: string,
  prose: string,
): GitHubReferences {
  const text = output.replace(COLOR, "");
  const userText = prose.replace(COLOR, "");
  const candidates: Candidate[] = [];
  const repositories = new Map<string, string>();
  const nameRepository = (owner: string, name: string) => {
    const repository = `${owner}/${name.replace(/\.+$/, "").replace(/\.git$/i, "")}`;
    if (!repositories.has(repository.toLowerCase())) repositories.set(repository.toLowerCase(), repository);
  };
  const add = (match: RegExpMatchArray, repository: string, kind: string, number: string, priority: number) => {
    const [owner, name] = repository.split("/");
    nameRepository(owner, name);
    candidates.push({ index: match.index ?? 0, priority, url: `https://github.com/${repository}/${kind}/${number}` });
  };
  const base = remote.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (base) nameRepository(base[1], base[2]);
  for (const match of text.matchAll(GITHUB_REPOSITORY)) nameRepository(match[1], match[2]);

  for (const match of text.matchAll(GITHUB_ITEM))
    add(match, `${match[1]}/${match[2]}`, match[3].toLowerCase(), match[4], 4);
  for (const hyperlink of terminalStream.matchAll(HYPERLINK)) {
    for (const match of hyperlink[1].matchAll(GITHUB_ITEM))
      add(match, `${match[1]}/${match[2]}`, match[3].toLowerCase(), match[4], 4);
  }
  for (const source of new Set([text, userText])) {
    for (const match of source.matchAll(QUALIFIED_ITEM)) add(match, `${match[1]}/${match[2]}`, "issues", match[3], 1);
    for (const match of source.matchAll(ITEM_MENTION)) add(match, match[1], itemKind(match[2]), match[3], 2);
  }
  // Ambiguous forms are read once every repository the session names is known.
  const ambiguous: { kind: string; number: string; name?: string }[] = [];
  for (const match of text.matchAll(GH_COMMAND)) {
    const repository = match[3].match(GH_REPOSITORY)?.slice(2).find(Boolean);
    // Any command names its repository, even one that names no item or whose number is a shell variable.
    if (repository) nameRepository(...(repository.split("/") as [string, string]));
    if (!/^(?:issue|pr)$/i.test(match[1]) || /^(?:create|list|status)$/i.test(match[2])) continue;
    const numbers = match[3]
      .replace(GH_REPOSITORY, "$1")
      .replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "")
      .match(/(?:^|\s)([1-9]\d{0,8})(?=[\s)]|$)/g);
    if (numbers?.length !== 1) continue;
    const kind = match[1].toLowerCase() === "pr" ? "pull" : "issues";
    if (repository) add(match, repository, kind, numbers[0].trim(), 2);
    else ambiguous.push({ kind, number: numbers[0].trim() });
  }
  for (const match of text.matchAll(GH_API))
    add(match, `${match[1]}/${match[2]}`, match[3].toLowerCase() === "pulls" ? "pull" : "issues", match[4], 3);
  const names = new Set([...repositories.keys()].map((repository) => repository.split("/")[1]));
  for (const source of new Set([text, userText])) {
    for (const match of source.matchAll(ITEM_REFERENCE)) {
      const name = match[1]?.toLowerCase();
      if (name && names.has(name)) ambiguous.push({ kind: itemKind(match[2]), number: match[3], name });
      else if (source === userText) ambiguous.push({ kind: itemKind(match[2]), number: match[3] });
    }
  }

  candidates.sort((left, right) => left.index - right.index);
  const items = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = itemKey(candidate.url);
    const current = items.get(key);
    if (!current || candidate.priority > current.priority) items.set(key, candidate);
  }
  const explicit = [...items.values()].map((candidate) => candidate.url);
  const inferred = new Map<string, string[]>();
  for (const { kind, number, name } of ambiguous) {
    const group = [...repositories.values()]
      .filter((repository) => !name || repository.split("/")[1].toLowerCase() === name)
      .map((repository) => `https://github.com/${repository}/${kind}/${number}`);
    if (group.length && !group.some((url) => items.has(itemKey(url)))) inferred.set(group.join(" "), group);
  }
  return { explicit, inferred: [...inferred.values()] };
}

const RECENT_ACTIVITY_MS = 30 * 24 * 60 * 60 * 1000;

// Each ambiguous reference keeps at most one item: the most recently updated of its candidates, and only
// one GitHub confirms was active in the last 30 days.
export function likelyGitHubItems<T extends { updatedAt: string | null; url: string }>(
  items: T[],
  inferred: string[][],
  now = Date.now(),
): T[] {
  const updated = (item: T) => (item.updatedAt ? Date.parse(item.updatedAt) : Number.NaN);
  const byKey = new Map(items.map((item) => [itemKey(item.url), item]));
  const candidates = new Set(inferred.flat().map(itemKey));
  const chosen = new Set<T>();
  for (const group of inferred) {
    const [best] = group
      .map((url) => byKey.get(itemKey(url)))
      .filter((item): item is T => !!item && now - updated(item) <= RECENT_ACTIVITY_MS)
      .sort((left, right) => updated(right) - updated(left));
    if (best) chosen.add(best);
  }
  return items.filter((item) => !candidates.has(itemKey(item.url)) || chosen.has(item));
}

export function mergeGitHubItems<T extends { url: string }>(current: T[], updates: T[]): T[] {
  const items = new Map(current.map((item) => [itemKey(item.url), item]));
  for (const item of updates) items.set(itemKey(item.url), item);
  return [...items.values()];
}

export function itemKey(url: string) {
  const [, , , owner, repository, , number] = url.split("/");
  return `${owner}/${repository}#${number}`.toLowerCase();
}
