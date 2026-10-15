"""Deterministic, rule-based intent parsing used when no LLM is configured (and to validate LLM output)."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation

from aegis.config import USDC

ALLOCATE, REDEEM, REBALANCE, STATUS, RISK, EXPLAIN = "ALLOCATE", "REDEEM", "REBALANCE", "STATUS", "RISK", "EXPLAIN"
MANDATE, TRANSFER_OUT, CANCEL, UNKNOWN = "MANDATE", "TRANSFER_OUT", "CANCEL", "UNKNOWN"
KINDS = {ALLOCATE, REDEEM, REBALANCE, STATUS, RISK, EXPLAIN, MANDATE, TRANSFER_OUT, CANCEL, UNKNOWN}
ACTION_KINDS = {ALLOCATE, REDEEM, REBALANCE}

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}
WORD_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "a": 1, "an": 1}

ADDRESS_RE = re.compile(r"0x[0-9a-fA-F]{40}")
INJECTION_PATTERNS = {
    "overrideInstructions": r"ignore (all |any )?(previous|prior|above|earlier) (instructions|rules)|disregard .*instructions|you are now|developer mode|jailbreak",
    "systemPrompt": r"system prompt|reveal .*prompt",
    "secrets": r"private key|seed phrase|mnemonic|api key",
    "policyChange": r"(raise|increase|remove|disable|bypass|lift) (the )?(cap|limit|floor|freeze|approval|policy)",
    "crossClient": r"(other|another|all) (client|clients|customer|customers|safe|safes|treasur(y|ies))",
    "encodedPayload": r"[A-Za-z0-9+/]{60,}={0,2}",
}


@dataclass
class Intent:
    kind: str
    text: str
    amount: int | None = None
    vault_hint: str | None = None
    due: int | None = None
    label: str | None = None
    months: int | None = None
    vague_amount: bool = False
    addresses: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, d: dict) -> "Intent":
        return cls(**d)


def _strip_dates(text: str) -> str:
    text = re.sub(r"\b\d{4}-\d{2}-\d{2}\b", " ", text)
    text = re.sub(r"\b\d{1,2}(st|nd|rd|th)\b", " ", text)
    text = re.sub(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b", " ", text)
    text = re.sub(r"\b\d{1,2}\s+(of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b", " ", text)
    text = ADDRESS_RE.sub(" ", text)
    return text


def parse_amount(text: str) -> int | None:
    t = _strip_dates(text.lower())
    pattern = re.compile(
        r"(?P<cur>\$|usdc\s|usd\s)?\s*(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*"
        r"(?P<suf>k\b|m\b|thousand\b|million\b)?\s*(?P<unit>usdc|usd|dollars|bucks)?")
    best = None
    for m in pattern.finditer(t):
        tail = t[m.end():m.end() + 12]
        if re.match(r"\s*(months?|days?|weeks?|years?|%|percent|x\b|times)", tail):
            continue
        if re.search(r"vault\s*$", t[max(0, m.start() - 7):m.start()]):
            continue
        try:
            value = Decimal(m.group("num").replace(",", ""))
        except InvalidOperation:
            continue
        suf = m.group("suf")
        if suf in ("k", "thousand"):
            value *= 1000
        elif suf in ("m", "million"):
            value *= 1_000_000
        explicit = bool(m.group("cur") or m.group("unit") or suf)
        if not explicit and value < 10:
            continue
        raw = int(value * USDC)
        if raw <= 0:
            continue
        if best is None or explicit:
            best = raw
            if explicit:
                break
    return best


def parse_due(text: str, now: int) -> int | None:
    t = text.lower()
    base = datetime.fromtimestamp(now, UTC)
    m = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", t)
    if m:
        try:
            return int(datetime(int(m[1]), int(m[2]), int(m[3]), tzinfo=UTC).timestamp())
        except ValueError:
            return None
    m = re.search(r"\bin (\d+|one|two|three|four|five|six|a) (day|days|week|weeks)\b", t)
    if m:
        n = int(m[1]) if m[1].isdigit() else WORD_NUM[m[1]]
        return int((base + timedelta(days=n * (7 if m[2].startswith("week") else 1))).timestamp())
    if re.search(r"\btomorrow\b", t):
        return int((base + timedelta(days=1)).timestamp())
    if re.search(r"\bnext week\b", t):
        return int((base + timedelta(days=7)).timestamp())
    m = (re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b", t)
         or None)
    day = month = None
    if m:
        month, day = MONTHS[m[1][:3]], int(m[2])
    else:
        m = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b", t)
        if m:
            day, month = int(m[1]), MONTHS[m[2][:3]]
    if month:
        year = base.year
        try:
            d = datetime(year, month, day, tzinfo=UTC)
            if d < base - timedelta(days=1):
                d = datetime(year + 1, month, day, tzinfo=UTC)
            return int(d.timestamp())
        except ValueError:
            return None
    m = re.search(r"\b(?:on )?the (\d{1,2})(st|nd|rd|th)\b", t)
    if m:
        day = int(m[1])
        y, mo = base.year, base.month
        for _ in range(2):
            try:
                d = datetime(y, mo, day, tzinfo=UTC)
            except ValueError:
                d = None
            if d and d >= base:
                return int(d.timestamp())
            y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
    if re.search(r"\bend of (the )?month\b", t):
        first_next = datetime(base.year + (base.month == 12), base.month % 12 + 1, 1, tzinfo=UTC)
        return int((first_next - timedelta(days=1)).timestamp())
    return None


def parse_vault(text: str, labels: list[str]) -> str | None:
    t = text.lower()
    for label in labels:
        if label.lower() in t:
            return label
    m = re.search(r"\bvault\s*([a-d1-4])\b", t)
    if m:
        letter = m[1] if m[1].isalpha() else "abcd"[int(m[1]) - 1]
        for label in labels:
            if label.lower().endswith(" " + letter):
                return label
    return None


def flags_for(text: str) -> list[str]:
    t = text.lower()
    out = [name for name, pat in INJECTION_PATTERNS.items() if re.search(pat, t)]
    if ADDRESS_RE.search(text):
        out.append("addressInMessage")
    return out


def parse(text: str, now: int, vault_labels: list[str]) -> Intent:
    t = text.lower().strip()
    intent = Intent(UNKNOWN, text[:2000])
    intent.addresses = ADDRESS_RE.findall(text)
    intent.flags = flags_for(text)
    intent.amount = parse_amount(text)
    intent.vault_hint = parse_vault(text, vault_labels)
    intent.due = parse_due(text, now)
    intent.vague_amount = bool(re.search(r"\b(some|a bit|a little|part of|a portion|a few|a chunk)\b", t))
    m = re.search(r"\b(\d+|one|two|three|four|five|six)\s+months?\b", t)
    if m:
        intent.months = int(m[1]) if m[1].isdigit() else WORD_NUM[m[1]]

    mandate_object = re.search(r"\b(payroll|salary|salaries|wages|invoice|rent|bills?|obligation|supplier|tax|loan)\b", t)
    mandate_verb = re.search(r"\b(keep|reserve|set aside|cover|hold back|ring-?fence|save for|add|schedule|due)\b", t)
    to_vault = re.search(r"\bto (vault|the vault|treasury|the treasury|safe|the safe)\b", t)

    if re.match(r"^(cancel|stop|abort|never ?mind)\b", t):
        intent.kind = CANCEL
    elif (re.search(r"\b(send|transfer|wire|pay out|payout|pay)\b", t) and not to_vault
          and not (mandate_object and mandate_verb and not intent.addresses)) or (
            intent.addresses and re.search(r"\b(send|transfer|move|withdraw|pay|wire|drain)\b", t)):
        intent.kind = TRANSFER_OUT
    elif mandate_object and mandate_verb:
        intent.kind = MANDATE
        intent.label = mandate_object[1].capitalize()
    elif re.search(r"\b(redeem|withdraw|pull out|pull|exit|take out|get out|bring back|move back)\b", t):
        intent.kind = REDEEM
    elif re.search(r"\brebalanc", t):
        intent.kind = REBALANCE
    elif re.search(r"\b(deposit|invest|allocate|put|park|deploy|earn|yield|surplus|idle|move|term deposits?)\b", t):
        intent.kind = ALLOCATE
    elif re.search(r"\b(why|explain|reason)\b", t):
        intent.kind = EXPLAIN
    elif re.search(r"\b(risk|depeg|peg|liquidity|quarantin|oracle|stale)\b", t):
        intent.kind = RISK
    elif re.search(r"\b(balance|status|how much|overview|position|treasury|reserve|obligations?)\b", t):
        intent.kind = STATUS
    intent.missing = missing_fields(intent)
    return intent


def missing_fields(intent: Intent) -> list[str]:
    missing = []
    if intent.kind == MANDATE:
        if intent.amount is None:
            missing.append("amount")
        if intent.due is None:
            missing.append("dueDate")
    elif intent.kind in (ALLOCATE, REDEEM) and intent.amount is None and intent.vague_amount:
        missing.append("amount")
    return missing


def merge_answer(intent: Intent, answer: str, now: int, vault_labels: list[str]) -> Intent:
    """Fold a clarification answer into the pending intent without changing its kind."""
    extra = parse(answer, now, vault_labels)
    if intent.amount is None and extra.amount is not None:
        intent.amount = extra.amount
    if intent.due is None and extra.due is not None:
        intent.due = extra.due
    if intent.vault_hint is None and extra.vault_hint:
        intent.vault_hint = extra.vault_hint
    if extra.amount is not None:
        intent.vague_amount = False
    intent.flags = sorted(set(intent.flags) | set(extra.flags))
    intent.addresses = sorted(set(intent.addresses) | set(extra.addresses))
    intent.text = (intent.text + " | " + answer)[:4000]
    intent.missing = missing_fields(intent)
    return intent
