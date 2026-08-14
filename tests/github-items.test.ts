// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import { describe, expect, test } from "bun:test";

import { githubItemUrls } from "../src/github-items";

describe("githubItemUrls", () => {
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

    expect(githubItemUrls(transcript)).toEqual([
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
gh api repos/ultralytics/assistant/pulls/3048
`;

    expect(githubItemUrls(transcript)).toEqual([
      "https://github.com/ultralytics/lite/pull/102",
      "https://github.com/ultralytics/portal/issues/3608",
      "https://github.com/ultralytics/assistant/issues/3052",
      "https://github.com/ultralytics/lite/pull/97",
      "https://github.com/ultralytics/portal/issues/3497",
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
Image #1
src/components/ui/button.tsx:102
https://github.com/ultralytics/lite/pull/0
https://github.com/ultralytics/lite/pull/1234567890
https://github.com/ultralytics/lite/pull/102abc
`;

    expect(githubItemUrls(transcript)).toEqual([]);
  });

  test("keeps command boundaries and quoted arguments isolated", () => {
    const transcript = `
gh pr edit 12 --body "mention --repo wrong/repo" && gh pr view 13 -R right/repo
gh issue view 14; gh pr view 15 --repo next/repo
gh pr status --repo ignored/repo | gh issue view 16 -R final/repo
`;

    expect(githubItemUrls(transcript)).toEqual([
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

    expect(githubItemUrls(transcript)).toEqual(["https://github.com/ultralytics/lite/pull/102"]);
  });

  test("reads links through terminal color and hyperlink sequences", () => {
    const transcript =
      "\u001b[32mhttps://github.com/ultralytics/lite/issues/88\u001b[0m " +
      "\u001b]8;;https://github.com/ultralytics/lite/pull/90\u0007PR\u001b]8;;\u0007";

    expect(githubItemUrls(transcript)).toEqual([
      "https://github.com/ultralytics/lite/issues/88",
      "https://github.com/ultralytics/lite/pull/90",
    ]);
  });
});
