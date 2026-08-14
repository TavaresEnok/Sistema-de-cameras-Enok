import test from 'node:test';
import assert from 'node:assert/strict';
import { lerPresets, lerPosicao, limitarEixo, escaparXml } from '../src/ptz/helpers/presets-ptz.helper';

// ─────────────────────────────────────────────────────────────────────────────
// Preset é a função de PTZ que o operador mais usa, e o DRAC não tinha: só
// sabia empurrar a câmera para os lados. As posições em geral JÁ estão gravadas
// no equipamento pelo instalador ("portão", "doca") e nenhuma tela as mostrava.
//
// Os erros deste módulo não levantam exceção — entregam tela quebrada: botão
// sem rótulo, lista duplicada, nome truncado no primeiro "&".
// ─────────────────────────────────────────────────────────────────────────────

const RESPOSTA = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">
 <s:Body>
  <tptz:GetPresetsResponse xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl">
   <tptz:Preset token="1"><tt:Name xmlns:tt="http://www.onvif.org/ver10/schema">Portão</tt:Name></tptz:Preset>
   <tptz:Preset token="2"><tt:Name xmlns:tt="http://www.onvif.org/ver10/schema">Doca &amp; pátio</tt:Name></tptz:Preset>
   <tptz:Preset token="3"></tptz:Preset>
  </tptz:GetPresetsResponse>
 </s:Body>
</s:Envelope>`;

test('lê os presets gravados na câmera', () => {
  const p = lerPresets(RESPOSTA);
  assert.equal(p.length, 3);
  assert.deepEqual(p[0], { token: '1', nome: 'Portão' });
});

test('nome com "&" chega inteiro', () => {
  // Sem desescapar, o operador leria "Doca &amp; pátio" no botão.
  assert.equal(lerPresets(RESPOSTA)[1]!.nome, 'Doca & pátio');
});

test('preset SEM nome ganha rótulo — botão em branco não diz o que faz', () => {
  assert.equal(lerPresets(RESPOSTA)[2]!.nome, 'Posição 3');
});

test('nome só com espaços também ganha rótulo', () => {
  const xml = '<Preset token="7"><Name>   </Name></Preset>';
  assert.equal(lerPresets(xml)[0]!.nome, 'Posição 7');
});

test('token repetido não duplica a lista', () => {
  // Firmware que repete a lista por perfil mostraria cada posição duas vezes.
  const xml = '<Preset token="1"><Name>A</Name></Preset><Preset token="1"><Name>A</Name></Preset>';
  assert.equal(lerPresets(xml).length, 1);
});

test('preset sem token é ignorado — não há como ir até ele', () => {
  const xml = '<Preset><Name>Órfão</Name></Preset><Preset token="2"><Name>Bom</Name></Preset>';
  assert.deepEqual(lerPresets(xml).map((p) => p.token), ['2']);
});

test('token com aspas simples é aceito', () => {
  assert.equal(lerPresets("<Preset token='9'><Name>X</Name></Preset>")[0]!.token, '9');
});

test('resposta vazia ou de erro devolve lista vazia, não quebra', () => {
  assert.deepEqual(lerPresets(''), []);
  assert.deepEqual(lerPresets('<Fault><Reason>não autorizado</Reason></Fault>'), []);
});

test('lê a posição atual da câmera', () => {
  const xml = `<GetStatusResponse><PTZStatus><Position>
    <tt:PanTilt x="0.5" y="-0.25" xmlns:tt="s"/><tt:Zoom x="0.1" xmlns:tt="s"/>
  </Position></PTZStatus></GetStatusResponse>`;
  assert.deepEqual(lerPosicao(xml), { pan: 0.5, tilt: -0.25, zoom: 0.1 });
});

test('eixo ausente é null, NUNCA zero', () => {
  // Zero é o CENTRO da câmera. Trocar "não informado" por "centro" faz a tela
  // mentir — e um comando de voltar ao ponto lido moveria a câmera de verdade.
  const semZoom = '<Position><PanTilt x="0.2" y="0.3"/></Position>';
  assert.equal(lerPosicao(semZoom).zoom, null);
  assert.deepEqual(lerPosicao('<GetStatusResponse/>'), { pan: null, tilt: null, zoom: null });
});

test('valor não numérico não vira zero', () => {
  assert.equal(lerPosicao('<Position><PanTilt x="abc" y="0"/></Position>').pan, null);
});

test('o eixo é preso ao intervalo da norma', () => {
  // Fora do intervalo, parte das câmeras recusa o comando inteiro e outras vão
  // ao extremo — as duas confundem quem está operando.
  assert.equal(limitarEixo(1.5), 1);
  assert.equal(limitarEixo(-9), -1);
  assert.equal(limitarEixo(0.4), 0.4);
  assert.equal(limitarEixo(0, 0, 1), 0);
  assert.equal(limitarEixo(Number.NaN), 0);
});

test('nome de preset digitado pelo operador não quebra o envelope', () => {
  assert.equal(escaparXml('Doca & <pátio>'), 'Doca &amp; &lt;pátio&gt;');
});

test('ida e volta preserva o nome', () => {
  const nome = 'Portão & "cia" <fundos>';
  assert.equal(lerPresets(`<Preset token="1"><Name>${escaparXml(nome)}</Name></Preset>`)[0]!.nome, nome);
});
