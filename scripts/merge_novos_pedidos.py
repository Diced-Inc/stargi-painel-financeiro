#!/usr/bin/env python3
"""Merge novos pedidos into data/vendas.json without duplicating by numero."""
import json, sys
from pathlib import Path
from datetime import datetime
import re

painel = Path(__file__).resolve().parents[1]
vendas_path = painel / "data" / "vendas.json"
novos_path = Path(sys.argv[1]) if len(sys.argv) > 1 else painel / "screenshots" / "novos-pedidos-2026-10-19.json"

vendas = json.loads(vendas_path.read_text(encoding="utf-8"))
novos = json.loads(novos_path.read_text(encoding="utf-8"))
# data da leitura (DD/MM/AAAA) tirada do nome do arquivo novos-pedidos-AAAA-MM-DD*.json
_m = re.search(r"(\d{4})-(\d{2})-(\d{2})", novos_path.name)
data_leitura = f"{_m.group(3)}/{_m.group(2)}/{_m.group(1)}" if _m else datetime.now().strftime("%d/%m/%Y")
if isinstance(novos, dict):
    novos = novos.get("pedidos") or novos.get("orders") or []
existing = {p["numero"] for p in vendas["pedidos"]}
added = []
for p in novos:
    n = p.get("numero")
    if n is None:
        raise SystemExit(f"pedido sem numero: {p}")
    if n in existing:
        print(f"skip duplicate #{n}")
        continue
    # defaults
    p.setdefault("taxasFonte", "nuvemshop" if p.get("taxas") is not None else "a confirmar")
    p.setdefault("estorno", None)
    p.setdefault("caixas", None)
    p.setdefault("verificadoNoPainel", True)
    if "observacao" not in p:
        p["observacao"] = f"Conferido no painel da Nuvemshop em {data_leitura} (atualização semanal)."
    vendas["pedidos"].append(p)
    existing.add(n)
    added.append(n)

vendas["pedidos"].sort(key=lambda x: (x.get("data") or "", x.get("numero") or 0), reverse=True)
vendas["atualizadoEm"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
vendas["fonte"] = (vendas.get("fonte") or "") + f" + leitura semanal do admin Nuvemshop ({data_leitura})"
vendas_path.write_text(json.dumps(vendas, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(f"added {len(added)}: {added}")
print(f"total pedidos: {len(vendas['pedidos'])}")
