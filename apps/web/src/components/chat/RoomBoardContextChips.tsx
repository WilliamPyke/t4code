import type { RoomArtifactContextRecord, RoomCardsContextRecord } from "@t3tools/contracts";
import {
  formatRoomBoardCards,
  roomArtifactInstruction,
} from "@t3tools/shared/composerContextReferences";
import { PanelsTopLeftIcon, StickyNoteIcon } from "lucide-react";

import { ContextChipPopover } from "../contextChipParts";

/** Cards from the room's board that went with a message. Opens what the agent got. */
export function RoomCardsContextChip(props: {
  record: RoomCardsContextRecord;
  copyMarkdown?: string;
}) {
  return (
    <ContextChipPopover
      kind="thread"
      icon={<StickyNoteIcon />}
      label={props.record.label}
      accessibleLabel={props.record.label}
      copyMarkdown={props.copyMarkdown}
    >
      <div className="max-h-80 space-y-2 overflow-y-auto">
        <p className="text-muted-foreground text-xs">
          Cards from the room's board. Your agent reads each as the words of whoever wrote it.
        </p>
        <div className="whitespace-pre-wrap wrap-break-word text-sm">
          {formatRoomBoardCards(props.record.cards)}
        </div>
      </div>
    </ContextChipPopover>
  );
}

/** The artifact card a message's reply fills on the room's board. Opens what the agent was told. */
export function RoomArtifactContextChip(props: {
  record: RoomArtifactContextRecord;
  copyMarkdown?: string;
}) {
  return (
    <ContextChipPopover
      kind="thread"
      icon={<PanelsTopLeftIcon />}
      label={props.record.label}
      accessibleLabel={props.record.label}
      copyMarkdown={props.copyMarkdown}
    >
      <div className="max-h-80 space-y-2 overflow-y-auto">
        <p className="text-muted-foreground text-xs">
          The reply fills this card on the room's board, where everyone in the room sees it.
        </p>
        <div className="whitespace-pre-wrap wrap-break-word text-sm">
          {roomArtifactInstruction(props.record)}
        </div>
      </div>
    </ContextChipPopover>
  );
}
