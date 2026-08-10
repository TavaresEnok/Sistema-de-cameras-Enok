"""A confirmação está REALMENTE no caminho do evento?

Os testes de `test_confirmacao_de_objeto.py` provam a regra. Estes provam a
AMARRAÇÃO — o tipo de coisa que passa despercebida porque o código "parece
certo": o confirmador instanciado e nunca chamado, ou chamado no lugar errado
(filtrando a caixa da tela em vez do evento, ou barrando movimento).

Foi exatamente assim que o tripwire quase entrou solto: instanciado, importado,
e alimentado no ramo SEM rastreamento — nenhum erro, nenhum log, e perímetro
que nunca dispararia.

Rodam sem cv2 lendo o FONTE, de propósito: importar o módulo exigiria a stack
de ML inteira, e o que se verifica aqui é estrutural.
"""
import ast
import pathlib
import unittest

FONTE = pathlib.Path(__file__).resolve().parents[1] / "stream_processor.py"


class ConfirmacaoIntegracaoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.texto = FONTE.read_text(encoding="utf-8")
        cls.arvore = ast.parse(cls.texto)

    def test_tudo_que_a_confirmacao_usa_esta_importado(self):
        importados = set()
        for no in ast.walk(self.arvore):
            if isinstance(no, ast.ImportFrom):
                importados.update(a.asname or a.name for a in no.names)
            elif isinstance(no, ast.Import):
                importados.update((a.asname or a.name).split(".")[0] for a in no.names)
        for nome in ("ConfirmadorDeObjeto", "PoliticaDeConfirmacao"):
            self.assertIn(nome, importados, f"{nome} usado sem import")

    def test_e_instanciado_com_a_politica_do_perfil(self):
        """Valores cravados no código não seriam ajustáveis por instalação."""
        self.assertIn("ConfirmadorDeObjeto(PoliticaDeConfirmacao(", self.texto)
        for chave in ("confirm_min_frames", "confirm_median_threshold", "confirm_forget_after_misses"):
            self.assertIn(chave, self.texto, f"a política não lê {chave} do perfil")

    def test_filtra_o_EVENTO_e_nao_a_caixa_da_tela(self):
        """A distinção que dá valor ao recurso.

        Ver muito é bom: a caixa ao vivo continua saindo de `detections`. O que
        precisa de evidência é ACORDAR ALGUÉM. Se a confirmação fosse aplicada
        antes do overlay, o operador deixaria de ver o que a IA está enxergando.
        """
        i_overlay = self.texto.index("_store_live_detections")
        i_confirma = self.texto.index("self.confirmador.avaliar(")
        self.assertLess(i_overlay, i_confirma,
                        "a confirmação está antes do overlay — cortaria a caixa da tela")

        i_emit = self.texto.index("if detections and self.emit_events:")
        self.assertLess(i_emit, i_confirma, "a confirmação não está no portão de evento")

    def test_movimento_e_travessia_NAO_passam_pela_confirmacao(self):
        """Cada um já tem a sua evidência.

        Movimento não é objeto — não tem identidade nem confiança para mediana.
        Travessia de linha exige trajeto ENTRE quadros, que é evidência do mesmo
        tipo; exigir de novo atrasaria o alarme que mais importa.
        """
        i = self.texto.index("self.confirmador.avaliar(")
        bloco = self.texto[max(0, i - 900):i + 300]
        self.assertIn('== "AI_DETECTED"', bloco, "não separa o que deve ser confirmado")
        self.assertIn('!= "AI_DETECTED"', bloco, "os demais tipos precisam seguir direto")

    def test_falha_da_confirmacao_nao_cega_a_camera(self):
        i = self.texto.index("self.confirmador.avaliar(")
        bloco = self.texto[max(0, i - 400):i + 700]
        self.assertIn("except Exception", bloco,
                      "sem proteção, um erro aqui mata a detecção da câmera toda")


if __name__ == "__main__":
    unittest.main()
