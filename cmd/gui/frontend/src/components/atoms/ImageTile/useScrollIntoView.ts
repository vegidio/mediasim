import { type RefObject, useEffect } from 'react';
import { TILE_GAP } from '@/utils/constants';

export const useScrollIntoView = (ref: RefObject<HTMLDivElement | null>, active: boolean) => {
    useEffect(() => {
        if (!active || !ref.current) return;

        const el = ref.current;
        let container = el.parentElement;
        while (container) {
            const overflow = getComputedStyle(container).overflowY;
            if (overflow === 'auto' || overflow === 'scroll') break;
            container = container.parentElement;
        }
        if (!container) return;

        const tileRect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        if (tileRect.bottom > containerRect.bottom) {
            container.scrollBy({ top: tileRect.bottom - containerRect.bottom + TILE_GAP, behavior: 'smooth' });
        } else if (tileRect.top < containerRect.top) {
            container.scrollBy({ top: tileRect.top - containerRect.top - TILE_GAP, behavior: 'smooth' });
        }
    }, [active, ref.current]);
};
