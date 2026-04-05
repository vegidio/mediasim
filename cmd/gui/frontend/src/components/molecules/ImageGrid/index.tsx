import { useEffect } from 'react';
import { ListMedia } from '@bindings/gui/services/mediaservice';
import { ImageTile } from '@/components/atoms';
import { useAppStore, useImagesStore } from '@/stores';

export const ImageGrid = () => {
    const selectedDirectory = useAppStore((s) => s.selectedDirectory);
    const images = useImagesStore((s) => s.images);
    const setImages = useImagesStore((s) => s.setImages);

    useEffect(() => {
        if (!selectedDirectory) return;

        ListMedia(selectedDirectory).then((mediaInfos) => {
            setImages(mediaInfos);
        });
    }, [selectedDirectory, setImages]);

    return (
        <div className='overflow-y-auto h-full p-4'>
            <div className='grid grid-cols-[repeat(auto-fill,180px)] gap-3 justify-center'>
                {images.map((entry) => (
                    <ImageTile
                        key={entry.path}
                        path={entry.path}
                        filename={entry.filename}
                        dataUrl={entry.dataUrl}
                        loading={entry.loading}
                        modTime={entry.modTime}
                        fileSize={entry.fileSize}
                        width={entry.width}
                        height={entry.height}
                    />
                ))}
            </div>
        </div>
    );
};
