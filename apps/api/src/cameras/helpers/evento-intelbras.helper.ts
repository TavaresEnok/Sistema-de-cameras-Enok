/**
 * LER O FLUXO DE EVENTOS ANALÍTICOS das câmeras Intelbras/Dahua.
 *
 * O ONVIF entrega alarme binário: "algo se mexeu". As câmeras Intelbras com IA
 * embarcada sabem muito mais — quem cruzou a linha e em que direção, a placa e
 * a cor do veículo, o nome da pessoa reconhecida e a similaridade — e nada
 * disso cabe no ONVIF. Por isso a família expõe `eventManager.cgi?action=attach`,
 * um fluxo HTTP que fica aberto e empurra cada disparo.
 *
 * O formato é peculiar e é o motivo deste módulo existir:
 *
 *     --myboundary
 *     Content-Type: text/plain
 *     Content-Length: 384
 *
 *     Code=CrossLineDetection;action=Start;index=0;data={
 *        "Direction" : "LeftToRight",
 *        "ObjectType" : "Human",
 *        "Name" : "Cerca Perimetral"
 *     }
 *
 * Três armadilhas, cada uma com teste próprio:
 *
 *   1. o JSON vem DEPOIS de `data=` e pode conter `;` e `=` dentro — cortar por
 *      esses separadores destrói o payload;
 *   2. o bloco chega PARTIDO entre leituras da rede. Quem processa pedaço a
 *      pedaço perde eventos silenciosamente;
 *   3. `action=Start` e `action=Stop` do MESMO objeto são um incidente só, não
 *      dois. Contar os dois duplica todo alarme.
 *
 * Escrito em 17/08/2026, para clientes que trazem câmeras analíticas próprias.
 */

export type EventoIntelbras = {
  /** Código do fabricante: CrossLineDetection, FaceRecognition, PlateDetection… */
  codigo: string;
  /** Start | Stop | Pulse — o ciclo de vida do incidente. */
  acao: string;
  indice: number;
  /** Payload do fabricante, preservado inteiro. */
  dados: Record<string, unknown>;
  /** Quando a leitura falhou, o texto cru — nunca se descarta o desconhecido. */
  dadosCrus?: string;
};

/**
 * Separa blocos completos do que chegou pela rede.
 *
 * Devolve os eventos prontos e o RESTO, que fica no buffer até completar. É a
 * defesa contra a armadilha 2: sem isto, um evento partido em duas leituras
 * some sem erro nenhum.
 */
export function extrairBlocos(buffer: string): { blocos: string[]; resto: string } {
  const blocos: string[] = [];
  // O separador do multipart. A câmera usa `--myboundary`, mas o nome varia por
  // firmware — por isso a marca é a linha que começa com `--`, não o texto.
  const partes = buffer.split(/\r?\n--[^\r\n]+\r?\n/);
  // O último pedaço pode estar incompleto: fica para a próxima rodada.
  const resto = partes.pop() ?? '';
  for (const parte of partes) {
    if (parte.includes('Code=')) blocos.push(parte);
  }
  // Sem separador ainda, mas com evento inteiro? Acontece em firmware que só
  // separa por linha em branco. Reconhecível pelo JSON fechado.
  if (!blocos.length && /Code=[^;]+;/.test(resto) && /}\s*$/.test(resto.trim())) {
    return { blocos: [resto], resto: '' };
  }
  return { blocos, resto };
}

/**
 * Lê um bloco. Devolve null quando não é evento (cabeçalho, batimento).
 *
 * O `data=` é lido do primeiro `=` até o fim, deliberadamente: o JSON contém
 * `;` e `=` e qualquer corte por separador o quebraria.
 */
export function lerEvento(bloco: string): EventoIntelbras | null {
  const codigo = /Code=([^;]+);/.exec(bloco)?.[1]?.trim();
  if (!codigo) return null;

  const acao = /action=([^;]+);/.exec(bloco)?.[1]?.trim() ?? 'Pulse';
  const indiceBruto = /index=([^;]+)[;\r\n]/.exec(bloco)?.[1]?.trim();
  const indice = Number.isFinite(Number(indiceBruto)) ? Number(indiceBruto) : 0;

  const corte = bloco.indexOf('data=');
  if (corte < 0) return { codigo, acao, indice, dados: {} };

  const cru = bloco.slice(corte + 'data='.length).trim();
  try {
    const analisado = JSON.parse(cru);
    return {
      codigo,
      acao,
      indice,
      dados: analisado && typeof analisado === 'object' ? analisado : {},
    };
  } catch {
    // Firmware novo pode mudar o formato. Guardar o cru é o que permite
    // descobrir isso depois, em vez de perder o evento em silêncio.
    return { codigo, acao, indice, dados: {}, dadosCrus: cru };
  }
}

/** Um incidente já contado não deve ser contado de novo pelo `Stop`. */
export function ehAberturaDeIncidente(evento: EventoIntelbras): boolean {
  return evento.acao !== 'Stop';
}

/**
 * Traduz o código do fabricante para o vocabulário do sistema.
 *
 * Código desconhecido NÃO vira 'OTHER' silencioso: devolve o próprio código do
 * fabricante, para o operador ver o que a câmera disse. Achatar o desconhecido
 * é como se perde a inteligência que se pagou para ter.
 */
export function traduzirCodigo(codigo: string): string {
  const mapa: Record<string, string> = {
    VideoMotion: 'MOTION',
    CrossLineDetection: 'LINE_CROSSING',
    CrossRegionDetection: 'INTRUSION',
    LeftDetection: 'OBJECT_LEFT',
    TakenAwayDetection: 'OBJECT_REMOVED',
    WanderDetection: 'LOITERING',
    RioterDetection: 'CROWD',
    ParkingDetection: 'ILLEGAL_PARKING',
    FaceDetection: 'FACE_DETECTED',
    FaceRecognition: 'FACE_RECOGNIZED',
    PlateDetection: 'PLATE_READ',
    TrafficJunction: 'PLATE_READ',
    PeopleCounting: 'PEOPLE_COUNT',
    SmartMotionHuman: 'PERSON',
    SmartMotionVehicle: 'VEHICLE',
    VideoLoss: 'VIDEO_LOSS',
    VideoBlind: 'TAMPER',
    AudioAnomaly: 'AUDIO_ANOMALY',
  };
  return mapa[codigo] ?? codigo;
}

/**
 * Extrai o que é CONSULTÁVEL do payload do fabricante.
 *
 * Guardar tudo num JSON genérico — como o sistema faz hoje — impede perguntas
 * como "onde apareceu a placa ABC1D23". Estes campos saem para colunas
 * próprias; o payload inteiro continua guardado ao lado.
 */
export function extrairObservacao(evento: EventoIntelbras) {
  const d = evento.dados as Record<string, any>;
  const candidato = d.Candidate ?? {};
  const face = d.FaceData ?? {};
  const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const numero = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);

  return {
    regra: texto(d.Name),
    tipoDeObjeto: texto(d.ObjectType),
    direcao: texto(d.Direction),
    // Caixa do fabricante em grade 0–8192; a conversão para pixels é de quem
    // desenha, e depende da resolução do canal.
    caixa: Array.isArray(d.BoundingBox ?? face.BoundingBox) ? (d.BoundingBox ?? face.BoundingBox) : null,
    placa: texto(d.PlateNumber),
    corDaPlaca: texto(d.PlateColor),
    corDoVeiculo: texto(d.VehicleColor),
    tipoDeVeiculo: texto(d.VehicleType),
    velocidade: numero(d.Speed),
    pessoa: texto(candidato.PersonName),
    similaridade: numero(candidato.Similarity),
    entraram: numero(d.EnteredSubtotal ?? d.Entered),
    sairam: numero(d.ExitedSubtotal ?? d.Exited),
    // Relógio da câmera. Pode divergir do nosso — por isso viaja junto, em vez
    // de virar "agora" na hora de gravar.
    ocorridoEm: numero(d.UTC),
  };
}
