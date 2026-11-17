import { GuestId, type RoomBoardMention } from "@t3tools/contracts";
import { roomMentionKey } from "@t3tools/shared/roomBoard";

/** Someone the `@` picker offers: a person on the board, or a member of its workspace. */
export interface MentionPerson {
  /** As `roomMentionKey` names them. */
  readonly key: string;
  readonly guestId?: string | undefined;
  readonly memberId?: string | undefined;
  readonly name: string;
}

// Long enough for a full name typed after the `@`.
const MAX_QUERY_LENGTH = 40;

/**
 * The `@` word the caret is at the end of, or null: an `@` at the start or after a space or an
 * opening bracket, then up to a few words, with no line break.
 */
export function mentionQueryAt(
  text: string,
  caret: number,
): { readonly start: number; readonly query: string } | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("@");
  if (start < 0) return null;
  if (start > 0 && !/[\s([{"'“]/.test(before[start - 1] ?? "")) return null;
  const query = before.slice(start + 1);
  if (query.length > MAX_QUERY_LENGTH || /^\s|\n|\s{2}/.test(query)) return null;
  return { start, query };
}

/**
 * Who the picker offers for `query`, best first: names that start with it, then a later word
 * that does, then names that hold it. At most `limit`.
 */
export function rankMentionPeople(
  people: ReadonlyArray<MentionPerson>,
  query: string,
  limit = 6,
): ReadonlyArray<MentionPerson> {
  const wanted = query.trim().toLowerCase();
  return people
    .flatMap((person) => {
      const name = person.name.toLowerCase();
      const score =
        wanted === "" || name.startsWith(wanted)
          ? 0
          : name.split(/\s+/).some((word) => word.startsWith(wanted))
            ? 1
            : name.includes(wanted)
              ? 2
              : -1;
      return score < 0 ? [] : [{ person, score }];
    })
    .toSorted(
      (left, right) =>
        left.score - right.score || left.person.name.localeCompare(right.person.name),
    )
    .slice(0, limit)
    .map(({ person }) => person);
}

/** The text with the `@` word at `start` replaced by `@Name `, and where the caret goes. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  name: string,
): { readonly text: string; readonly caret: number } {
  const inserted = `@${name} `;
  return {
    text: text.slice(0, start) + inserted + text.slice(caret).replace(/^ /, ""),
    caret: start + inserted.length,
  };
}

export const mentionOf = (person: MentionPerson): RoomBoardMention =>
  person.guestId === undefined
    ? { memberId: person.memberId ?? "", name: person.name }
    : { guestId: GuestId.make(person.guestId), name: person.name };

/**
 * Who can be mentioned: the people on the board, then members of its workspace whose name
 * nobody on the board has, never the person looking.
 */
export function mentionPeopleOf(
  guests: ReadonlyArray<{ readonly id: string; readonly name: string }>,
  members: ReadonlyArray<{
    readonly memberId: string;
    readonly name: string;
    readonly you?: boolean | undefined;
  }>,
  viewer: string | null,
): ReadonlyArray<MentionPerson> {
  const onBoard = guests
    .filter((guest) => guest.id !== viewer)
    .map((guest) => ({
      key: roomMentionKey({ guestId: GuestId.make(guest.id) }),
      guestId: guest.id,
      name: guest.name,
    }));
  const named = new Set(guests.map((guest) => guest.name.toLowerCase()));
  const others = members
    .filter((member) => member.you !== true && !named.has(member.name.toLowerCase()))
    .map((member) => ({
      key: roomMentionKey({ memberId: member.memberId }),
      memberId: member.memberId,
      name: member.name,
    }));
  return [...onBoard, ...others];
}

/** The text in pieces, each mentioned `@Name` its own, for showing them as chips. */
export function mentionSegments(
  text: string,
  mentions: ReadonlyArray<RoomBoardMention> | undefined,
): ReadonlyArray<{ readonly text: string; readonly mention?: RoomBoardMention }> {
  if (mentions === undefined || mentions.length === 0) return [{ text }];
  // Longest names first, so "@Ann Lee" is not read as "@Ann".
  const names = mentions.toSorted((left, right) => right.name.length - left.name.length);
  const pieces: Array<{ text: string; mention?: RoomBoardMention }> = [];
  let plain = "";
  for (let at = 0; at < text.length;) {
    const found =
      text[at] === "@"
        ? names.find((mention) => text.startsWith(`@${mention.name}`, at))
        : undefined;
    if (found === undefined) {
      plain += text[at];
      at += 1;
      continue;
    }
    if (plain !== "") pieces.push({ text: plain });
    plain = "";
    pieces.push({ text: `@${found.name}`, mention: found });
    at += found.name.length + 1;
  }
  if (plain !== "") pieces.push({ text: plain });
  return pieces;
}
