"""A1 (reserve), risk triggers, planner, validator (A4 core), policy tiers, A6 and A7 at core level."""

from __future__ import annotations

from dataclasses import replace

from aegis.chain.fake import FakeChain
from aegis.config import PRICE_ONE, USDC, Params, load_settings
from aegis.core.pipeline import snapshot
from aegis.core.planner import HOLD_ID, build_plan
from aegis.core.policy import T1, T2, T3, T4, derive_tier
from aegis.core.reserve import Obligation, required_reserve, schedule_hash
from aegis.core.risk import LIQUIDITY, PEG, STALE, assess
from aegis.core.state import load_state
from aegis.core.validator import validate
from aegis.eip712 import OP_DEPOSIT, OP_REDEEM

DAY = 86400
NOW = 1_790_000_000
P = Params()


def ob(i, amount, day, kind="outflow", confirmed=True, settled=False):
    return Obligation(f"o{i}", f"ob{i}", amount * USDC, NOW + day * DAY, kind, confirmed, settled)


class TestReserveA1:
    def test_empty_schedule_is_buffer_minimum(self):
        assert required_reserve([], NOW, P).required == 500 * USDC

    def test_single_payroll(self):
        r = required_reserve([ob(1, 4000, 14)], NOW, P)
        assert (r.peak_net_outflow, r.buffer, r.required) == (4000 * USDC, 500 * USDC, 4500 * USDC)

    def test_early_large_payment_not_offset_by_later_inflow(self):
        # cumulative net: day2 5000, day5 -1000, day10 0 -> peak 5000; buffer max(500, 10% of 6000) = 600
        sched = [ob(1, 5000, 2), ob(2, 6000, 5, kind="inflow"), ob(3, 1000, 10)]
        r = required_reserve(sched, NOW, P)
        assert r.peak_net_outflow == 5000 * USDC
        assert r.buffer == 600 * USDC
        assert r.required == 5600 * USDC

    def test_inflow_before_payment_reduces_peak(self):
        sched = [ob(1, 3000, 1, kind="inflow"), ob(2, 5000, 4)]
        assert required_reserve(sched, NOW, P).required == 2000 * USDC + 500 * USDC

    def test_unconfirmed_inflow_counts_zero(self):
        sched = [ob(1, 3000, 1, kind="inflow", confirmed=False), ob(2, 5000, 4)]
        assert required_reserve(sched, NOW, P).required == 5000 * USDC + 500 * USDC

    def test_same_day_outflow_applied_before_inflow(self):
        sched = [ob(1, 2000, 3), ob(2, 2000, 3, kind="inflow")]
        assert required_reserve(sched, NOW, P).peak_net_outflow == 2000 * USDC

    def test_horizon_overdue_and_settled(self):
        sched = [ob(1, 7000, 31), ob(2, 1000, -2), ob(3, 9000, 5, settled=True)]
        r = required_reserve(sched, NOW, P)
        assert r.peak_net_outflow == 1000 * USDC
        assert r.required == 1500 * USDC

    def test_buffer_rate_applies_above_minimum(self):
        assert required_reserve([ob(1, 20_000, 7)], NOW, P).required == 22_000 * USDC

    def test_schedule_hash_tracks_schedule_not_time(self):
        a = [ob(1, 4000, 14)]
        assert schedule_hash(a) == schedule_hash([replace(a[0])])
        assert schedule_hash(a) != schedule_hash([replace(a[0], amount=4001 * USDC)])
        assert required_reserve(a, NOW, P).schedule_hash == required_reserve(a, NOW + DAY, P).schedule_hash


def demo_state(**chain_changes):
    chain, addresses = FakeChain.demo()
    settings = load_settings(chain_mode="fake", addresses=addresses, db_path=":memory:")
    for k, v in chain_changes.items():
        setattr(chain, k, v)
    return chain, settings, addresses.safes[0]


def plan_for(chain, settings, safe, obligations=None):
    obligations = obligations if obligations is not None else [ob(1, 4000, 14)]
    return snapshot(chain, settings, safe, obligations)


class TestRisk:
    def test_peg_threshold_is_strict(self):
        chain, settings, safe = demo_state()
        chain.set_price(PRICE_ONE + PRICE_ONE // 100)
        assert not assess(load_state(chain, settings, safe), P).vaults[0].triggers
        chain.set_price(PRICE_ONE + PRICE_ONE // 100 + 1)
        risk = assess(load_state(chain, settings, safe), P)
        assert [t.code for t in risk.vaults[0].triggers] == [PEG]

    def test_staleness_uses_max_oracle_age(self):
        chain, settings, safe = demo_state()
        chain.now = chain.updated_at + 180
        assert not assess(load_state(chain, settings, safe), P).oracle_stale
        chain.now += 1
        risk = assess(load_state(chain, settings, safe), P)
        assert risk.oracle_stale and STALE in [t.code for t in risk.vaults[1].triggers]

    def test_liquidity_trigger_below_1_2x_position(self):
        chain, settings, safe = demo_state()
        vb = settings.addresses.vaults[1].address
        chain._vault_deposit(chain.vaults[vb.lower()], safe, 2000 * USDC)
        chain.ever.add((safe.lower(), vb.lower()))
        chain.admin_set_liquidity_cap("", vb, 2399 * USDC)
        risk = assess(load_state(chain, settings, safe), P)
        assert [t.code for t in risk.vault(vb).triggers] == [LIQUIDITY]
        chain.admin_set_liquidity_cap("", vb, 2400 * USDC)
        assert not assess(load_state(chain, settings, safe), P).vault(vb).triggers

    def test_score_weights(self):
        chain, settings, safe = demo_state()
        chain.set_price(PRICE_ONE - PRICE_ONE // 200)
        v = assess(load_state(chain, settings, safe), P).vaults[0]
        assert v.components["peg"] == 0.5
        assert abs(v.score - 0.4 * 0.5) < 1e-9

    def test_quarantine_cooldown(self):
        chain, settings, safe = demo_state()
        va = settings.addresses.vaults[0].address
        chain.policies[safe.lower()].quarantined_at[va.lower()] = chain.now
        state = load_state(chain, settings, safe)
        vr = assess(state, P).vault(va)
        assert vr.quarantined and vr.cooldown_ends_at == chain.now + 24 * 3600 and not vr.clearable
        chain.now += 24 * 3600
        chain.set_price(PRICE_ONE)
        vr = assess(load_state(chain, settings, safe), P, {va.lower(): chain.now - 3600}).vault(va)
        assert not vr.clearable


class TestPlanner:
    def test_greedy_with_60_percent_cap_and_default(self):
        chain, settings, safe = demo_state()
        plan = plan_for(chain, settings, safe).plan
        assert plan.required == 4500 * USDC and plan.deployable == 5500 * USDC
        vb, va = (v.address for v in reversed(settings.addresses.vaults))
        assert plan.targets == {vb: 3300 * USDC, va: 2200 * USDC}
        assert plan.default_id == "deposit-vault-b"
        assert sum(o.is_default for o in plan.options) == 1
        assert plan.option(HOLD_ID) is not None

    def test_quarantined_vault_excluded_and_exited(self):
        chain, settings, safe = demo_state()
        vb = settings.addresses.vaults[1].address
        chain._vault_deposit(chain.vaults[vb.lower()], safe, 1000 * USDC)
        chain.ever.add((safe.lower(), vb.lower()))
        chain.policies[safe.lower()].quarantined_at[vb.lower()] = chain.now
        plan = plan_for(chain, settings, safe).plan
        assert vb not in plan.targets
        assert plan.default_id == "redeem-vault-b"
        assert plan.default.op == OP_REDEEM

    def test_min_trade_holds(self):
        chain, settings, safe = demo_state()
        chain.usdc[safe.lower()] = 4540 * USDC
        plan = plan_for(chain, settings, safe).plan
        assert plan.default_id == HOLD_ID and plan.hold_reason == "NothingDeployable"

    def test_hysteresis_band(self):
        chain, settings, safe = demo_state()
        va, vb = (v.address for v in settings.addresses.vaults)
        for v, amt in ((vb, 3200), (va, 2150)):
            chain._vault_deposit(chain.vaults[v.lower()], safe, amt * USDC)
            chain.ever.add((safe.lower(), v.lower()))
        plan = plan_for(chain, settings, safe).plan
        assert plan.default_id == HOLD_ID and plan.hold_reason == "WithinBand"

    def test_floor_out_of_sync_holds_a7(self):
        chain, settings, safe = demo_state()
        plan = plan_for(chain, settings, safe, [ob(1, 4000, 14), ob(2, 2000, 7)]).plan
        assert plan.default_id == HOLD_ID and plan.hold_reason == "FloorOutOfSync"
        assert [o.id for o in plan.options] == [HOLD_ID]

    def test_frozen_blocks_deposits_only(self):
        chain, settings, safe = demo_state()
        chain.policies[safe.lower()].bank_frozen = True
        plan = plan_for(chain, settings, safe).plan
        assert all(o.op != OP_DEPOSIT for o in plan.options)
        assert plan.hold_reason == "Frozen"


class TestValidatorAndPolicy:
    def test_above_default_escalates_to_t3_a4(self):
        chain, settings, safe = demo_state()
        plan = plan_for(chain, settings, safe).plan
        v = validate(plan, "deposit-vault-a")
        assert v.ok and v.escalate_tier == 3
        assert validate(plan, "deposit-vault-b").escalate_tier == 0
        assert validate(plan, "deposit-vault-b-half").escalate_tier == 0

    def test_reductions_only_lower(self):
        chain, settings, safe = demo_state()
        plan = plan_for(chain, settings, safe).plan
        assert validate(plan, "deposit-vault-b", {"amount": str(500 * USDC)}).assets == 500 * USDC
        assert not validate(plan, "deposit-vault-b", {"amount": str(9000 * USDC)}).ok
        assert not validate(plan, "transfer-all").ok

    def test_tier_derivation_matches_module_spec(self):
        cap, bank = 1000 * USDC, 3000 * USDC
        assert derive_tier(OP_REDEEM, 10**12, cap, bank, False) == T1
        assert derive_tier(OP_DEPOSIT, 500 * USDC, cap, bank, True) == T2
        assert derive_tier(OP_DEPOSIT, 1000 * USDC, cap, bank, True) == T2
        assert derive_tier(OP_DEPOSIT, 1001 * USDC, cap, bank, True) == T3
        assert derive_tier(OP_DEPOSIT, 500 * USDC, cap, bank, False) == T3
        assert derive_tier(OP_DEPOSIT, 3001 * USDC, cap, bank, True) == T4
        assert derive_tier(OP_DEPOSIT, 3001 * USDC, cap, 0, True) == T3

    def test_tier_agrees_with_fake_module(self):
        chain, settings, safe = demo_state()
        p = chain.policies[safe.lower()]
        va = settings.addresses.vaults[0].address
        for amt in (500, 1000, 1500, 3000, 3500):
            for ever in (False, True):
                if ever:
                    chain.ever.add((safe.lower(), va.lower()))
                else:
                    chain.ever.discard((safe.lower(), va.lower()))
                assert derive_tier(OP_DEPOSIT, amt * USDC, p.auto_cap, p.bank_limit, ever) == \
                    chain.module_required_tier(safe, va, amt * USDC)


class TestCounterfactualA6:
    def test_due_date_changes_decision(self):
        chain, settings, safe = demo_state()
        near = plan_for(chain, settings, safe, [ob(1, 4000, 10)]).plan
        far = plan_for(chain, settings, safe, [ob(1, 4000, 40)]).plan
        assert near.required == 4500 * USDC and far.required == 500 * USDC
        assert far.deployable > near.deployable
        assert far.default.assets > near.default.assets

    def test_price_changes_decision(self):
        chain, settings, safe = demo_state()
        assert plan_for(chain, settings, safe).plan.default.op == OP_DEPOSIT
        chain.set_price(98_500_000)
        plan = plan_for(chain, settings, safe).plan
        assert plan.default_id == HOLD_ID and plan.hold_reason == "PegDeviation"

    def test_same_inputs_same_plan(self):
        chain, settings, safe = demo_state()
        hashes = {plan_for(chain, settings, safe).plan.plan_hash for _ in range(10)}
        assert len(hashes) == 1


def test_build_plan_is_pure():
    chain, settings, safe = demo_state()
    snap = plan_for(chain, settings, safe)
    again = build_plan(snap.state, snap.risk, snap.reserve, settings.params)
    assert again.plan_hash == snap.plan.plan_hash
