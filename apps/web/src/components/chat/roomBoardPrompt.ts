import {
  COMPOSER_CONTEXT_LABEL_MAX_CHARS,
  type GuestShareId,
  type ModelSelection,
  type OrchestrationV2TurnItem,
  ROOM_BOARD_ROOM_BOX,
  type RoomBoard,
  type RoomBoardContextCard,
  type RunId,
  type ServerProvider,
  type ThreadGuest,
  type ThreadGuestMessage,
  roomBoardNoteRef,
} from "@t3tools/contracts";
import { formatRoomBoardCards } from "@t3tools/shared/composerContextReferences";
import { createModelSelection } from "@t3tools/shared/model";
import { roomArtifactRequestOf } from "@t3tools/shared/roomBoard";

import { formatOutgoingPrompt } from "../ChatView.logic";
import { getComposerPromptInjectionState, getComposerProviderState } from "./composerProviderState";

/** A card as a prompt from the board carries it; see `BoardPromptCard`. */
interface PromptCard {
  readonly ref: string;
  readonly label: string;
  readonly text: string;
}

/**
 * The board's cards with who wrote each: a guest by name, or the room's owner. An artifact's
 * content was written by the agent of whoever filled it last.
 */
export function boardContextCards(
  board: RoomBoard | undefined,
  guests: ReadonlyArray<ThreadGuest>,
  cards: ReadonlyArray<PromptCard>,
): ReadonlyArray<RoomBoardContextCard> {
  const named = (guestId: string | undefined) => {
    const name = guests.find((guest) => guest.id === guestId)?.name;
    return name === undefined ? {} : { name };
  };
  return cards.map((card) => {
    const note = board?.notes.find((candidate) => roomBoardNoteRef(candidate.id) === card.ref);
    const author =
      note === undefined
        ? {}
        : note.kind === "artifact" && note.artifact !== undefined
          ? note.artifact.guestId === undefined
            ? { author: "owner_agent" as const }
            : { author: "guest_agent" as const, ...named(note.artifact.guestId) }
          : note.guestId === undefined
            ? { author: "owner" as const }
            : { author: "guest" as const, ...named(note.guestId) };
    return {
      label: card.label.slice(0, COMPOSER_CONTEXT_LABEL_MAX_CHARS),
      ...author,
      text: card.text,
    };
  });
}

/**
 * The model the owner's composer would send with now, and the prompt as it would send it: the
 * model, options and effort picked in the thread's draft and not sent yet, else the thread's, with
 * the effort a model takes as a prompt prefix (Claude's ultrathink) put in front.
 */
export function boardTurnSelection(input: {
  readonly selection: ModelSelection;
  readonly providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "driver" | "models">>;
  readonly text: string;
}): { readonly modelSelection: ModelSelection; readonly text: string } {
  const { selection, text } = input;
  const provider = input.providers.find((entry) => entry.instanceId === selection.instanceId);
  if (provider === undefined) return { modelSelection: selection, text };
  const state = getComposerProviderState({
    provider: provider.driver,
    model: selection.model,
    models: provider.models,
    modelOptions: selection.options,
    promptInjectionState: getComposerPromptInjectionState(text),
  });
  return {
    modelSelection: createModelSelection(
      selection.instanceId,
      selection.model,
      state.modelOptionsForDispatch,
    ),
    text: formatOutgoingPrompt({
      provider: provider.driver,
      model: selection.model,
      models: provider.models,
      effort: state.promptEffort,
      text,
    }),
  };
}

/**
 * The artifact card the owner's running turn will fill: the one the message that started it
 * names, whether the owner's own or a guest's the owner's server attached it to. Null while
 * nothing runs.
 */
export function ownerWritingArtifactId(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  activeRunId: RunId | null | undefined,
  shareId: GuestShareId | undefined,
): string | null {
  if (activeRunId === null || activeRunId === undefined || shareId === undefined) return null;
  const run = items.filter((item) => item.runId === activeRunId);
  return roomArtifactRequestOf(run, shareId)?.noteId ?? null;
}

/**
 * What a guest's waiting message says it fills: the artifact card's title, or null when it names
 * none or the card is gone, so sending it fills nothing.
 */
export function guestMessageArtifactTitle(
  board: RoomBoard | undefined,
  message: Pick<ThreadGuestMessage, "artifactId">,
): string | null {
  if (message.artifactId === undefined) return null;
  const note = board?.notes.find(
    (candidate) => candidate.id === message.artifactId && candidate.kind === "artifact",
  );
  return note === undefined ? null : note.text.trim() || "Untitled";
}

/**
 * The thread box a guest's waiting message was asked from, as the owner's timeline names it, or
 * null for one asked in the room thread itself.
 */
export function guestMessageBoxTitle(
  board: RoomBoard | undefined,
  message: Pick<ThreadGuestMessage, "boxId">,
): string | null {
  if (message.boxId === undefined || message.boxId === ROOM_BOARD_ROOM_BOX) return null;
  const note = board?.notes.find((candidate) => candidate.id === message.boxId);
  const title = note?.text.trim() ?? "";
  return title === "" ? "a thread box" : `the thread box "${title}"`;
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
