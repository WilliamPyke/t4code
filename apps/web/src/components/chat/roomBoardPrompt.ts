import {
  COMPOSER_CONTEXT_LABEL_MAX_CHARS,
  type ComposerContextRecord,
  type GuestShareId,
  type OrchestrationMessageContext,
  type RoomBoard,
  type RoomBoardContextCard,
  type ThreadGuest,
  roomBoardNoteRef,
} from "@t3tools/contracts";
import {
  formatComposerContextReference,
  formatRoomBoardCards,
  roomArtifactContextRecord,
  roomCardsContextRecord,
} from "@t3tools/shared/composerContextReferences";

import { randomUUID } from "~/lib/utils";

/** A card as a prompt from the board carries it; see `BoardPromptCard`. */
interface PromptCard {
  readonly ref: string;
  readonly label: string;
  readonly text: string;
}

/**
 * The board's cards with who wrote each: a guest by name, or the room's owner. An artifact's
 * content was written by the owner's agent.
 */
export function boardContextCards(
  board: RoomBoard | undefined,
  guests: ReadonlyArray<ThreadGuest>,
  cards: ReadonlyArray<PromptCard>,
): ReadonlyArray<RoomBoardContextCard> {
  return cards.map((card) => {
    const note = board?.notes.find((candidate) => roomBoardNoteRef(candidate.id) === card.ref);
    const name = guests.find((guest) => guest.id === note?.guestId)?.name;
    const author =
      note === undefined
        ? {}
        : note.kind === "artifact" && note.artifact !== undefined
          ? { author: "owner_agent" as const }
          : note.guestId === undefined
            ? { author: "owner" as const }
            : { author: "guest" as const, ...(name === undefined ? {} : { name }) };
    return {
      label: card.label.slice(0, COMPOSER_CONTEXT_LABEL_MAX_CHARS),
      ...author,
      text: card.text,
    };
  });
}

/**
 * The owner's message from their board: their text, a chip for the cards they left attached,
 * and one for the artifact the reply fills. The chips are in the text, so the owner sees in the
 * thread exactly what went to their agent.
 */
export function ownerBoardPromptMessage(input: {
  readonly text: string;
  readonly shareId: GuestShareId;
  readonly board: RoomBoard | undefined;
  readonly cards: ReadonlyArray<RoomBoardContextCard>;
  readonly artifactId: string | null;
}): { readonly text: string; readonly context: OrchestrationMessageContext | undefined } {
  const batch = randomUUID();
  const artifact = input.board?.notes.find(
    (note) => note.id === input.artifactId && note.kind === "artifact",
  );
  const records: ReadonlyArray<ComposerContextRecord> = [
    ...(input.cards.length === 0 ? [] : [roomCardsContextRecord({ batch, cards: input.cards })]),
    ...(artifact === undefined
      ? []
      : [
          roomArtifactContextRecord({
            batch,
            shareId: input.shareId,
            noteId: artifact.id,
            title: artifact.text,
            current: artifact.artifact?.body,
          }),
        ]),
  ];
  const chips = records.map(formatComposerContextReference).join(" ");
  return {
    text: [input.text.trim(), chips].filter((part) => part !== "").join("\n\n"),
    context: records.length === 0 ? undefined : { version: 1, records: [...records] },
  };
}

/**
 * A guest's message from the board, which waits for the owner like any other. The cards are
 * written into it, so the owner reads exactly what would reach their agent before sending it.
 */
export function guestBoardPromptText(
  text: string,
  cards: ReadonlyArray<RoomBoardContextCard>,
): string {
  const trimmed = text.trim();
  if (cards.length === 0) return trimmed;
  const attached = `Cards from the board:\n\n${formatRoomBoardCards(cards)}`;
  return trimmed === "" ? attached : `${trimmed}\n\n${attached}`;
}
