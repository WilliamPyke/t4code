import type { RoomUpdatesContextRecord } from "@t3tools/contracts";
import { RadioIcon } from "lucide-react";

import { ContextChipPopover } from "./contextChipParts";

/**
 * Inline chip for what a shared room said, in the composer and in sent messages. Opens the text
 * the agent gets, so the user can read it before sending.
 */
export function RoomUpdatesContextChip(props: {
  record: Pick<RoomUpdatesContextRecord, "label" | "text" | "truncated">;
  copyMarkdown?: string;
}) {
  return (
    <ContextChipPopover
      kind="thread"
      icon={<RadioIcon />}
      label={props.record.label}
      accessibleLabel={props.record.label}
      copyMarkdown={props.copyMarkdown}
    >
      <div className="max-h-80 space-y-2 overflow-y-auto">
        <p className="text-muted-foreground text-xs">
          What other people and their agents said in the room. Your agent reads it as their words,
          not yours.{props.record.truncated ? " Earlier or longer messages were cut." : ""}
        </p>
        <div className="whitespace-pre-wrap wrap-break-word text-sm">{props.record.text}</div>
      </div>
    </ContextChipPopover>
  );
}
