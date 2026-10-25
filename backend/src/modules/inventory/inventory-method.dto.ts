import { IsString } from 'class-validator';

export class InventoryMethodDto {
  @IsString() method!: string;
}
