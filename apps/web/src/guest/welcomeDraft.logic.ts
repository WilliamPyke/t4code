import { CLOUD_BOARD_TITLE_MAX_LENGTH, GUEST_NAME_MAX_LENGTH } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * What a person chose and typed on the welcome form before starting a board, kept so that signing
 * in from it (which may load the page again) brings them back to the same form.
 */
export interface WelcomeDraft {
  /** The starter they picked, or null for the first one. */
  readonly templateId: string | null;
  readonly title: string;
  /** The name they typed, or null while the field still shows what it was given. */
  readonly name: string | null;
}

export const EMPTY_WELCOME_DRAFT: WelcomeDraft = { templateId: null, title: "", name: null };

const Stored = Schema.Struct({
  templateId: Schema.NullOr(Schema.String),
  title: Schema.String,
  name: Schema.NullOr(Schema.String),
});
const decodeStored = Schema.decodeUnknownOption(Schema.fromJsonString(Stored));

export const serializeWelcomeDraft = (draft: WelcomeDraft): string => JSON.stringify(draft);

/**
 * The draft kept as `raw`, fitted to what the form can show now: a starter no longer offered
 * falls back to the first, and text is cut to what its field takes. Anything unreadable is empty.
 */
export function parseWelcomeDraft(
  raw: string | null,
  templateIds: ReadonlyArray<string>,
): WelcomeDraft {
  const stored = raw === null ? null : Option.getOrNull(decodeStored(raw));
  if (stored === null) return EMPTY_WELCOME_DRAFT;
  return {
    templateId:
      stored.templateId !== null && templateIds.includes(stored.templateId)
        ? stored.templateId
        : null,
    title: stored.title.slice(0, CLOUD_BOARD_TITLE_MAX_LENGTH),
    name: stored.name === null ? null : stored.name.slice(0, GUEST_NAME_MAX_LENGTH),
  };
}
