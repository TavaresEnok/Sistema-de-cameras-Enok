-- ID OPERACIONAL DA CÂMERA
--
-- O UUID continua sendo a chave primária e a única chave aceita nas rotas. O
-- número sequencial é uma chave alternativa, curta e imutável, própria para a
-- tela, pesquisa, suporte e relatórios.
CREATE SEQUENCE "Camera_publicId_seq" START 100001;

ALTER TABLE "Camera"
  ADD COLUMN "publicId" INTEGER NOT NULL DEFAULT nextval('"Camera_publicId_seq"');

ALTER SEQUENCE "Camera_publicId_seq" OWNED BY "Camera"."publicId";

CREATE UNIQUE INDEX "Camera_publicId_key" ON "Camera"("publicId");
