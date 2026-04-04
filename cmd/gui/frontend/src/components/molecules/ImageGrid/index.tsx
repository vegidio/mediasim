import { useEffect } from 'react';
import { ListImages } from '@bindings/changeme/services/mediaservice';
import { ImageTile } from '@/components/atoms';
import { useAppStore, useImagesStore } from '@/stores';

export const ImageGrid = () => {
    const selectedDirectory = useAppStore((s) => s.selectedDirectory);
    const images = useImagesStore((s) => s.images);
    const setImages = useImagesStore((s) => s.setImages);

    useEffect(() => {
        if (!selectedDirectory) return;

        ListImages(selectedDirectory).then((paths) => {
            setImages(paths);
        });
    }, [selectedDirectory, setImages]);

    return (
        <div className='overflow-y-auto h-full p-4'>
            <div className='grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3'>
                {images.map((entry) => (
                    <ImageTile
                        key={entry.path}
                        path={entry.path}
                        filename={entry.filename}
                        blobUrl={entry.blobUrl}
                        loading={entry.loading}
                    />
                ))}
            </div>
        </div>
    );
};
