/**
 * ILUSTRAÇÃO do que o perímetro faz — mostrada quando não há câmera.
 *
 * "quando não tem câmeras cadastradas, não aparece imagem no local onde deveria
 *  aparecer" (dono, 24/08/2026)
 *
 * A tela de perímetro é inteira sobre a IMAGEM da câmera: desenha-se a linha de
 * travessia e as zonas por cima dela. Sem câmera cadastrada sobrava só um texto,
 * e quem abre a página pela primeira vez não faz ideia do que vai desenhar nem
 * de para que serve.
 *
 * É DESENHO, não foto: uma cena de câmera fictícia com a linha e a zona já
 * marcadas. Foto realista pareceria vídeo de verdade e faria alguém achar que o
 * sistema está gravando quando não há câmera nenhuma.
 *
 * SVG embutido de propósito: nada para baixar, funciona sem internet e as cores
 * vêm dos tokens do tema, então acompanha a marca do cliente e os dois modos.
 */
export function IlustracaoPerimetro({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 180"
      className={className}
      role="img"
      aria-label="Exemplo: linha de travessia e zona desenhadas sobre a imagem de uma câmera"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Fundo da cena */}
      <rect x="0" y="0" width="320" height="180" rx="8" fill="hsl(var(--muted))" />

      {/* Horizonte e chão, para dar profundidade sem virar figura literal */}
      <path d="M0 96 H320" stroke="hsl(var(--border))" strokeWidth="1" />
      <path d="M0 180 L96 96 H224 L320 180 Z" fill="hsl(var(--foreground) / 0.04)" />

      {/* Prédio ao fundo */}
      <rect x="30" y="52" width="62" height="44" rx="2" fill="hsl(var(--foreground) / 0.07)" />
      <rect x="40" y="62" width="12" height="12" fill="hsl(var(--foreground) / 0.10)" />
      <rect x="60" y="62" width="12" height="12" fill="hsl(var(--foreground) / 0.10)" />

      {/* Portão à direita */}
      <rect x="232" y="60" width="52" height="36" rx="2" fill="hsl(var(--foreground) / 0.07)" />
      <path d="M240 60 V96 M252 60 V96 M264 60 V96 M276 60 V96" stroke="hsl(var(--foreground) / 0.12)" strokeWidth="2" />

      {/* ZONA: a área vigiada */}
      <path
        d="M104 108 L214 108 L246 166 L74 166 Z"
        fill="hsl(var(--primary) / 0.13)"
        stroke="hsl(var(--primary) / 0.5)"
        strokeWidth="1.5"
      />
      <text x="160" y="152" textAnchor="middle" fontSize="9" fill="hsl(var(--primary))" opacity="0.85">zona</text>

      {/* LINHA DE TRAVESSIA: tracejada, atravessando a cena */}
      <path d="M60 104 L268 128" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeDasharray="7 5" strokeLinecap="round" />
      <circle cx="60" cy="104" r="4" fill="hsl(var(--primary))" />
      <circle cx="268" cy="128" r="4" fill="hsl(var(--primary))" />
      <text x="150" y="102" textAnchor="middle" fontSize="9" fill="hsl(var(--primary))" opacity="0.85">linha de travessia</text>

      {/* Pessoa atravessando: é o objeto que dispara o alarme */}
      <g transform="translate(150 96)">
        <circle cx="0" cy="0" r="5" fill="hsl(var(--foreground) / 0.55)" />
        <path d="M0 6 V22 M0 11 L-7 17 M0 11 L7 17 M0 22 L-6 33 M0 22 L6 33"
              stroke="hsl(var(--foreground) / 0.55)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      </g>
      {/* Seta do sentido da travessia */}
      <path d="M176 108 l14 2 -5 4" stroke="hsl(var(--primary))" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />

      {/* Deixa explícito que é exemplo — ninguém pode confundir com vídeo real */}
      <text x="310" y="18" textAnchor="end" fontSize="8" fill="hsl(var(--muted-foreground))" letterSpacing="1.2">
        EXEMPLO
      </text>
    </svg>
  );
}
