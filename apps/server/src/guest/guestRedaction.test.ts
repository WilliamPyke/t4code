import { assert, it } from "@effect/vitest";

import { makeGuestPathScrubber, makeGuestRedactor } from "./guestRedaction.ts";

const windows = {
  workspaceRoots: [String.raw`C:\Users\pykew\hackathon\matchbox`],
  homeDirectory: String.raw`C:\Users\pykew`,
};
const posix = {
  workspaceRoots: ["/home/sam/code/matchbox/.worktrees/fix", "/home/sam/code/matchbox"],
  homeDirectory: "/home/sam",
};

it.each([
  // Either slash style, any drive-letter case, and the path alone.
  [windows, "C:/Users/pykew/hackathon/matchbox/src/x.ts", "matchbox/src/x.ts"],
  [windows, String.raw`c:\users\PYKEW\hackathon\matchbox\src\x.ts`, String.raw`matchbox\src\x.ts`],
  [windows, String.raw`C:\Users\pykew\hackathon\matchbox`, "matchbox"],
  // Inside a command line, its output, a diff header, and JSON-escaped tool arguments.
  [
    windows,
    String.raw`cd "C:\Users\pykew\hackathon\matchbox" && cat C:/Users/pykew/hackathon/matchbox/a.ts`,
    `cd "matchbox" && cat matchbox/a.ts`,
  ],
  [
    windows,
    "--- a/C:/Users/pykew/hackathon/matchbox/a.ts\n+++ b/C:/Users/pykew/hackathon/matchbox/a.ts",
    "--- a/matchbox/a.ts\n+++ b/matchbox/a.ts",
  ],
  [
    windows,
    String.raw`{"file_path":"C:\\Users\\pykew\\hackathon\\matchbox\\a.ts"}`,
    String.raw`{"file_path":"matchbox\\a.ts"}`,
  ],
  [windows, "ls /mnt/c/Users/pykew/hackathon/matchbox/src /c/Users/pykew/x", "ls matchbox/src ~/x"],
  // A name that only starts the same is another directory: it gets the home rule, no more.
  [windows, "C:/Users/pykew/hackathon/matchbox2/x.ts", "~/hackathon/matchbox2/x.ts"],
  [
    windows,
    String.raw`C:\Users\pykew\hackathon\matchbox-old\x.ts`,
    String.raw`~\hackathon\matchbox-old\x.ts`,
  ],
  // A home directory outside the workspace, the owner's or anyone's.
  [windows, String.raw`C:\Users\pykew\.ssh\config`, String.raw`~\.ssh\config`],
  [windows, "scp /home/deploy/app.tar /Users/ada/Desktop", "scp ~/app.tar ~/Desktop"],
  [posix, "/home/sam/code/matchbox/src/x.ts:12", "matchbox/src/x.ts:12"],
  [posix, "/home/sam/code/matchbox/.worktrees/fix/src/x.ts", "fix/src/x.ts"],
  [posix, "/home/sam/code/matchbox2/x.ts", "~/code/matchbox2/x.ts"],
  // Not a path on this machine.
  [posix, "see https://example.com/home/sam/code/matchbox and ./src/x.ts", null],
  [windows, "D:/tools/bin/node.exe", null],
] as const)("rewrites the owner's paths in text (case %#)", (scope, text, expected) => {
  assert.equal(makeGuestPathScrubber(scope)(text), expected ?? text);
});

it("scrubs paths and provider instances wherever they sit, and leaves the input alone", () => {
  const item = {
    type: "dynamic_tool",
    providerInstanceId: "claude-work",
    input: { "C:/Users/pykew/hackathon/matchbox/a.ts": ["C:/Users/pykew/notes.md", 3] },
    untouched: { text: "no path here" },
  };
  const page = { items: [item, item], fromProviderInstanceIds: ["claude-work", "codex-home"] };
  const original = structuredClone(page);
  const safe = makeGuestRedactor(windows).redact(page);
  assert.deepEqual<unknown>(safe, {
    items: Array.from({ length: 2 }, () => ({
      type: "dynamic_tool",
      providerInstanceId: "shared",
      input: { "matchbox/a.ts": ["~/notes.md", 3] },
      untouched: { text: "no path here" },
    })),
    fromProviderInstanceIds: ["shared", "shared"],
  });
  assert.deepEqual(page, original);
  // Unchanged branches are shared, not copied, and an object listed twice is redacted once.
  assert.strictEqual(safe.items[0]!.untouched, item.untouched);
  assert.strictEqual(safe.items[0], safe.items[1]);
});

it("drops an event about the owner's pull request", () => {
  const redactor = makeGuestRedactor(windows);
  assert.isNull(
    redactor.streamItem({
      kind: "event",
      sequence: 4,
      event: { type: "thread.pull-request-link-updated" },
    } as never),
  );
});
