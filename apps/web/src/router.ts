import { createRouter, RouterHistory } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";
import { keepPreloadingMatchesCached } from "./routerPreloadGuard";

export function getRouter(history: RouterHistory) {
  return keepPreloadingMatchesCached(
    createRouter({
      routeTree,
      history,
      context: {},
      defaultPreload: "intent",
    }),
  );
}

export type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
