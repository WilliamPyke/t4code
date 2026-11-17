import { GuestId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  insertMention,
  mentionPeopleOf,
  mentionQueryAt,
  mentionSegments,
  rankMentionPeople,
} from "./boardMentions.logic";

describe("mentionQueryAt", () => {
  it("finds the @ word the caret ends, and nothing in an address or past a line", () => {
    expect(mentionQueryAt("Hi @sa", 6)).toEqual({ start: 3, query: "sa" });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("(@Ada Lo", 8)).toEqual({ start: 1, query: "Ada Lo" });
    expect(mentionQueryAt("mail me@ada.dev", 15)).toBeNull();
    expect(mentionQueryAt("@ada\nnext", 9)).toBeNull();
    expect(mentionQueryAt("@ ada", 5)).toBeNull();
    expect(mentionQueryAt("no at here", 10)).toBeNull();
  });
});

describe("rankMentionPeople", () => {
  const people = [
    { key: "a", name: "Sam Lee" },
    { key: "b", name: "Ada Samson" },
    { key: "c", name: "Lisa" },
    { key: "d", name: "Ben" },
  ];

  it("puts names that start with the query first, then a later word, then any part", () => {
    expect(rankMentionPeople(people, "sa").map((person) => person.name)).toEqual([
      "Sam Lee",
      "Ada Samson",
      "Lisa",
    ]);
    expect(rankMentionPeople(people, "").map((person) => person.name)).toEqual([
      "Ada Samson",
      "Ben",
      "Lisa",
      "Sam Lee",
    ]);
    expect(rankMentionPeople(people, "zed")).toEqual([]);
    expect(rankMentionPeople(people, "", 2)).toHaveLength(2);
  });
});

describe("insertMention", () => {
  it("replaces the typed @ word with the name and a space, and moves the caret past it", () => {
    expect(insertMention("Hi @sa and more", 3, 6, "Sam Lee")).toEqual({
      text: "Hi @Sam Lee and more",
      caret: 12,
    });
    expect(insertMention("@a", 0, 2, "Ada")).toEqual({ text: "@Ada ", caret: 5 });
  });
});

describe("mentionPeopleOf", () => {
  it("offers people on the board, then workspace members not on it, never the viewer", () => {
    const people = mentionPeopleOf(
      [
        { id: "g-me", name: "Me" },
        { id: "g-sam", name: "Sam" },
      ],
      [
        { memberId: "m-me", name: "Me", you: true },
        { memberId: "m-sam", name: "sam" },
        { memberId: "m-maya", name: "Maya" },
      ],
      "g-me",
    );
    expect(people).toEqual([
      { key: "guest:g-sam", guestId: "g-sam", name: "Sam" },
      { key: "member:m-maya", memberId: "m-maya", name: "Maya" },
    ]);
  });
});

describe("mentionSegments", () => {
  it("splits out each mentioned name, the longest first", () => {
    const ann = { guestId: GuestId.make("g-ann"), name: "Ann" };
    const annLee = { memberId: "m-ann", name: "Ann Lee" };
    expect(mentionSegments("Ask @Ann Lee and @Ann, not @Bob", [ann, annLee])).toEqual([
      { text: "Ask " },
      { text: "@Ann Lee", mention: annLee },
      { text: " and " },
      { text: "@Ann", mention: ann },
      { text: ", not @Bob" },
    ]);
    expect(mentionSegments("plain", undefined)).toEqual([{ text: "plain" }]);
  });
});
