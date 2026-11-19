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

const INVALID = "This board has ended, or the link is not valid";

describe("GuestPage", () => {
  it("follows no link to a host outside this deployment's tunnels", async () => {
    using fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const host of [
      "evil.example.com",
      "trellium.org",
      "a.b.trellium.org",
      "sam.trellium.org.evil.io",
    ]) {
      using _page = visit(`/guest?host=${host}#share-1.signature`);
      await using screen = await render(<GuestPage />);
      await expect.element(screen.getByText(INVALID)).toBeVisible();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("joins on the host the link names and keeps the token the app reads the thread with", async () => {
    using _page = visit("/guest?host=sam.trellium.org#share-1.signature");
    using _joined = { [Symbol.dispose]: () => forgetGuestShare("share-1") };
    using fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ token: "guest-token", shareId: "share-1", threadId: "thread-1" }),
      );
    await using screen = await render(<GuestPage />);
    // Opening the link only asks whether the invite still opens a share, and takes the
    // credential out of the address.
    await vi.waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://sam.trellium.org/api/guest/invite",
        expect.objectContaining({ body: JSON.stringify({ credential: "share-1.signature" }) }),
      ),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("");
    await userEvent.fill(screen.getByLabelText("Your name"), "Sam");
    await userEvent.click(screen.getByRole("button", { name: "Join the board" }));

    await vi.waitFor(() => expect(readGuestShares()).toHaveLength(1));
    expect(readGuestShares()[0]).toMatchObject({
      host: "sam.trellium.org",
      shareId: "share-1",
      threadId: "thread-1",
      token: "guest-token",
    });
    // The join is the next request; the app then connects to the share it now knows.
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://sam.trellium.org/api/guest/redeem",
      expect.objectContaining({
        method: "POST",
        // No cookie goes to, or comes back from, the owner's host.
        credentials: "omit",
        body: JSON.stringify({ credential: "share-1.signature", name: "Sam", returnToken: true }),
      }),
    );
  });

  it("says a deleted board's invite has ended before asking for a name", async () => {
    using _page = visit("/guest?host=sam.trellium.org#share-3.signature");
    using _fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 410 }));
    await using screen = await render(<GuestPage />);
    await expect.element(screen.getByText(INVALID)).toBeVisible();
    expect(readGuestShares()).toEqual([]);
  });

  it("says why the board host refused an invite, instead of that it ended", async () => {
    using _page = visit("/guest?host=sam.trellium.org#share-3.signature");
    using _fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          reason: "invalid",
          message:
            "This board's link now only lets people look at it. Ask whoever shared it for the view link.",
          detail: "view_only",
        },
        { status: 403 },
      ),
    );
    await using screen = await render(<GuestPage />);
    await expect
      .element(screen.getByText("This board's link now only lets people look at it"))
      .toBeVisible();
    await expect
      .element(screen.getByText("Ask whoever shared it for the view link."))
      .toBeVisible();
    expect(readGuestShares()).toEqual([]);
  });

  it("tells a guest when the owner's server cannot hand this page a token", async () => {
    using _page = visit("/guest?host=old.trellium.org#share-2.signature");
    using _fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    await using screen = await render(<GuestPage />);
    await userEvent.fill(screen.getByLabelText("Your name"), "Sam");
    await userEvent.click(screen.getByRole("button", { name: "Join the board" }));
    await expect.element(screen.getByText(/too old for this link/)).toBeVisible();
    expect(readGuestShares()).toEqual([]);
  });
});
