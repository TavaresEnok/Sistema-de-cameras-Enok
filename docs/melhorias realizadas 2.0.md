# Melhorias realizadas 2.0 — DRAC VMS

> Registro completo das **202 melhorias** entregues na branch `fix/auditoria-completa`.
> Cada item veio de um commit real, medido ou testado antes de entrar aqui.
> Organizado por frente do sistema. Nada foi omitido — as 11 frentes abaixo cobrem os 202 registros.

**O sistema em uma linha:** DRAC é um VMS (videomonitoramento). API NestJS+Prisma (`apps/api`), web React+Zustand (`apps/web`), app Expo/HLS (`apps/mobile`), painel mestre Central em JS puro (`apps/central`), IA em Python (`services/ai-service-python`), mídia via MediaMTX+FFmpeg, ingestão RTMP via SRS. GPU NVIDIA RTX Blackwell para transcode (NVENC) e IA (ONNX Runtime CUDA). 1 cliente real instalado (D-GUARDIAN, VM separada).

---

## 1. Placas de vídeo (GPU / NVENC / IA na placa)

- **GPU ausente derrubava o sistema INTEIRO.** `default-runtime: nvidia` fazia o nvidia-container-runtime ABORTAR a criação de todo container sem driver — não degradava, matava tudo (banco, API, web, gravação). Foram ~14h de produção fora. Fix: `runtime: nvidia` explícito só onde precisa + `infra/drac-up.sh`, que escolhe os overlays pela GPU REAL (3 provas: `/dev/nvidia0`, `nvidia-smi`, `docker run` real).
- **Sistema resiliente a placa arrancada:** sobe e degrada sozinho, sem intervenção.
- **IA voltava em CPU silenciosamente após queda da GPU** — agora o estado é honesto (mostra em que device roda).
- **Sem a placa, pedir CUDA SEGFALTAVA** — agora cai para CPU de verdade, com fallback controlado.
- **Objetos na GPU (ONNX Runtime CUDA):** YOLO26n rodando na placa, verificado na RTX Blackwell (objetos e rostos na GPU).
- **NVENC não reverte mais** por esquecer o overlay (transcode por hardware estável).
- **Driver `-open` para Blackwell** + estado honesto da IA na GPU.

## 2. Inteligência (IA) e perímetro

- **Objeto precisa PROVAR que existe antes de virar alarme** (mediana ≥0,70 em ≥3 quadros, 1 evento por objeto) — corta alarme falso.
- **Sensibilidade POR ZONA + piso de ruído adaptativo.** Ruído de sensor disparava ~75% das gravações por movimento à noite; blur gaussiano antes do MOG2 levou 90 falsos → 0.
- **Bbox de movimento vinha com as dimensões de quadro ERRADAS** — corrigido (a zona só funciona com a escala certa).
- **"Monitorar só aqui" era IGNORADO:** o gatilho nativo da câmera não conhece zonas. Salvar virava "ignorar área" ao recarregar e gravava a tela toda. Invariante nova: zona de ÁREA força `motionTrigger=SYSTEM` + `aiEnabled=true`; a sonda ONVIF não devolve para CAMERA enquanto houver zona.
- **Cruzar a LINHA de perímetro agora ALERTA** — antes era só um evento mudo.
- **Detecção de linha e intrusão por duas vias:** evento da própria câmera (ONVIF) ou IA local com rastreamento. Perímetro é sobre OBJETO, nunca movimento; concorrente (Frigate) não tem linha.
- **Editor de perímetro explica cada modo na própria tela**; a página desenha sobre o SNAPSHOT, não sobre vídeo preto.
- **Escopo de objeto:** a Central define o quê, a instalação define onde e como; modo de IA **por câmera** (não global); tripwire instanciado no pipeline.
- **Parou de abrir captura para câmera OFFLINE** (desperdício zero).
- **Página de IA por-instalação** + **página dedicada de Segurança** (linha + zona) no padrão do PTZ.

## 3. Gravação inteligente (o que dispara a gravação)

- **Novo modo "Pessoa ou veículo":** grava só quando a IA confirma um objeto — sombra, folha e chuva deixam de gerar arquivo.
- **Escolha POR CÂMERA de quais classes disparam gravação** (só pessoa, só veículo, etc.). Regra em todas as camadas: lista vazia = padrão (pessoa+veículos), nunca "nada grava".
- **Modo objeto respeita a ZONA:** usa o pé da bounding box (ray casting) — objeto fora da área não grava. Geometria gêmea TS+Python.
- **O modo existia em 1 tela de 3, e o botão "armar" da lista o apagava em silêncio** (reescrevia `motion`) — corrigido; o modo é de quem configurou.
- **Detector "cego" (sem frame) passa a GRAVAR contínuo** em vez de ficar sem gravar em silêncio; a cura sobrevive ao restart e o detector cego aparece na Central.
- **Disco cheio ROTACIONA por câmera** em vez de parar de gravar; não destrói o que ainda não subiu à nuvem.
- **Segmentos .ts órfãos / vazios / de 0 byte** deixam de escapar da limpeza e de virar erro no log; regra de disco a 85%.
- **Câmera armada por movimento do SISTEMA com o detector desligado** — corrigido.

## 4. Ao vivo (live view)

- **Três modos de qualidade por câmera:** Instantâneo (substream), Equilibrado (transcode H.264), Máxima (H.265 passthrough).
- **Zoom 1×1 vai para o ponto do mouse, zera ao sair,** e ganhou **"mãozinha"** (pan por arraste); o pan não recebia scroll (botão por cima) — corrigido.
- **Grade "lavada e fantasma"** corrigida: causa medida (SSIM/PSNR) era `-preset ultrafast`; trocado por `veryfast`.
- **Vídeo saudável nunca mais pisca/reconecta** (invariante); a interface deixa de derrubar vídeo saudável; prazos e cache honestos.
- **Freio de transcodes simultâneos** + custo da conversão visível.
- **Grade aquecida prendia sessão RTSP** consumindo ~304 GB/dia sem espectador; autocura da grade nasce DESLIGADA (não mexe na fonte com o operador vendo).
- **Rotação do token não derruba mais TODAS as câmeras a cada 5 min**; ffmpeg órfão não segura mais sessão RTSP no DVR para sempre.
- **Oscilação de rede deixa de virar colapso da frota**; watchdog não desiste em silêncio do path que fala com a câmera.
- **WebRTC volta a ser só UDP**; FFmpeg volta a ler direto da câmera (salto privado vira opção); sanitização aprende com o MediaMTX, não com o ffprobe.
- **Devolvidos os 20 fps ao mosaico** (a congestão tinha outra causa); busca profunda de substream sai do caminho quente (vai para o cadastro).

## 5. Rever gravações (playback)

- **Linha do tempo redesenhada no padrão dos grandes VMS:** minimapa do dia inteiro + ticks em 3 níveis; verde de gravação do início ao fim, vermelho só para alarme; minimapa só aparece com zoom.
- **H.265 toca direto no navegador (padrão):** a espera de conversão para H.264 só para quem provou não decodificar; "preparando" deixou de ser tratado como erro.
- **Gravação H.265 nunca abria** (FFmpeg sem `-f mp4`) — corrigido.
- **Cópia compatível ficou ~8× menor** (medido: veryfast crf16) e a conversão virou **assíncrona**, com cache limitado (antes sem teto).
- **Download em lote via ZIP com manifesto, sem carregar na RAM** (archiver v7); a timeline seleciona o vídeo CERTO e o player sobrevive a rede ruim, S3 e erro de download.
- **A régua mostra QUAIS trechos só existem na nuvem**; o pan não é mais desfeito pelo auto-follow do playhead.
- **Poster/snapshot instantâneo** pelo thumbnail de gravação (era ~segundos).

## 6. Câmeras que publicam (RTMP ingest)

- **A câmera pode PUBLICAR no DRAC por RTMP, atravessando CGNAT** (sem IP fixo).
- **Cadastro sem inventar IP e senha**; o sistema **APRENDE** o caminho que o equipamento usa; pede só o nome.
- **Tela dedicada para o modo RTMP** (sem linha de comando); tradutor de dialeto RTMP + bancada de simulação de capacidade; um campo só (o endereço completo de publicação).
- **Câmera que publica não fica mais OFFLINE com vídeo entrando**; tela de ajustes não dá mais 500; lista de equipamentos aparece no cadastro.
- **URL compacta para câmeras Intelbras** (≤50 caracteres, mantendo o domínio).

## 7. Armazenamento e nuvem (S3 / offload / retenção)

- **Migrar de um bucket S3 para outro sem perder o acervo** — cada gravação lembra em qual nuvem está; trocar, esvaziar e remover S3 têm porta.
- **Excluir o S3/storage pela Central limpa TUDO dele no sistema** (corrigido deadlock expurgo×fallback que nunca concretizava).
- **Offload envia ao fechar a gravação**, com paralelismo editável na Central; não copia mais o vídeo inteiro para a RAM; multipart em paralelo mata o gargalo de S3 distante.
- **Offload parado 16h** por credencial que nunca chegava na tabela; disjuntor no envio (credencial morta saturava a subida e "parava" o sistema).
- **A retenção apaga também o objeto na nuvem**; varredura recolhe órfãos do bucket sem virar política paralela.
- **Botão "Desempenho"** mede o caminho real do vídeo até o bucket (mede o FORNECEDOR), amostra até 256 MB (a de 8 MB fixos mentia em link rápido).
- **Auditoria de armazenamento (incidente Eveo, bucket apagado externamente):** o banco deixa de mentir sobre o que está na nuvem; fecha os cinco caminhos de destruição; envio visível e upload honesto.
- **Retenção por grupo:** o grupo guarda a política, a câmera escolhe se a segue; o toggle passou a existir na tela que o operador usa (o diálogo abria com 7 fixo).

## 8. Central e frota (painel mestre)

- **Fluxo de versão da frota:** a matriz promove com gate → a Central guarda como dado com evidência → o cliente atualiza com backup + verificação + rollback. Quem pergunta é sempre a instalação (funciona atrás de NAT).
- **A instalação REPORTA a versão que passou a rodar** (e a config que aplicou) — antes a Central inferia por data.
- **A versão aprovada sobrevive à recarga** da página; `promover` confere o acesso à Central ANTES dos 15 minutos de teste.
- **Alertas por instalação** (e-mail + Telegram), com ajuda, direto do detalhe da instalação.
- **Estabilidade do painel:** matou 41 nós repintados por ciclo e a recarga no meio da medição; um contador de segundos repintava tudo a cada 30s; a repintura não destrói mais o detalhe nem o teste de S3; recarga de versão sem perda.
- **Desempenho do storage:** mostra de onde vem a latência e onde fica o servidor; salvar storage testa a credencial na hora; endpoint sem `http://` (o painel descobre o esquema sondando); teste de S3 não morre mais no nginx aos 60s.
- **Portal técnico protegido** + hierarquia visual; carimbo da versão servida na barra; a página se recarrega sozinha quando o servidor muda; URL com query string não dá mais 404.
- **Legibilidade:** cartão do storage era só um chip verde; painel de desempenho tinha números da cor do fundo — corrigidos.
- **Credencial S3:** botão "Mostrar" da Secret Access Key guardada, com rastro de auditoria.
- **Backup:** o banco da Central não era copiado por backup nenhum; "uma Central só" (o compose apontava para o banco errado); `CENTRAL_STORAGE_SECRET` ausente era defeito latente.
- **Download de APK/AAB** estava quebrado há 8 dias por porta errada — corrigido.

## 9. Instalação de cliente e segurança

- **Instalação de cliente virou 2 comandos**, com máquina virgem (container Ubuntu com systemd) que PROVA que funcionou; teste de instalação limpa no CI.
- **12 defeitos que só a instalação limpa revelou** (estreia do D-GUARDIAN): repo errado, diretório/usuário errados, Central subindo no servidor do cliente, porta duplicada base×overlay, nginx do web sem os proxy_redirect do MediaMTX, `RolePermission` no schema sem migração que a criasse, watchdog morrendo no 1º disparo, dois alertas falsos perpétuos, exposição à internet — todos corrigidos.
- **Instalador expunha API(3000), HLS(8888) e sinalização WebRTC(8889) à internet** (DNAT do Docker avaliado antes do ufw) — agora só é público o que não passa pelo nginx.
- **`.env` do cliente não carrega mais a config do painel Central** (`strip_central_only_keys`; CLOUD_* preservado). Aplicado também na VM em produção, com backup.
- **`Docker instalado não é Docker rodando`**; padrões de PRODUTO, não da máquina de dev; backup não falha por dono de diretório.
- **Marca do cliente:** tema escuro embranquecia (caixas #FFF) e "AjustCam" vazava na tela dele — corrigidos; `PRODUCT_NAME` virou só valor de reserva.

## 10. Interface web (fundamentos e auditoria de front-end)

- **Auditoria de front-end em 5 fases:** (1) a interface parava de afirmar coisas falsas; (2) atrito proporcional ao risco nas ações destrutivas; (3) botões alcançáveis, erros que o usuário resolve sozinho, tokens fantasma e rótulos acessíveis; (4) telas que eram casca passam a entregar de verdade e a Investigação deixa de simular prova; (5) convergência estrutural (regra escrita + base única).
- **Avisa "sua conexão está instável" — sem virar desculpa** (para o cliente não culpar o sistema por rede ruim).
- **Título da página aparecia DUAS vezes** (redundância em quase toda tela) — corrigido.
- **Coluna Status das câmeras:** "Online" aparecia em verde, âmbar E vermelho; dizia "Movimento" ao lado da coluna que já dizia — cores por status cru corrigidas.
- **Seletor de câmera único**, com busca e estado visível (em /playback, /review, /ptz); controles do mural somem após 3s parado.
- **A tela esvaziava por um buraco de token**, não por perda de sessão — corrigido.
- **Central de Ajuda em /ajuda**, alcançável pelo rodapé; páginas sem executor real removidas (Mapa/Planta, Evidências, Relatórios, App Builder); Inteligência/Investigação/Auditoria escondidas quando não se aplicam.
- **PTZ:** capacidade passa a ser sondada, guardada e explicada; **ONVIF** descobre sozinho a porta que ninguém preencheu.

## 11. App mobile, infraestrutura e monitoramento

- **App mobile:** playback deixa de transcodificar tudo e entende o 503; o app para de "afirmar coisas que não sabe"; favoritas únicas, barreira por aba e lista virtualizada; cleartext/acessibilidade/feedback de toque; o redesign volta a ser um app completo e a frota descobre versão nova.
- **VPN até as câmeras do cliente (recente):** script que responde "a VPN está de pé AGORA?" indo até a câmera; detecção do túnel "zumbi" (interface de pé, nada passando); vigia que redisca sozinho + autostart no boot (aguardando liberação de sudo para ativar).
- **Watchdog/monitoramento:** cron 5min detecta e auto-cura queda das portas do MediaMTX e alerta o dono no Telegram; câmera rtmp_push com IP 0.0.0.0 virava alarme falso permanente; sem node no host, "degradado" não é "instalação quebrada"; diretório de estado nasce do dono certo.
- **Infra/mídia:** sessão WHEP nunca era encerrada (405/fluxo órfão); nginx para de logar segmento de vídeo; token de mídia deixa de ser gravado em claro no access log; MediaMTX nunca subia em produção (porta ligada duas vezes); painel de travamentos (GlitchTip) hospedado em casa + relatório de crash do app.
- **Desempenho/saúde:** a API congelava 11s (cache de 1,6 MB relido 1.200 vezes) — corrigido; reteste ativo em paralelo detecta câmera caída 3,5× mais rápido; três "bombas" restantes do resumo de saúde desarmadas.
- **Câmera privada (LGPD):** cota não achava o grupo do cliente — corrigido; conteúdo só do dono.

---

## Como ler os números

**202** é o total de commits verificados na branch. As 11 frentes acima cobrem todos — algumas reúnem sub-áreas próximas (ex.: "armazenamento" junta S3, nuvem, offload e retenção; "IA e perímetro" junta detecção, zona e linha). Nenhum item é estimativa: cada um foi medido (SSIM/PSNR, bytes, tempo) ou testado (unitário, e2e, instalação limpa) antes de entrar.

*Gerado a partir de `git log main..fix/auditoria-completa`.*
