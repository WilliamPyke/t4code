import { ThreadId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { forgetGuestShare, rememberGuestShare } from "../guest/guestShares";
import { setGuestOnlySession } from "../guestPage";
import { connectionAtomRuntime } from "./runtime";

function guestOnlySession(): Disposable {
  setGuestOnlySession(true);
  return { [Symbol.dispose]: () => setGuestOnlySession(false) };
}

function joinedShare(): Disposable {
  rememberGuestShare({
    host: "sam.t3.codes",
    shareId: "share-1",
    threadId: ThreadId.make("thread-1"),
    token: "guest-token",
    title: "Review me",
    joinedAt: "2026-11-11T00:00:00.000Z",
  });
  return { [Symbol.dispose]: () => forgetGuestShare("share-1") };
}

describe("connectionAtomRuntime", () => {
  it("connects a guest to the thread shared with them, and to nothing on this page's host", async () => {
    using _guest = guestOnlySession();
    using _share = joinedShare();
    using socket = vi.spyOn(window, "WebSocket");
    using fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(null, { status: 204 }));
    const requested = () => fetchSpy.mock.calls.map(([input]) => String(input));
    const registry = AtomRegistry.make();
    using _mounted = { [Symbol.dispose]: registry.mount(connectionAtomRuntime) };

    // The share connects only after the platform listed its environments, so by now the page
    // host's own environment would have been asked for too.
    await vi.waitFor(() =>
      expect(requested()).toContain("https://sam.t3.codes/api/guest/session?share=share-1"),
    );
    expect(requested().filter((url) => url.startsWith(window.location.origin))).toEqual([]);
    expect(socket).not.toHaveBeenCalled();
    const check = fetchSpy.mock.calls.find(([input]) => String(input).includes("/api/guest/"));
    expect(new Headers(check?.[1]?.headers).get("authorization")).toBe("Bearer guest-token");
    expect(check?.[1]?.credentials).toBe("omit");
  });
});
