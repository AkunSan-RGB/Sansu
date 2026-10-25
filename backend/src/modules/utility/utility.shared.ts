import { type TariffBlock, type UtilityServiceType } from '@sansu/shared';

interface TariffRow {
  id: string;
  name: string;
  service_type: UtilityServiceType;
  unit: string;
  metered: boolean;
  fixed_fee: string;
  admin_fee: string;
  min_usage: string;
  blocks: TariffBlock[];
  vatable: boolean;
}
