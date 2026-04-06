import { useEffect, useRef } from 'react';
import type { TailwindProps } from '@/types/TailwindProps';
import { ComparisonGrid, ImageGrid } from '@/components/molecules';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { useAppStore, useCheckedStore, useComparisonStore, useImagesStore } from '@/stores';

export const Preview = ({ className = '' }: TailwindProps) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedDirectory = useAppStore((s) => s.selectedDirectory);
    const groups = useComparisonStore((s) => s.groups);
    const images = useImagesStore((s) => s.images);

    useClearCheckedOnViewSwitch(!!groups);

    const paths = groups ? groups.flatMap((g) => g.media.map((m) => m.path)) : images.map((i) => i.path);
    const groupSizes = groups?.map((g) => g.media.length);

    useKeyboardNavigation(containerRef, paths, groupSizes);

    return (
        <div
            ref={containerRef}
            className={`bg-[#171717] bg-[radial-gradient(#383838_1px,transparent_1px)] bg-size-[3rem_3rem] ${className}`}
        >
            {selectedDirectory && (groups ? <ComparisonGrid /> : <ImageGrid />)}
        </div>
    );
};

const useClearCheckedOnViewSwitch = (isComparisonView: boolean) => {
    const clearChecked = useCheckedStore((s) => s.clear);
    const prevRef = useRef(isComparisonView);

    useEffect(() => {
        if (prevRef.current !== isComparisonView) {
            prevRef.current = isComparisonView;
            clearChecked();
        }
    });
};
