import { useAuth } from "@clerk/react";
import { useEffect } from "react";

import { syncBoardAccount } from "../../guest/boardAccount";

/** Tells the cloud boards who is signed in, so a person's boards follow their account. */
export function BoardAccountBridge() {
  const { isLoaded, userId, getToken } = useAuth();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands Clerk's signed-in account to the cloud board client, which lives outside React
  useEffect(() => {
    if (!isLoaded) return;
    syncBoardAccount(userId ? { userId, readToken: () => getToken() } : null);
  }, [isLoaded, userId, getToken]);
  return null;
}
