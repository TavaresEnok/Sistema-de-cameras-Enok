import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const sidebar = fs.readFileSync(path.join(root, 'src/components/Sidebar.tsx'), 'utf8');
const login = fs.readFileSync(path.join(root, 'src/pages/LoginPage.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');

test('logo da instalação preserva proporção e aceita formato horizontal', () => {
  assert.match(sidebar, /h-full w-auto max-w-\[108px\] object-contain/);
  assert.match(login, /max-h-\[44px\].*w-auto max-w-\[210px\] object-contain/);
  assert.doesNotMatch(login, /h-\[30px\] w-\[30px\] object-contain/);
});

test('grupos do menu possuem hierarquia visual global e independente da marca', () => {
  assert.match(sidebar, /sidebar-section-label/);
  assert.match(css, /\.sidebar-section \+ \.sidebar-section/);
  assert.match(css, /\.sidebar-section-label/);
  assert.match(css, /border-top:/);
  assert.match(css, /color-mix\(in srgb, hsl\(var\(--sidebar-foreground\)\)/);
});
