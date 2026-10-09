import { useId } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePointerOpened } from "@/lib/usePointerOpened";
import { useGalleryStore } from "@/stores/gallery";
import { useScreenStore } from "@/stores/screen";
import { FRAME_OPTIONS } from "@/stores/settings";

type OptionItemProps = {
    label: string;
    hint: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
};

/**
 * One option: a lime box on the left, ticked when on, beside its label over its hint. The shared item's own check on
 * the right is hidden, so the Home screen's menus keep theirs.
 */
const OptionItem = ({ label, hint, checked, onCheckedChange }: OptionItemProps) => {
    const labelId = useId();
    const hintId = useId();

    return (
        <DropdownMenuCheckboxItem
            checked={checked}
            onCheckedChange={onCheckedChange}
            // Flipping an option keeps the menu open, so both can be set in one visit.
            onSelect={(event) => event.preventDefault()}
            aria-labelledby={labelId}
            aria-describedby={hintId}
            className="group/option items-start gap-3 rounded-lg p-2.5 focus:bg-accent [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden"
        >
            <span
                aria-hidden="true"
                className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-border-hover border-[1.5px] group-data-[state=checked]/option:border-primary group-data-[state=checked]/option:bg-primary"
            >
                {/*
                  A concrete stroke, not `currentColor`: the shared item's focus colour reaches the icon's path too, and
                  would resolve `currentColor` there to white.
                */}
                <CheckIcon
                    color="#1A2E05"
                    strokeWidth={3}
                    className="hidden size-3 group-data-[state=checked]/option:block"
                />
            </span>
            <span className="flex flex-col gap-0.5">
                <span id={labelId} className="font-medium text-foreground text-sm">
                    {label}
                </span>
                {/* Important, so the shared item's focus colour, forced on every descendant, leaves the hint grey. */}
                <span id={hintId} className="text-muted-foreground! text-xs">
                    {hint}
                </span>
            </span>
        </DropdownMenuCheckboxItem>
    );
};

/**
 * The "Comparison options" chevron and the menu it opens below it, right-aligned: "Frame rotate" and "Frame flip" for
 * this comparison only, and a note linking to Settings, where their defaults live. Like a filter tab, a menu opened by a
 * click hands keyboard focus back to the grid when it closes, so the arrow keys go on moving the selection; one opened
 * from the keyboard returns focus to the chevron.
 */
export const ComparisonOptionsMenu = () => {
    const frameRotate = useGalleryStore((state) => state.frameRotate);
    const setFrameRotate = useGalleryStore((state) => state.setFrameRotate);
    const frameFlip = useGalleryStore((state) => state.frameFlip);
    const setFrameFlip = useGalleryStore((state) => state.setFrameFlip);
    const returnToGrid = useGalleryStore((state) => state.returnToGrid);
    const openSettings = useScreenStore((state) => state.openSettings);
    // Whether the menu was opened by a click rather than from the keyboard.
    const { byPointer, triggerProps } = usePointerOpened();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    aria-label="Comparison options"
                    {...triggerProps}
                    className="h-[38px] w-9 rounded-l-none border-l-split-divider bg-split p-0 text-primary-foreground hover:bg-split/90 data-[state=open]:bg-split-active"
                >
                    <ChevronDownIcon aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                sideOffset={8}
                onCloseAutoFocus={(event) => {
                    // The Settings link leaves the gallery, which has no grid to focus until it comes back.
                    if (!byPointer.current || useScreenStore.getState().screen !== "gallery") return;
                    event.preventDefault();
                    returnToGrid();
                }}
                className="w-[340px] rounded-xl border border-border bg-card p-1.5 text-foreground shadow-[0_16px_40px_rgba(0,0,0,0.55)] ring-0"
            >
                <DropdownMenuLabel className="px-2.5 pt-2 pb-1.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-[0.06em]">
                    Also compare each frame
                </DropdownMenuLabel>
                <OptionItem
                    label={FRAME_OPTIONS.frameRotate.name}
                    hint={FRAME_OPTIONS.frameRotate.hint}
                    checked={frameRotate}
                    onCheckedChange={setFrameRotate}
                />
                <OptionItem
                    label={FRAME_OPTIONS.frameFlip.name}
                    hint={FRAME_OPTIONS.frameFlip.hint}
                    checked={frameFlip}
                    onCheckedChange={setFrameFlip}
                />
                <DropdownMenuSeparator className="mx-0 my-1.5 bg-border" />
                <p className="px-2.5 pt-1 pb-2 text-muted-foreground text-xs leading-relaxed">
                    Finds copies that were rotated or mirrored. Each option adds comparisons, so scans take longer. The
                    defaults can be changed in{" "}
                    {/* Styled on the item, not the button, so `cn` drops the shared item's flex layout and padding. */}
                    <DropdownMenuItem
                        asChild
                        onSelect={openSettings}
                        className="inline cursor-pointer rounded-sm p-0 font-medium text-primary text-xs underline-offset-2 hover:underline focus:bg-transparent focus:text-primary focus:underline"
                    >
                        <button type="button">Settings</button>
                    </DropdownMenuItem>
                    .
                </p>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
