import { BadRequestException, Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { type Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { RequirePermission } from './require-permission.decorator';
import { RolePermissionsService } from './role-permissions.service';

@Controller('role-permissions')
export class RolePermissionsController {
  constructor(
    private readonly service: RolePermissionsService,
    private readonly auditService: AuditService,
  ) {}

  @Roles(UserRole.ADMIN)
  @Get()
  async getMatrix() {
    return {
      keys: this.service.permissionKeys(),
      roles: await this.service.getMatrix(),
    };
  }

  // Permissões efetivas do usuário atual — usado pelo frontend para mostrar/ocultar recursos.
  @Get('me')
  async myPermissions(@CurrentUser() user: AuthUser) {
    return {
      role: user.role,
      permissions: await this.service.getForRole(user.role),
    };
  }

  @Roles(UserRole.ADMIN)
  @RequirePermission('roleManage')
  @Patch(':role')
  async updateRole(
    @CurrentUser() actor: AuthUser,
    @Param('role') role: string,
    @Body('permissions') permissions: unknown,
    @Req() req: Request,
  ) {
    const normalizedRole = role.toUpperCase();
    if (!Object.values(UserRole).includes(normalizedRole as UserRole)) {
      throw new BadRequestException('Papel inválido.');
    }
    const updated = await this.service.updateRole(normalizedRole as UserRole, permissions);
    await this.auditService.log(actor.id, 'role-permissions.update', 'RolePermission', normalizedRole, updated, req);
    return { role: normalizedRole, permissions: updated };
  }
}
