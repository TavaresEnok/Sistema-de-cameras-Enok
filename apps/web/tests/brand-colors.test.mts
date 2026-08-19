import assert from 'node:assert/strict';
import test from 'node:test';
import { hexToHslChannels, readableForegroundChannels, buildBrandColorCss } from '../src/lib/brand-colors.ts';

// D10: cores de marca (hex) → canais HSL das CSS vars do tema. Aplicação segura (accent).

test('hexToHslChannels converte para os canais do formato das CSS vars', () => {
  assert.equal(hexToHslChannels('#0B6BD6'), '212 90% 44%'); // = o --primary padrão do index.css
  assert.equal(hexToHslChannels('#ffffff'), '0 0% 100%');
  assert.equal(hexToHslChannels('#000000'), '0 0% 0%');
  assert.equal(hexToHslChannels('0B6BD6'), '212 90% 44%', 'aceita sem #');
  assert.equal(hexToHslChannels('nao-hex'), null);
  assert.equal(hexToHslChannels(''), null);
});

test('readableForegroundChannels escolhe preto sobre claro e branco sobre escuro', () => {
  assert.equal(readableForegroundChannels('#ffffff'), '0 0% 0%', 'fundo claro → texto preto');
  assert.equal(readableForegroundChannels('#0B6BD6'), '0 0% 100%', 'fundo escuro → texto branco');
  assert.equal(readableForegroundChannels('cor-invalida'), '0 0% 100%', 'inválido → assume escuro → branco');
});

test('buildBrandColorCss: cores padrão ou vazias NÃO sobrescrevem nada (DRAC intocado)', () => {
  assert.equal(buildBrandColorCss({ useDefaultColors: true, primaryColor: '#ff0000' }), null);
  assert.equal(buildBrandColorCss({ useDefaultColors: false }), null);
  assert.equal(buildBrandColorCss({ useDefaultColors: false, primaryColor: 'lixo' }), null);
});

test('buildBrandColorCss: gera regras :root (claro) e .dark (escuro) do accent', () => {
  const css = buildBrandColorCss({ useDefaultColors: false, primaryColor: '#000000', lightPrimaryColor: '#ffffff' });
  assert.ok(css);
  // Cada tema no seu bloco, com o accent do tema. Casamos o PREFIXO do bloco, não
  // a regra fechada: o mesmo bloco também carrega a família --acc* (ver o teste
  // "a marca alcança a família --acc"), e travar a chave `}` aqui fazia esta
  // asserção quebrar a cada token novo sem nada ter regredido de fato.
  assert.match(css!, /:root:not\(\.dark\)\{--primary:0 0% 100%;--ring:0 0% 100%;--primary-foreground:0 0% 0%;/);
  assert.match(css!, /\.dark\{--primary:0 0% 0%;--ring:0 0% 0%;--primary-foreground:0 0% 100%;/);
});

test('buildBrandColorCss: mapeia a PALETA completa (fundo/texto/borda/card/secondary/muted/accent) no tema claro', () => {
  const css = buildBrandColorCss({
    useDefaultColors: false,
    lightBackgroundColor: '#ffffff',      // fundo
    lightBackgroundTextColor: '#111827',  // texto sobre o fundo
    lightSurfaceColor: '#f3f5f9',         // superfície de card/painel
    lightTextColor: '#1a2230',            // texto sobre a superfície
    lightTextSubColor: '#4e5a6c',         // subtexto sobre a superfície
    lightBorderColor: '#d8dee8',          // bordas
  });
  assert.ok(css);
  // Fundo + texto do fundo
  assert.match(css!, /:root:not\(\.dark\)\{[^}]*--background:0 0% 100%;/);
  assert.match(css!, new RegExp(`:root:not\\(\\.dark\\)\\{[^}]*--foreground:${hexToHslChannels('#111827')!};`));
  assert.match(css!, /--bg:#ffffff;/, 'fundo da camada de design também deve seguir a marca');
  // Superfície replicada em card/popover/secondary/muted/accent
  const surface = hexToHslChannels('#f3f5f9')!;
  for (const v of ['--card', '--popover', '--secondary', '--muted', '--accent']) {
    assert.match(css!, new RegExp(`:root:not\\(\\.dark\\)\\{[^}]*${v}:${surface};`), `esperava ${v} = superfície do cliente`);
  }
  // Foreground das superfícies vem do texto do cliente; muted-foreground do subtexto
  const surfFg = hexToHslChannels('#1a2230')!;
  const mutedFg = hexToHslChannels('#4e5a6c')!;
  assert.match(css!, new RegExp(`:root:not\\(\\.dark\\)\\{[^}]*--card-foreground:${surfFg};`));
  assert.match(css!, new RegExp(`:root:not\\(\\.dark\\)\\{[^}]*--muted-foreground:${mutedFg};`));
  assert.match(css!, /--surf-1:#f3f5f9;/, 'cards da camada de design também devem seguir a marca');
  assert.match(css!, new RegExp(`--tx:hsl\\(${surfFg}\\);`), 'texto da camada de design deve seguir a marca');
  assert.match(css!, new RegExp(`--tx-2:hsl\\(${mutedFg}\\);`), 'subtexto da camada de design deve seguir a marca');
  // Bordas
  const border = hexToHslChannels('#d8dee8')!;
  assert.match(css!, new RegExp(`:root:not\\(\\.dark\\)\\{[^}]*--border:${border};`));
  assert.match(css!, new RegExp(`:root:not\\(\\.dark\\)\\{[^}]*--card-border:${border};`));
  assert.match(css!, new RegExp(`:root:not\\(\\.dark\\)\\{[^}]*--popover-border:${border};`));
  assert.match(css!, new RegExp(`--sidebar-border:${border};`), 'menu lateral deve receber a borda da marca');
  assert.match(css!, new RegExp(`--bdr:hsl\\(${border}\\);`), 'borda da camada de design deve seguir a marca');
  // Escuro não foi informado → nenhum bloco .dark
  assert.ok(!/\.dark\{/.test(css!), 'sem cores escuras não deve emitir bloco .dark');
});

test('buildBrandColorCss: sem cor de texto, o foreground cai no contraste WCAG legível da própria superfície', () => {
  // Superfície escura sem texto informado → texto branco. Fundo claro sem texto → preto.
  const css = buildBrandColorCss({
    useDefaultColors: false,
    lightBackgroundColor: '#ffffff',   // claro → foreground preto
    lightSurfaceColor: '#000000',      // superfície preta → foreground branco
  });
  assert.ok(css);
  assert.match(css!, /--foreground:0 0% 0%;/);          // WCAG: preto sobre fundo claro
  assert.match(css!, /--card-foreground:0 0% 100%;/);   // WCAG: branco sobre card preto
  assert.match(css!, /--muted-foreground:0 0% 100%;/);  // idem para o subtexto
});

test('buildBrandColorCss: cor de superfície INVÁLIDA não emite nenhuma var de superfície', () => {
  const css = buildBrandColorCss({
    useDefaultColors: false,
    lightPrimaryColor: '#0B6BD6', // válida, garante que algo é emitido
    lightSurfaceColor: 'lixo',    // inválida → superfície fica DRAC
  });
  assert.ok(css);
  for (const v of ['--card:', '--popover:', '--secondary:', '--muted:', '--accent:', '--card-foreground:']) {
    assert.ok(!css!.includes(v), `superfície inválida não deve emitir ${v}`);
  }
});

test('buildBrandColorCss: paleta escura vai para .dark e é independente da clara', () => {
  const css = buildBrandColorCss({
    useDefaultColors: false,
    backgroundColor: '#14161b',      // fundo escuro
    borderColor: '#282d38',
  });
  assert.ok(css);
  assert.match(css!, new RegExp(`\\.dark\\{[^}]*--background:${hexToHslChannels('#14161b')!};`));
  assert.match(css!, new RegExp(`\\.dark\\{[^}]*--border:${hexToHslChannels('#282d38')!};`));
  assert.ok(!/:root:not\(\.dark\)\{/.test(css!), 'sem cores claras não deve emitir bloco :root');
});

test('buildBrandColorCss: paleta inteira vazia/padrão NÃO gera override (DRAC intocado)', () => {
  // Nenhum campo válido em nenhum tema → null.
  assert.equal(buildBrandColorCss({ useDefaultColors: false, lightBackgroundColor: '', backgroundColor: '  ', borderColor: 'nope' }), null);
  // useDefaultColors mesmo com paleta completa preenchida → null.
  assert.equal(buildBrandColorCss({
    useDefaultColors: true,
    lightBackgroundColor: '#ffffff', lightSurfaceColor: '#f3f5f9', lightBorderColor: '#d8dee8', lightPrimaryColor: '#0B6BD6',
  }), null);
});

test('buildBrandColorCss: paleta clara CHEIA + escura PELA METADE não embranquece o tema escuro', () => {
  // O defeito real da primeira instalação de cliente (D-GUARDIAN, 07/08/2026):
  // a tela escura apareceu com caixas BRANCAS soltas no meio.
  //
  // O formulário de Aparência já vem com o tema claro inteiro preenchido, então
  // quem só escolhe "minha cor" e "meu fundo" salva exatamente isto: claro cheio,
  // escuro com duas cores. A classe `dark` mora no <html>, o mesmo elemento que
  // `:root` casa, e os dois seletores pesam igual — com este <style> injetado
  // depois da folha do app, um `:root` puro vencia o `.dark` BASE do tema em toda
  // variável que o bloco escuro não redeclarasse. Resultado: --card branco.
  const css = buildBrandColorCss({
    useDefaultColors: false,
    // escuro: só o que o cliente escolheu
    primaryColor: '#ffb407',
    backgroundColor: '#0e0c08',
    // claro: como o formulário entrega, completo
    lightPrimaryColor: '#2563eb',
    lightBackgroundColor: '#f5f7fb',
    lightSurfaceColor: '#ffffff',
    lightPrimaryTextColor: '#111827',
    lightBorderColor: '#94a3b8',
  } as Parameters<typeof buildBrandColorCss>[0]);
  assert.ok(css);

  // O bloco claro precisa deixar de casar quando o tema escuro está ativo.
  assert.ok(!/(^|\n):root\s*\{/.test(css!),
    'bloco :root sem guarda vence o .dark base e vaza superfícies claras para o tema escuro');
  assert.match(css!, /:root:not\(\.dark\)\{/);

  // A superfície branca do tema claro não pode valer no escuro.
  const escuro = css!.slice(css!.indexOf('.dark{'));
  assert.ok(!escuro.includes('--card:0 0% 100%'), 'card branco dentro do tema escuro');

  // E o que o cliente REALMENTE escolheu continua valendo no escuro.
  assert.match(escuro, new RegExp(`--primary:${hexToHslChannels('#ffb407')!};`));
  assert.match(escuro, new RegExp(`--background:${hexToHslChannels('#0e0c08')!};`));
});

// ── A FAMÍLIA --acc* (camada de design) também segue a marca ────────────────
// Regressão do relato "sumiu a personalização do D-GUARDIAN" (13/08/2026): a
// marca só alcançava --primary; --acc continuava #0B6BD6, e a borda superior do
// login e o degradê do cartão ficavam AZUIS num cliente de identidade amarela.

test('a marca alcança a família --acc, não só --primary', () => {
  const css = buildBrandColorCss({ primaryColor: '#ffb407', lightPrimaryColor: '#ffb407' }) ?? '';
  assert.match(css, /--acc:#ffb407/, 'o acento da camada de design tem de virar a cor do cliente');
  assert.doesNotMatch(css, /0B6BD6/i, 'não pode sobrar o azul padrão do DRAC');
  for (const v of ['--acc-dim', '--acc-bdr', '--acc-text', '--acc-on']) {
    assert.ok(css.includes(v), `faltou ${v} — o tom fica pela metade`);
  }
});

test('--acc-dim e --acc-bdr saem do acento do cliente, com a opacidade de cada tema', () => {
  const css = buildBrandColorCss({ primaryColor: '#ffb407', lightPrimaryColor: '#ffb407' }) ?? '';
  const claro = css.split('.dark{')[0];
  const escuro = css.split('.dark{')[1] ?? '';
  assert.match(claro, /--acc-dim:rgba\(255,180,7,0\.09\)/, 'tema claro: mesma opacidade do token padrão');
  assert.match(escuro, /--acc-dim:rgba\(255,180,7,0\.14\)/, 'tema escuro: mesma opacidade do token padrão');
  assert.match(claro, /--acc-bdr:rgba\(255,180,7,0\.28\)/);
  assert.match(escuro, /--acc-bdr:rgba\(255,180,7,0\.34\)/);
});

test('--acc-text corrige a luminosidade para continuar legível em cada tema', () => {
  // Amarelo puro (L=51%) como TEXTO sobre fundo branco é ilegível: tem de escurecer.
  const css = buildBrandColorCss({ primaryColor: '#ffb407', lightPrimaryColor: '#ffb407' }) ?? '';
  const claro = css.split('.dark{')[0];
  const escuro = css.split('.dark{')[1] ?? '';
  const lum = (bloco: string) => Number(/--acc-text:hsl\(\d+ \d+% (\d+)%\)/.exec(bloco)?.[1]);
  assert.ok(lum(claro) <= 42, `tema claro precisa escurecer o acento (veio ${lum(claro)}%)`);
  assert.ok(lum(escuro) >= 75, `tema escuro precisa clarear o acento (veio ${lum(escuro)}%)`);
});

test('--acc-on é o texto legível SOBRE o acento (preto no amarelo, branco no azul)', () => {
  const amarelo = buildBrandColorCss({ primaryColor: '#ffb407' }) ?? '';
  assert.match(amarelo, /--acc-on:hsl\(0 0% 0%\)/, 'sobre amarelo, texto preto');
  const azul = buildBrandColorCss({ primaryColor: '#0B6BD6' }) ?? '';
  assert.match(azul, /--acc-on:hsl\(0 0% 100%\)/, 'sobre azul escuro, texto branco');
});

test('sem cor de marca válida, nenhum --acc é emitido (o padrão DRAC fica intocado)', () => {
  assert.equal(buildBrandColorCss({ primaryColor: 'nao-hex' }), null);
  assert.equal(buildBrandColorCss({ useDefaultColors: true, primaryColor: '#ffb407' }), null);
  const soFundo = buildBrandColorCss({ backgroundColor: '#0e0c08' }) ?? '';
  assert.doesNotMatch(soFundo, /--acc/, 'cliente que só trocou o fundo não pode ganhar acento novo');
});
