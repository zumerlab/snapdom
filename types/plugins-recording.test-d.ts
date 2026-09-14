import gifExport, { gifExport as namedGif, type GifExportOptions } from '../packages/plugins/gif-export.js';
import videoExport, { videoExport as namedVideo, type VideoExportOptions } from '../packages/plugins/video-export.js';
import type { SnapdomPlugin } from './snapdom.js';

const gif: GifExportOptions = { frames: 3, fps: 10, scale: 2, maxColors: 64, repeat: -1 };
const video: VideoExportOptions = { duration: 500, fps: 12, bitrate: 1000000 };
const plugins: SnapdomPlugin[] = [gifExport(gif), namedGif(gif), videoExport(video), namedVideo(video)];
void plugins;
