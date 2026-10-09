import { useId, useRef, useState } from "react";
import { ArrowRightIcon, FolderIcon, LayoutGridIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
    AddToSetMenu,
    anchorFor,
    type Point,
    pickFilesIntoSet,
    pickFoldersIntoSet,
} from "@/features/home/AddToSetMenu";
import { dropTargetClassName, ModeCard } from "@/features/home/ModeCard";
import { SetList } from "@/features/home/SetList";
import { useDropTarget } from "@/features/home/useDropTarget";
import { formatCount } from "@/lib/format";
import { cn, focusById } from "@/lib/utils";
import { useGalleryStore } from "@/stores/gallery";
import { useHomeStore } from "@/stores/home";
import { useScreenStore } from "@/stores/screen";

/** The Continue button's id, which focus is sent to on coming back from the gallery. */
const CONTINUE_BUTTON_ID = "set-continue";

/** Move focus to the set card's Continue button, once React has rendered the Home screen. */
export const focusContinue = () => focusById(CONTINUE_BUTTON_ID);

/** The "Find similar in a set" mode card: an empty drop area, or the list of what the set holds. */
export const SetCard = () => {
    const scanSubfoldersId = useId();
    const scanSubfolders = useHomeStore((state) => state.scanSubfolders);
    const toggleScanSubfolders = useHomeStore((state) => state.toggleScanSubfolders);
    const sources = useHomeStore((state) => state.sources);
    const total = useHomeStore((state) => state.view.total);
    const add = useHomeStore((state) => state.add);
    const show = useScreenStore((state) => state.show);
    const begin = useGalleryStore((state) => state.begin);
    const dropAreaRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const [menuAnchor, setMenuAnchor] = useState<Point>();

    const empty = sources.length === 0;
    // One drop target: the drop area while the set is empty, the list's box once it is not.
    const { isOver } = useDropTarget(empty ? dropAreaRef : listRef, add);
    const counting = sources.some((row) => row.pending);

    return (
        <ModeCard
            icon={<LayoutGridIcon aria-hidden="true" />}
            title="Find similar in a set"
            description="Group lookalikes across many files, then clean up the extras."
        >
            {empty ? (
                <div className="relative shrink-0">
                    <button
                        ref={dropAreaRef}
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={!!menuAnchor}
                        onClick={(event) => setMenuAnchor(anchorFor(event))}
                        className={cn(
                            dropTargetClassName,
                            "h-[210px] w-full cursor-pointer outline-none transition-colors hover:border-border-hover focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:border-border-hover aria-expanded:bg-card",
                            isOver && "border-border-hover bg-card",
                        )}
                    >
                        <FolderIcon aria-hidden="true" />
                        <span className="font-medium text-foreground text-sm">Drop files or folders here</span>
                        <span>or click to browse</span>
                    </button>
                    <AddToSetMenu
                        {...(menuAnchor && { anchor: menuAnchor })}
                        onClose={() => setMenuAnchor(undefined)}
                        returnFocusTo={dropAreaRef}
                        onPickFiles={pickFilesIntoSet}
                        onPickFolders={pickFoldersIntoSet}
                    />
                </div>
            ) : (
                <SetList
                    ref={listRef}
                    highlighted={isOver}
                    // Clear all unmounts with the list, so focus goes to the drop area that replaces it.
                    onCleared={() => requestAnimationFrame(() => dropAreaRef.current?.focus())}
                />
            )}

            <div className="mt-auto flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                    <Checkbox id={scanSubfoldersId} checked={scanSubfolders} onCheckedChange={toggleScanSubfolders} />
                    <Label
                        htmlFor={scanSubfoldersId}
                        className="cursor-pointer font-normal text-[13px] text-text-label"
                    >
                        Scan subfolders
                    </Label>
                </div>
                <Button
                    id={CONTINUE_BUTTON_ID}
                    disabled={total === 0 || counting}
                    onClick={() => {
                        begin();
                        show("gallery");
                    }}
                    className="h-10 gap-2 px-4 font-semibold text-sm"
                >
                    {empty ? "Continue" : `Continue with ${formatCount(total)}`}
                    <ArrowRightIcon aria-hidden="true" />
                </Button>
            </div>
        </ModeCard>
    );
};
