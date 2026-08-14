import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lerCapacidades,
  lerServicos,
  reescreverParaHostAlcancavel,
  lerRelogioDaCamera,
  calcularDesvioDeRelogio,
} from '../src/ptz/helpers/onvif-descoberta.helper';

// ─────────────────────────────────────────────────────────────────────────────
// O cliente daqui ADIVINHA caminho e porta de uma lista fixa. Acerta nas marcas
// que já vimos e erra em toda câmera que use outro endereço — com o mesmo
// sintoma de sempre, "esta câmera não tem PTZ".
//
// A norma resolve: GetCapabilities/GetServices devolvem os XAddr, as URLs REAIS
// daquele equipamento. É o que o Frigate faz com `update_xaddrs()` antes de
// qualquer comando (concorrentes/frigate/frigate/ptz/onvif.py).
// ─────────────────────────────────────────────────────────────────────────────

const CAPACIDADES = `<?xml version="1.0"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope">
 <SOAP-ENV:Body>
  <tds:GetCapabilitiesResponse xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
   <tds:Capabilities>
    <tt:Device xmlns:tt="http://www.onvif.org/ver10/schema">
     <tt:XAddr>http://192.168.1.50/onvif/device_service</tt:XAddr>
    </tt:Device>
    <tt:Media xmlns:tt="http://www.onvif.org/ver10/schema">
     <tt:XAddr>http://192.168.1.50/onvif/media</tt:XAddr>
    </tt:Media>
    <tt:PTZ xmlns:tt="http://www.onvif.org/ver10/schema">
     <tt:XAddr>http://192.168.1.50/onvif/ptz</tt:XAddr>
    </tt:PTZ>
   </tds:Capabilities>
  </tds:GetCapabilitiesResponse>
 </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

test('lê os endereços REAIS que o equipamento anuncia', () => {
  const s = lerCapacidades(CAPACIDADES);
  assert.equal(s.ptz, 'http://192.168.1.50/onvif/ptz');
  assert.equal(s.media, 'http://192.168.1.50/onvif/media');
  assert.equal(s.device, 'http://192.168.1.50/onvif/device_service');
  assert.equal(s.imaging, undefined, 'serviço ausente fica undefined, não inventado');
});

test('serviço sem XAddr não vira URL inventada', () => {
  // Endereço errado gera erro de rede que se parece com "câmera sem PTZ" — a
  // confusão que este módulo existe para acabar.
  const xml = '<Capabilities><PTZ></PTZ></Capabilities>';
  assert.equal(lerCapacidades(xml).ptz, undefined);
});

test('XAddr que não é URL é descartado', () => {
  const xml = '<Capabilities><PTZ><XAddr>não é url</XAddr></PTZ></Capabilities>';
  assert.equal(lerCapacidades(xml).ptz, undefined);
});

test('GetServices (ONVIF 2.x) é lido pelo namespace', () => {
  const xml = `<GetServicesResponse>
    <Service><Namespace>http://www.onvif.org/ver20/ptz/wsdl</Namespace><XAddr>http://cam/ptz2</XAddr></Service>
    <Service><Namespace>http://www.onvif.org/ver10/media/wsdl</Namespace><XAddr>http://cam/media2</XAddr></Service>
    <Service><Namespace>http://www.onvif.org/ver10/device/wsdl</Namespace><XAddr>http://cam/dev2</XAddr></Service>
  </GetServicesResponse>`;
  const s = lerServicos(xml);
  assert.equal(s.ptz, 'http://cam/ptz2');
  assert.equal(s.media, 'http://cam/media2');
  assert.equal(s.device, 'http://cam/dev2');
});

test('o caminho do XAddr vale; o host e a porta são os NOSSOS', () => {
  // Câmera atrás de roteador anuncia o IP de LAN, inútil de fora. É o caso do
  // dono: 4 câmeras atrás do mesmo IP público, portas diferentes.
  const r = reescreverParaHostAlcancavel('http://192.168.1.50/onvif/ptz', '168.194.15.82', 51491);
  assert.deepEqual(r, { host: '168.194.15.82', porta: 51491, caminho: '/onvif/ptz' });
});

test('XAddr com porta e query preserva o caminho inteiro', () => {
  const r = reescreverParaHostAlcancavel('http://192.168.1.50:8899/onvif/ptz?ch=1', '10.0.0.1', 80);
  assert.equal(r!.caminho, '/onvif/ptz?ch=1');
  assert.equal(r!.porta, 80, 'a porta anunciada pela câmera NÃO é a que alcança');
});

test('XAddr ausente ou inválido devolve null', () => {
  assert.equal(reescreverParaHostAlcancavel(undefined, 'h', 1), null);
  assert.equal(reescreverParaHostAlcancavel('lixo', 'h', 1), null);
});

test('lê o relógio da câmera', () => {
  const xml = `<GetSystemDateAndTimeResponse><SystemDateAndTime><UTCDateTime>
    <Time><Hour>15</Hour><Minute>32</Minute><Second>57</Second></Time>
    <Date><Year>2026</Year><Month>8</Month><Day>14</Day></Date>
  </UTCDateTime></SystemDateAndTime></GetSystemDateAndTimeResponse>`;
  assert.equal(lerRelogioDaCamera(xml)!.toISOString(), '2026-08-14T15:32:57.000Z');
});

test('resposta sem relógio devolve null em vez de data inventada', () => {
  assert.equal(lerRelogioDaCamera('<x/>'), null);
  assert.equal(lerRelogioDaCamera('<UTCDateTime><Time><Hour>1</Hour></Time></UTCDateTime>'), null);
});

test('desvio pequeno NÃO é corrigido', () => {
  // Ajustar por segundos briga com o nonce anti-repetição de alguns firmwares,
  // e a norma tolera alguns segundos. Foi o caso medido: 2 s.
  const agora = new Date('2026-08-14T15:32:59Z');
  assert.equal(calcularDesvioDeRelogio(new Date('2026-08-14T15:32:57Z'), agora), 0);
});

test('desvio grande É corrigido — é o que derruba o WS-Security em silêncio', () => {
  const agora = new Date('2026-08-14T15:00:00Z');
  const desvio = calcularDesvioDeRelogio(new Date('2026-08-14T15:10:00Z'), agora);
  assert.equal(desvio, 600_000, 'câmera 10 min adiantada precisa de correção');
});

test('desvio absurdo é LIXO de leitura, não correção', () => {
  // Carimbar 2011 num `Created` faria TODA câmera recusar.
  const agora = new Date('2026-08-14T15:00:00Z');
  assert.equal(calcularDesvioDeRelogio(new Date('2011-01-01T00:00:00Z'), agora), 0);
  assert.equal(calcularDesvioDeRelogio(null, agora), 0);
});
