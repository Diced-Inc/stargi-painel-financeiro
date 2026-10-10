# Painel Financeiro Stargi (v1)

Site estático: `index.html` (HTML + CSS + JS num arquivo só; Chart.js e a fonte Poppins vêm por CDN) e os dados em `data/*.json`.
Para atualizar números, **edite só os JSON**. O código não muda.

## Como abrir
O painel lê os JSON com `fetch`, então precisa de um servidor (abrir o `index.html` direto pelo arquivo não funciona):

```bash
cd painel && python3 -m http.server 8000   # abrir http://localhost:8000
```
Para publicar: suba a pasta `painel/` inteira em qualquer hospedagem estática (Vercel, Netlify...). **Proteja com senha**: são dados financeiros. A pasta não tem dados pessoais de clientes.

## Arquivos
| Arquivo | O que tem |
|---|---|
| `data/config.json` | Regras do negócio: percentuais, taxas, caixas, custos fixos, alertas |
| `data/produtos.json` | Catálogo com preço, custo e mão de obra (planilha de custo da Gizele) |
| `data/vendas.json` | Pedidos (gerado pelo script a partir do CSV da Nuvemshop + lançamentos manuais) |
| `data/despesas.json` | Saídas lançadas (tecido, aviamentos, anúncios...) |
| `data/contas.json` | Contas a pagar e a receber com vencimento |
| `data/caixinhas.json` | Retiradas e ajustes manuais das caixinhas |
| `scripts/import_nuvemshop_csv.py` | Converte o CSV de pedidos da Nuvemshop em `data/vendas.json` |
| `assets/logo-stargi.webp` | Logo baixada de stargi.com.br |

## Rotina semanal
1. **Vendas**: exportar os pedidos na Nuvemshop (Vendas → Exportar) e rodar
   `python3 scripts/import_nuvemshop_csv.py ~/Downloads/Vendas-xxxx.csv`
   O script deduplica pelo número do pedido, mantém os campos manuais e não copia dados pessoais.
   (Se a exportação estiver bloqueada pelo plano, lançar o pedido à mão em `vendas.json` no formato abaixo.)
2. **Despesas**: adicionar em `data/despesas.json`.
3. **Contas**: adicionar em `data/contas.json`; marcar `"pago": true` quando pagar.

## Esquemas

### vendas.json → `pedidos[]`
```json
{
 "numero": 305, "data": "2026-10-01T14:11:28",
 "statusPedido": "Aberto", "statusPagamento": "Confirmado", "statusEnvio": "Enviado",
 "cancelado": false,
 "canal": "Mobile", "formaEntrega": "Nuvem Envio Correios PAC",
 "formaPagamento": "Nuvem Pago", "meioPagamento": "Cartão de crédito", "parcelas": 3,
 "cupom": "STARGIGIRL",
 "subtotal": 189.70, "desconto": 9.49, "frete": 26.15, "total": 206.36,
 "taxas": 11.06, "juros": 14.90, "liquido": 180.40,
 "taxasFonte": "nuvemshop",
 "itens": [{"nome": "necessaire bordada personalizada (G, Rosa, branco)", "preco": 79.90, "qtd": 1, "sku": null}],
 "custoEtiqueta": 25.15,
 "caixas": null,
 "observacao": "...", "verificadoNoPainel": true
}
```
- `desconto` = cupom + desconto do Pix, como a Nuvemshop exporta.
- `taxas` + `juros` = tudo o que o Nuvem Pago descontou; `liquido` = `total − taxas − juros`.
- `taxasFonte`: `nuvemshop` (valor real do CSV), `estimado` (calculado pelas regras do config), `sem taxa (dinheiro)` ou `a confirmar`.
- **Campos manuais** (o script preserva): `custoEtiqueta` (valor real da etiqueta; se ficar `null`, o painel estima igual ao frete cobrado), `caixas` (substitui a regra automática, ex.: `{"grande":1,"pequena":1}`), `observacao`, `verificadoNoPainel`.
- O painel liga cada item ao custo pelo nome (veja `apelidos` em produtos.json) e pelo tamanho entre parênteses (P/M/G).

### despesas.json → `despesas[]`
```json
{"id": "d-2026-10-12-1", "data": "2026-10-12", "descricao": "Tecido tricoline rosa 3m", "categoria": "tecido", "valor": 120.00, "formaPagamento": "Pix", "obs": ""}
```
Categorias: `tecido`, `aviamentos`, `embalagem`, `frete`, `anúncios`, `fixo`, `outros`.
**Não lance DAS nem o plano da Nuvemshop**: eles vêm sozinhos de `config.custosFixosMensais`, a partir de `config.inicioControle`.
Todas as despesas entram no **saldo** (caixa). No **lucro** só entram as categorias de `config.categoriasQueEntramNoLucro` (anúncios, fixo, outros), porque tecido, aviamentos e embalagem já estão no custo de cada peça e o frete já está na etiqueta de cada pedido.

### contas.json
```json
{"aPagar":   [{"id": "p-1", "descricao": "Fornecedor - 2ª parcela", "valor": 150.00, "vencimento": "2026-10-20", "categoria": "tecido", "pago": false}],
 "aReceber": [{"id": "r-1", "descricao": "Encomenda Maria (sinal pago)", "valor": 80.00, "vencimento": "2026-10-25", "recebido": false}],
 "fixosPagos": ["das-mei:2026-10"]}
```
Selo vermelho = vencida ou vence hoje; amarelo = vence nos próximos `config.alertas.diasAntesDoVencimento` dias (7).
Os fixos com `diaVencimento` aparecem sozinhos no mês atual; para tirar da lista, coloque `"<id>:<AAAA-MM>"` em `fixosPagos`.

### caixinhas.json → `movimentos[]`
```json
{"data": "2026-10-31", "caixinha": "proLabore", "valor": -50.00, "descricao": "Retirada pró-labore outubro"}
```
`caixinha`: `perdas` | `proLabore` | `trocas`. O que entra é calculado das vendas (% do config sobre `subtotal − desconto`, sem frete) desde `inicioControle`; aqui só vão as retiradas (valor negativo) ou ajustes.

### produtos.json → `produtos[]`
```json
{"id": "necessaire-summer", "nome": "Necessaire Summer", "categoria": "necessaire",
 "tamanhos": {"P": {"preco": 49.90, "custo": 26.03, "lucroPlanilha": 8.92}},
 "maoDeObra": 11.00, "maoDeObraJaInclusaNoCusto": false, "caixa": "pequena",
 "apelidos": ["necessaire summer"]}
```
Produto de tamanho único usa a chave `U`. `custo` é o da planilha (com a caixa embutida); se `config.embalagem.inclusaNoCustoDoProduto` = true, o painel tira o valor da caixa (`caixa`: grande/pequena) do custo e cobra a caixa **por pedido**.

### config.json (principais campos)
- `inicioControle` ("2026-10"): mês a partir do qual despesas, fixos e caixinhas são controlados.
- `maoDeObraInclusaNoCusto` (false) + `categoriasComMaoDeObraNoCusto` (["regata"]): confirmado pela Gizele em 10/10/2026. A mão de obra só está no custo das regatas e tops; nos outros produtos é descontada à parte. Produto novo de regata/top: use `"categoria": "regata"`.
- `embalagem.caixas.grande/pequena.custo` (6,74 / 5,69), `palavrasCaixaGrande` (["tote","bag serena"]).
- `deducoesPorVenda`: cupom padrão 5, perdas 5, pró-labore 5, trocas 2 (%).
- `pagamento.cartao3x`: parcelamento 7,76% + recebimento 5,19% + R$ 0,35; `pagamento.pix`: desconto 5% + taxa 0,99% (observada no CSV).
- `custosFixosMensais`: DAS MEI 85 (vence dia 20), Plano Nuvemshop 69 (a confirmar).
- `frete.estimarEtiquetaIgualAoFreteCobrado` (true).
- `alertas`: dias antes do vencimento, margem baixa (%), lucro baixo (R$).

## Como o painel calcula
- **Faturamento bruto** = Σ total pago (produtos + frete). **Líquido** = Σ `liquido`. **Ticket médio** = bruto / nº de pedidos.
- **Despesas** = lançadas + fixos (se o mês ≥ inicioControle) + etiquetas. **Saldo** = líquido − despesas.
- **Lucro de um pedido** = (subtotal − desconto) + frete − etiqueta − taxas − custo das peças (sem caixa) − mão de obra − caixa(s) − caixinhas (12%).
- **Lucro estimado do mês** = Σ lucro dos pedidos cujos produtos têm custo cadastrado − fixos − despesas de anúncios/fixo/outros. O painel mostra quantos pedidos entraram na conta.
- **Margem por produto/simulador**: 1 peça num pedido sozinho. Cartão: (7,76% se parcelado) + 5,19% + R$ 0,35 sobre o valor pago. Pix: preço × (1 − cupom) × 0,95, taxa 0,99%.
- **Ponto de equilíbrio** = fixos ÷ lucro médio por pedido (pedidos com custo, últimos 6 meses).
- Pedidos cancelados ficam listados, mas não somam.

## Cores
Todas em variáveis CSS no topo do `index.html`, tiradas do tema da loja stargi.com.br.

## Publicação (Vercel + senha)
- Repositório privado no GitHub; deploy na Vercel (plano Hobby, sem Next.js, sem build: `vercel.json` serve a raiz como estático).
- `middleware.js` (Vercel Routing Middleware, runtime Node) roda **antes de toda requisição** (`/`, `/index.html`, `/data/*.json`, `/assets/*`...) e exige HTTP Basic Auth.
- Variáveis de ambiente na Vercel (Settings → Environment Variables, em Production e Preview):
  - `PAINEL_USER`: usuário
  - `PAINEL_PASSWORD`: senha
- Sem essas variáveis o painel fica **todo bloqueado** (503), nunca aberto.
- Teste local da lógica: `npm install && npm test`.
- `.gitignore` impede subir `screenshots/`, CSVs da Nuvemshop (`*.csv`), `.env*` e `node_modules/`.
