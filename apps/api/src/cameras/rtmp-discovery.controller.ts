import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { type Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { type AuthUser } from '../common/types/auth-user.type';
import { RequirePermission } from '../role-permissions/require-permission.decorator';
import { AuditService } from '../audit/audit.service';
import { RtmpDiscoveryService } from './rtmp-discovery.service';

@Controller('cameras/rtmp-discovery')
@Roles(UserRole.ADMIN)
@RequirePermission('cameraConfig')
export class RtmpDiscoveryController {
  constructor(private readonly discovery: RtmpDiscoveryService, private readonly audit: AuditService) {}
  @Get('list') list() { return this.discovery.list(); }
  @Post('ignore') async ignore(@CurrentUser() user: AuthUser, @Body() body: { path?: string; undo?: boolean }) {
    const result = await this.discovery.ignore(body.path, user.id, body.undo === true);
    await this.audit.log(user.id, body.undo === true ? 'rtmp.discovery.restore' : 'rtmp.discovery.ignore', 'Camera');
    return result;
  }
  @Post('preview') async start(@CurrentUser() user: AuthUser, @Body() body: { path?: string }) {
    const result = await this.discovery.start(body.path, user.id);
    await this.audit.log(user.id, 'rtmp.discovery.preview', 'Camera');
    return result;
  }
  @Post('stop') stop(@CurrentUser() user: AuthUser, @Body() body: { id?: string }) { return this.discovery.stop(user.id, body.id); }
  @Get('frame') async frame(@CurrentUser() user: AuthUser, @Query('id') id: string | undefined, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const frame = await this.discovery.frame(user.id, id);
    if (!frame) return res.status(204).end();
    return res.type('image/jpeg').send(frame);
  }
}
