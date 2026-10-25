

export const BACKUP_KINDS = ['DUMP', 'RESTORE_TEST'] as const;

export type BackupKind = (typeof BACKUP_KINDS)[number];
