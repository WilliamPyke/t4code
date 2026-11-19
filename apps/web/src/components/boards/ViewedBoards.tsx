import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { EyeIcon, XIcon } from "lucide-react";

import { forgetGuestShare, guestShareLocation, guestSharesAtom } from "~/guest/guestShares";

import { Button } from "../ui/button";

/** How many boards looked at from a view link the home keeps in sight. */
const VIEWED_SHOWN = 4;

/**
 * Boards this browser only looked at from a view link, such as the sample: never among the
 * person's own boards, the last few here, each one gone with a click.
 */
export function ViewedBoards() {
  const viewed = useAtomValue(guestSharesAtom)
    .filter((share) => share.viewOnly === true)
    .toSorted((left, right) =>
      (right.openedAt ?? right.joinedAt).localeCompare(left.openedAt ?? left.joinedAt),
    )
    .slice(0, VIEWED_SHOWN);
  if (viewed.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="Viewed" data-boards-viewed>
      <h2 className="text-sm font-medium text-muted-foreground">Viewed</h2>
      <ul className="flex flex-col gap-1">
        {viewed.map((share) => (
          <li key={share.shareId} className="flex min-w-0 items-center gap-1">
            <Button variant="ghost" size="sm" render={<Link {...guestShareLocation(share)} />}>
              <EyeIcon />
              <span className="truncate">{share.title || "Untitled board"}</span>
            </Button>
            <Button
              variant="ghost-muted"
              size="icon-sm"
              aria-label={`Remove ${share.title || "this board"} from Viewed`}
              onClick={() => forgetGuestShare(share.shareId)}
            >
              <XIcon />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
