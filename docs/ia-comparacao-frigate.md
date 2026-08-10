# A IA do DRAC comparada ao Frigate

Levantado em 10/08/2026, com a documentação atual do Frigate — não de memória.

## Que modelo cada um usa

| | Frigate | DRAC |
|---|---|---|
| **Padrão em CPU** | MobileNet SSD (TFLite, `/cpu_model.tflite`) | **YOLO26n**, INT8, OpenVINO |
| **Padrão em OpenVINO** | SSDLite MobileNet v2 (incluído) | mesmo YOLO26n |
| **Melhor modelo disponível** | YOLOv9, RF-DETR, YOLO-NAS, D-FINE — **exigem baixar e configurar à mão** | YOLO26n / YOLO26s, já exportados e quantizados pelo `download_models.py` |
| Resolução de inferência | 300×300 (MobileNet) | 640 (416/512/640/960 disponíveis) |
| Detectores suportados | Coral, Hailo, OpenVINO, ONNX, TensorRT, RKNN, CPU… | OpenVINO (CPU/GPU) |

**Conclusão sobre modelo: não é aqui que estamos atrás.** MobileNet SSD é de
2018 e roda a 300×300; YOLO26n é muito mais preciso, e já entregamos ele
quantizado e pronto, sem o usuário ter de escolher e baixar nada. Onde o
Frigate ganha é em *variedade de aceleradores* (Coral, Hailo, TensorRT) — o que
importa para quem tem esse hardware, e não para o nosso caso de uso hoje.

## Parâmetros, lado a lado

| Parâmetro | Frigate (padrão) | DRAC (antes) | DRAC (agora) |
|---|---|---|---|
| fps de detecção | 5 | 4 | 4 |
| Movimento | limiar 30, contour_area 10, altura 100 | MOG2 320×180 @2fps | igual |
| Rastreamento | norfair | ByteTrack | ByteTrack |
| Confiança **por quadro** | `min_score` 0.5 | 0.25–0.30 | 0.25–0.30 |
| **Confirmação agregada** | `threshold` 0.7 sobre a **mediana** | ❌ **não existia** | ✅ mediana ≥ 0.70 em ≥ 3 quadros |
| Quadros mínimos | `min_initialized` = ½ fps | ❌ | 3 |
| Esquecer objeto sumido | `max_disappeared` = 5× fps | TTL 2 s | 20 quadros (~5 s) |
| Objeto parado | re-detecta a cada 50 quadros | **cache, não re-infere** | igual (melhor) |
| Filtro de proporção | `min_ratio`/`max_ratio` | ❌ | ❌ (ver abaixo) |
| Filtro de área | `min_area`/`max_area` | altura mínima 10 px | igual |
| Zonas | objeto precisa estar na zona | zona mascara o **movimento**, que guia a detecção | igual (portão indireto) |

## O que faltava de verdade, e foi corrigido

**Um único quadro acima de 0,30 virava evento.** O único freio era um debounce
de tempo — que atrasa o alarme seguinte, mas não questiona o primeiro. Bastava
um arbusto no vento, um reflexo ou uma sombra parecerem uma pessoa por 1/4 de
segundo para o cliente receber um alarme.

Num sistema de segurança isso é pior do que parece: alarme que toca à toa ensina
o operador a ignorar o painel — e aí o alarme verdadeiro também é ignorado.

A correção copia o desenho de dois estágios do Frigate:

- **limiar por quadro (baixo)** — deixa a detecção entrar no rastreamento e
  desenhar a caixa na tela. Continua em 0,25–0,30 de propósito: ver muito é bom;
- **mediana ≥ 0,70 em ≥ 3 quadros** — só então o objeto vira evento.

Mediana, não média: um único quadro espúrio em 0,99 arrastaria a média e não
arrasta a mediana. Esse quadro é justamente aquele em que o modelo se enganou
com confiança — é o que se quer descartar.

E **um evento por objeto**: uma pessoa parada dez minutos é um evento, não dois
mil. O debounce de tempo continua valendo como segunda rede.

Movimento e travessia de linha **não** passam por essa regra: movimento não é
objeto (não tem identidade nem confiança para mediana), e a travessia já exige
trajeto entre quadros, que é evidência do mesmo tipo — exigir de novo atrasaria
justamente o alarme que mais importa.

## O que decidi NÃO fazer, e por quê

**Filtro de proporção (`min_ratio`/`max_ratio`).** O Frigate precisa dele porque
MobileNet SSD produz caixas absurdas com frequência; YOLO26n produz muito menos.
O risco assimétrico decide: um filtro de proporção mal calibrado **descarta uma
pessoa de verdade** — uma pessoa caída, agachada ou parcialmente oculta tem
proporção atípica. Num sistema de segurança, perder pessoa é pior que uma caixa
estranha na tela. Fica registrado como opção futura, se a operação mostrar
necessidade.

**Filtro de área máxima.** Mesma lógica: uma pessoa perto da câmera ocupa quase
o quadro inteiro, e um carro estacionado em frente à lente também. O ganho é
pequeno e o risco de cortar o caso real é concreto.

**Zonas aplicadas ao objeto.** Hoje a zona mascara o movimento, e o movimento é
o que guia onde a detecção de objeto procura — na prática o objeto já é filtrado
pela zona, indiretamente. A diferença aparece só quando a região de inferência
cruza a borda da zona. Anotado; não é o gargalo.

## Como ajustar

Tudo por ambiente, sem recompilar:

```
GENERAL_CONFIRM_MIN_FRAMES=3            # quadros mínimos antes de confirmar
GENERAL_CONFIRM_MEDIAN_THRESHOLD=0.70   # mediana exigida para virar evento
GENERAL_CONFIRM_FORGET_AFTER_MISSES=20  # quadros sem ver antes de esquecer
```

Subir o limiar da mediana = menos alarme falso e mais risco de perder o
verdadeiro. Baixar = o contrário. 0,70 é o mesmo valor que o Frigate escolheu
depois de muita operação em campo, e é um bom ponto de partida.
