import { type SyntheticEvent, useId, useRef } from "react";
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
import { useGalleryStore } from "@/stores/gallery";
import { useScreenStore } from "@/stores/screen";

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
            className="group/option items-start gap-3 rounded-lg p-2.5 focus:bg-[#18181B] [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden"
        >
            <span
                aria-hidden="true"
                className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-[#52525B] border-[1.5px] group-data-[state=checked]/option:border-[#BEF264] group-data-[state=checked]/option:bg-[#BEF264]"
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
                <span id={labelId} className="font-medium text-[#FAFAFA] text-sm">
                    {label}
                </span>
                {/* Important, so the shared item's focus colour, forced on every descendant, leaves the hint grey. */}
                <span id={hintId} className="text-[#A1A1AA]! text-xs">
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
    // Whether the menu was opened by a click rather than from the keyboard. Only a press that opens the menu counts, so
    // closing it from the chevron keeps the way it was opened. The trigger's `data-state` is still the one before the
    // press, since Radix has not re-rendered yet.
    const byPointer = useRef(false);
    const opening = (event: SyntheticEvent<HTMLButtonElement>) => event.currentTarget.dataset.state !== "open";

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    aria-label="Comparison options"
                    onPointerDown={(event) => {
                        if (opening(event)) byPointer.current = true;
                    }}
                    onKeyDown={(event) => {
                        if (opening(event)) byPointer.current = false;
                    }}
                    className="h-[38px] w-9 rounded-l-none border-l-[#65A30D] bg-[#A3E635] p-0 text-[#1A2E05] hover:bg-[#A3E635]/90 data-[state=open]:bg-[#84CC16]"
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
                className="w-[340px] rounded-xl border border-[#27272A] bg-[#111113] p-1.5 text-[#FAFAFA] shadow-[0_16px_40px_rgba(0,0,0,0.55)] ring-0"
            >
                <DropdownMenuLabel className="px-2.5 pt-2 pb-1.5 font-semibold text-[#A1A1AA] text-[11px] uppercase tracking-[0.06em]">
                    Also compare each frame
                </DropdownMenuLabel>
                <OptionItem
                    label="Frame rotate"
                    hint="Also compare each frame rotated 90°, 180° and 270°"
                    checked={frameRotate}
                    onCheckedChange={setFrameRotate}
                />
                <OptionItem
                    label="Frame flip"
                    hint="Also compare each frame flipped vertically and horizontally"
                    checked={frameFlip}
                    onCheckedChange={setFrameFlip}
                />
                <DropdownMenuSeparator className="mx-0 my-1.5 bg-[#27272A]" />
                <p className="px-2.5 pt-1 pb-2 text-[#A1A1AA] text-xs leading-relaxed">
                    Finds copies that were rotated or mirrored. Each option adds comparisons, so scans take longer. The
                    defaults can be changed in{" "}
                    {/* Styled on the item, not the button, so `cn` drops the shared item's flex layout and padding. */}
                    <DropdownMenuItem
                        asChild
                        onSelect={openSettings}
                        className="inline cursor-pointer rounded-sm p-0 font-medium text-[#BEF264] text-xs underline-offset-2 hover:underline focus:bg-transparent focus:text-[#BEF264] focus:underline"
                    >
                        <button type="button">Settings</button>
                    </DropdownMenuItem>
                    .
                </p>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
