import { type ReactNode } from "react";

import { cn } from "~/lib/utils";

import { RIGHT_PANEL_SHEET_CLASS_NAME } from "../rightPanelLayout";
import { RightPanelResizeHandle } from "./preview/RightPanelResizeHandle";
import {
  useRightPanelResizableWidth,
  useViewportClampedMaxWidth,
} from "./preview/PreviewPanelShell";
import { Sheet, SheetPopup } from "./ui/sheet";

export function RightPanelSheet(props: {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  const maxWidth = useViewportClampedMaxWidth();
  const { width, handlers } = useRightPanelResizableWidth(maxWidth);

  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className={cn(RIGHT_PANEL_SHEET_CLASS_NAME, "max-w-none")}
        style={{ width: `${width}px` }}
      >
        <RightPanelResizeHandle handlers={handlers} />
        {props.children}
      </SheetPopup>
    </Sheet>
  );
}
