import { Module } from '@nestjs/common';
import { LiveLayoutsModule } from '../live-layouts/live-layouts.module';
import { RondasService } from './rondas.service';
import { RondasController } from './rondas.controller';

@Module({
  imports: [LiveLayoutsModule],
  controllers: [RondasController],
  providers: [RondasService],
  exports: [RondasService],
})
export class RondasModule {}
