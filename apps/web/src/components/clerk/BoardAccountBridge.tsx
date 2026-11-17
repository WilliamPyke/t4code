import { useAuth, useUser } from "@clerk/react";
import { useEffect } from "react";

import { syncBoardAccount } from "../../guest/boardAccount";
import { accountDisplayName } from "../../guest/boardAccount.logic";
import { useRememberedBoardName } from "../../guest/cloudBoards";
import { syncWorkspaces } from "../../guest/workspaces";

/** Tells the cloud boards who is signed in, so a person's boards follow their account. */
export function BoardAccountBridge() {
  const { isLoaded, userId, getToken } = useAuth();
  const { user } = useUser();
  const browserName = useRememberedBoardName();
  const shown =
    user == null
      ? null
      : accountDisplayName(
          {
            fullName: user.fullName,
            firstName: user.firstName,
            lastName: user.lastName,
            username: user.username,
          },
          browserName,
        );
  const name = shown?.name ?? null;
  const realName = shown?.real ?? false;
  const imageUrl = user?.hasImage === true ? user.imageUrl : undefined;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands Clerk's signed-in account to the cloud board client, which lives outside React
  useEffect(() => {
    if (!isLoaded) return;
    syncBoardAccount(
      userId ? { userId, name, realName, imageUrl, readToken: () => getToken() } : null,
    );
    syncWorkspaces(userId ?? null);
  }, [isLoaded, userId, name, realName, imageUrl, getToken]);
  return null;
}
