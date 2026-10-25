import type { CustomerDeposit, Invoice, Project, ProjectCost, ProjectProgress } from '@sansu/shared';

export const STATUS: Record<Project['status'], { label: string; color: string }> = {
  ACTIVE: { label: 'Berjalan', color: 'blue' },
  DONE: { label: 'Selesai', color: 'green' },
  CANCELLED: { label: 'Dibatalkan', color: 'default' },
};

export type ProjectDetail = Project & {
  invoices: Invoice[];
  depositList: CustomerDeposit[];
  progress: ProjectProgress[];
  costs: ProjectCost[];
};
