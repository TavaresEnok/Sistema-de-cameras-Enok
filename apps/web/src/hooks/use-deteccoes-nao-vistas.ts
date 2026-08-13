import { useEffect, useState } from 'react';
import axios from 'axios';
import { getApiBaseUrl } from '../lib/api-base';
import { useAuthStore } from '../store/authStore';

// Contador de detecções ainda não vistas, para o menu lateral.
//
// O endpoint `/review/unseen-count` existe desde que a fila foi construída e
// NUNCA foi consumido por ninguém — a interface não tinha onde mostrar. Com a
// fila virando a abertura da Inteligência, o número passa a ter função: dizer
// "tem coisa nova ali dentro" sem obrigar a abrir para descobrir.
//
// O backend já recorta por janela de dias e por câmeras acessíveis ao usuário,
// então aqui é só buscar e espaçar.

const API_URL = getApiBaseUrl();

/** 60 s. O número muda com detecção nova, não com clique — não precisa ser
 *  mais rápido que isso, e a fila é a fonte de verdade quando aberta. */
const INTERVALO_MS = 60_000;

export function useDeteccoesNaoVistas(ativo: boolean): number {
  const accessToken = useAuthStore((state) => state.accessToken);
  const [quantidade, setQuantidade] = useState(0);

  useEffect(() => {
    if (!ativo || !accessToken) {
      setQuantidade(0);
      return;
    }
    let cancelado = false;

    const buscar = async () => {
      try {
        const { data } = await axios.get<{ count?: number }>(`${API_URL}/review/unseen-count`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 10_000,
        });
        if (!cancelado) setQuantidade(Number(data?.count ?? 0));
      } catch {
        // Falhar aqui NÃO pode zerar o número que já está na tela: um soluço de
        // rede faria o badge piscar para zero e o operador concluiria que já viu
        // tudo. Sem notícia, mantém a última notícia boa.
      }
    };

    void buscar();
    const timer = window.setInterval(() => void buscar(), INTERVALO_MS);
    return () => {
      cancelado = true;
      window.clearInterval(timer);
    };
  }, [ativo, accessToken]);

  return quantidade;
}

/** 0 → null (some), 1..99 → "12", acima → "99+". */
export function formatarContador(quantidade: number): string | null {
  if (!Number.isFinite(quantidade) || quantidade <= 0) return null;
  return quantidade > 99 ? '99+' : String(Math.floor(quantidade));
}
