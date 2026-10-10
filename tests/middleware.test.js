import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verificar } from '../middleware.js';

const env = { PAINEL_USER: 'gizele', PAINEL_PASSWORD: 's3nh@:forte' };
const req = (path, auth) =>
  new Request('https://painel.example.com' + path, { headers: auth ? { authorization: auth } : {} });
const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

test('fail closed sem variáveis de ambiente', () => {
  for (const e of [{}, { PAINEL_USER: 'x' }, { PAINEL_PASSWORD: 'y' }, { PAINEL_USER: '', PAINEL_PASSWORD: '' }]) {
    const r = verificar(req('/', basic('x', 'y')), e);
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('www-authenticate'), null);
  }
});
test('sem credencial pede senha (401 + WWW-Authenticate)', () => {
  for (const p of ['/', '/index.html', '/data/vendas.json', '/assets/logo-stargi.webp']) {
    const r = verificar(req(p), env);
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate'), /^Basic realm="Stargi Financeiro"/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
});
test('senha errada, usuário errado, header malformado', () => {
  for (const a of [basic('gizele', 'errada'), basic('outra', 's3nh@:forte'), 'Basic !!!', 'Bearer abc', 'Basic ' + btoa('semdoispontos')]) {
    assert.equal(verificar(req('/data/vendas.json', a), env).status, 401);
  }
});
test('credencial certa libera (senha com ":" funciona)', () => {
  assert.equal(verificar(req('/data/vendas.json', basic('gizele', 's3nh@:forte')), env), null);
  assert.equal(verificar(req('/', basic('gizele', 's3nh@:forte')), env), null);
});
