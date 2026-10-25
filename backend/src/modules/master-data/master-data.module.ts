import { Module } from '@nestjs/common';
import { CustomersController } from './customers/customers.controller';
import { CustomersService } from './customers/customers.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { WarehousesController } from './warehouses/warehouses.controller';
import { WarehousesService } from './warehouses/warehouses.service';
import { CustomersRepository } from './customers/customers.repository';
import { WarehousesRepository } from './warehouses/warehouses.repository';
import { ProductsRepository } from './products/products.repository';

@Module({
  controllers: [ProductsController, CustomersController, WarehousesController],
  providers: [ProductsRepository, WarehousesRepository, CustomersRepository, ProductsService, CustomersService, WarehousesService],
  exports: [ProductsService, CustomersService],
})
export class MasterDataModule {}
