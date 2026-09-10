import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuditModule } from '../audit/audit.module';
import { CommercialPolicyModule } from '../commercial-policy/commercial-policy.module';
import { PrismaModule } from '../common/prisma/prisma.module';
import { PlateRecognitionController } from './plate-recognition.controller';
import { PlateRecognitionService } from './plate-recognition.service';

@Module({
  imports: [PrismaModule, AccessControlModule, AuditModule, CommercialPolicyModule],
  controllers: [PlateRecognitionController],
  providers: [PlateRecognitionService],
  exports: [PlateRecognitionService],
})
export class PlateRecognitionModule {}
