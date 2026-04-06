import { useState } from 'react';
import {
    BottomBar,
    CompareDialog,
    Preview,
    ProgressDialog,
    Sidebar,
    TopBar,
    WelcomeDialog,
} from '@/components/organisms';
import { useAppStore, useComparisonStore, useImagesStore } from '@/stores';

export const App = () => {
    const [dialogOpen, setDialogOpen] = useState(true);
    const [compareOpen, setCompareOpen] = useState(false);
    const [progressOpen, setProgressOpen] = useState(false);
    const clearComparison = useComparisonStore((s) => s.clear);
    const clearImages = useImagesStore((s) => s.clear);
    const clearSelectedDirectory = useAppStore((s) => s.clearSelectedDirectory);
    const selectedDirectory = useAppStore((s) => s.selectedDirectory);

    const handleDirectorySelected = (_path: string) => {
        setDialogOpen(false);
    };

    const handleClose = () => {
        clearComparison();
        clearImages();
        clearSelectedDirectory();
        setDialogOpen(true);
    };

    const handleCompareStart = () => {
        setCompareOpen(false);
        setProgressOpen(true);
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

            <CompareDialog open={compareOpen} onClose={() => setCompareOpen(false)} onStart={handleCompareStart} />
            <ProgressDialog
                open={progressOpen}
                directory={selectedDirectory ?? ''}
                onClose={() => setProgressOpen(false)}
            />
            <WelcomeDialog open={dialogOpen} onDirectorySelected={handleDirectorySelected} />
        </div>
    );
};
