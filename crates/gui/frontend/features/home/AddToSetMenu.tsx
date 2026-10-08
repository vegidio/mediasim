import type { MouseEvent, ReactNode, RefObject } from "react";
import { FolderIcon, ImageIcon } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { pickFiles, pickFolders } from "@/ipc/dialog";
import { supportedFormats } from "@/ipc/formats";
import { useHomeStore } from "@/stores/home";

/** A point inside the control that opens the menu, in CSS pixels from its top-left corner. */
export type Point = { x: number; y: number };

/** Where to open the menu: the click point, or the opener's centre when activated from the keyboard. */
export const anchorFor = (event: MouseEvent<HTMLElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();

    // A keyboard activation is a click with `detail` 0 and no meaningful pointer position.
    if (event.detail === 0) return { x: rect.width / 2, y: rect.height / 2 };

    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

/** Add what a picker returned; a cancelled picker returns nothing, and leaves the set alone. */
const addPicked = async (picked: Promise<string[]>) => {
    try {
        const paths = await picked;
        if (paths.length > 0) await useHomeStore.getState().add(paths);
    } catch (error) {
        console.error("could not open the picker", error);
    }
};

/** The "Files…" item's action: pick media files, filtered to what `mediasim` loads, and add them. */
export const pickFilesIntoSet = () => addPicked(supportedFormats().then(pickFiles));

/** The "Folder…" item's action: pick folders and add them. */
export const pickFoldersIntoSet = () => addPicked(pickFolders());

type AddToSetMenuProps = {
    /** Where the menu opens, relative to the control that opened it; absent while it is closed. */
    anchor?: Point;
    /** Called when the menu is dismissed. */
    onClose: () => void;
    /** The control that opened the menu, which gets focus back when it closes; the zero-size anchor cannot take it. */
    returnFocusTo: RefObject<HTMLElement | null>;
    /** Called when "Files…" is chosen. */
    onPickFiles: () => void;
    /** Called when "Folder…" is chosen. */
    onPickFolders: () => void;
};

type MenuEntryProps = {
    icon: ReactNode;
    title: string;
    description: string;
    onSelect: () => void;
};

const MenuEntry = ({ icon, title, description, onSelect }: MenuEntryProps) => (
    <DropdownMenuItem onSelect={onSelect} className="gap-2.5 px-2.5 py-2">
        <span className="flex text-muted-foreground">{icon}</span>
        <span className="flex flex-col gap-px">
            <span className="font-medium text-[13px]">{title}</span>
            <span className="text-[11px] text-muted-foreground">{description}</span>
        </span>
    </DropdownMenuItem>
);

/**
 * The "Add to set" menu that the set card's drop area and the set list's add-more row open, with its top-left corner
 * at the click point.
 *
 * Rendered inside the opener's positioned wrapper: the trigger is an invisible zero-size anchor placed at `anchor`,
 * because Radix positions a dropdown against its trigger and the design opens this one where the user clicked.
 */
export const AddToSetMenu = ({ anchor, onClose, returnFocusTo, onPickFiles, onPickFolders }: AddToSetMenuProps) => (
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
            <MenuEntry
                icon={<ImageIcon aria-hidden="true" />}
                title="Files…"
                description="Pick images or videos"
                onSelect={onPickFiles}
            />
            <MenuEntry
                icon={<FolderIcon aria-hidden="true" />}
                title="Folder…"
                description="Add everything in a folder"
                onSelect={onPickFolders}
            />
        </DropdownMenuContent>
    </DropdownMenu>
);
