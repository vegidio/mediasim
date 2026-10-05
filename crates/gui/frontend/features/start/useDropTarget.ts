import { type RefObject, useEffect, useEffectEvent, useState } from "react";
import { type DragDropEvent, onDragDrop, type Point } from "@/ipc/dragDrop";

export type { Point };

/** Whether a position in CSS pixels falls inside `element`. */
export const hits = (element: HTMLElement | null, { x, y }: Point) => {
    if (!element) return false;

    const rect = element.getBoundingClientRect();

    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
};

/** What is being dragged over a drop target. */
export type DropTargetState = {
    /** Whether something is being dragged over the target, for its highlight. */
    isOver: boolean;
    /** Where the drag is, in CSS pixels, while it is over the target. */
    position?: Point;
    /** How many paths are being dragged, while a drag is over the window. */
    count: number;
};

const IDLE: DropTargetState = { isOver: false, count: 0 };

/**
 * Make the element in `ref` a target for files dragged from the operating system.
 *
 * Every target hears every drag over the window and tests the position against its own box, so several targets can
 * share the window and a drop elsewhere reaches none of them. `ref` is read on each event, so it may point at a
 * different element from one render to the next.
 *
 * @param onDrop called with the dropped paths and where they were dropped, in CSS pixels.
 * @returns what is being dragged over the target.
 */
export const useDropTarget = (
    ref: RefObject<HTMLElement | null>,
    onDrop: (paths: string[], position: Point) => void,
) => {
    const [state, setState] = useState<DropTargetState>(IDLE);

    const handle = useEffectEvent((event: DragDropEvent) => {
        if (event.type === "leave") {
            setState(IDLE);
            return;
        }

        const { position } = event;
        const inside = hits(ref.current, position);

        if (event.type === "drop") {
            setState(IDLE);
            if (inside) onDrop(event.paths, position);
            return;
        }

        // Only `enter` carries the paths; `over` keeps the count it gave.
        setState((previous) => {
            const count = event.type === "enter" ? event.paths.length : previous.count;
            return inside ? { isOver: true, position, count } : { isOver: false, count };
        });
    });

    useEffect(() => onDragDrop((event) => handle(event)), []);

    return state;
};
