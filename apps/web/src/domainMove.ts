import { MOVED_KEY, MOVED_SHARES_KEY, ASKED_KEY, moveStep } from "./domainMove.logic";
import { builtHostedAppOrigins } from "./hostedPairing";

const read = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

function canStore(): boolean {
  try {
    window.localStorage.setItem(ASKED_KEY, "1");
    window.localStorage.removeItem(ASKED_KEY);
    return true;
  } catch {
    return false;
  }
}

const asked = () => {
  try {
    return window.sessionStorage.getItem(ASKED_KEY) !== null;
  } catch {
    return true;
  }
};

/**
 * Runs before anything reads this browser's storage or the link: the older address leaves for the
 * current one with what it holds, and the current one takes that in. See `domainMove.logic.ts`.
 */
function moveBetweenOurDomains() {
  const origins = builtHostedAppOrigins();
  const current = origins[0];
  if (current === undefined) return;
  const { location } = window;
  const step = moveStep({
    origin: location.origin,
    current,
    origins,
    path: location.pathname,
    search: location.search,
    hash: location.hash,
    referrer: document.referrer,
    moved: read(MOVED_KEY) !== null,
    asked: asked(),
    canStore: canStore(),
    framed: window.top !== window,
    now: Date.now(),
    read,
    cookie: document.cookie,
  });
  if (step.kind === "stay") return;
  if (step.kind === "go") {
    try {
      if (step.asking) window.sessionStorage.setItem(ASKED_KEY, "1");
    } catch {
      return;
    }
    location.replace(step.href);
    return;
  }
  window.history.replaceState(window.history.state, "", step.href);
  try {
    if (step.payload !== null) {
      for (const [key, value] of Object.entries(step.payload.kept)) {
        if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, value);
      }
      window.localStorage.setItem(MOVED_SHARES_KEY, step.payload.shares);
    }
    if (step.done) window.localStorage.setItem(MOVED_KEY, new Date().toISOString());
  } catch {
    // Blocked storage keeps nothing; the page still opens.
  }
}

if (typeof window !== "undefined") moveBetweenOurDomains();
