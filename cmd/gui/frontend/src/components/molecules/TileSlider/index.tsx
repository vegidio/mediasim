import { IconButton, Slider } from '@mui/material';
import { Icon } from '@/components/atoms';
import { useAppStore } from '@/stores';
import { TILE_MIN_SIZE } from '@/utils/constants.ts';

const TILE_MAX_SIZE = 360;

export const TileSlider = () => {
    const tileSize = useAppStore((s) => s.tileSize);
    const setTileSize = useAppStore((s) => s.setTileSize);

    const handleTileChange = (_: Event, value: number | number[]) => {
        setTileSize(value as number);
    };

    const handleZoomIn = () => {
        setTileSize(Math.min(tileSize + 10, TILE_MAX_SIZE));
    };

    const handleZoomOut = () => {
        setTileSize(Math.max(tileSize - 10, TILE_MIN_SIZE));
    };

    return (
        <div className='flex items-center gap-1'>
            <IconButton color='inherit' size='small' disableRipple onClick={handleZoomOut}>
                <Icon name='zoom-out' />
            </IconButton>

            <Slider
                className='w-24'
                size='small'
                min={TILE_MIN_SIZE}
                max={TILE_MAX_SIZE}
                step={10}
                value={tileSize}
                onChange={handleTileChange}
                valueLabelDisplay='auto'
                valueLabelFormat={(value) => `${value} px`}
                slotProps={{ thumb: { style: { boxShadow: 'none' } } }}
            />

            <IconButton color='inherit' size='small' disableRipple onClick={handleZoomIn}>
                <Icon name='zoom-in' />
            </IconButton>
        </div>
    );
};
