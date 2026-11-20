import { useAuth, useUser } from "@clerk/react";
import { useEffect } from "react";

import { syncBoardAccount } from "../../guest/boardAccount";
import { accountDisplayName, accountNameParts } from "../../guest/boardAccount.logic";
import { useAccountSavedName } from "../../guest/browserIdentity";
import { syncWorkspaces } from "../../guest/workspaces";

// Where an account keeps a name its sign-in settings have no first or last name field for.
const SAVED_NAME_FIELD = "displayName";

type ClerkUser = NonNullable<ReturnType<typeof useUser>["user"]>;

const metadataName = (user: ClerkUser) => {
  const saved = user.unsafeMetadata[SAVED_NAME_FIELD];
  return typeof saved === "string" ? saved : null;
};

/** Keeps a name on the account: as its first and last name, else where its settings allow. */
const saveAccountName = (user: ClerkUser, name: string) =>
  user.update(accountNameParts(name)).then(
    () => true,
    () =>
      user.update({ unsafeMetadata: { ...user.unsafeMetadata, [SAVED_NAME_FIELD]: name } }).then(
        () => true,
        () => false,
      ),
  );

/** Tells the cloud boards who is signed in, so a person's boards follow their account. */
export function BoardAccountBridge() {
  const { isLoaded, userId, getToken } = useAuth();
  const { user } = useUser();
  const savedHere = useAccountSavedName(userId ?? null);
  const shown =
    user == null
      ? null
      : accountDisplayName({
          fullName: user.fullName,
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          savedName: metadataName(user) ?? savedHere,
        });
  const name = shown?.name ?? null;
  const realName = shown?.real ?? false;
  const imageUrl = user?.hasImage === true ? user.imageUrl : undefined;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands Clerk's signed-in account to the cloud board client, which lives outside React
  useEffect(() => {
    if (!isLoaded) return;
    syncBoardAccount(
      userId
        ? {
            userId,
            name,
            realName,
            imageUrl,
            readToken: () => getToken(),
            saveName: (saved) =>
              user == null || user.id !== userId
                ? Promise.resolve(false)
                : saveAccountName(user, saved),
          }
        : null,
    );
    syncWorkspaces(userId ?? null);
  }, [isLoaded, userId, user, name, realName, imageUrl, getToken]);
  return null;
}
