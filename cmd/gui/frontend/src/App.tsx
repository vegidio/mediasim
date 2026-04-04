import { Navbar, Preview, Sidebar } from '@/components/organisms';

export const App = () => {
    return (
        <div className='flex h-screen flex-col'>
            <Navbar />
            <main className='flex flex-1 min-h-0 flex-row'>
                <div className='flex-1 relative overflow-hidden'>
                    <Preview className='h-full' />
                </div>
                <Sidebar className='w-64 h-full' />
            </main>
        </div>
    );
};
