import { describe, expect, it } from "vite-plus/test";

import { boardPeopleSummary, boardShareControls } from "./cloudBoardSharing.logic";

const allowed = (input: Parameters<typeof boardShareControls>[0]) =>
  Object.entries(boardShareControls(input))
    .filter(([, shown]) => shown)
    .map(([control]) => control);

describe("boardShareControls", () => {
  const links = { edit: "edit-secret", view: "view-secret" };
  it.each([
    {
      name: "the maker does everything but leave",
      input: { manage: true, isMaker: true, links },
      controls: [
        "copyEditLink",
        "copyViewLink",
        "changeLinks",
        "allowCopies",
        "changePeople",
        "deleteBoard",
      ],
    },
    {
      name: "an invited editor copies the links to bring someone, and leaves; nothing the host would refuse",
      input: { manage: false, isMaker: false, links },
      controls: ["copyEditLink", "copyViewLink", "leaveBoard"],
    },
    {
      name: "a workspace owner who did not make the board manages it but cannot delete it",
      input: { manage: true, isMaker: false, links },
      controls: [
        "copyEditLink",
        "copyViewLink",
        "changeLinks",
        "allowCopies",
        "changePeople",
        "leaveBoard",
      ],
    },
    {
      name: "links that are off, or not this person's to hand on, are not offered to copy",
      input: { manage: false, isMaker: false, links: { edit: undefined, view: null } },
      controls: ["leaveBoard"],
    },
    {
      name: "an edit link turned off is not copied, by its manager either",
      input: { manage: true, isMaker: true, links: { edit: null, view: null } },
      controls: ["changeLinks", "allowCopies", "changePeople", "deleteBoard"],
    },
  ])("$name", ({ input, controls }) => {
    expect(allowed(input)).toEqual(controls);
  });
});

describe("boardPeopleSummary", () => {
  it.each([
    { joined: 1, here: 1, viewing: 0, says: "Just you so far" },
    { joined: 3, here: 1, viewing: 0, says: "3 people · only you here now" },
    // This person's own page may not be counted as here yet.
    { joined: 3, here: 0, viewing: 0, says: "3 people · only you here now" },
    { joined: 3, here: 2, viewing: 0, says: "3 people · 2 here now" },
    { joined: 2, here: 2, viewing: 4, says: "2 people · 2 here now · 4 viewing" },
    { joined: 1, here: 1, viewing: 1, says: "Just you so far · 1 viewing" },
  ])("$joined joined, $here here, $viewing viewing", ({ says, ...input }) => {
    expect(boardPeopleSummary(input)).toBe(says);
  });
});
