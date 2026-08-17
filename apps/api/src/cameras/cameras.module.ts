// INSTÂNCIA ÚNICA, de propósito.
//
// Declarar este provider em DOIS módulos faz o Nest criar DUAS instâncias: o
// camera-stream gravava as tentativas numa e a tela de câmeras lia da outra,
// sempre vazia. O sintoma era cruel — tudo "funcionando", lista sempre vazia,
// e nenhum teste unitário pega porque cada um instancia o seu.
//
// Fica só aqui e é exportado; o camera-stream já importa este módulo.
import { PendingIngestRegistry } from './pending-ingest.registry';
import { forwardRef, Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AlarmsModule } from '../alarms/alarms.module';
import { AuditModule } from '../audit/audit.module';
import { RecordingsModule } from '../recordings/recordings.module';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { PortCheckerService } from '../common/network/port-checker.service';
import { OnvifEventsService } from './onvif-events.service';
import { IntelbrasEventsService } from './intelbras-events.service';
import { RtmpIngestSourceService } from './rtmp-ingest-source.service';

@Module({
  imports: [AuditModule, AccessControlModule, AlarmsModule, forwardRef(() => RecordingsModule)],
  controllers: [CamerasController],
  providers: [PendingIngestRegistry, RtmpIngestSourceService, CamerasService, CryptoService, PortCheckerService, OnvifEventsService, IntelbrasEventsService],
  exports: [PendingIngestRegistry, RtmpIngestSourceService, CamerasService, CryptoService, PortCheckerService, OnvifEventsService, IntelbrasEventsService],
})
export class CamerasModule {}
