"""O ensaio mediu 88% das ativações como REPETIÇÃO do mesmo incidente.

14.338 ativações em 24h, e a conclusão do estudo (motion-bgs-lab, 19–24/08/2026)
foi que reduzir essa fragmentação rende mais que trocar de algoritmo — o MOG2
ficou em 4º entre 32 e é o mais barato dos líderes.

A causa: o desconto contava a partir do último EVENTO EMITIDO, então movimento
contínuo emitia um evento a cada 45 segundos, para sempre.
"""

import unittest

from detectors.agrupamento_de_evento import AgrupadorDeEventos

MOTION = "MOTION_DETECTED"


class TestAgrupadorDeEventos(unittest.TestCase):
    def test_o_caso_real_pessoa_circulando_cinco_minutos_e_UM_evento(self):
        """Antes virava sete eventos, um a cada 45 segundos."""
        a = AgrupadorDeEventos(silencio_segundos=45, teto_segundos=600)
        emitidos = 0
        # Movimento visto a cada 2 segundos durante 5 minutos.
        for t in range(0, 300, 2):
            emitir, _ = a.decidir(MOTION, t)
            if emitir:
                emitidos += 1
        self.assertEqual(emitidos, 1, "movimento contínuo deve gerar UM evento")

    def test_a_regra_antiga_geraria_sete(self):
        """Fixa o tamanho do problema, para ninguém 'simplificar' de volta."""
        # Regra antiga: conta a partir do último evento emitido.
        ultimo = -999.0
        emitidos = 0
        for t in range(0, 300, 2):
            if t - ultimo > 45:
                emitidos += 1
                ultimo = t
        self.assertGreaterEqual(emitidos, 6, "a regra antiga fragmentava mesmo")

    def test_cena_que_ficou_quieta_e_voltou_gera_evento_novo(self):
        a = AgrupadorDeEventos(silencio_segundos=45, teto_segundos=600)
        self.assertEqual(a.decidir(MOTION, 0)[1], "incidente-novo")
        self.assertEqual(a.decidir(MOTION, 10)[1], "continua")
        # 60s sem movimento: o incidente terminou.
        self.assertEqual(a.decidir(MOTION, 70)[1], "incidente-novo")

    def test_a_fronteira_do_silencio(self):
        a = AgrupadorDeEventos(silencio_segundos=45, teto_segundos=0)
        a.decidir(MOTION, 0)
        self.assertFalse(a.decidir(MOTION, 45)[0], "exatamente 45s ainda é o mesmo incidente")
        a2 = AgrupadorDeEventos(silencio_segundos=45, teto_segundos=0)
        a2.decidir(MOTION, 0)
        self.assertTrue(a2.decidir(MOTION, 45.1)[0], "passou de 45s: incidente novo")

    def test_incidente_MUITO_longo_emite_marco_para_nao_sumir_da_lista(self):
        """Galho balançando a tarde inteira não pode virar um evento só.

        Sem o teto, o operador olharia a lista, veria um evento de três horas
        atrás e concluiria que o sistema parou de funcionar.
        """
        a = AgrupadorDeEventos(silencio_segundos=45, teto_segundos=600)
        marcos = 0
        for t in range(0, 3600, 5):  # uma hora de movimento ininterrupto
            emitir, motivo = a.decidir(MOTION, t)
            if emitir and motivo == "marco-de-incidente":
                marcos += 1
        # Uma hora com teto de 10 min: por volta de 5 marcos, não 80 eventos.
        self.assertGreaterEqual(marcos, 4)
        self.assertLessEqual(marcos, 7)

    def test_teto_desligado_nunca_emite_marco(self):
        a = AgrupadorDeEventos(silencio_segundos=45, teto_segundos=0)
        a.decidir(MOTION, 0)
        for t in range(2, 5000, 2):
            emitir, _ = a.decidir(MOTION, t)
            self.assertFalse(emitir)

    def test_tipos_de_evento_sao_independentes(self):
        """Movimento e objeto têm incidentes próprios; um não fecha o outro."""
        a = AgrupadorDeEventos(silencio_segundos=45, teto_segundos=600)
        self.assertTrue(a.decidir(MOTION, 0)[0])
        self.assertTrue(a.decidir("PERSON_DETECTED", 1)[0])
        self.assertFalse(a.decidir(MOTION, 2)[0])

    def test_duracao_do_incidente(self):
        a = AgrupadorDeEventos(silencio_segundos=45, teto_segundos=600)
        a.decidir(MOTION, 100)
        a.decidir(MOTION, 130)
        self.assertAlmostEqual(a.duracao_do_incidente(MOTION, 130), 30.0)
        self.assertEqual(a.duracao_do_incidente("NAO_EXISTE", 130), 0.0)

    def test_esquecer_reabre_o_proximo_como_incidente_novo(self):
        """Câmera que reconecta pode ter cena completamente diferente."""
        a = AgrupadorDeEventos(silencio_segundos=45, teto_segundos=600)
        a.decidir(MOTION, 0)
        self.assertFalse(a.decidir(MOTION, 5)[0])
        a.esquecer()
        self.assertTrue(a.decidir(MOTION, 6)[0])


if __name__ == "__main__":
    unittest.main()
