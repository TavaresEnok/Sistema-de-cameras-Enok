/**
 * QUEM MANDA NA IA: a Central ou o `.env` da máquina?
 *
 * Havia duas autoridades dizendo coisas opostas, e a local vencia calada:
 *
 *   · a CENTRAL define a política por instalação (ai-policy.js) e `motion`
 *     nasce LIGADO — lá está escrito que desligá-lo "faz a câmera armada parar
 *     de gravar", por isso é decisão consciente;
 *   · o `.env` da instalação trazia `AI_AUTO_START_ENABLED=false`, herdado do
 *     `.env.example`, e isso fazia `onModuleInit` RETORNAR antes de tudo: sem
 *     sincronizar câmera nenhuma e sem sequer ligar o vigia que recupera
 *     detector degradado.
 *
 * O resultado medido em 18/09/2026, em duas instalações ao mesmo tempo:
 *   · Vibe: 34 câmeras marcadas, 0 analisadas, 241 avisos de "detector cego"
 *     em 24 h e 698 trechos gravados pela gravação de emergência numa câmera;
 *   · IBTelecom: 7 câmeras marcadas, 0 analisadas, última detecção de
 *     movimento 16 dias antes.
 *
 * A REGRA NOVA, e o porquê de cada ramo:
 *
 * 1. Central proibiu movimento → não sincroniza. A Central é a dona do escopo
 *    comercial; nada local a contradiz.
 * 2. Flag local desligada E nenhuma câmera marcada → não sincroniza. É uma
 *    instalação que de fato não quer IA; coerente, não é defeito.
 * 3. Flag local desligada MAS há câmera marcada → SINCRONIZA e avisa alto.
 *    Esta é a correção: câmera armada sem detector é o pior estado possível —
 *    o operador vê "gravação por movimento ativa" e não existe imagem, ou a
 *    gravação de emergência assume e grava contínuo, enchendo o disco. Na
 *    dúvida entre obedecer uma variável de ambiente e deixar câmera cega,
 *    obedecer a variável é a escolha errada.
 * 4. Caso normal → sincroniza.
 *
 * Puro de propósito: é a regra que decide se a IA existe na instalação.
 */

export type DecisaoDeSincronizacao = {
  sincronizar: boolean;
  /** `warn` quando as duas autoridades se contradizem; `log` no resto. */
  nivel: 'log' | 'warn';
  motivo: string;
};

export type LeituraParaSincronizar = {
  /** `AI_AUTO_START_ENABLED` — o interruptor local. */
  flagLocalLigada: boolean;
  /** Câmeras com IA marcada no cadastro. */
  camerasMarcadas: number;
  /** A Central permite detecção de MOVIMENTO nesta instalação? */
  movimentoPermitidoPelaCentral: boolean;
};

export function decidirSincronizacaoDeIa(leitura: LeituraParaSincronizar): DecisaoDeSincronizacao {
  const marcadas = Number(leitura.camerasMarcadas) || 0;
  const localLigada = leitura.flagLocalLigada !== false;
  const centralPermite = leitura.movimentoPermitidoPelaCentral !== false;

  if (!centralPermite) {
    return {
      sincronizar: false,
      nivel: 'log',
      motivo: 'Detecção de movimento não liberada para esta instalação pela Central.',
    };
  }

  if (!localLigada && marcadas === 0) {
    return {
      sincronizar: false,
      nivel: 'log',
      motivo: 'Sincronização automática de IA desativada por AI_AUTO_START_ENABLED=false (nenhuma câmera marcada com IA).',
    };
  }

  if (!localLigada) {
    return {
      sincronizar: true,
      nivel: 'warn',
      motivo:
        `AI_AUTO_START_ENABLED=false, mas ${marcadas} câmera(s) estão marcadas com IA e a Central libera movimento — `
        + 'sincronizando mesmo assim. Câmera armada sem detector fica cega e a gravação de emergência assume, '
        + 'gravando contínuo. Para realmente desligar a IA aqui, desmarque a IA nas câmeras.',
    };
  }

  return { sincronizar: true, nivel: 'log', motivo: 'Sincronizando IA com as câmeras...' };
}
