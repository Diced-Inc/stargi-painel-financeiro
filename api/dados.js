// GET  /api/dados  -> { versao, atualizadoEm, produtos, config }
// PUT  /api/dados  { baseVersao, produtos?, config? } -> novo documento
import { dados } from '../lib/api.js';
export const GET = (request) => dados(request);
export const PUT = (request) => dados(request);
