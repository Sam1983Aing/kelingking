// Scene lighting presets. Daylight follows the photo's date; night is an authored
// moonlit view, with one lunar direction shared by the disk, shadows and reflections.
import { PHOTO_HOUR } from './sun.js';

export const TIME_OF_DAY = Object.freeze({
  morning: { label: 'Morning', hour: 8, exposure: 0.35 },
  noon: { label: 'Noon', hour: PHOTO_HOUR, exposure: 0 },
  evening: { label: 'Evening', hour: 17, exposure: 0.5 },
  night: { label: 'Night', hour: 21, exposure: 15.4,
    direction: [280, 34], strength: 0.000002, color: [0.72, 0.82, 1] },
});
export function lightingPreset(id) { return TIME_OF_DAY[id] ?? TIME_OF_DAY.noon; }
