import { Global, Module } from '@nestjs/common';
import { CommercialPolicyService } from './commercial-policy.service';
import { CommercialPolicyController } from './commercial-policy.controller';

@Global()
@Module({
  controllers: [CommercialPolicyController],
  providers: [CommercialPolicyService],
  exports: [CommercialPolicyService],
})
export class CommercialPolicyModule {}
