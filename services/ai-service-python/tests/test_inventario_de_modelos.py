"""A pasta de modelos vazia precisa ser VISÍVEL, não descoberta por acidente.

18/09/2026: Vibe e IBTelecom rodavam com `/app/models` vazia. Detecção de
objeto era impossível nas duas e o painel não dizia nada.
"""

import os
import tempfile
import unittest

from detectors.inventario_de_modelos import (
    estado_dos_modelos,
    ha_modelo_de_objeto,
    inventariar_modelos_de_objeto,
)


class TestInventarioDeModelos(unittest.TestCase):
    def test_o_caso_real_pasta_vazia_nao_tem_modelo(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(inventariar_modelos_de_objeto(d), [])
            self.assertFalse(ha_modelo_de_objeto(d))

    def test_pasta_inexistente_nao_quebra_o_health(self):
        # O /health é chamado o tempo todo; ele não pode cair por causa de um
        # volume que ninguém montou.
        self.assertEqual(inventariar_modelos_de_objeto("/nao/existe/mesmo"), [])
        self.assertFalse(ha_modelo_de_objeto("/nao/existe/mesmo"))

    def test_export_openvino_com_xml_conta_como_instalado(self):
        with tempfile.TemporaryDirectory() as d:
            pasta = os.path.join(d, "yolo26n_int8_640_openvino_model")
            os.makedirs(pasta)
            open(os.path.join(pasta, "yolo26n.xml"), "w").close()
            open(os.path.join(pasta, "yolo26n.bin"), "w").close()
            self.assertEqual(
                inventariar_modelos_de_objeto(d), ["yolo26n_int8_640_openvino_model"]
            )

    def test_pasta_de_export_PELA_METADE_nao_conta(self):
        # Export interrompido deixa a pasta criada e sem .xml. Dizer que o
        # modelo está lá seria pior que dizer que não está: o erro só
        # apareceria na hora de carregar.
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "yolo26n_int8_640_openvino_model"))
            self.assertEqual(inventariar_modelos_de_objeto(d), [])

    def test_onnx_conta_e_o_resto_e_ignorado(self):
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "yolo26n.onnx"), "w").close()
            open(os.path.join(d, "leiame.txt"), "w").close()
            os.makedirs(os.path.join(d, "buffalo_s"))  # pack de ROSTO, não de objeto
            self.assertEqual(inventariar_modelos_de_objeto(d), ["yolo26n.onnx"])

    def test_estado_para_o_health(self):
        with tempfile.TemporaryDirectory() as d:
            estado = estado_dos_modelos(d)
            self.assertFalse(estado["object_model_installed"])
            self.assertEqual(estado["installed"], [])
            self.assertEqual(estado["directory"], d)


if __name__ == "__main__":
    unittest.main()
