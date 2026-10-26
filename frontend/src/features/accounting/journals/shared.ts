

export type LineValue = { accountId: string; debit?: number; credit?: number; memo?: string; projectId?: string; foreignAmount?: number };

export const toLines = (lines: LineValue[]) =>
  lines.map((l) => ({
    accountId: l.accountId,
    debit: String(l.debit ?? 0),
    credit: String(l.credit ?? 0),
    memo: l.memo || undefined,
    projectId: l.projectId || undefined,
    foreignAmount: l.foreignAmount ? String(l.foreignAmount) : undefined,
  }));
