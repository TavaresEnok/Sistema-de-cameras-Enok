import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { shouldRemoveToken, invalidTokensFromReceipts, type ExpoReceipt } from './expo-receipts.helper';

export type PushMessage = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Canal Android (deve existir no app). */
  channelId?: string;
  /** Prioridade de entrega. Alarmes usam 'high'. */
  priority?: 'default' | 'normal' | 'high';
};

type ExpoTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

/**
 * Entrega de push com migração segura:
 * - apps novos Android usam token nativo `fcm:<token>` e a Central envia direto
 *   ao Firebase; a chave administrativa jamais entra nesta instalação;
 * - tokens Expo existentes continuam temporariamente para não cortar alertas de
 *   aparelhos ainda não atualizados.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly endpoint = 'https://exp.host/--/api/v2/push/send';
  private static readonly CHUNK = 100;

  constructor(private readonly configService: ConfigService) {}

  isExpoPushToken(token: string): boolean {
    return /^ExponentPushToken\[.+\]$/.test(token) || /^ExpoPushToken\[.+\]$/.test(token);
  }

  isFcmPushToken(token: string): boolean {
    return /^fcm:[A-Za-z0-9:_-]{20,4096}$/.test(token);
  }

  private directFcmConfig() {
    const centralUrl = String(this.configService.get<string>('CLOUD_API_URL') ?? process.env.CLOUD_API_URL ?? '').replace(/\/+$/, '');
    const installationId = String(this.configService.get<string>('CLOUD_INSTALLATION_ID') ?? process.env.CLOUD_INSTALLATION_ID ?? '').trim();
    const licenseKey = String(this.configService.get<string>('CLOUD_LICENSE_KEY') ?? process.env.CLOUD_LICENSE_KEY ?? '').trim();
    if (!centralUrl || !installationId || !licenseKey) {
      throw new Error('Push FCM direto não configurado: faltam dados da Central nesta instalação.');
    }
    let parsed: URL;
    try { parsed = new URL(centralUrl); } catch { throw new Error('URL da Central inválida para push FCM direto.'); }
    if (parsed.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
      throw new Error('Push FCM direto exige Central HTTPS.');
    }
    return { centralUrl, installationId, licenseKey };
  }

  private async sendFcmDirect(tokens: string[], message: PushMessage): Promise<string[]> {
    const unique = Array.from(new Set(tokens.filter((token) => this.isFcmPushToken(token))));
    if (!unique.length) return [];
    const { centralUrl, installationId, licenseKey } = this.directFcmConfig();
    const invalidTokens: string[] = [];
    for (let i = 0; i < unique.length; i += PushService.CHUNK) {
      const chunk = unique.slice(i, i + PushService.CHUNK);
      try {
        const response = await axios.post<{ invalidTokens?: string[] }>(
          `${centralUrl}/api/agent/push/fcm`,
          {
            tokens: chunk.map((token) => token.slice(4)),
            message,
          },
          {
            timeout: 20_000,
            headers: {
              'Content-Type': 'application/json',
              'X-DRAC-Installation-Id': installationId,
              'X-DRAC-License-Key': licenseKey,
            },
          },
        );
        for (const token of response.data?.invalidTokens ?? []) {
          if (/^[A-Za-z0-9:_-]{20,4096}$/.test(token)) invalidTokens.push(`fcm:${token}`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'unknown';
        this.logger.warn(`Falha ao enviar push FCM direto (lote ${i / PushService.CHUNK}): ${msg}`);
        throw error;
      }
    }
    return invalidTokens;
  }

  /** Envia a MESMA mensagem para vários tokens. Devolve os tokens inválidos. */
  async sendToTokens(tokens: string[], message: PushMessage): Promise<{ invalidTokens: string[]; receiptIds: Record<string, string> }> {
    const valid = Array.from(new Set(tokens.filter((t) => this.isExpoPushToken(t))));
    const directFcm = Array.from(new Set(tokens.filter((t) => this.isFcmPushToken(t))));
    if (!valid.length && !directFcm.length) return { invalidTokens: [], receiptIds: {} };

    // FCM não possui o estágio de receipt do Expo: resposta 200 significa que o
    // Firebase aceitou a mensagem. Token UNREGISTERED volta no mesmo request e
    // pode ser removido imediatamente. O envio corre antes do legado para que
    // o app novo não dependa de exp.host.
    const invalidTokens = await this.sendFcmDirect(directFcm, message);
    if (!valid.length) return { invalidTokens, receiptIds: {} };

    const accessToken = String(this.configService.get<string>('expoAccessToken') ?? '').trim();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const expoInvalidTokens: string[] = [];
    // receiptId → token, para o estágio 2 (fetchReceipts) conferir a entrega depois.
    const receiptIds: Record<string, string> = {};
    for (let i = 0; i < valid.length; i += PushService.CHUNK) {
      const chunk = valid.slice(i, i + PushService.CHUNK);
      const payload = chunk.map((to) => ({
        to,
        title: message.title,
        body: message.body,
        data: message.data ?? {},
        sound: 'default',
        priority: message.priority ?? 'high',
        channelId: message.channelId ?? 'alarms',
      }));
      try {
        const res = await axios.post<{ data?: ExpoTicket[] }>(this.endpoint, payload, {
          headers,
          timeout: 10_000,
        });
        const tickets = res.data?.data ?? [];
        tickets.forEach((ticket, idx) => {
          if (ticket.status === 'ok' && ticket.id) {
            receiptIds[ticket.id] = chunk[idx];
          } else if (ticket.status === 'error') {
            const err = ticket.details?.error;
            if (shouldRemoveToken(err)) expoInvalidTokens.push(chunk[idx]);
            this.logger.warn(`Expo push error token=${chunk[idx]?.slice(0, 24)}… error=${err ?? ticket.message}`);
          }
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'unknown';
        this.logger.warn(`Falha ao enviar push (chunk ${i / PushService.CHUNK}): ${msg}`);
        // Não marca tokens como inválidos em falha de rede: o job pode reprocessar.
        throw error;
      }
    }
    return { invalidTokens: [...invalidTokens, ...expoInvalidTokens], receiptIds };
  }

  /**
   * Estágio 2 do push: consulta os RECEIPTS dos tickets aceitos. O Expo processa a
   * entrega de forma assíncrona; alguns erros (inclusive DeviceNotRegistered) só
   * aparecem aqui, não no ticket. Idealmente chamado ~15min após o envio (job).
   * Devolve os tokens a remover — falha de rede não remove nada (pode reprocessar).
   */
  async fetchReceipts(
    receiptIdToToken: Record<string, string>,
  ): Promise<{ invalidTokens: string[]; failedChunks: number; lastError: string | null; okCount: number; errorCount: number }> {
    const ids = Object.keys(receiptIdToToken);
    if (!ids.length) return { invalidTokens: [], failedChunks: 0, lastError: null, okCount: 0, errorCount: 0 };
    const accessToken = String(this.configService.get<string>('expoAccessToken') ?? '').trim();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const invalidTokens: string[] = [];
    let failedChunks = 0;
    let lastError: string | null = null;
    // Contagem por desfecho: é o que PROVA a entrega (ou a nega) para promover o
    // status do alarme de ACCEPTED para DELIVERED/FAILED.
    let okCount = 0;
    let errorCount = 0;
    for (let i = 0; i < ids.length; i += PushService.CHUNK) {
      const chunk = ids.slice(i, i + PushService.CHUNK);
      try {
        const res = await axios.post<{ data?: Record<string, ExpoReceipt> }>(
          'https://exp.host/--/api/v2/push/getReceipts',
          { ids: chunk },
          { headers, timeout: 10_000 },
        );
        const idToToken = Object.fromEntries(chunk.map((id) => [id, receiptIdToToken[id]]));
        const receipts = res.data?.data ?? {};
        for (const receipt of Object.values(receipts)) {
          if (receipt?.status === 'error') errorCount += 1;
          else okCount += 1;
        }
        const { invalidTokens: dead, errors } = invalidTokensFromReceipts(receipts, idToToken);
        invalidTokens.push(...dead);
        for (const e of errors) this.logger.warn(`Expo receipt error token=${e.token.slice(0, 24)}… error=${e.error}`);
      } catch (error) {
        // Falha de rede/HTTP NÃO remove token (pode ser transitória), mas também
        // não pode ser engolida: o job precisa saber para RETENTAR. Seguimos os
        // demais chunks para não perder o progresso já obtido.
        failedChunks += 1;
        lastError = error instanceof Error ? error.message : 'unknown';
        this.logger.warn(`Falha ao consultar receipts do Expo: ${lastError}`);
      }
    }
    return { invalidTokens, failedChunks, lastError, okCount, errorCount };
  }
}
