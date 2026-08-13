"""Disparo PERIODICO na mesma regiao e' maquina, nao evento de seguranca.

Nao depende de cv2 — logica pura, roda em qualquer lugar.

Cobre a lacuna que eu mesmo deixei em chronic_activity.py: aquele mapa so pega o
que fica ativo boa parte do tempo. Uma luz que pisca DEVAGAR (a cada 8-10 s) tem
fracao de atividade baixa, passa incolume, e ainda grava a noite inteira.

O risco de errar aqui e' assimetrico e os testes refletem isso: gravar demais
custa disco; suprimir uma pessoa custa a evidencia. Por isso os testes de
"NAO suprimir" sao mais numerosos que os de suprimir.
"""

import unittest

from detectors.periodicity import DetectorDePeriodicidade


class TestPeriodicidade(unittest.TestCase):
    W = H = 640

    def _caixa_em(self, gx, gy, celulas=8):
        """Caixa pequena no centro da celula (gx, gy) de uma grade celulas x celulas."""
        passo = self.W / celulas
        cx = passo * (gx + 0.5)
        cy = passo * (gy + 0.5)
        return (int(cx - 8), int(cy - 8), int(cx + 8), int(cy + 8))

    def test_luz_piscando_devagar_e_pega(self):
        # A cada 9 s, sempre no mesmo ponto: o caso que o mapa cronico NAO pega.
        d = DetectorDePeriodicidade()
        caixa = self._caixa_em(3, 3)
        veredito = False
        for i in range(10):
            veredito = d.e_periodico(caixa, self.W, self.H, agora=i * 9.0)
        self.assertTrue(veredito, "luz de piscada lenta escapou — grava a noite toda")

    def test_pessoa_ANDANDO_nunca_e_periodica(self):
        # Atravessa a cena: cada disparo cai numa celula diferente, nenhuma
        # acumula historico suficiente para ser julgada.
        d = DetectorDePeriodicidade()
        for i in range(12):
            gx = min(7, i // 2)
            self.assertFalse(
                d.e_periodico(self._caixa_em(gx, 4), self.W, self.H, agora=i * 2.0),
                "movimento que atravessa foi marcado como periodico",
            )

    def test_pessoa_PARADA_no_mesmo_lugar_mas_irregular_nao_e_periodica(self):
        # Mesma celula, mas intervalos humanos (2, 7, 3, 15, 4, 9...).
        d = DetectorDePeriodicidade()
        caixa = self._caixa_em(2, 5)
        t = 0.0
        veredito = False
        for gap in (2.0, 7.0, 3.0, 15.0, 4.0, 9.0, 5.0, 11.0):
            t += gap
            veredito = d.e_periodico(caixa, self.W, self.H, agora=t)
        self.assertFalse(veredito, "ritmo humano foi confundido com maquina")

    def test_nao_julga_com_poucas_amostras(self):
        # Tres disparos regulares nao bastam: qualquer coisa parece regular.
        d = DetectorDePeriodicidade()
        caixa = self._caixa_em(1, 1)
        for i in range(3):
            self.assertFalse(d.e_periodico(caixa, self.W, self.H, agora=i * 5.0))

    def test_luz_que_PARA_e_esquecida(self):
        # Aprende o ritmo; a luz para por muito tempo; ao voltar, o historico
        # expirou e ela precisa ser reaprendida do zero.
        d = DetectorDePeriodicidade(expiracao_s=30.0)
        caixa = self._caixa_em(6, 6)
        for i in range(10):
            d.e_periodico(caixa, self.W, self.H, agora=i * 5.0)
        # Silencio longo, e entao UM disparo: nao pode ser suprimido de cara.
        self.assertFalse(
            d.e_periodico(caixa, self.W, self.H, agora=1000.0),
            "regiao ficou marcada para sempre — objeto que aparecer ali some",
        )

    def test_regioes_diferentes_nao_se_contaminam(self):
        # Uma luz periodica num canto nao pode suprimir a celula vizinha.
        d = DetectorDePeriodicidade()
        luz = self._caixa_em(0, 0)
        for i in range(10):
            d.e_periodico(luz, self.W, self.H, agora=i * 6.0)
        self.assertFalse(
            d.e_periodico(self._caixa_em(4, 4), self.W, self.H, agora=100.0),
            "a supressao vazou para outra regiao",
        )

    def test_ritmo_levemente_irregular_ainda_passa(self):
        # Ventilador/letreiro com jitter pequeno E' mecanico (deve pegar);
        # variacao grande NAO (deve passar). Testa a fronteira do CV.
        regular = DetectorDePeriodicidade(cv_maximo=0.15)
        caixa = self._caixa_em(5, 2)
        t = 0.0
        v = False
        for gap in (10.0, 10.2, 9.9, 10.1, 10.0, 9.8, 10.1, 10.0):
            t += gap
            v = regular.e_periodico(caixa, self.W, self.H, agora=t)
        self.assertTrue(v, "maquina com jitter pequeno deveria ser pega")

        irregular = DetectorDePeriodicidade(cv_maximo=0.15)
        caixa2 = self._caixa_em(5, 3)
        t = 0.0
        v2 = False
        for gap in (10.0, 6.0, 14.0, 8.0, 16.0, 7.0, 13.0, 9.0):
            t += gap
            v2 = irregular.e_periodico(caixa2, self.W, self.H, agora=t)
        self.assertFalse(v2, "variacao grande foi tratada como maquina")

    def test_esquecer_zera_tudo(self):
        d = DetectorDePeriodicidade()
        caixa = self._caixa_em(3, 3)
        for i in range(10):
            d.e_periodico(caixa, self.W, self.H, agora=i * 5.0)
        d.esquecer()
        self.assertFalse(d.e_periodico(caixa, self.W, self.H, agora=100.0))

    def test_caixa_fora_dos_limites_nao_estoura(self):
        # Coordenada maior que o quadro (arredondamento de escala) nao pode
        # derrubar o detector inteiro.
        d = DetectorDePeriodicidade()
        for caixa in ((-5, -5, 3, 3), (630, 630, 700, 700), (0, 0, 0, 0)):
            d.e_periodico(caixa, self.W, self.H, agora=1.0)


if __name__ == "__main__":
    unittest.main()
