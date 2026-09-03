import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = () => readFileSync('src/camera-stream/mediamtx-proxy.service.ts', 'utf8');

test('live não mantém encoder NVENC exclusivo do antigo modo intermediário', () => {
  assert.doesNotMatch(source(), /h264_nvenc|transcodePipelineHasNvenc|GPU_TRANSCODE_AVAILABLE/);
});

test('a grade não usa ultrafast e preserva duas referências', () => {
  const src = source();
  const start = src.indexOf('const videoArgs');
  assert.ok(start > 0, 'o bloco de argumentos de vídeo da grade precisa existir');
  const block = src.slice(start, start + 2600);
  assert.doesNotMatch(block, /-preset ultrafast/);
  assert.match(block, /-preset veryfast/);
  assert.match(block, /-refs 2/);
});

test('a imagem de GPU continua compatível com o MediaMTX para exportações e gravações', () => {
  const dockerfile = readFileSync('../../infra/mediamtx-nvenc.Dockerfile', 'utf8');
  const match = dockerfile.match(/ARG MEDIAMTX_VERSION=v([\d.]+)/);
  assert.ok(match, 'a versão precisa estar fixada');
  const [major, minor] = match[1].split('.').map(Number);
  assert.ok(major > 1 || minor >= 18, `MediaMTX ${match[1]} é antigo demais`);
});

test('o yml de produção conserva a chave suportada pela imagem atual', () => {
  const yml = readFileSync('../../infra/mediamtx.yml', 'utf8');
  assert.match(yml, /hlsAllowOrigins/);
});
