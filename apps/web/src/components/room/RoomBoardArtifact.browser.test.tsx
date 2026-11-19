import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import "../../index.css";

import { boardMarkSelectorOf } from "./boardMark.logic";
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
    expect(frame?.getAttribute("srcdoc")?.startsWith(page)).toBe(true);
  });

  it("leaves the wheel and the pointer to the board until its content is clicked", async () => {
    const page = "<!doctype html><html><body><h1>Pricing mockup</h1></body></html>";
    await using screen = await render(<RoomArtifactBody artifact={written(page)} />);
    const cover = () => screen.container.querySelector("[data-board-embed-cover]");
    const frame = () => screen.container.querySelector("iframe");
    expect(cover()?.textContent).toBe("Click to interact");
    expect(getComputedStyle(frame()!).pointerEvents).toBe("none");
    await screen.rerender(<RoomArtifactBody artifact={written(page)} active />);
    expect(cover()).toBeNull();
    expect(getComputedStyle(frame()!).pointerEvents).toBe("auto");
    // Text lies under the same cover, outside what the board reads as scrolling on its own.
    await screen.rerender(<RoomArtifactBody artifact={written("# Plan\n\nShip it.")} />);
    expect(cover()?.textContent).toBe("Click to scroll");
    expect(cover()?.closest("[data-board-scroll]")).toBeNull();
    await screen.rerender(<RoomArtifactBody artifact={written("# Plan\n\nShip it.")} active />);
    expect(cover()).toBeNull();
  });

  it("turns a click in a marked-up page into a pick, and what is typed into a mark", async () => {
    const onAdd = vi.fn();
    // The page clicks its own button once it is told it is marked up, as a person would.
    const page = `<!doctype html><html><body><section class="hero"><button id="cta" onclick="document.title='pressed'">Get a quote</button></section><script>addEventListener("message", (event) => { if (event.data && event.data.type === "mode") setTimeout(() => document.getElementById("cta").click()); });</script></body></html>`;
    await using screen = await render(
      <div style={{ display: "flex", flexDirection: "column", width: 400, height: 300 }}>
        <RoomArtifactBody
          artifact={written(page)}
          marking={{ pins: [], onAdd, onStop: () => {} }}
        />
      </div>,
    );
    expect(screen.container.querySelector("[data-board-embed-cover]")).toBeNull();
    const field = screen.getByLabelText("What should change here?");
    await userEvent.type(field, "Make it bigger{Enter}");
    expect(onAdd).toHaveBeenCalledWith(
      { selector: "#cta", tag: "button", text: "Get a quote" },
      "Make it bigger",
    );
    await expect.element(field).not.toBeInTheDocument();
  });

  it("shows a page still being written as its source, never running it in a frame", async () => {
    const page = "<!doctype html><html><body><h1>Pricing mockup</h1></body></html>";
    await using screen = await render(
      <RoomArtifactBody artifact={written(page)} draft="<!doctype html><html><body><scr" />,
    );
    await expect.element(screen.getByLabelText("Page being written")).toBeVisible();
    expect(screen.container.querySelector("iframe")).toBeNull();
  });

  it("shows markdown as text, with no frame", async () => {
    await using screen = await render(
      <RoomArtifactBody artifact={written("# Release plan\n\nShip the board on Friday.")} />,
    );
    await expect.element(screen.getByText("Ship the board on Friday.")).toBeVisible();
    expect(screen.container.querySelector("iframe")).toBeNull();
  });
});

describe("boardMarkSelectorOf", () => {
  it("finds each element again with a short selector, by id, class or place", async () => {
    await using screen = await render(<main />);
    // As markup, like the page an agent writes: its classes are the page's own, not the app's.
    screen.container.querySelector("main")!.innerHTML = `
      <section class="hero">
        <h2>Roofs done right</h2>
        <a class="cta primary x9_generated-name-that-is-far-too-long-to-keep">Get a quote</a>
        <a class="cta">Call us</a>
      </section>
      <ul><li>Tiles</li><li><span>Slate</span></li></ul>
      <button id="send:now">Send</button>
      <p id="twice">One</p>
      <p id="twice">Two</p>`;
    const all = [...screen.container.querySelectorAll("main, main *")];
    for (const element of all) {
      const selector = boardMarkSelectorOf(element);
      expect(document.querySelectorAll(selector), selector).toHaveLength(1);
      expect(document.querySelector(selector)).toBe(element);
    }
    const selectorOf = (text: string) =>
      boardMarkSelectorOf(all.find((element) => element.textContent === text)!);
    expect(selectorOf("Send")).toBe("#send\\:now");
    expect(selectorOf("Call us")).toBe("a.cta:nth-of-type(2)");
    expect(selectorOf("Get a quote")).toBe("a.cta.primary");
  });
});
