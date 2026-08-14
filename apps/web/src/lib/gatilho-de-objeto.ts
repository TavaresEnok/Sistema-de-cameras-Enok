// O gatilho "grava quando a IA confirma objeto" — o que oferecer e como chamar.
//
// Três defeitos que este módulo existe para impedir, todos relatados juntos em
// 14/08/2026 pelo dono, com a Central liberando SOMENTE "Pessoa":
//
//   1. O rótulo era o texto fixo "Pessoa ou veículo (IA)", em TRÊS telas. Com
//      só pessoa liberada, a tela prometia veículo.
//   2. A opção era oferecida mesmo com detecção de objeto NÃO liberada. Quem
//      escolhesse ficava com uma câmera que nunca grava — e nada na tela dizia
//      por quê. Câmera muda é o pior desfecho num sistema de segurança.
//   3. O conjunto padrão do backend é pessoa + bicicleta + carro + moto + …,
//      independente do que foi liberado. "Vazio = padrão" incluía classes que a
//      IA daquela instalação jamais emitiria.
//
// A regra que resolve os três: o que a tela oferece, promete e grava sai SEMPRE
// das classes que a Central liberou — nunca de um texto escrito à mão.

/** Nome de exibição de cada classe. Espelha o vocabulário da Central. */
export const NOME_DA_CLASSE: Record<string, string> = {
  person: 'Pessoa',
  bicycle: 'Bicicleta',
  car: 'Carro',
  motorcycle: 'Moto',
  bus: 'Ônibus',
  truck: 'Caminhão',
  dog: 'Cachorro',
  cat: 'Gato',
};

/** As que contam como veículo, para o rótulo curto ficar legível. */
const VEICULOS = new Set(['car', 'motorcycle', 'bus', 'truck', 'bicycle']);

function limpar(classes: unknown): string[] {
  if (!Array.isArray(classes)) return [];
  return [...new Set(classes.map((c) => String(c ?? '').trim().toLowerCase()).filter(Boolean))];
}

/**
 * Como chamar o gatilho, dadas as classes liberadas.
 *
 * Enumerar tudo ("Pessoa, carro, moto, ônibus, caminhão e bicicleta") não cabe
 * num seletor e ninguém lê. Agrupar veículos é o resumo honesto: diz o que vai
 * gravar sem prometer o que não foi liberado.
 */
export function rotuloDoGatilhoDeObjeto(classesLiberadas: unknown): string {
  const classes = limpar(classesLiberadas);
  if (!classes.length) return 'Objeto reconhecido pela IA';

  const temPessoa = classes.includes('person');
  const veiculos = classes.filter((c) => VEICULOS.has(c));
  const outros = classes.filter((c) => c !== 'person' && !VEICULOS.has(c));

  const partes: string[] = [];
  if (temPessoa) partes.push('Pessoa');
  if (veiculos.length === 1) partes.push(NOME_DA_CLASSE[veiculos[0]] ?? veiculos[0]);
  else if (veiculos.length > 1) partes.push('veículo');
  for (const o of outros) partes.push((NOME_DA_CLASSE[o] ?? o).toLowerCase());

  if (!partes.length) return 'Objeto reconhecido pela IA';
  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(', ')} ou ${partes[partes.length - 1]}`;
}

/** Descrição de apoio, que muda junto com o rótulo. */
export function descricaoDoGatilhoDeObjeto(classesLiberadas: unknown): string {
  const classes = limpar(classesLiberadas);
  if (!classes.length) {
    return 'Detecção de objeto não liberada para esta instalação.';
  }
  const nomes = classes.map((c) => (NOME_DA_CLASSE[c] ?? c).toLowerCase());
  const lista = nomes.length === 1
    ? nomes[0]
    : `${nomes.slice(0, -1).join(', ')} ou ${nomes[nomes.length - 1]}`;
  return `Só grava quando a IA confirmar ${lista}.`;
}

/**
 * O gatilho pode ser OFERECIDO?
 *
 * Sem classe liberada, não. E a tela deve DESABILITAR com explicação, não
 * esconder: esconder faz parecer defeito, desabilitar mostra que a função
 * existe e depende de outra coisa (§4 dos padrões de interface).
 */
export function podeUsarGatilhoDeObjeto(classesLiberadas: unknown): {
  pode: boolean;
  motivo: string | null;
} {
  if (limpar(classesLiberadas).length > 0) return { pode: true, motivo: null };
  return {
    pode: false,
    motivo: 'A detecção de objeto não está liberada para esta instalação. '
      + 'Enquanto isso, use "Movimento" — fale com o suporte para liberar.',
  };
}

/**
 * As classes que a câmera pode escolher: a interseção do que ela quer com o que
 * a instalação tem.
 *
 * Oferecer "Carro" numa instalação que só liberou "Pessoa" seria oferecer uma
 * escolha que nunca aconteceria — a IA não emite aquela classe, e a câmera
 * ficaria muda esperando um evento que não vem.
 */
export function classesOferecidas(classesLiberadas: unknown): string[] {
  return limpar(classesLiberadas);
}

/**
 * O que a câmera VAI gravar de fato: a escolha dela cruzada com o liberado.
 *
 * Escolha vazia significa "todas as liberadas", e não o conjunto histórico
 * fixo — é isso que impede a promessa de veículo numa instalação só de pessoa.
 * Gêmea de `classesEfetivasDeGravacao` no backend; divergir é o defeito difícil
 * de notar, então as duas são triviais e testadas.
 */
export function classesEfetivas(escolhidas: unknown, classesLiberadas: unknown): string[] {
  const liberadas = limpar(classesLiberadas);
  const escolha = limpar(escolhidas);
  if (!escolha.length) return liberadas;
  return escolha.filter((c) => liberadas.includes(c));
}
