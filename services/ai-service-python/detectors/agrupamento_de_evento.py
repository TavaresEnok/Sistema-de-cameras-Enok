"""Um incidente vira UM evento — não um a cada 45 segundos.

O QUE ISTO CORRIGE
------------------
O ensaio de 19–24/08/2026 (motion-bgs-lab) mediu 14.338 ativações em 24h e
descobriu que **88% delas eram repetição do mesmo incidente**. A conclusão do
estudo foi explícita: reduzir essa fragmentação rende mais que trocar de
algoritmo de detecção — o MOG2 ficou em 4º entre 32 e é o mais barato dos
líderes, então não há o que ganhar trocando.

A causa estava na regra de desconto. Ela contava o tempo a partir do ÚLTIMO
EVENTO EMITIDO:

    se (agora - ultimo_evento) > 45s: emite

Com movimento contínuo, isso emite um evento a cada 45 segundos para sempre.
Uma pessoa circulando cinco minutos virava sete eventos; a Cam-06 sozinha
gerava 252 ativações por hora.

A REGRA CERTA
-------------
O tempo tem de ser contado a partir da última vez que o movimento foi VISTO,
não da última vez que um evento foi emitido:

    se (agora - ultima_vez_visto) > silencio: emite  (incidente novo)
    ultima_vez_visto = agora                          (sempre)

Assim, movimento contínuo é UM evento, dure o que durar. Só nasce evento novo
quando a cena de fato ficou quieta e o movimento voltou.

O TETO, E POR QUE ELE EXISTE
----------------------------
Sem teto, um incidente que nunca termina — galho balançando a tarde inteira,
bandeira ao vento — emitiria UM evento e nada mais. O operador olharia a lista,
veria um evento de três horas atrás e concluiria que o sistema parou.

Por isso um incidente muito longo emite um marco periódico. É raro por
construção: só acontece quando o movimento realmente não cessa.

Puro de propósito: nenhuma dependência de câmera, relógio real ou rede.
"""

DEFAULT_SILENCIO_SEGUNDOS = 45.0
"""Quanto tempo sem movimento fecha o incidente. Mesmo valor do antigo desconto:
   o número não muda, o SIGNIFICADO dele é que muda."""

DEFAULT_TETO_DO_INCIDENTE_SEGUNDOS = 600.0
"""Dez minutos. Acima disso o incidente emite um marco, para não sumir da lista."""


class AgrupadorDeEventos:
    """Decide se uma detecção abre um incidente novo ou continua o atual."""

    def __init__(self, silencio_segundos=None, teto_segundos=None):
        self._silencio = float(
            DEFAULT_SILENCIO_SEGUNDOS if silencio_segundos is None else silencio_segundos
        )
        self._teto = float(
            DEFAULT_TETO_DO_INCIDENTE_SEGUNDOS if teto_segundos is None else teto_segundos
        )
        # Por tipo de evento: quando o movimento foi visto pela última vez, e
        # quando o incidente atual começou.
        self._visto_em = {}
        self._incidente_desde = {}

    def decidir(self, tipo, agora):
        """Devolve (emitir, motivo).

        `motivo` é chave estável para log e teste:
          · 'incidente-novo'      — a cena estava quieta e o movimento voltou
          · 'continua'            — mesmo incidente, não emite
          · 'marco-de-incidente'  — incidente longo demais, emite um marco
        """
        agora = float(agora)
        visto = self._visto_em.get(tipo)
        self._visto_em[tipo] = agora

        # Primeira vez, ou a cena ficou quieta o bastante: incidente novo.
        if visto is None or (agora - visto) > self._silencio:
            self._incidente_desde[tipo] = agora
            return True, "incidente-novo"

        inicio = self._incidente_desde.get(tipo, agora)
        if self._teto > 0 and (agora - inicio) >= self._teto:
            # Reabre a contagem para o marco seguinte sair só depois de outro
            # período inteiro, e não a cada quadro daqui em diante.
            self._incidente_desde[tipo] = agora
            return True, "marco-de-incidente"

        return False, "continua"

    def duracao_do_incidente(self, tipo, agora):
        """Há quanto tempo o incidente atual está aberto. 0 se não há incidente."""
        inicio = self._incidente_desde.get(tipo)
        return 0.0 if inicio is None else max(0.0, float(agora) - inicio)

    def esquecer(self, tipo=None):
        """Zera o estado — usado quando a câmera reconecta e a cena mudou."""
        if tipo is None:
            self._visto_em.clear()
            self._incidente_desde.clear()
        else:
            self._visto_em.pop(tipo, None)
            self._incidente_desde.pop(tipo, None)
