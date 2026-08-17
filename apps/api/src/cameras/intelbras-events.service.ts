import { Injectable, Logger } from '@nestjs/common';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import {
  ehAberturaDeIncidente,
  extrairBlocos,
  extrairObservacao,
  lerEvento,
  traduzirCodigo,
} from './helpers/evento-intelbras.helper';

/**
 * FLUXO DE EVENTOS ANALÍTICOS das câmeras Intelbras/Dahua.
 *
 * O ONVIF entrega alarme binário — "algo se mexeu". As câmeras Intelbras com IA
 * embarcada sabem quem cruzou a linha e em que direção, a placa e a cor do
 * veículo, o nome da pessoa reconhecida e a similaridade. Nada disso cabe no
 * ONVIF, e por isso a família expõe `eventManager.cgi?action=attach`: um fluxo
 * HTTP que fica ABERTO e empurra cada disparo assim que a IA da câmera decide.
 *
 * Escrito em 17/08/2026 para clientes que trazem câmeras analíticas próprias.
 * A leitura do formato mora no helper, testada; aqui fica só a conexão.
 *
 * Três decisões que a operação exige:
 *
 *   · CONEXÃO PERSISTENTE com batimento. Sem `heartbeat`, roteador e proxy
 *     derrubam a conexão ociosa e a câmera fica muda sem ninguém perceber;
 *   · RECONEXÃO com espera crescente. Câmera que recusa não pode ser
 *     martelada a cada segundo — é o mesmo freio que o serviço ONVIF já usa;
 *   · o evento é entregue a quem assinou, e ESTE serviço não grava nada. Quem
 *     decide virar alarme, gravação ou nada é o chamador; misturar as duas
 *     coisas foi o que deixou o serviço ONVIF difícil de mexer.
 */

export type EventoRecebido = {
  cameraId: string;
  /** Nosso vocabulário: LINE_CROSSING, PLATE_READ, FACE_RECOGNIZED… */
  tipo: string;
  /** O código original do fabricante, sempre preservado. */
  codigoDoFabricante: string;
  acao: string;
  observacao: ReturnType<typeof extrairObservacao>;
  /** Payload íntegro do fabricante, para não perder o que ainda não sabemos ler. */
  bruto: Record<string, unknown>;
};

type Assinatura = {
  cameraId: string;
  parar: () => void;
};

@Injectable()
export class IntelbrasEventsService {
  private readonly logger = new Logger(IntelbrasEventsService.name);
  private readonly ativos = new Map<string, Assinatura>();

  /**
   * Abre (ou reabre) o fluxo de eventos de uma câmera.
   *
   * `codigos` vazio pede TODOS (`[All]`) — o certo enquanto não se sabe o que
   * o firmware oferece. A sonda de capacidades é quem descobre a lista real;
   * filtrar antes disso esconderia justamente os analíticos que o cliente
   * comprou.
   */
  assinar(
    entrada: {
      cameraId: string;
      host: string;
      porta: number;
      usuario: string;
      senha: string;
      codigos?: string[];
      batimentoSegundos?: number;
    },
    aoReceber: (evento: EventoRecebido) => void,
  ): void {
    this.cancelar(entrada.cameraId);

    let vivo = true;
    let esperaMs = 2000;
    let requisicao: http.ClientRequest | null = null;

    const codigos = entrada.codigos?.length ? `[${entrada.codigos.join(',')}]` : '[All]';
    const batimento = entrada.batimentoSegundos ?? 5;
    const caminho =
      `/cgi-bin/eventManager.cgi?action=attach&codes=${codigos}&heartbeat=${batimento}`;

    const conectar = () => {
      if (!vivo) return;

      // A família exige Digest, e o desafio vem do primeiro 401. Refazer o
      // cálculo a cada reconexão é obrigatório: o `nonce` expira.
      const primeira = http.request(
        { host: entrada.host, port: entrada.porta, path: caminho, method: 'GET', timeout: 15000 },
        (r1) => {
          const desafio = r1.headers['www-authenticate'];
          r1.resume();
          if (r1.statusCode !== 401 || !desafio) {
            this.logger.warn(
              `Câmera ${entrada.cameraId} não pediu Digest no fluxo de eventos (HTTP ${r1.statusCode}).`,
            );
            return reagendar();
          }
          abrirFluxo(String(desafio));
        },
      );
      primeira.on('error', (e) => {
        this.logger.debug(`Fluxo de eventos ${entrada.cameraId}: ${e.message}`);
        reagendar();
      });
      primeira.on('timeout', () => { primeira.destroy(); reagendar(); });
      primeira.end();
    };

    const abrirFluxo = (desafio: string) => {
      const d: Record<string, string> = {};
      desafio.replace(/(\w+)="?([^",]+)"?/g, (m, k, v) => { d[k] = v; return m; });
      const ha1 = crypto.createHash('md5').update(`${entrada.usuario}:${d.realm}:${entrada.senha}`).digest('hex');
      const ha2 = crypto.createHash('md5').update(`GET:${caminho}`).digest('hex');
      const nc = '00000001';
      const cnonce = crypto.randomBytes(8).toString('hex');
      const resposta = crypto
        .createHash('md5')
        .update(`${ha1}:${d.nonce}:${nc}:${cnonce}:${d.qop || 'auth'}:${ha2}`)
        .digest('hex');
      const autorizacao =
        `Digest username="${entrada.usuario}", realm="${d.realm}", nonce="${d.nonce}", `
        + `uri="${caminho}", qop=${d.qop || 'auth'}, nc=${nc}, cnonce="${cnonce}", response="${resposta}"`;

      // SEM timeout total: o fluxo fica aberto por horas de propósito. O
      // batimento da câmera é o que prova que a conexão está viva.
      requisicao = http.request(
        {
          host: entrada.host,
          port: entrada.porta,
          path: caminho,
          method: 'GET',
          headers: { Authorization: autorizacao },
        },
        (r2) => {
          if (r2.statusCode !== 200) {
            this.logger.warn(`Fluxo de eventos ${entrada.cameraId} recusado (HTTP ${r2.statusCode}).`);
            r2.resume();
            return reagendar();
          }
          this.logger.log(`Fluxo de eventos ABERTO em ${entrada.cameraId} (códigos ${codigos}).`);
          esperaMs = 2000;

          let buffer = '';
          r2.setEncoding('utf8');
          r2.on('data', (pedaco: string) => {
            buffer += pedaco;
            // Teto de segurança: firmware que despeja lixo sem separador não
            // pode crescer o buffer até derrubar o processo.
            if (buffer.length > 1_000_000) buffer = buffer.slice(-100_000);
            const { blocos, resto } = extrairBlocos(buffer);
            buffer = resto;
            for (const bloco of blocos) {
              const evento = lerEvento(bloco);
              if (!evento || !ehAberturaDeIncidente(evento)) continue;
              try {
                aoReceber({
                  cameraId: entrada.cameraId,
                  tipo: traduzirCodigo(evento.codigo),
                  codigoDoFabricante: evento.codigo,
                  acao: evento.acao,
                  observacao: extrairObservacao(evento),
                  bruto: evento.dadosCrus ? { _cru: evento.dadosCrus } : evento.dados,
                });
              } catch (erro) {
                // Falha de quem consome NÃO derruba o fluxo: perder a conexão
                // custa todos os eventos seguintes.
                this.logger.warn(
                  `Consumidor falhou no evento ${evento.codigo} de ${entrada.cameraId}: `
                  + `${erro instanceof Error ? erro.message : String(erro)}`,
                );
              }
            }
          });
          r2.on('end', () => reagendar());
          r2.on('error', () => reagendar());
        },
      );
      requisicao.on('error', (e) => {
        this.logger.debug(`Fluxo ${entrada.cameraId} caiu: ${e.message}`);
        reagendar();
      });
      requisicao.end();
    };

    const reagendar = () => {
      if (!vivo) return;
      const espera = esperaMs;
      esperaMs = Math.min(esperaMs * 2, 60_000);
      setTimeout(conectar, espera).unref?.();
    };

    this.ativos.set(entrada.cameraId, {
      cameraId: entrada.cameraId,
      parar: () => { vivo = false; try { requisicao?.destroy(); } catch { /* já morreu */ } },
    });
    conectar();
  }

  cancelar(cameraId: string): void {
    const a = this.ativos.get(cameraId);
    if (!a) return;
    a.parar();
    this.ativos.delete(cameraId);
    this.logger.log(`Fluxo de eventos encerrado em ${cameraId}.`);
  }

  /** Quais câmeras estão com o fluxo aberto — para a tela poder mostrar. */
  ativas(): string[] {
    return [...this.ativos.keys()];
  }
}
