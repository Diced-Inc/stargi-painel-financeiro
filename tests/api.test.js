import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dados, hist } from '../lib/api.js';
import { backendMemoria, MAX_HIST, PREFIXO_HIST } from '../lib/armazem.js';
import { criarToken, COOKIE } from '../lib/sessao.js';
import { validarProdutos, validarConfig } from '../lib/validar.js';
import { readFileSync } from 'node:fs';

const env = { PAINEL_USER: 'stargi', PAINEL_PASSWORD: 'x:y', SESSION_SECRET: 's' };
const seed = { produtos: JSON.parse(readFileSync('data/produtos.json')).produtos, config: JSON.parse(readFileSync('data/config.json')) };
const semente = async () => structuredClone(seed);
const O = 'https://p.example.com';
const ck = () => `${COOKIE}=${criarToken(env)}`;
const req = (path, { method = 'GET', body, cookie = ck(), headers = {} } = {}) =>
  new Request(O + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers } });
const ctx = (backend) => ({ env, backend, semente });

test('sem sessão: 401 JSON em GET/PUT de /api/dados e /api/historico', async () => {
  const b = backendMemoria();
  for (const [fn, m] of [[dados, 'GET'], [dados, 'PUT'], [hist, 'GET'], [hist, 'POST']]) {
    const r = await fn(req('/api/x', { method: m, cookie: null, body: m === 'GET' ? undefined : {} }), ctx(b));
    assert.equal(r.status, 401); assert.equal((await r.json()).erro, 'nao_autenticado');
  }
  const r = await dados(req('/api/dados', { cookie: `${COOKIE}=forjado.abc` }), ctx(b));
  assert.equal(r.status, 401);
  assert.equal(b.m.size, 0, 'nada gravado');
});
test('fail closed sem env', async () => {
  const r = await dados(req('/api/dados'), { env: {}, backend: backendMemoria(), semente });
  assert.equal(r.status, 503);
});
test('primeira leitura semeia; PUT salva, guarda histórico e restaura', async () => {
  const b = backendMemoria();
  let r = await dados(req('/api/dados'), ctx(b)); const d1 = await r.json();
  assert.equal(r.status, 200); assert.equal(d1.versao, 1); assert.equal(d1.produtos.length, seed.produtos.length);
  const prods = structuredClone(d1.produtos); prods[0].tamanhos.P.custo = 99.99;
  r = await dados(req('/api/dados', { method: 'PUT', body: { baseVersao: 1, produtos: prods } }), ctx(b));
  const d2 = await r.json(); assert.equal(r.status, 200); assert.equal(d2.versao, 2); assert.equal(d2.produtos[0].tamanhos.P.custo, 99.99);
  assert.deepEqual(d2.config, d1.config);
  r = await dados(req('/api/dados'), ctx(b)); assert.equal((await r.json()).produtos[0].tamanhos.P.custo, 99.99);
  // conflito
  r = await dados(req('/api/dados', { method: 'PUT', body: { baseVersao: 1, produtos: prods } }), ctx(b));
  assert.equal(r.status, 409);
  // histórico + restaurar
  r = await hist(req('/api/historico'), ctx(b)); const h = await r.json();
  assert.equal(h.versoes[0].versao, 1);
  r = await hist(req('/api/historico', { method: 'POST', body: { versao: 1 } }), ctx(b)); const d3 = await r.json();
  assert.equal(d3.versao, 3); assert.equal(d3.produtos[0].tamanhos.P.custo, seed.produtos[0].tamanhos.P.custo);
  assert.match(d3.origem, /restaurado/);
});
test(`histórico guarda no máximo ${MAX_HIST} versões`, async () => {
  const b = backendMemoria();
  let v = (await (await dados(req('/api/dados'), ctx(b))).json()).versao;
  for (let i = 0; i < MAX_HIST + 5; i++) {
    const r = await dados(req('/api/dados', { method: 'PUT', body: { baseVersao: v, config: seed.config } }), ctx(b));
    v = (await r.json()).versao;
  }
  assert.equal((await b.listar(PREFIXO_HIST)).length, MAX_HIST);
});
test('validação: rejeita dados ruins com 400 e não grava', async () => {
  const b = backendMemoria(); await dados(req('/api/dados'), ctx(b));
  const ruins = [
    { produtos: 'x' }, { produtos: [{ nome: '' }] }, { produtos: [{ nome: 'A', tamanhos: { XL: { preco: 1 } } }] },
    { produtos: [{ nome: 'A', tamanhos: { P: { preco: -1 } } }] }, { produtos: [{ nome: 'A', tamanhos: { P: { preco: 'abc' } } }] },
    { config: { ...seed.config, embalagem: { ...seed.config.embalagem, pecasParaCaixaGrande: 0 } } },
    { config: { ...seed.config, deducoesPorVenda: { ...seed.config.deducoesPorVenda, cupomPadraoPercent: 90 } } },
    {},
  ];
  for (const body of ruins) {
    const r = await dados(req('/api/dados', { method: 'PUT', body }), ctx(b));
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.equal((await (await dados(req('/api/dados'), ctx(b))).json()).versao, 1);
});
test('escrita exige JSON e mesma origem', async () => {
  const b = backendMemoria(); await dados(req('/api/dados'), ctx(b));
  let r = await dados(new Request(O + '/api/dados', { method: 'PUT', body: '{}', headers: { cookie: ck(), 'content-type': 'text/plain' } }), ctx(b));
  assert.equal(r.status, 415);
  r = await dados(req('/api/dados', { method: 'PUT', body: { config: seed.config }, headers: { origin: 'https://evil.com' } }), ctx(b));
  assert.equal(r.status, 403);
  r = await dados(req('/api/dados', { method: 'PUT', body: { config: seed.config }, headers: { 'sec-fetch-site': 'cross-site' } }), ctx(b));
  assert.equal(r.status, 403);
});
test('validarProdutos: limpa, gera id/apelido, remove tamanhos vazios', () => {
  const [p] = validarProdutos([{ nome: ' Bolsa  Nova ', tamanhos: { U: { preco: '59,90', custo: 20 }, P: { preco: null, custo: null } }, maoDeObraJaInclusaNoCusto: 1 }]);
  assert.equal(p.nome, 'Bolsa  Nova'.trim()); assert.equal(p.id, 'bolsa-nova'); assert.deepEqual(p.apelidos, ['bolsa nova']);
  assert.deepEqual(p.tamanhos, { U: { preco: 59.9, custo: 20 } }); assert.equal(p.maoDeObraJaInclusaNoCusto, true);
  const dup = validarProdutos([{ id: 'a', nome: 'A' }, { id: 'a', nome: 'A' }]);
  assert.notEqual(dup[0].id, dup[1].id);
});
test('config semente: pior caso = 29,95%', () => {
  const c = validarConfig(seed.config); const d = c.deducoesPorVenda, k = c.pagamento.cartao3x;
  const t = d.cupomPadraoPercent + d.reservaPerdasPercent + d.proLaborePercent + d.reservaTrocasPercent + k.parcelamentoPercent + k.recebimentoPercent;
  assert.equal(Math.round(t * 100) / 100, 29.95);
  assert.equal(c.embalagem.pecasParaCaixaGrande, 2); assert.equal(c.embalagem.caixas.pequena.custo, 5.69); assert.equal(c.embalagem.caixas.grande.custo, 6.74);
});
