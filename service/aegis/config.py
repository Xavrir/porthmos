from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = SERVICE_DIR.parent

USDC = 10**6
PRICE_ONE = 10**8
UINT256_MAX = 2**256 - 1

ANVIL_KEYS = {
    "admin": "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "owner": "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "bank": "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    "authorizer": "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    "exitKey": "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
    "executor": "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
    "keeper": "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
    "attacker": "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
}
ANVIL_MNEMONIC = "test test test test test test test test test test test junk"
MNEMONIC_SCAN = 40
ISSUER_ROLES = ("carrier", "sensor", "surveyor")


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def _env_int(name: str, default: int) -> int:
    value = _env(name)
    return int(value) if value is not None else default


def _env_float(name: str, default: float) -> float:
    value = _env(name)
    return float(value) if value is not None else default


def _env_bool(name: str, default: bool) -> bool:
    value = _env(name)
    if value is None:
        return default
    return value.lower() in ("1", "true", "yes", "on")


@dataclass
class VaultMeta:
    address: str
    label: str
    apy: float
    cost: float


@dataclass
class Params:
    horizon_days: int = 30
    buffer_min: int = 500 * USDC
    buffer_rate_bps: int = 1000
    fee_reserve: int = 0
    per_vault_cap_bps: int = 6000
    min_trade: int = 50 * USDC
    hysteresis_bps: int = 500
    slippage_bps: int = 50
    peg_threshold: int = PRICE_ONE // 100
    liquidity_multiple_bps: int = 12000
    default_max_oracle_age: int = 180
    band_width: int = PRICE_ONE // 100
    dar_expiry: int = 120
    approval_expiry: int = 24 * 3600
    quarantine_cooldown: int = 24 * 3600
    exit_window_blocks: int = 5
    exit_fallback_blocks: int = 3
    keeper_interval: int = 60
    risk_lambda: float = 0.05
    weights: tuple[float, float, float, float] = (0.4, 0.3, 0.2, 0.1)
    max_replans: int = 3


CANONICAL_FALLBACK_HANDLER = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99"
DEFAULT_ORIGINS = "https://porthmos.vercel.app,https://aegis-treasury-eta.vercel.app,http://localhost:5173,http://localhost:4173"


@dataclass
class Addresses:
    usdc: str = "0x" + "0" * 40
    price_feed: str = "0x" + "0" * 40
    registry: str = "0x" + "0" * 40
    module: str = "0x" + "0" * 40
    safes: list[str] = field(default_factory=list)
    vaults: list[VaultMeta] = field(default_factory=list)
    roles: dict[str, str] = field(default_factory=dict)
    deploy_block: int = 0
    safe_singleton: str = ""
    safe_proxy_factory: str = ""
    fallback_handler: str = CANONICAL_FALLBACK_HANDLER
    trade_escrow: str = ""
    multi_send_call_only: str = ""
    trade_escrow_block: int = 0
    issuers: dict[str, str] = field(default_factory=dict)


@dataclass
class TenantParams:
    """Onboarding values served by GET /api/onboard/config (docs/MULTI-TENANT.md)."""

    auto_cap: int = 1_000 * USDC
    daily_cap: int = 5_000 * USDC
    bank_limit: int = 3_000 * USDC
    max_band_width: int = 2_000_000
    max_oracle_age: int = 180
    auto_cap_max: int = 10_000 * USDC
    daily_cap_max: int = 50_000 * USDC
    bank_limit_max: int = 50_000 * USDC
    max_band_width_max: int = 5_000_000
    max_oracle_age_max: int = 3600
    eth_owner: int = 50_000_000_000_000
    eth_bank: int = 20_000_000_000_000
    test_usdc: int = 100_000 * USDC


@dataclass
class Limits:
    onboard_per_ip_day: int = 3
    max_tenants: int = 300
    faucet_wei_per_day: int = 3_000_000_000_000_000
    chat_per_tenant: int = 20
    chat_window: int = 600
    llm_per_hour: int = 300
    llm_per_tenant_hour: int = 60
    attacks_per_tenant_hour: int = 6


@dataclass
class TradeFlowLimits:
    """TradeFlow abuse limits and timings (TECHNICAL-DOCUMENT 02, TradeFlow API additions)."""

    demo_proofs_per_tenant_hour: int = 12
    proofs_per_order_hour: int = 30
    rejects_per_ip_hour: int = 30
    max_active_orders: int = 5
    max_document_bytes: int = 1_048_576
    auth_expiry: int = 120
    confirmation_expiry: int = 24 * 3600
    max_resigns: int = 2


@dataclass
class Settings:
    chain_mode: str
    rpc_url: str
    chain_id: int
    addresses: Addresses
    params: Params
    db_path: str
    contracts_out: Path
    api_host: str
    api_port: int
    authorizer_url: str
    authorizer_port: int
    api_internal_url: str
    internal_token: str
    llm_base_url: str | None
    llm_api_key: str | None
    llm_model: str | None
    demo_mode: bool
    require_session_sig: bool
    executor_withhold_exits: bool
    in_process_workers: bool
    tenant: TenantParams = field(default_factory=TenantParams)
    limits: Limits = field(default_factory=Limits)
    allowed_origins: list[str] = field(default_factory=lambda: DEFAULT_ORIGINS.split(","))
    admin_token: str = ""
    onboarding_open: bool = True
    public_rpc_url: str = ""
    explorer: str = ""
    llm_timeout: float = 20.0
    trust_proxy: bool = False
    ip_salt: str = ""
    tenant_refresh: float = 3.0
    tradeflow: TradeFlowLimits = field(default_factory=TradeFlowLimits)

    @property
    def tradeflow_enabled(self) -> bool:
        return bool(self.addresses.trade_escrow)

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_base_url and self.llm_model)

    @property
    def is_local_chain(self) -> bool:
        return self.chain_id == 31337

    def vault_meta(self, address: str) -> VaultMeta | None:
        for v in self.addresses.vaults:
            if v.address.lower() == address.lower():
                return v
        return None


KEY_ENV = {
    "authorizer": ("AUTHORIZER_KEY",),
    "exitKey": ("EXIT_KEY",),
    "executor": ("EXECUTOR_KEY",),
    "keeper": ("KEEPER_KEY",),
    "admin": ("ADMIN_KEY", "DEPLOYER_KEY"),
    "faucet": ("DEPLOYER_KEY",),
    "attacker": ("ATTACKER_KEY",),
}
ANVIL_FALLBACK = {"faucet": "admin"}
ISSUER_KEY_ENV = {"carrier": "ISSUER_CARRIER_KEY", "sensor": "ISSUER_SENSOR_KEY", "surveyor": "ISSUER_SURVEYOR_KEY"}


def load_key(role: str, chain_id: int) -> str:
    """Read one role's key at the point of use, so a process only ever loads the key it owns.

    Public Anvil keys are a fallback on chain 31337 only.
    """
    for name in KEY_ENV[role]:
        value = _env(name)
        if value is not None:
            return value
    if chain_id == 31337:
        return ANVIL_KEYS[ANVIL_FALLBACK.get(role, role)]
    raise RuntimeError(f"{' or '.join(KEY_ENV[role])} is not set")


def has_key(role: str, chain_id: int) -> bool:
    return chain_id == 31337 or any(_env(name) for name in KEY_ENV[role])


@lru_cache(maxsize=None)
def anvil_mnemonic_keys() -> tuple[tuple[str, str], ...]:
    """(address, key) for the first MNEMONIC_SCAN accounts of the public Anvil mnemonic."""
    from eth_account import Account
    from eth_account.hdaccount import key_from_seed, seed_from_mnemonic

    seed = seed_from_mnemonic(ANVIL_MNEMONIC, "")
    out = []
    for i in range(MNEMONIC_SCAN):
        key = "0x" + key_from_seed(seed, f"m/44'/60'/0'/0/{i}").hex()
        out.append((Account.from_key(key).address, key))
    return tuple(out)


def load_issuer_key(role: str, chain_id: int, expected: str | None) -> str | None:
    """A demo issuer key, read at the point of use so a missing key disables demo proofs and nothing else.

    On 31337 the deployment picks issuer addresses from the Anvil mnemonic; the key is the mnemonic account whose
    address matches the deployments file.
    """
    value = _env(ISSUER_KEY_ENV[role])
    if value is not None:
        return value
    if chain_id == 31337 and expected:
        return next((k for a, k in anvil_mnemonic_keys() if a.lower() == expected.lower()), None)
    return None


def load_deployments(path: Path) -> dict | None:
    if not path.exists():
        return None
    with path.open() as fh:
        return json.load(fh)


def addresses_from_deployments(dep: dict) -> Addresses:
    apy_a = _env_float("VAULT_A_APY", 0.045)
    apy_b = _env_float("VAULT_B_APY", 0.060)
    vaults = []
    if dep.get("vaultA"):
        vaults.append(VaultMeta(dep["vaultA"], "Vault A", apy_a, _env_float("VAULT_A_COST", 0.001)))
    if dep.get("vaultB"):
        vaults.append(VaultMeta(dep["vaultB"], "Vault B", apy_b, _env_float("VAULT_B_COST", 0.001)))
    safes = [dep["safe"]] if dep.get("safe") else []
    extra = _env("AEGIS_EXTRA_SAFES")
    if extra:
        safes.extend(s.strip() for s in extra.split(",") if s.strip())
    return Addresses(
        usdc=dep["usdc"],
        price_feed=dep["priceFeed"],
        registry=dep["registry"],
        module=dep["module"],
        safes=safes,
        vaults=vaults,
        roles=dict(dep.get("roles", {})),
        deploy_block=int(_env("DEPLOY_BLOCK") or dep.get("deployBlock", 0) or 0),
        safe_singleton=dep.get("safeSingleton", ""),
        safe_proxy_factory=dep.get("safeProxyFactory", ""),
        fallback_handler=dep.get("fallbackHandler") or CANONICAL_FALLBACK_HANDLER,
        trade_escrow=dep.get("tradeEscrow") or "",
        multi_send_call_only=dep.get("multiSendCallOnly") or "",
        trade_escrow_block=int(dep.get("tradeEscrowBlock") or 0),
        issuers={k: v for k, v in (dep.get("issuers") or {}).items() if k in ISSUER_ROLES and v},
    )


def load_tenant_params(local: bool) -> TenantParams:
    d = TenantParams()
    return TenantParams(
        auto_cap=_env_int("TENANT_AUTO_CAP", d.auto_cap),
        daily_cap=_env_int("TENANT_DAILY_CAP", d.daily_cap),
        bank_limit=_env_int("TENANT_BANK_LIMIT", d.bank_limit),
        max_band_width=_env_int("TENANT_MAX_BAND_WIDTH", d.max_band_width),
        max_oracle_age=_env_int("TENANT_MAX_ORACLE_AGE", d.max_oracle_age),
        auto_cap_max=_env_int("TENANT_AUTO_CAP_MAX", d.auto_cap_max),
        daily_cap_max=_env_int("TENANT_DAILY_CAP_MAX", d.daily_cap_max),
        bank_limit_max=_env_int("TENANT_BANK_LIMIT_MAX", d.bank_limit_max),
        max_band_width_max=_env_int("TENANT_MAX_BAND_WIDTH_MAX", d.max_band_width_max),
        max_oracle_age_max=_env_int("TENANT_MAX_ORACLE_AGE_MAX", d.max_oracle_age_max),
        # Anvil charges gwei-level gas, so the testnet drip sizes would not cover the onboarding transactions there.
        eth_owner=_env_int("FAUCET_ETH_OWNER", 10**18 if local else d.eth_owner),
        eth_bank=_env_int("FAUCET_ETH_BANK", 10**17 if local else d.eth_bank),
        test_usdc=_env_int("TEST_USDC_MINT", d.test_usdc),
    )


def load_limits(local: bool) -> Limits:
    d = Limits()
    return Limits(
        onboard_per_ip_day=_env_int("LIMIT_ONBOARD_PER_IP_DAY", d.onboard_per_ip_day),
        max_tenants=_env_int("LIMIT_MAX_TENANTS", d.max_tenants),
        faucet_wei_per_day=_env_int("LIMIT_FAUCET_WEI_PER_DAY", 100 * 10**18 if local else d.faucet_wei_per_day),
        chat_per_tenant=_env_int("LIMIT_CHAT_PER_TENANT", d.chat_per_tenant),
        chat_window=_env_int("LIMIT_CHAT_WINDOW", d.chat_window),
        llm_per_hour=_env_int("LIMIT_LLM_PER_HOUR", d.llm_per_hour),
        llm_per_tenant_hour=_env_int("LIMIT_LLM_PER_TENANT_HOUR", d.llm_per_tenant_hour),
        attacks_per_tenant_hour=_env_int("LIMIT_ATTACKS_PER_TENANT_HOUR", d.attacks_per_tenant_hour),
    )


DEFAULT_PUBLIC_RPC = {84532: "https://sepolia.base.org"}
DEFAULT_EXPLORER = {84532: "https://sepolia.basescan.org"}


def load_settings(**overrides) -> Settings:
    chain_mode = overrides.pop("chain_mode", None) or _env("AEGIS_CHAIN", "rpc")
    chain_id = int(overrides.pop("chain_id", None) or _env_int("CHAIN_ID", 31337))
    deployments_path = Path(_env("DEPLOYMENTS_PATH", str(REPO_DIR / "deployments" / f"{chain_id}.json")))
    dep = load_deployments(deployments_path) if chain_mode == "rpc" else None
    addresses = overrides.pop("addresses", None) or (addresses_from_deployments(dep) if dep else Addresses())

    local = chain_id == 31337

    settings = Settings(
        chain_mode=chain_mode,
        rpc_url=_env("RPC_URL", "http://127.0.0.1:8545"),
        chain_id=chain_id,
        addresses=addresses,
        params=overrides.pop("params", None) or Params(),
        db_path=_env("AEGIS_DB", str(SERVICE_DIR / "var" / "aegis.db")),
        contracts_out=Path(_env("CONTRACTS_OUT", str(REPO_DIR / "contracts" / "out"))),
        api_host=_env("API_HOST", "127.0.0.1"),
        api_port=_env_int("API_PORT", 8787),
        authorizer_url=_env("AUTHORIZER_URL", "http://127.0.0.1:8788"),
        authorizer_port=_env_int("AUTHORIZER_PORT", 8788),
        api_internal_url=_env("API_INTERNAL_URL", "http://127.0.0.1:8787"),
        internal_token=_env("INTERNAL_TOKEN", "dev-internal-token" if local else None) or "",
        llm_base_url=_env("LLM_BASE_URL"),
        llm_api_key=_env("LLM_API_KEY"),
        llm_model=_env("LLM_MODEL"),
        demo_mode=_env_bool("DEMO_MODE", local),
        require_session_sig=_env_bool("REQUIRE_SESSION_SIG", not local),
        executor_withhold_exits=_env_bool("EXECUTOR_WITHHOLD_EXITS", False),
        in_process_workers=_env_bool("AEGIS_IN_PROCESS_WORKERS", chain_mode == "fake"),
        tenant=load_tenant_params(local),
        limits=load_limits(local),
        allowed_origins=[o.strip() for o in (_env("ALLOWED_ORIGINS", DEFAULT_ORIGINS) or "").split(",") if o.strip()],
        admin_token=_env("ADMIN_TOKEN", "") or "",
        onboarding_open=_env_bool("ONBOARDING_OPEN", True),
        public_rpc_url=_env("PUBLIC_RPC_URL", DEFAULT_PUBLIC_RPC.get(chain_id)) or "",
        explorer=_env("EXPLORER_URL", DEFAULT_EXPLORER.get(chain_id, "")) or "",
        llm_timeout=_env_float("LLM_TIMEOUT", 20.0),
        trust_proxy=_env_bool("TRUST_PROXY", False),
        ip_salt=_env("IP_HASH_SALT", "") or "",
        tenant_refresh=_env_float("TENANT_REFRESH_SECONDS", 3.0),
    )
    if not settings.public_rpc_url and local:
        settings.public_rpc_url = settings.rpc_url
    for k, v in overrides.items():
        setattr(settings, k, v)
    return settings
