// Handlers das funções /api (testáveis: recebem env e backend por parâmetro).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { autenticado, configurado, mesmaOrigem } from './sessao.js';
import { carregar, salvar, historico, restaurar, Conflito, backendBlob } from './armazem.js';
import { validarProdutos, validarConfig, validarMovimentos, validarDespesas, validarAtacado, ErroValidacao } from './validar.js';

const CAB = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
export const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: CAB });
const MAX_CORPO = 1_000_000;

async function lerJsonLocal(nome) {
  const tentativas = [path.join(process.cwd(), 'data', nome), new URL(`../data/${nome}`, import.meta.url)];
  for (const t of tentativas) {
    try { return JSON.parse(await readFile(t, 'utf8')); } catch { /* tenta o próximo */ }
  }
  throw new Error(`semente ${nome} não encontrada`);
}
export async function sementePadrao() {
  const [p, c] = await Promise.all([lerJsonLocal('produtos.json'), lerJsonLocal('config.json')]);
  return { produtos: p.produtos, config: c };
}

// Portão comum: sessão válida (e mesma origem para escrita)
function portao(request, env, escrita) {
  if (!configurado(env)) return json(503, { erro: 'painel_bloqueado' });
  if (!autenticado(request, env)) return json(401, { erro: 'nao_autenticado', login: '/login' });
  if (escrita) {
    if (!mesmaOrigem(request)) return json(403, { erro: 'origem_invalida' });
    if (!(request.headers.get('content-type') || '').includes('application/json')) return json(415, { erro: 'use_json' });
  }
  return null;
}
async function corpo(request) {
  const t = await request.text();
  if (t.length > MAX_CORPO) throw new ErroValidacao('Dados grandes demais');
  try { return JSON.parse(t); } catch { throw new ErroValidacao('JSON inválido'); }
}
function erro(e) {
  if (e instanceof ErroValidacao) return json(400, { erro: 'invalido', mensagem: e.message });
  if (e instanceof Conflito) return json(409, { erro: 'conflito', mensagem: 'Os dados foram alterados em outro aparelho. Recarregue a página.' });
  console.error('api erro', e);
  return json(500, { erro: 'falha_interna' });
}

export async function dados(request, { env = process.env, backend, semente = sementePadrao } = {}) {
  const escrita = request.method === 'PUT';
  if (!['GET', 'PUT'].includes(request.method)) return json(405, { erro: 'metodo' });
  const bloqueio = portao(request, env, escrita);
  if (bloqueio) return bloqueio;
  try {
    const b = backend ?? (await backendBlob());
    if (!escrita) return json(200, (await carregar(b, semente)).doc);
    const d = await corpo(request);
    const produtos = d.produtos !== undefined ? validarProdutos(d.produtos) : undefined;
    const config = d.config !== undefined ? validarConfig(d.config) : undefined;
    const movimentos = d.movimentos !== undefined ? validarMovimentos(d.movimentos) : undefined;
    const despesas = d.despesas !== undefined ? validarDespesas(d.despesas) : undefined;
    const atacado = d.atacado !== undefined ? validarAtacado(d.atacado) : undefined;
    if ([produtos, config, movimentos, despesas, atacado].every((x) => x === undefined)) throw new ErroValidacao('Nada para salvar');
    return json(200, await salvar(b, semente, { produtos, config, movimentos, despesas, atacado, baseVersao: d.baseVersao }));
  } catch (e) {
    return erro(e);
  }
}

export async function hist(request, { env = process.env, backend, semente = sementePadrao } = {}) {
  const escrita = request.method === 'POST';
  if (!['GET', 'POST'].includes(request.method)) return json(405, { erro: 'metodo' });
  const bloqueio = portao(request, env, escrita);
  if (bloqueio) return bloqueio;
  try {
    const b = backend ?? (await backendBlob());
    if (!escrita) return json(200, { versoes: await historico(b) });
    const d = await corpo(request);
    if (!Number.isInteger(Number(d.versao))) throw new ErroValidacao('versao inválida');
    const r = await restaurar(b, semente, d.versao);
    return r ? json(200, r) : json(404, { erro: 'versao_nao_encontrada' });
  } catch (e) {
    return erro(e);
  }
}
