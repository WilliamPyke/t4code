import { useAuth, useUser } from "@clerk/react";
import { useEffect } from "react";

import { syncBoardAccount } from "../../guest/boardAccount";
import { accountDisplayName } from "../../guest/boardAccount.logic";

/** Tells the cloud boards who is signed in, so a person's boards follow their account. */
export function BoardAccountBridge() {
  const { isLoaded, userId, getToken } = useAuth();
  const { user } = useUser();
  const name =
    user == null
      ? null
      : accountDisplayName({
          fullName: user.fullName,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          email: user.primaryEmailAddress?.emailAddress,
        });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands Clerk's signed-in account to the cloud board client, which lives outside React
  useEffect(() => {
    if (!isLoaded) return;
    syncBoardAccount(userId ? { userId, name, readToken: () => getToken() } : null);
  }, [isLoaded, userId, name, getToken]);
  return null;
}
