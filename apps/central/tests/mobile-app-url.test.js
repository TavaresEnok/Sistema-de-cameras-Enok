'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { addrToApiUrl } = require('../src/server');

test('gerador usa HTTPS em domínio público e mantém o endpoint /api', () => {
  assert.equal(addrToApiUrl('ibtelecom.s2cam.com.br'), 'https://ibtelecom.s2cam.com.br/api');
});

test('gerador migra os domínios temporários sem alterar IP local', () => {
  assert.equal(addrToApiUrl('https://vibe.cam.ajustconsulting.com.br/api'), 'https://vibe.s2cam.com.br/api');
  assert.equal(addrToApiUrl('10.10.0.20'), 'http://10.10.0.20:5173/api');
});
