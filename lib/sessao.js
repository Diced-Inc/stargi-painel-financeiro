// Sessão compartilhada entre o middleware e as funções /api.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = '__Host-stargi_sessao';
export const DURACAO_S = 30 * 24 * 60 * 60; // 30 dias

const sha = (s) => createHash('sha256').update(String(s)).digest();
export const igual = (a, b) => timingSafeEqual(sha(a), sha(b));
const b64u = (buf) => Buffer.from(buf).toString('base64url');

export const configurado = (env) => Boolean(env.PAINEL_USER && env.PAINEL_PASSWORD);

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
  if (!configurado(env) || !token || typeof token !== 'string') return false;
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
export function lerCookie(request, nome = COOKIE) {
  const h = request.headers.get('cookie') || '';
  for (const parte of h.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return parte.slice(i + 1).trim();
  }
  return null;
}
export const autenticado = (request, env) => tokenValido(lerCookie(request), env);

// Aceita só requisições do próprio site (CSRF básico).
export function mesmaOrigem(request, url = new URL(request.url)) {
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
