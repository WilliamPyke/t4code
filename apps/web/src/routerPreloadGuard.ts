import type { AnyRouter } from "@tanstack/react-router";

/**
 * When a navigation commits, TanStack Router drops every cached match of a route without a
 * loader, including one a hover preload is still fetching the code for; that preload then reads
 * its missing match and throws. The sweep waits for the preloads in flight instead.
 */
export function keepPreloadingMatchesCached<Router extends AnyRouter>(router: Router): Router {
  const { preloadRoute, clearCache } = router;
  let preloading = 0;
  router.preloadRoute = (async (...args: Parameters<typeof preloadRoute>) => {
    preloading += 1;
    try {
      return await preloadRoute(...args);
    } finally {
      preloading -= 1;
    }
  }) as typeof preloadRoute;
  router.clearCache = (opts) => {
    // Only the sweep passes a filter; the next navigation runs it again.
    if (preloading > 0 && opts?.filter !== undefined) return;
    clearCache(opts);
  };
  return router;
}
