import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BUSINESS_MODEL_KEYS } from '@sansu/shared';
import { Public } from '../../common/auth/decorators';
import { DemoService } from './demo.service';
import { StartDemoDto } from './demo.dto';

@ApiTags('Demo')
@Controller('demo')
export class DemoController {
  constructor(private readonly svc: DemoService) {}

  @Public()
  @Throttle({ default: { limit: 4, ttl: 60 * 60_000 } })
  @HttpCode(200)
  @Post('start')
  start(@Body() dto: StartDemoDto) {
    if (!BUSINESS_MODEL_KEYS.includes(dto.businessModel)) throw new BadRequestException('Jenis usaha tidak dikenal');
    return this.svc.start(dto.businessModel, dto.serviceProfile);
  }
}
