import { type RefObject, useEffect, useState } from 'react';
import { useSelectionStore } from '@/stores';

const TILE_WIDTH = 180;
const GAP = 16;

export const useKeyboardNavigation = (
    containerRef: RefObject<HTMLDivElement | null>,
    paths: string[],
    groupSizes?: number[],
) => {
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
                case 'ArrowDown': {
                    if (currentIndex < 0) {
                        nextIndex = 0;
                        break;
                    }

                    const direction = e.key === 'ArrowDown' ? 1 : -1;

                    if (!groupSizes) {
                        // Flat grid: simple row jump
                        const target = currentIndex + direction * colCount;
                        nextIndex = Math.max(0, Math.min(paths.length - 1, target));
                        break;
                    }

                    // Group-aware navigation
                    let groupStart = 0;
                    let groupIndex = 0;
                    for (let i = 0; i < groupSizes.length; i++) {
                        if (currentIndex < groupStart + groupSizes[i]) {
                            groupIndex = i;
                            break;
                        }
                        groupStart += groupSizes[i];
                    }

                    const posInGroup = currentIndex - groupStart;
                    const col = posInGroup % colCount;
                    const row = Math.floor(posInGroup / colCount);
                    const totalRows = Math.ceil(groupSizes[groupIndex] / colCount);

                    const newRow = row + direction;
                    if (newRow >= 0 && newRow < totalRows) {
                        // Stay within the same group
                        const target = groupStart + newRow * colCount + col;
                        nextIndex = Math.min(target, groupStart + groupSizes[groupIndex] - 1);
                    } else {
                        // Cross to adjacent group
                        const nextGroupIndex = groupIndex + direction;
                        if (nextGroupIndex < 0 || nextGroupIndex >= groupSizes.length) {
                            nextIndex = currentIndex;
                            break;
                        }

                        let nextGroupStart = 0;
                        for (let i = 0; i < nextGroupIndex; i++) nextGroupStart += groupSizes[i];

                        if (direction > 0) {
                            // Down: go to same column in first row of next group
                            nextIndex = Math.min(nextGroupStart + col, nextGroupStart + groupSizes[nextGroupIndex] - 1);
                        } else {
                            // Up: go to same column in last row of previous group
                            const prevTotalRows = Math.ceil(groupSizes[nextGroupIndex] / colCount);
                            const target = nextGroupStart + (prevTotalRows - 1) * colCount + col;
                            nextIndex = Math.min(target, nextGroupStart + groupSizes[nextGroupIndex] - 1);
                        }
                    }
                    break;
                }
                default:
                    return;
            }

            select(paths[nextIndex]);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [paths, selectedPath, select, colCount]);
};
