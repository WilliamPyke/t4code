import type { ModelSelection, RoomBoard, RoomBoxModel, ServerProvider } from "@t3tools/contracts";

const MODEL_NAME_MAX_LENGTH = 120;

/** A model's name as the machine that runs it labels it, for everyone else on the board. */
export function boardModelName(
  selection: ModelSelection,
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "models">>,
): string {
  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  const name = provider?.models.find((model) => model.slug === selection.model)?.name;
  return (name ?? selection.model).slice(0, MODEL_NAME_MAX_LENGTH);
}

/**
 * The model this person last picked for one of their own thread boxes on this board, which the
 * boxes they add next start on. `person` is null for the owner.
 */
export function boardNewBoxModel(
  board: RoomBoard | null | undefined,
  person: string | null,
): ModelSelection | undefined {
  // The room thread's own box is the owner's.
  let newest: RoomBoxModel | undefined = person === null ? board?.roomBoxModel : undefined;
  for (const note of board?.notes ?? []) {
    const picked = note.boxModel;
    if (note.kind !== "thread" || picked === undefined || (note.guestId ?? null) !== person) {
      continue;
    }
    if (newest === undefined || Date.parse(picked.at) > Date.parse(newest.at)) newest = picked;
  }
  return newest?.selection;
}

/**
 * The model a box's next prompt runs on, as far as the board decides it: this device's pick not
 * sent yet, else the board's pick when it came after the box's last run. Undefined leaves the box
 * on its own thread's model, which is the model it last ran on.
 */
export function boardBoxModelPick(input: {
  readonly picked: ModelSelection | undefined;
  readonly chosen: RoomBoxModel | undefined;
  /** When the box's thread last ran; undefined while that is not known here. */
  readonly lastRunAt: string | null | undefined;
}): ModelSelection | undefined {
  if (input.picked !== undefined) return input.picked;
  const { chosen, lastRunAt } = input;
  if (chosen === undefined) return undefined;
  return lastRunAt == null || Date.parse(chosen.at) >= Date.parse(lastRunAt)
    ? chosen.selection
    : undefined;
}

/**
 * A pick made on this device and sent to the board, kept only until the board shows a pick other
 * than the one it replaced, so the picker never flicks back while the board takes it.
 */
export interface BoardLocalModelPick {
  readonly selection: ModelSelection;
  readonly name: string;
  /** When the board's pick it replaced was made; absent when the box had none. */
  readonly over: string | undefined;
}

export const boardLocalModelPick = (
  pick: BoardLocalModelPick | undefined,
  chosen: RoomBoxModel | undefined,
): ModelSelection | undefined => (pick?.over === chosen?.at ? pick?.selection : undefined);
