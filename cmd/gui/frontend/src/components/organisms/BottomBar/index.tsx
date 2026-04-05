import { AppBar, Button, Toolbar } from '@mui/material';
import { MdClose, MdCompare } from 'react-icons/md';
import { TileSlider } from '@/components/molecules';

export const BottomBar = () => {
    return (
        <AppBar position='static' component='footer'>
            <Toolbar variant='dense' className='flex'>
                <div className='flex flex-1 justify-start'>
                    <Button color='inherit' size='small' startIcon={<MdClose />}>
                        Close
                    </Button>
                </div>

                <div className='flex flex-1 justify-center'>
                    <Button color='inherit' size='small' startIcon={<MdCompare />}>
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
