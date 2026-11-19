import { describe, expect, it } from "vite-plus/test";

import { workspaceJoinStep } from "./workspaceJoin.logic";

describe("workspaceJoinStep", () => {
  const invite = { code: "ws-1.secret", joined: false, preview: {}, account: "signed-in" } as const;
  it("never calls the link broken once the person has joined", () => {
    // Leaving for the home empties the address while this page is still showing.
    expect(workspaceJoinStep({ ...invite, code: "", joined: true })).toBe("joined");
    expect(workspaceJoinStep({ ...invite, code: "", preview: null, joined: true })).toBe("joined");
    expect(workspaceJoinStep({ ...invite, code: "" })).toBe("incomplete");
  });
  it("shows the invite only once it is read and who is signed in is known", () => {
    expect(workspaceJoinStep({ ...invite, preview: null })).toBe("reading");
    expect(workspaceJoinStep({ ...invite, account: "loading" })).toBe("reading");
    expect(workspaceJoinStep({ ...invite, preview: "This invite link is not valid." })).toBe(
      "refused",
    );
    expect(workspaceJoinStep({ ...invite, account: "signed-out" })).toBe("invite");
    expect(workspaceJoinStep(invite)).toBe("invite");
  });
});
