import type { ReactNode } from 'react';
import { Button, Typography } from '@mui/material';

type ToolbarButtonProps = {
    icon: ReactNode;
    label: string;
    onClick?: () => void;
};

export const ToolbarButton = ({ icon, label, onClick }: ToolbarButtonProps) => {
    return (
        <Button color='inherit' size='small' className='flex-col py-0 min-w-0 gap-1.5' onClick={onClick}>
            {icon}
            <Typography variant='caption' className='text-[10px] leading-none'>
                {label}
            </Typography>
        </Button>
    );
};
