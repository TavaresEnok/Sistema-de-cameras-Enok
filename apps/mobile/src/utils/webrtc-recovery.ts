/** Duas novas tentativas após a inicial; nunca decide trocar o protocolo. */
export function webRtcRetryDelay(failures: number): number | null {
  return failures === 1 ? 1_000 : failures === 2 ? 3_000 : null;
}

/** Renovar credenciais não deve encerrar uma sessão de mídia saudável. */
export function webRtcSessionIdentity(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('token');
    return parsed.toString();
  } catch { return url; }
}
