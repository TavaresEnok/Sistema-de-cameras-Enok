import { Module } from '@nestjs/common';
import { RondasService } from './rondas.service';
import { RondasController } from './rondas.controller';

@Module({
  controllers: [RondasController],
  providers: [RondasService],
  exports: [RondasService],
})
export class RondasModule {}
