// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

interface Candidate {
  index: number;
  priority: number;
  inferred: boolean;
  url: string;
}

export interface GitHubReferences {
  explicit: string[];
  inferred: string[];
}

// Repository-qualified references are certain. Bare references from user prose and unqualified GitHub CLI
// commands use the session repository only as a candidate: GitHub activity must confirm them before the panel.
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
const BARE_ITEM_MENTION = /(?:^|[^\w./-])(pull requests?|PRs?|issues?)[ \t]+#?([1-9]\d{0,8})(?!\w|\.\d)/gi;
const GH_ITEM_COMMAND =
  /\bgh\s+(issue|pr)\s+(?!create\b|list\b|status\b)[\w-]+((?:[^;&|'"\\\r\n]|\\.|'[^']*'|"(?:\\.|[^"\\])*")*)/gi;
const GH_REPOSITORY =
  /^((?:[^'"\\]|\\.|'[^']*'|"(?:\\.|[^"\\])*")*?\s)(?:--repo|-R)(?:=|\s+)(?:([\w.-]+\/[\w.-]+)|'([\w.-]+\/[\w.-]+)'|"([\w.-]+\/[\w.-]+)")/i;
const GH_API =
  /\bgh\s+api\s+["']?(?:https:\/\/api\.github\.com\/)?\/?repos\/([\w.-]+)\/([\w.-]+)\/(issues|pulls)\/([1-9]\d{0,8})(?![\w/])/gi;

export function githubItemReferences(
  output: string,
  remote: string,
  terminalStream: string,
  prose: string,
): GitHubReferences {
  const text = output.replace(COLOR, "");
  const userText = prose.replace(COLOR, "");
  const candidates: Candidate[] = [];
  const add = (
    match: RegExpMatchArray,
    repository: string,
    kind: string,
    number: string,
    priority: number,
    inferred = false,
  ) => {
    candidates.push({
      index: match.index ?? 0,
      priority,
      inferred,
      url: `https://github.com/${repository}/${kind}/${number}`,
    });
  };
  const base = remote.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  const repositories = new Set<string>();
  for (const match of text.matchAll(GITHUB_REPOSITORY)) {
    const name = match[2].replace(/\.+$/, "").replace(/\.git$/i, "");
    if (name) repositories.add(`${match[1]}/${name}`);
  }
  const repository = base ? `${base[1]}/${base[2]}` : repositories.size === 1 ? [...repositories][0] : "";

  for (const match of text.matchAll(GITHUB_ITEM))
    add(match, `${match[1]}/${match[2]}`, match[3].toLowerCase(), match[4], 4);
  for (const hyperlink of terminalStream.matchAll(HYPERLINK)) {
    for (const match of hyperlink[1].matchAll(GITHUB_ITEM))
      add(match, `${match[1]}/${match[2]}`, match[3].toLowerCase(), match[4], 4);
  }
  const qualifiedMentions: [number, number][] = [];
  for (const source of new Set([text, userText])) {
    for (const match of source.matchAll(QUALIFIED_ITEM)) add(match, `${match[1]}/${match[2]}`, "issues", match[3], 1);
    for (const match of source.matchAll(ITEM_MENTION)) {
      add(match, match[1], match[2].toLowerCase().startsWith("issue") ? "issues" : "pull", match[3], 2);
      if (source === userText) qualifiedMentions.push([match.index, match.index + match[0].length]);
    }
  }
  if (repository) {
    for (const match of userText.matchAll(BARE_ITEM_MENTION)) {
      if (qualifiedMentions.some(([start, end]) => match.index >= start && match.index < end)) continue;
      add(match, repository, match[1].toLowerCase().startsWith("issue") ? "issues" : "pull", match[2], 0, true);
    }
  }
  for (const match of text.matchAll(GH_ITEM_COMMAND)) {
    const repositoryMatch = match[2].match(GH_REPOSITORY);
    const explicitRepository = repositoryMatch?.slice(2).find(Boolean);
    const numbers = match[2]
      .replace(GH_REPOSITORY, "$1")
      .replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "")
      .match(/(?:^|\s)([1-9]\d{0,8})(?=\s|$)/g);
    const number = numbers?.length === 1 ? numbers[0].trim() : "";
    const targetRepository = explicitRepository || repository;
    if (targetRepository && number)
      add(
        match,
        targetRepository,
        match[1].toLowerCase() === "pr" ? "pull" : "issues",
        number,
        repositoryMatch ? 2 : 0,
        !repositoryMatch,
      );
  }
  for (const match of text.matchAll(GH_API)) {
    add(match, `${match[1]}/${match[2]}`, match[3].toLowerCase() === "pulls" ? "pull" : "issues", match[4], 3);
  }

  candidates.sort((left, right) => left.index - right.index);
  const items = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const [, , , owner, repository, , number] = candidate.url.split("/");
    const key = `${owner}/${repository}#${number}`.toLowerCase();
    const current = items.get(key);
    if (!current || candidate.priority > current.priority) items.set(key, candidate);
  }
  const references: GitHubReferences = { explicit: [], inferred: [] };
  for (const candidate of items.values()) references[candidate.inferred ? "inferred" : "explicit"].push(candidate.url);
  return references;
}

const RECENT_ACTIVITY_MS = 30 * 24 * 60 * 60 * 1000;

export function likelyGitHubItems<T extends { updatedAt: string | null; url: string }>(
  items: T[],
  inferred: string[],
  now = Date.now(),
): T[] {
  const inferredItems = new Set(inferred.map(itemKey));
  return items.filter((item) => {
    if (!inferredItems.has(itemKey(item.url))) return true;
    const updatedAt = item.updatedAt ? Date.parse(item.updatedAt) : Number.NaN;
    return Number.isFinite(updatedAt) && now - updatedAt <= RECENT_ACTIVITY_MS;
  });
}

export function mergeGitHubItems<T extends { url: string }>(current: T[], updates: T[]): T[] {
  const items = new Map(current.map((item) => [itemKey(item.url), item]));
  for (const item of updates) items.set(itemKey(item.url), item);
  return [...items.values()];
}

function itemKey(url: string) {
  const [, , , owner, repository, , number] = url.split("/");
  return `${owner}/${repository}#${number}`.toLowerCase();
}
