import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/decorators';
import { HealthService } from './health.service';

/** Dipakai Docker / load balancer untuk memeriksa API dan koneksi database. */
@ApiTags('Sistem')
@Controller('health')
export class HealthController {
  constructor(private readonly svc: HealthService) {}

  @Public()
  @Get()
  check() {
    return this.svc.check();
  }
}
