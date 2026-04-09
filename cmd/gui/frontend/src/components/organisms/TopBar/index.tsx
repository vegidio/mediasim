import { useEffect, useState } from 'react';
import { AppBar, Button, Divider, Toolbar, Typography } from '@mui/material';
import { IsOutdated } from '@bindings/gui/services/appservice.js';
import { Browser, System } from '@wailsio/runtime';
import { Icon } from '@/components/atoms';
import { AboutDialog } from '@/components/molecules';
import { useComparisonStore, useImagesStore } from '@/stores';
import { VERSION } from '@/utils/constants';
import { formatFileSize } from '@/utils/format';

export const TopBar = () => {
    const groups = useComparisonStore((s) => s.groups);
    const clearComparison = useComparisonStore((s) => s.clear);
    const images = useImagesStore((s) => s.images);

    const [openAbout, setOpenAbout] = useState(false);
    const [updateAvailable, setUpdateAvailable] = useState(false);

    useEffect(() => {
        IsOutdated().then(setUpdateAvailable);
    }, []);

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
        <>
            <AppBar position='static'>
                <Toolbar variant='dense' className={`relative pt-1 ${System.IsMac() ? 'pl-21.5' : ''}`}>
                    {/* Left side */}
                    <div className='flex flex-row items-center grow'>
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
                    </div>

                    {centerText && (
                        <Typography
                            variant='body2'
                            color='text.secondary'
                            className='absolute left-1/2 -translate-x-1/2'
                        >
                            {centerText}
                        </Typography>
                    )}

                    {/* Right side */}
                    <div className='flex flex-row items-center gap-3'>
                        <Button size='small' className='normal-case text-[#b0b0b0]' onClick={() => setOpenAbout(true)}>
                            About
                        </Button>

                        <Typography variant='caption' className='text-[#545454]'>
                            v{VERSION}
                        </Typography>

                        {updateAvailable && (
                            <Button
                                variant='contained'
                                size='small'
                                className='ml-1 normal-case font-normal animate-pulse bg-[#009aff] hover:bg-[#007eff] text-[#f2f2f2]'
                                onClick={() => Browser.OpenURL('https://github.com/vegidio/mediasim/releases')}
                            >
                                Update Available
                            </Button>
                        )}
                    </div>
                </Toolbar>
            </AppBar>

            {openAbout && <AboutDialog open onClose={() => setOpenAbout(false)} />}
        </>
    );
};
