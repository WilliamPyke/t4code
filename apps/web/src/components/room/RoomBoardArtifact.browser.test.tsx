import { describe, expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import "../../index.css";

import { RoomArtifactBody } from "./RoomBoardArtifact";

const written = (body: string) => ({
  body,
  turnId: "turn-1",
  updatedAt: "2026-11-12T10:00:00.000Z",
});

describe("RoomArtifactBody", () => {
  it("shows a whole HTML page in a frame that may run scripts and nothing more", async () => {
    const page = "<!doctype html><html><body><h1>Pricing mockup</h1></body></html>";
    await using screen = await render(<RoomArtifactBody artifact={written(page)} />);
    const frame = screen.container.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("srcdoc")).toBe(page);
  });

  it("shows markdown as text, with no frame", async () => {
    await using screen = await render(
      <RoomArtifactBody artifact={written("# Release plan\n\nShip the board on Friday.")} />,
    );
    await expect.element(screen.getByText("Ship the board on Friday.")).toBeVisible();
    expect(screen.container.querySelector("iframe")).toBeNull();
  });
});
