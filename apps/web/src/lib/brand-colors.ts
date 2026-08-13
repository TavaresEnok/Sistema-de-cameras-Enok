// Conversão de cor de marca (hex) para os canais HSL que as CSS vars do tema usam
// (ex.: '--primary: 212 90% 44%'). Puro, AUTOCONTIDO (sem import relativo, para
// rodar sob o type-stripping nativo do Node nos testes) e testável. Cobre AS DUAS
// famílias de acento do app — os tokens shadcn (--primary/--ring) e os tokens da
// camada de design (--acc*) —, porque cobrir só a primeira deixava metade da
// interface no azul do DRAC (ver comentário em buildThemeVars).

function parseHex(hex: string | null | undefined): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  return { r: ((int >> 16) & 255) / 255, g: ((int >> 8) & 255) / 255, b: (int & 255) / 255 };
}

/** '#0B6BD6' → '212 90% 44%'. null se o hex for inválido. */
export function hexToHslChannels(hex: string | null | undefined): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Texto legível (preto/branco em canais HSL) sobre um fundo de cor `bgHex`. */
export function readableForegroundChannels(bgHex: string | null | undefined): string {
  const rgb = parseHex(bgHex);
  if (!rgb) return '0 0% 100%'; // inválido → assume fundo escuro → texto branco
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
  return lum > 0.4 ? '0 0% 0%' : '0 0% 100%';
}

/** Canais HSL com a luminosidade forçada para dentro de [min, max]. */
function comLuminosidadeEntre(hex: string, min: number, max: number): string | null {
  const canais = hexToHslChannels(hex);
  if (!canais) return null;
  const m = /^(\d+) (\d+)% (\d+)%$/.exec(canais);
  if (!m) return null;
  const l = Math.min(max, Math.max(min, Number(m[3])));
  return `${m[1]} ${m[2]}% ${l}%`;
}

/** '#0B6BD6' + 0.09 → 'rgba(11,107,214,0.09)'. null se o hex for inválido. */
function comTransparencia(hex: string, alfa: number): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const c = (v: number) => Math.round(v * 255);
  return `rgba(${c(rgb.r)},${c(rgb.g)},${c(rgb.b)},${alfa})`;
}

// Cores de UM tema (claro OU escuro). Cada campo é o hex do cliente para aquele
// papel semântico; ausente/inválido → mantém o token DRAC daquele papel.
type ThemeColors = {
  primary?: string; // acento → --primary / --ring
  buttonText?: string; // texto sobre o acento → --primary-foreground
  background?: string; // fundo da tela → --background
  backgroundText?: string; // texto sobre o fundo → --foreground
  surface?: string; // superfície de card/painel → --card/--popover/--secondary/--muted/--accent
  text?: string; // texto sobre a superfície → *-foreground das superfícies
  textSub?: string; // subtexto sobre a superfície → --muted-foreground
  border?: string; // bordas → --border/--card-border/--popover-border
};

// Declarações `--var:canais` de UM tema. Só emite a var quando a cor do cliente é
// válida; nunca recolore um texto sem também recolorir a superfície dele (assim o
// contraste — texto legível — é sempre garantido, do cliente ou calculado por WCAG).
function buildThemeVars(c: ThemeColors, escuro: boolean): string[] {
  const decls: string[] = [];

  // Acento (primary/ring) + texto legível sobre ele.
  const primary = hexToHslChannels(c.primary);
  if (primary) {
    const primaryFg = hexToHslChannels(c.buttonText) ?? readableForegroundChannels(c.primary);
    decls.push(`--primary:${primary}`, `--ring:${primary}`, `--primary-foreground:${primaryFg}`);

    // A FAMÍLIA --acc* TAMBÉM É ACENTO, e ficava de fora. O app tem duas famílias
    // de cor em paralelo: os tokens shadcn (--primary, em canais HSL) e os tokens
    // da camada de design (--acc/--acc-dim/--acc-bdr/--acc-text/--acc-on, em cor
    // literal), herdados do mock. A marca só reescrevia a primeira — então em 102
    // pontos de 20 telas o azul #0B6BD6 do DRAC continuava aparecendo por baixo da
    // identidade do cliente. O cliente D-GUARDIAN (amarelo #ffb407) via a borda
    // superior do login e o degradê do cartão AZUIS, e relatou como "sumiu a
    // personalização". Não sumiu: nunca tinha chegado ali.
    //
    // Os valores derivados imitam a relação que os tokens padrão já tinham entre
    // si, em vez de inventar números: transparências para preenchimento/borda, e
    // uma versão do acento com luminosidade corrigida para servir de TEXTO sobre
    // a superfície do tema (num tema claro o acento precisa escurecer; num escuro,
    // clarear). Sem isso, um acento amarelo viraria texto ilegível no tema claro.
    const acento = String(c.primary);
    const dim = comTransparencia(acento, escuro ? 0.14 : 0.09);
    const bdr = comTransparencia(acento, escuro ? 0.34 : 0.28);
    const texto = escuro ? comLuminosidadeEntre(acento, 75, 100) : comLuminosidadeEntre(acento, 0, 42);
    decls.push(`--acc:${acento}`);
    if (dim) decls.push(`--acc-dim:${dim}`);
    if (bdr) decls.push(`--acc-bdr:${bdr}`);
    if (texto) decls.push(`--acc-text:hsl(${texto})`);
    decls.push(`--acc-on:hsl(${primaryFg})`);
  }

  // Fundo da tela + texto legível sobre o fundo.
  const background = hexToHslChannels(c.background);
  if (background) {
    const backgroundFg = hexToHslChannels(c.backgroundText) ?? readableForegroundChannels(c.background);
    decls.push(`--background:${background}`, `--foreground:${backgroundFg}`);
  }

  // Superfícies (card/popover/secondary/muted/accent) + textos legíveis sobre elas.
  const surface = hexToHslChannels(c.surface);
  if (surface) {
    const surfaceFg = hexToHslChannels(c.text) ?? readableForegroundChannels(c.surface);
    const mutedFg = hexToHslChannels(c.textSub) ?? readableForegroundChannels(c.surface);
    decls.push(
      `--card:${surface}`,
      `--popover:${surface}`,
      `--secondary:${surface}`,
      `--muted:${surface}`,
      `--accent:${surface}`,
      `--card-foreground:${surfaceFg}`,
      `--popover-foreground:${surfaceFg}`,
      `--secondary-foreground:${surfaceFg}`,
      `--accent-foreground:${surfaceFg}`,
      `--muted-foreground:${mutedFg}`,
    );
  }

  // Bordas (borda geral + bordas de card/popover).
  const border = hexToHslChannels(c.border);
  if (border) {
    decls.push(`--border:${border}`, `--card-border:${border}`, `--popover-border:${border}`);
  }

  return decls;
}

export type BrandColorInput = {
  useDefaultColors?: boolean;
  // Tema escuro (.dark) — chaves sem prefixo.
  primaryColor?: string;
  buttonTextColor?: string;
  backgroundColor?: string;
  backgroundTextColor?: string;
  surfaceColor?: string;
  textColor?: string;
  textSubColor?: string;
  borderColor?: string;
  // Tema claro (:root) — chaves com prefixo Light.
  lightPrimaryColor?: string;
  lightButtonTextColor?: string;
  lightBackgroundColor?: string;
  lightBackgroundTextColor?: string;
  lightSurfaceColor?: string;
  lightTextColor?: string;
  lightTextSubColor?: string;
  lightBorderColor?: string;
};

/**
 * CSS que sobrescreve a paleta (accent/fundo/texto/borda/card/secondary/muted/accent)
 * nos dois temas a partir das cores do cliente. Tema claro → bloco :root (chaves
 * brandLight*); tema escuro → bloco .dark (chaves brand*). Retorna null quando o
 * cliente usa as cores padrão OU nenhuma cor válida — aí o DRAC padrão fica intocado.
 */
export function buildBrandColorCss(input: BrandColorInput): string | null {
  if (input.useDefaultColors) return null;
  const light = buildThemeVars({
    primary: input.lightPrimaryColor,
    buttonText: input.lightButtonTextColor,
    background: input.lightBackgroundColor,
    backgroundText: input.lightBackgroundTextColor,
    surface: input.lightSurfaceColor,
    text: input.lightTextColor,
    textSub: input.lightTextSubColor,
    border: input.lightBorderColor,
  }, false);
  const dark = buildThemeVars({
    primary: input.primaryColor,
    buttonText: input.buttonTextColor,
    background: input.backgroundColor,
    backgroundText: input.backgroundTextColor,
    surface: input.surfaceColor,
    text: input.textColor,
    textSub: input.textSubColor,
    border: input.borderColor,
  }, true);
  if (light.length === 0 && dark.length === 0) return null;
  const rules: string[] = [];
  // `:not(.dark)` NÃO é firula de especificidade — é o que impede o tema claro de
  // vazar para o escuro. A classe `dark` vive no <html>, o MESMO elemento que
  // `:root` casa, e ambos os seletores pesam igual; como este <style> é injetado
  // depois da folha do app, um `:root` puro venceria o `.dark` base em toda
  // variável que o bloco escuro abaixo não redeclare. Cliente com paleta clara
  // cheia e escura pela metade (o caso comum: o formulário já vem com o claro
  // preenchido) ganhava --card/--popover/--secondary/--muted/--accent BRANCOS no
  // tema escuro — caixas brancas no meio da tela preta. Foi o que aconteceu na
  // primeira instalação de cliente (D-GUARDIAN, 07/08/2026).
  if (light.length > 0) rules.push(`:root:not(.dark){${light.join(';')};}`);
  if (dark.length > 0) rules.push(`.dark{${dark.join(';')};}`);
  return rules.join('\n');
}
