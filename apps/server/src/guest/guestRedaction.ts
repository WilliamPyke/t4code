import {
  type OrchestrationV2AppThread,
  type OrchestrationV2ThreadStreamItem,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

declare const GuestSafeBrand: unique symbol;
/**
 * Thread data with the owner's machine taken out. Only a `GuestRedactor` makes one, and every
 * `GuestShareService` method that returns thread data returns this, so a route cannot skip it.
 */
export type GuestSafe<T> = T & { readonly [GuestSafeBrand]: true };

/** Stands in for the owner's provider instance ids, which can name their accounts. */
const GUEST_PROVIDER_INSTANCE_ID = ProviderInstanceId.make("shared");
/** Stands in for the owner's project id. */
const GUEST_PROJECT_ID = ProjectId.make("shared");

const INSTANCE_ID_KEYS: ReadonlySet<string> = new Set([
  "providerInstanceId",
  "instanceId",
  "sourceProviderInstanceId",
  "targetProviderInstanceId",
  "toProviderInstanceId",
  "createdByProviderInstanceId",
]);
const INSTANCE_ID_LIST_KEY = "fromProviderInstanceIds";

// One or two backslashes, so a path inside JSON-escaped text matches too.
const SEP = String.raw`(?:\\{1,2}|/)`;
const USER_NAME = "[^\\\\/\\s\"'`<>|:*?()\\[\\]{},;]+";
// Not inside a longer path or URL (`example.com/home/page`), and not a prefix of a longer name
// (`matchbox2`, `matchbox-old`).
const START = String.raw`(?<![\w.~-])`;
const END = String.raw`(?![\w.-])`;
const ANY_DRIVE = `(?:[a-z]:${SEP}|/(?:mnt/)?[a-z]/)`;
const ANY_HOME = `${ANY_DRIVE}users${SEP}${USER_NAME}|/(?:home|users)/${USER_NAME}`;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A directory as a pattern: either slash style, and the Git Bash and WSL forms of a drive. */
function directoryPattern(directory: string) {
  const drive = /^([A-Za-z]):[\\/]/.exec(directory)?.[1];
  if (drive === undefined && !directory.startsWith("/")) return null;
  const segments = directory
    .slice(drive === undefined ? 0 : 2)
    .split(/[\\/]+/)
    .filter((segment) => segment !== "");
  if (segments.length === 0) return null;
  const prefix = drive === undefined ? "/" : `(?:${drive}:${SEP}|/(?:mnt/)?${drive}/)`;
  return { pattern: prefix + segments.map(escapeRegExp).join(SEP), name: segments.at(-1)! };
}

interface GuestPathScope {
  /** The thread's working directories. Each shows as its own name. */
  readonly workspaceRoots: ReadonlyArray<string | null | undefined>;
  /** The owner's home directory, which shows as `~`. Any other user's home does too. */
  readonly homeDirectory: string | null;
}

/**
 * Rewrites the owner's paths wherever they appear in text: under a working directory to
 * `name/relative`, elsewhere under a home directory to `~/relative`. The rest of a path keeps its
 * own separators. Text with no match comes back as the same string.
 */
export function makeGuestPathScrubber(scope: GuestPathScope): (text: string) => string {
  const roots = [...new Set(scope.workspaceRoots)]
    .flatMap((root) => {
      const directory = root ? directoryPattern(root) : null;
      return directory === null ? [] : [directory];
    })
    // A worktree inside the workspace has to win over the workspace.
    .toSorted((left, right) => right.pattern.length - left.pattern.length);
  const home = scope.homeDirectory === null ? null : directoryPattern(scope.homeDirectory);
  // The owner's own home is listed too: its name may hold a space, which ANY_HOME stops at.
  const alternatives = [
    ...roots.map((root) => `(${root.pattern})`),
    ...(home === null ? [] : [home.pattern]),
    ANY_HOME,
  ];
  const pattern = new RegExp(`${START}(?:${alternatives.join("|")})${END}`, "gi");
  return (text) => {
    // Most strings on the stream are ids, statuses and prose with no path in them.
    if (text.length < 3 || (!text.includes("/") && !text.includes("\\"))) return text;
    return text.replace(pattern, (_match, ...groups: ReadonlyArray<unknown>) => {
      for (let index = 0; index < roots.length; index += 1) {
        if (groups[index] !== undefined) return roots[index]!.name;
      }
      return "~";
    });
  };
}

/**
 * Scrubs every string and blanks every provider instance id below `value`. A branch with nothing
 * to change is returned as it is, not copied, so an event with no path costs one scan of its
 * strings and no allocation. `seen` keeps an object reached twice (a snapshot lists its items
 * twice) scanned once and shared in the result.
 */
function redactDeep(
  value: unknown,
  scrub: (text: string) => string,
  seen: Map<object, unknown>,
): unknown {
  if (typeof value === "string") return scrub(value);
  if (typeof value !== "object" || value === null || DateTime.isDateTime(value)) return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  let result: unknown = value;
  if (Array.isArray(value)) {
    let copy: Array<unknown> | null = null;
    for (let index = 0; index < value.length; index += 1) {
      const current: unknown = value[index];
      const next = redactDeep(current, scrub, seen);
      if (next !== current) (copy ??= value.slice())[index] = next;
    }
    result = copy ?? value;
  } else {
    const source = value as Record<string, unknown>;
    let copy: Record<string, unknown> | null = null;
    for (const key of Object.keys(source)) {
      const current = source[key];
      const next =
        typeof current === "string" && INSTANCE_ID_KEYS.has(key)
          ? GUEST_PROVIDER_INSTANCE_ID
          : key === INSTANCE_ID_LIST_KEY && Array.isArray(current)
            ? current.map(() => GUEST_PROVIDER_INSTANCE_ID)
            : redactDeep(current, scrub, seen);
      // Tool results can be keyed by path.
      const nextKey = scrub(key);
      if (next === current && nextKey === key) continue;
      copy ??= Object.assign(Object.create(Object.getPrototypeOf(source)), source);
      if (nextKey !== key) delete copy![key];
      copy![nextKey] = next;
    }
    result = copy ?? value;
  }
  seen.set(value, result);
  return result;
}

/**
 * The thread record a guest gets: what a read-only timeline shows, and neutral values where the
 * contract requires a field. Built field by field, so a field added to the thread later is not
 * sent until someone lists it here.
 */
function guestThreadRecord(
  thread: OrchestrationV2AppThread,
  scrub: (text: string) => string,
): OrchestrationV2AppThread {
  return {
    id: thread.id,
    title: scrub(thread.title) as OrchestrationV2AppThread["title"],
    createdBy: thread.createdBy,
    creationSource: thread.creationSource,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    // Matches the provider threads and turns in the projection, for the context meter.
    activeProviderThreadId: thread.activeProviderThreadId,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    deletedAt: thread.deletedAt,
    projectId: GUEST_PROJECT_ID,
    providerInstanceId: GUEST_PROVIDER_INSTANCE_ID,
    modelSelection: { instanceId: GUEST_PROVIDER_INSTANCE_ID, model: thread.modelSelection.model },
    branch: null,
    worktreePath: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: thread.id },
    forkedFrom: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
  };
}

const isThreadRecordEvent = (
  event: Extract<OrchestrationV2ThreadStreamItem, { readonly kind: "event" }>["event"],
) =>
  event.type.startsWith("thread.") &&
  event.type !== "thread.pull-request-link-updated" &&
  typeof event.payload === "object" &&
  "lineage" in event.payload;

export interface GuestRedactor {
  /** Anything a guest route sends that came from the thread. */
  readonly redact: <A>(value: A) => GuestSafe<A>;
  /** A stream item, or null for one a guest has no use for. The thread record is rebuilt. */
  readonly streamItem: (
    item: OrchestrationV2ThreadStreamItem,
  ) => GuestSafe<OrchestrationV2ThreadStreamItem> | null;
  /** The path a guest was shown for a path on the host. */
  readonly path: (path: string) => string;
}

export function makeGuestRedactor(scope: GuestPathScope): GuestRedactor {
  const scrub = makeGuestPathScrubber(scope);
  const redact = <A>(value: A) => redactDeep(value, scrub, new Map()) as GuestSafe<A>;
  return {
    redact,
    path: scrub,
    streamItem: (item) => {
      if (item.kind === "snapshot") {
        const { thread, ...rest } = item.projection;
        const safe = redact({ ...item, projection: rest });
        return {
          ...safe,
          projection: { ...safe.projection, thread: guestThreadRecord(thread, scrub) },
        } as GuestSafe<OrchestrationV2ThreadStreamItem>;
      }
      if (item.kind !== "event") return redact(item);
      const { event } = item;
      // A pull request is the owner's; the guest's page shows none.
      if (event.type === "thread.pull-request-link-updated") return null;
      if (!isThreadRecordEvent(event)) return redact(item);
      const { payload, ...envelope } = event;
      return {
        ...item,
        event: {
          ...redact(envelope),
          payload: guestThreadRecord(payload as OrchestrationV2AppThread, scrub),
        },
      } as unknown as GuestSafe<OrchestrationV2ThreadStreamItem>;
    },
  };
}
