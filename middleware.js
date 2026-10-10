// Vercel Routing Middleware (sem framework): login com página própria + cookie de sessão assinado (HMAC).
// Env obrigatórias: PAINEL_USER, PAINEL_PASSWORD. Opcional (recomendado): SESSION_SECRET.
// Sem PAINEL_USER/PAINEL_PASSWORD tudo fica bloqueado (fail closed).
import { next } from '@vercel/functions';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const config = {
  runtime: 'nodejs',
  matcher: ['/', '/(.*)'],
};

export const COOKIE = '__Host-stargi_sessao';
const DURACAO_S = 30 * 24 * 60 * 60; // 30 dias
const PUBLICOS = new Set(['/assets/logo-stargi.webp', '/favicon.ico']);
const ATRASO_FALHA_MS = 800;

/* ---------- utilidades ---------- */
const sha = (s) => createHash('sha256').update(String(s)).digest();
const igual = (a, b) => timingSafeEqual(sha(a), sha(b));
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function chave(env) {
  // A senha entra na chave: trocar a senha derruba todas as sessões.
  return createHmac('sha256', env.SESSION_SECRET || 'stargi-sem-session-secret')
    .update(`stargi-sessao-v1|${env.PAINEL_USER}|${env.PAINEL_PASSWORD}`)
    .digest();
}
export function criarToken(env, agora = Date.now()) {
  const payload = b64u(JSON.stringify({ u: env.PAINEL_USER, exp: Math.floor(agora / 1000) + DURACAO_S }));
  const sig = b64u(createHmac('sha256', chave(env)).update(payload).digest());
  return `${payload}.${sig}`;
}
export function tokenValido(token, env, agora = Date.now()) {
  if (!token || typeof token !== 'string') return false;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return false;
  const esperado = b64u(createHmac('sha256', chave(env)).update(payload).digest());
  if (!igual(sig, esperado)) return false;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return d.u === env.PAINEL_USER && typeof d.exp === 'number' && d.exp * 1000 > agora;
  } catch {
    return false;
  }
}
function lerCookie(request, nome) {
  const h = request.headers.get('cookie') || '';
  for (const parte of h.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return parte.slice(i + 1).trim();
  }
  return null;
}
const cookieSessao = (token) => `${COOKIE}=${token}; Path=/; Max-Age=${DURACAO_S}; HttpOnly; Secure; SameSite=Lax`;
const cookieApagar = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

function destinoSeguro(n) {
  if (typeof n !== 'string' || !n.startsWith('/') || n.startsWith('//') || n.includes('\\') || n.startsWith('/login') || n.startsWith('/logout')) return '/';
  return n;
}
const SEGURANCA = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const querJson = (request, path) =>
  path.endsWith('.json') || path.startsWith('/api/') ||
  ((request.headers.get('accept') || '').includes('application/json') && !(request.headers.get('accept') || '').includes('text/html'));
const json = (status, obj, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SEGURANCA, ...extra } });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// CSRF básico no POST /login: aceita só envio do próprio site.
function mesmaOrigem(request, url) {
  const origem = request.headers.get('origin');
  const sfs = request.headers.get('sec-fetch-site');
  if (sfs && !['same-origin', 'none'].includes(sfs)) return false;
  if (!origem) return true; // clientes sem Origin (ex.: curl)
  if (origem === 'null') return sfs === 'same-origin';
  let host;
  try { host = new URL(origem).host; } catch { return false; }
  const hosts = [url.host, request.headers.get('host'), ...(request.headers.get('x-forwarded-host') || '').split(',')]
    .map((h) => (h || '').trim()).filter(Boolean);
  return hosts.includes(host);
}

/* ---------- página de login ---------- */
export function paginaLogin({ erro = '', proximo = '/', usuario = '', bloqueado = false } = {}) {
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Entrar · Stargi Financeiro</title><meta name="robots" content="noindex, nofollow">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ctext y=%22.9em%22 font-size=%2290%22%3E%F0%9F%92%97%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--rosa:#e5ada8;--creme:#efe8d8;--marrom:#a0835b;--texto:#5e5e5e;--perigo:#dd7774;--branco:#fff;
--rosa-claro:color-mix(in srgb,var(--rosa) 22%,var(--branco));--creme-claro:color-mix(in srgb,var(--creme) 45%,var(--branco));--marrom-escuro:color-mix(in srgb,var(--marrom) 70%,#000)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:1.25rem;
font-family:"Poppins",system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--texto);
background:radial-gradient(circle at 15% 10%,var(--rosa-claro),transparent 45%),radial-gradient(circle at 90% 90%,var(--creme),transparent 50%),var(--creme-claro)}
.card{width:100%;max-width:380px;background:var(--branco);border-radius:24px;box-shadow:0 10px 40px rgba(160,131,91,.18);padding:2rem 1.5rem 1.6rem}
.logo{display:block;height:46px;width:auto;margin:0 auto .4rem}
h1{margin:0;text-align:center;color:var(--marrom-escuro);font-size:1.25rem;font-weight:600}
.sub{text-align:center;font-size:.85rem;color:#8a8a8a;margin:.2rem 0 1.4rem}
label{display:block;font-size:.78rem;font-weight:500;color:var(--marrom);margin:0 0 .3rem}
.campo{position:relative;margin-bottom:1rem}
input{width:100%;font-family:inherit;font-size:1rem;color:var(--marrom-escuro);background:var(--creme-claro);border:1.5px solid var(--creme);border-radius:14px;padding:.8rem .9rem}
input:focus{outline:none;border-color:var(--rosa);box-shadow:0 0 0 3px var(--rosa-claro)}
.campo.senha input{padding-right:3.2rem}
.olho{position:absolute;right:.35rem;bottom:.35rem;height:2.4rem;width:2.6rem;border:0;border-radius:10px;background:transparent;color:var(--marrom);cursor:pointer;display:flex;align-items:center;justify-content:center}
.olho:hover,.olho:focus-visible{background:var(--creme)}
.olho svg{width:22px;height:22px}
button.entrar{width:100%;margin-top:.4rem;border:0;border-radius:14px;padding:.9rem;font-family:inherit;font-size:1rem;font-weight:600;color:#fff;background:var(--marrom);cursor:pointer;transition:filter .15s}
button.entrar:hover{filter:brightness(1.07)}
button.entrar:disabled{opacity:.7;cursor:wait}
.erro{background:color-mix(in srgb,var(--perigo) 12%,var(--branco));color:color-mix(in srgb,var(--perigo) 75%,#000);border:1px solid color-mix(in srgb,var(--perigo) 35%,var(--branco));border-radius:12px;padding:.65rem .8rem;font-size:.86rem;margin-bottom:1rem;text-align:center}
.rodape{text-align:center;font-size:.72rem;color:#a3a3a3;margin-top:1.2rem}
</style></head>
<body>
<main class="card">
  <img class="logo" src="/assets/logo-stargi.webp" alt="stargi" width="118" height="46">
  <h1>Painel Financeiro</h1>
  <p class="sub">Entre para ver as finanças da Stargi 💗</p>
  ${bloqueado ? '<div class="erro" role="alert">Painel bloqueado: o acesso ainda não foi configurado.</div>' : ''}
  ${erro ? `<div class="erro" role="alert">${esc(erro)}</div>` : ''}
  <form method="post" action="/login" id="f">
    <input type="hidden" name="next" value="${esc(proximo)}">
    <div class="campo"><label for="u">Usuário</label>
      <input id="u" name="usuario" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required value="${esc(usuario)}" ${usuario ? '' : 'autofocus'}></div>
    <div class="campo senha"><label for="s">Senha</label>
      <input id="s" name="senha" type="password" autocomplete="current-password" required ${usuario ? 'autofocus' : ''}>
      <button type="button" class="olho" id="olho" aria-label="Mostrar senha" aria-pressed="false">
        <svg id="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
      </button></div>
    <button class="entrar" type="submit" id="b">Entrar</button>
  </form>
  <p class="rodape">Acesso restrito · Stargi</p>
</main>
<script>
(function(){var s=document.getElementById('s'),o=document.getElementById('olho'),ic=document.getElementById('ic');
var aberto='<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
var fechado='<path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.5 4.5-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';
o.addEventListener('click',function(){var m=s.type==='password';s.type=m?'text':'password';o.setAttribute('aria-pressed',m);o.setAttribute('aria-label',m?'Esconder senha':'Mostrar senha');ic.innerHTML=m?fechado:aberto;s.focus();});
document.getElementById('f').addEventListener('submit',function(){var b=document.getElementById('b');b.disabled=true;b.textContent='Entrando…';});})();
</script>
</body></html>`;
}
const html = (status, corpo, extra = {}) =>
  new Response(corpo, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      ...SEGURANCA,
      'Referrer-Policy': 'same-origin',
      ...extra,
    },
  });

/* ---------- handler principal (testável) ---------- */
export async function tratar(request, env = process.env, opts = {}) {
  const atraso = opts.atrasoFalhaMs ?? ATRASO_FALHA_MS;
  const url = new URL(request.url);
  const path = url.pathname;
  const configurado = Boolean(env.PAINEL_USER && env.PAINEL_PASSWORD);

  if (PUBLICOS.has(path) && request.method === 'GET') return null; // logo da tela de login

  if (path === '/logout') {
    return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': cookieApagar(), ...SEGURANCA } });
  }

  if (path === '/login') {
    if (!configurado) return html(503, paginaLogin({ bloqueado: true }));
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (tokenValido(lerCookie(request, COOKIE), env)) {
        return new Response(null, { status: 303, headers: { Location: destinoSeguro(url.searchParams.get('next')), ...SEGURANCA } });
      }
      return html(200, paginaLogin({ proximo: destinoSeguro(url.searchParams.get('next')) }));
    }
    if (request.method !== 'POST') return new Response('Método não permitido', { status: 405, headers: { Allow: 'GET, POST', ...SEGURANCA } });
    // CSRF básico: se o navegador mandar Origin, tem que ser o mesmo site
    if (!mesmaOrigem(request, url)) return html(403, paginaLogin({ erro: 'Requisição inválida. Tente de novo.' }));
    let usuario = '', senha = '', proximo = '/';
    try {
      const ct = request.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const d = await request.json();
        usuario = String(d.usuario ?? d.user ?? ''); senha = String(d.senha ?? d.password ?? ''); proximo = String(d.next ?? '/');
      } else {
        const fd = await request.formData();
        usuario = String(fd.get('usuario') ?? ''); senha = String(fd.get('senha') ?? ''); proximo = String(fd.get('next') ?? '/');
      }
    } catch { /* corpo inválido = falha */ }
    const okU = igual(usuario.trim(), env.PAINEL_USER);
    const okS = igual(senha, env.PAINEL_PASSWORD);
    if (okU && okS) {
      return new Response(null, { status: 303, headers: { Location: destinoSeguro(proximo), 'Set-Cookie': cookieSessao(criarToken(env)), ...SEGURANCA } });
    }
    if (atraso) await dormir(atraso);
    return html(401, paginaLogin({ erro: 'Usuário ou senha incorretos', proximo: destinoSeguro(proximo), usuario: usuario.trim().slice(0, 100) }));
  }

  if (!configurado) {
    return querJson(request, path) ? json(503, { erro: 'painel_bloqueado' }) : html(503, paginaLogin({ bloqueado: true }));
  }
  if (tokenValido(lerCookie(request, COOKIE), env)) return null; // autorizado

  if (querJson(request, path)) return json(401, { erro: 'nao_autenticado', login: '/login' });
  const destino = destinoSeguro(path + url.search);
  return new Response(null, {
    status: 302,
    headers: { Location: destino === '/' ? '/login' : '/login?next=' + encodeURIComponent(destino), ...SEGURANCA },
  });
}

export default async function middleware(request) {
  const r = await tratar(request);
  if (r) return r;
  return next({ headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}
