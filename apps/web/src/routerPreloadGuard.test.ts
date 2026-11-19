import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

import { keepPreloadingMatchesCached } from "./routerPreloadGuard";

describe("keepPreloadingMatchesCached", () => {
  it("lets a preload finish when a navigation elsewhere commits before its code arrives", async () => {
    const root = createRootRoute();
    const home = createRoute({ getParentRoute: () => root, path: "/" });
    const board = createRoute({ getParentRoute: () => root, path: "/b/$shareId" });
    let codeArrived = () => {};
    const code = new Promise<void>((resolve) => {
      codeArrived = resolve;
    });
    // No loader, as none of the app's pages has: only code that is still on its way.
    const news = createRoute({ getParentRoute: () => root, path: "/whats-new" }).lazy(() =>
      code.then(() => ({ options: {} }) as never),
    );
    const router = keepPreloadingMatchesCached(
      createRouter({
        routeTree: root.addChildren([home, board, news]),
        history: createMemoryHistory({ initialEntries: ["/"] }),
      }),
    );
    using logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await router.load();

    const preloaded = router.preloadRoute({ to: "/whats-new" });
    // What a navigation does as it commits in a browser.
    router.clearExpiredCache();
    codeArrived();

    const match = (await preloaded)?.at(-1);
    expect(match?.routeId).toBe("/whats-new");
    expect(logged).not.toHaveBeenCalled();
    // With no preload in flight the sweep runs as before.
    router.clearExpiredCache();
    expect(router.getMatch(match?.id ?? "")).toBeUndefined();
  });
});
