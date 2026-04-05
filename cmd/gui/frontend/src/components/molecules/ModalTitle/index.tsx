import { Divider, IconButton, Typography } from '@mui/material';
import { MdClose } from 'react-icons/md';

type ModalTitleProps = {
    title: string;
    onClose?: () => void;
};

export const ModalTitle = ({ title, onClose }: ModalTitleProps) => {
    return (
        <div className='flex flex-col'>
            <div className='flex flex-row h-10 justify-between items-center'>
                <Typography className='text-xs font-medium ml-3 text-[#9e9e9e]'>{title}</Typography>
                {onClose && (
                    <IconButton size='small' className='mr-1 text-[#9e9e9e]' onClick={onClose}>
                        <MdClose />
                    </IconButton>
                )}
            </div>
            <Divider />
        </div>
    );
};
