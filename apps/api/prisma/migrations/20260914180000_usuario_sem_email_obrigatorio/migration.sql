-- Usuário é a identidade de acesso; e-mail vira somente canal opcional.
-- Contas existentes preservam exatamente o login atual: seu e-mail é copiado
-- para `username`, portanto nenhuma sessão/credencial é perdida na migração.
ALTER TABLE "User" ADD COLUMN "username" TEXT;
UPDATE "User" SET "username" = lower("email") WHERE "username" IS NULL;
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
