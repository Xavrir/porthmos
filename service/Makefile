RPC_URL ?= http://127.0.0.1:8545

.PHONY: install dev dev-fake test test-integration anvil deploy clean evidence-sepolia

install:
	uv sync

dev:
	./scripts/dev.sh

# Offline demo: in-memory chain, all workers in one process, no keys beyond public Anvil test keys.
dev-fake:
	AEGIS_CHAIN=fake AEGIS_DB=var/aegis-fake.db uv run python -m aegis api

test:
	uv run pytest -m "not integration"

test-integration:
	RPC_URL=$(RPC_URL) uv run pytest -m integration

anvil:
	anvil --block-time 2

# Deploy.s.sol rewrites deployments/31337.json, so TradeFlow is redeployed and merged back every time (TD v0.4, C10).
deploy:
	cd ../contracts && forge script script/Deploy.s.sol --rpc-url $(RPC_URL) --broadcast
	cd ../contracts && forge script script/DeployTradeEscrow.s.sol --rpc-url $(RPC_URL) --broadcast
	uv run python scripts/merge_deployment.py --chain-id 31337 --rpc-url $(RPC_URL)

clean:
	rm -rf var

# Base Sepolia evidence (E1 to E5). Reads keys from ../.secrets/base-sepolia.env at runtime only.
evidence-sepolia:
	uv run python scripts/evidence_84532.py $(ARGS)
