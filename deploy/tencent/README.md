# AEGIS API on the Tencent CVM

One container (`aegis`) runs the five service processes under `python -m aegis all`. The supervisor gives each process only its own key, restarts a crashed process with backoff, and stops all of them on SIGTERM. A second container (`cliproxy`, CLIProxyAPI) serves the LLM on the compose network only. The API listens on host `127.0.0.1:8787`; the existing RuteAman Caddy publishes it as `https://aegis-api.150-109-23-187.sslip.io`.

| File | Purpose |
|---|---|
| `Dockerfile`, `Dockerfile.dockerignore` | Image: Python 3.13 slim, uv, non-root user `aegis` (uid 10001), data on `/data` |
| `docker-compose.yml` | `aegis` (512 MB) and `cliproxy` (128 MB) |
| `aegis.env.example` | Every service variable, documented. Copy to `aegis.env` (root-only) |
| `cliproxy/config.yaml.example` | CLIProxyAPI v8 config. Copy to `cliproxy/config.yaml` |
| `Caddyfile.aegis` | Site block to add to the RuteAman Caddyfile |

`aegis.env` and `cliproxy/config.yaml` are git-ignored. They hold secrets: never commit or paste them.

## 1. Copy the build context (from the repository root, on your machine)

```bash
rsync -az --relative --exclude '__pycache__' \
  service/pyproject.toml service/uv.lock service/aegis \
  deployments/31337.json deployments/84532.json deploy/tencent \
  root@150.109.23.187:/opt/aegis/
```

## 2. Secrets (on the server)

```bash
ssh root@150.109.23.187
cd /opt/aegis/deploy/tencent
install -m 600 -o root -g root aegis.env.example aegis.env
install -m 600 -o root -g root cliproxy/config.yaml.example cliproxy/config.yaml
openssl rand -hex 32   # run once each for INTERNAL_TOKEN, ADMIN_TOKEN, LLM_API_KEY; openssl rand -hex 16 for IP_HASH_SALT
vi aegis.env            # keys and tokens (see the file comments)
vi cliproxy/config.yaml # access.api-keys: the same value as LLM_API_KEY
```

The operator keys are the existing 84532 keys. Do not run `scripts/evidence_84532.py` while this service runs: both send from the same keys, and their nonces would collide.

## 3. Claude login for CLIProxyAPI (once)

```bash
docker compose run --rm -p 127.0.0.1:54545:54545 cliproxy ./CLIProxyAPI -claude-login -no-browser
```

On your laptop, open a tunnel for the OAuth callback, then open the URL the command prints:

```bash
ssh -N -L 54545:127.0.0.1:54545 root@150.109.23.187
```

The token is stored in the `aegis_cliproxy-auth` volume. Without it, or with `LLM_BASE_URL` unset, the agent runs in deterministic mode.

## 4. Start and check

```bash
docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1:8787/api/health
```

`/api/health` reports `chainId`, `blockLagSeconds`, `keeper.lastPoke`, `llmMode`, `tenantCount` and `onboardingOpen`.

## 5. Caddy

Append `Caddyfile.aegis` to the RuteAman Caddyfile and reload Caddy, for example:

```bash
docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile
curl -s https://aegis-api.150-109-23-187.sslip.io/api/health
```

The snippet proxies to `127.0.0.1:8787`, the same way the RuteAman site reaches `127.0.0.1:8090`. If Caddy runs on a Docker bridge network instead of the host network, it cannot reach a host loopback port: attach Caddy to the `aegis_aegis` network and use `reverse_proxy aegis:8787`.

## Operations

```bash
docker compose logs -f aegis                                      # all five processes
docker compose exec aegis ls /data/log                            # per-process rotating log files
docker compose up -d --build                                      # after a new rsync
docker compose exec aegis python -c "import sqlite3; sqlite3.connect('/data/aegis.db').backup(sqlite3.connect('/data/backup.db'))"
```

To stop new sign-ups without affecting existing treasuries, set `ONBOARDING_OPEN=0` in `aegis.env` and run `docker compose up -d`.
