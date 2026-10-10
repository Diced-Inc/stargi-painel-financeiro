// Guarda produtos + config num único documento JSON, com histórico das últimas versões.
export const CAMINHO = 'painel/dados.json';
export const PREFIXO_HIST = 'painel/historico/';
export const MAX_HIST = 30;

export class Conflito extends Error {}

// Backend Vercel Blob (store PRIVADO). Nada aqui gera URL pública.
export async function backendBlob() {
  const { put, get, head, list, del, BlobNotFoundError } = await import('@vercel/blob');
  return {
    async ler(caminho) {
      // ETag vem da API (head), no mesmo formato que o put usa no ifMatch.
      // Lido ANTES do conteúdo: se mudar no meio, o put falha (conflito) em vez de sobrescrever.
      let meta;
      try { meta = await head(caminho); } catch (e) {
        if (e instanceof BlobNotFoundError || /not.?found|404/i.test(String(e?.message || e))) return null;
        throw e;
      }
      const r = await get(caminho, { access: 'private', useCache: false });
      if (!r || r.statusCode !== 200) return null;
      return { texto: await new Response(r.stream).text(), etag: meta.etag };
    },
    async gravar(caminho, texto, { ifMatch } = {}) {
      try {
        const r = await put(caminho, texto, {
          access: 'private', addRandomSuffix: false, allowOverwrite: true,
          contentType: 'application/json; charset=utf-8', cacheControlMaxAge: 60,
          ...(ifMatch ? { ifMatch } : {}),
        });
        return { etag: r.etag };
      } catch (e) {
        if (ifMatch && /precondition|412|etag/i.test(String(e?.message || e))) throw new Conflito('versão mudou');
        throw e;
      }
    },
    async listar(prefixo) {
      const out = [];
      let cursor;
      do {
        const r = await list({ prefix: prefixo, cursor, limit: 1000 });
        out.push(...r.blobs.map((b) => ({ caminho: b.pathname, data: new Date(b.uploadedAt).toISOString() })));
        cursor = r.hasMore ? r.cursor : undefined;
      } while (cursor);
      return out;
    },
    async apagar(caminhos) { if (caminhos.length) await del(caminhos); },
  };
}

// Backend em memória (testes / desenvolvimento local).
export function backendMemoria() {
  const m = new Map();
  let n = 0;
  return {
    m,
    async ler(c) { return m.has(c) ? { ...m.get(c) } : null; },
    async gravar(c, texto, { ifMatch } = {}) {
      if (ifMatch && m.get(c)?.etag !== ifMatch) throw new Conflito('versão mudou');
      const etag = `"e${++n}"`;
      m.set(c, { texto, etag, data: new Date(Date.now() + n).toISOString() });
      return { etag };
    },
    async listar(p) { return [...m.entries()].filter(([c]) => c.startsWith(p)).map(([c, v]) => ({ caminho: c, data: v.data })); },
    async apagar(cs) { for (const c of cs) m.delete(c); },
  };
}

export async function carregar(b, semente) {
  const r = await b.ler(CAMINHO);
  if (r) return { doc: JSON.parse(r.texto), etag: r.etag };
  const doc = { versao: 1, atualizadoEm: new Date().toISOString(), origem: 'semente (data/*.json)', movimentos: [], despesas: [], ...(await semente()) };
  const { etag } = await b.gravar(CAMINHO, JSON.stringify(doc));
  return { doc, etag };
}

const idHist = (doc) => `${PREFIXO_HIST}${String(doc.versao).padStart(6, '0')}.json`;

export async function salvar(b, semente, { produtos, config, movimentos, despesas, baseVersao, origem = 'edição' }) {
  const { doc: atual, etag } = await carregar(b, semente);
  if (baseVersao != null && Number(baseVersao) !== atual.versao) throw new Conflito('versão mudou');
  await b.gravar(idHist(atual), JSON.stringify(atual)); // guarda a versão anterior
  const novo = {
    versao: atual.versao + 1,
    atualizadoEm: new Date().toISOString(),
    origem,
    produtos: produtos ?? atual.produtos,
    config: config ?? atual.config,
    movimentos: movimentos ?? atual.movimentos ?? [],
    despesas: despesas ?? atual.despesas ?? [],
  };
  await b.gravar(CAMINHO, JSON.stringify(novo), { ifMatch: etag });
  await podar(b);
  return novo;
}

async function podar(b) {
  const h = (await b.listar(PREFIXO_HIST)).sort((x, y) => y.caminho.localeCompare(x.caminho));
  await b.apagar(h.slice(MAX_HIST).map((x) => x.caminho));
}

export async function historico(b) {
  const h = (await b.listar(PREFIXO_HIST)).sort((x, y) => y.caminho.localeCompare(x.caminho));
  const out = [];
  for (const x of h) {
    const r = await b.ler(x.caminho);
    if (!r) continue;
    const d = JSON.parse(r.texto);
    out.push({ versao: d.versao, atualizadoEm: d.atualizadoEm, origem: d.origem || '', produtos: d.produtos?.length ?? 0, retiradas: d.movimentos?.length ?? 0, despesas: d.despesas?.length ?? 0 });
  }
  return out;
}

export async function restaurar(b, semente, versao) {
  const r = await b.ler(`${PREFIXO_HIST}${String(Number(versao)).padStart(6, '0')}.json`);
  if (!r) return null;
  const antigo = JSON.parse(r.texto);
  return salvar(b, semente, { produtos: antigo.produtos, config: antigo.config, movimentos: antigo.movimentos ?? [], despesas: antigo.despesas ?? [], origem: `restaurado da versão ${antigo.versao}` });
}
