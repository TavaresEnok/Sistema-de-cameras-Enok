# MOG2 endurecido — proteções inspiradas no Frigate

## Objetivo

Reduzir gravações causadas por nuvem, luz, exposição automática, troca de IR,
ruído noturno, árvore/água e fontes periódicas sem transformar o detector em um
filtro agressivo que deixe de gravar pessoas e veículos.

## Pipeline implantado

1. Redimensionamento para 320×180 a 2 FPS.
2. Compensação fotométrica global por mediana, coerência espacial em grade e
   resíduo por pixel. O deslocamento global de luz é removido apenas no frame de
   análise; diferenças locais permanecem para o MOG2.
3. Normalização de contraste e Gaussian blur antes do modelo.
4. MOG2 com descarte de sombras.
5. Máscaras e sensibilidade por zona.
6. Morfologia e componentes conectados.
7. Supressão de atividade crônica, periodicidade e piso de ruído adaptativo.
8. Confirmação temporal, caminho rápido para objetos grandes e teto de caixas.
9. Mudança de cena não fotométrica continua reportada e recalibra o fundo.
10. Recalibração também zera piso de ruído, periodicidade e mapa crônico para
    não carregar regiões cegas da cena anterior.

## Salvaguardas

- Luz global + pessoa simultânea é um teste obrigatório: a luz é compensada e a
  pessoa continua detectada.
- Movimento geométrico da câmera não é classificado como simples iluminação.
- Mudança global não uniforme continua gerando `sceneChange=true`.
- A telemetria do `/health` mostra contadores e o último motivo de supressão.
- `MOTION_ILLUMINATION_COMPENSATION=false` restaura o caminho anterior.
- `MOTION_PHOTOMETRIC_SCENE_SUPPRESSION=false` mantém a compensação, mas impede
  que uma mudança fotométrica residual seja descartada.

## Correção metodológica

O primeiro A/B registrado neste documento consumia um quadro bruto por
referência de 2 FPS. Como os vídeos são 30 FPS, ele comparava somente os dois
primeiros minutos de vídeo com rótulos distribuídos pelos trinta minutos. Os
artefatos `hardening-v1` e `hardening-day-v2` foram preservados para auditoria,
mas seus números não devem orientar decisão de produto.

O benchmark atual usa o campo `source_frame` da referência semântica e lê o
quadro exato de origem. Cada variante abaixo processou os 3.600 quadros
amostrados ao longo de 30 minutos de cada uma das seis câmeras noturnas.

## A/B noturno corrigido — MOG2

Referência semântica: YOLO26n/YOLO26s + associação temporal + fluxo óptico.
O relógio do replay é fixado nos timestamps do vídeo para manter a
periodicidade determinística.

| Métrica agregada | MOG2 anterior | MOG2 endurecido |
|---|---:|---:|
| Eventos semânticos detectados | 53/268 | 53/268 |
| Eventos de produto | 88 | 88 |
| Eventos confirmados por objeto móvel | 38 | 38 |
| Eventos não confirmados* | 50 | 50 |
| Fração média de quadros ativos | 12,6% | 12,7% |
| Mediana média por frame | 2,94 ms | 4,80 ms |
| Quadros de luz global compensados | — | 16 |

\*Não confirmado pelo proxy semântico não equivale automaticamente a falso
positivo; uma revisão humana ainda é necessária para essa classificação.

O endurecimento não perdeu eventos neste conjunto, mas também não elevou a
detecção agregada. O custo adicional é cerca de 1,9 ms por quadro, ou 0,38% de
um núcleo por câmera a 2 FPS.

## Detector original do Frigate — comparação isolada

Foi executado, sem alterações, o `ImprovedMotionDetector` do checkout local do
Frigate (commit `39a3667`, licença MIT; SHA-256 do arquivo `9c311f…e92a8`).
Somente o contrato mínimo de configuração foi adaptado no laboratório; a lógica
do detector foi carregada diretamente do arquivo do Frigate.

| Métrica agregada | MOG2 endurecido | Frigate padrão | Frigate 40/20 | Frigate 50/30 |
|---|---:|---:|---:|---:|
| Eventos semânticos detectados | 53/268 | 187/268 | 154/268 | 133/268 |
| Eventos de produto | 88 | 50 | 56 | 58 |
| Eventos confirmados | 38 | 24 | 39 | 43 |
| Eventos não confirmados* | 50 | 26 | 17 | 15 |
| Fração média de quadros ativos | 12,7% | 85,1% | 62,8% | 51,0% |
| Mediana média por frame | 4,80 ms | 1,00 ms | 0,94 ms | 1,13 ms |

`40/20` e `50/30` significam, respectivamente, limiar de pixel e área mínima
de contorno do próprio Frigate; ambos mantêm o `skip_motion_threshold`
desligado. Com `skip_motion_threshold=0,4`, o Frigate recalibrou continuamente
nas seis câmeras e emitiu zero eventos — esse perfil foi rejeitado.

Conclusão: o Frigate é mais rápido e muito mais sensível, mas seu detector
isolado fica ativo em excesso para ser usado diretamente como gatilho de
gravação. O perfil 50/30 é o melhor ponto testado para qualidade, mas ainda
ativa metade dos quadros. Qualquer integração deve reaproveitar as proteções do
DRAC (zonas, atividade crônica, periodicidade, piso de ruído e política de
gravação) e passar por novo A/B diurno antes de substituir o MOG2.

Resultados brutos corrigidos:
`/home/flashnet/motion-bgs-lab/work/frigate-comparison-v1/`.

## Comparacao controlada — quatro motores com os filtros DRAC

O ensaio isolado acima responde como o Frigate se comporta sozinho, mas nao e
uma comparacao justa com o MOG2 de producao: o MOG2 recebia todas as protecoes
do DRAC e o Frigate nao. O segundo ensaio manteve invariantes:

- mesmos 21.600 quadros (seis cameras, 30 minutos por camera, 2 FPS);
- mesma compensacao de luz, contraste, blur, sombras e zonas;
- mesma morfologia, mudanca de cena, supressao cronica e periodica;
- mesmo piso adaptativo, componentes, confirmacao temporal e politica de evento;
- mesmo relogio simulado e mesma referencia semantica de 268 movimentos.

Somente o motor que produz a mascara inicial variou. Como o Frigate nao expoe
essa mascara, o benchmark usa um adaptador do seu nucleo de media movel,
`absdiff`, threshold 30 e regra de aprendizado de dez quadros. Dilatacao e
contornos do Frigate nao sao aplicados, pois seriam uma segunda filtragem antes
dos filtros comuns. O resultado e identificado como adaptador, nao como a
classe original sem alteracoes.

| Motor sob filtros DRAC | Movimentos detectados | Eventos | Confirmados | Nao confirmados* | Precisao proxy | Quadros ativos | Mediana/frame** |
|---|---:|---:|---:|---:|---:|---:|---:|
| KNN | **75/268 (28,0%)** | 98 | **43** | 55 | 43,9% | 13,5% | 6,40 ms |
| Frigate core | 68/268 (25,4%) | 95 | **43** | 52 | **45,3%** | 14,6% | **4,60 ms** |
| MOG2 | 53/268 (19,8%) | **88** | 38 | **50** | 43,2% | **12,7%** | 6,07 ms |
| PBAS | 50/268 (18,7%) | 91 | 33 | 58 | 36,3% | 11,8% | 13,36 ms |

\* Nao confirmado pela referencia YOLO/fluxo nao significa falso positivo sem
revisao humana. A coluna e um limite superior de suspeitas, nao verdade-terreno.

\** Tempo do pipeline inteiro durante o replay paralelo; serve para comparar
esta rodada, nao para dimensionar diretamente capacidade de producao.

No pareamento evento a evento, o KNN recuperou 29 movimentos que o MOG2 perdeu
e perdeu sete que o MOG2 encontrou (ganho liquido de 22). O nucleo Frigate
recuperou 22 e perdeu sete (ganho liquido de 15). Entre KNN e Frigate, o KNN
ganhou 18 movimentos e perdeu 11.

Conclusao deste conjunto noturno: PBAS nao justifica o custo nem a perda de
qualidade. KNN e o candidato mais sensivel; o nucleo Frigate oferece o melhor
equilibrio de custo e precisao proxy. Nenhum deve substituir o MOG2 apenas com
esta rodada: o proximo portao e revisao humana dos 50--58 eventos nao
confirmados e replay diurno/chuva, seguido por canario em poucas cameras.

Resultados brutos:
`/home/flashnet/motion-bgs-lab/work/common-filters-v1/`.

## Ampliação — Fast Self-Tuning, LOBSTER e ViBe sob filtros DRAC

Uma terceira rodada reutilizou exatamente os mesmos 21.600 quadros, referência
semântica, relógio, filtros e regra de eventos. Foram acrescentados:

- **Fast Self-Tuning BGS**: `MotionSaliencyBinWangApr2014` do OpenCV, baseado
  em Wang & Dudek (2014). O algoritmo requer 60 quadros de aquecimento a 2 FPS;
  o adaptador deixa o modelo aprender nesse período para não ser reiniciado pela
  própria proteção de mudança global do DRAC.
- **LOBSTER** e **ViBe clássico** da BGSLibrary.

ViBe+ não é sinônimo de ViBe: não foi localizado código canônico verificável
para o primeiro, portanto nenhum resultado abaixo recebe esse nome. M4CD
também não possui implementação canônica disponível no laboratório; uma
reimplementação própria não seria aceitável para orientar produto.

| Motor sob filtros DRAC | Movimentos detectados | Eventos | Confirmados | Não confirmados* | Precisão proxy | Quadros ativos | Mediana/frame** |
|---|---:|---:|---:|---:|---:|---:|---:|
| KNN | **75/268 (28,0%)** | 98 | **43** | 55 | 43,9% | 13,5% | 4,55 ms |
| Fast Self-Tuning | 69/268 (25,7%) | 90 | **43** | 47 | 47,8% | 13,0% | 9,04 ms |
| Frigate core | 68/268 (25,4%) | 95 | **43** | 52 | 45,3% | 14,6% | **3,42 ms** |
| LOBSTER | 61/268 (22,8%) | 84 | 36 | 48 | 42,9% | 13,0% | 21,22 ms |
| ViBe clássico | 54/268 (20,1%) | **75** | 36 | **39** | **48,0%** | 11,7% | 3,90 ms |
| MOG2 | 53/268 (19,8%) | 88 | 38 | 50 | 43,2% | 12,7% | 4,42 ms |
| PBAS | 50/268 (18,7%) | 91 | 33 | 58 | 36,3% | 11,8% | 9,95 ms |

\* Ainda é proxy semântico, não auditoria humana de falso positivo.

\** Pipeline inteiro durante o replay controlado; não usar diretamente como
dimensionamento de produção.

Dos 18 eventos que o operador revisou como movimentos reais e que o KNN
encontrou enquanto o núcleo Frigate perdeu, o KNN preservou 18; Fast
Self-Tuning preservou 6, LOBSTER 6, ViBe 3, PBAS 2, MOG2 5 e Frigate 0.

Conclusão: Fast Self-Tuning é o único novo candidato próximo do KNN, porém
custa aproximadamente o dobro e perde 23 movimentos que o KNN detectou,
enquanto só encontra 17 que o KNN não encontrou. LOBSTER é muito caro para o
ganho. ViBe é econômico e seletivo, mas perde movimentos demais. KNN continua
o candidato principal para a próxima ablação dos filtros DRAC.

Resultados brutos:
`/home/flashnet/motion-bgs-lab/work/extended-filters-v1/`.

## Contraprova crua — sete motores sem filtros DRAC

Para separar a capacidade da máscara inicial do efeito das proteções do
produto, os mesmos seis vídeos noturnos foram repetidos sem qualquer filtro
DRAC: sem compensação de iluminação, zonas, área mínima, confirmação temporal,
supressão periódica/crônica ou piso de ruído. Permaneceram somente resize para
320×180 e o significado nativo de sombras de cada motor. A métrica principal
descarta os primeiros 60 quadros de todos os motores, uma janela comum que
permite a calibração do Fast Self-Tuning.

| Motor cru | Movimentos semânticos detectados | Quadros ativos | Ativos fora da referência | Mediana/frame |
|---|---:|---:|---:|---:|
| Fast Self-Tuning | **199/264 (75,4%)** | 100,0% | 52,4% | 5,23 ms |
| KNN | 184/264 (69,7%) | 97,5% | 50,4% | 1,10 ms |
| Frigate core | 184/264 (69,7%) | 99,9% | 52,3% | **0,15 ms** |
| MOG2 | 172/264 (65,2%) | 95,0% | 48,6% | 1,15 ms |
| ViBe clássico | 172/264 (65,2%) | 99,9% | 52,3% | 0,53 ms |
| LOBSTER | 135/264 (51,1%) | 61,4% | **26,4%** | 16,72 ms |
| PBAS | 124/264 (47,0%) | **60,3%** | 28,9% | 6,26 ms |

"Ativos fora da referência" não é uma taxa de falso positivo auditada: inclui
movimento não anotado, compressão, iluminação e ruído. Mesmo assim, mostra que
nenhum motor cru é um gatilho de gravação aceitável; todos ficariam ativos de
60% a 100% do período. O ensaio confirma que os filtros são necessários, mas
também que eles precisam ser ajustados para não bloquear os movimentos reais
que o motor inicial já encontrou.

Resultados brutos:
`/home/flashnet/motion-bgs-lab/work/raw-engines-v2/`.
