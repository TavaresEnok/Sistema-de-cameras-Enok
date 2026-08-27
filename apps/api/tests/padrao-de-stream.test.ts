import test from 'node:test';
import assert from 'node:assert/strict';
import { conferirPadrao, resumirFrota } from '../src/camera-stream/helpers/padrao-de-stream.helper';

// "será orientado todas as câmeras ter os 2 stream, o principal sendo em 1080p
//  em H.265 e o stream 2 em H.264 em 480p" (dono, 27/08/2026)

test('O PADRÃO: principal 1080p H.265 + stream 2 480p H.264', () => {
  const d = conferirPadrao({
    codecPrincipal: 'h265', alturaPrincipal: 1080,
    temSub: true, codecSub: 'h264', alturaSub: 480,
  });
  assert.equal(d.situacao, 'conforme');
  assert.deepEqual(d.desvios, []);
});

test('O CASO REAL desta frota: Cam-24/25/26 sem stream 2', () => {
  const d = conferirPadrao({
    codecPrincipal: 'h265', alturaPrincipal: 1080,
    temSub: false,
  });
  assert.equal(d.situacao, 'desviado');
  assert.match(d.resumo, /não tem stream 2/i);
});

test('stream 2 existente mas em H.265 é desvio — é o que dá quadro preto', () => {
  const d = conferirPadrao({
    codecPrincipal: 'h265', alturaPrincipal: 1080,
    temSub: true, codecSub: 'hevc', alturaSub: 360,
  });
  assert.equal(d.situacao, 'desviado');
  assert.match(d.resumo, /H\.264/);
});

test('stream 2 grande demais carrega o mosaico à toa', () => {
  const d = conferirPadrao({
    codecPrincipal: 'h265', alturaPrincipal: 1080,
    temSub: true, codecSub: 'h264', alturaSub: 1080,
  });
  assert.equal(d.situacao, 'desviado');
  assert.match(d.desvios.join(' '), /acima do padrão/i);
});

test('stream 2 MENOR que 480p continua aceito', () => {
  // 360p é mais leve ainda; exigir exatamente 480 seria implicância.
  const d = conferirPadrao({
    codecPrincipal: 'h265', alturaPrincipal: 1080,
    temSub: true, codecSub: 'h264', alturaSub: 360,
  });
  assert.equal(d.situacao, 'conforme');
});

test('principal em H.264 é desvio, mas menos grave que o stream 2', () => {
  const d = conferirPadrao({
    codecPrincipal: 'h264', alturaPrincipal: 1080,
    temSub: true, codecSub: 'h264', alturaSub: 480,
  });
  assert.equal(d.situacao, 'desviado');
  assert.match(d.resumo, /Principal/);
  assert.match(d.resumo, /disco/);
});

test('quando há dois desvios, o do stream 2 vem primeiro', () => {
  const d = conferirPadrao({
    codecPrincipal: 'h264', alturaPrincipal: 720,
    temSub: false,
  });
  assert.equal(d.desvios.length, 3);
  assert.match(d.desvios[0], /não tem stream 2/i);
});

test('NÃO SE ACUSA O QUE NÃO FOI MEDIDO', () => {
  // Sem isto, câmera recém-cadastrada apareceria como irregular e mandaria o
  // instalador conferir uma câmera que pode estar perfeita.
  const d = conferirPadrao({ codecPrincipal: 'h265', alturaPrincipal: 1080 });
  assert.equal(d.situacao, 'nao-verificado');
  assert.deepEqual(d.desvios, []);
});

test('altura ausente ou zero não inventa desvio', () => {
  const d = conferirPadrao({
    codecPrincipal: 'h265', alturaPrincipal: 0,
    temSub: true, codecSub: 'h264', alturaSub: null,
  });
  assert.equal(d.situacao, 'conforme');
});

test('apelidos de codec são aceitos', () => {
  for (const sub of ['h264', 'avc', 'avc1', 'H264']) {
    assert.equal(conferirPadrao({ codecPrincipal: 'hevc', temSub: true, codecSub: sub }).situacao, 'conforme', sub);
  }
  for (const main of ['h265', 'hevc', 'hvc1', 'HEVC']) {
    assert.equal(conferirPadrao({ codecPrincipal: main, temSub: true, codecSub: 'h264' }).situacao, 'conforme', main);
  }
});

test('o cabeçalho conta a frota', () => {
  const r = resumirFrota([
    conferirPadrao({ codecPrincipal: 'h265', temSub: true, codecSub: 'h264' }),
    conferirPadrao({ codecPrincipal: 'h265', temSub: false }),
    conferirPadrao({ codecPrincipal: 'h265' }),
  ]);
  assert.deepEqual(r, { conformes: 1, desviadas: 1, naoVerificadas: 1 });
});
