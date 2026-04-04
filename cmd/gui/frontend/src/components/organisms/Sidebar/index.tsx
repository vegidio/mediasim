import type { TailwindProps } from '@/types/TailwindProps';

export const Sidebar = ({ className = '' }: TailwindProps) => {
    return <div className={`bg-[#272727] ${className}`} />;
};
