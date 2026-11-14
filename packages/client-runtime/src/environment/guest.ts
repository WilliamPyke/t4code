import { EnvironmentId } from "@t3tools/contracts";

const GUEST_ENVIRONMENT_PREFIX = "guest-share-";

/** The environment a joined share appears as. One per share: each has its own token and thread. */
export const guestEnvironmentId = (shareId: string): EnvironmentId =>
  EnvironmentId.make(`${GUEST_ENVIRONMENT_PREFIX}${shareId}`);

/**
 * Whether an environment is a thread someone else shared with this client. The client is a guest
 * there: it reads the thread and proposes messages, and nothing else on that machine is its to
 * use. No session exists, so permission checks already refuse; this is for what they do not
 * cover. It reads the id, so it answers before the catalog has loaded.
 */
export const isGuestEnvironment = (environmentId: string | null | undefined): boolean =>
  typeof environmentId === "string" && environmentId.startsWith(GUEST_ENVIRONMENT_PREFIX);
