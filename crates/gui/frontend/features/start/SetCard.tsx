import { type MouseEvent, useId, useRef, useState } from "react";
import { ArrowRightIcon, FolderIcon, LayoutGridIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AddToSetMenu, type Point } from "@/features/start/AddToSetMenu";
import { dropTargetClassName, ModeCard } from "@/features/start/ModeCard";
import { cn } from "@/lib/utils";
import { useStartStore } from "@/stores/start";

/** Where to open the menu: the click point, or the drop area's centre when activated from the keyboard. */
const anchorFor = (event: MouseEvent<HTMLElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();

    // A keyboard activation is a click with `detail` 0 and no meaningful pointer position.
    if (event.detail === 0) return { x: rect.width / 2, y: rect.height / 2 };

    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

/** The "Find similar in a set" mode card, in its empty state. */
export const SetCard = () => {
    const scanSubfoldersId = useId();
    const scanSubfolders = useStartStore((state) => state.scanSubfolders);
    const toggleScanSubfolders = useStartStore((state) => state.toggleScanSubfolders);
    const dropAreaRef = useRef<HTMLButtonElement>(null);
    const [menuAnchor, setMenuAnchor] = useState<Point>();

    return (
        <ModeCard
            icon={<LayoutGridIcon aria-hidden="true" />}
            title="Find similar in a set"
            description="Group lookalikes across many files, then clean up the extras."
        >
            <div className="relative shrink-0">
                <button
                    ref={dropAreaRef}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={menuAnchor !== undefined}
                    onClick={(event) => setMenuAnchor(anchorFor(event))}
                    className={cn(
                        dropTargetClassName,
                        "h-[210px] w-full cursor-pointer outline-none transition-colors hover:border-border-hover focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:border-border-hover aria-expanded:bg-card",
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
                />
            </div>

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
                <Button disabled className="h-10 gap-2 px-4 font-semibold text-sm">
                    Continue
                    <ArrowRightIcon aria-hidden="true" />
                </Button>
            </div>
        </ModeCard>
    );
};
