import { Redo2Icon, Undo2Icon } from "lucide-react";

import { isMacPlatform } from "~/lib/utils";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const onMac = () => typeof navigator !== "undefined" && isMacPlatform(navigator.platform);

/** Undo and redo of this viewer's own board changes, with their shortcuts. */
export function BoardHistoryButtons({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}) {
  const mac = onMac();
  const buttons = [
    {
      label: "Undo",
      shortcut: mac ? "⌘Z" : "Ctrl+Z",
      icon: <Undo2Icon />,
      enabled: canUndo,
      run: onUndo,
    },
    {
      label: "Redo",
      shortcut: mac ? "⇧⌘Z" : "Ctrl+Shift+Z",
      icon: <Redo2Icon />,
      enabled: canRedo,
      run: onRedo,
    },
  ];
  return buttons.map(({ label, shortcut, icon, enabled, run }) => (
    <Tooltip key={label}>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            aria-keyshortcuts={
              label === "Undo" ? "Control+Z Meta+Z" : "Control+Shift+Z Meta+Shift+Z Control+Y"
            }
            disabled={!enabled}
            onClick={run}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {label} ({shortcut})
      </TooltipPopup>
    </Tooltip>
  ));
}
