# Operação do perfil standard

## Rotina diária

- Confirmar status da Central, câmeras offline, disco e backup.
- Investigar alarmes técnicos recorrentes e falhas de thumbnail/playback.
- Tratar uma câmera instável antes de aumentar retenção ou habilitar IA.

## Atualização

1. Usar somente uma tag de release aprovada.
2. Executar `pnpm verify` antes do deploy.
3. Rodar `pnpm ops:update`; o script cria backup para rollback.
4. Executar readiness e regressão após a atualização.
5. Observar a instalação por pelo menos 30 minutos e validar uma câmera completa.

## Rollback e restore

- Para falha de atualização, usar o backup criado pelo `update-drac.sh`.
- Para banco, usar `pnpm ops:restore` e depois readiness/regressão.
- O restore diário automático valida o dump, mas não substitui ensaio de desastre em outro host.

## App white-label

- O agente deve responder em `http://172.17.0.1:8780/health`.
- O agente roda SOMENTE pelo serviço systemd (`drac-build-agent.service`). NUNCA
  adicionar `@reboot` no crontab para o supervisor: os dois brigam pela porta
  8780 e o perdedor entra em crash-loop infinito (incidente 10/08/2026: 3.644
  reinícios num dia, inundando o journal). O supervisor com trava
  (`run-build-agent-supervised.sh`) fica apenas como execução manual de socorro.
- Nunca publicar artefato sem hash, metadata, assinatura validada e teste interno.

## Incidente

Preservar horário, request ID, câmera, versão, logs sanitizados e ações tomadas. Nunca copiar URLs RTSP completas para tickets ou mensagens.
