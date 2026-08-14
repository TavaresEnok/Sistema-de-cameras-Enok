/**
 * PRESETS e POSIÇÃO — as posições que a câmera já guarda, e onde ela está.
 *
 * Preset é a função de PTZ que o operador mais usa e a que faltava aqui: o
 * sistema só sabia empurrar a câmera para os lados. Quem instala uma dome
 * grava as posições que importam ("portão", "estacionamento", "doca") no
 * próprio equipamento, e depois quer um clique para cada uma. Elas JÁ EXISTEM
 * na câmera — em geral gravadas pelo instalador no painel dela — e até agora
 * nenhuma tela do DRAC as mostrava.
 *
 * A leitura do XML fica aqui, separada do serviço, porque é onde este recurso
 * erra em silêncio: preset sem nome vira botão sem rótulo, e nome com `&`
 * vira lista truncada. Nada disso levanta erro — só entrega uma tela quebrada.
 */

export type PresetDaCamera = {
  /** O identificador que a câmera usa no comando de ir até lá. */
  token: string;
  /** O que o operador lê no botão. Nunca vazio. */
  nome: string;
};

export type PosicaoPtz = {
  /** Horizontal e vertical, normalizados de -1 a 1 pela norma. */
  pan: number | null;
  tilt: number | null;
  /** Zoom, de 0 a 1. */
  zoom: number | null;
};

function desescaparXml(valor: string): string {
  return valor
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    // `&amp;` por último: antes desfaria as substituições acima.
    .replace(/&amp;/g, '&');
}

/** Escapa um nome de preset para entrar no envelope SOAP. */
export function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function conteudoDe(xml: string, nome: string): string | null {
  const re = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${nome}>`, 'i');
  return re.exec(xml)?.[1] ?? null;
}

/**
 * Lê a resposta de `GetPresets`.
 *
 * Duas defesas que existem por causa de como as câmeras realmente respondem:
 *
 *   · preset SEM `<Name>` (comum em slot gravado por controle remoto) recebe um
 *     rótulo derivado do token, senão o operador veria um botão em branco e não
 *     saberia o que ele faz;
 *   · token repetido é descartado. Alguns firmwares repetem a lista inteira
 *     quando há mais de um perfil, e a tela mostraria cada posição duas vezes.
 */
export function lerPresets(xml: string): PresetDaCamera[] {
  const blocos = xml.match(/<(?:[A-Za-z0-9_.-]+:)?Preset(?:\s[^>]*)?>[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?Preset>/gi) ?? [];
  const vistos = new Set<string>();
  const saida: PresetDaCamera[] = [];

  for (const bloco of blocos) {
    const token = /\btoken\s*=\s*["']([^"']*)["']/i.exec(bloco)?.[1]?.trim();
    if (!token || vistos.has(token)) continue;
    vistos.add(token);
    const nomeCru = conteudoDe(bloco, 'Name');
    const nome = desescaparXml((nomeCru ?? '').trim());
    saida.push({ token, nome: nome || `Posição ${token}` });
  }
  return saida;
}

function numeroDoAtributo(bloco: string | null, atributo: string): number | null {
  if (!bloco) return null;
  const bruto = new RegExp(`\\b${atributo}\\s*=\\s*["']([^"']*)["']`, 'i').exec(bloco)?.[1];
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lê a posição atual de uma resposta de `GetStatus`.
 *
 * Eixo ausente vira `null`, não zero: zero é o CENTRO da câmera, e mostrar
 * "centro" para uma câmera que não informou a posição faria a tela mentir —
 * e, pior, um comando de voltar ao ponto lido a moveria de verdade.
 */
export function lerPosicao(xml: string): PosicaoPtz {
  const posicao = conteudoDe(xml, 'Position') ?? xml;
  const panTilt = /<(?:[A-Za-z0-9_.-]+:)?PanTilt\b[^>]*>/i.exec(posicao)?.[0] ?? null;
  const zoom = /<(?:[A-Za-z0-9_.-]+:)?Zoom\b[^>]*>/i.exec(posicao)?.[0] ?? null;
  return {
    pan: numeroDoAtributo(panTilt, 'x'),
    tilt: numeroDoAtributo(panTilt, 'y'),
    zoom: numeroDoAtributo(zoom, 'x'),
  };
}

/**
 * Prende um eixo ao intervalo que a norma define.
 *
 * Mandar 1.5 em pan faz parte das câmeras recusar o comando inteiro e outras
 * irem para o extremo — as duas confundem quem está operando.
 */
export function limitarEixo(valor: number, minimo = -1, maximo = 1): number {
  if (!Number.isFinite(valor)) return 0;
  return Math.min(maximo, Math.max(minimo, valor));
}
