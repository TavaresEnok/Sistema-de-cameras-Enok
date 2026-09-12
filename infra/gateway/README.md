# Gateway S2Cam

A Gateway possui IP privado `10.10.0.10`. O único IPv4 público permanece no
Proxmox/firewall e faz DNAT para os serviços da Gateway.

Rotas administrativas:

- Central por hostname: `central.s2cam.com.br` para `10.10.0.11:8080`;
- instalação principal: `principal.s2cam.com.br` para o HTTPS legado;
- tenants atuais: `ibtelecom.s2cam.com.br`, `cortex.s2cam.com.br` e
  `vibe.s2cam.com.br` para seus ingressos web;
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

O SRS público não decide o tenant por NAT. Ele usa o hostname enviado no tcUrl
e aceita somente vhosts declarados em `srs/srs.conf`; cada vhost encaminha para
o MediaMTX do tenant correspondente. App e stream key são preservados, e a
autenticação final continua na API do tenant. O vhost padrão para IBTelecom é
apenas compatibilidade temporária com equipamentos ainda configurados por IP.
Novos cadastros devem usar o hostname próprio da instalação.

Todo vhost usa `normal_timeout 30000` e `firstpkt_timeout 20000`. Não remova
esses limites: o padrão de 5 segundos do SRS derrubava câmeras saudáveis que
fazem pausas breves de envio. Ao adicionar ou mover um tenant, atualize juntos
o vhost do SRS e o `server_name` do Nginx, valide a configuração e só então
recarregue a Gateway.
