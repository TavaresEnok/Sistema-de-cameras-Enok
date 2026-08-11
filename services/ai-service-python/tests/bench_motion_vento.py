import sys; sys.path.insert(0,'/app')
import numpy as np, cv2
from detectors.motion import MotionDetector

H,W = 360,640
SEM = 20260811

def base(rng):
    b = np.full((H,W,3), 90, dtype=np.float32)
    yy,xx = np.mgrid[0:H,0:W]
    b += (18*np.sin(xx/9.0) + 12*np.cos(yy/7.0))[...,None]
    return b

def ruido(b, rng, s):
    return np.clip(b + rng.normal(0,s,b.shape),0,255).astype(np.uint8)

# Copa de árvore FIXA na cena: é sempre a mesma região que balança, com massa
# suficiente para formar componente coeso — o caso real que enche o disco.
COPA = (60, 120, 190, 130)  # x, y, largura, altura (no quadro de 640x360)

def vento(q, rng, forca):
    """Galho balançando: deslocamento coerente da MESMA copa, quadro a quadro."""
    if forca <= 0:
        return q
    x, y, w, h = COPA
    dx = int(rng.integers(-forca, forca + 1))
    dy = int(rng.integers(-forca // 2, forca // 2 + 1))
    recorte = q[y:y+h, x:x+w].astype(np.int16)
    # Textura de folhagem deslocada: muda muitos pixels de uma vez, como galho real.
    folha = (28 * np.sin((np.arange(w) + dx) / 3.0))[None, :] + \
            (22 * np.cos((np.arange(h) + dy) / 4.0))[:, None]
    q[y:y+h, x:x+w] = np.clip(recorte + folha[..., None], 0, 255).astype(np.uint8)
    return q

def rodar(piso_on, zonas=None, forca_vento=0, com_pessoa=False, quadros=90):
    rng = np.random.default_rng(SEM)
    d = MotionDetector(zones=zonas); d._noise_floor_enabled = piso_on; d.load()
    b = base(rng)
    for _ in range(70):
        d.infer(vento(ruido(b,rng,4), rng, forca_vento))
    disparos = 0; pegou_pessoa = False
    for i in range(quadros):
        q = vento(ruido(b,rng,4), rng, forca_vento)
        if com_pessoa and i >= quadros-8:
            x = 200 + (i-(quadros-8))*22
            reg = q[150:242, x:x+46].astype(np.int16) + 16
            q[150:242, x:x+46] = np.clip(reg,0,255).astype(np.uint8)
            if d.infer(q): pegou_pessoa = True; disparos += 1
            continue
        if d.infer(q): disparos += 1
    return disparos, pegou_pessoa

print("== PISO DE RUIDO ADAPTATIVO (dia de vento) ==")
print(f"{'cenario':34} {'sem piso':>10} {'com piso':>10}")
for nome, forca in [("cena calma", 0), ("vento moderado", 14), ("vento forte", 30)]:
    a,_ = rodar(False, forca_vento=forca)
    b_,_ = rodar(True,  forca_vento=forca)
    print(f"{nome+' (disparos/90)':34} {a:>10} {b_:>10}")

print()
print("== e a PESSOA continua sendo vista no vento? ==")
for nome, forca in [("vento moderado", 14), ("vento forte", 30)]:
    _,p1 = rodar(False, forca_vento=forca, com_pessoa=True)
    _,p2 = rodar(True,  forca_vento=forca, com_pessoa=True)
    print(f"  {nome:18} sem piso: {'detecta' if p1 else 'PERDEU'}   com piso: {'detecta' if p2 else 'PERDEU'}")

print()
print("== SENSIBILIDADE POR ZONA (arvore que balanca) ==")
arvore = {"kind":"exclude","sensitivity":"baixa",
          "points":[[0.05,0.05],[0.95,0.05],[0.95,0.95],[0.05,0.95]]}
# exclude cobrindo tudo zeraria a mascara; usa include grande + nivel baixo
z_baixa = [{"kind":"include","sensitivity":"baixa","points":[[0.02,0.02],[0.98,0.02],[0.98,0.98],[0.02,0.98]]}]
z_media = [{"kind":"include","sensitivity":"media","points":[[0.02,0.02],[0.98,0.02],[0.98,0.98],[0.02,0.98]]}]
for nome, z in [("zona sensib. MEDIA", z_media), ("zona sensib. BAIXA", z_baixa)]:
    dv,_ = rodar(False, zonas=z, forca_vento=22)
    _,pp = rodar(False, zonas=z, forca_vento=22, com_pessoa=True)
    print(f"  {nome:20} vento: {dv:>3} disparos/90   pessoa: {'detecta' if pp else 'PERDEU'}")
