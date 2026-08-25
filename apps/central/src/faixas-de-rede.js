'use strict';

/**
 * FAIXAS DE REDE dos túneis — e a colisão que vaza imagem entre clientes.
 *
 * "e se fizerem 50 cameras cada uma com uma vpn diferente?" (dono, 24/08/2026)
 *
 * A VPN é por REDE, não por câmera: um túnel alcança todas as câmeras daquele
 * cliente. O perigo real aparece quando um servidor abre túneis para EMPRESAS
 * diferentes — e quase todo roteador do Brasil sai de fábrica com a mesma
 * faixa:
 *
 *     Loja A → 192.168.1.0/24
 *     Loja B → 192.168.1.0/24
 *
 * Com os dois túneis de pé, o servidor recebe um pedido para 192.168.1.50 e não
 * tem como saber de qual loja é. Manda para o primeiro e pronto. NÃO dá erro,
 * NÃO avisa: mostra a imagem do cliente errado. Numa instalação de segurança
 * isso é vazamento de imagem entre clientes, e é o tipo de defeito que só
 * aparece meses depois.
 *
 * Por isso a Central recusa configurar um túnel cuja faixa se sobreponha à de
 * outro já configurado na MESMA instalação — e diz com qual.
 *
 * Funções puras: sem rede, sem banco, sem relógio.
 */

/** '192.168.1.0/24' → { base: <inteiro>, prefixo: 24 }. null se inválido. */
function lerCidr(texto) {
  const m = /^\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*\/\s*(\d{1,2})\s*$/.exec(String(texto || ''));
  if (!m) return null;
  const octetos = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (octetos.some((o) => o > 255)) return null;
  const prefixo = Number(m[5]);
  if (prefixo < 0 || prefixo > 32) return null;
  const inteiro = ((octetos[0] << 24) >>> 0) + (octetos[1] << 16) + (octetos[2] << 8) + octetos[3];
  // Máscara aplicada: 192.168.1.77/24 e 192.168.1.0/24 são a MESMA faixa, e
  // aceitar as duas como diferentes deixaria a colisão passar.
  const mascara = prefixo === 0 ? 0 : (0xFFFFFFFF << (32 - prefixo)) >>> 0;
  return { base: (inteiro & mascara) >>> 0, prefixo, mascara };
}

/** Uma faixa contém a outra, em qualquer sentido? */
function seSobrepoe(a, b) {
  const x = lerCidr(a);
  const y = lerCidr(b);
  if (!x || !y) return false;
  const menorPrefixo = Math.min(x.prefixo, y.prefixo);
  const mascara = menorPrefixo === 0 ? 0 : (0xFFFFFFFF << (32 - menorPrefixo)) >>> 0;
  return ((x.base & mascara) >>> 0) === ((y.base & mascara) >>> 0);
}

/** Separa uma lista 'a/24, b/24' em faixas válidas e entradas recusadas. */
function lerLista(texto) {
  const partes = String(texto || '').split(',').map((p) => p.trim()).filter(Boolean);
  const validas = [];
  const invalidas = [];
  for (const p of partes) {
    if (lerCidr(p)) validas.push(p);
    else invalidas.push(p);
  }
  return { validas, invalidas };
}

/**
 * Pode configurar este túnel na instalação?
 *
 * `outros` são os túneis JÁ configurados na mesma instalação, cada um com
 * `{ nome, faixas }`. Reconfigurar o MESMO túnel não colide consigo mesmo.
 */
function validarFaixasDoTunel({ nome, faixas, outros = [] }) {
  const { validas, invalidas } = lerLista(faixas);
  if (invalidas.length) {
    return { ok: false, motivo: 'faixa-invalida', detalhe: invalidas.join(', ') };
  }
  if (!validas.length) {
    return { ok: false, motivo: 'faixa-ausente', detalhe: '' };
  }

  for (const outro of outros) {
    if (String(outro.nome) === String(nome)) continue;
    const desteOutro = lerLista(outro.faixas).validas;
    for (const minha of validas) {
      for (const dele of desteOutro) {
        if (seSobrepoe(minha, dele)) {
          return {
            ok: false,
            motivo: 'faixa-em-conflito',
            detalhe: `${minha} conflita com ${dele}, já usada pelo túnel "${outro.nome}"`,
          };
        }
      }
    }
  }
  return { ok: true, motivo: 'ok', faixas: validas };
}

module.exports = { lerCidr, seSobrepoe, lerLista, validarFaixasDoTunel };
