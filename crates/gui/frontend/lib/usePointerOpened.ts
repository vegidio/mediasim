import { type SyntheticEvent, useRef } from "react";

/** Whether a press on a menu's trigger opens the menu; its `data-state` is still the one before the press. */
const opening = (event: SyntheticEvent<HTMLElement>) => event.currentTarget.dataset.state !== "open";

/**
 * Whether a menu was opened by a click rather than from the keyboard, read when it closes, and the handlers its trigger
 * takes to tell. Only a press that opens the menu counts, so closing it from the trigger keeps the way it was opened.
 */
export const usePointerOpened = () => {
    const byPointer = useRef(false);

    const triggerProps = {
        onPointerDown: (event: SyntheticEvent<HTMLElement>) => {
            if (opening(event)) byPointer.current = true;
        },
        onKeyDown: (event: SyntheticEvent<HTMLElement>) => {
            if (opening(event)) byPointer.current = false;
        },
    };

    return { byPointer, triggerProps };
};
