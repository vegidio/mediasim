import { type RefObject, useEffect, useEffectEvent, useState } from "react";
import { type DragDropEvent, onDragDrop } from "@/ipc/dragDrop";

/** Whether a position in physical pixels from the webview's corner falls inside `element`. */
const hits = (element: HTMLElement | null, { x, y }: { x: number; y: number }) => {
    if (!element) return false;

    const ratio = window.devicePixelRatio || 1;
    const [left, top] = [x / ratio, y / ratio];
    const rect = element.getBoundingClientRect();

    return left >= rect.left && left <= rect.right && top >= rect.top && top <= rect.bottom;
};

/**
 * Make the element in `ref` a target for files dragged from the operating system.
 *
 * Every target hears every drag over the window and tests the position against its own box, so several targets can
 * share the window and a drop elsewhere reaches none of them. `ref` is read on each event, so it may point at a
 * different element from one render to the next.
 *
 * @returns whether something is being dragged over the target, for its highlight.
 */
export const useDropTarget = (ref: RefObject<HTMLElement | null>, onDrop: (paths: string[]) => void) => {
    const [isOver, setIsOver] = useState(false);

    const handle = useEffectEvent((event: DragDropEvent) => {
        if (event.type === "leave") {
            setIsOver(false);
            return;
        }

        const inside = hits(ref.current, event.position);

        if (event.type === "drop") {
            setIsOver(false);
            if (inside) onDrop(event.paths);
            return;
        }

        setIsOver(inside);
    });

    useEffect(() => onDragDrop((event) => handle(event)), []);

    return isOver;
};
