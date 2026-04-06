import { basename } from 'pathe';
import { ImageTile } from '@/components/atoms';
import { useComparisonStore, useImagesStore } from '@/stores';

export const ComparisonGrid = () => {
    const groups = useComparisonStore((s) => s.groups);
    const images = useImagesStore((s) => s.images);

    if (!groups) return undefined;

    return (
        <div className='overflow-y-auto h-full p-4'>
            {groups.map((group, index) => (
                <div key={index} className='mb-6'>
                    <h3 className='text-sm font-medium text-gray-300 mb-2'>Group {index + 1}</h3>
                    <div className='grid grid-cols-[repeat(auto-fill,180px)] gap-3'>
                        {group.media.map((media) => {
                            const cached = images.find((img) => img.path === media.path);
                            return (
                                <ImageTile
                                    key={media.path}
                                    path={media.path}
                                    filename={basename(media.path)}
                                    dataUrl={cached?.dataUrl}
                                    loading={cached?.loading ?? false}
                                    modTime={cached?.modTime}
                                    fileSize={media.size}
                                    width={cached?.width ?? media.width}
                                    height={cached?.height ?? media.height}
                                />
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
};
