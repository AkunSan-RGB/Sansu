import { type ReadingFlag, type UtilityConnectionStatus, type UtilityReadingStatus, type UtilityServiceType } from '@sansu/shared';
import dayjs from 'dayjs';

export const STATUS_COLOR: Record<UtilityConnectionStatus, string> = { ACTIVE: 'green', SUSPENDED: 'orange', DISCONNECTED: 'default' };

export const READ_COLOR: Record<UtilityReadingStatus, string> = { ENTERED: 'gold', VERIFIED: 'blue', BILLED: 'green', REJECTED: 'red' };

export const thisMonth = () => dayjs().format('YYYY-MM');

export interface Tariff { id: string; name: string; serviceType: UtilityServiceType; unit: string; metered: boolean; fixedFee: string; adminFee: string; minUsage: string; blocks: { upTo: number | null; price: number }[]; vatable: boolean; isActive: boolean; connections: number }

export interface Connection { id: string; number: string; status: UtilityConnectionStatus; meterNo: string | null; address: string; installedAt: string; statusNote: string | null; customerName: string; tariffName: string; serviceType: UtilityServiceType; unit: string; metered: boolean; lastReading: string | null; lastPeriod: string | null; zone?: string | null }

export interface Reading { id: string; period: string; previous: string; current: string; usage: string; status: UtilityReadingStatus; flags: ReadingFlag[]; meterReplaced: boolean; note: string | null; verifyNote: string | null; connectionNumber: string; meterNo: string | null; customerName: string; unit: string; enteredByName: string | null; enteredById: string; verifiedByName: string | null; source?: string; hasPhoto?: boolean }
