// Servidor local para testar o painel inteiro (middleware + /api com armazenamento em memória + estáticos).
// Uso: PAINEL_USER=stargi PAINEL_PASSWORD=teste SESSION_SECRET=x node tests/servidor-local.mjs 8790
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { tratar } from '../middleware.js';
import { dados, hist } from '../lib/api.js';
import { backendMemoria } from '../lib/armazem.js';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const backend = backendMemoria();
const tipos = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png' };
const porta = Number(process.argv[2] || 8790);

http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const url = `http://${req.headers.host}${req.url}`;
  const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
  let r = await tratar(request.clone(), process.env, { atrasoFalhaMs: 0 });
  const p = new URL(url).pathname;
  if (!r) {
    if (p === '/api/dados') r = await dados(request, { backend });
    else if (p === '/api/historico') r = await hist(request, { backend });
    else {
      const arq = path.join(raiz, p === '/' ? 'index.html' : decodeURIComponent(p));
      if (!arq.startsWith(raiz)) r = new Response('não', { status: 403 });
      else try { r = new Response(await readFile(arq), { headers: { 'Content-Type': tipos[path.extname(arq)] || 'application/octet-stream' } }); }
      catch { r = new Response('não encontrado', { status: 404 }); }
    }
  }
  const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
  res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(porta, () => console.log('ok http://localhost:' + porta));
