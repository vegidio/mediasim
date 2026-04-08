import { AppBar, Button, Divider, Toolbar, Typography } from '@mui/material';
import { System } from '@wailsio/runtime';
import { Icon } from '@/components/atoms';
import { useComparisonStore } from '@/stores';

export const TopBar = () => {
    const groups = useComparisonStore((s) => s.groups);
    const clearComparison = useComparisonStore((s) => s.clear);

    return (
        <AppBar position='static'>
            <Toolbar variant='dense' className={System.IsMac() ? 'pl-21.5' : ''}>
                <Typography variant='subtitle1' fontWeight={500}>
                    MediaSim
                </Typography>

                {groups && (
                    <>
                        <Divider orientation='vertical' flexItem className='mx-2' />
                        <Button color='inherit' size='small' startIcon={<Icon name='back' />} onClick={clearComparison}>
                            Back to directory
                        </Button>
                    </>
                )}
            </Toolbar>
        </AppBar>
    );
};
