import { type RefObject, useEffect, useState } from 'react';

/**
 * Tracks the clientWidth of the referenced element, updating on resize.
 * Used by the virtualized grids to compute how many tile columns fit.
 */
export const useContainerWidth = (ref: RefObject<HTMLElement | null>) => {
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const update = () => setWidth(el.clientWidth);
        update();

        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref.current]);

    return width;
};
