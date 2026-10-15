from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _hermetic_env():
    """Integration tests read RPC_URL and DEPLOYMENTS_PATH from the environment on purpose."""
    yield
