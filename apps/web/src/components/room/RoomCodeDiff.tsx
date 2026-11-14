import { FileDiff } from "@pierre/diffs/react";

import { useRenderedAppearance } from "~/hooks/useTheme";
import { getRenderablePatch, resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";

import { DIFF_VIEW_UNSAFE_CSS } from "../diffs/StyledDiffCodeView";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";

/** One file's patch, highlighted as the thread's own diff shows it. Loaded only once opened. */
export default function RoomCodeDiff({ patch }: { readonly patch: string }) {
  const appearance = useRenderedAppearance();
  const renderable = getRenderablePatch(patch, "room-code");
  if (renderable === null) return null;
  if (renderable.kind === "raw") {
    return (
      <pre className="px-3 py-2 font-mono text-2xs whitespace-pre text-muted-foreground">
        {renderable.text}
      </pre>
    );
  }
  return (
    <DiffWorkerPoolProvider>
      {renderable.files.map((file) => (
        <FileDiff
          key={`${file.prevName ?? ""}:${file.name}`}
          fileDiff={file}
          options={{
            diffStyle: "unified",
            lineDiffType: "none",
            overflow: "scroll",
            disableFileHeader: true,
            theme: resolveDiffThemeName(appearance),
            themeType: appearance,
            preferredHighlighter: PREFERRED_HIGHLIGHTER,
            unsafeCSS: DIFF_VIEW_UNSAFE_CSS,
          }}
        />
      ))}
    </DiffWorkerPoolProvider>
  );
}
