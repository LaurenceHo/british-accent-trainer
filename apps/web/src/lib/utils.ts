export { cn } from "cn"

/**
 * A fraction as a CSS percentage, for positioning overlays on charts and waveforms.
 *
 * @param fraction - 0 to 1.
 */
export const percent = (fraction: number): string => `${(fraction * 100).toFixed(2)}%`;
