import { type ProductionStatus } from '@sansu/shared';

export const COLOR: Record<ProductionStatus, string> = {
  DRAFT: 'default',
  IN_PROGRESS: 'gold',
  COMPLETED: 'green',
  CANCELLED: 'red',
};
