/**
 * Ver a senha da câmera na tela de edição.
 *
 * Pedido do dono em 14/08/2026: "quando clico em editar câmera, aparece apenas
 * o usuário da câmera mas deveria aparecer também a senha ... porque se eu
 * quiser ver a senha da câmera eu deveria ver!". Até então o campo só
 * SOBRESCREVIA — dizia "Manter atual" e nunca mostrava nada. Quem esquecia a
 * senha de um equipamento precisava resetá-lo de fábrica.
 *
 * Este módulo é a lógica da revelação, separada da tela porque três casos aqui
 * são fáceis de errar e todos terminam do mesmo jeito ruim: um campo VAZIO. E
 * campo vazio, numa tela de senha, o operador lê como "esta câmera não tem
 * senha" — e conclui que o equipamento está aberto.
 *
 *   · câmera cadastrada SEM senha    → tem de dizer que não há senha;
 *   · senha que não abre             → tem de dizer que não conseguiu ler;
 *   · o dono só espiou e não mexeu   → não pode virar uma alteração salva.
 */

export type RespostaDeCredencial = {
  username?: string;
  password?: string | null;
  ilegivel?: boolean;
};

export type CredencialNaTela = {
  /** O que vai dentro do campo. Vazio quando não há senha para mostrar. */
  valor: string;
  /** Pode alternar para texto visível? Só quando há algo de fato. */
  revelavel: boolean;
  /** Explicação quando não há senha para mostrar. Null quando há. */
  aviso: string | null;
};

/**
 * Traduz a resposta do servidor no que a tela mostra.
 *
 * O campo só recebe a senha quando ela existe e foi lida. Nos outros dois casos
 * ele fica vazio COM um aviso ao lado, que é o que separa "não há senha" de
 * "não consegui ler" — duas situações com providências opostas.
 */
export function descreverCredencial(resposta: RespostaDeCredencial | null | undefined): CredencialNaTela {
  if (!resposta) {
    return { valor: '', revelavel: false, aviso: 'Não consegui buscar a senha agora.' };
  }
  if (resposta.ilegivel) {
    return {
      valor: '',
      revelavel: false,
      aviso: 'A senha guardada não pôde ser lida (foi salva com outra chave). Digite a senha atual da câmera para regravá-la.',
    };
  }
  const senha = resposta.password;
  if (senha === null || senha === undefined || senha === '') {
    return { valor: '', revelavel: false, aviso: 'Esta câmera está cadastrada sem senha.' };
  }
  return { valor: senha, revelavel: true, aviso: null };
}

/**
 * A senha deve ir junto no salvamento?
 *
 * Não, quando o campo tem exatamente o que foi revelado — o dono abriu o olho
 * para conferir e fechou a tela. Mandar assim mesmo funcionaria (a senha é a
 * mesma), mas gera evento de alteração para quem não alterou nada, e é
 * justamente o histórico da câmera que alguém vai ler para descobrir quando a
 * credencial mudou.
 *
 * Sim, quando o campo foi digitado. Campo VAZIO continua significando "manter
 * atual", como sempre significou nesta tela.
 */
export function deveEnviarSenha(campo: string, reveladaOriginal: string | null): boolean {
  if (!campo.trim()) return false;
  if (reveladaOriginal !== null && campo === reveladaOriginal) return false;
  return true;
}
