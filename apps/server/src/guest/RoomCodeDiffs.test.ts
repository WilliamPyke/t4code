import { ROOM_CODE_MAX_FILES, ROOM_CODE_PATH_MAX_LENGTH } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { DIFF_TRUNCATED_MARKER } from "../checkpointing/CheckpointDiffQuery.ts";
import { roomCodeSummary, splitPatchFiles } from "./RoomCodeDiffs.ts";

const modified = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1..2 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,3 @@",
  " keep",
  "-old",
  "--- a line that was a comment",
  "+new",
  "+++ a line that looks like a header",
].join("\n");
const renamed = [
  "diff --git a/old name.ts b/new name.ts",
  "similarity index 100%",
  "rename from old name.ts",
  "rename to new name.ts",
].join("\n");
const deleted = [
  "diff --git a/gone.ts b/gone.ts",
  "deleted file mode 100644",
  "--- a/gone.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-bye",
].join("\n");
const binary = [
  "diff --git a/logo.png b/logo.png",
  "Binary files a/logo.png and b/logo.png differ",
].join("\n");

describe("splitPatchFiles", () => {
  it("names and counts each file however git writes it, inside hunks lines are lines", () => {
    const files = splitPatchFiles([modified, renamed, deleted, binary].join("\n"));
    expect(files.map(({ path, additions, deletions }) => [path, additions, deletions])).toEqual([
      ["src/a.ts", 2, 2],
      ["new name.ts", 0, 0],
      ["gone.ts", 0, 1],
      ["logo.png", 0, 0],
    ]);
    expect(files[0]?.patch).toBe(modified);
  });
});

describe("roomCodeSummary", () => {
  it("lists the first files with what the last turn changed in each, and totals for all", () => {
    const many = Array.from(
      { length: ROOM_CODE_MAX_FILES + 2 },
      (_, index) =>
        `diff --git a/f${index}.ts b/f${index}.ts\n--- a/f${index}.ts\n+++ b/f${index}.ts\n@@ -0,0 +1 @@\n+x`,
    ).join("\n");
    const summary = roomCodeSummary(`${many}${DIFF_TRUNCATED_MARKER}`, modified, 3);
    expect(summary.files).toHaveLength(ROOM_CODE_MAX_FILES);
    expect(summary).toMatchObject({
      more: 2,
      additions: ROOM_CODE_MAX_FILES + 2,
      deletions: 0,
      truncated: true,
      turnCount: 3,
    });
    expect(summary.files[0]).toEqual({ path: "f0.ts", additions: 1, deletions: 0 });

    const own = roomCodeSummary(modified, modified, 1);
    expect(own.files).toEqual([
      {
        path: "src/a.ts",
        additions: 2,
        deletions: 2,
        lastTurn: { additions: 2, deletions: 2 },
      },
    ]);
    // A path longer than the board keeps is kept by its end.
    const long = `${"d/".repeat(ROOM_CODE_PATH_MAX_LENGTH)}x.ts`;
    const kept = roomCodeSummary(`diff --git a/${long} b/${long}`, null, 1).files[0]?.path;
    expect([kept?.length, kept?.startsWith("…"), kept?.endsWith("x.ts")]).toEqual([
      ROOM_CODE_PATH_MAX_LENGTH,
      true,
      true,
    ]);
  });
});
