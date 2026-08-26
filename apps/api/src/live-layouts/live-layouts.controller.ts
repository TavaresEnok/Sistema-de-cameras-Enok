import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { CreateLiveLayoutDto } from './dto/create-live-layout.dto';
import { UpdateLiveLayoutDto } from './dto/update-live-layout.dto';
import { LiveLayoutsService } from './live-layouts.service';

@Roles(UserRole.VIEWER)
@Controller('live-layouts')
export class LiveLayoutsController {
  constructor(private readonly layouts: LiveLayoutsService) {}

  /** "Meus mosaicos": os que eu posso abrir — os meus e os que me deram. */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.layouts.list(user);
  }

  /** "Mosaicos": a tela de administração. O serviço recusa quem não é admin. */
  @Get('administrados')
  listAdmin(@CurrentUser() user: AuthUser) {
    return this.layouts.listAdmin(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLiveLayoutDto) {
    return this.layouts.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateLiveLayoutDto,
  ) {
    return this.layouts.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.layouts.remove(user, id);
  }
}
