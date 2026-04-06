import { type RefObject, useEffect, useState } from 'react';
import { useSelectionStore } from '@/stores';

const TILE_WIDTH = 180;
const GAP = 16;

export const useKeyboardNavigation = (containerRef: RefObject<HTMLDivElement | null>, paths: string[]) => {
    const selectedPath = useSelectionStore((s) => s.selectedPath);
    const select = useSelectionStore((s) => s.select);
    const [colCount, setColCount] = useState(1);

    // Track column count via ResizeObserver
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const observer = new ResizeObserver(([entry]) => {
            const width = entry.contentRect.width;
            const cols = Math.max(1, Math.floor((width + GAP) / (TILE_WIDTH + GAP)));
            setColCount(cols);
        });

        observer.observe(el);
        return () => observer.disconnect();
    }, [containerRef]);

    // Keyboard navigation
    useEffect(() => {
        if (paths.length === 0) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Only handle arrow keys when no input/dialog is focused
            const active = document.activeElement;
            if (active && active !== document.body && active.tagName !== 'DIV') return;

            const arrowKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
            if (!arrowKeys.has(e.key)) return;

            e.preventDefault();

            const currentIndex = selectedPath ? paths.indexOf(selectedPath) : -1;

            let nextIndex: number;
            switch (e.key) {
                case 'ArrowLeft':
                    nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
                    break;
                case 'ArrowRight':
                    nextIndex = currentIndex < 0 ? 0 : Math.min(paths.length - 1, currentIndex + 1);
                    break;
                case 'ArrowUp':
                    nextIndex = currentIndex < 0 ? 0 : Math.max(0, currentIndex - colCount);
                    break;
                case 'ArrowDown':
                    nextIndex = currentIndex < 0 ? 0 : Math.min(paths.length - 1, currentIndex + colCount);
                    break;
                default:
                    return;
            }

            select(paths[nextIndex]);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [paths, selectedPath, select, colCount]);
};
