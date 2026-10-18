"""Bake real Base Sepolia tx data for the film (read-only RPC, no transactions sent)."""
import json
import pathlib
import subprocess
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = pathlib.Path(__file__).resolve().parents[1] / "data" / "chain.json"
RPC = "https://base-sepolia-rpc.publicnode.com"

CARDS = [
    ("E4a", "BadSignature", "Amount edited after signing"),
    ("E4b", "NonceUsed", "Signed decision replayed"),
    ("E4d", "PriceOutOfBand", "Price moved after signing"),
    ("E5", "Frozen", "Bank froze the agent"),
]


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, body, {"Content-Type": "application/json", "User-Agent": "porthmos-film"})
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.load(r)
    if "error" in res:
        raise RuntimeError(res["error"])
    return res["result"]


def replay_revert(txo, block_hex):
    parent = hex(int(block_hex, 16) - 1)
    call = {k: txo[k] for k in ("from", "to", "input", "value", "gas") if txo.get(k)}
    call["data"] = call.pop("input")
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [call, parent]}).encode()
    req = urllib.request.Request(RPC, body, {"Content-Type": "application/json", "User-Agent": "porthmos-film"})
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.load(r)
    err = res.get("error") or {}
    data = err.get("data")
    if isinstance(data, dict):
        data = data.get("data")
    return data


def exit_tx(ev):
    scen = {s["id"]: s for s in ev["scenarios"]}
    tx = next(t for t in scen["E5"]["transactions"] if "exit" in t["label"])
    receipt = rpc("eth_getTransactionReceipt", [tx["hash"]])
    h = tx["hash"]
    return {"hash": h, "hashShort": h[:10] + "\u2026" + h[-6:], "block": int(receipt["blockNumber"], 16),
            "status": "Success" if int(receipt["status"], 16) == 1 else "Fail", "label": tx["label"],
            "explorer": "https://sepolia.basescan.org/tx/" + h}


TRADEFLOW = [
    ("E6a", "Order funded", "1,000 USDC as 200 / 400 / 400"),
    ("E6b", "Milestone 1 released", "Carrier proof verified"),
    ("E6c", "Milestone 2 held", "Sensor max 9.40 \u00b0C, condition 2.00 to 8.00 \u00b0C"),
    ("E6d", "Milestone 2 waived", "Owner waived after a survey"),
    ("E6e", "Milestone 3 released", "Surveyor proof verified, order completed"),
]


def tradeflow_txs(ev):
    scen = {s["id"]: s for s in ev["scenarios"]}
    out = []
    for sid, title, human in TRADEFLOW:
        tx = scen[sid]["transactions"][-1]
        h = tx["hash"]
        receipt = rpc("eth_getTransactionReceipt", [h])
        out.append({"scenario": sid, "title": title, "human": human, "hash": h,
                    "hashShort": h[:10] + "\u2026" + h[-6:], "block": int(receipt["blockNumber"], 16),
                    "status": "Success" if int(receipt["status"], 16) == 1 else "Fail",
                    "decodedError": tx.get("decodedError"), "label": tx["label"],
                    "explorer": "https://sepolia.basescan.org/tx/" + h})
    return out


FILM_TXS = {
    "r2Executed": ("0x6e3c317235592eaf320fa390f81920d386688ada61bdfdc25f5e7db168ceab16", "Deposit 1,000 USDC into Vault B (tier 2)"),
    "t3Executed": ("0xf0b198f4a5b86459ed021dffcaab2acbc810bb513be85cb1908aed9238b03c40", "Deposit 1,000 USDC into Vault A (tier 3, owner signed)"),
    "bankFreeze": ("0x7d498afeee82bca1caebf8164397dc3975d2cca8a9775620e57f788f5d110fac", "Bank freezes the agent"),
    "exitWhileFrozen": ("0x7ce18a61c0c007f34fd0a0ff92f8c7f923d4d26d6a2dc496f7dd4175651bc59e", "Redeem 4,000.00 USDC from Vault B while frozen"),
}


def film_txs():
    out = {}
    for key, (h, label) in FILM_TXS.items():
        receipt = rpc("eth_getTransactionReceipt", [h])
        out[key] = {"hash": h, "hashShort": h[:10] + "\u2026" + h[-6:], "block": int(receipt["blockNumber"], 16),
                    "status": "Success" if int(receipt["status"], 16) == 1 else "Fail", "label": label,
                    "explorer": "https://sepolia.basescan.org/tx/" + h}
    return out


def main():
    ev = json.loads((ROOT / "deployments" / "evidence-84532.json").read_text())
    scen = {s["id"]: s for s in ev["scenarios"]}
    cards = []
    for sid, err, human in CARDS:
        txs = scen[sid]["transactions"]
        tx = next(t for t in txs if t.get("receiptStatus") == 0)
        h = tx["hash"]
        receipt = rpc("eth_getTransactionReceipt", [h])
        txo = rpc("eth_getTransactionByHash", [h])
        block = rpc("eth_getBlockByNumber", [receipt["blockNumber"], False])
        status = int(receipt["status"], 16)
        selector = subprocess.run(["cast", "sig", err + "()"], capture_output=True, text=True, check=True).stdout.strip()
        revert = replay_revert(txo, receipt["blockNumber"])
        cards.append({
            "scenario": sid,
            "hash": h,
            "hashShort": h[:10] + "…" + h[-6:],
            "block": int(receipt["blockNumber"], 16),
            "timestamp": int(block["timestamp"], 16),
            "status": "Fail" if status == 0 else "Success",
            "statusCode": status,
            "gasUsed": int(receipt["gasUsed"], 16),
            "from": txo["from"],
            "to": txo["to"],
            "error": err,
            "evidenceError": tx.get("decodedError"),
            "errorSelector": selector,
            "replayRevertData": revert,
            "replayMatches": bool(revert) and revert.lower().startswith(selector.lower()),
            "human": human,
            "label": tx.get("label"),
            "explorer": "https://sepolia.basescan.org/tx/" + h,
        })
    OUT.parent.mkdir(parents=True, exist_ok=True)
    data = {"network": "Base Sepolia", "chainId": 84532, "rpc": RPC, "cards": cards, "exit": exit_tx(ev), "tradeflow": tradeflow_txs(ev), "film": film_txs()}
    OUT.write_text(json.dumps(data, indent=2) + "\n")
    OUT.with_suffix(".js").write_text("window.PORTHMOS_CHAIN = " + json.dumps(data, indent=2) + ";\n")
    print(json.dumps(cards, indent=2))


if __name__ == "__main__":
    main()
