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
test('embalagem por produto e retiradas das caixinhas Embalagens/Reinvestimento são salvas e validadas', async () => {
  const b = backendMemoria();
  const d1 = await (await dados(req('/api/dados'), ctx(b))).json();
  assert.deepEqual(d1.movimentos, []);
  assert.ok(d1.produtos.every((p) => p.embalagem === 5.69), 'semente: caixa pequena em todos');
  const prods = structuredClone(d1.produtos); prods[0].embalagem = 3.5;
  const mov = [{ id: 'r-1', data: '2026-10-15', caixinha: 'embalagens', tipo: 'retirada', valor: 120.5, descricao: 'Caixas + papel de seda' },
    { id: 'r-2', data: '2026-10-16', caixinha: 'reinvestimento', tipo: 'retirada', valor: 300, descricao: 'tecido', grupo: 'acessorios' },
    { id: 'r-3', data: '2026-10-17', caixinha: 'maoDeObra', tipo: 'retirada', valor: 150, descricao: 'meu pagamento' },
    { id: 'r-4', data: '2026-10-18', caixinha: 'proLabore', tipo: 'retirada', valor: 80, descricao: 'pró-labore' }];
  let r = await dados(req('/api/dados', { method: 'PUT', body: { baseVersao: 1, produtos: prods, movimentos: mov } }), ctx(b));
  const d2 = await r.json(); assert.equal(r.status, 200);
  assert.equal(d2.produtos[0].embalagem, 3.5); assert.deepEqual(d2.movimentos, mov);
  // só config: mantém as retiradas
  r = await dados(req('/api/dados', { method: 'PUT', body: { baseVersao: 2, config: d1.config } }), ctx(b));
  assert.deepEqual((await r.json()).movimentos, mov);
  for (const ruim of [
    [{ ...mov[0], valor: 0 }], [{ ...mov[0], valor: -5 }], [{ ...mov[0], data: '15/10/2026' }],
    [{ ...mov[0], caixinha: 'outra' }], [{ ...mov[0], caixinha: 'maodeobra' }], [{ ...mov[0], tipo: 'deposito' }], 'x',
  ]) {
    r = await dados(req('/api/dados', { method: 'PUT', body: { baseVersao: 3, movimentos: ruim } }), ctx(b));
    assert.equal(r.status, 400, JSON.stringify(ruim));
  }
  const p2 = structuredClone(prods); p2[0].embalagem = -1;
  r = await dados(req('/api/dados', { method: 'PUT', body: { baseVersao: 3, produtos: p2 } }), ctx(b));
  assert.equal(r.status, 400);
  // restaurar a versão 1 volta sem retiradas
  r = await hist(req('/api/historico', { method: 'POST', body: { versao: 1 } }), ctx(b));
  assert.deepEqual((await r.json()).movimentos, []);
});

test('despesas do painel: logística exige motivo; salva, edita, apaga e restaura', async () => {
  const b = backendMemoria();
  const d1 = await (await dados(req('/api/dados'), ctx(b))).json();
  assert.deepEqual(d1.despesas, []);
  const desp = [
    { id: 'd-1', data: '2026-10-12', valor: 23.9, categoria: 'Logística (Uber)', motivo: 'Bordado', nota: '', descricao: 'Levar peças na bordadeira' },
    { id: 'd-2', data: '2026-10-13', valor: 40, categoria: 'anúncios', descricao: 'Impulsionar post' },
  ];
  let r = await dados(req('/api/dados', { method: 'PUT', body: { baseVersao: 1, despesas: desp } }), ctx(b));
  const d2 = await r.json(); assert.equal(r.status, 200);
  assert.equal(d2.despesas.length, 2); assert.equal(d2.despesas[0].motivo, 'Bordado'); assert.equal(d2.despesas[1].motivo, undefined);
  assert.deepEqual(d2.movimentos, [], 'não mexe nas retiradas');
  for (const ruim of [
    [{ ...desp[0], motivo: undefined }], [{ ...desp[0], motivo: 'Passeio' }], [{ ...desp[0], motivo: 'Outros', nota: '' }],
    [{ ...desp[1], valor: 0 }], [{ ...desp[1], categoria: '' }], [{ ...desp[1], data: '2026-13-40' }], 'x',
  ]) {
    r = await dados(req('/api/dados', { method: 'PUT', body: { baseVersao: 2, despesas: ruim } }), ctx(b));
    assert.equal(r.status, 400, JSON.stringify(ruim));
  }
  const ed = structuredClone(d2.despesas); ed[0].valor = 30; ed[0].motivo = 'Outros'; ed[0].nota = 'Correios';
  r = await dados(req('/api/dados', { method: 'PUT', body: { baseVersao: 2, despesas: ed.slice(0, 1) } }), ctx(b));
  const d3 = await r.json(); assert.equal(d3.despesas.length, 1); assert.equal(d3.despesas[0].nota, 'Correios');
  r = await hist(req('/api/historico'), ctx(b)); assert.equal((await r.json()).versoes[0].despesas, 2);
  r = await hist(req('/api/historico', { method: 'POST', body: { versao: 1 } }), ctx(b));
  assert.deepEqual((await r.json()).despesas, []);
});

test('categorias: grupo do produto inferido pelo nome e editável', async () => {
  const { validarProdutos: vp } = await import('../lib/validar.js');
  const [a, b, c] = vp([{ nome: 'Regata Copa', tamanhos: {} }, { nome: 'Necessaire Mocha', tamanhos: {} }, { nome: 'Headband', grupo: 'roupas', tamanhos: {} }]);
  assert.equal(a.grupo, 'roupas'); assert.equal(b.grupo, 'acessorios'); assert.equal(c.grupo, 'roupas');
  assert.equal(vp([{ nome: 'Tube Top Júlia', grupo: 'xx', tamanhos: {} }])[0].grupo, 'roupas');
});
test('caixinhas por parte: lucro e reinvestimento exigem Acessórios/Roupas; antigas do reinvestimento viram Acessórios', async () => {
  const { validarMovimentos: vm } = await import('../lib/validar.js');
  const base = { data: '2026-10-10', tipo: 'retirada', valor: 10 };
  assert.equal(vm([{ ...base, caixinha: 'reinvestimento' }])[0].grupo, 'acessorios');
  assert.equal(vm([{ ...base, caixinha: 'lucro', grupo: 'roupas' }])[0].grupo, 'roupas');
  assert.throws(() => vm([{ ...base, caixinha: 'lucro' }]), /parte/);
  assert.equal(vm([{ ...base, caixinha: 'perdas', grupo: 'roupas' }])[0].grupo, undefined);
});
test('atacado: salva, valida, entra no histórico e respeita conflito', async () => {
  const b = backendMemoria();
  const v = (await (await dados(req('/api/dados'), ctx(b))).json()).versao;
  const at = [{ data: '2026-10-11', cliente: 'Loja X', itens: [{ produto: 'Necessaire P', qtd: 10 }, { produto: 'Mini charm', qtd: '5' }], valorRecebido: 900, materiais: 350.5, obs: 'tecido rosa' }];
  let r = await dados(req('/api/dados', { method: 'PUT', body: { baseVersao: v, atacado: at } }), ctx(b));
  const d = await r.json(); assert.equal(r.status, 200);
  assert.equal(d.atacado.length, 1); assert.equal(d.atacado[0].itens[1].qtd, 5); assert.ok(d.atacado[0].id);
  assert.equal(d.produtos.length, seed.produtos.length, 'não mexe nos produtos');
  r = await dados(req('/api/dados', { method: 'PUT', body: { baseVersao: v, atacado: [] } }), ctx(b));
  assert.equal(r.status, 409);
  for (const ruim of [[{ ...at[0], cliente: '' }], [{ ...at[0], itens: [] }], [{ ...at[0], valorRecebido: -1 }], [{ ...at[0], itens: [{ produto: 'x', qtd: 1.5 }] }]]) {
    r = await dados(req('/api/dados', { method: 'PUT', body: { baseVersao: d.versao, atacado: ruim } }), ctx(b));
    assert.equal(r.status, 400);
  }
  r = await dados(req('/api/dados', { method: 'PUT', body: { baseVersao: d.versao, atacado: [] } }), ctx(b));
  assert.equal((await r.json()).atacado.length, 0);
  const h = await (await hist(req('/api/historico'), ctx(b))).json();
  assert.equal(h.versoes[0].atacado, 1);
  r = await hist(req('/api/historico', { method: 'POST', body: { versao: h.versoes[0].versao } }), ctx(b));
  assert.equal((await r.json()).atacado.length, 1, 'restaurar traz o atacado de volta');
});
