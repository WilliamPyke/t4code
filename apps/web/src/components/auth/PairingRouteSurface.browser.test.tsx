import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";

const state = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.connect }));
vi.mock("../../connection/onboarding", () => ({ connectPairing: {} }));

import { HostedPairingRouteSurface } from "./PairingRouteSurface";

function visit(path: string): Disposable {
  const previous = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", path);
  return {
    [Symbol.dispose]: () => window.history.replaceState(window.history.state, "", previous),
  };
}

function setup() {
  state.connect.mockReset();
  state.connect.mockResolvedValue(AsyncResult.success("environment"));
}

it("connects a linked computer only after the person presses Connect", async () => {
  setup();
  using _page = visit("/pair?host=box.example.com&label=%3Cb%3EHome%20PC%3C%2Fb%3E#token=code-1");
  await using screen = await render(<HostedPairingRouteSurface />);
  await expect.element(screen.getByText("https://box.example.com")).toBeInTheDocument();
  await expect.element(screen.getByText("<b>Home PC</b>")).toBeInTheDocument();
  expect(state.connect).not.toHaveBeenCalled();

  await screen.getByRole("button", { name: "Connect to this computer" }).click();
  expect(state.connect).toHaveBeenCalledExactlyOnceWith({
    host: "https://box.example.com",
    pairingCode: "code-1",
  });
});

it("refuses a computer that the hosted app would reach without https", async () => {
  setup();
  using _page = visit("/pair?host=http%3A%2F%2Fbox.example.com#token=code-1");
  await using screen = await render(<HostedPairingRouteSurface />);
  await expect.element(screen.getByText("Can't use this link")).toBeInTheDocument();
  await expect.element(screen.getByRole("button")).not.toBeInTheDocument();
  expect(state.connect).not.toHaveBeenCalled();
});
