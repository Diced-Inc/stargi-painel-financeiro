// Vercel Routing Middleware (sem framework): protege o painel inteiro com HTTP Basic Auth.
// Usuário e senha vêm das variáveis de ambiente PAINEL_USER e PAINEL_PASSWORD.
// Se alguma estiver faltando, bloqueia tudo (fail closed).
import { next } from '@vercel/functions';
import { createHash, timingSafeEqual } from 'node:crypto';

export const config = {
  runtime: 'nodejs',
  // Tudo: '/', '/index.html', '/data/*.json', '/assets/*', qualquer outro caminho.
  matcher: ['/', '/(.*)'],
};

const REALM = 'Stargi Financeiro';

function igual(a, b) {
  // compara em tempo constante (hash para igualar tamanhos)
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

function negar(status, msg, pedirSenha) {
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  if (pedirSenha) headers['WWW-Authenticate'] = `Basic realm="${REALM}", charset="UTF-8"`;
  return new Response(msg, { status, headers });
}

export function verificar(request, env = process.env) {
  const user = env.PAINEL_USER;
  const pass = env.PAINEL_PASSWORD;
  if (!user || !pass) return negar(503, 'Painel bloqueado: senha não configurada.', false);

  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Basic\s+([A-Za-z0-9+/=]+)\s*$/i);
  if (!m) return negar(401, 'Senha necessária.', true);

  let decod;
  try {
    decod = new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
  } catch {
    return negar(401, 'Senha necessária.', true);
  }
  const i = decod.indexOf(':');
  if (i < 0) return negar(401, 'Senha necessária.', true);
  const okUser = igual(decod.slice(0, i), user);
  const okPass = igual(decod.slice(i + 1), pass);
  if (okUser && okPass) return null; // autorizado
  return negar(401, 'Usuário ou senha incorretos.', true);
}

export default function middleware(request) {
  const bloqueio = verificar(request);
  if (bloqueio) return bloqueio;
  return next({ headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}
