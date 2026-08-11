import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ── MINA DESARMADA (achado da análise do Frigate, verificado em produção) ────
// `useNvenc = gpuAccel` dependia SÓ da configuração, sem saber o fabricante. Um
// admin clicando "Ativar GPU" num host INTEL (o hardware mais comum aqui) fazia o
// publisher emitir `-c:v h264_nvenc` num ffmpeg SEM NVENC. Com
// runOnDemandRestart=false, o publisher morre sem retry e sem fallback: cai a
// live de TODAS as câmeras H.265/com áudio da instalação.

test('NVENC só é emitido quando o pipeline de transcode DECLARA ter NVENC', () => {
  const src = readFileSync('src/camera-stream/mediamtx-proxy.service.ts', 'utf8');
  assert.match(src, /const useNvenc =\s*\n?\s*gpuAccel && this\.transcodePipelineHasNvenc\(\)/,
    'a flag de configuração sozinha não pode escolher NVENC');
  assert.match(src, /private transcodePipelineHasNvenc\(\)/);
});

// ── INCIDENTE 11/08/2026: sessões NVENC são FINITAS na GeForce ───────────────
// Com o mosaico aberto, 12+ tiles pediam sessão de encode; da 13ª em diante o
// driver recusava ("OpenEncodeSessionEx failed: incompatible client key (21)",
// 52 falhas em 15 min) e o tile ficava PRETO em loop. Duas defesas:
test('a GRADE nunca usa NVENC (sessões escassas ficam para o 1x1)', () => {
  const src = readFileSync('src/camera-stream/mediamtx-proxy.service.ts', 'utf8');
  assert.match(src, /gpuAccel && this\.transcodePipelineHasNvenc\(\) && deliveryMode !== 'grid'/,
    'tile de grade é barato em CPU e numeroso — não pode consumir sessão NVENC');
});

test('sessão NVENC negada cai para libx264 em vez de matar a live', () => {
  const src = readFileSync('src/camera-stream/mediamtx-proxy.service.ts', 'utf8');
  const i = src.indexOf('const runOnDemandScript');
  assert.ok(i > 0, 'o runOnDemand precisa ser um script com fallback, não um exec direto');
  const bloco = src.slice(i, i + 700);
  assert.match(bloco, /inicio=\$\(date \+%s\)/, 'a idade do processo decide se foi falha de INIT');
  assert.match(bloco, /-lt 10/, 'só morte precoce (<10s) dispara o fallback');
  assert.match(bloco, /exec \$\{cpuFfmpegCommand\}/, 'o fallback relança o MESMO pipeline em CPU');
  // Sem a janela de idade, um NVENC morto pelo runOnUnDemand (kill -9 após
  // horas) renasceria em CPU como órfão publicando num path fechado.
});

test('a guarda é fail-safe: sem sinal explícito, assume CPU', () => {
  const src = readFileSync('src/camera-stream/mediamtx-proxy.service.ts', 'utf8');
  const i = src.indexOf('private transcodePipelineHasNvenc()');
  const corpo = src.slice(i, i + 900);
  // Só o literal "true" liga. Falso negativo custa desempenho; falso positivo
  // custa a LIVE — então o default tem de ser CPU.
  assert.match(corpo, /'true'/, 'apenas "true" explícito habilita NVENC');
  assert.match(corpo, /\?\?\s*''/, 'ausência da variável deve virar string vazia (= CPU)');
});

test('resiliência: placa ARRANCADA faz o transcode cair para CPU sozinho', () => {
  // O env GPU_TRANSCODE_AVAILABLE é ESTÁTICO (setado quando o stack subiu com
  // GPU). Se a placa for removida com o serviço no ar, o env continua 'true' e
  // o publisher seguiria emitindo h264_nvenc num pipeline sem GPU — o ffmpeg
  // morre e derruba a LIVE. A guarda tem de conferir a PRESENÇA REAL do
  // dispositivo, não só o env.
  const src = readFileSync('src/camera-stream/mediamtx-proxy.service.ts', 'utf8');
  const i = src.indexOf('private transcodePipelineHasNvenc()');
  const corpo = src.slice(i, i + 900);
  assert.match(corpo, /dev\/nvidia0|dev\/nvidiactl/,
    'a guarda precisa conferir o device node da GPU — senão placa arrancada derruba a live');
  assert.match(corpo, /existsSync/, 'a checagem do device é por presença de arquivo (nunca quebra)');
});

test('a imagem de GPU acompanha a versão do MediaMTX de produção', () => {
  const dockerfile = readFileSync('../../infra/mediamtx-nvenc.Dockerfile', 'utf8');
  const m = dockerfile.match(/ARG MEDIAMTX_VERSION=v([\d.]+)/);
  assert.ok(m, 'a versão precisa estar fixada');
  const [maj, min] = m[1].split('.').map(Number);
  // A v1.9.3 que estava aqui REJEITA o mediamtx.yml de produção (hlsAllowOrigins),
  // então o container subia e morria. Qualquer coisa abaixo de 1.18 é a mina.
  assert.ok(maj > 1 || min >= 18, `MediaMTX ${m[1]} é antigo demais para o mediamtx.yml atual`);
});

test('o yml de produção realmente usa a chave que a versão antiga rejeitava', () => {
  const yml = readFileSync('../../infra/mediamtx.yml', 'utf8');
  assert.match(yml, /hlsAllowOrigins/, 'se esta chave sumir, o teste acima perde o sentido — revise');
});

// ── QUALIDADE DA GRADE: `ultrafast` foi longe demais ────────────────────────
// Ao tirar o NVENC da grade (sessões esgotadas derrubavam tiles), ela caiu no
// `ultrafast` — o preset mais rápido e PIOR do x264. O dono viu na hora:
// "as imagens das câmeras estão com aspecto lavado, fantasma".
//
// Medido contra a mesma fonte (6 s, 900 kbps, 640x360):
//   ultrafast  SSIM 0,9794  PSNR 40,52 dB   <- a queixa
//   veryfast   SSIM 0,9851  PSNR 41,58 dB
//   h264_nvenc SSIM 0,9833  PSNR 41,27 dB   <- o que havia ANTES de mim
// `veryfast` supera o próprio NVENC, por ~+0,5 núcleo na frota inteira.

test('a grade NÃO usa o preset ultrafast (foi o que lavou a imagem)', () => {
  const src = readFileSync('src/camera-stream/mediamtx-proxy.service.ts', 'utf8');
  const i = src.indexOf('const cpuVideoArgs');
  assert.ok(i > 0, 'o bloco de argumentos de vídeo precisa existir');
  const bloco = src.slice(i, i + 2200);
  assert.doesNotMatch(bloco, /-preset ultrafast/,
    'ultrafast degrada visivelmente a grade — mede pior que o NVENC que ela tinha antes');
  assert.match(bloco, /-preset veryfast/);
});

test('a grade mantém 2 referências (1 borra objeto em movimento)', () => {
  const src = readFileSync('src/camera-stream/mediamtx-proxy.service.ts', 'utf8');
  const i = src.indexOf('const cpuVideoArgs');
  assert.match(src.slice(i, i + 2200), /-refs 2/,
    'refs 1 era parte do "fantasma": sem referência suficiente, o x264 arrasta o movimento');
});
