import { PainelDeDeteccoes } from '../components/PainelDeDeteccoes';

/**
 * Rota /review — o destino do LINK DIRETO da notificação do aplicativo.
 *
 * O conteúdo mora em `components/PainelDeDeteccoes`, que também é a aba
 * "Detecções" da Inteligência. Esta rota continua existindo por um motivo
 * concreto e não por compatibilidade genérica: o push com deep link do app
 * aponta para cá, e trocá-la derrubaria a notificação de alarme de quem já tem
 * o aplicativo instalado.
 *
 * Fora do menu lateral desde 12/08/2026, por decisão do dono. Quem chega aqui
 * chega por link.
 */
export default function ReviewPage() {
  return <PainelDeDeteccoes />;
}
