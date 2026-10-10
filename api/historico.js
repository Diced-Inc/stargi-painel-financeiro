// GET  /api/historico -> { versoes: [...] } (últimas 30)
// POST /api/historico { versao } -> restaura (gera nova versão)
import { hist } from '../lib/api.js';
export const GET = (request) => hist(request);
export const POST = (request) => hist(request);
