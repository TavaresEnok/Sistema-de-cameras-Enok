'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('painel comercial exibe consumo real, modelos e as três cotas editáveis', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  for (const id of ['license-plan', 'license-max-cameras', 'license-max-users', 'license-max-retention']) assert.match(html, new RegExp(id));
  assert.match(html, /resourceUsage/);
  assert.match(html, /Gravações armazenadas/);
});
