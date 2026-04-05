import { useState } from 'react';
import { BottomBar, Preview, Sidebar, TopBar, WelcomeDialog } from '@/components/organisms';

export const App = () => {
    const [dialogOpen, setDialogOpen] = useState(true);

    const handleDirectorySelected = (_path: string) => {
        setDialogOpen(false);
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

            <BottomBar />

            <WelcomeDialog open={dialogOpen} onDirectorySelected={handleDirectorySelected} />
        </div>
    );
};
