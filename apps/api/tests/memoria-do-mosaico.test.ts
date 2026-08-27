import test from 'node:test';
import assert from 'node:assert/strict';
import {
  comSegredo,
  comoExplicar,
  impressaoDoCadastro,
  lerAnotacao,
  semSegredo,
} from '../src/camera-stream/helpers/memoria-do-mosaico.helper';

// "continua verificando se a câmera tem stream 2 em qualidade menor e já grava
//  para não precisar procurar mais e sempre usar esse stream 2 no mosaico e não
//  ficar procurando mais?" (dono, 27/08/2026)

const CADASTRO = { ip: '10.0.0.9', rtspPort: 554, username: 'admin', rtspPath: '/cam', channel: 1, subtype: 1 };
const CHAVE = impressaoDoCadastro(CADASTRO);

test('O PEDIDO: descoberto uma vez, não se procura mais', () => {
  const anotacao = {
    chave: CHAVE,
    urlSemSegredo: 'rtsp://10.0.0.9:554/cam?subtype=1',
    codec: 'h264',
    temSub: true,
    precisaLimpeza: false,
    descobertoEm: new Date('2026-01-01T00:00:00Z'),
  };
  // Sete meses depois, sem prazo de validade: continua valendo.
  const r = lerAnotacao(anotacao, CHAVE, new Date('2026-08-27T00:00:00Z').getTime());
  assert.equal(r.usar, true);
  if (r.usar) {
    assert.equal(r.urlSemSegredo, 'rtsp://10.0.0.9:554/cam?subtype=1');
    assert.equal(r.codec, 'h264');
  }
});

test('"NÃO TEM stream secundário" é resposta, não ausência de resposta', () => {
  // É esta distinção que faz a Cam-24 parar de ser interrogada em vão.
  const semSub = { chave: CHAVE, temSub: false, urlSemSegredo: null, codec: null };
  const r = lerAnotacao(semSub, CHAVE, Date.now());
  assert.equal(r.usar, true);
  if (r.usar) assert.equal(r.urlSemSegredo, null); // null = usar o principal

  const nuncaPerguntado = { chave: CHAVE };
  const r2 = lerAnotacao(nuncaPerguntado, CHAVE, Date.now());
  assert.equal(r2.usar, false);
  if (!r2.usar) assert.equal(r2.motivo, 'nunca-descoberto');
});

test('DECISÃO ANOTADA NÃO É PRISÃO: mexeu no cadastro, perde a validade', () => {
  const anotacao = { chave: CHAVE, temSub: true, urlSemSegredo: 'rtsp://10.0.0.9:554/cam' };
  const outroEndereco = impressaoDoCadastro({ ...CADASTRO, ip: '10.0.0.10' });
  const r = lerAnotacao(anotacao, outroEndereco, Date.now());
  assert.equal(r.usar, false);
  if (!r.usar) assert.equal(r.motivo, 'cadastro-mudou');
});

test('trocar a PORTA ou o CAMINHO também invalida', () => {
  for (const mudanca of [{ rtspPort: 5554 }, { rtspPath: '/outro' }, { subtype: 0 }, { username: 'outro' }]) {
    assert.notEqual(impressaoDoCadastro({ ...CADASTRO, ...mudanca }), CHAVE);
  }
});

test('SENHA NÃO SE GUARDA DUAS VEZES', () => {
  const comCred = 'rtsp://admin:S3nh%40Forte@10.0.0.9:554/cam?subtype=1';
  const limpa = semSegredo(comCred);
  assert.equal(limpa, 'rtsp://10.0.0.9:554/cam?subtype=1');
  assert.ok(!String(limpa).includes('S3nh'), 'a senha não pode sobrar na URL anotada');
  assert.ok(!String(limpa).includes('admin'), 'o usuário também não');
});

test('a credencial volta na hora de usar, vinda do cadastro', () => {
  const pronta = comSegredo('rtsp://10.0.0.9:554/cam?subtype=1', 'admin', 'S3nh@Forte');
  assert.equal(pronta, 'rtsp://admin:S3nh%40Forte@10.0.0.9:554/cam?subtype=1');
});

test('câmera sem usuário continua funcionando', () => {
  assert.equal(comSegredo('rtsp://10.0.0.9:554/cam', '', ''), 'rtsp://10.0.0.9:554/cam');
  assert.equal(comSegredo('rtsp://10.0.0.9:554/cam', null, null), 'rtsp://10.0.0.9:554/cam');
});

test('URL sem credencial não é estragada ao ser limpa', () => {
  assert.equal(semSegredo('rtsp://10.0.0.9:554/cam'), 'rtsp://10.0.0.9:554/cam');
  assert.equal(semSegredo(''), null);
  assert.equal(semSegredo(null), null);
});

test('o prazo de validade é OPCIONAL, e desligado por padrão', () => {
  const velha = {
    chave: CHAVE, temSub: true, urlSemSegredo: 'rtsp://x/y',
    descobertoEm: new Date('2020-01-01T00:00:00Z'),
  };
  assert.equal(lerAnotacao(velha, CHAVE, Date.now()).usar, true, 'sem prazo, vale para sempre');

  const r = lerAnotacao(velha, CHAVE, Date.now(), 6 * 3600_000);
  assert.equal(r.usar, false);
  if (!r.usar) assert.equal(r.motivo, 'anotacao-vencida');
});

test('a tela sabe explicar em português', () => {
  assert.match(comoExplicar({ temSub: true }), /leve/i);
  assert.match(comoExplicar({ temSub: false }), /pesa/i);
  assert.match(comoExplicar({}), /não verificado/i);
});
