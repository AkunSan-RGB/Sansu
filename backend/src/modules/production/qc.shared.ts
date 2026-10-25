import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class InspectionsQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(['PENDING', 'PASSED', 'FAILED', 'PARTIAL']) status?: string;
}
