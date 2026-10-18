"""Deterministic, rule-based intent parsing used when no LLM is configured (and to validate LLM output)."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from aegis.config import USDC

ALLOCATE, REDEEM, REBALANCE, STATUS, RISK, EXPLAIN = "ALLOCATE", "REDEEM", "REBALANCE", "STATUS", "RISK", "EXPLAIN"
MANDATE, TRANSFER_OUT, CANCEL, UNKNOWN = "MANDATE", "TRANSFER_OUT", "CANCEL", "UNKNOWN"
CONFIRM, ORDERS = "CONFIRM", "ORDERS"
KINDS = {ALLOCATE, REDEEM, REBALANCE, STATUS, RISK, EXPLAIN, MANDATE, TRANSFER_OUT, CANCEL, UNKNOWN, CONFIRM, ORDERS}
ACTION_KINDS = {ALLOCATE, REDEEM, REBALANCE}
WRITE_KINDS = ACTION_KINDS | {MANDATE}
READ_ONLY_KINDS = {STATUS, RISK, EXPLAIN, ORDERS, UNKNOWN}
RULE_ONLY_KINDS = {TRANSFER_OUT, CANCEL, CONFIRM}

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
WORD_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "a": 1, "an": 1}

ADDRESS_RE = re.compile(r"0x[0-9a-fA-F]{40}")
INJECTION_PATTERNS = {
    "overrideInstructions": r"ignore (all |any )?(previous|prior|above|earlier) (instructions|rules)"
                            r"|disregard .*instructions|you are now|developer mode|jailbreak"
                            r"|abaikan (semua )?(instruksi|perintah|aturan)",
    "systemPrompt": r"system prompt|reveal .*prompt|prompt sistem",
    "secrets": r"private key|seed phrase|mnemonic|api key|kunci privat|frasa pemulihan",
    "policyChange": r"(raise|increase|remove|disable|bypass|lift) (the )?"
                    r"(auto ?cap|daily ?cap|bank ?limit|cap|limit|floor|freeze|approval|policy)"
                    r"|(change|set|replace|update|rotate) (the )?"
                    r"(authori[sz]er|owner|bank|exit key|policy|auto ?cap|daily ?cap|bank ?limit|reserve floor)"
                    r"|(naikkan|tingkatkan|hapus|matikan|nonaktifkan|lewati|ganti|ubah) "
                    r"(batas|limit|cap|autocap|kebijakan|lantai|pembekuan|persetujuan|authori[sz]er)",
    "crossClient": r"(other|another|all) (client|clients|customer|customers|safe|safes|treasur(y|ies))"
                   r"|(safe|klien|nasabah|pelanggan|treasury) (lain|orang lain)|(semua|seluruh) (safe|klien|nasabah)",
    "encodedPayload": r"[A-Za-z0-9+/]{60,}={0,2}",
}
SUSPICIOUS_FLAGS = {"overrideInstructions", "systemPrompt", "secrets", "policyChange", "crossClient", "encodedPayload",
                    "addressInMessage"}

ALLOCATE_RE = (r"\b(deposit|depositkan|deposito|invest|investasikan|allocate|alokasikan|put|park|deploy|earn|move|"
               r"setor|setorkan|tempatkan|taruh|masukkan)\b")
REDEEM_RE = (r"\b(redeem|withdraw|pull out|pull|exit|take out|get out|bring back|move back|tarik|tarikkan|cairkan|"
             r"tebus|keluarkan)\b")
REBALANCE_RE = r"\brebalanc|\bseimbangkan( ulang)?\b|\bpenyeimbangan\b"
ORDERS_RE = (r"\b(orders?|milestones?|suppliers?|escrow|committed|commitments?|tradeflow|pesanan|pemasok|tahap|"
             r"komitmen|dikomit\w*)\b")
EXPLAIN_RE = r"\b(why|explain|reason|kenapa|mengapa|jelaskan|terangkan|alasan)\b"
RISK_RE = r"\b(risk|risiko|depeg|peg|liquidity|likuiditas|quarantin|karantina|oracle|stale|triggers?)\b"
STATUS_RE = (r"\b(balance|status|how much|overview|position|treasury|reserve|obligations?|deployable|surplus|yield|"
             r"saldo|posisi|ringkasan|cadangan|kewajiban|berapa)\b")

# Mood decides whether a message is an instruction. Hypothetical markers win over everything else, so "what if I
# deposit 1,000" stays a question even though it contains an action verb.
HYPOTHETICAL_RE = (r"\b(what if|how (much|many)|should (i|we)|would (it|that|i|we)|could (i|we)|can (i|we)|may (i|we)|"
                   r"suppos(e|ing)|hypothetical(ly)?|if (i|we) (were|was|did|do|deposit|invest|withdraw|redeem)|"
                   r"imagine|in theory|explain|tell me|show me|what happens|bagaimana jika|gimana kalau|"
                   r"kalau (saya|aku|kami)|"
                   r"jika (saya|aku|kami)|seandainya|andaikan|misalnya|apa yang terjadi|jelaskan|terangkan|apakah|"
                   r"berapa|haruskah|sebaiknya|bisakah (saya|aku|kami)|bolehkah (saya|aku|kami))\b")
POLITE_RE = (r"^((please|pls|kindly)\s+)?(can|could|would|will) you\b"
             r"|^(bisa|bisakah|dapatkah|boleh|bolehkah|mohon bantu)(\s+(kamu|anda|tolong))?\b"
             r"|^(i want to|i'd like to|i would like to|i wanna|let's|lets|let us|saya (mau|ingin)|aku (mau|ingin))\b")
QUESTION_START_RE = (r"^(how|what|why|when|which|who|whom|whose|where|is|are|am|was|were|do|does|did|should|shall|"
                     r"could|would|can|may|might|will|have|has|had|apa|apakah|kenapa|mengapa|bagaimana|gimana|kapan|"
                     r"siapa|mana|manakah|seberapa)\b")
READ_LEAD_RE = r"^(show|list|display|tell|give me|check|view|see|lihat|tampilkan|tunjukkan|cek|periksa|status)\b"
CONFIRM_RE = (r"(yes|y|yeah|yep|yup|ok|okay|confirm|confirmed|i confirm|go ahead|proceed|do it|ya|iya|oke|konfirmasi|"
              r"lanjut|lanjutkan|setuju|jalankan)( please| ya| deh| saja| aja)?[.! ]*")
NEGATIVE_RE = (r"(no|nope|nah|tidak|tidak jadi|gak jadi|nggak jadi|ga jadi|gak|nggak|enggak|jangan|forget it|lupakan)"
               r"( thanks| thank you| deh| saja| aja)?[.! ]*")
CANCEL_RE = r"^(cancel|stop|abort|never ?mind|batal|batalkan|hentikan)\b"
# A protective clause next to an allocation ("put idle cash to work, keep payroll safe") constrains the allocation;
# the reserve already covers every scheduled obligation, so it is not a request to add one.
RESERVE_GUARD_RE = (r"\b(keep(s|ing)?|cover(s|ed|ing)?|protect(s|ed|ing)?|safe(ty)?|reserve|set aside|hold back|"
                    r"ring-?fence|sisihkan|cadangkan|amankan|jaga)\b")
OWE_RE = r"\b(owe|owes|owed|owing|berutang|utang)\b"
FREE_BASE_RE = (r"\b(free cash|free|deployable|surplus|idle|available|spare|kas bebas|dana bebas|bebas|tersedia|"
                r"menganggur|nganggur|lebih)\b")
AMOUNT_SUFFIX = {"k": 1000, "rb": 1000, "ribu": 1000, "thousand": 1000, "m": 10**6, "mn": 10**6, "jt": 10**6,
                 "juta": 10**6, "million": 10**6}


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
    mood: str = "statement"
    imperative: bool = False
    asked: str | None = None
    percent: str | None = None
    percent_of_free: bool = False
    ambiguous_amount: bool = False
    vault_unknown: str | None = None
    order_id: int | None = None
    milestone: int | None = None
    llm_filled: list[str] = field(default_factory=list)
    disputed: list[str] = field(default_factory=list)
    refused: str | None = None

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, d: dict) -> "Intent":
        return cls(**d)

    @property
    def may_execute_unsigned(self) -> bool:
        """T1 and T2 run without a human signature, so they need the owner's own action wording (or a confirmation
        of a pending proposal) and no parameter filled in by the model."""
        return self.imperative and not self.llm_filled and self.kind in ACTION_KINDS


def _strip_dates(text: str) -> str:
    text = re.sub(r"\b\d{4}-\d{2}-\d{2}\b", " ", text)
    text = re.sub(r"\b\d{1,2}(st|nd|rd|th)\b", " ", text)
    text = re.sub(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b", " ", text)
    text = re.sub(r"\b\d{1,2}\s+(of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b", " ", text)
    text = ADDRESS_RE.sub(" ", text)
    return text


def _number(tok: str) -> Decimal | None:
    """One numeric token in English (1,000.50) or Indonesian (1.000,50) grouping. None means malformed."""
    if re.fullmatch(r"\d+", tok):
        return Decimal(tok)
    if re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d+)?", tok):
        return Decimal(tok.replace(",", ""))
    if re.fullmatch(r"\d{1,3}(\.\d{3})+(,\d+)?", tok):
        return Decimal(tok.replace(".", "").replace(",", "."))
    if re.fullmatch(r"\d+\.\d+", tok):
        return Decimal(tok)
    if re.fullmatch(r"\d+,\d{1,2}", tok):
        return Decimal(tok.replace(",", "."))
    return None


@dataclass
class AmountScan:
    amount: int | None = None
    ambiguous: bool = False
    percent: Decimal | None = None


SKIP_BEFORE_RE = re.compile(r"(vault|order|pesanan|milestone|tahap|tier|#|no\.?|nomor)\s*$")
SKIP_AFTER_RE = re.compile(r"\s*(months?|days?|weeks?|years?|hours?|minutes?|x\b|times|bulan|hari|minggu|tahun|jam|"
                           r"menit|kali)\b")
PERCENT_AFTER_RE = re.compile(r"\s*(%|percent\b|per cent\b|persen\b)")
SUFFIX_RE = re.compile(r"\s*(k|rb|ribu|thousand|mn|m|jt|juta|million)\b")
UNIT_RE = re.compile(r"\s*(usdc|usd|dollars?|dolar|bucks)\b")
RUPIAH_BEFORE_RE = re.compile(r"\b(rp|idr)\.?\s*$")
RUPIAH_AFTER_RE = re.compile(r"\s*(rupiah|idr)\b")


def scan_amount(text: str) -> AmountScan:
    t = _strip_dates(text.lower())
    out = AmountScan()
    explicit: list[int] = []
    bare: list[int] = []
    for m in re.finditer(r"(?<![\w])\d[\d.,]*", t):
        tok = m.group(0).rstrip(".,")
        end = m.start() + len(tok)
        before, after = t[max(0, m.start() - 12):m.start()], t[end:end + 14]
        if SKIP_BEFORE_RE.search(before) or SKIP_AFTER_RE.match(after):
            continue
        value = _number(tok)
        if value is None:
            out.ambiguous = True
            continue
        pm = PERCENT_AFTER_RE.match(after)
        if pm:
            if out.percent is None:
                out.percent = value
            else:
                out.ambiguous = True
            continue
        if RUPIAH_BEFORE_RE.search(before) or RUPIAH_AFTER_RE.match(after):
            out.ambiguous = True
            continue
        cur = before.rstrip().endswith(("$", "usdc", "usd"))
        sm = SUFFIX_RE.match(after)
        if sm:
            value *= AMOUNT_SUFFIX[sm.group(1)]
        rest = after[sm.end():] if sm else after
        unit = bool(UNIT_RE.match(rest))
        raw = int(value * USDC)
        if raw <= 0:
            out.ambiguous = True
            continue
        if cur or unit or sm:
            explicit.append(raw)
        elif value < 10:
            # A bare single digit is more often a count or an index than an amount; ask instead of guessing.
            out.ambiguous = True
        else:
            bare.append(raw)
    chosen = explicit or bare
    if len(set(chosen)) > 1:
        out.ambiguous = True
    elif chosen:
        out.amount = chosen[0]
    return out


def parse_amount(text: str) -> int | None:
    return scan_amount(text).amount


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
    m = re.search(r"\b(?:on |this |next )?(" + "|".join(WEEKDAYS) + r")\b", t)
    if m:
        ahead = (WEEKDAYS.index(m[1]) - base.weekday()) % 7 or 7
        d = base + timedelta(days=ahead)
        return int(datetime(d.year, d.month, d.day, tzinfo=UTC).timestamp())
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


def unknown_vault(text: str, labels: list[str]) -> str | None:
    """A vault the message names that is not one of the approved vaults, for example "vault C"."""
    if parse_vault(text, labels):
        return None
    m = re.search(r"\bvault\s+([a-z]|\d{1,2})\b", text.lower())
    return f"Vault {m[1].upper()}" if m else None


def flags_for(text: str) -> list[str]:
    t = text.lower()
    out = [name for name, pat in INJECTION_PATTERNS.items() if re.search(pat, t)]
    if ADDRESS_RE.search(text):
        out.append("addressInMessage")
    return out


def mood_of(t: str) -> str:
    """question (read-only), polite (an action request that still needs a confirmation), or imperative."""
    if re.search(HYPOTHETICAL_RE, t):
        return "question"
    if re.search(POLITE_RE, t):
        return "polite"
    if re.search(QUESTION_START_RE, t) or t.rstrip().endswith("?") or re.search(READ_LEAD_RE, t):
        return "question"
    return "imperative"


def read_only_kind(t: str) -> str:
    if re.search(ORDERS_RE, t):
        return ORDERS
    if re.search(EXPLAIN_RE, t):
        return EXPLAIN
    if re.search(RISK_RE, t):
        return RISK
    if re.search(STATUS_RE, t):
        return STATUS
    return UNKNOWN


def _action_kind(t: str) -> str | None:
    if re.search(REDEEM_RE, t):
        return REDEEM
    if re.search(REBALANCE_RE, t):
        return REBALANCE
    if re.search(ALLOCATE_RE, t):
        return ALLOCATE
    return None


def parse(text: str, now: int, vault_labels: list[str]) -> Intent:
    t = text.lower().strip()
    intent = Intent(UNKNOWN, text[:2000])
    intent.addresses = ADDRESS_RE.findall(text)
    intent.flags = flags_for(text)
    scan = scan_amount(text)
    intent.amount = scan.amount
    intent.ambiguous_amount = scan.ambiguous
    if scan.percent is not None:
        intent.percent = str(scan.percent)
        intent.percent_of_free = bool(re.search(FREE_BASE_RE, t))
    intent.vault_hint = parse_vault(text, vault_labels)
    intent.vault_unknown = unknown_vault(text, vault_labels)
    intent.due = parse_due(text, now)
    intent.vague_amount = bool(re.search(r"\b(some|a bit|a little|part of|a portion|a few|a chunk|sebagian|sedikit)\b",
                                         t))
    m = re.search(r"\b(\d+|one|two|three|four|five|six)\s+months?\b", t)
    if m:
        intent.months = int(m[1]) if m[1].isdigit() else WORD_NUM[m[1]]
    m = re.search(r"\b(?:order|pesanan)\s*(?:#|no\.?|nomor)?\s*(\d+)\b", t)
    if m:
        intent.order_id = int(m[1])
    m = re.search(r"\b(?:milestone|tahap)\s*#?\s*([1-3])\b", t)
    if m:
        intent.milestone = int(m[1]) - 1
    intent.mood = mood_of(t)

    mandate_object = re.search(r"\b(payroll|salary|salaries|wages|invoice|rent|bills?|obligation|supplier|tax|loan|"
                               r"gaji|sewa|tagihan|pajak|pinjaman)\b", t)
    mandate_verb = re.search(r"\b(keep|reserve|set aside|cover|hold back|ring-?fence|save for|add|schedule|due|"
                             r"sisihkan|cadangkan|siapkan|jatuh tempo)\b", t) or re.search(OWE_RE, t)
    if mandate_object and mandate_verb and _reserve_constraint(t, intent):
        mandate_verb = None
    to_vault = re.search(r"\b(to|ke) (vault|the vault|treasury|the treasury|safe|the safe)\b", t)

    if re.match(CANCEL_RE, t) or re.fullmatch(NEGATIVE_RE, t):
        intent.kind = CANCEL
    elif re.fullmatch(CONFIRM_RE, t):
        intent.kind = CONFIRM
    elif (re.search(r"\b(send|transfer|wire|pay out|payout|pay|kirim|kirimkan|bayar|bayarkan)\b", t) and not to_vault
          and not (mandate_object and mandate_verb and not intent.addresses)) or (
            intent.addresses and re.search(r"\b(send|transfer|move|withdraw|pay|wire|drain|kirim|tarik|keluarkan|"
                                           r"pindahkan)\b", t)):
        intent.kind = TRANSFER_OUT
    elif mandate_object and mandate_verb:
        intent.kind = MANDATE
        intent.label = mandate_object[1].capitalize()
    else:
        intent.kind = _action_kind(t) or read_only_kind(t)
    if intent.kind in WRITE_KINDS:
        if intent.mood == "question":
            intent.asked = intent.kind
            intent.kind = read_only_kind(t)
        else:
            intent.imperative = intent.mood == "imperative"
    intent.missing = missing_fields(intent)
    return intent


def _reserve_constraint(t: str, intent: Intent) -> bool:
    """An allocation request whose obligation words only guard the reserve: no due date, nothing owed, and any
    amount stated before the guard, so it belongs to the allocation ("deposit 2,000 and keep payroll safe"), not to
    a new obligation ("reserve 3,000 for rent and invest the rest")."""
    guard = re.search(RESERVE_GUARD_RE, t)
    if not guard or not re.search(ALLOCATE_RE, t) or intent.due is not None or re.search(OWE_RE, t):
        return False
    digit = re.search(r"\d", t)
    return digit is None or digit.start() < guard.start()


def missing_fields(intent: Intent) -> list[str]:
    missing = []
    if intent.kind == MANDATE:
        if intent.amount is None:
            missing.append("amount")
        if intent.due is None:
            missing.append("dueDate")
    elif intent.kind in (ALLOCATE, REDEEM):
        if intent.percent is not None:
            if not (intent.kind == ALLOCATE and intent.percent_of_free and 0 < Decimal(intent.percent) <= 100):
                missing.append("amount")
        elif intent.amount is None and (intent.vague_amount or intent.ambiguous_amount):
            missing.append("amount")
        if intent.vault_unknown:
            missing.append("vault")
    if intent.disputed and intent.kind in WRITE_KINDS:
        missing.append("confirmIntent")
    if intent.refused:
        return []
    return missing


def merge_answer(intent: Intent, answer: str, now: int, vault_labels: list[str]) -> Intent:
    """Fold a clarification answer into the pending intent without changing its kind. The owner's newest words win
    over earlier values, and a model disagreement is settled by the answer itself."""
    extra = parse(answer, now, vault_labels)
    if extra.amount is not None:
        intent.amount = extra.amount
        intent.vague_amount = intent.ambiguous_amount = False
        intent.percent = None
    elif extra.percent is not None:
        intent.percent, intent.percent_of_free = extra.percent, extra.percent_of_free
        intent.ambiguous_amount = False
    elif extra.ambiguous_amount:
        intent.ambiguous_amount = True
    if extra.due is not None:
        intent.due = extra.due
    if extra.vault_hint:
        intent.vault_hint = extra.vault_hint
        intent.vault_unknown = None
    elif extra.vault_unknown:
        intent.vault_unknown = extra.vault_unknown
    intent.disputed = []
    intent.imperative = extra.kind == intent.kind and extra.imperative
    intent.flags = sorted(set(intent.flags) | set(extra.flags))
    intent.addresses = sorted(set(intent.addresses) | set(extra.addresses))
    intent.text = (intent.text + " | " + answer)[:4000]
    intent.missing = missing_fields(intent)
    return intent


def answers(pending: Intent, message: str, now: int, vault_labels: list[str]) -> bool:
    """Whether a new message plausibly answers the pending clarification. Anything else starts a new request."""
    a = parse(message, now, vault_labels)
    if a.kind in (CANCEL, TRANSFER_OUT) or a.mood == "question" or a.asked:
        return False
    if a.kind == CONFIRM:
        return "confirmIntent" in pending.missing
    if a.kind in WRITE_KINDS:
        return a.kind == pending.kind
    if a.kind != UNKNOWN:
        return False
    wanted = set(pending.missing)
    return bool(("amount" in wanted or "confirmIntent" in wanted) and (a.amount is not None or a.percent is not None
                                                                      or a.ambiguous_amount)
                or ("dueDate" in wanted and a.due is not None)
                or (("vault" in wanted or "confirmIntent" in wanted) and (a.vault_hint or a.vault_unknown)))


def reconcile(rule: Intent, data: dict, now: int, vault_labels: list[str]) -> Intent:
    """Combine the rule parse with the model's classification. The rules decide whether the message is an action;
    the model may fill parameters the owner left out, never change what the owner stated."""
    out = Intent.from_json(rule.to_json())
    llm_kind = data.get("kind") if data.get("kind") in KINDS else None
    if rule.kind not in WRITE_KINDS:
        if llm_kind in WRITE_KINDS or llm_kind in RULE_ONLY_KINDS:
            out.flags = sorted(set(out.flags) | {"llmUpgradeRefused"})
        elif llm_kind in READ_ONLY_KINDS and rule.kind == UNKNOWN:
            out.kind = llm_kind
        out.missing = missing_fields(out)
        return out
    disputed = []
    if llm_kind is not None and llm_kind != rule.kind:
        disputed.append("kind")
    try:
        llm_amount = parse_amount(f"{data['amount_usdc']} usdc") if data.get("amount_usdc") else None
    except (TypeError, ValueError):
        llm_amount = None
    if llm_amount is not None and rule.percent is None:
        if rule.amount is not None:
            if llm_amount != rule.amount:
                disputed.append("amount")
        elif not (rule.vague_amount or rule.ambiguous_amount):
            out.amount = llm_amount
            out.llm_filled.append("amount")
    llm_vault = data.get("vault") if data.get("vault") in vault_labels else None
    if llm_vault:
        if rule.vault_hint:
            if llm_vault != rule.vault_hint:
                disputed.append("vault")
        elif not rule.vault_unknown:
            out.vault_hint = llm_vault
            out.llm_filled.append("vault")
    if out.due is None and data.get("due_date"):
        out.due = parse_due(str(data["due_date"]), now)
        if out.due is not None:
            out.llm_filled.append("dueDate")
    if not out.label and data.get("label"):
        out.label = str(data["label"])[:60]
    if out.months is None and isinstance(data.get("months"), int) and 0 < data["months"] <= 24:
        out.months = data["months"]
    if disputed:
        out.disputed = disputed
        out.flags = sorted(set(out.flags) | {"llmDisagreed"})
    out.missing = missing_fields(out)
    return out


def guard(intent: Intent) -> Intent:
    """A write request that also carries injection markers is refused as a whole instead of half-executed."""
    if intent.kind in WRITE_KINDS and SUSPICIOUS_FLAGS & set(intent.flags):
        intent.refused = "SuspiciousRequest"
        intent.missing = []
    return intent
