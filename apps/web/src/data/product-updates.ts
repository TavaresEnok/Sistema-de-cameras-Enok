export type ProductUpdate = {
  version: string;
  date: string;
  title: string;
  summary: string;
  kind: 'Novo' | 'Melhoria' | 'Segurança';
  items: string[];
};

/**
 * Catálogo editorial da instalação. Só entram entregas disponíveis no produto;
 * ideias e itens ainda em desenvolvimento não aparecem como se estivessem prontos.
 */
export const PRODUCT_UPDATES: ProductUpdate[] = [
  {
    version: '2026.08.27', date: '2026-08-27', kind: 'Novo',
    title: 'Mapa operacional e câmera no contexto',
    summary: 'As câmeras agora podem ser posicionadas na planta real de cada unidade e andar.',
    items: ['Abertura da câmera ao vivo sobre o mapa', 'Envio de planta SVG e posicionamento visual', 'Acesso ao mapa respeitando as permissões de câmera'],
  },
  {
    version: '2026.08.26', date: '2026-08-26', kind: 'Melhoria',
    title: 'Câmeras e inteligência mais simples',
    summary: 'As telas técnicas foram reorganizadas para explicar o efeito de cada escolha.',
    items: ['ID operacional curto por câmera', 'Protocolo, consumo de armazenamento e retenção na listagem', 'Confiança da IA em porcentagem por câmera'],
  },
  {
    version: '2026.08.25', date: '2026-08-25', kind: 'Melhoria',
    title: 'Vídeo ao vivo mais estável',
    summary: 'A política de WebRTC, H.265 e fallback foi reforçada para evitar conversões desnecessárias.',
    items: ['Preferência pelo vídeo original quando o navegador é compatível', 'Fallback por câmera sem derrubar toda a grade', 'Recuperação de travamento baseada em progresso real do stream'],
  },
  {
    version: '2026.08.24', date: '2026-08-24', kind: 'Segurança',
    title: 'Licença, backup e recuperação',
    summary: 'O controle comercial e a proteção das configurações passaram a ter regras explícitas.',
    items: ['Teto contratado de câmeras aplicado no cadastro', 'Arquivo de cancelamento cifrado com validade', 'Exclusão automática de arquivos vencidos'],
  },
  {
    version: '2026.08.23', date: '2026-08-23', kind: 'Novo',
    title: 'RTMP push integrado',
    summary: 'Câmeras atrás de CGNAT podem enviar vídeo ao sistema sem acesso de entrada à rede delas.',
    items: ['Chave curta de publicação', 'Vinculação de caminhos fixos enviados pelo equipamento', 'Mesmas políticas de live, movimento, gravação e retenção do sistema'],
  },
];
