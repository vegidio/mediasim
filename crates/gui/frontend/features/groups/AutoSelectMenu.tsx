import { useId, useRef } from "react";
import { ChevronDownIcon, SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePointerOpened } from "@/lib/usePointerOpened";
import { useScreenStore } from "@/stores/screen";

/** The chevron's id, which focus is sent to when the Auto-select rules dialog closes with no tile selected. */
const AUTO_SELECT_OPTIONS_ID = "groups-auto-select-options";

/** Moves focus to the chevron "More auto-select options". */
export const focusAutoSelectOptions = () => document.getElementById(AUTO_SELECT_OPTIONS_ID)?.focus();

type AutoSelectMenuProps = {
    /** Opens the Auto-select rules dialog; called once the menu has closed. */
    onChooseRules: () => void;
    /** Focuses the selected tile, returning whether there was one. */
    refocus: () => boolean;
    /** Disables the chevron, so the menu can't open. */
    disabled?: boolean;
};

/**
 * The chevron "More auto-select options", the right half of the Auto-select split button, and the menu it opens below
 * it, right-aligned (9a): "Choose rules…", which opens the Auto-select rules dialog, whose rules are saved as the
 * defaults when applied, and a note linking to Settings. Like the gallery's comparison options, a menu opened by a
 * click hands keyboard focus back to the selected tile when it closes, so the arrow keys go on moving the selection;
 * one opened from the keyboard returns focus to the chevron.
 */
export const AutoSelectMenu = ({ onChooseRules, refocus, disabled }: AutoSelectMenuProps) => {
    const openSettings = useScreenStore((state) => state.openSettings);
    const labelId = useId();
    const hintId = useId();
    // Whether the menu was opened by a click rather than from the keyboard.
    const { byPointer, triggerProps } = usePointerOpened();
    // Whether the menu is closing to open the dialog, which waits until it has: a dialog opened while a modal menu is
    // still closing is left with `pointer-events: none` on `<body>`.
    const choosing = useRef(false);
    // Whether the menu is closing for Settings, which unmounts the groups: no tile to focus until they come back.
    const leaving = useRef(false);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    id={AUTO_SELECT_OPTIONS_ID}
                    aria-label="More auto-select options"
                    disabled={disabled}
                    {...triggerProps}
                    className="h-[38px] w-9 shrink-0 rounded-l-none border-l-split-divider bg-split p-0 text-primary-foreground hover:bg-split/90 data-[state=open]:bg-split-active disabled:bg-split disabled:text-primary-foreground"
                >
                    <ChevronDownIcon aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                aria-label="Auto-select options"
                align="end"
                sideOffset={8}
                onCloseAutoFocus={(event) => {
                    if (choosing.current) {
                        choosing.current = false;
                        event.preventDefault();
                        onChooseRules();
                        return;
                    }
                    if (leaving.current) {
                        leaving.current = false;
                        return;
                    }
                    if (byPointer.current && refocus()) event.preventDefault();
                }}
                className="w-[310px] rounded-xl border border-border bg-card p-1.5 text-foreground shadow-[0_16px_40px_rgba(0,0,0,0.55)] ring-0"
            >
                <DropdownMenuItem
                    aria-labelledby={labelId}
                    aria-describedby={hintId}
                    onSelect={() => {
                        choosing.current = true;
                    }}
                    className="items-start gap-3 rounded-lg p-2.5 focus:bg-accent"
                >
                    {/* A concrete stroke, not `currentColor`, which the shared item's focus colour would turn white. */}
                    <SlidersHorizontalIcon aria-hidden="true" color="#BEF264" className="mt-0.5 size-4" />
                    <span className="flex flex-col gap-0.5">
                        <span id={labelId} className="font-medium text-foreground text-sm">
                            Choose rules…
                        </span>
                        {/* Important, so the shared item's focus colour, forced on every descendant, leaves it grey. */}
                        <span id={hintId} className="text-muted-foreground! text-xs leading-[1.4]">
                            Review, reorder and save the rules before files are marked
                        </span>
                    </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="mx-1 my-1.5 bg-border" />
                <p className="px-2.5 pt-1.5 pb-2 text-muted-foreground text-xs leading-normal">
                    Clicking <strong className="font-semibold text-text-label">Auto-select</strong> directly uses your
                    default rules from{" "}
                    {/* Styled on the item, not the button, so `cn` drops the shared item's flex layout and padding. */}
                    <DropdownMenuItem
                        asChild
                        onSelect={() => {
                            leaving.current = true;
                            openSettings();
                        }}
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
