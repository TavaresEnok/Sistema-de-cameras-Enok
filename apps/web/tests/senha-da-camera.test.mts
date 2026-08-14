import assert from 'node:assert/strict';
import test from 'node:test';
import { descreverCredencial, deveEnviarSenha } from '../src/lib/senha-da-camera.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Pedido do dono em 14/08/2026:
//
//   "quando clico em editar câmera, aparece apenas o usuário da câmera mas
//    deveria aparecer também a senha ... porque se eu quiser ver a senha da
//    câmera eu deveria ver!"
//
// O risco de todo caso torto aqui é o MESMO: campo vazio. E campo vazio numa
// tela de senha é lido como "câmera sem senha" — conclusão perigosa e errada.
// ─────────────────────────────────────────────────────────────────────────────

test('senha existente vai para o campo e pode ser exibida', () => {
  const r = descreverCredencial({ username: 'admin', password: '@Dguardian123' });
  assert.equal(r.valor, '@Dguardian123');
  assert.equal(r.revelavel, true);
  assert.equal(r.aviso, null);
});

test('câmera SEM senha diz isso — não fica só em branco', () => {
  const r = descreverCredencial({ username: 'admin', password: null });
  assert.equal(r.valor, '');
  assert.match(r.aviso!, /sem senha/i);
  assert.equal(r.revelavel, false, 'não há o que revelar');
});

test('senha ilegível NÃO se confunde com câmera sem senha', () => {
  // Credencial cifrada com chave antiga. As duas situações mostram campo vazio
  // e pedem providências opostas: uma é "está tudo certo", a outra é "regrave".
  const r = descreverCredencial({ username: 'admin', password: null, ilegivel: true });
  assert.equal(r.valor, '');
  assert.doesNotMatch(r.aviso!, /sem senha/i, 'diria que a câmera está aberta');
  assert.match(r.aviso!, /não pôde ser lida|nao pode ser lida/i);
  assert.match(r.aviso!, /Digite/i, 'não diz o que fazer');
});

test('senha em branco no cadastro conta como sem senha', () => {
  assert.match(descreverCredencial({ password: '' }).aviso!, /sem senha/i);
});

test('falha de rede não vira "câmera sem senha"', () => {
  for (const resposta of [null, undefined]) {
    const r = descreverCredencial(resposta);
    assert.doesNotMatch(r.aviso!, /sem senha/i);
    assert.match(r.aviso!, /buscar/i);
  }
});

test('espiar a senha e fechar NÃO conta como alteração', () => {
  // Senão o histórico da câmera passa a registrar troca de credencial toda vez
  // que alguém apenas confere — e é esse histórico que se lê depois para saber
  // quando a senha realmente mudou.
  assert.equal(deveEnviarSenha('@Dguardian123', '@Dguardian123'), false);
});

test('senha revelada e depois EDITADA é enviada', () => {
  assert.equal(deveEnviarSenha('@Dguardian124', '@Dguardian123'), true);
});

test('campo vazio continua significando "manter atual"', () => {
  // Comportamento antigo da tela, preservado: quem não digita nada não mexe na
  // senha. Enviar vazio APAGARIA a credencial e derrubaria a câmera.
  assert.equal(deveEnviarSenha('', null), false);
  assert.equal(deveEnviarSenha('   ', null), false);
  assert.equal(deveEnviarSenha('', 'senha-revelada'), false);
});

test('digitar sem ter revelado envia normalmente', () => {
  assert.equal(deveEnviarSenha('nova', null), true);
});

test('digitar exatamente a senha antiga sem ter revelado ainda envia', () => {
  // Sem revelação não há com o que comparar; regravar o mesmo valor é inofensivo
  // e é melhor que descartar em silêncio o que a pessoa digitou.
  assert.equal(deveEnviarSenha('igual', null), true);
});
