import * as Schema from "effect/Schema";

import {
  readLocalStorageValue,
  useLocalStorage,
  writeLocalStorageValue,
} from "./hooks/useLocalStorage";
import { isHostedStaticApp } from "./hostedPairing";
import { resolveShellMode, type ShellMode } from "./shellMode.logic";

// Per browser: the Simple or Advanced choice made here. Absent until someone picks.
const SHELL_MODE_KEY = "tinkjam:shell-mode:v1";
const StoredShellMode = Schema.NullOr(Schema.Literals(["simple", "advanced"]));

export function useShellMode(): ShellMode {
  const [stored] = useLocalStorage(SHELL_MODE_KEY, null, StoredShellMode);
  return resolveShellMode(stored, isHostedStaticApp());
}

/** {@link useShellMode} for route guards and key handlers that run outside React. */
export function readShellMode(): ShellMode {
  return resolveShellMode(
    readLocalStorageValue(SHELL_MODE_KEY, null, StoredShellMode),
    isHostedStaticApp(),
  );
}

export function setShellMode(mode: ShellMode): void {
  writeLocalStorageValue(SHELL_MODE_KEY, mode, null, StoredShellMode);
}

export const isSimpleShell = (): boolean => readShellMode() === "simple";
