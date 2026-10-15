from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
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
    "authorizer": "AUTHORIZER_KEY",
    "exitKey": "EXIT_KEY",
    "executor": "EXECUTOR_KEY",
    "keeper": "KEEPER_KEY",
    "admin": "ADMIN_KEY",
}


def load_key(role: str, chain_id: int) -> str:
    """Read one role's key at the point of use, so a process only ever loads the key it owns.

    Public Anvil keys are a fallback on chain 31337 only.
    """
    value = _env(KEY_ENV[role])
    if value is None and chain_id == 31337:
        return ANVIL_KEYS[role]
    if value is None:
        raise RuntimeError(f"{KEY_ENV[role]} is not set")
    return value


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
    )


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
    )
    for k, v in overrides.items():
        setattr(settings, k, v)
    return settings
