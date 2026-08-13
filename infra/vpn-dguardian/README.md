# VPN das câmeras do D-GUARDIAN (L2TP/IPsec até o MikroTik do cliente)

A VM 168.194.13.20 alcança as câmeras do cliente (`192.168.100.0/24`) por um
túnel L2TP sobre IPsec fechado contra o MikroTik da loja. **Tudo o que faz esse
túnel subir, se vigiar e se curar vive neste diretório** — até 13/08/2026 vivia
só no host, e uma reinstalação da VM teria apagado correções pagas com horas de
cliente fora do ar.

```
sudo ./instalar.sh        # instala/restaura tudo (segredos ficam de fora — ver abaixo)
sudo vpn-dguardian status # o estado, incluindo ping + RTSP das 3 câmeras
```

## O que tem aqui

| arquivo | vai para | papel |
|---|---|---|
| `vpn-dguardian` | `/usr/local/sbin/` | liga/desliga/diagnostica o túnel |
| `vpn-dguardian-watch` | `/usr/local/sbin/` | o vigia: prova serviço + cifra, e cura |
| `ppp/dguardian-rota` | `/etc/ppp/ip-up.d/` | o pppd põe a rota das câmeras em QUALQUER interface que suba |
| `systemd/*.service`, `*.timer` | `/etc/systemd/system/` | sobe no boot; vigia a cada 3 min |
| `sudoers-vpn-dguardian` | `/etc/sudoers.d/` | operador roda só o script, sem senha |
| `etc/ipsec.conf`, `etc/xl2tpd.conf` | `/etc/…` | config sem segredo (DPD, forceencaps, redial) |
| `etc/*.template` | `/etc/…` (se não existir) | config COM segredo, placeholders `__ASSIM__` |

**Segredos não vivem no git.** A senha L2TP e a PSK do IPsec estão no cofre e
nos arquivos vivos do host. O instalador nunca sobrescreve um segredo existente
e avisa o que ficou pendente.

## As cicatrizes que este diretório carrega

Cada regra estranha aqui embaixo custou uma queda real para ser aprendida.
Antes de "simplificar" qualquer uma, leia:

- **12/08 — o túnel ficou de pé SEM CIFRA.** `ipsec restart` derrubava o charon
  do systemd e subia um starter órfão que morria; 0 SAs ESP e o vídeo do
  cliente em claro na internet. Por isso: o script só usa
  `systemctl start strongswan-starter`, e o "up" instala regra de iptables
  fail-closed (L2TP só sai casando com política IPsec — o pior caso vira "sem
  imagem", nunca "imagem sem cifra").
- **12/08 — chave morta por 3 horas.** O MikroTik apaga a SA aos ~2min25s e não
  renova; nosso lado seguia usando chave defunta. Por isso o `dpdaction=restart`
  no `ipsec.conf`.
- **12/08 — `max redials = 0` derruba o xl2tpd inteiro.** É valor inválido.
  Ficou 5, e o vigia assume depois delas.
- **13/08 — 8 HORAS fora com tudo "verde".** O túnel voltou como `ppp1` (não
  `ppp0`); o gancho de rota era amarrado ao nome e saiu calado; o vigia pingava
  o PEER — que é a ponta do próprio túnel e responde sempre. Por isso: nada
  aqui referencia interface por nome (procura-se pelo IP do par, ou o pppd
  entrega em `$1`), e o vigia só dá verde se uma **câmera** responder. O peer
  serve apenas para escolher o remédio barato (repor rota, sem derrubar o
  túnel) antes do caro (refazer tudo).

## Vigilância

O timer roda o vigia a cada 3 min. Ele exige DUAS provas independentes:
alcance de câmera (ping) **e** cifra no kernel (`ip xfrm state` com SA ESP).
Qualquer uma falhando → conserta e registra em `journalctl -t vpn-dguardian`.
Silêncio no journal + câmeras fora = bug no vigia; foi assim uma vez.
