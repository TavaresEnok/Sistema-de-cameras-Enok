import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWhepIceServers } from '../src/lib/whep-ice-servers.ts';

test('WHEP transforma Link TURN do MediaMTX em RTCIceServer', () => {
  assert.deepEqual(parseWhepIceServers(
    '<turn:177.104.156.25:3478?transport=udp>; rel="ice-server"; username="1720000000:abc"; credential="segredo+/="; credential-type="password"',
  ), [{
    urls: 'turn:177.104.156.25:3478?transport=udp',
    username: '1720000000:abc',
    credential: 'segredo+/=',
  }]);
});

test('WHEP aceita vários Links, ignora relações e esquemas que não são ICE', () => {
  const parsed = parseWhepIceServers([
    '<https://exemplo.test/politica>; rel="alternate"',
    '<stun:stun.exemplo.test:3478>; rel="ice-server"',
    '<turns:turn.exemplo.test:5349?transport=tcp>; rel="ice-server"; username="u"; credential="a,b"',
    '<javascript:alert(1)>; rel="ice-server"',
  ].join(', '));
  assert.deepEqual(parsed, [
    { urls: 'stun:stun.exemplo.test:3478' },
    { urls: 'turns:turn.exemplo.test:5349?transport=tcp', username: 'u', credential: 'a,b' },
  ]);
});

test('WHEP elimina servidor ICE duplicado e trata cabeçalho ausente', () => {
  const link = '<turn:turn.test:3478>; rel="ice-server"; username=x; credential=y';
  assert.equal(parseWhepIceServers(`${link}, ${link}`).length, 1);
  assert.deepEqual(parseWhepIceServers(null), []);
});
