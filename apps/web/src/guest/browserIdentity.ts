import { useAtomValue } from "@effect/atom-react";
import { GUEST_NAME_MAX_LENGTH } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../hooks/useLocalStorage";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  type BrowserIdentity,
  accountNameSeed,
  browserAfterSignIn,
  friendlyName,
} from "./boardAccount.logic";

// Per browser: who used it, for the names it shows (see BrowserIdentity).
const IDENTITY_KEY = "t3code:browser-identity:v1";
// Kept before the identity was: one name for whoever typed it, and the accounts asked for one.
const LEGACY_NAME_KEY = "t3code:board-name:v1";
const LEGACY_ASKED_KEY = "t3code:account-name-asked:v1";
// Per account signed in here: the name it saved where its account could not keep one.
const ACCOUNT_NAMES_KEY = "t3code:account-names:v1";
// Per browser: the friendly name offered to whoever has none, so every name field offers the same.
const SUGGESTION_KEY = "t3code:board-name-suggestion:v1";

const StoredIdentity = Schema.Struct({
  name: Schema.NullOr(Schema.String),
  accounts: Schema.Array(Schema.String),
  current: Schema.NullOr(Schema.String),
});
const AccountNames = Schema.Record(Schema.String, Schema.String);

const read = <T, E>(key: string, schema: Schema.Codec<T, E>): T | null => {
  try {
    return getLocalStorageItem(key, schema);
  } catch {
    return null;
  }
};

const write = <T, E>(key: string, value: T, schema: Schema.Codec<T, E>) => {
  try {
    setLocalStorageItem(key, value, schema);
  } catch {
    // Blocked storage only means this lasts as long as the page.
  }
};

function readIdentity(): BrowserIdentity {
  const stored = read(IDENTITY_KEY, StoredIdentity);
  if (stored !== null) return stored;
  const accounts = read(LEGACY_ASKED_KEY, Schema.Array(Schema.String)) ?? [];
  // Typed while some account was signed in here, the old name may be that person's: not kept.
  const name =
    accounts.length === 0 ? (read(LEGACY_NAME_KEY, Schema.String)?.trim() ?? null) : null;
  return { name: name || null, accounts, current: null };
}

const identityAtom = Atom.make<BrowserIdentity>(readIdentity()).pipe(
  Atom.keepAlive,
  Atom.withLabel("browser-identity"),
);

const accountNamesAtom = Atom.make<Readonly<Record<string, string>>>(
  read(ACCOUNT_NAMES_KEY, AccountNames) ?? {},
).pipe(Atom.keepAlive, Atom.withLabel("account-names"));

function setIdentity(next: BrowserIdentity) {
  appAtomRegistry.set(identityAtom, next);
  write(IDENTITY_KEY, next, StoredIdentity);
  try {
    removeLocalStorageItem(LEGACY_NAME_KEY);
  } catch {}
}

const fit = (name: string) => name.trim().slice(0, GUEST_NAME_MAX_LENGTH).trim();

/** The name typed here while signed out, which only a signed-out person goes by. */
export const readSignedOutName = () => appAtomRegistry.get(identityAtom).name;

export function rememberSignedOutName(name: string) {
  const kept = fit(name);
  if (kept === "") return;
  setIdentity({ ...appAtomRegistry.get(identityAtom), name: kept });
}

/** The name typed here signed out that this account may take as its own, or null. */
export const readAccountNameSeed = (userId: string) =>
  accountNameSeed(appAtomRegistry.get(identityAtom), userId);

// Kept in memory too, so blocked storage still offers one name for the life of the page.
let suggestion: string | null = null;

/** The friendly name this browser offers a person with none: made once, then always the same. */
export function readNameSuggestion(): string {
  suggestion ??= read(SUGGESTION_KEY, Schema.String);
  if (suggestion === null) {
    suggestion = friendlyName((count) => Math.floor(Math.random() * count));
    write(SUGGESTION_KEY, suggestion, Schema.String);
  }
  return suggestion;
}

/** The name this account saved on this browser, when its account could not keep it. */
export const useAccountSavedName = (userId: string | null) => {
  const names = useAtomValue(accountNamesAtom);
  return userId === null ? null : (names[userId] ?? null);
};

export function rememberAccountSavedName(userId: string, name: string) {
  const kept = fit(name);
  if (kept === "") return;
  const next = { ...appAtomRegistry.get(accountNamesAtom), [userId]: kept };
  appAtomRegistry.set(accountNamesAtom, next);
  write(ACCOUNT_NAMES_KEY, next, AccountNames);
}

/**
 * Notes who is signed in now (null: nobody). Resolves to whether the last account's things must
 * go from this browser, which has then already forgotten its names.
 */
export function noteSignedInAccount(userId: string | null): boolean {
  const { identity, clear } = browserAfterSignIn(appAtomRegistry.get(identityAtom), userId);
  if (identity !== appAtomRegistry.get(identityAtom)) setIdentity(identity);
  if (clear) {
    appAtomRegistry.set(accountNamesAtom, {});
    // The next person here may have gone by the suggestion; they get one of their own.
    suggestion = null;
    try {
      removeLocalStorageItem(ACCOUNT_NAMES_KEY);
      removeLocalStorageItem(SUGGESTION_KEY);
    } catch {}
  }
  return clear;
}
