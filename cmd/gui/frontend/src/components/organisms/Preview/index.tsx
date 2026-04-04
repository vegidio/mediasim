import type { TailwindProps } from '@/types/TailwindProps';

export const Preview = ({ className = '' }: TailwindProps) => {
    return (
        <div
            className={`bg-[#171717] bg-[radial-gradient(#383838_1px,transparent_1px)] bg-size-[3rem_3rem] ${className}`}
        />
    );
};
