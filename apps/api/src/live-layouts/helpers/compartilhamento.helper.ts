/**
 * COMPARTILHAMENTO de mosaicos e rondas.
 *
 * Pedido em 26/08/2026, olhando o concorrente: hoje o mosaico é DE QUEM O
 * CRIOU, e num condomínio de dez pessoas as dez montam o mesmo mosaico. O
 * administrador passa a montar uma vez e ENTREGAR.
 *
 * O QUE ESTE MÓDULO GARANTE
 * -------------------------
 * 1. ENTREGAR MOSAICO NÃO ENTREGA CÂMERA. É a regra que não pode cair nunca.
 *    Um mosaico é uma lista de posições; quem o recebe vê apenas as câmeras
 *    que já tinha direito de ver, e as demais viram posição vazia. Sem isto,
 *    bastaria alguém colocar a câmera privada de um morador num mosaico e
 *    entregá-lo ao prédio inteiro para furar a LGPD por um caminho lateral.
 *
 * 2. A POSIÇÃO NÃO ANDA. Ao esconder uma câmera, o quadro fica preto no lugar
 *    dele. Se as outras subissem para tapar o buraco, duas pessoas olhando o
 *    mesmo mosaico veriam câmeras diferentes no mesmo quadrado — e ao combinar
 *    "olha o terceiro quadro" estariam falando de câmeras distintas.
 *
 * 3. RECEBIDO É SÓ DE LEITURA. Quem recebe usa; quem criou edita. Senão o
 *    operador muda o mosaico da portaria e ninguém sabe quem mexeu.
 *
 * Puro: sem banco, sem relógio, sem tela.
 */

/** Teto por entrega. Passar disto é engano de tela, não intenção. */
export const MAX_DESTINATARIOS = 200;

export type Destinatarios = {
  /** Pessoas, uma a uma. */
  usuarios: string[];
  /** Grupos de câmeras — todo mundo com permissão no grupo recebe. */
  grupos: string[];
};

export type Origem = 'meu' | 'recebido';

/**
 * Limpa a lista que veio da tela: tira espaço, vazio e repetido.
 *
 * Repetido importa mais do que parece: a tela de transferência deixa clicar
 * duas vezes na mesma pessoa, e sem esta limpeza o banco recusaria a gravação
 * inteira por causa da chave única — o usuário veria "erro" sem saber por quê.
 */
export function normalizarDestinatarios(bruto: unknown): Destinatarios {
  const fonte = (bruto ?? {}) as Partial<Destinatarios>;
  const limpar = (lista: unknown): string[] => {
    const itens = Array.isArray(lista) ? lista : [];
    const vistos = new Set<string>();
    for (const item of itens) {
      const id = String(item ?? '').trim();
      if (id) vistos.add(id);
    }
    return [...vistos].slice(0, MAX_DESTINATARIOS);
  };
  return { usuarios: limpar(fonte.usuarios), grupos: limpar(fonte.grupos) };
}

/**
 * Quem pode mexer.
 *
 * O dono sempre. O administrador também — precisa poder consertar o mosaico de
 * um funcionário que saiu da empresa, senão o mosaico fica órfão e imexível.
 */
export function podeEditar(params: {
  donoId: string;
  usuarioId: string;
  ehAdmin: boolean;
}): boolean {
  return params.ehAdmin || params.donoId === params.usuarioId;
}

export function origemDe(params: { donoId: string; usuarioId: string }): Origem {
  return params.donoId === params.usuarioId ? 'meu' : 'recebido';
}

/**
 * A REGRA 1 em código: esconde do mosaico as câmeras que esta pessoa não pode
 * ver, sem mover as outras de lugar.
 *
 * `posicoes` é a lista salva do mosaico, onde a string vazia já significa
 * "quadro vazio". Devolve uma lista do MESMO tamanho.
 */
export function filtrarPosicoes(posicoes: unknown, idsVisiveis: Set<string>): string[] {
  const lista = Array.isArray(posicoes) ? posicoes : [];
  return lista.map((valor) => {
    const id = String(valor ?? '').trim();
    return id && idsVisiveis.has(id) ? id : '';
  });
}

/** Quantos quadros sobraram com imagem depois do filtro. */
export function quadrosVisiveis(posicoes: string[]): number {
  return posicoes.filter((id) => id !== '').length;
}

/**
 * Um mosaico do qual não sobrou NENHUMA câmera não deve ser entregue.
 *
 * Não é preciosismo: uma ronda que pare num mosaico totalmente preto faz o
 * operador achar que o sistema travou. Melhor a parada não existir para ele.
 */
export function mosaicoTemAlgoAMostrar(posicoes: string[]): boolean {
  return quadrosVisiveis(posicoes) > 0;
}

/**
 * Quem recebeu esta entrega? Junta as pessoas nomeadas com as dos grupos, e
 * TIRA o próprio dono — ele já tem acesso por ser dono, e contá-lo duas vezes
 * inflaria o número "Usuários: N" que a lista de administração mostra.
 */
export function pessoasAlcancadas(params: {
  donoId: string;
  usuariosDiretos: string[];
  usuariosPorGrupo: string[];
}): string[] {
  const todos = new Set<string>([...params.usuariosDiretos, ...params.usuariosPorGrupo]);
  todos.delete(params.donoId);
  return [...todos];
}
