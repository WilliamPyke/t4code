import { describe, expect, it } from "vite-plus/test";

import { boardLinksOf } from "./boardLinks.logic";

describe("boardLinksOf", () => {
  it("shows the links the host gives, else the one this browser joined with", () => {
    expect(boardLinksOf({ links: { edit: "b.new", view: "b.v.one" } }, "b.old")).toEqual({
      edit: "b.new",
      view: "b.v.one",
    });
    // Turned off on the host: the old link this browser kept no longer opens anything.
    expect(boardLinksOf({ links: { edit: null } }, "b.old")).toEqual({ edit: null, view: null });
    expect(boardLinksOf({}, "b.old")).toEqual({ edit: "b.old", view: null });
    expect(boardLinksOf({}, undefined)).toEqual({ edit: undefined, view: null });
  });

  it("never offers the edit link to someone who can only look", () => {
    expect(boardLinksOf({ viewOnly: true, links: { view: "b.v.one" } }, "b.old")).toEqual({
      edit: undefined,
      view: "b.v.one",
    });
  });
});
