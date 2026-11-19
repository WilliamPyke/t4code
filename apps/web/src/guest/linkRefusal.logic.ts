import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * What a board link's refusal says, once its host names it. The board host sends a `detail` next
 * to the "not valid" reason an older client already shows; a refusal with no detail, or one this
 * client does not know, gets the notice that covers every refusal.
 */
export interface RefusalNotice {
  readonly title: string;
  readonly detail: string;
}

/** Covers every refusal the host did not name: a deleted board, and a link that never opened one. */
export const ENDED_NOTICE: RefusalNotice = {
  title: "This board has ended, or the link is not valid",
  detail: "Ask whoever shared it with you for a new link.",
};

const NOTICES: Readonly<Record<string, RefusalNotice>> = {
  ended: ENDED_NOTICE,
  sharing_off: {
    title: "Link sharing is off for this board",
    detail: "Ask whoever shared it to turn it on or add you.",
  },
  view_only: {
    title: "This board's link now only lets people look at it",
    detail: "Ask whoever shared it for the view link.",
  },
  replaced: {
    title: "This link does not open the board any more",
    detail: "Ask whoever shared it for a new one.",
  },
};

/** The notice `detail` names, or the one that covers a refusal the host did not name. */
export const linkRefusalNotice = (detail: string | undefined): RefusalNotice =>
  (detail === undefined ? undefined : NOTICES[detail]) ?? ENDED_NOTICE;

/** A notice as one sentence, where the place that shows it has no title of its own. */
export const refusalSentence = (notice: RefusalNotice): string =>
  `${notice.title}. ${notice.detail}`;

/** What a refused board link's body can carry: its detail, and words for an older client. */
export const decodeRefusalBody = Schema.decodeUnknownOption(
  Schema.Struct({
    detail: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
  }),
);

/** The `detail` a refused board link's body names, or undefined. */
export const refusalDetailOf = (body: unknown): string | undefined =>
  Option.getOrNull(decodeRefusalBody(body))?.detail;

/**
 * The sentence to show where a refusal comes back as one string: this client's words for a
 * `detail` it knows, the host's own `message` where it sent a specific one (a machine host names
 * no detail but still says why), else the sentence that covers any refusal.
 */
export function linkRefusalMessage(
  refusal:
    | { readonly detail?: string | undefined; readonly message?: string | undefined }
    | null
    | undefined,
): string {
  const notice = refusal?.detail === undefined ? undefined : NOTICES[refusal.detail];
  return notice !== undefined
    ? refusalSentence(notice)
    : (refusal?.message ?? refusalSentence(ENDED_NOTICE));
}
