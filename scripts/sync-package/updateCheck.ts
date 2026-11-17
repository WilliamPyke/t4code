// Tinkjam Sync's check for a newer copy of itself. Plain TypeScript with no imports: the build
// strips its types into bin/update-check.mjs, beside the launcher that runs it.

/** sync.json, published beside the tarball: the newest version and the tarball's stable URL. */
export interface SyncRelease {
  readonly version: string;
  readonly url: string;
}

// `<server version>+<UTC build time as yyyymmddhhmm>`, so every build is newer than the last.
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:\+(\d{12}))?$/;

/** The version a build at `builtAt` (an ISO time in UTC) carries. */
export function syncVersion(serverVersion: string, builtAt: string): string {
  const stamp = builtAt.replace(/\D/g, "").slice(0, 12);
  return `${serverVersion}+${stamp}`;
}

/** Whether `latest` is newer than `own`. Anything unreadable counts as not newer. */
export function isNewerSync(own: string, latest: string): boolean {
  const mine = VERSION.exec(own);
  const theirs = VERSION.exec(latest);
  if (mine === null || theirs === null) return false;
  for (let part = 1; part <= 3; part += 1) {
    const difference = Number(theirs[part]) - Number(mine[part]);
    if (difference !== 0) return difference > 0;
  }
  return (theirs[4] ?? "") > (mine[4] ?? "");
}

/**
 * The command that runs the newest copy. npx keeps the first copy it downloaded from a URL and
 * runs that again, so the version goes in the URL: a URL npx has not seen downloads afresh.
 */
const syncUpdateCommand = (release: SyncRelease): string =>
  `npx -y ${release.url}?v=${encodeURIComponent(release.version)}`;

/**
 * What to tell the person when a newer copy is out, or null. With `install`, the copy to update
 * is the one in the background, which `--install` replaces.
 */
export function syncUpdateNotice(
  own: string,
  release: SyncRelease | null,
  options?: { readonly install?: boolean },
): string | null {
  if (release === null || !isNewerSync(own, release.version)) return null;
  return options?.install === true
    ? [
        "A newer Tinkjam Sync is out. To run it in the background instead of this one, run:",
        "",
        `  ${syncUpdateCommand(release)} --install`,
        "",
      ].join("\n")
    : [
        "A newer Tinkjam Sync is out. To use it, press Ctrl+C, then run:",
        "",
        `  ${syncUpdateCommand(release)}`,
        "",
      ].join("\n");
}

const isRelease = (value: unknown): value is SyncRelease =>
  typeof value === "object" &&
  value !== null &&
  "version" in value &&
  "url" in value &&
  typeof value.version === "string" &&
  typeof value.url === "string" &&
  /^https:\/\/\S+$/.test(value.url);

/** Reads sync.json, or null when it is slow, missing or not what it should be. */
export async function readSyncRelease(
  manifestUrl: string,
  timeoutMs: number,
  fetchRelease: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<SyncRelease | null> {
  try {
    const response = await fetchRelease(manifestUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isRelease(body) ? { version: body.version, url: body.url } : null;
  } catch {
    return null;
  }
}
