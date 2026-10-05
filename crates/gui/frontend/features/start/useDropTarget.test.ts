import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, type Mock, vi } from "vitest";
import { type DragDropEvent, onDragDrop } from "@/ipc/dragDrop";
import { hits, useDropTarget } from "./useDropTarget";

vi.mock("@/ipc/dragDrop", () => ({ onDragDrop: vi.fn(() => () => {}) }));

/** Send a drag event to every listener the hook registered. */
const drag = (event: DragDropEvent) =>
    act(() => {
        for (const [handler] of (onDragDrop as Mock).mock.calls) handler(event);
    });

/** An element laid out at the given CSS-pixel box; jsdom lays nothing out itself. */
const elementAt = (x: number, y: number, width: number, height: number) => {
    const element = document.createElement("div");
    element.getBoundingClientRect = () => DOMRect.fromRect({ x, y, width, height });
    return element;
};

describe("hits", () => {
    it("tests a CSS-pixel position against the element's box, edges included", () => {
        const element = elementAt(100, 100, 200, 100);

        expect(hits(element, { x: 100, y: 100 })).toBe(true);
        expect(hits(element, { x: 300, y: 200 })).toBe(true);
        expect(hits(element, { x: 301, y: 150 })).toBe(false);
        expect(hits(null, { x: 150, y: 150 })).toBe(false);
    });
});

describe("useDropTarget", () => {
    it("reports the position and the count from enter while a drag is over the target", () => {
        const ref = { current: elementAt(0, 0, 400, 200) };
        const { result } = renderHook(() => useDropTarget(ref, () => {}));

        expect(result.current).toEqual({ isOver: false, count: 0 });

        drag({ type: "enter", paths: ["/a.jpg", "/b.jpg"], position: { x: 50, y: 30 } } as DragDropEvent);
        expect(result.current).toEqual({ isOver: true, position: { x: 50, y: 30 }, count: 2 });

        // `over` carries no paths, so the count from `enter` is kept.
        drag({ type: "over", position: { x: 150, y: 40 } } as DragDropEvent);
        expect(result.current).toEqual({ isOver: true, position: { x: 150, y: 40 }, count: 2 });

        drag({ type: "over", position: { x: 500, y: 40 } } as DragDropEvent);
        expect(result.current).toEqual({ isOver: false, count: 2 });

        drag({ type: "leave" } as DragDropEvent);
        expect(result.current).toEqual({ isOver: false, count: 0 });
    });

    it("passes the dropped paths and the drop position, then resets", () => {
        const onDrop = vi.fn();
        const ref = { current: elementAt(0, 0, 400, 200) };
        const { result } = renderHook(() => useDropTarget(ref, onDrop));

        drag({ type: "enter", paths: ["/a.jpg"], position: { x: 100, y: 60 } } as DragDropEvent);
        drag({ type: "drop", paths: ["/a.jpg"], position: { x: 300, y: 150 } } as DragDropEvent);

        expect(onDrop).toHaveBeenCalledExactlyOnceWith(["/a.jpg"], { x: 300, y: 150 });
        expect(result.current).toEqual({ isOver: false, count: 0 });
    });

    it("ignores a drop outside the target", () => {
        const onDrop = vi.fn();
        const ref = { current: elementAt(0, 0, 400, 200) };
        renderHook(() => useDropTarget(ref, onDrop));

        drag({ type: "drop", paths: ["/a.jpg"], position: { x: 500, y: 150 } } as DragDropEvent);

        expect(onDrop).not.toHaveBeenCalled();
    });
});
