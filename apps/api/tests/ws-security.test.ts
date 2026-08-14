import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  formatarCriadoEm,
  calcularPasswordDigest,
  montarCabecalhoWsSecurity,
  injetarWsSecurity,
  deveTentarWsSecurity,
} from '../src/ptz/helpers/ws-security.helper';

// ─────────────────────────────────────────────────────────────────────────────
// Descoberto em 14/08/2026: o cliente ONVIF daqui só falava HTTP Digest, e a
// maioria das câmeras usa WS-Security UsernameToken. Medido na Mercusys do dono:
//
//   POST /onvif/service GetProfiles → HTTP 400 "Authority failure"
//   WWW-Authenticate: (nenhum)
//
// `digestSoapRequest` desistia com "Auth não é Digest" e o resultado virava
// `ptzCapable = false`. Outra ferramenta movimentou a mesma câmera pelo mesmo
// IP e porta — a diferença era só a autenticação.
// ─────────────────────────────────────────────────────────────────────────────

const NONCE = Buffer.from('0123456789abcdef', 'utf8');
const CRIADO = new Date('2026-08-14T12:00:00.123Z');

test('Created sai em UTC, com Z e SEM milissegundos', () => {
  // Firmware barato rejeita o formato com milissegundos.
  assert.equal(formatarCriadoEm(CRIADO), '2026-08-14T12:00:00Z');
  assert.doesNotMatch(formatarCriadoEm(CRIADO), /\./);
});

test('o digest usa o nonce em BYTES CRUS, não o texto Base64', () => {
  // Trocar isso produz um digest bem-formado e sempre inválido — o erro mais
  // difícil de enxergar nesta implementação.
  const criado = '2026-08-14T12:00:00Z';
  const senha = 'segredo';
  const esperado = createHash('sha1')
    .update(Buffer.concat([NONCE, Buffer.from(criado), Buffer.from(senha)]))
    .digest('base64');
  assert.equal(calcularPasswordDigest(NONCE, criado, senha), esperado);

  const comBase64 = createHash('sha1')
    .update(Buffer.concat([Buffer.from(NONCE.toString('base64')), Buffer.from(criado), Buffer.from(senha)]))
    .digest('base64');
  assert.notEqual(calcularPasswordDigest(NONCE, criado, senha), comBase64,
    'se estes baterem, o nonce entrou como texto — a câmera vai recusar sempre');
});

test('o cabeçalho traz os quatro elementos, na ordem que a norma fixa', () => {
  const xml = montarCabecalhoWsSecurity({ usuario: 'Ajustconsulting', senha: 's3nh4', nonce: NONCE, criadoEm: CRIADO });
  const ordem = ['Username', 'Password', 'Nonce', 'Created'].map((e) => xml.indexOf(`:${e}>`) >= 0 ? xml.indexOf(`:${e}>`) : xml.indexOf(`:${e} `));
  for (let i = 1; i < ordem.length; i++) {
    assert.ok(ordem[i - 1] < ordem[i], 'ordem fora do padrão — parser rígido recusa');
  }
  assert.match(xml, /PasswordDigest/, 'sem o tipo, a câmera trata como senha em claro');
  assert.match(xml, /Ajustconsulting/);
  assert.doesNotMatch(xml, /s3nh4/, 'a SENHA nunca pode aparecer no XML');
});

test('caracteres especiais no usuário não quebram o XML', () => {
  const xml = montarCabecalhoWsSecurity({ usuario: 'a&b<c>"d', senha: 'x', nonce: NONCE, criadoEm: CRIADO });
  assert.match(xml, /a&amp;b&lt;c&gt;&quot;d/);
});

test('injeta no envelope respeitando o prefixo que ele já usa', () => {
  for (const p of ['s', 'soap', 'SOAP-ENV']) {
    const envelope = `<${p}:Envelope><${p}:Body><GetProfiles/></${p}:Body></${p}:Envelope>`;
    const saida = injetarWsSecurity(envelope, { usuario: 'u', senha: 'p', nonce: NONCE, criadoEm: CRIADO });
    assert.match(saida, new RegExp(`<${p}:Header>`), `prefixo ${p} não respeitado`);
    assert.ok(saida.indexOf('Security') < saida.indexOf('Body'), 'cabeçalho tem de vir ANTES do corpo');
    assert.match(saida, /GetProfiles/, 'o corpo original sumiu');
  }
});

test('envelope que JÁ tem Header recebe o bloco dentro dele', () => {
  const envelope = '<s:Envelope><s:Header><Outro/></s:Header><s:Body><X/></s:Body></s:Envelope>';
  const saida = injetarWsSecurity(envelope, { usuario: 'u', senha: 'p', nonce: NONCE, criadoEm: CRIADO });
  assert.equal((saida.match(/<s:Header>/g) ?? []).length, 1, 'criou um segundo cabeçalho');
  assert.match(saida, /<Outro\/>/, 'apagou o que já estava no cabeçalho');
  assert.ok(saida.indexOf('Security') < saida.indexOf('<Outro'), 'a segurança deve vir primeiro');
});

test('envelope irreconhecível volta INTACTO', () => {
  // Mandar XML remendado errado é pior que mandar sem autenticação: a câmera
  // responde com falha de parse e o diagnóstico aponta para o lugar errado.
  const lixo = 'isto não é um envelope';
  assert.equal(injetarWsSecurity(lixo, { usuario: 'u', senha: 'p' }), lixo);
});

test('só tenta WS-Security quando a câmera NÃO ofereceu Digest', () => {
  // Se ela ofereceu Digest, o caminho atual funciona e já é o que roda.
  assert.equal(deveTentarWsSecurity({ statusCode: 401, wwwAuthenticate: 'Digest realm="x"' }), false);
  assert.equal(deveTentarWsSecurity({ statusCode: 401, wwwAuthenticate: null }), true);
});

test('o caso REAL da Mercusys: 400 com "Authority failure" e sem desafio', () => {
  assert.equal(
    deveTentarWsSecurity({ statusCode: 400, wwwAuthenticate: null, corpo: 'Authority failure' }),
    true,
  );
  for (const texto of ['not authorized', 'Access denied', 'senderNotAuthorized']) {
    assert.equal(deveTentarWsSecurity({ statusCode: 400, corpo: texto }), true, `"${texto}" não reconhecido`);
  }
});

test('400 que não é de autorização NÃO vira tentativa de WS-Security', () => {
  // Muita coisa vira 400; reagir ao status sozinho encheria a câmera de
  // requisições inúteis.
  assert.equal(deveTentarWsSecurity({ statusCode: 400, corpo: 'malformed xml' }), false);
  assert.equal(deveTentarWsSecurity({ statusCode: 500, corpo: 'Authority failure' }), false);
  assert.equal(deveTentarWsSecurity({ statusCode: 200 }), false);
  assert.equal(deveTentarWsSecurity({}), false);
});

test('nonce aleatório muda a cada chamada', () => {
  // Nonce repetido é rejeitado por câmera que guarda os usados (anti-replay).
  const a = montarCabecalhoWsSecurity({ usuario: 'u', senha: 'p' });
  const b = montarCabecalhoWsSecurity({ usuario: 'u', senha: 'p' });
  assert.notEqual(a, b);
});
