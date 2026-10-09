import type { MouseEvent } from "react";

export { cn } from "cn";

/**
 * Keeps keyboard focus where it is when a button is pressed, so the selection keeps it and the arrow keys go on moving
 * the selection. Clicks still activate the button, and Tab still reaches it.
 */
export const keepFocus = (event: MouseEvent) => event.preventDefault();

/** Move focus to the element with `id`, once React has rendered what was just set, as a screen just shown. */
export const focusById = (id: string) => {
    requestAnimationFrame(() => document.getElementById(id)?.focus());
};
