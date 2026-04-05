import { AppBar, Button, Toolbar } from '@mui/material';
import { MdClose, MdCompare } from 'react-icons/md';
import type { TailwindProps } from '@/types/TailwindProps';
import { TileSlider } from '@/components/molecules';

type BottomBarProps = TailwindProps & {
    onClose?: () => void;
    onCompare?: () => void;
};

export const BottomBar = ({ onClose, onCompare }: BottomBarProps) => {
    return (
        <AppBar position='static' component='footer'>
            <Toolbar variant='dense' className='flex'>
                <div className='flex flex-1 justify-start'>
                    <Button color='inherit' size='small' startIcon={<MdClose />} onClick={onClose}>
                        Close
                    </Button>
                </div>

                <div className='flex flex-1 justify-center'>
                    <Button color='inherit' size='small' startIcon={<MdCompare />} onClick={onCompare}>
                        Compare
                    </Button>
                </div>

                <div className='flex flex-1 justify-end'>
                    <TileSlider />
                </div>
            </Toolbar>
        </AppBar>
    );
};
