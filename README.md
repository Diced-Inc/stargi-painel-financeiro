# Painel Financeiro Stargi (v1)

Site estático (`index.html`: HTML + CSS + JS num arquivo só; Chart.js e Poppins por CDN) + middleware de login + 2 funções `/api`.

- **Produtos (preço, custo, mão de obra) e configurações** (caixas, deduções, taxas) são **editados no próprio painel** e ficam salvos num armazenamento **privado** (Vercel Blob `stargi-painel-financeiro-dados`, ligado só a este projeto). `data/produtos.json` e `data/config.json` são só a **semente** usada se o armazenamento estiver vazio.
- **Vendas, despesas, contas e caixinhas** continuam em `data/*.json` (editar o JSON, commit e deploy).

## Como abrir
O painel lê os JSON com `fetch`, então precisa de um servidor (abrir o `index.html` direto pelo arquivo não funciona):

```bash
cd painel && python3 -m http.server 8000   # abrir http://localhost:8000
```
Para publicar: suba a pasta `painel/` inteira em qualquer hospedagem estática (Vercel, Netlify...). **Proteja com senha**: são dados financeiros. A pasta não tem dados pessoais de clientes.

## Layout (abas)
Quatro abas, com o mês escolhido no topo valendo para todas (no celular, barra fixa embaixo; no computador, no topo):
- **Início**: "Sobrou este mês" = líquido recebido (já sem taxas) − saídas do mês (despesas, custos fixos, etiquetas e retiradas das caixinhas); métricas do mês; alertas de contas vencidas ou vencendo em 7 dias; ponto de equilíbrio em barra ("X de Y vendas para cobrir os custos do mês").
- **Movimentações**: vendas e saídas do mês numa lista só (filtro todas/entradas/saídas), gráfico entradas x saídas (mês/semana), contas a pagar e a receber.
- **Caixinhas**: as seis caixinhas, total guardado, botão Retirar em cada uma e detalhe por mês. Retirada = despesa (entra uma vez nas saídas, nunca de novo no lucro).
- **Produtos**: tabela editável de margem, simulador e configurações (com histórico).
Versão anterior do layout: tag git `v-layout-antigo`.

## Editar produtos e configurações (no painel)
- Seção **Produtos, custos e margem**: no computador é uma tabela editável (como a planilha); no celular, cartões com botão **Editar** (abre uma janela). **Adicionar produto** e **Excluir** (ícone de lixeira) (pede confirmação).
- Valores em R$ têm máscara (digite só números: `4990` -> R$ 49,90). Tamanho em branco = não existe.
- **Custo = custo da peça SEM embalagem.** A caixa é cobrada por pedido: 1 peça = caixa pequena; a partir de N peças (padrão 2) = caixa grande. Brindes (R$ 0,00) não contam como peça.
- **Lucro (tabela)** = pedido de 1 peça, pior caso, como na planilha: preço × (1 − 29,95%) − R$ 0,35 − custo − mão de obra (se não estiver inclusa) − caixa pequena.
- Seção **Configurações**: preço das caixas, a partir de quantas peças usa a caixa grande, cupom, perdas, pró-labore, trocas, taxas do cartão e do Pix.
- Alterou algo na tabela ou nas configurações -> aparece a barra **Salvar**. No modal, “Salvar produto” já salva.
- **Histórico**: as últimas 30 versões ficam guardadas; em Configurações -> *Histórico de alterações* -> **Restaurar** (restaurar também vira uma versão nova, então dá para desfazer).
- Duas pessoas editando ao mesmo tempo: quem salvar por último recebe aviso para recarregar (nada é sobrescrito sem querer).

## API (só com sessão; sem sessão = 401 JSON)
| Rota | O que faz |
|---|---|
| `GET /api/dados` | `{versao, atualizadoEm, produtos, config}` (semeia na 1ª leitura) |
| `PUT /api/dados` | corpo JSON `{baseVersao, produtos?, config?}`; valida, guarda a versão anterior no histórico, devolve a nova |
| `GET /api/historico` | últimas versões |
| `POST /api/historico` | `{versao}` restaura |

Escrita exige `Content-Type: application/json` e mesma origem. Código: `lib/sessao.js` (sessão), `lib/validar.js` (validação), `lib/armazem.js` (Blob + histórico), `lib/api.js` (handlers), `api/*.js` (rotas).

## Arquivos
| Arquivo | O que tem |
|---|---|
| `data/config.json` | **Semente** das regras (o config vivo fica no Blob privado) |
| `data/produtos.json` | **Semente** do catálogo (o catálogo vivo fica no Blob privado) |
| `data/vendas.json` | Pedidos (gerado pelo script a partir do CSV da Nuvemshop + lançamentos manuais) |
| `data/despesas.json` | Saídas lançadas (tecido, aviamentos, anúncios...) |
| `data/contas.json` | Contas a pagar e a receber com vencimento |
| `data/caixinhas.json` | Retiradas e ajustes manuais das caixinhas |
| `scripts/import_nuvemshop_csv.py` | Converte o CSV de pedidos da Nuvemshop em `data/vendas.json` |
| `assets/logo-stargi.webp` | Logo baixada de stargi.com.br |

## Rotina semanal
1. **Vendas**: exportar os pedidos na Nuvemshop (Vendas -> Exportar) e rodar
   `python3 scripts/import_nuvemshop_csv.py ~/Downloads/Vendas-xxxx.csv`
   O script deduplica pelo número do pedido, mantém os campos manuais e não copia dados pessoais.
   (Se a exportação estiver bloqueada pelo plano, lançar o pedido à mão em `vendas.json` no formato abaixo.)
2. **Despesas**: adicionar em `data/despesas.json`.
3. **Contas**: adicionar em `data/contas.json`; marcar `"pago": true` quando pagar.

## Esquemas

### vendas.json -> `pedidos[]`
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

### despesas.json -> `despesas[]`
```json
{"id": "d-2026-10-12-1", "data": "2026-10-12", "descricao": "Tecido tricoline rosa 3m", "categoria": "tecido", "valor": 120.00, "formaPagamento": "Pix", "obs": ""}
```
Categorias: `tecido`, `aviamentos`, `embalagem`, `frete`, `anúncios`, `fixo`, `outros`.
**Não lance DAS nem o plano da Nuvemshop**: eles vêm sozinhos de `config.custosFixosMensais`, a partir de `config.inicioControle`.
Todas as despesas entram no **saldo** (caixa). No **lucro** só entram as categorias de `config.categoriasQueEntramNoLucro` (anúncios, fixo, outros), porque tecido e aviamentos já estão no custo de cada peça, a embalagem é cobrada por pedido e o frete já está na etiqueta de cada pedido.

### contas.json
```json
{"aPagar":   [{"id": "p-1", "descricao": "Fornecedor - 2ª parcela", "valor": 150.00, "vencimento": "2026-10-20", "categoria": "tecido", "pago": false}],
 "aReceber": [{"id": "r-1", "descricao": "Encomenda Maria (sinal pago)", "valor": 80.00, "vencimento": "2026-10-25", "recebido": false}],
 "fixosPagos": ["das-mei:2026-10"]}
```
Selo vermelho = vencida ou vence hoje; amarelo = vence nos próximos `config.alertas.diasAntesDoVencimento` dias (7).
Os fixos com `diaVencimento` aparecem sozinhos no mês atual; para tirar da lista, coloque `"<id>:<AAAA-MM>"` em `fixosPagos`.

### caixinhas.json -> `movimentos[]`
```json
{"data": "2026-10-31", "caixinha": "proLabore", "valor": -50.00, "descricao": "Retirada pró-labore outubro"}
```
`caixinha`: `perdas` | `proLabore` | `trocas`. O que entra é calculado das vendas (% do config sobre `subtotal − desconto`, sem frete) desde `inicioControle`; aqui só vão as retiradas (valor negativo) ou ajustes.

### produtos.json -> `produtos[]`
```json
{"id": "necessaire-summer", "nome": "Necessaire Summer", "categoria": "necessaire", "cores": "Branco",
 "tamanhos": {"P": {"preco": 49.90, "custo": 26.03}},
 "maoDeObra": 11.00, "maoDeObraJaInclusaNoCusto": false,
 "apelidos": ["necessaire summer"]}
```
Produto de tamanho único usa a chave `U`. `custo` = custo da peça **sem embalagem**. `maoDeObraJaInclusaNoCusto` = true nas regatas e tops.

### config.json (principais campos)
- `inicioControle` ("2026-10"): mês a partir do qual despesas, fixos e caixinhas são controlados.
- `maoDeObraInclusaNoCusto` (false) + `categoriasComMaoDeObraNoCusto` (["regata"]): confirmado pela Gizele em 10/10/2026. A mão de obra só está no custo das regatas e tops; nos outros produtos é descontada à parte. Produto novo de regata/top: use `"categoria": "regata"`.
- `embalagem.caixas.pequena/grande.custo` (5,69 / 6,74), `embalagem.pecasParaCaixaGrande` (2): 1 caixa por pedido, grande a partir de 2 peças pagas.
- `deducoesPorVenda`: cupom padrão 5, perdas 5, pró-labore 5, trocas 2 (%).
- `pagamento.cartao3x`: parcelamento 7,76% + recebimento 5,19% + R$ 0,35; `pagamento.pix`: desconto 5% + taxa 0,99% (observada no CSV).
- `custosFixosMensais`: DAS MEI 85 (vence dia 20), Plano Nuvemshop 69 (a confirmar).
- `frete.estimarEtiquetaIgualAoFreteCobrado` (true).
- `alertas`: dias antes do vencimento, margem baixa (%), lucro baixo (R$).

## Como o painel calcula
- **Faturamento bruto** = Σ total pago (produtos + frete). **Líquido** = Σ `liquido`. **Ticket médio** = bruto / nº de pedidos.
- **Despesas** = lançadas + fixos (se o mês ≥ inicioControle) + etiquetas. **Saldo** = líquido − despesas.
- **Lucro de um pedido** = (subtotal − desconto) + frete − etiqueta − taxas reais − custo das peças − mão de obra − caixa (pequena ou grande pelo nº de peças) − caixinhas (12%).
- **Lucro estimado do mês** = Σ lucro dos pedidos cujos produtos têm custo cadastrado − fixos − despesas de anúncios/fixo/outros. O painel mostra quantos pedidos entraram na conta.
- **Tabela de produtos/simulador**: 1 peça num pedido sozinho (caixa pequena), todas as % sobre o preço de venda, como na planilha. Cartão 3x: cupom + 12% caixinhas + 7,76% + 5,19% + R$ 0,35. Cartão à vista: sem os 7,76%. Pix: cupom + 12% + 5% desconto + 0,99% taxa.
- **Ponto de equilíbrio** = fixos ÷ lucro médio por pedido (pedidos com custo, últimos 6 meses).
- Pedidos cancelados ficam listados, mas não somam.

## Cores
Todas em variáveis CSS no topo do `index.html`, tiradas do tema da loja stargi.com.br.

## Publicação (Vercel + login)
- Repositório privado no GitHub; deploy na Vercel (projeto `stargi-painel-financeiro`, time `diced-inc`, plano Hobby, sem Next.js, sem build: `vercel.json` serve a raiz como estático).
- `middleware.js` (Vercel Routing Middleware, runtime Node) roda **antes de toda requisição**:
  - Sem sessão: páginas e arquivos -> redireciona para `/login` (página própria da Stargi); `*.json` e `/api/*` -> `401` em JSON. Só a logo (`/assets/logo-stargi.webp`) é pública, para a tela de login.
  - `POST /login` (formulário `usuario`, `senha`, `next`) compara com as variáveis de ambiente em tempo constante. Certo: cookie `__Host-stargi_sessao` (HttpOnly, Secure, SameSite=Lax, 30 dias) assinado com HMAC-SHA256 e redireciona. Errado: espera ~0,8 s e mostra "Usuário ou senha incorretos".
  - `/logout` (link **Sair** no topo do painel) apaga o cookie.
  - A chave do HMAC vem de `SESSION_SECRET` + usuário + senha: trocar a senha ou o segredo derruba todas as sessões.
  - Recusa `POST /login` com `Origin` de outro site e bloqueia redirecionamento para fora (`next` só aceita caminho interno).
- Variáveis de ambiente na Vercel (Production e Preview):
  - `PAINEL_USER`, `PAINEL_PASSWORD`: o login
  - `SESSION_SECRET`: segredo aleatório para assinar a sessão (sensível)
- Sem `PAINEL_USER`/`PAINEL_PASSWORD` o painel fica **todo bloqueado** (503), nunca aberto.
- Teste local: `npm install && npm test`; painel completo com API em memória: `PAINEL_USER=stargi PAINEL_PASSWORD=teste SESSION_SECRET=x node tests/servidor-local.mjs 8811`.
- Armazenamento: Vercel Blob **privado** `stargi-painel-financeiro-dados` (gru1), conectado só a este projeto (env `BLOB_READ_WRITE_TOKEN`, Production + Preview). Arquivos: `painel/dados.json` e `painel/historico/*.json`. Deploy: `vercel deploy --prod --yes --scope diced-inc`.
- `.gitignore` impede subir `screenshots/`, CSVs da Nuvemshop (`*.csv`), `.env*`, `.vercel` e `node_modules/`.
