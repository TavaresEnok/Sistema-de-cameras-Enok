"""O MODELO DE OBJETO ESTÁ MESMO INSTALADO NESTA MÁQUINA?

Medido em 18/09/2026, em produção: as duas instalações de cliente (Vibe e
IBTelecom) tinham `/app/models` **vazia**. Detecção de objeto não funcionava em
nenhuma das duas — e nada dizia isso em lugar nenhum. A Vibe ainda tinha 34 de
34 câmeras marcadas com IA no cadastro, o que faz o painel prometer uma coisa
que a máquina não consegue entregar.

A pasta é um volume montado do host (`infra/ai-models`), não vem embutida na
imagem: instalar o sistema NÃO instala os modelos. Por isso a checagem tem de
existir em tempo de execução, e não ser uma suposição do Dockerfile.

Duas consequências de a pasta estar vazia, e as duas são silenciosas:
  · modo `general` (objeto) simplesmente não carrega — erro só no log;
  · o filtro que descarta o ruído noturno das câmeras ONVIF pergunta "tem
    objeto aqui?" e recebe "não sei", o que por segurança GRAVA assim mesmo.

Esta leitura é de propósito barata e sem efeito colateral: olha nomes de
arquivo, não carrega modelo nenhum. Ela roda no /health, que é chamado o tempo
todo — carregar modelo aqui seria trocar um problema por outro.
"""

from __future__ import annotations

import os

DIRETORIO_PADRAO = "/app/models"

# O que conta como modelo de objeto utilizável: uma pasta de export OpenVINO com
# pelo menos um .xml dentro, ou um .onnx (caminho da GPU NVIDIA).
SUFIXO_OPENVINO = "_openvino_model"


def _tem_xml(caminho: str) -> bool:
    try:
        return any(nome.endswith(".xml") for nome in os.listdir(caminho))
    except OSError:
        return False


def inventariar_modelos_de_objeto(diretorio: str = DIRETORIO_PADRAO) -> list[str]:
    """Nomes dos modelos de objeto realmente instalados, em ordem estável.

    Nunca levanta exceção: pasta ausente, sem permissão ou volume não montado
    devolvem lista vazia — que é exatamente a informação que interessa.
    """
    try:
        entradas = sorted(os.listdir(diretorio))
    except OSError:
        return []

    encontrados: list[str] = []
    for nome in entradas:
        completo = os.path.join(diretorio, nome)
        if nome.endswith(".onnx") and os.path.isfile(completo):
            encontrados.append(nome)
        elif SUFIXO_OPENVINO in nome and os.path.isdir(completo) and _tem_xml(completo):
            encontrados.append(nome)
    return encontrados


def ha_modelo_de_objeto(diretorio: str = DIRETORIO_PADRAO) -> bool:
    return bool(inventariar_modelos_de_objeto(diretorio))


def estado_dos_modelos(diretorio: str = DIRETORIO_PADRAO) -> dict:
    """Bloco pronto para o /health — é isto que o api lê para avisar na tela."""
    instalados = inventariar_modelos_de_objeto(diretorio)
    return {
        "directory": diretorio,
        "object_model_installed": bool(instalados),
        "installed": instalados,
    }
