#!/usr/bin/env python3
"""Importa a exportação de pedidos da Nuvemshop (CSV) para data/vendas.json.

Uso:
    python3 scripts/import_nuvemshop_csv.py CAMINHO/Vendas-xxxx.csv [--saida data/vendas.json]

- Lê o CSV (separador ';', encoding latin-1 ou utf-8, detectado automaticamente).
- Agrupa as linhas de itens por número do pedido.
- NÃO copia dados pessoais (nome, e-mail, CPF, telefone, endereço, anotações,
  dados do cartão, código de rastreio).
- Deduplica pelo número do pedido: se o pedido já existe em vendas.json, os campos
  vindos da Nuvemshop são atualizados e os campos manuais (custoEtiqueta, caixas,
  observacao, verificadoNoPainel) são preservados. Pedidos que só existem no JSON
  (lançados à mão) são mantidos.
- Pedidos cancelados ficam na lista com "cancelado": true (o painel não soma).
- Se o CSV não trouxer taxas, elas são estimadas pelas regras do data/config.json
  e marcadas com "taxasFonte": "estimado".
"""
import argparse, csv, json, os, sys, unicodedata
from datetime import datetime

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
CAMPOS_MANUAIS = ["custoEtiqueta", "caixas", "observacao", "verificadoNoPainel"]


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return " ".join(s.lower().replace('"', "").split())


def num(s):
    s = (s or "").strip()
    if not s:
        return None
    s = s.replace("R$", "").strip()
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def ler_csv(caminho):
    bruto = open(caminho, "rb").read()
    for enc in ("utf-8-sig", "latin-1"):
        try:
            texto = bruto.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    linhas = list(csv.reader(texto.splitlines(), delimiter=";"))
    cab = [norm(c) for c in linhas[0]]
    return [dict(zip(cab, l)) for l in linhas[1:] if any(x.strip() for x in l)]


def data_iso(s):
    s = (s or "").strip()
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).isoformat()
        except ValueError:
            pass
    return None


def estimar_taxas(p, cfg):
    """Só usado quando o CSV não traz a coluna de taxas."""
    pg = cfg["pagamento"]
    meio, forma, total = norm(p["meioPagamento"]), norm(p["formaPagamento"]), p["total"] or 0
    if "especie" in forma or "dinheiro" in meio:
        return 0.0, "sem taxa (dinheiro)"
    if "pix" in meio:
        return round(total * pg["pix"]["taxaPercent"] / 100, 2), "estimado"
    if "cartao" in meio:
        c = pg["cartao3x"]
        perc = c["recebimentoPercent"] + (c["parcelamentoPercent"] if (p["parcelas"] or 1) > 1 else 0)
        return round(total * perc / 100 + c["taxaFixa"], 2), "estimado"
    return 0.0, "a confirmar"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("--saida", default=os.path.join(RAIZ, "data", "vendas.json"))
    ap.add_argument("--config", default=os.path.join(RAIZ, "data", "config.json"))
    a = ap.parse_args()
    cfg = json.load(open(a.config, encoding="utf-8"))

    pedidos, atual = {}, None
    for r in ler_csv(a.csv):
        n = (r.get("numero do pedido") or "").strip()
        if not n:
            continue
        if r.get("data"):  # primeira linha do pedido traz os dados gerais
            status = r.get("status do pedido", "")
            atual = {
                "numero": int(n) if n.isdigit() else n,
                "data": data_iso(r.get("data")),
                "statusPedido": status,
                "statusPagamento": r.get("status do pagamento", ""),
                "statusEnvio": r.get("status do envio", ""),
                "cancelado": "cancel" in norm(status) or bool((r.get("data e hora do cancelamento") or "").strip()),
                "canal": r.get("canal", ""),
                "formaEntrega": r.get("forma de entrega", ""),
                "formaPagamento": r.get("forma de pagamento", ""),
                "meioPagamento": r.get("meio de pagamento", ""),
                "parcelas": int(r["parcelas"]) if (r.get("parcelas") or "").strip().isdigit() else None,
                "cupom": (r.get("cupom de desconto") or "").strip() or None,
                "subtotal": num(r.get("subtotal")) or 0.0,
                "desconto": num(r.get("desconto")) or 0.0,
                "frete": num(r.get("valor do frete")) or 0.0,
                "total": num(r.get("total")) or 0.0,
                "taxas": num(r.get("taxas")),
                "juros": num(r.get("juros")) or 0.0,
                "liquido": num(r.get("total liquido")),
                "estorno": num(r.get("estorno")),
                "dataPagamento": r.get("data de pagamento") or None,
                "linkAdmin": r.get("link do pedido") or None,
                "itens": [],
            }
            if atual["taxas"] is None:
                t, fonte = estimar_taxas(atual, cfg)
                atual["taxas"], atual["taxasFonte"] = t, fonte
                atual["liquido"] = round(atual["total"] - t - atual["juros"], 2)
            else:
                atual["taxasFonte"] = "nuvemshop"
                if atual["liquido"] is None:
                    atual["liquido"] = round(atual["total"] - atual["taxas"] - atual["juros"], 2)
            pedidos[n] = atual
        alvo = pedidos.get(n)
        if alvo is None:
            continue
        alvo["itens"].append({
            "nome": (r.get("nome do produto") or "").strip(),
            "preco": num(r.get("valor do produto")) or 0.0,
            "qtd": int(num(r.get("quantidade comprada")) or 1),
            "sku": (r.get("sku") or "").strip() or None,
        })

    existente = {}
    if os.path.exists(a.saida):
        for p in json.load(open(a.saida, encoding="utf-8")).get("pedidos", []):
            existente[str(p["numero"])] = p
    novos = atualizados = 0
    for n, p in pedidos.items():
        antigo = existente.get(n)
        for c in CAMPOS_MANUAIS:
            p[c] = antigo.get(c) if antigo else None
        if antigo:
            atualizados += 1
        else:
            novos += 1
        existente[n] = p
    for p in existente.values():
        for c in CAMPOS_MANUAIS:
            p.setdefault(c, None)

    lista = sorted(existente.values(), key=lambda p: (p.get("data") or "", str(p["numero"])), reverse=True)
    saida = {
        "atualizadoEm": datetime.now().isoformat(timespec="seconds"),
        "fonte": "Exportação de pedidos da Nuvemshop (" + os.path.basename(a.csv) + ") + lançamentos manuais",
        "pedidos": lista,
    }
    os.makedirs(os.path.dirname(a.saida), exist_ok=True)
    json.dump(saida, open(a.saida, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(pedidos)} pedidos no CSV | {novos} novos | {atualizados} atualizados | {len(lista)} no total em {a.saida}")


if __name__ == "__main__":
    sys.exit(main())
