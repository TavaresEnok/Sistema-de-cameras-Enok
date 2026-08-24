import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { getApiBaseUrl } from '../lib/api-base';
import { useAuthStore } from '../store/authStore';

/**
 * AVISO DE LICENÇA — só no painel web.
 *
 * "tem que emitir o aviso apenas no sistema web e não para o app!" (dono,
 * 24/08/2026)
 *
 * O aviso é assunto de quem administra a instalação. Quem abre o aplicativo
 * para ver a câmera de casa não tem o que fazer com "faltam 3 dias para
 * bloquear" — e o pedido de manter isso fora do app é explícito.
 *
 * Não é fechável de propósito enquanto o motivo existir: aviso que some com um
 * clique é aviso que ninguém lê no dia em que importa. Ele desaparece sozinho
 * quando a instalação volta a falar com a Central.
 */

type Estado = {
  avisar: boolean;
  licenseStatus: string;
  mensagem: string | null;
  diasAteOProximoCorte?: number | null;
};

const INTERVALO_MS = 5 * 60 * 1000;

export function AvisoDeLicenca() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [estado, setEstado] = useState<Estado | null>(null);

  useEffect(() => {
    if (!accessToken) { setEstado(null); return; }
    let vivo = true;
    const buscar = async () => {
      try {
        const r = await fetch(`${getApiBaseUrl()}/license/status`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!r.ok) return;
        const d = (await r.json()) as Estado;
        if (vivo) setEstado(d);
      } catch {
        // Falha ao consultar NÃO vira aviso: o painel não pode alarmar o
        // operador por causa de uma requisição perdida.
      }
    };
    void buscar();
    const t = setInterval(() => void buscar(), INTERVALO_MS);
    return () => { vivo = false; clearInterval(t); };
  }, [accessToken]);

  if (!estado?.avisar || !estado.mensagem) return null;

  const suspenso = estado.licenseStatus === 'SUSPENDED';
  const restrito = estado.licenseStatus === 'RESTRICTED';
  const grave = suspenso || restrito;

  return (
    <div
      role="alert"
      className={`flex items-start gap-2.5 border-b px-4 py-2.5 text-xs ${
        grave
          ? 'border-[hsl(var(--destructive)_/_0.35)] bg-[hsl(var(--destructive)_/_0.10)] text-[hsl(var(--destructive))]'
          : 'border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-400'
      }`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold">
          {suspenso ? 'Sistema suspenso' : restrito ? 'Sistema com restrições' : 'Atenção'}
        </p>
        <p className="mt-0.5 leading-snug opacity-90">{estado.mensagem}</p>
      </div>
    </div>
  );
}
