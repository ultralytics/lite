// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { describe, expect, test } from "bun:test";

import { githubItemReferences, likelyGitHubItems } from "../src/github-items";

const explicit = (output: string) => githubItemReferences(output, "").explicit;

describe("githubItemReferences", () => {
  test("does not assign commands from moved worktrees to the session repository", () => {
    const transcript = `
$ gh pr view 3608 --repo ultralytics/portal --json url
{"url":"https://github.com/ultralytics/portal/pull/3608"}
$ gh pr view 102 --json body,headRefOid,url
{"url":"https://github.com/ultralytics/lite/pull/102"}
$ gh issue view 3052
https://github.com/ultralytics/assistant/pull/3052
Updated Lite PR #102 (https://github.com/ultralytics/lite/pull/102)
`;

    expect(explicit(transcript)).toEqual([
      "https://github.com/ultralytics/portal/pull/3608",
      "https://github.com/ultralytics/lite/pull/102",
      "https://github.com/ultralytics/assistant/pull/3052",
    ]);
  });

  test("recognizes every repository-qualified form", () => {
    const transcript = `
https://github.com/ultralytics/lite/pull/102/files
ultralytics/portal#3608
ultralytics/assistant issue #3052
gh pr checks 97 --repo ultralytics/lite
gh issue close -R=ultralytics/portal 3497
gh pr view --json number -R ultralytics/lite 94
gh api repos/ultralytics/assistant/pulls/3048
`;

    expect(explicit(transcript)).toEqual([
      "https://github.com/ultralytics/lite/pull/102",
      "https://github.com/ultralytics/portal/issues/3608",
      "https://github.com/ultralytics/assistant/issues/3052",
      "https://github.com/ultralytics/lite/pull/97",
      "https://github.com/ultralytics/portal/issues/3497",
      "https://github.com/ultralytics/lite/pull/94",
      "https://github.com/ultralytics/assistant/pull/3048",
    ]);
  });

  test("rejects ambiguous and malformed references", () => {
    const transcript = `
PR #102 and issue 3052
gh pr view 102
gh issue close 3052
gh pr list --repo ultralytics/lite
gh pr create --repo ultralytics/lite
gh pr checks --interval 10 102 --repo ultralytics/lite
Image #1
src/components/ui/button.tsx:102
https://github.com/ultralytics/lite/pull/0
https://github.com/ultralytics/lite/pull/1234567890
https://github.com/ultralytics/lite/pull/102abc
`;

    expect(explicit(transcript)).toEqual([]);
  });

  test("keeps command boundaries and quoted arguments isolated", () => {
    const transcript = `
gh pr edit 12 --body "mention --repo wrong/repo" && gh pr view 13 -R right/repo
gh issue view 14; gh pr view 15 --repo next/repo
gh pr status --repo ignored/repo | gh issue view 16 -R final/repo
`;

    expect(explicit(transcript)).toEqual([
      "https://github.com/right/repo/pull/13",
      "https://github.com/next/repo/pull/15",
      "https://github.com/final/repo/issues/16",
    ]);
  });

  test("deduplicates forms by repository and number using the strongest kind", () => {
    const transcript = `
ultralytics/lite#102
ultralytics/lite issue #102
gh api repos/ultralytics/lite/issues/102
https://github.com/ultralytics/lite/pull/102
gh issue view 102 --repo ULTRALYTICS/LITE
`;

    expect(explicit(transcript)).toEqual(["https://github.com/ultralytics/lite/pull/102"]);
  });

  test("reads links through terminal color and hyperlink sequences", () => {
    const transcript =
      "\u001b[32mhttps://github.com/ultralytics/lite/issues/88\u001b[0m " +
      "\u001b]8;;https://github.com/ultralytics/lite/pull/90\u0007PR\u001b]8;;\u0007";

    expect(explicit(transcript)).toEqual([
      "https://github.com/ultralytics/lite/issues/88",
      "https://github.com/ultralytics/lite/pull/90",
    ]);
  });

  test("separates ambiguous references for recent-activity verification", () => {
    const references = githubItemReferences(
      `
PR #102 and issue #3052
gh pr view 94
gh issue close 88
https://github.com/ultralytics/lite/pull/97
ultralytics/lite PR #102
`,
      "https://github.com/ultralytics/lite",
    );

    expect(references).toEqual({
      explicit: ["https://github.com/ultralytics/lite/pull/102", "https://github.com/ultralytics/lite/pull/97"],
      inferred: [
        "https://github.com/ultralytics/lite/issues/3052",
        "https://github.com/ultralytics/lite/pull/94",
        "https://github.com/ultralytics/lite/issues/88",
      ],
    });
  });

  test("keeps inferred items only when GitHub confirms activity in the last 30 days", () => {
    const inferred = [
      "https://github.com/ultralytics/portal/pull/102",
      "https://github.com/ultralytics/portal/issues/3052",
    ];
    const now = Date.parse("2026-08-14T18:00:00Z");
    const items = [
      { url: inferred[0], updatedAt: "2026-07-14T18:00:00Z" },
      { url: inferred[1], updatedAt: "2026-07-16T18:00:00Z" },
      { url: "https://github.com/ultralytics/lite/pull/102", updatedAt: null },
    ];

    expect(likelyGitHubItems(items, inferred, now)).toEqual([items[1], items[2]]);
  });

  test("removes the cross-worktree duplicates from the reported transcript", () => {
    const references = githubItemReferences(
      `
gh pr view 102 --json url
https://github.com/ultralytics/lite/pull/102
gh issue view 3052
https://github.com/ultralytics/assistant/pull/3052
`,
      "https://github.com/ultralytics/portal",
    );
    const checked = [...references.explicit, ...references.inferred].map((url) => ({
      url,
      updatedAt: url.includes("/portal/") ? "2026-07-01T00:00:00Z" : "2026-08-14T17:00:00Z",
    }));

    expect(likelyGitHubItems(checked, references.inferred, Date.parse("2026-08-14T18:00:00Z"))).toEqual([
      checked[0],
      checked[1],
    ]);
  });
});
