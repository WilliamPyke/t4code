import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { forgetGuestShare, readGuestShares } from "../../guest/guestShares";
import { GuestPage } from "./GuestPage";

function visit(path: string): Disposable {
  const previous = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(window.history.state, "", path);
  return {
    [Symbol.dispose]: () => window.history.replaceState(window.history.state, "", previous),
  };
}

const INVALID = "This link has ended or is not valid";

describe("GuestPage", () => {
  it("follows no link to a host outside this deployment's tunnels", async () => {
    using fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const host of ["evil.example.com", "t3.codes", "a.b.t3.codes", "sam.t3.codes.evil.io"]) {
      using _page = visit(`/guest?host=${host}#share-1.signature`);
      await using screen = await render(<GuestPage />);
      await expect.element(screen.getByText(INVALID)).toBeVisible();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("joins on the host the link names and keeps the token the app reads the thread with", async () => {
    using _page = visit("/guest?host=sam.t3.codes#share-1.signature");
    using _joined = { [Symbol.dispose]: () => forgetGuestShare("share-1") };
    using fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ token: "guest-token", shareId: "share-1", threadId: "thread-1" }),
      );
    await using screen = await render(<GuestPage />);
    // Opening the link redeems nothing, and takes the credential out of the address.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
    await userEvent.type(screen.getByLabelText("Your name"), "Sam");
    await userEvent.click(screen.getByRole("button", { name: "Join" }));

    await vi.waitFor(() => expect(readGuestShares()).toHaveLength(1));
    expect(readGuestShares()[0]).toMatchObject({
      host: "sam.t3.codes",
      shareId: "share-1",
      threadId: "thread-1",
      token: "guest-token",
    });
    // The join is the first request; the app then connects to the share it now knows.
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://sam.t3.codes/api/guest/redeem",
      expect.objectContaining({
        method: "POST",
        // No cookie goes to, or comes back from, the owner's host.
        credentials: "omit",
        body: JSON.stringify({ credential: "share-1.signature", name: "Sam", returnToken: true }),
      }),
    );
  });

  it("tells a guest when the owner's server cannot hand this page a token", async () => {
    using _page = visit("/guest?host=old.t3.codes#share-2.signature");
    using _fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    await using screen = await render(<GuestPage />);
    await userEvent.type(screen.getByLabelText("Your name"), "Sam");
    await userEvent.click(screen.getByRole("button", { name: "Join" }));
    await expect.element(screen.getByText(/too old for this link/)).toBeVisible();
    expect(readGuestShares()).toEqual([]);
  });
});
