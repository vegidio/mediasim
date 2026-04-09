import { Version } from '@bindings/gui/services/appservice.js';

export const VERSION = await Version();
export const TILE_GAP = 16;
export const TILE_MIN_SIZE = 180;
export const VIDEO_EXTENSIONS = new Set(['.avi', '.m4v', '.mp4', '.mkv', '.mov', '.webm', '.wmv']);
