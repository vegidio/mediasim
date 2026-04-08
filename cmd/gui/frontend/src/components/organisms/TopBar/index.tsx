import { AppBar, Button, Divider, Toolbar, Typography } from '@mui/material';
import { System } from '@wailsio/runtime';
import { Icon } from '@/components/atoms';
import { useComparisonStore, useImagesStore } from '@/stores';
import { formatFileSize } from '@/utils/format';

export const TopBar = () => {
    const groups = useComparisonStore((s) => s.groups);
    const clearComparison = useComparisonStore((s) => s.clear);
    const images = useImagesStore((s) => s.images);

    const centerText = (() => {
        if (groups) {
            const mediaCount = groups.flatMap((g) => g.media).length;
            return `${mediaCount} files in ${groups.length} groups`;
        }

        if (images.length > 0) {
            const totalSize = images.reduce((sum, img) => sum + (img.fileSize ?? 0), 0);
            return `${images.length} files (${formatFileSize(totalSize)})`;
        }

        return undefined;
    })();

    return (
        <AppBar position='static'>
            <Toolbar variant='dense' className={`relative pt-1 ${System.IsMac() ? 'pl-21.5' : ''}`}>
                <Typography variant='subtitle1' fontWeight={500}>
                    MediaSim
                </Typography>

                {groups && (
                    <>
                        <Divider orientation='vertical' variant='middle' flexItem className='ml-5 mr-2' />

                        <Button
                            size='small'
                            startIcon={<Icon name='back' />}
                            sx={{ color: 'text.secondary' }}
                            className='normal-case'
                            onClick={clearComparison}
                        >
                            Back to directory
                        </Button>
                    </>
                )}

                {centerText && (
                    <Typography variant='body2' color='text.secondary' className='absolute left-1/2 -translate-x-1/2'>
                        {centerText}
                    </Typography>
                )}
            </Toolbar>
        </AppBar>
    );
};
