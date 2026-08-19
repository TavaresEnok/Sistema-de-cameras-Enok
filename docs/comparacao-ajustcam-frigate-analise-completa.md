Comparei a branch main atual dos dois projetos, olhando não só README, mas também o pipeline de IA do AjustCam e a documentação/arquitetura atual do Frigate. A conclusão principal é: eles já têm bastante coisa em comum na IA, mas o AjustCam está mais próximo de um VMS comercial completo, enquanto o Frigate está mais maduro como motor de análise de vídeo/IA extremamente otimizado.

1. Comparação geral
Característica	AjustCam / DRAC VMS	Frigate
Tipo de sistema	VMS/NVR comercial completo	NVR + IA local
Foco principal	Operação de câmeras, usuários, gravação, evidências, centralização e IA	Detecção inteligente, eventos e automação
Arquitetura	React + NestJS + PostgreSQL + Redis + MediaMTX + Python IA	Python multiprocess + FFmpeg + go2rtc + SQLite
Interface Web	✅ Completa	✅ Completa
Aplicativo mobile próprio	✅ Expo/React Native	⚠️ Web/PWA e ecossistema
Multiusuário/permissões	✅ Forte	✅ Mais simples
Auditoria	✅	Mais limitada
Evidências/investigação	✅	⚠️ Eventos/exports
Mapa/planta baixa	✅	❌ Não é foco
Centralização de instalações	✅ DRAC Central	⚠️ Não é a proposta principal
Home Assistant	Não é foco	✅ Excelente integração
MQTT	Não é parte central	✅
Streaming	MediaMTX	go2rtc
WebRTC	✅	✅
HLS	✅	✅
RTSP restream	✅	✅
IA local	✅	✅
Detecção de pessoas	✅	✅
Tracking de pessoas	✅ ByteTrack	✅ Norfair customizado
Detecção baseada em movimento	✅ Parcial/selecionável	✅ Parte fundamental da arquitetura
Otimização para objetos estacionários	🟡 Existe trabalho nessa direção	✅ Muito madura
Coral EdgeTPU	🔴 Planejado	✅
NVIDIA/TensorRT	🔴 Planejado para objetos	✅
Hailo	🔴 Planejado	✅
RKNN/Rockchip	🔴 Planejado	✅ community
Intel OpenVINO	✅	✅
NPU Intel	🟡 OpenVINO configurável	✅
Escalabilidade da IA	Boa, em evolução	Muito madura
Maturidade/ecossistema	Projeto novo/em desenvolvimento	Projeto consolidado
Licença	Não encontrei licença destacada no root analisado	MIT

O DRAC declara explicitamente frontend web, API NestJS, PostgreSQL, Redis/BullMQ, MediaMTX, IA Python/OpenVINO, app React Native e worker Go opcional. O próprio projeto também informa que ainda há hardening necessário antes de produção ampla.

O Frigate se define como NVR local com detecção em tempo real e enfatiza multiprocessing, detecção de movimento de baixo custo para decidir onde executar IA, processos separados de inferência, MQTT, gravação contínua e WebRTC/MSE.

2. Arquitetura de vídeo

Essa é uma das partes mais interessantes.

AjustCam

A arquitetura atualmente é aproximadamente:

                           CÂMERA IP
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
        RECORDING          LIVE            ANALYTICS
        main stream      main stream       substream
        H.265/H.264      H.264/H.265       leve / sem áudio
             │                │                │
             ▼                ▼                ▼
          Gravação         MediaMTX       AI Service Python
                              │                │
                         WebRTC/HLS             ▼
                                              OpenCV
                                                │
                                         Queue tamanho 1
                                                │
                                               MOG2
                                                │
                                    ┌───────────┴───────────┐
                                    │                       │
                                YOLO/OpenVINO           Motion only
                                    │
                                ByteTrack
                                    │
                              Overlay/Eventos

O AjustCam separa explicitamente stream de gravação, live e analytics, sendo que o analytics usa preferencialmente um substream direto da câmera. Isso é uma excelente decisão arquitetural porque uma câmera 4K pode gravar em alta qualidade sem obrigar a IA a processar 4K.

Além disso, o pipeline de IA abre o RTSP tentando eliminar buffering e usa uma fila de apenas 1 frame, descartando frames antigos. Isso prioriza tempo real em vez de tentar analisar vídeo atrasado.

Frigate

O Frigate trabalha aproximadamente assim:

                           CÂMERA
                              │
               ┌──────────────┴──────────────┐
               │                             │
          MAIN STREAM                    SUBSTREAM
               │                             │
        gravação/live                      decode
                                              │
                                         amostragem
                                          ex. 5 FPS
                                              │
                                      Motion Detection
                                              │
                                       Motion Boxes
                                              │
                                      Motion Regions
                                              │
                                     Object Detector
                                              │
                                     Norfair Tracker
                                              │
                                 Stationary Object Logic
                                              │
                                  Evento / Snapshot /
                                      Recording

Aqui está uma das maiores vantagens arquiteturais do Frigate: normalmente ele não entrega o frame inteiro constantemente ao modelo pesado de IA. Os frames são comparados, geram caixas de movimento, essas caixas são consolidadas em regiões e essas regiões seguem para o detector de objetos.

3. Diferença fundamental no consumo de IA

Este ponto merece destaque.

AjustCam hoje

No modo general, o código atual faz:

frame
 ↓
MOG2
 ↓
YOLO/OpenVINO no frame de análise
 ↓
ByteTrack

Existe suporte para:

MOG2
 ↓
motion boxes
 ↓
região
 ↓
YOLO somente naquela região

mas essa funcionalidade está desligada por padrão.

O próprio código diz:

detecção por região — padrão desligado.

Quando ela está desligada, a inferência continua sobre o frame redimensionado inteiro.

Frigate

No Frigate:

Movimento
    ↓
região interessante
    ↓
Object Detector

é uma característica central do pipeline.

Resultado prático

Para muitas câmeras:

Cenário	AjustCam atual	Frigate
Cena completamente parada	Pode continuar executando YOLO no modo general	Quase nenhum trabalho pesado
Pessoa entra na cena	YOLO já está verificando	IA é acionada sobre regiões
Árvore balançando	YOLO pode continuar trabalhando	Motion gera regiões conforme configuração
Carro estacionado 2 horas	Tracking/detecção continua conforme pipeline	Entra em lógica de stationary object
30 câmeras	Demanda cresce consideravelmente	Arquitetura especialmente preparada para isso

O Frigate inclusive considera um objeto estacionário após determinado número de frames e reduz drasticamente a frequência de novas inferências naquele objeto até ocorrer movimento novamente.

4. Detecção de pessoas

Aqui o AjustCam está muito melhor do que uma análise superficial do README faria parecer.

O detector atual possui explicitamente:

PERSON_CLASS_ID = 0
BICYCLE_CLASS_ID = 1
CAR_CLASS_ID = 2
MOTORCYCLE_CLASS_ID = 3
BUS_CLASS_ID = 5

e o modelo padrão indicado no código é:

yolo26n

executado através de OpenVINO.

Portanto:

Função	AjustCam	Frigate
Pessoa	✅	✅
Carro	✅	✅
Moto	✅	✅
Bicicleta	✅	✅
Ônibus	✅	✅
Muitas outras classes	🟡 Atualmente conjunto mais controlado	✅ grande labelmap/model-dependent
Confidence por classe	✅	✅
Filtro de tamanho	✅	✅
Zonas	✅	✅
Tracking ID	✅	✅

No Frigate, person continua sendo o objeto acompanhado por padrão, mas há uma lista extensa de classes que podem ser habilitadas dependendo do modelo.

5. Tracking — o quadrado acompanhando a pessoa

Essa é uma parte em que os dois sistemas possuem tracking real.

AjustCam — ByteTrack

O AjustCam utiliza:

supervision.ByteTrack

e mantém um tracker separado por:

camera
 +
classe

Por exemplo:

CAMERA01:class:person
CAMERA01:class:car
CAMERA02:class:person

O detector devolve um:

trackId

junto da bounding box.

Na prática:

Frame 1
Pessoa detectada
ID 14
┌──────────┐
│ pessoa   │
└──────────┘


Frame 2
Pessoa anda
ID 14
      ┌──────────┐
      │ pessoa   │
      └──────────┘


Frame 3
Pessoa anda
ID 14
             ┌──────────┐
             │ pessoa   │
             └──────────┘

Ou seja, não é simplesmente YOLO desenhando uma nova caixa independente a cada frame.

6. Estabilidade visual do quadrado no AjustCam

Existe ainda outra camada bastante boa.

O overlay possui:

show_after_hits
hide_after_misses
lost_ttl_ms
overlay_ttl_ms

Isso evita o comportamento:

frame 1: caixa
frame 2: sem caixa
frame 3: caixa
frame 4: sem caixa

O sistema pode segurar temporariamente a última detecção para tornar o desenho visualmente mais estável.

Então o pipeline é:

YOLO
 ↓
detecção
 ↓
ByteTrack
 ↓
trackId
 ↓
hit/miss smoothing
 ↓
overlay

Isso é uma arquitetura correta para o problema do quadrado acompanhando a pessoa.

7. Tracking do Frigate

O Frigate utiliza um sistema baseado em Norfair, bastante customizado.

Na versão atual, essa implementação possui ajustes específicos de Kalman, função de distância baseada em posição/tamanho do bounding box, tratamento para PTZ e até mecanismos para compensação do movimento da própria câmera.

Além disso:

detecção
 ↓
tracking
 ↓
active object
 ↓
stationary object
 ↓
reavaliação periódica

Isso cria uma noção de ciclo de vida do objeto, não apenas uma caixa persistente.

Comparando tracking
Característica	AjustCam	Frigate
Algoritmo	ByteTrack	Norfair customizado
Track ID	✅	✅
Tracking por câmera	✅	✅
Tracking por classe	✅	✅
Bounding box suavizada	✅ overlay smoothing	✅
Objeto perdido temporariamente	✅ buffer/TTL	✅
Objeto estacionário	🟡 implementação de regiões possui lógica relacionada	✅ forte
Reidentificação/controle avançado PTZ	❌ ainda não equivalente	✅
Tracking com câmera se movimentando	🟡	✅
Maturidade	Boa	Muito alta
Para câmera fixa

ByteTrack é uma excelente escolha para o AjustCam.

Eu não substituiria automaticamente ByteTrack por Norfair.

8. Detecção de movimento
AjustCam

Utiliza:

OpenCV MOG2

para motion detection.

E existe um recurso muito interessante chamado internamente de confirmação semântica:

MOG2 vê movimento
       ↓
recorta apenas a região
       ↓
aumenta margem
       ↓
YOLO analisa o crop
       ↓
"é pessoa?"
       ↓
evento recebe label pessoa

O código ainda possui dois modos:

enrich
strict

No enrich, se a IA não reconhecer objeto, o evento de movimento continua existindo.

No strict, pode descartar movimentos sem objeto reconhecido.

Isso é particularmente interessante para gravação por movimento.

9. Latest Frame Only

Os dois sistemas compartilham a mesma filosofia:

tempo real é mais importante que processar todos os frames.

No AjustCam:

Queue(maxsize=1)

e, se todos os requests de inferência estiverem ocupados:

frame atual é descartado
próxima execução usa frame mais recente

O próprio código documenta explicitamente esse comportamento.

Isso impede algo como:

Câmera
 ↓
1 2 3 4 5 6 7 8 9 10


IA lenta
 ↓


fila:
3
4
5
6
7
8
9


resultado exibido 4 segundos depois

O AjustCam prefere:

1
 ↓
IA ocupada


2 3 4 5 descartados


6
 ↓
IA disponível

Para videomonitoramento, isso é muito melhor.

10. Modelos e aceleradores

Aqui aparece uma grande vantagem atual do Frigate.

AjustCam

Atualmente:

Runtime	Situação
OpenCV MOG2	✅
OpenVINO objetos	✅
OpenVINO CPU	✅ padrão
OpenVINO Intel GPU	🟡 dispositivo configurável
OpenVINO Intel NPU	🟡 dispositivo configurável
ONNX Runtime rosto CPU	✅
ONNX Runtime rosto CUDA	✅
TensorRT objetos	🔴 planejado
Coral EdgeTPU	🔴 planejado
Hailo-8L	🔴 planejado
RKNN	🔴 planejado
ONNX CUDA objetos	🔴 planejado

Isso não é suposição: o próprio runtime_registry.py distingue claramente os runtimes atuais dos PLANNED_RUNTIMES.

Frigate

Atualmente suporta uma gama muito maior:

Hardware	Frigate
Intel CPU	✅
Intel iGPU	✅
Intel Arc	✅
Intel NPU	✅
Coral USB	✅
Coral PCIe/M.2	✅
Hailo-8/8L	✅
NVIDIA GPU	✅
AMD GPU/ROCm	✅
Apple Silicon	✅
Jetson	✅ community
Rockchip NPU	✅ community
Synaptics NPU	✅ community

No OpenVINO, por exemplo, o Frigate documenta suporte a CPU, GPU e NPU e permite inclusive vários detectores quando uma única instância não consegue acompanhar o volume de câmeras.

11. Modelos de IA
AjustCam atualmente

O código está preparado para modelos OpenVINO e possui como padrão:

yolo26n

com suporte de resolução/tamanho de entrada e modelos FP32/INT8 encontrados no diretório de modelos.

Frigate

A arquitetura é muito mais desacoplada do modelo.

No OpenVINO atualmente documenta, entre outros:

YOLOv9
RF-DETR
YOLO-NAS
MobileNet V2
YOLOX

Portanto:

Questão	AjustCam	Frigate
Trocar modelo mantendo pipeline	🟡 possível, mas mais acoplado	✅ muito preparado
Diferentes runtimes	🟡 arquitetura criada	✅ maduro
Diferentes hardwares	🟡	✅
Model registry	✅ começando	✅ consolidado
12. Um detalhe excelente do AjustCam

O código do AjustCam já começou a adotar justamente uma ideia arquitetural do Frigate:

Detector API
      │
      ├── OpenVINO
      ├── TensorRT
      ├── Coral
      ├── Hailo
      └── RKNN

O próprio runtime_registry.py registra que a técnica do contrato de detectores foi derivada do Frigate/MIT e foi criada para permitir que novos runtimes sejam adicionados sem reescrever o pipeline.

Isso é uma decisão muito boa.

O problema não está na arquitetura.

O que falta é implementar os plugins.

13. Gravação

Os dois são NVR reais.

AjustCam

Possui:

gravação;
playback;
retenção;
tokens de playback;
stream separado para recording;
possibilidade de preservar H.265 diretamente;
armazenamento independente do analytics.
Frigate

Possui:

24/7;
gravação por movimento;
gravação por objeto;
diferentes períodos de retenção;
limpeza automática de storage;
retenção baseada no tipo de conteúdo.
Vantagem

Em inteligência de retenção:

Frigate.

Em estrutura de VMS/gestão:

AjustCam.

14. Live view
Recurso	AjustCam	Frigate
RTSP origem	✅	✅
Restream	MediaMTX	go2rtc
WebRTC	✅	✅
H.264	✅	✅
H.265 origem	✅	✅
Transcode quando necessário	FFmpeg/MediaMTX	FFmpeg/go2rtc
Áudio	✅	✅
Two-way audio	Não identifiquei como recurso equivalente maduro	✅ dependendo da câmera

No AjustCam, se a origem já for H.264 compatível, é possível evitar reencode; se for H.265, MediaMTX/FFmpeg pode convertê-la para H.264 para o navegador.

No Frigate, o go2rtc também é usado para restream e WebRTC, inclusive diminuindo o número de conexões diretamente às câmeras.

15. PTZ

Aqui há uma diferença importante.

AjustCam

Já possui:

PTZ
ONVIF
move

inclusive API própria:

POST /ptz/:cameraId/move

Mas isso é diferente de:

IA encontrar uma pessoa e fisicamente mover a câmera automaticamente para acompanhá-la.

Frigate

Tem autotracking PTZ.

É possível configurar:

track:
  - person

e fazer a câmera:

Pessoa entra
     ↓
IA detecta
     ↓
tracker acompanha
     ↓
ONVIF move PTZ
     ↓
pessoa permanece centralizada
     ↓
pessoa sai
     ↓
câmera retorna ao preset

Resultado

Frigate ganha claramente nessa área hoje.

16. Recursos avançados de IA do Frigate

O Frigate já possui ecossistema para:

object detection;
stationary objects;
face recognition;
license plate recognition;
semantic search;
classificação adicional;
zones;
masks;
speed estimation;
audio detection;
PTZ autotracking;
snapshots inteligentes;
escolha do melhor frame do objeto.

Por exemplo, ele não salva simplesmente a primeira imagem de uma pessoa: acompanha o objeto e avalia qual frame é melhor considerando confiança, tamanho e outras características.

Também possui classificação secundária de objetos rastreados.

17. Onde o AjustCam é claramente mais forte

É importante não analisar apenas a IA.

O AjustCam está construindo algo que o Frigate não pretende ser da mesma forma:

um VMS comercial.

O AjustCam já tem no mesmo produto:

                    DRAC
                      │
        ┌─────────────┼──────────────┐
        │             │              │
     Câmeras       Usuários        Sites
        │             │              │
     Live          Permissões       Mapas
     Playback      Auditoria        Plantas
     PTZ            Evidências       Central
        │
        └────────── IA ──────────────┘

O README atual lista usuários, permissões, auditoria, evidências, mapa, planta baixa, investigações, alarmes, app mobile e Central como partes do produto.

Para uma solução a ser vendida como:

“plataforma profissional de videomonitoramento da Ajust”

isso tem bastante peso.

18. Onde o Frigate é claramente mais forte

No núcleo de computer vision:

            FRIGATE


Motion Detection
       ↓
Region Proposal
       ↓
Detector Scheduler
       ↓
Hardware Accelerator
       ↓
Object Tracking
       ↓
Stationary Objects
       ↓
Object lifecycle
       ↓
Best frame
       ↓
Event / recording

É uma arquitetura que vem sendo refinada por anos.

O repositório público atualmente mostra milhares de commits, enquanto o repositório do AjustCam mostra 201 commits; isso não determina qualidade sozinho, mas ilustra bem a diferença de maturidade e histórico de desenvolvimento.

19. Comparação focada somente em IA
Categoria	AjustCam	Frigate	Melhor hoje
Motion detection	MOG2	Motion engine altamente integrado	🟢 Frigate
Detecção pessoa	YOLO/OpenVINO	múltiplos modelos	Empate
Precisão	Depende do YOLO/modelo	Depende do modelo	Empate
Tracking	ByteTrack	Norfair customizado	🟢 Frigate
Tracking pessoa em câmera fixa	Muito bom	Muito bom	Empate próximo
Smooth bounding box	✅	✅	Empate
Persistent ID	✅	✅	Empate
Regions	✅ experimental/opt-in	✅ core	🟢 Frigate
Latest-frame-only	✅	✅ filosofia realtime	Empate
Stationary object	🟡	✅	🟢 Frigate
Adaptive performance	✅	✅	Empate próximo
Coral	Planejado	✅	🟢 Frigate
NVIDIA	Planejado para objeto	✅	🟢 Frigate
Hailo	Planejado	✅	🟢 Frigate
Intel OpenVINO	✅	✅	Empate
NPU	🟡	✅	🟢 Frigate
PTZ AI tracking	❌ equivalente não identificado	✅	🟢 Frigate
Face	✅ detector	✅ reconhecimento/enrichment	🟢 Frigate
LPR	Não identifiquei equivalente	✅	🟢 Frigate
Semantic search	Não identifiquei equivalente	✅	🟢 Frigate
Audio AI	Não identifiquei equivalente	✅	🟢 Frigate
Evolução/estrutura plugins	✅ começando	✅ madura	🟢 Frigate
20. Comparação como produto VMS

Aqui a história muda.

Categoria	AjustCam	Frigate	Melhor para VMS comercial
Gestão de usuários	✅ forte	✅	🟢 AjustCam
Permissões	✅	✅ básica	🟢 AjustCam
Auditoria	✅	limitada	🟢 AjustCam
Evidências	✅	exports/events	🟢 AjustCam
Investigação	✅	Explore/Review	🟢 AjustCam
Planta baixa	✅	❌	🟢 AjustCam
Mapa	✅	❌	🟢 AjustCam
App próprio	✅	diferente abordagem	🟢 AjustCam
White-label potencial	✅ arquitetura própria	Frigate possui marca protegida	🟢 AjustCam
Central multi-site	✅	não é foco principal	🟢 AjustCam
Banco	PostgreSQL	SQLite	🟢 AjustCam para arquitetura corporativa
Redis/queue	✅	arquitetura própria multiprocess	Depende
API empresarial	NestJS	API Frigate	🟢 AjustCam
Home Assistant	❌ foco	✅ excelente	🟢 Frigate
MQTT	❌ foco	✅	🟢 Frigate

Frigate utiliza SQLite para informações de gravação e objetos rastreados.

21. Minha avaliação dos dois projetos

Não tentaria transformar o AjustCam em uma cópia do Frigate.

Eu faria:

            AJUSTCAM / DRAC
                  │
       CAMADA VMS / COMERCIAL
                  │
    ┌─────────────┼──────────────┐
 Usuários       Sites        Evidências
 Auditoria      App          Central
 Permissões     Mapas        Alarmes
    └─────────────┼──────────────┘
                  │
          MOTOR DE VÍDEO/IA
                  │
          arquitetura inspirada
             no Frigate

E aproveitaria as melhores ideias do Frigate no motor interno, sem abrir mão do produto DRAC.

22. As 7 mudanças que mais aproximariam o AjustCam do Frigate

Em ordem de impacto:

Prioridade	Mudança	Impacto
1	Ativar e amadurecer inferência por regiões de movimento	🔥🔥🔥🔥🔥
2	Implementar lógica completa de stationary objects	🔥🔥🔥🔥🔥
3	Criar detector scheduler/fila global compartilhada entre câmeras	🔥🔥🔥🔥🔥
4	Finalizar plugins OpenVINO GPU/NPU, TensorRT e Coral	🔥🔥🔥🔥
5	Criar ciclo de vida persistente do objeto	🔥🔥🔥🔥
6	Best-frame selection por track	🔥🔥🔥
7	PTZ autotracking usando trackId + ONVIF	🔥🔥🔥
23. A melhoria que eu faria primeiro

Hoje o AjustCam tem:

Câmera
 ↓
substream
 ↓
320/416/512/640
 ↓
YOLO
 ↓
ByteTrack

Eu faria o modo principal evoluir para:

                   SUBSTREAM
                       │
                       ▼
                     MOG2
                       │
                  motion boxes
                       │
                merge de regiões
                       │
          ┌────────────┴────────────┐
          │                         │
     sem movimento              movimento
          │                         │
      quase zero                    ▼
      inferência              region proposal
                                    │
                              crop inteligente
                                    │
                              YOLO26 / OpenVINO
                                    │
                                 ByteTrack
                                    │
                            stationary manager
                                    │
                         ┌──────────┴──────────┐
                         │                     │
                      ativo               estacionário
                         │                     │
                    alta frequência       baixa frequência
                         │                     │
                         └──────────┬──────────┘
                                    ▼
                                 Evento

Isso provavelmente daria ao AjustCam um salto maior de capacidade por servidor do que simplesmente trocar YOLO26n por um modelo maior.

24. Resultado final
Se a pergunta for:

Qual é o melhor sistema de IA/NVR hoje?

Frigate.

Principalmente por:

pipeline motion → regions → object detector;
stationary objects;
variedade de aceleradores;
maturidade do tracking;
PTZ autotracking;
ecossistema de modelos;
enrichments;
otimização para dezenas de câmeras.
Se a pergunta for:

Qual está mais preparado para virar a plataforma comercial de videomonitoramento da Ajust Consulting?

AjustCam/DRAC.

Porque a arquitetura já envolve muito mais do que IA:

usuários;
permissões;
auditoria;
evidências;
investigação;
mapas;
planta baixa;
app;
central;
PostgreSQL;
API estruturada;
multi-site;
identidade própria;
live/playback/recording.

O Frigate seria uma excelente referência de motor de inteligência, mas eu não trocaria o DRAC inteiro por ele.

Em uma frase:

Frigate hoje tem o melhor “cérebro de vídeo”; AjustCam está construindo um produto VMS mais amplo em volta de um cérebro que já está tecnicamente bem encaminhado.

E há um detalhe importante: o AjustCam já contém várias decisões corretas encontradas em sistemas maduros — substream dedicado para IA, latest-frame-only, ByteTrack, QoS adaptativo, OpenVINO, region proposal, detector registry e separação entre evento e overlay. O próximo salto deveria ser menos “qual YOLO usar?” e mais “quando, onde e com que frequência executar o YOLO”.

O que seria o "Otimização para objetos estacionários  "? ByteTrack   vs Norfair customizado   ?

Sim. São duas coisas diferentes, mas relacionadas.

“Otimização para objetos estacionários” significa: depois que o sistema já detectou e está acompanhando um objeto, ele percebe que esse objeto ficou praticamente parado e reduz drasticamente quantas vezes a IA pesada precisa reanalisá-lo. No Frigate, um objeto vira “stationary” quando permanece em posição muito semelhante por certo número de frames; por padrão, esse limiar corresponde a cerca de 10 segundos. Depois disso, a detecção não fica rodando continuamente naquele objeto: ela só volta com mais frequência se houver movimento nele ou periodicamente para confirmar que continua ali. Isso reduz CPU/GPU/NPU e evita inferências redundantes.

Exemplo prático com uma câmera de estacionamento:

Carro entra
   ↓
YOLO detecta: CARRO
   ↓
Tracker acompanha
   ↓
Carro estaciona
   ↓
continua parado...
   ↓
Sistema marca:
STATIONARY
   ↓
reduz inferências sobre esse carro

Imagine que você processe a câmera a 5 FPS. Sem essa otimização, um carro parado por 2 horas poderia participar de dezenas de milhares de ciclos de análise. Com stationary tracking, o sistema mantém a informação “esse carro ainda está aqui” e verifica com frequência muito menor. No Frigate, o interval padrão mostrado atualmente é 50 frames; com detect.fps = 5, isso equivale aproximadamente a uma checagem a cada 10 segundos enquanto o objeto estiver estacionário, além de reativação por movimento.

Isso é especialmente importante no AjustCam porque você pode ter uma câmera vendo:

┌──────────────────────────────────┐
│                                  │
│  🚙            🚙        🚙      │
│                                  │
│              🚶                  │
│                                  │
└──────────────────────────────────┘

Os três carros podem permanecer horas ali. O que realmente interessa em tempo real é a pessoa andando. Uma arquitetura mais eficiente seria:

CARRO 1 → estacionário → pouca inferência
CARRO 2 → estacionário → pouca inferência
CARRO 3 → estacionário → pouca inferência


PESSOA → ativa → acompanhamento normal

Esse mecanismo também é mais inteligente que simplesmente dizer “não há movimento, então esquece o carro”. O Frigate mantém o estado do objeto. Por isso consegue distinguir conceitos como objeto ativo e objeto estacionário e usar isso inclusive na retenção das gravações.

ByteTrack vs Norfair customizado

Aqui precisamos separar uma coisa importante:

Norfair puro não é automaticamente melhor que ByteTrack.

O que torna o Frigate interessante é:

Norfair + customizações específicas do Frigate + lógica de lifecycle + motion detection + stationary objects.

O ByteTrack usado no AjustCam é um tracker multiobjeto muito competente.

ByteTrack

A ideia central do ByteTrack é:

YOLO
 ↓
detections


alta confiança ─────┐
                    ├─ associação
baixa confiança ────┘
        ↓
   tracks persistentes

O diferencial do ByteTrack é aproveitar também boxes de baixa confiança para tentar manter um track existente, em vez de simplesmente descartá-los. Isso ajuda muito quando uma pessoa fica parcialmente escondida ou a confiança do detector cai por alguns frames. Esse foi justamente o princípio apresentado no paper original.

Exemplo:

Frame 1
Pessoa = 92%
ID 17


Frame 2
Pessoa = 89%
ID 17


Frame 3
Pessoa passa atrás de um poste
Confiança = 38%


ByteTrack:
"Essa detecção fraca provavelmente
é a mesma pessoa ID 17."


Frame 4
Pessoa = 91%
ID 17

Em vez de acontecer:

ID 17
 ↓
some
 ↓
ID 42

Isso é muito bom para câmera fixa de segurança.

Norfair

O Norfair tem uma filosofia um pouco diferente.

Ele é uma biblioteca muito flexível. Você pode definir como uma detecção deve ser comparada a um objeto já rastreado através de uma função de distância customizada. Também oferece filtro de Kalman, hit counters, histórico de detecções e mecanismos opcionais de ReID.

Simplificando:

NOVA DETECÇÃO


       ↓


┌──────────────────────────┐
│ Onde ela está?           │
│ Qual o tamanho?          │
│ Qual a proporção?        │
│ Para onde está indo?     │
│ Onde deveria estar?      │
└──────────────────────────┘
       ↓


é provavelmente o ID 17?

O Frigate passou a usar essas características para considerar coisas como posição, tamanho e relação largura/altura, reduzindo trocas de ID em situações como um carro estacionado enquanto outro passa atrás ou na frente.

Um exemplo onde aparece a diferença

Imagine:

              CÂMERA


        Pessoa A → →


               ← ← Pessoa B

As duas pessoas se cruzam:

ANTES


A [ID 4]       B [ID 9]


        ↓


CRUZAMENTO


       [A/B]


        ↓


DEPOIS

O pior resultado seria:

Pessoa A → ID 9
Pessoa B → ID 4

Ou seja, ID switch.

Tanto ByteTrack quanto Norfair tentam evitar isso.

Mas fazem isso com filosofias um pouco diferentes.

ByteTrack

É muito focado em:

associação eficiente das bounding boxes de um detector.

Ele funciona extremamente bem quando temos:

YOLO
 +
câmera relativamente fixa
 +
boa frequência de detecção
 +
objetos como pessoas/carros

É exatamente o cenário típico do AjustCam.

Norfair

É mais parecido com uma caixa de ferramentas para construir um tracker específico para sua aplicação.

Você pode dizer:

Para saber se é o mesmo objeto:


40% posição
20% tamanho
20% aspect ratio
20% trajetória prevista

Isso é só um exemplo conceitual, não os pesos do Frigate.

Norfair permite esse nível de customização através das suas funções de distância e filtros.

Comparação direta
Característica	ByteTrack	Norfair
Multi-object tracking	✅	✅
Tracking pessoas	✅ Excelente	✅ Excelente
Tracking carros	✅ Excelente	✅ Excelente
Usa detector externo	✅	✅
YOLO + tracker	✅ combinação muito comum	✅
Usa detecções de baixa confiança	✅ grande diferencial	Depende da implementação
Kalman/predição	✅	✅
Customização da associação	Média	Muito alta
Função de distância customizada	Menos flexível	✅
ReID extensível	Limitado/externo	✅ API para isso
Câmera fixa	Excelente	Excelente
Câmera PTZ	Possível, precisa trabalho adicional	Muito configurável
Simplicidade	Mais simples	Mais complexo
Performance	Muito boa	Muito boa
Necessidade de tuning	Menor	Maior
Fácil de integrar com YOLO	✅	✅
Mas o Frigate não usa “Norfair normal”

É justamente aqui que eu colocaria a palavra customizado.

A arquitetura é mais próxima de:

                    FRIGATE
                       │
              Motion Detection
                       │
                       ▼
               Object Detector
                       │
                       ▼
                 NORFAIR
                       │
              custom distance
                       │
          posição / largura / altura
             aspect ratio etc.
                       │
                       ▼
                Object State
            ┌──────────┴──────────┐
          ACTIVE              STATIONARY
            │                     │
   tracking intenso        tracking reduzido

Além disso, o Frigate possui tratamento para PTZ: seu tracker consegue levar em consideração movimento da própria câmera para preservar os objetos acompanhados.

Então não seria justo comparar:

ByteTrack versus Norfair

e concluir:

Norfair ganhou.

A comparação correta para vocês seria:

ByteTrack atual do AjustCam

versus

Norfair + toda a lógica de tracking do Frigate.

Aí sim o Frigate atualmente é mais sofisticado.

Para o AjustCam, eu trocaria ByteTrack?

Não neste momento.

Eu manteria:

YOLO26 / OpenVINO
        ↓
     ByteTrack

Porque ByteTrack já resolve muito bem:

pessoa andando;
múltiplas pessoas;
carro;
moto;
oclusões curtas;
confiança oscilando;
trackId;
câmera fixa.

O maior ganho para o AjustCam agora não viria de:

ByteTrack → Norfair

O maior ganho viria de:

                         AjustCam atual
                              │
                              ▼
                         ByteTrack
                              │
                 +------------+-------------+
                 │                          │
          Object lifecycle           Motion awareness
                 │                          │
          active/stationary          região mudou?
                 │                          │
                 +------------+-------------+
                              │
                    controle da inferência
Eu implementaria algo assim no AjustCam

Cada track teria algo semelhante a:

trackId: 27
class: person


state:
  NEW
  ACTIVE
  STATIONARY
  LOST
  ENDED

Fluxo:

Pessoa aparece
      ↓
    NEW
      ↓
confirma 3 detecções
      ↓
   ACTIVE
      ↓
ByteTrack acompanha
      ↓


Ficou parada?
   ├─ NÃO → ACTIVE
   │
   └─ SIM
       ↓
   STATIONARY
       ↓
 reduzir frequência
 de YOLO sobre ela
       ↓
 movimento detectado?
       ↓
      SIM
       ↓
     ACTIVE

Para uma pessoa, talvez usar algo como:

2–5 segundos parada

antes de mudar o comportamento.

Para um carro, algo como:

10–30 segundos

dependendo da finalidade.

Isso precisaria ser calibrado.

Por que isso é muito mais importante do que trocar o tracker

Considere 20 câmeras, cada uma com 5 FPS de análise.

Temos potencialmente:

20 × 5
=
100 frames/s

Se o detector trabalhar constantemente:

100 oportunidades de inferência/s

Agora imagine que em determinado momento:

15 câmeras estão praticamente paradas;
3 possuem carros estacionados;
somente 2 possuem pessoas andando.

O sistema inteligente deveria se aproximar de:

15 câmeras
     ↓
motion quase zero
     ↓
pouquíssimo YOLO


3 câmeras
     ↓
objetos stationary
     ↓
YOLO esporádico


2 câmeras
     ↓
objetos ACTIVE
     ↓
YOLO + ByteTrack intenso

Essa é a ideia por trás da eficiência do Frigate. Motion detection é usada como primeira linha para decidir quais partes do frame realmente merecem análise pesada.

Portanto, para o AjustCam eu faria nesta ordem

1. Manter ByteTrack.

2. Criar ACTIVE / STATIONARY / LOST.

3. Fazer MOG2/motion influenciar diretamente quando o YOLO roda.

4. Revalidar objeto estacionário periodicamente.

5. Ativar region detection de forma madura.

6. Depois avaliar se ByteTrack realmente está apresentando ID switches problemáticos.

Somente se após isso vocês observarem problemas como:

Pessoa 12
   ↓
cruza com outra pessoa
   ↓
vira Pessoa 15


ou


PTZ mexe
   ↓
todos os IDs são perdidos

eu consideraria investir em um tracker mais customizado, seja Norfair ou uma camada adicional em torno do ByteTrack.

Para o cenário principal do AjustCam — detecção de pessoa + quadrado acompanhando-a em câmeras de segurança fixas — eu considero ByteTrack uma escolha muito boa e não vejo uma justificativa técnica forte para substituí-lo agora. O ganho mais relevante está na lógica ao redor dele, principalmente stationary objects + motion-driven inference.

fale para uma IA de produção de desenvolvimento o que ela precisa fazer especificamente para o ajustcam alcançar o frigate em Stationary object , Tracking , Motion detection  , Objeto estacionário , Reidentificação/controle avançado PTZ   , Tracking com câmera se movimentando  , Otimização para objetos estacionários  

Sim. E há um ponto importante: “Stationary object”, “Objeto estacionário” e “Otimização para objetos estacionários” fazem parte do mesmo subsistema. Não devem virar três implementações separadas.

No AjustCam atual, o motion detector já tem MOG2, componentes conectados, descarte de sombras, zonas, detecção de mudança global de cena e congelamento temporário do aprendizado do background. O detector de objetos já usa ByteTrack por câmera/classe, mas a detecção por regiões — justamente onde existe o cache inicial de objetos estacionários — continua desativada por padrão.

Abaixo está o texto que eu entregaria diretamente para uma IA de desenvolvimento com acesso ao repositório.

MISSÃO

Evolua o motor de IA do AjustCam/DRAC para atingir nível técnico equivalente ou superior ao Frigate especificamente nestes pontos:

Motion Detection;
Object Tracking;
Stationary Objects;
otimização de inferência para objetos estacionários;
continuidade de trackId;
oclusão;
ReID dentro da mesma câmera;
tracking durante movimento da câmera;
PTZ autotracking;
continuidade de ID durante pan/tilt/zoom;
redução de CPU/GPU/NPU sem perder eventos.

Não reescreva o sistema inteiro.

Não substitua ByteTrack imediatamente.

A prioridade é construir uma camada profissional ao redor do tracker atual, medir o resultado e somente depois decidir, por benchmark, se ByteTrack deve continuar sendo o tracker principal ou se Norfair deve ser usado em determinados modos.

1. ESTADO ATUAL QUE DEVE SER PRESERVADO

O AjustCam já possui:

MotionDetector;
MOG2;
connected components;
tratamento de sombras;
detecção de mudança global de cena;
normalização de contraste;
zonas;
várias motion boxes;
ByteTrack;
trackId;
tracker separado por câmera/classe;
latest-frame semantics;
fila de frame tamanho 1;
region proposal;
cache inicial de objeto estacionário;
stationary_skip;
stationary_interval;
stationary_iou;
stationary_max_age;
periodic sweep;
reutilização da última detecção estacionária.

Não destruir essas funcionalidades.

O código atual já possui MotionRegionPlanner, mas GENERAL_REGION_DETECTION está desligado por padrão. O planner consegue carregar um objeto parado do cache, reavaliá-lo periodicamente e reativar inferência quando movimento toca sua área.

O problema é que isso ainda funciona principalmente como cache de detecção/região, e não como um ciclo de vida completo controlado pelo trackId.

Precisamos transformar:

region cache

em:

tracked-object lifecycle.

2. ARQUITETURA ALVO

A arquitetura de IA deverá seguir conceitualmente:

RTSP/substream
      │
      ▼
Frame Capture
      │
      ▼
Motion Engine
      │
      ├──────────────► Scene Change Detector
      │
      ▼
Motion Regions
      │
      ▼
Inference Scheduler
      │
      ├── região com movimento
      ├── active track
      ├── stationary track vencido
      ├── startup scan
      ├── periodic sweep
      └── PTZ/camera motion recovery
      │
      ▼
Object Detector
YOLO/OpenVINO
      │
      ▼
Tracker Backend
ByteTrack inicialmente
      │
      ▼
Track Lifecycle Manager
      │
 ┌────┼────────┬──────────┬───────┐
NEW ACTIVE STATIONARY OCCLUDED LOST
 └────┴────────┴──────────┴───────┘
      │
      ▼
Appearance/ReID Manager
      │
      ▼
Camera Motion Compensation
      │
      ▼
PTZ AutoTracker
      │
      ▼
Event / Overlay / Recording

Cada responsabilidade deve ficar isolada.

Não coloque toda essa lógica dentro de stream_processor.py.

3. CRIAR UM TRACK LIFECYCLE MANAGER

Criar uma nova camada de estado entre detector/tracker e evento/overlay.

Cada objeto rastreado deverá possuir no mínimo:

track_id
camera_id
class_id
label

state

bbox
predicted_bbox
previous_bbox

confidence
best_confidence

first_seen_at
last_seen_at
last_detector_at
last_motion_at

age_ms
hits
misses

motionless_since
motionless_duration_ms
position_changes

velocity_x
velocity_y

stationary_anchor_bbox

appearance_signature
appearance_history

occluded_since
lost_since

ptz_session_id

detector_checks
stationary_skips

Estados obrigatórios:

NEW
ACTIVE
STATIONARY
OCCLUDED
LOST
ENDED

Fluxo:

           ┌───────┐
           │  NEW  │
           └───┬───┘
               │
          confirmado
               ▼
          ┌────────┐
          │ ACTIVE │
          └───┬────┘
              │
         parou tempo
         suficiente
              ▼
       ┌────────────┐
       │ STATIONARY │
       └─────┬──────┘
             │
        voltou mover
             ▼
          ACTIVE

Em perda temporária:

ACTIVE
   │
detector perdeu
   ▼
OCCLUDED
   │
   ├── reapareceu compatível → ACTIVE, MESMO trackId
   │
   └── timeout → LOST
                   │
                   ├── ReID encontrou → ACTIVE
                   │
                   └── TTL acabou → ENDED
4. NÃO BASEAR TEMPO APENAS EM "NÚMERO DE FRAMES"

O AjustCam possui:

FPS adaptativo;
frame dropping;
latest-frame-only;
diferentes modos de QoS.

Portanto, stationary, occlusion e lost tracking não podem depender somente de:

motionless_count += 1

Armazenar também timestamps monotônicos.

Exemplo:

stationary_after_ms
occlusion_grace_ms
lost_ttl_ms
reid_ttl_ms
stationary_recheck_ms

Isso evita que alterar de 5 FPS para 2 FPS altere silenciosamente o comportamento temporal do tracker.

5. STATIONARY OBJECT DE VERDADE

O mecanismo existente em region_proposal.py deve ser evoluído.

Hoje ele compara principalmente IoU para aumentar motionless e possui cache próprio.

Não remover isso imediatamente.

Refatorar para que a decisão final de stationary pertença ao TrackLifecycleManager.

Para cada track, manter histórico das últimas bounding boxes:

bbox_history = últimas 10–30 posições

Calcular:

IoU com caixa média
IoU com caixa mediana
deslocamento do centro
deslocamento do bottom-center
variação de largura
variação de altura
velocidade estimada

Não definir estacionário simplesmente por:

IoU > 0.85

Utilizar combinação de estabilidade espacial.

Exemplo:

center displacement < limite
AND
median IoU > limite
AND
velocity < limite
AND
sem motion relevante sobre o objeto

Depois de tempo configurável:

ACTIVE → STATIONARY

O Frigate mantém histórico espacial, calcula caixas médias/medianas e utiliza IoU para decidir se o objeto continua parado ou voltou a se mover.

Implementar conceito equivalente no AjustCam.

6. CONFIGURAÇÃO POR CLASSE

Stationary não deve ter um único valor para tudo.

Criar configuração semelhante a:

stationary:
  enabled: true

  default:
    threshold_seconds: 10
    recheck_seconds: 10

  objects:
    person:
      threshold_seconds: 5
      recheck_seconds: 3

    car:
      threshold_seconds: 10
      recheck_seconds: 15

    motorcycle:
      threshold_seconds: 10
      recheck_seconds: 10

Não hardcodar essas sugestões.

Elas devem ser configuráveis.

O Frigate utiliza por padrão um threshold equivalente a aproximadamente 10 segundos e permite tratamento específico por tipo de objeto.

7. OBJETO STATIONARY NÃO DEVE DESAPARECER

Depois que:

car ID 47

vira:

STATIONARY

não continuar rodando YOLO continuamente apenas para manter seu quadrado.

Guardar:

track_id = 47
bbox
class
confidence
stationary_anchor
last_confirmed

Enquanto não houver razão para nova inferência:

retornar o track pelo cache

O overlay continua exibindo:

CAR
ID 47
STATIONARY

Apenas a inferência deixa de ser feita frequentemente.

8. QUANDO REANALISAR UM STATIONARY OBJECT

Executar nova inferência se ocorrer qualquer uma destas condições:

motion box intersectar sua área;
vencer stationary_recheck_ms;
ocorrer mudança global de cena;
PTZ/câmera começar a mover;
câmera terminar movimento;
confidence/state se tornar inconsistente;
região adjacente apresentar movimento;
acontecer periodic sweep;
track entrar em processo de ReID;
operador solicitar debug/force detect.

Fluxo:

CAR ID 47
STATIONARY
     │
     ├── sem movimento
     │      ↓
     │   reuse cache
     │
     ├── intervalo venceu
     │      ↓
     │   YOLO confirma
     │
     └── movimento encostou
            ↓
         YOLO imediato
            ↓
         ACTIVE se moveu
9. REMOVER INFERÊNCIA FULL-FRAME DESNECESSÁRIA

Atualmente, no modo avançado, should_run_advanced continua sendo baseado principalmente no intervalo de FPS, independentemente da existência de movimento.

Isso precisa mudar.

Criar um InferenceScheduler.

O YOLO deve rodar quando existir uma razão de inferência.

Exemplo:

reason =
    motion_region
    or active_track_due
    or stationary_recheck_due
    or startup_scan
    or periodic_sweep
    or ptz_recovery
    or camera_motion_recovery

Se nenhuma condição existir:

NÃO rodar detector pesado.

Esta é uma das mudanças de maior importância.

O Frigate utiliza motion detection justamente como primeira linha para decidir onde object detection precisa trabalhar.

10. ATIVAR REGION DETECTION COMO PARTE REAL DO PIPELINE

Não simplesmente alterar:

GENERAL_REGION_DETECTION=false

para true e considerar concluído.

Primeiro endurecer e testar.

O pipeline deverá ser:

MOG2
 ↓
motion boxes
 ↓
cluster
 ↓
merge
 ↓
expand
 ↓
square region
 ↓
detector

Manter:

mínimo de região;
margem;
limite máximo de regiões;
união quando ultrapassar limite;
periodic sweep;
cache;
deduplicação.

O código existente já possui boa parte disso. Aproveitar a implementação existente.

11. NÃO USAR FULL FRAME A CADA CICLO QUANDO A CENA ESTÁ VAZIA

Hoje idle_full_frame=True preserva o comportamento antigo e evita cegueira ao habilitar region detection.

Isso é bom para migração, mas não deve permanecer como estratégia final.

Implementar:

startup scan
+
motion driven detection
+
periodic sweep

Exemplo:

Inicialização
     ↓
full-frame scan

Depois:

sem movimento
     ↓
sem detector pesado

movimento
     ↓
region inference

a cada X segundos
     ↓
sweep de segurança

Isso deverá ser fail-safe e configurável.

12. MOTION DETECTION

Não trocar o MOG2 simplesmente porque Frigate faz diferente.

A implementação atual já possui várias melhorias importantes.

Manter e evoluir.

Separar conceitualmente:

Detection Zones

de:

Motion Masks

Motion mask serve para elementos que nunca devem acordar o detector:

timestamp;
árvore;
bandeira;
reflexo constante;
rua irrelevante;
elementos de interface na câmera.

Detection zone serve para regras de negócio/eventos.

Não misturar os dois conceitos.

13. MOTION DEBUGGER

Criar métricas/debug visual para mostrar:

motion mask
foreground mask
motion components
motion boxes
proposed regions
stationary boxes
active boxes
inference regions
inference reason

No frontend/debug endpoint, permitir diagnosticar:

Por que o YOLO rodou neste frame?

Mostrar algo como:

reason=motion
reason=stationary_recheck
reason=periodic_sweep
reason=ptz_recovery
reason=active_track
14. TRACKING — MANTER BYTETRACK NA PRIMEIRA ETAPA

O AjustCam atualmente instancia ByteTrack por contexto/câmera e classe.

Não remover.

Criar abstração:

class TrackerBackend:
    update(...)
    reset(...)
    get_tracks(...)

Implementações:

ByteTrackBackend
NorfairBackend

Configuração:

TRACKER_BACKEND=bytetrack

Depois:

TRACKER_BACKEND=norfair

deve permitir benchmark A/B sem alterar o restante do pipeline.

15. NÃO CONFUNDIR TRACKER COM TRACK LIFECYCLE

ByteTrack deverá responder principalmente:

qual detection pertence a qual track?

O TrackLifecycleManager deverá responder:

esse track está ativo?
estacionário?
ocluído?
perdido?
terminado?
quando deve ser reavaliado?

Essa separação é obrigatória.

16. MELHORAR CONTINUIDADE DE ID

Adicionar associação secundária para situações em que o ByteTrack perde temporariamente a pessoa.

Utilizar:

classe
+
posição prevista
+
bbox
+
bottom-center
+
tamanho
+
aspect ratio
+
velocidade
+
aparência
+
tempo desde última visualização

O Frigate utiliza uma função de distância que leva em consideração posição e dimensões da bounding box, além de filtros Kalman específicos.

O AjustCam deve implementar conceito equivalente no lifecycle/ReID mesmo que continue usando ByteTrack.

17. OCCLUSION

Criar estado explícito:

OCCLUDED

Exemplo:

ID 14
pessoa andando
     ↓
passa atrás de carro
     ↓
YOLO perde por 800 ms
     ↓
OCCLUDED
     ↓
Kalman/predição continua
     ↓
pessoa reaparece
     ↓
ReID + geometria
     ↓
continua ID 14

Não criar imediatamente novo ID.

O track deve ter occlusion_grace_ms.

Durante esse período:

prever posição;
não gerar END;
não gerar novo evento;
procurar detecção compatível.
18. REIDENTIFICAÇÃO — REID

Implementar ReID em duas etapas.

Etapa 1 — leve

Usar aparência barata:

HSV/RGB histogram

ou descriptor semelhante.

Calcular apenas em crops bons:

bounding box suficientemente grande;
sem forte blur;
confidence adequada;
objeto visível.

Guardar histórico:

appearance_history = últimos N descriptors

O Frigate atualmente usa histograma como embedding em seu tracking PTZ para auxiliar associação/reidentificação.

Etapa 2 — opcional

Criar interface:

AppearanceEmbedder

para futuramente suportar:

OSNet
MobileNet ReID
FastReID
outro embedding

Não tornar um modelo pesado obrigatório.

19. CUSTO DE REIDENTIFICAÇÃO

Criar função semelhante conceitualmente a:

association_score =
    geometry_score
  + appearance_score
  + motion_score
  + size_score
  + temporal_score

Com hard gates:

classe incompatível → rejeitar

tempo excessivo → rejeitar

distância impossível → rejeitar

Aparência não pode sozinha reassociar pessoas em pontos geometricamente impossíveis.

20. TRACKING COM CÂMERA SE MOVIMENTANDO

Este é um subsistema novo obrigatório.

Quando uma câmera PTZ gira:

antes:
Pessoa ID 14 em x=700

PTZ gira 30°

depois:
Pessoa ID 14 aparece em x=300

Para o tracker tradicional parece que:

ID 14 sumiu
+
nova pessoa apareceu

Isso precisa ser corrigido.

Criar:

CameraMotionEstimator
21. CAMERA MOTION ESTIMATOR

Suportar inicialmente:

TRANSLATION

para pan/tilt.

Depois:

HOMOGRAPHY

quando zoom ou transformação mais complexa estiver ativa.

O Frigate usa TranslationTransformationGetter para pan/tilt e HomographyTransformationGetter quando zoom está envolvido.

Implementar conceito semelhante.

22. NÃO CALCULAR MOVIMENTO DA CÂMERA USANDO A PRÓPRIA PESSOA

Durante estimativa do movimento global:

frame anterior
       ↓
features estáticas

frame atual
       ↓
features estáticas

Mas criar máscara excluindo:

boxes de pessoas
boxes de carros
outros objetos móveis
motion masks

O Frigate também exclui bounding boxes detectadas antes de estimar o movimento da câmera.

Isso é obrigatório.

23. APLICAR A TRANSFORMAÇÃO AOS TRACKS

Se a câmera moveu:

T = transformação estimada

Antes da associação:

bbox_previous
     ↓
transform(T)
     ↓
predicted_bbox_in_new_camera_coordinates

Depois comparar a nova detecção com essa caixa corrigida.

Pipeline:

track antigo
    ↓
Kalman prediction
    ↓
camera transform
    ↓
predicted location
    ↓
nova detection
    ↓
association

Assim o trackId pode sobreviver ao movimento físico da câmera.

24. TRATAR TRANSFORMAÇÕES INVÁLIDAS

Nunca confiar cegamente em homography.

Validar:

NaN
Infinity
matriz degenerada
quantidade insuficiente de features
erro reprojection excessivo

Se transformação for inválida:

descartar transformação
resetar estimator
não contaminar tracker

O Frigate implementa proteção explícita contra transformações não finitas em seu estimator PTZ.

25. PTZ AUTOTRACKING

Criar módulo independente:

PtzAutoTracker

Estados:

IDLE
ACQUIRE
TRACKING
MOVING
SETTLING
LOST
RETURNING
26. SELEÇÃO DO OBJETO PARA PTZ

Configuração por câmera:

ptz_autotracking:
  enabled: true

  track:
    - person

  required_zones:
    - entrada

  return_preset: home

  timeout_seconds: 10

Selecionar track considerando:

classe
confidence
tempo vivo
zona
state
tamanho
prioridade

Depois de selecionar:

target_track_id = 14

manter o mesmo alvo.

Não trocar continuamente para outra pessoa apenas porque apareceu confidence maior.

27. DEAD ZONE E HYSTERESIS PTZ

Não mandar ONVIF move em cada frame.

Criar área central:

┌────────────────────────────┐
│                            │
│       ┌────────────┐       │
│       │ DEAD ZONE  │       │
│       │    👤      │       │
│       └────────────┘       │
│                            │
└────────────────────────────┘

Enquanto o alvo estiver dentro dela:

não mover câmera.

Isso evita:

tremedeira;
comandos excessivos;
motor oscilando;
perda do target por movimentos mínimos.

Adicionar hysteresis.

28. CALIBRAÇÃO PTZ

Implementar rotina de calibração por câmera.

Executar movimentos pequenos conhecidos:

pan +X
pan -X
tilt +Y
tilt -Y

Medir:

comando ONVIF
→
tempo do motor
→
deslocamento visual observado

Construir parâmetros:

movement_weights
pan_coefficient
tilt_coefficient
latency

Persistir por câmera.

O Frigate calibra movimentos PTZ, mede o tempo e utiliza os dados para estimar onde o objeto ficará após o movimento; posteriormente os parâmetros podem continuar sendo refinados.

Implementar conceito equivalente.

29. PTZ MOVE STATUS

Consultar via ONVIF:

MOVING
IDLE
UNKNOWN

Registrar:

ptz_move_start
ptz_move_stop

O CameraMotionEstimator deve saber exatamente quando a própria câmera está em deslocamento.

Adicionar timeout porque alguns firmwares ONVIF podem fornecer status incorreto.

Nunca bloquear indefinidamente esperando IDLE.

30. PTZ + REID

Durante movimento PTZ:

track ID 14
     ↓
camera move
     ↓
camera motion compensation
     ↓
predicted bbox
     +
appearance descriptor
     ↓
nova detection
     ↓
ID 14

Não depender somente de IoU.

IoU provavelmente será baixo após grande movimento PTZ.

Usar:

geometry corrigida
+
appearance
+
classe
+
tempo
31. ZOOM

Implementar somente depois de pan/tilt estar estável.

Para zoom:

translation

não é suficiente.

Usar:

homography

ou transformação equivalente.

Aplicar limites:

zoom_min
zoom_max
zoom_factor
zoom_cooldown

Não preencher a tela inteira com a bounding box.

É necessário contexto visual ao redor do objeto para estimar movimento da câmera.

32. RETORNO AO PRESET

Quando:

target LOST
+
reid timeout expirou

aguardar:

return_timeout

e então:

MoveToPreset(home)

Ao retornar:

reset CameraMotionEstimator
reset PTZ tracking session

Não apagar tracks de outras funções da câmera sem necessidade.

33. SCENE CHANGE E PTZ NÃO SÃO A MESMA COISA

O MotionDetector atual já detecta grandes mudanças de cena e recalibra o background.

Quando a mudança for causada por PTZ conhecido:

sceneChangeReason=ptz

Quando for:

IR
luz
relâmpago
exposição
manual movement

classificar separadamente quando possível.

A gravação não deve ser perdida.

Mas o object detector pode aguardar estabilização curta do background quando necessário.

34. MÉTRICAS OBRIGATÓRIAS

Criar métricas por câmera:

motion_frames_total

detector_runs_total
detector_skipped_total

detector_runs_by_reason:
  motion
  active_track
  stationary_recheck
  sweep
  ptz_recovery

tracks_created
tracks_ended

id_switches_estimated
tracks_reidentified

tracks_active
tracks_stationary
tracks_occluded
tracks_lost

stationary_skips
stationary_rechecks
stationary_reactivations

camera_motion_runs
camera_motion_failures

ptz_moves
ptz_target_lost
ptz_target_recovered

average_track_duration
average_inference_ms
35. DEBUG POR TRACK

Deve ser possível consultar:

Camera 01

ID 14
person
ACTIVE

age: 00:01:42
confidence: 0.87
velocity: 12 px/s

stationary: false
motionless: 0.8 s

last detector: 120 ms
last motion: 80 ms

appearance similarity: 0.91

Para estacionário:

ID 31
car
STATIONARY

stationary_for: 18m32s
detector_skips: 5421
last_recheck: 4.2s
next_recheck: 5.8s
36. TESTES AUTOMATIZADOS OBRIGATÓRIOS

Criar fixtures de vídeo para:

Teste A — pessoa andando

Esperado:

NEW → ACTIVE
mesmo ID durante trajeto
Teste B — pessoa para
ACTIVE
→
STATIONARY

O ID não muda.

Teste C — pessoa volta a andar
STATIONARY
→
ACTIVE

Mesmo ID.

Teste D — carro estacionado

Manter mesmo ID por longo período sem executar YOLO continuamente.

Teste E — oclusão
Pessoa
→
poste
→
some
→
reaparece

Deve recuperar o mesmo ID.

Teste F — duas pessoas cruzando

Evitar:

ID 10 ↔ ID 11
Teste G — carro estacionado + carro passando

O carro estacionado não pode assumir o ID do carro que passa.

Este tipo de problema foi uma das motivações das customizações de tracking do Frigate.

Teste H — pan PTZ

Pessoa permanece com mesmo ID.

Teste I — tilt PTZ

Mesmo ID.

Teste J — zoom PTZ

Mesmo ID quando visualmente possível.

Teste K — PTZ move e volta

Sem explosão de novos IDs.

Teste L — IR day/night

Não criar dezenas de falsos objetos.

Teste M — árvore/vento

Motion pode acontecer, mas object inference deve ser controlada.

Teste N — chuva

Não permitir explosão de regiões/inferências.

37. BENCHMARK BYTETRACK VS NORFAIR

Depois que o lifecycle estiver pronto, implementar benchmark:

mesmos vídeos
mesmo YOLO
mesmas detections

Comparar:

ByteTrack
vs
Norfair

Métricas:

ID switches
track fragmentation
recovery after occlusion
false associations
CPU
latency
memory
PTZ continuity

Não trocar ByteTrack baseado em opinião.

Trocar somente se Norfair demonstrar vantagem mensurável.

Pode inclusive existir:

câmera fixa:
ByteTrack

PTZ:
Norfair

se benchmark justificar.

38. CRITÉRIOS INTERNOS DE ACEITAÇÃO

Estes são objetivos do AjustCam, não métricas publicadas do Frigate.

A implementação só pode ser considerada pronta quando:

Stationary

Em vídeo de estacionamento estático:

redução de inferências >= 70%

comparado ao pipeline full-frame atual, sem perder entrada/saída de pessoas e veículos.

Objetivo desejável:

80–90%+

em cenas muito estáticas.

Reativação

Objeto estacionário que volta a se mover deve retornar para ACTIVE em no máximo poucos ciclos de detecção.

ID

O mesmo objeto não pode ganhar novo ID simplesmente porque ficou parado.

Occlusion

Ocultações curtas devem preservar ID na grande maioria dos clips de teste.

PTZ

Movimento comandado pelo próprio sistema não pode automaticamente destruir todos os tracks.

Cena vazia

Uma câmera totalmente parada não deve continuar consumindo object detector a FPS constante sem motivo.

39. ROLLOUT

Tudo inicialmente atrás de flags:

TRACK_LIFECYCLE_ENABLED
STATIONARY_TRACKING_ENABLED
MOTION_DRIVEN_INFERENCE
REGION_DETECTION_ENABLED
TRACK_REID_ENABLED
CAMERA_MOTION_COMPENSATION
PTZ_AUTOTRACKING
TRACKER_BACKEND

Etapas:

1. desenvolvimento
2. unit tests
3. vídeos offline
4. shadow mode
5. uma câmera piloto
6. cinco câmeras
7. produção parcial
8. default ON
40. SHADOW MODE

Antes de permitir que o novo scheduler deixe de executar inferências:

rodar em modo:

shadow

A lógica nova calcula:

eu teria pulado este detector

mas ainda executa o detector antigo.

Comparar:

detections_old
vs
detections_new

Só depois permitir que o novo sistema realmente economize inferência.

Isso reduz risco de câmera ficar cega por erro de scheduler.

41. NÃO QUEBRAR AS GARANTIAS DO VMS

O AjustCam é VMS.

Portanto:

erro de IA nunca pode significar perda de gravação.

Se:

tracker falhar
motion falhar
ReID falhar
PTZ estimator falhar
region scheduler falhar

a gravação deve continuar.

Preferir:

mais processamento

a:

perder evidência.

A otimização de IA nunca deve alterar a integridade do recording pipeline.

42. ORDEM EXATA DE IMPLEMENTAÇÃO

Executar nesta ordem:

FASE 1

Track Lifecycle Manager.

NEW
ACTIVE
STATIONARY
OCCLUDED
LOST
ENDED
FASE 2

Integrar lifecycle ao ByteTrack existente.

FASE 3

Mover stationary cache para identidade baseada em trackId.

FASE 4

Completar stationary detection usando histórico espacial.

FASE 5

Criar Inference Scheduler.

FASE 6

Ativar motion-driven region detection em shadow mode.

FASE 7

Ativar stationary inference skipping.

FASE 8

Implementar periodic recheck/sweep.

FASE 9

Implementar ReID leve.

FASE 10

Implementar occlusion recovery.

FASE 11

Criar CameraMotionEstimator.

FASE 12

Aplicar transformação global aos tracks.

FASE 13

Implementar PTZ autotracking pan/tilt.

FASE 14

Implementar calibração PTZ.

FASE 15

Implementar ReID durante PTZ.

FASE 16

Implementar zoom/homography.

FASE 17

Benchmark ByteTrack vs Norfair.

FASE 18

Escolher backend final por dados.

43. RESULTADO FINAL ESPERADO

O comportamento desejado deve ser:

Pessoa entra
    ↓
Motion
    ↓
Region
    ↓
YOLO
    ↓
ByteTrack/Norfair
    ↓
ID 14
    ↓
ACTIVE
    ↓
tracking contínuo

Pessoa para
    ↓
STATIONARY
    ↓
reduzir YOLO
    ↓
manter ID 14

Pessoa volta a andar
    ↓
Motion cruza track
    ↓
YOLO imediato
    ↓
ACTIVE
    ↓
continua ID 14

Pessoa fica ocluída
    ↓
OCCLUDED
    ↓
predição + ReID
    ↓
reaparece
    ↓
continua ID 14

PTZ gira
    ↓
CameraMotionEstimator
    ↓
transformar track
    ↓
ReID
    ↓
continua ID 14

Pessoa sai
    ↓
LOST
    ↓
ReID timeout
    ↓
ENDED

PTZ
    ↓
retorna ao preset
REGRA FINAL

Não trate este trabalho como:

"adicionar stationary object".

Trate como a criação de um Tracked Object Intelligence Layer.

A arquitetura final deve separar claramente:

MOTION
    ↓
onde olhar?

DETECTOR
    ↓
o que existe?

TRACKER
    ↓
qual detecção pertence a qual objeto?

LIFECYCLE
    ↓
qual é o estado desse objeto?

STATIONARY MANAGER
    ↓
precisamos continuar inferindo?

REID
    ↓
é o mesmo objeto que desapareceu?

CAMERA MOTION COMPENSATION
    ↓
o objeto moveu ou a câmera moveu?

PTZ AUTOTRACKER
    ↓
a câmera deve seguir esse objeto?

Somente quando essas responsabilidades estiverem independentes, testadas e observáveis considerar o AjustCam no mesmo patamar arquitetural do Frigate nestas áreas.

O ponto que eu colocaria como prioridade absoluta para a IA é: não começar pelo PTZ. Primeiro fazer ACTIVE → STATIONARY → OCCLUDED → LOST, integrar isso ao ByteTrack e fazer o YOLO deixar de rodar desnecessariamente. Depois o CameraMotionEstimator entra por cima. No Frigate atual, o próprio tracker recebe transformações de coordenadas produzidas pelo estimador PTZ, e há configuração específica de tracking/ReID para PTZ; é essa separação que vale reproduzir conceitualmente.

Também considero que o AjustCam está mais perto disso do que parecia inicialmente: region_proposal.py já contém uma boa parte da fundação de stationary/region scheduling. O trabalho agora é parar de tratá-la como uma otimização opcional isolada e torná-la parte do lifecycle real dos objetos