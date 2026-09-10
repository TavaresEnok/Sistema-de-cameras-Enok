import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ServiceTokenGuard } from '../auth/guards/service-token.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { RequirePermission } from '../role-permissions/require-permission.decorator';
import { PlateRecognitionService } from './plate-recognition.service';

@Controller('plate-recognition')
export class PlateRecognitionController {
  constructor(private readonly service: PlateRecognitionService, private readonly audit: AuditService) {}
  @Roles(UserRole.VIEWER) @Get('summary') summary(@CurrentUser() user: AuthUser) { return this.service.summary(user); }
  @Roles(UserRole.VIEWER) @Get('cameras') cameras(@CurrentUser() user: AuthUser) { return this.service.cameras(user); }
  @Roles(UserRole.VIEWER) @Get('reads') reads(@CurrentUser() user: AuthUser, @Query() query: Record<string, unknown>) { return this.service.reads(user, query); }
  @Roles(UserRole.VIEWER) @Get('lists') lists(@Query('kind') kind?: string) { return this.service.listEntries(kind); }
  @Roles(UserRole.ADMIN) @RequirePermission('cameraConfig') @Patch('cameras/:cameraId') async camera(@CurrentUser() user: AuthUser, @Param('cameraId') id: string, @Body() dto: Record<string, unknown>, @Req() req: Request) { const result = await this.service.setCamera(id, dto, user); await this.audit.log(user.id, 'plate_recognition.camera_configured', 'Camera', id, { enabled: result.plateRecognitionEnabled }, req); return result; }
  @Roles(UserRole.ADMIN) @RequirePermission('cameraConfig') @Post('lists') async create(@CurrentUser() user: AuthUser, @Body() dto: Record<string, unknown>, @Req() req: Request) { const result = await this.service.createEntry(dto); await this.audit.log(user.id, 'plate_recognition.list_created', 'PlateListEntry', result.id, { kind: result.kind, plate: result.plateNormalized }, req); return result; }
  @Roles(UserRole.ADMIN) @RequirePermission('cameraConfig') @Delete('lists/:id') async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) { const result = await this.service.deleteEntry(id); await this.audit.log(user.id, 'plate_recognition.list_deleted', 'PlateListEntry', id, {}, req); return result; }
  @Public() @UseGuards(ServiceTokenGuard) @Post('internal/:cameraId/reads') internal(@Param('cameraId') id: string, @Body() dto: Record<string, unknown>) { return this.service.registerInternal(id, dto); }
}
