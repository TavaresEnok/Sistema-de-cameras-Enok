import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { LiveLayoutsController } from './live-layouts.controller';
import { LiveLayoutsService } from './live-layouts.service';

@Module({
  imports: [AccessControlModule],
  controllers: [LiveLayoutsController],
  providers: [LiveLayoutsService],
  exports: [LiveLayoutsService],
})
export class LiveLayoutsModule {}
