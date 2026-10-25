import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthUser } from '../../../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../../../common/auth/decorators';
import { appUrl } from '../../../common/mail/mail.service';
import { MarketplaceSyncService } from './sync.service';
import { StartConnectionDto, UpdateConnectionDto } from './sync.dto';

@ApiTags('Integrasi')
@ApiBearerAuth()
@Roles('ADMIN', 'FINANCE', 'ACCOUNTANT')
@Controller('integrations/marketplace')
export class MarketplaceSyncController {
  constructor(private readonly svc: MarketplaceSyncService) {}

  @Get('providers')
  providers() {
    return this.svc.providers();
  }
  @Get('connections')
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.tenantId);
  }
  @Post('connections')
  @Roles('ADMIN', 'FINANCE')
  start(@CurrentUser() u: AuthUser, @Body() dto: StartConnectionDto) {
    return this.svc.start(u, dto);
  }
  @Patch('connections/:id')
  @Roles('ADMIN', 'FINANCE')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConnectionDto) {
    return this.svc.update(u, id, dto);
  }
  @Delete('connections/:id')
  @Roles('ADMIN', 'FINANCE')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(u, id);
  }
  @HttpCode(200)
  @Post('connections/:id/sync')
  @Roles('ADMIN', 'FINANCE')
  sync(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.syncNow(u, id);
  }

}

/** Marketplace mengarahkan browser ke sini setelah pemilik toko memberi izin (tanpa login; diverifikasi lewat state bertanda tangan) */
@ApiTags('Integrasi')
@Public()
@Controller('integrations/marketplace')
export class MarketplaceOAuthController {
  constructor(private readonly svc: MarketplaceSyncService) {}

  @Get('oauth/:provider/callback')
  async callback(@Param('provider') provider: string, @Query() q: Record<string, string>, @Res() res: Response) {
    try {
      const c = await this.svc.callback(provider, q);
      res.redirect(`${appUrl()}/integrations?tab=sync&connected=${encodeURIComponent(c.shopName)}`);
    } catch (e) {
      res.redirect(`${appUrl()}/integrations?tab=sync&error=${encodeURIComponent((e as Error).message)}`);
    }
  }
}
