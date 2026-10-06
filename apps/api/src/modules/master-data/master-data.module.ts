import { Module } from '@nestjs/common';
import { CustomersController } from './customers/customers.controller';
import { CustomersService } from './customers/customers.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { WarehousesController, WarehousesService } from './warehouses/warehouses';

@Module({
  controllers: [ProductsController, CustomersController, WarehousesController],
  providers: [ProductsService, CustomersService, WarehousesService],
  exports: [ProductsService, CustomersService],
})
export class MasterDataModule {}
