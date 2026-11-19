import { describe, expect, it } from "vite-plus/test";

import {
  ENDED_NOTICE,
  linkRefusalMessage,
  linkRefusalNotice,
  refusalDetailOf,
  refusalSentence,
} from "./linkRefusal.logic";

describe("linkRefusalNotice", () => {
  it("names each refusal the board host can tell apart", () => {
    expect(linkRefusalNotice("sharing_off")).toEqual({
      title: "Link sharing is off for this board",
      detail: "Ask whoever shared it to turn it on or add you.",
    });
    expect(linkRefusalNotice("view_only")).toEqual({
      title: "This board's link now only lets people look at it",
      detail: "Ask whoever shared it for the view link.",
    });
    expect(linkRefusalNotice("replaced")).toEqual({
      title: "This link does not open the board any more",
      detail: "Ask whoever shared it for a new one.",
    });
  });

  it("falls back to the notice that covers every refusal, named or not", () => {
    expect(linkRefusalNotice("ended")).toBe(ENDED_NOTICE);
    expect(linkRefusalNotice("from-a-newer-host")).toBe(ENDED_NOTICE);
    expect(linkRefusalNotice(undefined)).toBe(ENDED_NOTICE);
  });
});

describe("linkRefusalMessage", () => {
  it("prefers this client's words for a detail it knows", () => {
    expect(linkRefusalMessage({ detail: "sharing_off", message: "Whatever the host wrote." })).toBe(
      "Link sharing is off for this board. Ask whoever shared it to turn it on or add you.",
    );
    expect(linkRefusalMessage({ detail: "view_only" })).toBe(
      "This board's link now only lets people look at it. Ask whoever shared it for the view link.",
    );
    expect(linkRefusalMessage({ detail: "replaced" })).toBe(
      "This link does not open the board any more. Ask whoever shared it for a new one.",
    );
  });

  it("keeps a host's own message when it named no detail this client knows", () => {
    expect(linkRefusalMessage({ message: "This thread is shared with a team." })).toBe(
      "This thread is shared with a team.",
    );
    expect(linkRefusalMessage({ detail: "from-a-newer-host", message: "Said by the host." })).toBe(
      "Said by the host.",
    );
  });

  it("covers a refusal nobody said anything about", () => {
    expect(linkRefusalMessage(null)).toBe(refusalSentence(ENDED_NOTICE));
    expect(linkRefusalMessage({})).toBe(refusalSentence(ENDED_NOTICE));
  });
});

describe("refusalDetailOf", () => {
  it("reads the detail a host sent, and nothing else", () => {
    expect(refusalDetailOf({ reason: "invalid", message: "No.", detail: "view_only" })).toBe(
      "view_only",
    );
    expect(refusalDetailOf({ message: "No detail here." })).toBeUndefined();
    expect(refusalDetailOf(null)).toBeUndefined();
    expect(refusalDetailOf("<html>ended</html>")).toBeUndefined();
  });
});
