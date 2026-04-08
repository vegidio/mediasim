import { AppBar, Button, Toolbar } from '@mui/material';
import type { TailwindProps } from '@/types/TailwindProps';
import { Icon, ToolbarButton } from '@/components/atoms';
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
                            <ToolbarButton icon={<Icon name='auto-mark' size={22} />} label='Auto Mark' />
                            <ToolbarButton icon={<Icon name='mark' size={22} />} label='Mark' />
                            <ToolbarButton icon={<Icon name='delete' size={22} />} label='Delete' />
                        </div>

                        <div className='flex flex-1' />
                    </>
                ) : (
                    <>
                        <div className='flex flex-1 justify-start'>
                            <Button color='inherit' size='small' startIcon={<Icon name='close' />} onClick={onClose}>
                                Close
                            </Button>
                        </div>

                        <div className='flex flex-1 justify-center'>
                            <Button
                                color='inherit'
                                size='small'
                                startIcon={<Icon name='compare' />}
                                onClick={onCompare}
                            >
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
