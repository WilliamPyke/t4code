import type { ReactElement } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * A control with why it does nothing for this person, said on hover and focus. A disabled button
 * takes no pointer, so the reason hangs on a wrapper around it.
 */
export function WhyNot({
  reason,
  children,
}: {
  /** Null when the control works. */
  readonly reason: string | null;
  readonly children: ReactElement;
}) {
  if (reason === null) return children;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="inline-flex rounded-md outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&>*]:pointer-events-none"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{reason}</TooltipPopup>
    </Tooltip>
  );
}

/** A note on a control that works, saying what it does that a person might not expect. */
export function WhatItDoes({
  hint,
  children,
}: {
  readonly hint: string | undefined;
  readonly children: ReactElement;
}) {
  if (hint === undefined) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup side="top">{hint}</TooltipPopup>
    </Tooltip>
  );
}
