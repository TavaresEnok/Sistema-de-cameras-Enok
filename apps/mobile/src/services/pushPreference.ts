/**
 * "Quero receber alertas neste aparelho?"
 *
 * O envio por push (FCM) já funcionava e era ligado sozinho ao entrar, mas não
 * havia como desligar: o controle tinha sido escondido nos Ajustes com um aviso
 * de "voltará quando o push estiver ativo" — comentário que envelheceu. Quem
 * não quer ser acordado de madrugada precisava desinstalar o app.
 *
 * A preferência é DESTE aparelho (não da conta): o mesmo usuário pode querer
 * alerta no celular do plantão e silêncio no particular.
 *
 * Padrão LIGADO: alerta que não chega é pior que alerta demais, e o usuário
 * tem onde desligar em um toque.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const CHAVE = 's2cam.push.habilitado';

export async function lerPreferenciaDePush(): Promise<boolean> {
  try {
    const valor = await AsyncStorage.getItem(CHAVE);
    // Nunca respondido = ligado. Só 'false' desliga.
    return valor !== 'false';
  } catch {
    return true;
  }
}

export async function salvarPreferenciaDePush(habilitado: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(CHAVE, habilitado ? 'true' : 'false');
  } catch {
    // Preferência é conveniência: falhar ao gravar não pode quebrar a tela.
  }
}
