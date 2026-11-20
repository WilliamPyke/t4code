import { describe, expect, it } from "vite-plus/test";

import {
  boardLinkSharing,
  boardPeopleSummary,
  boardShareControls,
  demotionNote,
  linkAccessNote,
  removalNote,
} from "./cloudBoardSharing.logic";

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
    { joined: 3, here: 1, viewing: 0, says: "3 people on this board" },
    // This person's own page may not be counted as here yet.
    { joined: 3, here: 0, viewing: 0, says: "3 people on this board" },
    { joined: 3, here: 2, viewing: 0, says: "3 people · 2 here now" },
    { joined: 2, here: 2, viewing: 4, says: "2 people · 2 here now · 4 viewing" },
    { joined: 1, here: 1, viewing: 1, says: "Just you so far · 1 viewing" },
    { joined: 2, here: 1, viewing: 1, says: "2 people on this board · 1 viewing" },
  ])("$joined joined, $here here, $viewing viewing", ({ says, ...input }) => {
    expect(boardPeopleSummary(input)).toBe(says);
  });
});

describe("link sharing", () => {
  it.each([
    { sharing: undefined, links: { edit: "e", view: "v" }, is: "edit" },
    { sharing: undefined, links: { edit: undefined, view: "v" }, is: "view" },
    { sharing: undefined, links: { edit: null, view: "v" }, is: "view" },
    { sharing: undefined, links: { edit: null, view: null }, is: "off" },
    // The host's word wins over the links, which it hands out only while they let people in.
    { sharing: "off", links: { edit: undefined, view: null }, is: "off" },
    { sharing: "edit", links: { edit: null, view: null }, is: "edit" },
  ] as const)("reads $is from $sharing and the links", ({ sharing, links, is }) => {
    expect(boardLinkSharing(sharing, links)).toBe(is);
  });

  it("warns about the link only where it would let the person back in", () => {
    expect(removalNote("Grace", "off")).toBeNull();
    expect(removalNote("Grace", "edit")).toContain("join and edit");
    expect(removalNote("Grace", "view")).toContain("look at the board");
    expect(demotionNote("Grace", "edit")).toContain("join again with it to edit");
    expect([demotionNote("Grace", "view"), demotionNote("Grace", "off")]).toEqual([null, null]);
  });

  it("notes someone who can edit through the link though they can only view", () => {
    expect(linkAccessNote("view", "edit")).toBe("the link lets them edit");
    expect([
      linkAccessNote("view", "view"),
      linkAccessNote("edit", "edit"),
      linkAccessNote("view", "off"),
    ]).toEqual([null, null, null]);
  });
});
