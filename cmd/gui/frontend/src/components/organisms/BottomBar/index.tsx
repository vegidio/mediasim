import { AppBar, Button, Toolbar } from '@mui/material';
import { MdAutoFixHigh, MdCheckCircleOutline, MdClose, MdCompare, MdDeleteOutline } from 'react-icons/md';
import type { TailwindProps } from '@/types/TailwindProps';
import { ToolbarButton } from '@/components/atoms';
import { TileSlider } from '@/components/molecules';
import { useComparisonStore } from '@/stores';

type BottomBarProps = TailwindProps & {
    onClose?: () => void;
    onCompare?: () => void;
};

export const BottomBar = ({ onClose, onCompare }: BottomBarProps) => {
    const groups = useComparisonStore((s) => s.groups);

    return (
        <AppBar position='static' component='footer'>
            <Toolbar variant='dense' className='flex'>
                {groups ? (
                    <>
                        <div className='flex flex-1 items-center gap-2'>
                            <ToolbarButton icon={<MdAutoFixHigh size={22} />} label='Auto Mark' />
                            <ToolbarButton icon={<MdCheckCircleOutline size={22} />} label='Mark' />
                            <ToolbarButton icon={<MdDeleteOutline size={22} />} label='Delete' />
                        </div>

                        <div className='flex flex-1' />
                    </>
                ) : (
                    <>
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
                    </>
                )}

                <div className='flex flex-1 justify-end'>
                    <TileSlider />
                </div>
            </Toolbar>
        </AppBar>
    );
};
