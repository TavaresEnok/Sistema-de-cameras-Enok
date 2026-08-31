# Gateway AjustCam

A Gateway possui IP privado `10.10.0.10`. O único IPv4 público permanece no
Proxmox/firewall e faz DNAT para os serviços da Gateway.

Rotas administrativas:

- Central por hostname: `central.ajustcam.ajustconsulting.com.br` para `10.10.0.11:8080`;
- rota legada `/central/`: também deve apontar para `10.10.0.11:8080`;
- `10.10.0.20` pertence à instalação IBtelecom e nunca à Central.

O arquivo `nginx/conf.d/central.conf` deve ser instalado em
`/opt/ajustcam-gateway/nginx/conf.d/central.conf`. Antes da recarga, sempre
execute `nginx -t` dentro do container da Gateway.

O `gateway.conf` rejeita domínios desconhecidos com conexão fechada, em vez de
tentar resolver um falso backend. Cada novo tenant precisa de um `server_name`
explícito em `nginx/conf.d`; não use proxy dinâmico baseado apenas no cabeçalho
`Host`. A rota legada `https://ajustcam.ajustconsulting.com.br/central/`
permanece disponível para instalações anteriores.

O Coturn deve escutar em `3478` e `5349`, com relay UDP limitado a
`49152-49252`. A chave TLS deve ser legível apenas pelo proprietário e pelo
grupo do processo Coturn (`nogroup`, GID 65534 no container atual).
`coturn/turnserver.conf` contém segredo e é ignorado pelo Git; crie-o a partir
do `.example`, use segredo aleatório e mantenha o arquivo em modo `0640`.

As imagens da borda estão fixadas por digest. A troca de versão deve ser uma
alteração deliberada, seguida de teste de Nginx, alocação TURN e publicação
RTMP; nunca substitua os digests por tags móveis em produção.

O `docker-compose.yml` fixa um limite de 65.536 arquivos para o Nginx. Sem
isso, `worker_connections 2048` era apenas aparente: o processo parava no
limite padrão de 1.024 descritores.

O SRS público não decide o tenant por NAT. Enquanto houver somente a
IBtelecom, ele pode encaminhar estaticamente para `10.10.0.20:1935`. Antes de
adicionar o segundo tenant RTMP, esse encaminhamento deve ser substituído pelo
roteador autenticado por stream key; nunca crie dois DNATs públicos para 1935.
O arquivo versionado dessa fase é `srs/srs.conf`; a autenticação final continua
no SRS/API da IBtelecom, portanto o Gateway não transforma chave inválida em
stream autorizado.
