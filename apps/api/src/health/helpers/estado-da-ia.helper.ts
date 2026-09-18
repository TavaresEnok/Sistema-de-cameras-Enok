/**
 * A IA está REALMENTE analisando, ou só parece que está?
 *
 * Duas coisas diferentes eram lidas como uma só:
 *   · a câmera estar MARCADA com IA (campo no cadastro);
 *   · existir alguém ANALISANDO aquela câmera (processador armado).
 *
 * O verificador de prontidão olhava só a primeira e dizia "ok". Medido na Vibe
 * em 18/09/2026: 34 câmeras marcadas, ZERO analisadas, 241 avisos de "detector
 * cego" em 24 h e 698 trechos gravados pela gravação de emergência numa única
 * câmera — com o painel verde o tempo todo.
 *
 * A causa era uma contradição silenciosa: `AI_AUTO_START_ENABLED=false` (herdado
 * do `.env.example`) com câmeras marcadas para IA. Nada arma os detectores, o
 * health-check acusa "cego", a gravação de emergência liga contínuo e o disco
 * paga a conta — sem nenhum aviso de que a sincronização estava desligada.
 *
 * Esta regra é pura de propósito: é ela que decide o que o painel mostra, e
 * errar aqui é voltar a esconder o problema.
 */

export type EstadoDaIa = {
  status: 'ok' | 'attention';
  detail: string;
};

export type LeituraDaIa = {
  /** Câmeras com IA marcada no cadastro. */
  camerasComIa: number;
  /** Total de câmeras da instalação (só para a frase). */
  totalDeCameras: number;
  /** `AI_AUTO_START_ENABLED` — quem arma os detectores sozinho. */
  sincronizacaoAutomatica: boolean;
  /** Perfil de lançamento da instalação (`standard` tolera IA desligada). */
  perfilDeLancamento?: string | null;
};

export function avaliarEstadoDaIa(leitura: LeituraDaIa): EstadoDaIa {
  const marcadas = Number(leitura.camerasComIa) || 0;
  const total = Number(leitura.totalDeCameras) || 0;
  const automatica = leitura.sincronizacaoAutomatica !== false;
  const padrao = String(leitura.perfilDeLancamento ?? '') === 'standard';

  // O caso que ficava escondido: quer IA, mas nada a arma.
  if (marcadas > 0 && !automatica) {
    return {
      status: 'attention',
      detail:
        `${marcadas}/${total} cameras marcadas com IA, mas a sincronizacao automatica esta desligada `
        + '(AI_AUTO_START_ENABLED=false): nenhum detector e armado. Em gravacao por movimento, '
        + 'a gravacao de emergencia assume e grava continuo.',
    };
  }

  // Instalação que deliberadamente não usa IA: nada marcado e sincronização
  // desligada no perfil de lançamento padrão. Isso é coerente, não é defeito.
  if (marcadas === 0 && !automatica && padrao) {
    return { status: 'ok', detail: 'IA desativada por perfil de lancamento standard.' };
  }

  if (marcadas === 0) {
    return { status: 'attention', detail: `0/${total} cameras com IA habilitada.` };
  }

  return { status: 'ok', detail: `${marcadas}/${total} cameras com IA habilitada.` };
}
