/**
 * O PADRÃO DE INSTALAÇÃO — como toda câmera desta operação deve ser entregue.
 *
 * Definido pelo dono em 27/08/2026:
 *
 *     stream principal : 1080p em H.265
 *     stream 2         : 480p em H.264
 *
 * A razão é boa e vale escrever: o principal em H.265 economiza banda e disco
 * na gravação; o stream 2 em H.264 garante que o mosaico abra em QUALQUER
 * computador, sem o servidor ter de converter nada. Cada formato no lugar onde
 * ele é forte.
 *
 * POR QUE ISTO É CÓDIGO, E NÃO UM BILHETE NO PROCEDIMENTO
 * ------------------------------------------------------
 * Sem conferência automática, o desvio só aparece quando alguém reclama de
 * quadro preto — e reclama do computador mais fraco, dias depois, sem saber
 * qual câmera. Aconteceu nesta frota: três câmeras foram instaladas sem
 * stream 2 nenhum, mandando 1080p em H.265 direto para o mosaico. Ninguém
 * tinha como saber sem sondar câmera por câmera.
 *
 * Este módulo não conserta câmera. Ele diz QUAL está fora do padrão e POR QUÊ,
 * em português, para quem for até ela saber o que mexer.
 *
 * Puro: sem banco, sem rede.
 */

/** O principal é o que grava: queremos altura de 1080p. */
export const ALTURA_PRINCIPAL_ESPERADA = 1080;
/** O stream 2 é o que vai ao mosaico: 480p. Abaixo disso também serve. */
export const ALTURA_SUB_MAXIMA = 600;

export type LeituraDaCamera = {
  /** Codec do stream principal, como detectado na câmera. */
  codecPrincipal?: string | null;
  alturaPrincipal?: number | null;
  /** `null` = ainda não verificado; `false` = verificado e não existe. */
  temSub?: boolean | null;
  codecSub?: string | null;
  alturaSub?: number | null;
};

export type Conformidade = 'conforme' | 'desviado' | 'nao-verificado';

export type Diagnostico = {
  situacao: Conformidade;
  /** Cada desvio em uma frase, pronta para a tela. */
  desvios: string[];
  /** O desvio que mais dói, quando há mais de um. */
  resumo: string;
};

function ehH264(codec?: string | null): boolean {
  const c = String(codec ?? '').trim().toLowerCase();
  return c === 'h264' || c === 'avc' || c === 'avc1';
}

function ehH265(codec?: string | null): boolean {
  const c = String(codec ?? '').trim().toLowerCase();
  return c === 'h265' || c === 'hevc' || c === 'hvc1' || c === 'hev1';
}

/**
 * Confere uma câmera contra o padrão.
 *
 * Ordem dos desvios importa: o primeiro da lista é o que vira `resumo`, e o
 * que mais dói é "não tem stream 2" — é ele que deixa o mosaico pesado para
 * todo mundo. Codec errado no stream 2 vem logo atrás: pesa só para quem tem
 * máquina fraca, mas é o que produz o quadro preto.
 */
export function conferirPadrao(c: LeituraDaCamera): Diagnostico {
  // Sem verificação não se acusa ninguém. Dizer "fora do padrão" sobre o que
  // não foi medido faria o operador correr atrás de câmera que está certa.
  if (c.temSub === null || c.temSub === undefined) {
    return {
      situacao: 'nao-verificado',
      desvios: [],
      resumo: 'Ainda não verificada.',
    };
  }

  const desvios: string[] = [];

  if (!c.temSub) {
    desvios.push('Não tem stream 2. O mosaico é obrigado a usar o principal, e isso pesa em toda máquina.');
  } else {
    if (!ehH264(c.codecSub)) {
      const q = String(c.codecSub ?? '').trim() || 'desconhecido';
      desvios.push(`Stream 2 está em ${q.toUpperCase()}, deveria ser H.264 — é o que garante abrir em qualquer computador.`);
    }
    const h = Number(c.alturaSub);
    if (Number.isFinite(h) && h > ALTURA_SUB_MAXIMA) {
      desvios.push(`Stream 2 está em ${h}p, acima do padrão de 480p — carrega o mosaico à toa.`);
    }
  }

  if (c.codecPrincipal && !ehH265(c.codecPrincipal)) {
    const q = String(c.codecPrincipal).trim().toUpperCase();
    desvios.push(`Principal está em ${q}, o padrão é H.265 — em H.264 a gravação ocupa bem mais disco.`);
  }
  const hp = Number(c.alturaPrincipal);
  if (Number.isFinite(hp) && hp > 0 && hp < ALTURA_PRINCIPAL_ESPERADA) {
    desvios.push(`Principal está em ${hp}p, abaixo do padrão de 1080p — a gravação perde detalhe.`);
  }

  return {
    situacao: desvios.length ? 'desviado' : 'conforme',
    desvios,
    resumo: desvios[0] ?? 'Dentro do padrão: principal 1080p H.265, stream 2 480p H.264.',
  };
}

/** Contagem para o cabeçalho da tela. */
export function resumirFrota(diagnosticos: Diagnostico[]) {
  return {
    conformes: diagnosticos.filter((d) => d.situacao === 'conforme').length,
    desviadas: diagnosticos.filter((d) => d.situacao === 'desviado').length,
    naoVerificadas: diagnosticos.filter((d) => d.situacao === 'nao-verificado').length,
  };
}
