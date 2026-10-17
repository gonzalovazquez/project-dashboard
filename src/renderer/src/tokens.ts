import type { PulseLevel, Stage } from '../../shared/types.js';

/** CSS color tokens by meaning. The stage colors match the Notion board. */
export const STAGE_COLOR: Record<Stage, string> = {
  'Not started': '--gray', 'In progress': '--blue', 'Beta': '--purple', 'General Available': '--green',
};
export const PULSE_COLOR: Record<PulseLevel, string> = { Hot: '--orange', Warm: '--yellow', Cooling: '--teal', Dormant: '--gray' };
export const healthColor = (h: number) => (h >= 60 ? '--green' : h >= 40 ? '--orange' : '--red');
export const colorVar = (token: string) => ({ ['--c' as string]: `var(--${token.replace(/^--/, '')})` });
