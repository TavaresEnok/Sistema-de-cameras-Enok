'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PANEL = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function corpoDaFuncao(nome) {
  const inicio = PANEL.indexOf(`function ${nome}(`);
  assert.ok(inicio > -1, `função ${nome} não encontrada no painel`);
  const proxima = PANEL.indexOf('\n      function ', inicio + 1);
  return PANEL.slice(inicio, proxima > inicio ? proxima : PANEL.length);
}

test('o arquivo oficial é o redesign de produção, sem o simulador da prévia', () => {
  assert.match(PANEL, /class="[^"]*\bshell\b[^"]*"/);
  assert.match(PANEL, /class="sidebar"/);
  assert.match(PANEL, /id="attention-queue"/);
  assert.match(PANEL, /id="palette"/);
  assert.match(PANEL, /id="wall"/);
  assert.doesNotMatch(PANEL, /mockFetch|mockInstallations|PREVIEW NÃO SUBIR/i);
});

test('a instalação conserva as seis áreas administrativas do redesign', () => {
  for (const tab of ['visao', 'contrato', 'ia', 'nuvem', 'escala', 'manutencao']) {
    assert.match(PANEL, new RegExp(`data-tab="${tab}"`), `botão da aba ${tab}`);
    assert.match(PANEL, new RegExp(`data-tab-panel="${tab}"`), `conteúdo da aba ${tab}`);
  }
});

test('recursos operacionais do redesign permanecem ligados à interface', () => {
  for (const id of ['omni-open', 'pulse', 'wall-toggle', 'export-csv', 'rail-toggle']) {
    assert.match(PANEL, new RegExp(`id="${id}"`), `controle ${id}`);
  }
  assert.match(PANEL, /addEventListener\('click', openPalette\)/);
  assert.match(PANEL, /addEventListener\('click', togglePause\)/);
  assert.match(PANEL, /addEventListener\('click', exportCsv\)/);
});

test('botão do menu recolhido fica no topo e nunca provoca rolagem horizontal', () => {
  const marca = PANEL.indexOf('class="brand"');
  const controle = PANEL.indexOf('id="rail-toggle"');
  const navegacao = PANEL.indexOf('class="nav"');
  assert.ok(marca > -1 && controle > marca && navegacao > controle, 'controle deve ficar entre a marca e a navegação');
  assert.match(PANEL, /\.sidebar\s*\{[\s\S]*?overflow-x:\s*hidden;/);
  assert.match(PANEL, /body\.rail \.rail-control\s*\{[\s\S]*?width:\s*40px;/);
  assert.match(PANEL, /body\.rail \.foot-actions\s*\{\s*flex-direction:\s*column;/);
  assert.match(PANEL, /class="rail-open-icon"/);
  assert.match(PANEL, /function syncRailToggle\(\)/);
  assert.match(PANEL, /recolhido \? 'Expandir menu' : 'Recolher menu'/);
});

test('a exportação CSV neutraliza fórmulas vindas de campos textuais', () => {
  const corpo = corpoDaFuncao('exportCsv');
  assert.match(corpo, /typeof value === 'string'/);
  assert.match(corpo, /\^\[\\t\\r \]\*\[=\+\\-@\]/);
  assert.match(corpo, /\? `\'\$\{raw\}` : raw/);
  assert.match(corpo, /URL\.revokeObjectURL\(url\)/, 'a URL temporária também deve ser liberada');
});

test('tokens e credenciais não são persistidos no armazenamento do navegador', () => {
  const writes = [...PANEL.matchAll(/localStorage\.setItem\(([^\n;]+)/g)].map((match) => match[1]);
  assert.ok(writes.length > 0, 'preferências legítimas devem continuar persistidas');
  for (const write of writes) {
    assert.doesNotMatch(write, /token|password|senha|licenseKey|secret/i, `persistência sensível: ${write}`);
  }
});
