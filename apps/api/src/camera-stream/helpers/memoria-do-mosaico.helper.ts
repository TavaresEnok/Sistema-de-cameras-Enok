/**
 * A MEMÓRIA DO MOSAICO — o que já descobrimos sobre a fonte de cada câmera.
 *
 * Pergunta do dono em 27/08/2026: "continua verificando se a câmera tem stream 2
 * em qualidade menor e já grava para não precisar procurar mais, e sempre usar
 * esse stream 2 no mosaico?"
 *
 * Não gravava. A busca acontecia e o resultado morava só na memória do processo,
 * por seis horas. Reiniciou a API, esqueceu tudo. Passaram seis horas, procura de
 * novo. E câmera SEM stream secundário era sondada para sempre, recebendo sempre
 * a mesma resposta negativa.
 *
 * Agora o achado é anotado. Três coisas que isso muda:
 *   1. O mosaico abre mais rápido — a decisão já está pronta;
 *   2. Câmera sem stream secundário para de ser interrogada em vão;
 *   3. Dá para MOSTRAR ao operador quais câmeras pesam no mosaico, em vez de
 *      ele descobrir pelo quadro preto no computador mais fraco.
 *
 * DUAS REGRAS QUE NÃO PODEM CAIR
 * ------------------------------
 * · SENHA NÃO SE GUARDA DUAS VEZES. A URL escolhida carrega usuário e senha.
 *   Guardamos a URL SEM eles e recolocamos na hora de usar, com a senha que já
 *   está no cadastro. Um segredo tem um lugar só.
 *
 * · DECISÃO ANOTADA NÃO PODE VIRAR PRISÃO. Se alguém mexe no cadastro da câmera
 *   — troca o IP, a porta, o caminho — a anotação perde a validade sozinha. E se
 *   alguém finalmente ligar o stream secundário na câmera, precisa haver como
 *   mandar procurar de novo.
 *
 * Puro: sem banco, sem rede, sem relógio.
 */

/** Os dados de cadastro que, mudando, invalidam o que descobrimos. */
export type CadastroDaFonte = {
  ip?: string | null;
  rtspPort?: number | null;
  username?: string | null;
  rtspPath?: string | null;
  channel?: number | null;
  subtype?: number | null;
};

/**
 * A "impressão digital" do cadastro.
 *
 * Duas câmeras nunca compartilham anotação, e a mesma câmera reconfigurada
 * também não aproveita a anterior — o que descobrimos valia para o endereço
 * antigo.
 */
export function impressaoDoCadastro(c: CadastroDaFonte): string {
  return [
    String(c.ip ?? '').trim(),
    String(c.rtspPort ?? ''),
    String(c.username ?? '').trim(),
    String(c.rtspPath ?? '').trim(),
    String(c.channel ?? ''),
    String(c.subtype ?? ''),
  ].join('|');
}

/**
 * Tira usuário e senha da URL, preservando todo o resto.
 *
 * Devolve a URL intacta quando não há credencial embutida — nem toda fonte tem.
 */
export function semSegredo(url: string | null | undefined): string | null {
  const bruto = String(url ?? '').trim();
  if (!bruto) return null;
  // `rtsp://usuario:senha@host:porta/caminho` → `rtsp://host:porta/caminho`
  return bruto.replace(/^(\w+:\/\/)[^@/]*@/, '$1');
}

/**
 * Recoloca a credencial na URL anotada, para uso imediato.
 *
 * Usuário e senha vêm do cadastro, que é onde eles vivem. Se não houver usuário,
 * devolve a URL como está — câmera aberta existe.
 */
export function comSegredo(
  urlSemSegredo: string | null | undefined,
  usuario: string | null | undefined,
  senha: string | null | undefined,
): string | null {
  const base = String(urlSemSegredo ?? '').trim();
  if (!base) return null;
  const u = String(usuario ?? '').trim();
  if (!u) return base;
  const cred = `${encodeURIComponent(u)}:${encodeURIComponent(String(senha ?? ''))}`;
  return base.replace(/^(\w+:\/\/)/, `$1${cred}@`);
}

export type AnotacaoDaFonte = {
  /** Impressão do cadastro quando a descoberta foi feita. */
  chave?: string | null;
  /** URL do sub SEM credencial. `null` com `temSub=false` = usar o principal. */
  urlSemSegredo?: string | null;
  codec?: string | null;
  /** `true` = achamos um stream secundário; `false` = a câmera não tem. */
  temSub?: boolean | null;
  precisaLimpeza?: boolean | null;
  descobertoEm?: Date | null;
};

export type MotivoDeIgnorar =
  | 'nunca-descoberto'
  | 'cadastro-mudou'
  | 'anotacao-vencida';

export type LeituraDaAnotacao =
  | { usar: true; urlSemSegredo: string | null; codec: string | null; precisaLimpeza: boolean }
  | { usar: false; motivo: MotivoDeIgnorar };

/**
 * A anotação ainda vale?
 *
 * `validadeMs = 0` (ou ausente) significa **sem prazo**: o achado vale até
 * alguém mexer no cadastro ou mandar procurar de novo. É o padrão, e é o pedido
 * do dono — "não precisa procurar mais". O prazo existe só para quem quiser
 * uma rede de segurança.
 */
export function lerAnotacao(
  anotacao: AnotacaoDaFonte | null | undefined,
  impressaoAtual: string,
  agora: number,
  validadeMs = 0,
): LeituraDaAnotacao {
  const a = anotacao ?? {};
  // `temSub` ausente é o sinal de "nunca perguntamos". Note que `false` é uma
  // RESPOSTA legítima — "esta câmera não tem stream secundário" — e é
  // justamente a que evita a sondagem eterna. Confundir os dois faria a Cam-24
  // ser interrogada para sempre.
  if (a.temSub === null || a.temSub === undefined) return { usar: false, motivo: 'nunca-descoberto' };
  if (String(a.chave ?? '') !== impressaoAtual) return { usar: false, motivo: 'cadastro-mudou' };

  if (validadeMs > 0) {
    const em = a.descobertoEm ? new Date(a.descobertoEm).getTime() : Number.NaN;
    if (!Number.isFinite(em) || agora - em >= validadeMs) {
      return { usar: false, motivo: 'anotacao-vencida' };
    }
  }

  return {
    usar: true,
    urlSemSegredo: a.temSub ? (a.urlSemSegredo ?? null) : null,
    codec: a.temSub ? (a.codec ?? null) : null,
    precisaLimpeza: a.precisaLimpeza === true,
  };
}

/** Frase curta para a tela do operador. */
export function comoExplicar(anotacao: AnotacaoDaFonte | null | undefined): string {
  const t = anotacao?.temSub;
  if (t === null || t === undefined) return 'Ainda não verificado.';
  if (t) return 'Usa o stream secundário no mosaico — leve.';
  return 'Não tem stream secundário: o mosaico usa o principal, e isso pesa em máquinas mais fracas.';
}
