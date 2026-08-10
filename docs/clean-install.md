# Instalação limpa

## Pré-requisitos

- Linux x86-64 (Ubuntu/Debian), atualizado. O instalador instala o Docker.
- 8 GB de RAM ou mais para múltiplas câmeras e IA.
- Armazenamento dimensionado para bitrate, quantidade de câmeras e retenção.
- DNS e certificado HTTPS válidos (o nginx do host é configurado à parte).

## Procedimento

São dois comandos.

```bash
cp scripts/instalacao-cliente.exemplo.env cliente.env && chmod 600 cliente.env
```

Preencha os três obrigatórios (`DRAC_INSTALLER_COMMIT`, `DRAC_CUSTOMER_NAME`,
`DRAC_CAMERA_ALLOWED_CIDRS`) — o arquivo explica cada campo — e rode:

```bash
sudo bash scripts/install-drac.sh --config cliente.env
```

O instalador não faz perguntas e não para no meio. Ao terminar ele imprime a
URL do painel, o usuário e a senha do administrador. **Se ele terminou sem
erro, dá para entrar.**

O que ele faz sozinho, e que antes era passo manual:

- clona o commit aprovado e recusa qualquer divergência;
- gera os segredos e escreve o `infra/.env`, publicando na internet **apenas**
  o que não pode passar pelo nginx (WebRTC/UDP e RTMP);
- sobe os containers e aplica as migrações;
- **cria o primeiro administrador** (se já existir usuário, não toca em nada —
  reinstalar nunca reseta a senha de quem está usando);
- agenda o watchdog **e dispara ele uma vez para confirmar que funciona**;
- registra a instalação na Central.

Qualquer passo que falhe interrompe a instalação dizendo a linha, o comando e
o motivo. Nada é declarado pronto pela metade.

## Verificação

```bash
bash scripts/verificar-instalacao.sh
```

Roda contra qualquer instalação, incluindo as que já estão em produção. Checa
containers, exposição real das portas, se o banco tem todas as tabelas do
schema, se o login funciona, se as rotas respondem (inclusive
`/role-permissions`, que já quebrou em toda instalação de cliente) e se o
watchdog reportou.

## Antes de instalar num cliente

```bash
bash scripts/teste-instalacao-limpa.sh
```

Sobe uma máquina virgem, instala do zero sem intervenção e roda a bateria
acima. É o único teste que exercita o caminho real do cliente — sem
`/home/flashnet`, sem Central já rodando, sem banco com tabelas que chegaram
por `db push`, sem portas já ligadas.

Os 12 defeitos da primeira instalação de cliente eram todos invisíveis na
máquina de quem desenvolve e todos apareceriam aqui. Ver
[relatorio-instalacao-cliente-2026-08.md](relatorio-instalacao-cliente-2026-08.md).

No CI ele roda sob demanda (`workflow_dispatch`) e nas tags de release.

## Depois

1. Cadastre uma câmera de homologação e valide live, poster, gravação,
   thumbnail e playback.
2. Troque a senha inicial do administrador e apague
   `infra/.credenciais-iniciais`.
3. Gere o app somente pela Central/agente e arquive AAB, `build-info.json` e
   `SHA256SUMS`.
