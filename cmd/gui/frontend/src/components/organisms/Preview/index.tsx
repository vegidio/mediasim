import type { TailwindProps } from '@/types/TailwindProps';
import { ImageGrid } from '@/components/molecules';
import { useAppStore } from '@/stores';

export const Preview = ({ className = '' }: TailwindProps) => {
    const selectedDirectory = useAppStore((s) => s.selectedDirectory);

    return (
        <div
            className={`bg-[#171717] bg-[radial-gradient(#383838_1px,transparent_1px)] bg-size-[3rem_3rem] ${className}`}
        >
            {selectedDirectory && <ImageGrid />}
        </div>
    );
};
