import { BadRequestException, Injectable } from '@nestjs/common';
import { D, Dec } from '../../../common/utils/money';
import { Tx } from '../../../db/db';
import { CreditRepository } from './credit.repository';

/**
 * Kontrol kredit pelanggan — fitur yang paling dicari distributor:
 *  1. Blokir order jika ada faktur yang sudah lewat jatuh tempo
 *  2. Blokir order jika piutang + order terbuka + order ini > limit kredit
 */
@Injectable()
export class CreditService {
  constructor(private readonly repo: CreditRepository) {}

  async assertCanOrder(tx: Tx, tenantId: string, customerId: string, orderTotal: Dec, excludeOrderId?: string) {
    const [customer] = await this.repo.findCustomersById(tx, customerId);

    const [overdue] = await this.repo.findInvoicesByCustomerIdAndStatusAndDueDate(tx, tenantId, customerId);
    if (overdue) {
      throw new BadRequestException(
        `Pelanggan ${customer.name} memiliki faktur jatuh tempo (${overdue.number}, ${overdue.dueDate}). Lunasi dahulu.`,
      );
    }

    const limit = D(customer.creditLimit);
    if (limit.isZero()) return;

    const [ar] = await this.repo.sumInvoicesByCustomerIdAndStatus(tx, tenantId, customerId);
    const [open] = await this.repo.sumSalesOrdersByCustomerIdAndStatusAndId(tx, tenantId, customerId, excludeOrderId);

    const exposure = D(ar.v).plus(open.v).plus(orderTotal);
    if (exposure.gt(limit)) {
      throw new BadRequestException(
        `Melebihi limit kredit ${customer.name}: eksposur ${exposure.toFixed(0)} > limit ${limit.toFixed(0)}`,
      );
    }
  }
}
