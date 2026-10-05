import type { ReactNode, RefObject } from "react";
import { FolderIcon, ImageIcon } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** A point inside the drop area, in CSS pixels from its top-left corner. */
export type Point = { x: number; y: number };

type AddToSetMenuProps = {
    /** Where the menu opens, relative to the drop area; absent while it is closed. */
    anchor?: Point;
    /** Called when the menu is dismissed. */
    onClose: () => void;
    /** Where focus goes when the menu closes; the zero-size anchor cannot take it. */
    returnFocusTo: RefObject<HTMLElement | null>;
};

type MenuEntryProps = {
    icon: ReactNode;
    title: string;
    description: string;
};

// Disabled until slice 2 wires the file and folder pickers.
const MenuEntry = ({ icon, title, description }: MenuEntryProps) => (
    <DropdownMenuItem disabled className="gap-2.5 px-2.5 py-2 data-disabled:opacity-60">
        <span className="flex text-muted-foreground">{icon}</span>
        <span className="flex flex-col gap-px">
            <span className="font-medium text-[13px]">{title}</span>
            <span className="text-[11px] text-muted-foreground">{description}</span>
        </span>
    </DropdownMenuItem>
);

/**
 * The "Add to set" menu the set card's drop area opens, with its top-left corner at the click point.
 *
 * Rendered inside the drop area's positioned wrapper: the trigger is an invisible zero-size anchor placed at `anchor`,
 * because Radix positions a dropdown against its trigger and the design opens this one where the user clicked.
 */
export const AddToSetMenu = ({ anchor, onClose, returnFocusTo }: AddToSetMenuProps) => (
    <DropdownMenu
        open={anchor !== undefined}
        onOpenChange={(open) => {
            if (!open) onClose();
        }}
    >
        <DropdownMenuTrigger asChild>
            <span
                aria-hidden="true"
                tabIndex={-1}
                className="pointer-events-none absolute size-0"
                style={{ left: anchor?.x ?? 0, top: anchor?.y ?? 0 }}
            />
        </DropdownMenuTrigger>
        <DropdownMenuContent
            aria-label="Add to set"
            // Radix names the menu after its trigger, which here is an empty anchor; the label above names it instead.
            aria-labelledby={undefined}
            side="bottom"
            align="start"
            sideOffset={0}
            className="flex w-[230px] flex-col gap-0.5 rounded-[10px] border border-border-strong bg-secondary p-1 shadow-[0_12px_32px_rgba(0,0,0,0.55)] ring-0"
            onCloseAutoFocus={(event) => {
                event.preventDefault();
                returnFocusTo.current?.focus();
            }}
        >
            <MenuEntry icon={<ImageIcon aria-hidden="true" />} title="Files…" description="Pick images or videos" />
            <MenuEntry
                icon={<FolderIcon aria-hidden="true" />}
                title="Folder…"
                description="Add everything in a folder"
            />
        </DropdownMenuContent>
    </DropdownMenu>
);
