// Validação e limpeza do que vem do navegador antes de gravar.
export const TAMANHOS = ['P', 'M', 'G', 'U'];
const MAX_PRODUTOS = 300;

export class ErroValidacao extends Error {}
const falha = (m) => { throw new ErroValidacao(m); };

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
function texto(v, max, campo, obrigatorio = false) {
  if (v == null) v = '';
  if (typeof v !== 'string') falha(`${campo}: precisa ser texto`);
  v = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (obrigatorio && !v) falha(`${campo}: obrigatório`);
  if (v.length > max) falha(`${campo}: máximo ${max} caracteres`);
  return v;
}
function numero(v, campo, { min = 0, max = 100000, nulo = false, inteiro = false } = {}) {
  if ((v === null || v === undefined || v === '') && nulo) return null;
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) falha(`${campo}: número inválido`);
  if (n < min || n > max) falha(`${campo}: precisa estar entre ${min} e ${max}`);
  if (inteiro && !Number.isInteger(n)) falha(`${campo}: precisa ser inteiro`);
  return Math.round(n * 100) / 100;
}
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'produto';

export function validarProdutos(lista) {
  if (!Array.isArray(lista)) falha('produtos: precisa ser uma lista');
  if (lista.length > MAX_PRODUTOS) falha(`produtos: máximo ${MAX_PRODUTOS}`);
  const ids = new Set();
  return lista.map((p, i) => {
    if (!p || typeof p !== 'object') falha(`produto ${i + 1}: inválido`);
    const nome = texto(p.nome, 120, `produto ${i + 1} (nome)`, true);
    let id = typeof p.id === 'string' && /^[a-z0-9-]{1,80}$/.test(p.id) ? p.id : slug(nome);
    while (ids.has(id)) id = `${slug(nome)}-${Math.random().toString(36).slice(2, 6)}`;
    ids.add(id);
    const tamanhos = {};
    const t = p.tamanhos && typeof p.tamanhos === 'object' ? p.tamanhos : {};
    for (const k of Object.keys(t)) {
      if (!TAMANHOS.includes(k)) falha(`${nome}: tamanho "${k}" inválido (use P, M, G ou U)`);
      const preco = numero(t[k]?.preco, `${nome} ${k} (valor de venda)`, { nulo: true });
      const custo = numero(t[k]?.custo, `${nome} ${k} (custo)`, { nulo: true });
      if (preco == null && custo == null) continue;
      tamanhos[k] = { preco, custo };
    }
    let apelidos = Array.isArray(p.apelidos) ? p.apelidos.slice(0, 10).map((a, j) => texto(a, 120, `${nome} apelido ${j + 1}`)).filter(Boolean) : [];
    if (!apelidos.length) apelidos = [norm(nome)];
    const out = {
      id, nome,
      categoria: texto(p.categoria, 40, `${nome} (categoria)`),
      cores: texto(p.cores, 200, `${nome} (cores)`),
      bordado: texto(p.bordado, 200, `${nome} (bordado)`),
      tamanhos,
      maoDeObra: numero(p.maoDeObra, `${nome} (mão de obra)`, { nulo: true }),
      maoDeObraJaInclusaNoCusto: Boolean(p.maoDeObraJaInclusaNoCusto),
      embalagem: numero(p.embalagem, `${nome} (embalagem)`, { nulo: true, max: 1000 }),
      apelidos,
    };
    const obs = texto(p.obs, 500, `${nome} (obs)`);
    if (obs) out.obs = obs;
    return out;
  });
}

// Campos numéricos editáveis do config: [caminho, opções]
export const CAMPOS_CONFIG = [
  ['embalagem.caixas.pequena.custo', {}],
  ['embalagem.caixas.grande.custo', {}],
  ['embalagem.pecasParaCaixaGrande', { min: 1, max: 50, inteiro: true }],
  ['deducoesPorVenda.cupomPadraoPercent', { max: 100 }],
  ['deducoesPorVenda.reservaPerdasPercent', { max: 100 }],
  ['deducoesPorVenda.proLaborePercent', { max: 100 }],
  ['deducoesPorVenda.reservaTrocasPercent', { max: 100 }],
  ['pagamento.cartao3x.parcelamentoPercent', { max: 100 }],
  ['pagamento.cartao3x.recebimentoPercent', { max: 100 }],
  ['pagamento.cartao3x.taxaFixa', { max: 100 }],
  ['pagamento.pix.descontoClientePercent', { max: 100 }],
  ['pagamento.pix.taxaPercent', { max: 100 }],
];
const pegar = (o, c) => c.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function pôr(o, c, v) {
  const ks = c.split('.');
  let a = o;
  for (const k of ks.slice(0, -1)) { if (a[k] == null || typeof a[k] !== 'object') a[k] = {}; a = a[k]; }
  a[ks.at(-1)] = v;
}
export function validarConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) falha('config: inválido');
  const out = structuredClone(cfg);
  if (JSON.stringify(out).length > 50000) falha('config: grande demais');
  for (const [c, o] of CAMPOS_CONFIG) pôr(out, c, numero(pegar(out, c), c, o));
  const s = ['cupomPadraoPercent', 'reservaPerdasPercent', 'proLaborePercent', 'reservaTrocasPercent']
    .reduce((t, k) => t + out.deducoesPorVenda[k], 0) + out.pagamento.cartao3x.parcelamentoPercent + out.pagamento.cartao3x.recebimentoPercent;
  if (s >= 100) falha('A soma das deduções precisa ser menor que 100%');
  if (Array.isArray(out.custosFixosMensais)) {
    out.custosFixosMensais = out.custosFixosMensais.map((f, i) => ({
      ...f,
      nome: texto(f.nome, 120, `custo fixo ${i + 1}`, true),
      valor: numero(f.valor, `custo fixo ${i + 1} (valor)`),
    }));
  }
  return out;
}

// Retiradas das caixinhas lançadas pelo painel (hoje: só a caixinha Embalagens).
export const CAIXINHAS_COM_RETIRADA = ['embalagens'];
const MAX_MOVIMENTOS = 3000;
export function validarMovimentos(lista) {
  if (!Array.isArray(lista)) falha('movimentos: precisa ser uma lista');
  if (lista.length > MAX_MOVIMENTOS) falha(`movimentos: máximo ${MAX_MOVIMENTOS}`);
  const ids = new Set();
  return lista.map((m, i) => {
    if (!m || typeof m !== 'object') falha(`retirada ${i + 1}: inválida`);
    const data = typeof m.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.data) && !Number.isNaN(Date.parse(m.data)) ? m.data : falha(`retirada ${i + 1}: data inválida`);
    if (!CAIXINHAS_COM_RETIRADA.includes(m.caixinha)) falha(`retirada ${i + 1}: caixinha inválida`);
    if (m.tipo !== 'retirada') falha(`retirada ${i + 1}: tipo inválido`);
    const valor = numero(m.valor, `retirada ${i + 1} (valor)`, { min: 0.01, max: 100000 });
    let id = typeof m.id === 'string' && /^[a-z0-9-]{1,60}$/.test(m.id) ? m.id : `r-${data}-${i}`;
    while (ids.has(id)) id = `${id}-${Math.random().toString(36).slice(2, 5)}`;
    ids.add(id);
    return { id, data, caixinha: m.caixinha, tipo: 'retirada', valor, descricao: texto(m.descricao, 200, `retirada ${i + 1} (descrição)`) };
  });
}
