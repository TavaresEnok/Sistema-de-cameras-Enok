"""O objeto precisa PROVAR que existe antes de virar alarme."""

import unittest

from detectors.confirmacao_de_objeto import ConfirmadorDeObjeto, PoliticaDeConfirmacao


class _Det:
    """Detecção mínima, com o que o confirmador olha."""

    def __init__(self, confidence, track_id=1):
        self.confidence = confidence
        self.extra = {"trackId": track_id} if track_id is not None else {}


class ConfirmacaoTests(unittest.TestCase):
    def setUp(self):
        self.politica = PoliticaDeConfirmacao(
            minimo_de_quadros=3, limiar_mediana=0.70, esquecer_apos_faltas=3, janela_de_confiancas=10
        )
        self.c = ConfirmadorDeObjeto(self.politica)

    def test_um_quadro_bom_NAO_vira_alarme(self):
        """O defeito original: um arbusto no vento acordava o cliente."""
        self.assertEqual(self.c.avaliar([_Det(0.95)]), [])

    def test_confirma_so_depois_da_evidencia_minima(self):
        self.assertEqual(self.c.avaliar([_Det(0.9)]), [])
        self.assertEqual(self.c.avaliar([_Det(0.9)]), [])
        self.assertEqual(len(self.c.avaliar([_Det(0.9)])), 1, "3º quadro consistente confirma")

    def test_confirma_UMA_vez_por_objeto(self):
        """Pessoa parada dez minutos é UM evento, não dois mil."""
        for _ in range(3):
            self.c.avaliar([_Det(0.9)])
        for _ in range(50):
            self.assertEqual(self.c.avaliar([_Det(0.9)]), [], "não pode reemitir")

    def test_piscada_de_baixa_confianca_NUNCA_confirma(self):
        """O caso real: sombra que oscila em torno do limiar por quadro."""
        for _ in range(40):
            self.assertEqual(self.c.avaliar([_Det(0.35)]), [])

    def test_mediana_ignora_um_pico_espurio(self):
        """Por que mediana e não média.

        Duas confianças baixas e uma altíssima: a média (0,56) passaria de um
        limiar 0,5; a mediana (0,3) não. O pico é justamente o quadro em que o
        modelo se enganou com confiança — é o que se quer descartar.
        """
        c = ConfirmadorDeObjeto(PoliticaDeConfirmacao(minimo_de_quadros=3, limiar_mediana=0.5))
        c.avaliar([_Det(0.30)])
        c.avaliar([_Det(0.30)])
        self.assertEqual(c.avaliar([_Det(0.99)]), [], "média passaria; mediana não")

    def test_objeto_esquecido_apos_sumir_recomeca_do_zero(self):
        self.c.avaliar([_Det(0.9)])
        self.c.avaliar([_Det(0.9)])
        for _ in range(5):  # some por mais quadros que o TTL
            self.c.avaliar([])
        # A faixa foi esquecida: precisa provar tudo de novo.
        self.assertEqual(self.c.avaliar([_Det(0.9)]), [])
        self.assertEqual(self.c.avaliar([_Det(0.9)]), [])
        self.assertEqual(len(self.c.avaliar([_Det(0.9)])), 1)

    def test_sumico_curto_NAO_descarta_a_faixa(self):
        """Alguém passa atrás de um poste e volta — é a mesma pessoa."""
        self.c.avaliar([_Det(0.9)])
        self.c.avaliar([])          # 1 falta, dentro do TTL
        self.c.avaliar([_Det(0.9)])
        self.assertEqual(len(self.c.avaliar([_Det(0.9)])), 1, "3 quadros vistos, faixa preservada")

    def test_objetos_diferentes_sao_independentes(self):
        for _ in range(3):
            self.c.avaliar([_Det(0.9, track_id=1), _Det(0.35, track_id=2)])
        # Só o 1 tem evidência; o 2 continua aguardando.
        self.assertEqual(self.c.estado()["confirmadas"], 1)
        self.assertEqual(self.c.estado()["aguardando_evidencia"], 1)

    def test_sem_identidade_entre_quadros_passa_direto(self):
        """Sem trackId não há como exigir persistência.

        Deixa passar para não piorar o caminho que não tem rastreamento — mas
        o caminho de objeto TEM, e é lá que a confirmação atua.
        """
        self.assertEqual(len(self.c.avaliar([_Det(0.9, track_id=None)])), 1)

    def test_memoria_tem_teto(self):
        c = ConfirmadorDeObjeto(PoliticaDeConfirmacao(maximo_de_faixas=10))
        for i in range(200):
            c.avaliar([_Det(0.9, track_id=i)])
        self.assertLessEqual(c.estado()["faixas"], 10, "serviço roda por semanas; não pode vazar")

    def test_janela_deslizante_responde_a_cena_que_mudou(self):
        """Confiança que despenca não deve confirmar por causa do passado."""
        c = ConfirmadorDeObjeto(PoliticaDeConfirmacao(
            minimo_de_quadros=3, limiar_mediana=0.7, janela_de_confiancas=4))
        for _ in range(4):
            c.avaliar([_Det(0.95)])   # confirma no 3º
        c2 = ConfirmadorDeObjeto(PoliticaDeConfirmacao(
            minimo_de_quadros=10, limiar_mediana=0.7, janela_de_confiancas=4))
        for _ in range(6):
            c2.avaliar([_Det(0.95)])  # janela cheia de bom, mas ainda sem quadros
        for _ in range(6):
            resultado = c2.avaliar([_Det(0.20)])
        self.assertEqual(resultado, [], "a janela deslizou para as ruins; não confirma")


if __name__ == "__main__":
    unittest.main()
