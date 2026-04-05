import { useState } from 'react';
import { BottomBar, CompareDialog, Preview, Sidebar, TopBar, WelcomeDialog } from '@/components/organisms';
import { useAppStore, useImagesStore } from '@/stores';

export const App = () => {
    const [dialogOpen, setDialogOpen] = useState(true);
    const [compareOpen, setCompareOpen] = useState(false);
    const clearImages = useImagesStore((s) => s.clear);
    const clearSelectedDirectory = useAppStore((s) => s.clearSelectedDirectory);

    const handleDirectorySelected = (_path: string) => {
        setDialogOpen(false);
    };

    const handleClose = () => {
        clearImages();
        clearSelectedDirectory();
        setDialogOpen(true);
    };

    return (
        <div className='flex h-screen flex-col'>
            <TopBar />

            <main className='flex flex-1 min-h-0 flex-row'>
                <div className='flex-1 relative overflow-hidden'>
                    <Preview className='h-full' />
                </div>
                <Sidebar className='w-64 h-full' />
            </main>

            <BottomBar onClose={handleClose} onCompare={() => setCompareOpen(true)} />

            <CompareDialog open={compareOpen} onClose={() => setCompareOpen(false)} />
            <WelcomeDialog open={dialogOpen} onDirectorySelected={handleDirectorySelected} />
        </div>
    );
};
