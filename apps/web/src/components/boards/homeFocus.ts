import { useAtomValue } from "@effect/atom-react";
import { isGuestEnvironment } from "@t3tools/client-runtime/environment";
import { Atom } from "effect/reactivity";

import { cloudBoardsOrigin } from "~/guest/cloudBoardsHost";
import { accountBoardsAtom, guestSharesAtom, isCloudShare } from "~/guest/guestShares";
import { useWorkspaces } from "~/guest/workspaces";
import { isHostedStaticApp } from "~/hostedPairing";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useShellMode } from "~/shellMode";
import { useThreadShells } from "~/state/entities";

import {
  type HomeContent,
  homeIsFocused,
  joinedBoardSources,
  listHomeBoards,
  withWorkspaceBoards,
} from "./boardsHome.logic";

// What the home showed last; null until it has shown anything.
const homeShownAtom = Atom.make<HomeContent | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("boards:home-shown"),
);

export const noteHomeShown = (content: HomeContent) => appAtomRegistry.set(homeShownAtom, content);

/** The hosted boards app in Simple: where a first run gets the window to itself. */
export const useFirstRunFocusOffered = () =>
  useShellMode() === "simple" && isHostedStaticApp() && cloudBoardsOrigin() !== null;

/**
 * Whether the page on screen is the home before it has boards to list, which shows alone: no
 * sidebar beside the welcome. `pathname` is the page drawn, not one still loading.
 */
export function useHomeFocus(pathname: string): boolean {
  const offered = useFirstRunFocusOffered();
  const shown = useAtomValue(homeShownAtom);
  return homeIsFocused({ offered, pathname, shown });
}

/** The person's own and joined boards as the home lists them, without teams or thumbnails. */
export function useListedBoards() {
  const threads = useThreadShells();
  const joined = useAtomValue(guestSharesAtom);
  const accountBoards = useAtomValue(accountBoardsAtom);
  const workspaces = useWorkspaces();
  return listHomeBoards({
    threads,
    // Signed in, the account's and its workspaces' boards too, before any is opened here.
    joined: withWorkspaceBoards(
      joinedBoardSources({
        // A board only looked at from a view link is not one of theirs: it is under Viewed.
        local: joined
          .filter((share) => share.viewOnly !== true)
          .map((share) => ({
            ...share,
            cloud: isCloudShare(share),
            maker: share.made === true,
          })),
        listed: accountBoards,
      }),
      workspaces,
    ),
    teams: [],
    isOwnEnvironment: (environmentId) => !isGuestEnvironment(environmentId),
  });
}

/** Whether to hold back the sidebar's attention dots: nothing calls out before a first board. */
export function useBeforeFirstBoard(): boolean {
  const offered = useFirstRunFocusOffered();
  return useListedBoards().length === 0 && offered;
}
