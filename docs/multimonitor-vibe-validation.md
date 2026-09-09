# Validação multi-monitor — Vibe

Data: 2026-09-08

Escopo desta promoção: somente o frontend da instalação Vibe. Nenhum domínio,
serviço de API, banco, ingestão RTMP ou outra instalação foi alterado.

## Comportamentos validados

- A tela principal preserva uma grade 3x2 ao ampliar uma câmera e retornar.
- Os seis players permanecem montados durante a ampliação; não ocorre uma nova
  negociação coletiva ao voltar para a grade.
- A tela principal oferece três janelas auxiliares independentes.
- Tela principal e Tela auxiliar 1 foram abertas simultaneamente com grades
  3x2 e conjuntos distintos de câmeras.
- Uma câmera presente em outra tela não é duplicada por acidente. O operador
  recebe a opção explícita de movê-la para a tela atual.
- Ao abrir uma segunda instância da mesma tela, a instância anterior desmonta
  sua grade e encerra os players, evitando conexões duplicadas.
- Mensagens passivas de conexão/offline não bloqueiam o duplo clique no quadro.
- O início das negociações de vídeo é escalonado entre telas.
- A entrada no Modo Mural solicita o Fullscreen nativo do navegador por gesto
  do usuário.

## Evidências técnicas

- TypeScript do frontend: aprovado.
- Testes unitários de coordenação: 2/2 aprovados.
- Build de produção do Vite: aprovado.
- Teste automatizado em Chromium contra a URL pública da Vibe: aprovado.
- HTTPS público da Vibe: HTTP 200 e certificado válido.
- API pública: `/api/health` HTTP 200.
- Contêiner `vms-web`: healthy após recriação.

## Operação e limite

O recurso coordena até quatro janelas do mesmo navegador e perfil: uma
principal e três auxiliares. Cada tela mantém seu layout no armazenamento local
do navegador. Câmeras diferentes ainda representam streams e decodificações
reais; a capacidade máxima simultânea depende da rede, GPU e CPU da estação.

## Rollback

- Fontes anteriores: `/opt/drac/backups/multimonitor-20260908/web-sources-before.tgz`
- Imagem anterior: `infra-web:before-multimonitor-20260908`
