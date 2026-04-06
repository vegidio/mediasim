import type { TailwindProps } from '@/types/TailwindProps';
import { ComparisonGrid, ImageGrid } from '@/components/molecules';
import { useAppStore, useComparisonStore } from '@/stores';

export const Preview = ({ className = '' }: TailwindProps) => {
    const selectedDirectory = useAppStore((s) => s.selectedDirectory);
    const groups = useComparisonStore((s) => s.groups);

    return (
        <div
            className={`bg-[#171717] bg-[radial-gradient(#383838_1px,transparent_1px)] bg-size-[3rem_3rem] ${className}`}
        >
            {selectedDirectory && (groups ? <ComparisonGrid /> : <ImageGrid />)}
        </div>
    );
};
