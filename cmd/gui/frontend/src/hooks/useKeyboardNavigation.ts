import { type RefObject, useEffect, useState } from 'react';
import { usePreviewStore, useSelectionStore } from '@/stores';
import { GAP, TILE_WIDTH, VIDEO_EXTENSIONS } from '@/utils/constants';

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

// Returns the flat index where a given group starts in the paths array.
// e.g. for groupSizes [5, 3, 8], group 0 starts at 0, group 1 at 5, group 2 at 8.
function getGroupStart(groupIndex: number, groupSizes: number[]): number {
    let start = 0;
    for (let i = 0; i < groupIndex; i++) start += groupSizes[i];
    return start;
}

// Determines which group a flat index belongs to and where that group starts.
// Walks through groupSizes accumulating offsets until the index falls within a group's range.
function findGroup(index: number, groupSizes: number[]): { groupIndex: number; groupStart: number } {
    let groupStart = 0;

    for (let i = 0; i < groupSizes.length; i++) {
        if (index < groupStart + groupSizes[i]) return { groupIndex: i, groupStart };
        groupStart += groupSizes[i];
    }

    return { groupIndex: groupSizes.length - 1, groupStart };
}

// Computes the next flat index when navigating up or down in the grid.
// In flat mode (no groups), it simply jumps one row up/down with clamping.
// In grouped mode, it preserves the column position and handles crossing group boundaries,
// landing on the same column in the first/last row of the adjacent group.
function navigateVertical(
    currentIndex: number,
    direction: 1 | -1,
    colCount: number,
    totalItems: number,
    groupSizes?: number[],
): number {
    // Flat grid: jump one row in the given direction, clamped to valid bounds
    if (!groupSizes) {
        const target = currentIndex + direction * colCount;
        return Math.max(0, Math.min(totalItems - 1, target));
    }

    // Grouped grid: resolve current position within its group
    const { groupIndex, groupStart } = findGroup(currentIndex, groupSizes);
    const posInGroup = currentIndex - groupStart;
    const col = posInGroup % colCount;
    const row = Math.floor(posInGroup / colCount);
    const totalRows = Math.ceil(groupSizes[groupIndex] / colCount);

    const newRow = row + direction;

    // Target row is still within the same group
    if (newRow >= 0 && newRow < totalRows) {
        const target = groupStart + newRow * colCount + col;
        // Clamp to last item in case the last row is not fully filled
        return Math.min(target, groupStart + groupSizes[groupIndex] - 1);
    }

    // Target row is outside the current group; attempt to cross into the adjacent group
    const nextGroupIndex = groupIndex + direction;
    if (nextGroupIndex < 0 || nextGroupIndex >= groupSizes.length) {
        return currentIndex; // Already at the first/last group, no movement
    }

    const nextGroupStart = getGroupStart(nextGroupIndex, groupSizes);

    // Moving down: land on the same column in the first row of the next group
    if (direction > 0) {
        return Math.min(nextGroupStart + col, nextGroupStart + groupSizes[nextGroupIndex] - 1);
    }

    // Moving up: land on the same column in the last row of the previous group
    const prevTotalRows = Math.ceil(groupSizes[nextGroupIndex] / colCount);
    const target = nextGroupStart + (prevTotalRows - 1) * colCount + col;
    return Math.min(target, nextGroupStart + groupSizes[nextGroupIndex] - 1);
}

export const useKeyboardNavigation = (
    containerRef: RefObject<HTMLDivElement | null>,
    paths: string[],
    groupSizes?: number[],
) => {
    const selectedPath = useSelectionStore((s) => s.selectedPath);
    const select = useSelectionStore((s) => s.select);
    const openPreview = usePreviewStore((s) => s.openPreview);
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
            const active = document.activeElement;
            if (active && active !== document.body && active.tagName !== 'DIV') return;

            if (e.key === 'Enter') {
                if (!selectedPath) return;
                const ext = selectedPath.slice(selectedPath.lastIndexOf('.')).toLowerCase();
                if (!VIDEO_EXTENSIONS.has(ext)) openPreview(selectedPath);
                return;
            }

            if (!ARROW_KEYS.has(e.key)) return;

            e.preventDefault();

            const currentIndex = selectedPath ? paths.indexOf(selectedPath) : -1;
            let nextIndex: number;

            if (e.key === 'ArrowLeft') {
                nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
            } else if (e.key === 'ArrowRight') {
                nextIndex = currentIndex < 0 ? 0 : Math.min(paths.length - 1, currentIndex + 1);
            } else if (currentIndex < 0) {
                nextIndex = 0;
            } else {
                const direction = e.key === 'ArrowDown' ? 1 : -1;
                nextIndex = navigateVertical(currentIndex, direction, colCount, paths.length, groupSizes);
            }

            select(paths[nextIndex]);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [paths, selectedPath, select, openPreview, colCount, groupSizes]);
};
