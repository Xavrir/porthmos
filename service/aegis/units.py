from __future__ import annotations

from decimal import ROUND_DOWN, Decimal

from aegis.config import PRICE_ONE, USDC


def amount(raw: int) -> dict:
    raw = int(raw)
    value = (Decimal(raw) / Decimal(USDC)).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    return {"raw": str(raw), "display": f"{value:,.2f}"}


def display_usdc(raw: int) -> str:
    return amount(raw)["display"]


def price(raw: int) -> dict:
    raw = int(raw)
    value = Decimal(raw) / Decimal(PRICE_ONE)
    return {"raw": str(raw), "display": f"{value:.4f}"}


def parse_raw(value) -> int:
    """Accept a raw integer, a decimal string of raw units, or an {raw, display} object."""
    if isinstance(value, dict):
        value = value.get("raw")
    if isinstance(value, bool) or value is None:
        raise ValueError("amount missing")
    if isinstance(value, int):
        result = value
    elif isinstance(value, str) and value.strip().isdigit():
        result = int(value.strip())
    else:
        raise ValueError("amount must be raw integer units")
    if result <= 0:
        raise ValueError("amount must be positive")
    return result


def usdc_to_raw(text: str) -> int:
    return int((Decimal(text) * USDC).to_integral_value(rounding=ROUND_DOWN))
