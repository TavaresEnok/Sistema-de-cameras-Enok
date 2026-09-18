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
  /**
   * O modelo de detecção de OBJETO está instalado na máquina?
   * `null`/ausente = não deu para saber (serviço de IA fora do ar, versão
   * antiga sem esse campo). Não sabemos ≠ está faltando: não acusa.
   */
  modeloDeObjetoInstalado?: boolean | null;
  /** Modo de IA configurado (`motion` = só movimento; `general` = objeto). */
  modoDeIa?: string | null;
};

export function avaliarEstadoDaIa(leitura: LeituraDaIa): EstadoDaIa {
  const marcadas = Number(leitura.camerasComIa) || 0;
  const total = Number(leitura.totalDeCameras) || 0;
  const automatica = leitura.sincronizacaoAutomatica !== false;
  const padrao = String(leitura.perfilDeLancamento ?? '') === 'standard';
  const modo = String(leitura.modoDeIa ?? '').trim().toLowerCase();
  const modoDeObjeto = modo === 'general';
  // Só acusa falta quando a leitura disse explicitamente que falta. `null` é
  // "não deu para saber" — acusar aí seria inventar defeito em instalação sadia.
  const modeloAusente = leitura.modeloDeObjetoInstalado === false;

  // Prometer o que a máquina não entrega: modo objeto configurado e a pasta de
  // modelos vazia. Medido em 18/09/2026 nas duas instalações de cliente.
  const faltaModelo = modoDeObjeto && modeloAusente
    ? ' Alem disso, o modo de IA e de deteccao de OBJETO e o modelo NAO esta instalado nesta maquina '
      + '(pasta de modelos vazia): instale em infra/ai-models.'
    : '';

  // ORDEM IMPORTA: os dois problemas podem existir juntos, e o pior é não haver
  // NINGUÉM analisando — sem detector armado não existe nem movimento, quanto
  // mais objeto. Por isso ele vem primeiro e o modelo entra como acréscimo, em
  // vez de uma frase substituir a outra e esconder metade do estrago.
  if (marcadas > 0 && !automatica) {
    return {
      status: 'attention',
      detail:
        `${marcadas}/${total} cameras marcadas com IA, mas a sincronizacao automatica esta desligada `
        + '(AI_AUTO_START_ENABLED=false): nenhum detector e armado. Em gravacao por movimento, '
        + `a gravacao de emergencia assume e grava continuo.${faltaModelo}`,
    };
  }

  if (faltaModelo) {
    return {
      status: 'attention',
      detail:
        'Modo de IA configurado para deteccao de OBJETO, mas o modelo nao esta instalado nesta maquina '
        + '(pasta de modelos vazia): nenhum objeto sera detectado. Instale o modelo em infra/ai-models.',
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

  // Modo movimento com a pasta de modelos vazia NÃO é defeito — o detector de
  // movimento não usa modelo nenhum. Mas o filtro que descarta o ruído noturno
  // das câmeras ONVIF usa, e sem ele grava tudo. Informa sem pintar de vermelho.
  const ressalva = modeloAusente
    ? ' Sem modelo de objeto instalado: a confirmacao por objeto nao roda (movimento segue funcionando).'
    : '';
  return { status: 'ok', detail: `${marcadas}/${total} cameras com IA habilitada.${ressalva}` };
}
