import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tratar, criarToken, tokenValido, COOKIE } from '../middleware.js';

const env = { PAINEL_USER: 'stargi', PAINEL_PASSWORD: 's3nh@:forte', SESSION_SECRET: 'segredo-de-teste' };
const O = 'https://painel.example.com';
const opts = { atrasoFalhaMs: 0 };
const get = (path, headers = {}) => new Request(O + path, { headers });
const post = (body, headers = {}) =>
  new Request(O + '/login', { method: 'POST', body: new URLSearchParams(body), headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers } });
const cookieDe = (r) => (r.headers.get('set-cookie') || '').split(';')[0];

test('fail closed sem variáveis de ambiente', async () => {
  for (const e of [{}, { PAINEL_USER: 'x' }, { PAINEL_PASSWORD: 'y' }, { PAINEL_USER: '', PAINEL_PASSWORD: '' }]) {
    assert.equal((await tratar(get('/'), e, opts)).status, 503);
    assert.equal((await tratar(get('/data/vendas.json'), e, opts)).status, 503);
    assert.equal((await tratar(post({ usuario: '', senha: '' }), e, opts)).status, 503);
    // nem um token "válido" sem env libera
    assert.notEqual(await tratar(get('/', { cookie: `${COOKIE}=${criarToken(e)}` }), e, opts), null);
  }
});
test('sem sessão: HTML vai para /login, JSON recebe 401 JSON', async () => {
  let r = await tratar(get('/'), env, opts);
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/login');
  r = await tratar(get('/index.html'), env, opts);
  assert.equal(r.headers.get('location'), '/login?next=%2Findex.html');
  r = await tratar(get('/assets/outra.png'), env, opts);
  assert.equal(r.status, 302);
  for (const p of ['/data/vendas.json', '/data/config.json', '/api/qualquer']) {
    r = await tratar(get(p), env, opts);
    assert.equal(r.status, 401);
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.equal((await r.json()).erro, 'nao_autenticado');
  }
});
test('página de login e logo são públicos', async () => {
  const r = await tratar(get('/login'), env, opts);
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.match(t, /Painel Financeiro/); assert.match(t, /type="password"/); assert.match(t, /Mostrar senha/);
  assert.equal(await tratar(get('/assets/logo-stargi.webp'), env, opts), null);
});
test('login errado: 401 com mensagem, sem cookie', async () => {
  for (const b of [{ usuario: 'stargi', senha: 'errada' }, { usuario: 'outro', senha: 's3nh@:forte' }, {}]) {
    const r = await tratar(post(b), env, opts);
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('set-cookie'), null);
    assert.match(await r.text(), /Usuário ou senha incorretos/);
  }
});
test('login certo: cookie HttpOnly/Secure/SameSite=Lax 30 dias, redireciona e libera tudo', async () => {
  const r = await tratar(post({ usuario: 'stargi', senha: 's3nh@:forte', next: '/index.html' }), env, opts);
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/index.html');
  const sc = r.headers.get('set-cookie');
  for (const f of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', `Max-Age=${30 * 86400}`]) assert.ok(sc.includes(f), f);
  const c = cookieDe(r);
  for (const p of ['/', '/index.html', '/data/vendas.json', '/assets/logo-stargi.webp']) assert.equal(await tratar(get(p, { cookie: c }), env, opts), null);
});
test('redirecionamento aberto bloqueado', async () => {
  for (const n of ['//evil.com', 'https://evil.com', '/\\evil.com', '/logout']) {
    const r = await tratar(post({ usuario: 'stargi', senha: 's3nh@:forte', next: n }), env, opts);
    assert.equal(r.headers.get('location'), '/');
  }
});
test('Origin de outro site é recusado', async () => {
  const r = await tratar(post({ usuario: 'stargi', senha: 's3nh@:forte' }, { origin: 'https://evil.com' }), env, opts);
  assert.equal(r.status, 403); assert.equal(r.headers.get('set-cookie'), null);
});
test('token: adulterado, expirado, outra senha ou outro segredo não vale', () => {
  const t = criarToken(env);
  assert.ok(tokenValido(t, env));
  assert.ok(!tokenValido(t.slice(0, -2) + 'xx', env));
  assert.ok(!tokenValido('a.b', env)); assert.ok(!tokenValido('', env)); assert.ok(!tokenValido(t + '.x', env));
  assert.ok(!tokenValido(criarToken(env, Date.now() - 31 * 86400e3), env));
  assert.ok(!tokenValido(t, { ...env, PAINEL_PASSWORD: 'nova' }));
  assert.ok(!tokenValido(t, { ...env, SESSION_SECRET: 'outro' }));
  const [p, s] = t.split('.');
  const forjado = Buffer.from(JSON.stringify({ u: 'stargi', exp: 9999999999 })).toString('base64url');
  assert.ok(!tokenValido(`${forjado}.${s}`, env));
});
test('logout apaga o cookie', async () => {
  const r = await tratar(get('/logout'), env, opts);
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/login');
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
});
test('GET /login já logado vai para o painel', async () => {
  const c = `${COOKIE}=${criarToken(env)}`;
  const r = await tratar(get('/login', { cookie: c }), env, opts);
  assert.equal(r.status, 303); assert.equal(r.headers.get('location'), '/');
});

test('Origin: mesmo host (via Host/x-forwarded-host) passa; null só com Sec-Fetch-Site same-origin', async () => {
  const ok = { usuario: 'stargi', senha: 's3nh@:forte' };
  let r = await tratar(post(ok, { origin: 'https://painel.example.com', 'sec-fetch-site': 'same-origin' }), env, opts);
  assert.equal(r.status, 303);
  r = await tratar(post(ok, { origin: 'https://stargi.vercel.app', 'x-forwarded-host': 'stargi.vercel.app' }), env, opts);
  assert.equal(r.status, 303);
  r = await tratar(post(ok, { origin: 'null', 'sec-fetch-site': 'same-origin' }), env, opts);
  assert.equal(r.status, 303);
  r = await tratar(post(ok, { origin: 'null' }), env, opts);
  assert.equal(r.status, 403);
  r = await tratar(post(ok, { 'sec-fetch-site': 'cross-site' }), env, opts);
  assert.equal(r.status, 403);
});
