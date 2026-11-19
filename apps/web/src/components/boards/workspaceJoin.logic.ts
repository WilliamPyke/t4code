/**
 * What a workspace invite's page shows. Having joined comes first: the address loses the invite's
 * code as the page leaves for the home, and that must never read as a broken link. The invite
 * itself shows only once who is signed in is known, so the page appears in one step.
 */
export function workspaceJoinStep(input: {
  readonly code: string;
  readonly joined: boolean;
  /** What the invite is for, why it cannot be read, or null while it is being read. */
  readonly preview: object | string | null;
  readonly account: "off" | "loading" | "signed-out" | "signed-in";
}): "joined" | "incomplete" | "reading" | "refused" | "invite" {
  if (input.joined) return "joined";
  if (input.code === "") return "incomplete";
  if (input.preview === null) return "reading";
  if (typeof input.preview === "string") return "refused";
  return input.account === "loading" ? "reading" : "invite";
}
