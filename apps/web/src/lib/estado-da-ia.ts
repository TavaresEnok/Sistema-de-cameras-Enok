// Traduz o estado da IA de UMA câmera para o que o operador precisa ler.
//
// O backend (`GET /ai/intelligence`) já entrega tudo o que importa — se está
// rodando, se hibernou, o último erro e o motivo de estar bloqueada. O que ele
// entrega são CHAVES DE SISTEMA (`camera_ai_disabled`, `filtered_by_ai_env`) e
// campos soltos. Jogar isso na tela seria despejar o vocabulário do banco em
// cima de quem só quer saber se a câmera está vigiando.
//
// Este módulo é PURO e autocontido de propósito: a decisão de estado é a parte
// que erra em silêncio (uma câmera parada anunciada como saudável é pior que
// nenhuma informação), então ela tem teste próprio, fora de componente.
//
// Regra de escrita das frases, que vale para todas:
//   1. dizer o que ESTÁ acontecendo, não o nome do campo;
//   2. quando houver o que fazer, dizer o que fazer e ONDE;
//   3. quando NÃO houver, dizer isso — nunca sugerir um botão que não existe.

/** O pedaço do payload de /ai/intelligence que esta decisão consome. */
export type LinhaDeInteligencia = {
  participation?: {
    aiEnabled?: boolean;
    allowedByPolicy?: boolean;
    expectedToRun?: boolean;
    blockedReason?: string | null;
  };
  runtime?: {
    running?: boolean;
    hibernating?: boolean;
    lastError?: string | null;
    analysisType?: string | null;
  };
  stream?: {
    inferenceFps?: number | null;
    frameAgeAvgMs?: number | null;
  };
};

/** Tom visual. Separado do estado para a tela não repetir o mapa de cores. */
export type TomDoEstado = 'ok' | 'neutro' | 'atencao' | 'erro';

export type EstadoDaIa = {
  /** Chave estável para teste e para escolher ícone. */
  chave: 'analisando' | 'em-espera' | 'desligada' | 'restrita' | 'parada' | 'com-erro' | 'indefinido';
  /** Título curto, o que o olho lê primeiro. */
  titulo: string;
  /** Uma frase explicando — ou o que fazer, ou por que não há o que fazer. */
  detalhe: string;
  tom: TomDoEstado;
  /** A tela deve oferecer "Reiniciar" neste estado? */
  ofereceReiniciar: boolean;
};

/** 3.24 → "3,2 quadros por segundo". Null/zero → null (a tela omite). */
export function formatarQuadrosPorSegundo(fps: number | null | undefined): string | null {
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) return null;
  // Uma casa decimal basta: a diferença entre 3,2 e 3,24 não muda decisão
  // nenhuma, e o número comprido só polui a linha.
  const texto = fps.toFixed(1).replace('.', ',');
  return `${texto} quadros por segundo`;
}

/** "atraso do quadro" em linguagem de gente. Acima de 2 s já é sintoma. */
export function formatarAtrasoDoQuadro(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${Math.round(ms)} ms de atraso`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s de atraso`;
}

/**
 * O erro cru do detector é uma linha de log — caminho de arquivo, stack, nome
 * de exceção. Cortamos no tamanho de uma frase e devolvemos o começo, que é
 * onde mora a causa. A tela mostra o texto inteiro no title/tooltip.
 */
export function resumirErro(erro: string | null | undefined): string | null {
  const texto = String(erro ?? '').trim();
  if (!texto) return null;
  const primeiraLinha = texto.split('\n')[0].trim();
  if (primeiraLinha.length <= 120) return primeiraLinha;
  return `${primeiraLinha.slice(0, 117)}…`;
}

// Motivos que o backend emite hoje. O `default` existe porque um motivo novo
// no servidor NÃO pode virar um card em branco na tela do cliente — foi a regra
// que faltou em telas anteriores e produziu "estado vazio" sem explicação.
const MOTIVOS: Record<string, { titulo: string; detalhe: string; tom: TomDoEstado }> = {
  camera_ai_disabled: {
    titulo: 'IA desligada nesta câmera',
    detalhe: 'Use o botão Ligar nesta linha para ela voltar a analisar.',
    tom: 'neutro',
  },
  filtered_by_ai_env: {
    titulo: 'Fora da lista do servidor',
    detalhe:
      'Este servidor está configurado para analisar apenas algumas câmeras. '
      + 'Não dá para mudar por aqui — fale com o suporte.',
    tom: 'atencao',
  },
};

/**
 * O estado da IA numa câmera, pronto para a tela.
 *
 * A ORDEM das perguntas é o desenho da função, e não é arbitrária: vai do que
 * o usuário controla para o que ele não controla. Perguntar "está rodando?"
 * antes de "está ligada?" produziria "parada — deveria estar analisando" numa
 * câmera que o próprio operador desligou de propósito.
 */
export function estadoDaIa(linha: LinhaDeInteligencia | null | undefined): EstadoDaIa {
  if (!linha) {
    return {
      chave: 'indefinido',
      titulo: 'Sem informação',
      detalhe: 'O servidor ainda não respondeu sobre esta câmera.',
      tom: 'neutro',
      ofereceReiniciar: false,
    };
  }

  const p = linha.participation ?? {};
  const r = linha.runtime ?? {};

  // 1. Bloqueada — o usuário desligou, ou o servidor não deixa.
  if (p.expectedToRun === false || p.blockedReason) {
    const motivo = p.blockedReason ? MOTIVOS[p.blockedReason] : undefined;
    if (motivo) {
      return { chave: p.blockedReason === 'camera_ai_disabled' ? 'desligada' : 'restrita', ...motivo, ofereceReiniciar: false };
    }
    // Motivo desconhecido: dizer que não roda é honesto; inventar a causa não.
    return {
      chave: 'desligada',
      titulo: 'Não está analisando',
      detalhe: p.blockedReason
        ? `O servidor informou o motivo "${p.blockedReason}", que esta versão da tela ainda não sabe explicar.`
        : 'Esta câmera não está incluída na análise.',
      tom: 'neutro',
      ofereceReiniciar: false,
    };
  }

  // 2. Deveria rodar e deu erro — o erro vence o "rodando", porque um detector
  //    que reinicia em laço aparece como rodando entre uma queda e outra.
  const erro = resumirErro(r.lastError);
  if (erro) {
    return {
      chave: 'com-erro',
      titulo: 'Com erro',
      detalhe: erro,
      tom: 'erro',
      ofereceReiniciar: true,
    };
  }

  // 3. Deveria rodar e não está.
  if (r.running !== true) {
    return {
      chave: 'parada',
      titulo: 'Parada',
      detalhe: 'Esta câmera deveria estar sendo analisada e não está. Reiniciar costuma resolver.',
      tom: 'erro',
      ofereceReiniciar: true,
    };
  }

  // 4. Rodando, mas dormindo para poupar servidor.
  if (r.hibernating === true) {
    return {
      chave: 'em-espera',
      titulo: 'Em espera',
      detalhe: 'Sem movimento na cena. A análise acorda sozinha quando algo se mexer.',
      tom: 'neutro',
      ofereceReiniciar: true,
    };
  }

  // 5. Trabalhando. O número é o que separa "configurada" de "funcionando".
  const fps = formatarQuadrosPorSegundo(linha.stream?.inferenceFps);
  return {
    chave: 'analisando',
    titulo: 'Analisando',
    detalhe: fps ? `Processando ${fps}.` : 'Analisando a cena agora.',
    tom: 'ok',
    ofereceReiniciar: true,
  };
}

/**
 * A IA desta câmera pode ser desligada, ou é OBRIGATÓRIA?
 *
 * Gêmea de `detectorObrigatorio` no backend (cameras/helpers/motion-detector).
 * Quando a câmera grava por movimento E quem detecta é o sistema, desligar a IA
 * é contraditório: o gerenciador tenta subir a análise, encontra o detector
 * desligado e desiste — a cada 5 minutos, para sempre. Custou 7 câmeras nesse
 * estado, 5 delas ONLINE e mudas por 10 horas, sem nada na tela indicando
 * problema. O backend força `true` nesse caso.
 *
 * A tela precisa saber disto ANTES do clique: oferecer um botão que o servidor
 * vai ignorar é pior que não oferecer botão nenhum — o operador desliga, vê
 * ligado de novo e conclui que o sistema está quebrado.
 */
export function podeDesligarIa(camera: {
  recordingMode?: string | null;
  motionTrigger?: string | null;
}): { pode: boolean; motivo: string | null } {
  const armada = camera.recordingMode === 'motion' || camera.recordingMode === 'object';
  if (armada && camera.motionTrigger === 'SYSTEM') {
    return {
      pode: false,
      motivo: 'Esta câmera grava quando há movimento, e é a IA que detecta o movimento. '
        + 'Para desligá-la, mude o modo de gravação na aba Gravação da câmera.',
    };
  }
  return { pode: true, motivo: null };
}

/**
 * Resumo do topo da aba: uma frase sobre a frota inteira.
 *
 * Existe porque contar caixinha na tela é trabalho do sistema, não do operador.
 * "6 de 8 analisando" responde em um olhar o que oito linhas responderiam em
 * dez segundos.
 */
export function resumoDaFrota(input: {
  servicoOnline?: boolean;
  rodando?: number | null;
  esperadas?: number | null;
}): { titulo: string; tom: TomDoEstado } {
  if (input.servicoOnline === false) {
    return { titulo: 'O serviço de IA está fora do ar', tom: 'erro' };
  }
  const rodando = Number(input.rodando ?? 0);
  const esperadas = Number(input.esperadas ?? 0);
  if (esperadas === 0) {
    return { titulo: 'Nenhuma câmera com IA ligada', tom: 'neutro' };
  }
  if (rodando >= esperadas) {
    return {
      titulo: esperadas === 1 ? '1 câmera sendo analisada' : `${esperadas} câmeras sendo analisadas`,
      tom: 'ok',
    };
  }
  return {
    titulo: `${rodando} de ${esperadas} câmeras sendo analisadas`,
    tom: rodando === 0 ? 'erro' : 'atencao',
  };
}
