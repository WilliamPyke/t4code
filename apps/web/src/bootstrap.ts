import { leavingForOurOtherDomain } from "./domainMove";
import { showBootError } from "./lib/bootError";

// Shared dev chunks need the React refresh preamble first. Catch failures before React mounts.
// The move between our domains comes before the app's chunks, which read storage as they load.
if (!leavingForOurOtherDomain) {
  void import("./main").then(({ startup }) => startup).catch(showBootError);
}
