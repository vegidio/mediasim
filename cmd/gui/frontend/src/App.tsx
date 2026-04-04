import { useState } from 'react';
import { Navbar, Preview, Sidebar, WelcomeDialog } from '@/components/organisms';

export const App = () => {
    const [dialogOpen, setDialogOpen] = useState(true);

    const handleDirectorySelected = (_path: string) => {
        setDialogOpen(false);
    };

    return (
        <div className='flex h-screen flex-col'>
            <Navbar />
            <main className='flex flex-1 min-h-0 flex-row'>
                <div className='flex-1 relative overflow-hidden'>
                    <Preview className='h-full' />
                </div>
                <Sidebar className='w-64 h-full' />
            </main>

            <WelcomeDialog open={dialogOpen} onDirectorySelected={handleDirectorySelected} />
        </div>
    );
};
