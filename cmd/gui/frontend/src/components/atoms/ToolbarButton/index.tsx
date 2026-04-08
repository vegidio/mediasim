import type { ReactNode } from 'react';
import { Button, Typography } from '@mui/material';
import type { TailwindProps } from '@/types/TailwindProps.ts';

type ToolbarButtonProps = TailwindProps & {
    icon: ReactNode;
    label: string;
    onClick?: () => void;
};

export const ToolbarButton = ({ icon, label, onClick, className = '' }: ToolbarButtonProps) => {
    return (
        <Button
            color='inherit'
            size='small'
            className={`flex-col px-2 py-0 min-w-0 gap-1.5 ${className}`}
            onClick={onClick}
        >
            {icon}
            <Typography variant='caption' className='text-[11px] leading-none normal-case'>
                {label}
            </Typography>
        </Button>
    );
};
