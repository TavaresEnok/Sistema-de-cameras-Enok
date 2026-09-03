export type LiveProtocol = 'auto' | 'flv' | 'hls' | 'webrtc' | 'mjpeg' | 'llhls';
export type LiveDeliveryMode = 'grid' | 'grid-hevc' | 'original';
export type VideoCodecFamily = 'avc' | 'hevc' | 'unknown';

export type WebrtcInboundSample = {
  bytesReceived: number;
  framesDecoded: number | null;
};

export function videoCodecFamily(codec?: string | null): VideoCodecFamily {
  const normalized = String(codec ?? '').trim().toLowerCase();
  if (/h265|hevc|hvc1|hev1|\b265\b/.test(normalized)) return 'hevc';
  if (/h264|avc|avc1|\b264\b/.test(normalized)) return 'avc';
  return 'unknown';
}

type ProtocolPolicyInput = {
  deliveryMode: LiveDeliveryMode;
  sourceCodec?: string | null;
  preferred?: LiveProtocol | null;
  smartOrder?: LiveProtocol[] | null;
  learned?: LiveProtocol | null;
  mseDecodesHevc: boolean;
};

const isUsableProtocol = (protocol?: LiveProtocol | null): protocol is 'webrtc' | 'llhls' | 'hls' =>
  protocol === 'webrtc' || protocol === 'llhls' || protocol === 'hls';

/**
 * Sinal de vida do WebRTC vindo do RTP, e não do compositor do navegador.
 *
 * `requestVideoFrameCallback` pode ser suspenso quando há dezenas de elementos
 * de vídeo, quando a janela perde foco ou quando o compositor está ocupado. Isso
 * não significa que a mídia parou. O contador do receptor RTP continua sendo a
 * evidência correta. Quando o navegador expõe frames decodificados, ele é mais
 * forte; em implementações que não expõem, bytes recebidos são o fallback.
 */
export function hasWebrtcInboundProgress(
  previous: WebrtcInboundSample | null,
  current: WebrtcInboundSample,
) {
  if (!previous) return true;
  if (previous.framesDecoded !== null && current.framesDecoded !== null) {
    return current.framesDecoded > previous.framesDecoded;
  }
  return current.bytesReceived > previous.bytesReceived;
}

/** Uma conexão que chegou ao WHEP mas perdeu o primeiro quadro merece uma
 * segunda tentativa WebRTC antes de consumir o fallback HLS. Erros definitivos
 * de configuração/HTTP não entram neste retry curto. */
export function shouldRetryWebrtcStartup(reason: string, attempt: number) {
  if (attempt > 0) return false;
  return /conectou.*n[aã]o entregou|primeiro frame|cold start|demorou demais/i.test(reason);
}

/**
 * Uma única política decide a abertura inicial e toda recuperação posterior.
 *
 * Grade:
 * - WebRTC é sempre a primeira tentativa, para AVC, HEVC e codec ainda desconhecido.
 * - HLS em HEVC só entra quando o MSE declara suporte; em AVC é contingência segura.
 * - memória antiga nunca pula a tentativa WebRTC da grade.
 *
 * Câmera individual:
 * - respeita a preferência administrativa e o que funcionou naquele contexto;
 * - no modo original HEVC, testa WebRTC de verdade mesmo quando a declaração
 *   do navegador é incompleta; se falhar, o chamador ativa o caminho H.264.
 */
export function buildLiveProtocolOrder(input: ProtocolPolicyInput): LiveProtocol[] {
  const family = videoCodecFamily(input.sourceCodec);

  if (input.deliveryMode === 'grid' || input.deliveryMode === 'grid-hevc') {
    const order: LiveProtocol[] = ['webrtc'];
    if (input.deliveryMode === 'grid' || family !== 'hevc' || input.mseDecodesHevc) {
      order.push('llhls', 'hls');
    }
    return order;
  }

  if (input.deliveryMode === 'original' && family === 'hevc') {
    const order: LiveProtocol[] = ['webrtc'];
    if (input.mseDecodesHevc) order.push('llhls', 'hls');
    return order;
  }

  const order: LiveProtocol[] = [];
  const push = (protocol?: LiveProtocol | null) => {
    if (isUsableProtocol(protocol) && !order.includes(protocol)) order.push(protocol);
  };

  if (input.smartOrder?.length) {
    push(input.learned);
    for (const protocol of input.smartOrder) push(protocol);
    push('hls');
    push('webrtc');
    return order;
  }

  if (input.preferred === 'webrtc') return ['webrtc', 'llhls', 'hls'];
  if (input.preferred === 'hls') return ['hls', 'llhls', 'webrtc'];
  if (input.preferred === 'llhls') return ['llhls', 'hls', 'webrtc'];
  if (input.learned === 'hls' || input.learned === 'llhls') {
    push(input.learned);
    push('llhls');
    push('hls');
    push('webrtc');
    return order;
  }
  return ['webrtc', 'llhls', 'hls'];
}

export function shouldUseGridH264Fallback(
  deliveryMode: LiveDeliveryMode,
  sourceCodec?: string | null,
) {
  if (deliveryMode !== 'grid-hevc') return false;
  // AVC já é compatível: trocar de path apenas acrescentaria trabalho.
  // Codec desconhecido pode ser HEVC; depois de todos os transportes falharem,
  // H.264 é a contingência segura que evita deixar o tile sem imagem.
  return videoCodecFamily(sourceCodec) !== 'avc';
}

export function liveProtocolStorageKey(
  cameraId: string,
  deliveryMode: LiveDeliveryMode,
  sourceCodec?: string | null,
) {
  return `drac-live-protocol-v2:${cameraId}:${deliveryMode}:${videoCodecFamily(sourceCodec)}`;
}
