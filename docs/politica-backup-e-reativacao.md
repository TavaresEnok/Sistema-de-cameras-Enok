# Política de backup e reativação

## Cliente ativo

- PostgreSQL local em formato custom, semanalmente, com verificação de leitura e teste de restauração.
- Retenção local rotativa: 30 dias.
- Envio externo: semanal, sem gravações, com retenção rotativa de 90 dias.
- O remote do rclone deve ser do tipo `crypt` ou apontar para armazenamento que cifre os objetos com chave gerenciada pela empresa.
- Falha local não pode remover o remoto: o processo usa `copy`; a exclusão remota ocorre apenas pelo corte explícito de 90 dias.

## Cancelamento

Na Central, em **Instalação → Manutenção → Continuidade após cancelamento**, use **Cancelar e criar arquivo final**. No heartbeat seguinte, a instalação envia um snapshot sanitizado. A Central:

1. valida a solicitação e o tamanho;
2. recusa qualquer campo de senha, token, sessão ou chave;
3. cifra com AES-256-GCM e chave exclusiva `DRAC_CENTRAL_ARCHIVE_KEY`;
4. grava o arquivo com permissão `0600`;
5. registra tamanho, SHA-256, criação e vencimento;
6. elimina automaticamente após 24 meses e preserva o certificado na auditoria.

O snapshot inclui câmeras, endereços, perfis, zonas, locais, áreas, grupos, usuários, permissões, layouts e preferências seguras. Não inclui gravações, clipes, eventos, alarmes ocorridos, investigações, biometria, sessões, dispositivos push, hashes de senha ou credenciais de câmeras/storage.

## Recontratação

**Preparar recontratação** reativa o contrato e preserva o arquivo como referência auditável. Se o servidor original ainda existe, os cadastros permanecem nele e a licença volta a ser aplicada no próximo heartbeat. Credenciais devem ser confirmadas novamente antes de habilitar câmeras.

Em uma instalação nova e vazia, a Central entrega o arquivo pelo heartbeat e o sistema recria sites, áreas, grupos, usuários, câmeras, permissões, layouts e configurações permitidas. Usuários importados voltam inativos e câmeras voltam desligadas; senhas e chaves de publicação precisam ser informadas novamente antes da ativação. Se o banco já tiver câmeras, a restauração não mistura nem sobrescreve dados e registra que o banco existente foi preservado.

## Variáveis obrigatórias no servidor mestre

```env
DRAC_CENTRAL_ARCHIVE_KEY=segredo-exclusivo-com-no-minimo-32-caracteres
DRAC_CENTRAL_ARCHIVE_DIR=/app/data/reactivation-archives
DRAC_CENTRAL_ARCHIVE_RETENTION_MONTHS=24
OFFSITE_BACKUP_RETENTION_DAYS=90
POSTGRES_BACKUP_RETENTION_DAYS=30
```

O segredo deve ficar fora do Git e ser copiado para um cofre separado. Sem ele, novos cancelamentos são recusados para evitar arquivos falsamente protegidos.

## Limites jurídicos

O prazo contratual deve informar finalidade, conteúdo, local de armazenamento e canal de exclusão. Pedido de exclusão deve ser atendido quando não houver obrigação legal/regulatória que justifique retenção. O texto contratual final deve ser aprovado pelo responsável jurídico/DPO.
