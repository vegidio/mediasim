import { useEffect, useRef } from 'react';
import { GetThumbnail } from '@bindings/gui/services/mediaservice.ts';
import { useImagesStore } from '@/stores';
import { createBlobUrl } from '@/utils/image';

type ImageTileProps = {
    path: string;
    filename: string;
    blobUrl: string | null;
    loading: boolean;
};

export const ImageTile = ({ path, filename, blobUrl, loading }: ImageTileProps) => {
    const ref = useRef<HTMLDivElement>(null);
    const setThumbnail = useImagesStore((s) => s.setThumbnail);

    useEffect(() => {
        if (!ref.current || blobUrl || loading) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    observer.disconnect();

                    useImagesStore.setState((state) => {
                        const img = state.images.find((i) => i.path === path);
                        if (img) img.loading = true;
                    });

                    GetThumbnail(path, 200).then(async ([data]) => {
                        const url = await createBlobUrl(data);
                        setThumbnail(path, url);
                    });
                }
            },
            { threshold: 0.1 },
        );

        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [path, blobUrl, loading, setThumbnail]);

    return (
        <div ref={ref} className='aspect-square bg-black/30 rounded overflow-hidden flex items-center justify-center'>
            {blobUrl ? (
                <img src={blobUrl} alt={filename} className='object-cover w-full h-full' />
            ) : (
                <div className='w-8 h-8 border-2 border-gray-500 border-t-white rounded-full animate-spin' />
            )}
        </div>
    );
};
