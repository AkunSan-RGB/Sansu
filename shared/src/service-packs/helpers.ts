import type { SetupGroup, SetupItemDef } from '../model-setup.js';

/** Butir pengaturan: kunci harus ada di pemeriksaan server (SETUP_PROBES) */
export const setupItem = (key: string, group: SetupGroup, title: string, why: string, link: string): SetupItemDef => ({ key, group, title, why, link });
export const BEFORE = 'BEFORE_START' as const;
export const LATER = 'RECOMMENDED' as const;
