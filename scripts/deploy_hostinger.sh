#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
PostRight one-shot deployment script for Hostinger VPS (no Docker).

Usage:
  bash scripts/deploy_hostinger.sh \
    --repo-url <git_repo_url> \
    --db-pass <db_password> \
    --auth-secret <jwt_secret> \
    [--public-ip 72.61.246.2] \
    [--app-name postright] \
    [--app-dir /opt/postright] \
    [--app-user <linux_user>] \
    [--db-name postright] \
    [--db-user postright_app] \
    [--frontend-port 5000] \
    [--backend-port 8080] \
    [--frontend-internal-port 15000] \
    [--backend-internal-port 18080] \
    [--health-retries 30] \
    [--health-sleep-seconds 2] \
    [--skip-ufw]

What it does:
1) Installs OS dependencies (nginx, postgres, nodejs 20, etc.)
2) Clones/updates code under APP_DIR
3) Creates backend/frontend production env files
4) Bootstraps DB user+database (idempotent) and runs migrations
5) Builds frontend
6) Starts backend + frontend under PM2 and enables PM2 auto-start
7) Writes nginx config (frontend on :5000, backend on :8080)
8) Opens UFW ports (optional)
9) Validates frontend/backend HTTP health with retries
EOF
}

log() { printf '\n[%s] %s\n' "INFO" "$*"; }
warn() { printf '\n[%s] %s\n' "WARN" "$*" >&2; }
die() { printf '\n[%s] %s\n' "ERROR" "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

as_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

as_postgres() {
  if [[ "${EUID}" -eq 0 ]]; then
    runuser -u postgres -- "$@"
  else
    sudo -u postgres "$@"
  fi
}

as_app_user() {
  local app_user="$1"
  shift
  if [[ "${EUID}" -eq 0 ]]; then
    runuser -u "${app_user}" -- "$@"
  else
    sudo -u "${app_user}" "$@"
  fi
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local retries="$3"
  local sleep_seconds="$4"
  local expect_pattern="${5:-}"
  local last_code="000"
  local last_body=""

  for ((attempt = 1; attempt <= retries; attempt++)); do
    last_body="$(curl -sS --max-time 8 "${url}" 2>/dev/null || true)"
    last_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "${url}" 2>/dev/null || echo "000")"

    if [[ "${last_code}" == 2* || "${last_code}" == 3* ]]; then
      if [[ -z "${expect_pattern}" ]] || echo "${last_body}" | grep -q "${expect_pattern}"; then
        log "${name} is healthy (attempt ${attempt}/${retries}, status ${last_code})"
        return 0
      fi
    fi

    sleep "${sleep_seconds}"
  done

  warn "${name} health check failed after ${retries} attempts."
  warn "Last status code: ${last_code}"
  if [[ -n "${last_body}" ]]; then
    warn "Last response (first 300 chars): ${last_body:0:300}"
  fi
  return 1
}

APP_NAME="postright"
APP_DIR="/opt/postright"
PUBLIC_IP="72.61.246.2"
APP_USER="${SUDO_USER:-$USER}"

DB_NAME="postright"
DB_USER="postright_app"
DB_PASS=""
AUTH_SECRET=""
REPO_URL=""

FRONTEND_PORT="5000"
BACKEND_PORT="8080"
FRONTEND_INTERNAL_PORT="15000"
BACKEND_INTERNAL_PORT="18080"
HEALTH_RETRIES="30"
HEALTH_SLEEP_SECONDS="2"

SKIP_UFW="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-url) REPO_URL="${2:-}"; shift 2 ;;
    --db-pass) DB_PASS="${2:-}"; shift 2 ;;
    --auth-secret) AUTH_SECRET="${2:-}"; shift 2 ;;
    --public-ip) PUBLIC_IP="${2:-}"; shift 2 ;;
    --app-name) APP_NAME="${2:-}"; shift 2 ;;
    --app-dir) APP_DIR="${2:-}"; shift 2 ;;
    --app-user) APP_USER="${2:-}"; shift 2 ;;
    --db-name) DB_NAME="${2:-}"; shift 2 ;;
    --db-user) DB_USER="${2:-}"; shift 2 ;;
    --frontend-port) FRONTEND_PORT="${2:-}"; shift 2 ;;
    --backend-port) BACKEND_PORT="${2:-}"; shift 2 ;;
    --frontend-internal-port) FRONTEND_INTERNAL_PORT="${2:-}"; shift 2 ;;
    --backend-internal-port) BACKEND_INTERNAL_PORT="${2:-}"; shift 2 ;;
    --health-retries) HEALTH_RETRIES="${2:-}"; shift 2 ;;
    --health-sleep-seconds) HEALTH_SLEEP_SECONDS="${2:-}"; shift 2 ;;
    --skip-ufw) SKIP_UFW="true"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ -n "${REPO_URL}" ]] || die "--repo-url is required"
[[ -n "${DB_PASS}" ]] || die "--db-pass is required"
[[ -n "${AUTH_SECRET}" ]] || die "--auth-secret is required"

id "${APP_USER}" >/dev/null 2>&1 || die "Linux user '${APP_USER}' does not exist"
APP_GROUP="$(id -gn "${APP_USER}")"

need_cmd bash
need_cmd sed
need_cmd awk
need_cmd grep

log "Installing OS packages"
as_root apt update
as_root apt install -y nginx postgresql postgresql-contrib git curl build-essential ufw ca-certificates

if ! command -v node >/dev/null 2>&1; then
  log "Installing Node.js 20"
  as_root bash -c "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -"
  as_root apt install -y nodejs
fi

need_cmd node
need_cmd npm
need_cmd curl

log "Installing global process/runtime tools (pm2, serve)"
as_root npm install -g pm2 serve
need_cmd pm2

log "Preparing application directory: ${APP_DIR}"
as_root mkdir -p "${APP_DIR}"
as_root chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}"

if [[ -d "${APP_DIR}/.git" ]]; then
  log "Updating existing repository"
  as_app_user "${APP_USER}" git -C "${APP_DIR}" fetch --all --prune
  as_app_user "${APP_USER}" git -C "${APP_DIR}" pull --ff-only
else
  if [[ -n "$(ls -A "${APP_DIR}" 2>/dev/null)" ]]; then
    die "APP_DIR '${APP_DIR}' is not empty and not a git repo"
  fi
  log "Cloning repository"
  as_app_user "${APP_USER}" git clone "${REPO_URL}" "${APP_DIR}"
fi

log "Installing project dependencies"
as_app_user "${APP_USER}" bash -lc "cd '${APP_DIR}' && npm run install:all"

log "Writing backend production env"
as_root tee "${APP_DIR}/backend/.env.production" >/dev/null <<EOF
NODE_ENV=production
PORT=${BACKEND_INTERNAL_PORT}

POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=${DB_NAME}
POSTGRES_USER=${DB_USER}
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_SSL=false

AUTH_TOKEN_SECRET=${AUTH_SECRET}
AUTH_TOKEN_TTL_SECONDS=28800

DEFAULT_TENANT_ID=tenant_demo
DEFAULT_BRANCH_ID=branch_main

BULK_UPLOAD_RATE_WINDOW_MS=60000
BULK_UPLOAD_RATE_MAX=10

N8N_BASE_URL=
N8N_API_KEY=
TALLY_BASE_URL=
TALLY_API_KEY=
EOF

log "Writing frontend production env"
as_root tee "${APP_DIR}/frontend/.env.production" >/dev/null <<EOF
VITE_API_BASE_URL=/api
EOF

as_root chown "${APP_USER}:${APP_GROUP}" "${APP_DIR}/backend/.env.production" "${APP_DIR}/frontend/.env.production"
as_root chmod 640 "${APP_DIR}/backend/.env.production" "${APP_DIR}/frontend/.env.production"

log "Bootstrapping PostgreSQL role/database (idempotent)"
as_postgres psql -v ON_ERROR_STOP=1 \
  --set=db_user="${DB_USER}" \
  --set=db_pass="${DB_PASS}" \
  --set=db_name="${DB_NAME}" \
  postgres <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'db_user') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', :'db_user', :'db_pass');
  ELSE
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'db_user', :'db_pass');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name') THEN
    EXECUTE format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_user');
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', :'db_name', :'db_user');
END $$;
SQL

log "Running database migrations"
as_app_user "${APP_USER}" bash -lc "
  set -a
  source '${APP_DIR}/backend/.env.production'
  set +a
  cd '${APP_DIR}'
  npm --prefix backend run migrate
"

log "Building frontend"
as_app_user "${APP_USER}" bash -lc "cd '${APP_DIR}' && npm --prefix frontend run build"

SERVICE_NAME="${APP_NAME}-backend"
LEGACY_SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
PM2_ECOSYSTEM_PATH="${APP_DIR}/ecosystem.config.cjs"
APP_HOME="$(getent passwd "${APP_USER}" | cut -d: -f6)"

if [[ -f "${LEGACY_SERVICE_PATH}" ]]; then
  warn "Legacy systemd backend unit detected. Disabling it in favor of PM2."
  as_root systemctl disable --now "${SERVICE_NAME}" || true
  as_root rm -f "${LEGACY_SERVICE_PATH}"
  as_root systemctl daemon-reload
fi

log "Writing PM2 ecosystem config"
as_root tee "${PM2_ECOSYSTEM_PATH}" >/dev/null <<EOF
module.exports = {
  apps: [
    {
      name: "${APP_NAME}-backend",
      cwd: "${APP_DIR}/backend",
      script: "src/server.js",
      interpreter: "/usr/bin/node",
      env_file: "${APP_DIR}/backend/.env.production",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000
    },
    {
      name: "${APP_NAME}-frontend",
      cwd: "${APP_DIR}",
      script: "serve",
      args: "-s frontend/dist -l ${FRONTEND_INTERNAL_PORT}",
      interpreter: "none",
      env: {
        NODE_ENV: "production"
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000
    }
  ]
};
EOF
as_root chown "${APP_USER}:${APP_GROUP}" "${PM2_ECOSYSTEM_PATH}"
as_root chmod 644 "${PM2_ECOSYSTEM_PATH}"

log "Starting applications with PM2"
as_app_user "${APP_USER}" bash -lc "
  cd '${APP_DIR}'
  pm2 delete '${APP_NAME}-backend' >/dev/null 2>&1 || true
  pm2 delete '${APP_NAME}-frontend' >/dev/null 2>&1 || true
  pm2 start '${PM2_ECOSYSTEM_PATH}' --update-env
  pm2 save
"

log "Enabling PM2 startup on boot"
as_root pm2 startup systemd -u "${APP_USER}" --hp "${APP_HOME}" >/dev/null
as_root systemctl enable "pm2-${APP_USER}" >/dev/null 2>&1 || true
as_root systemctl restart "pm2-${APP_USER}" >/dev/null 2>&1 || true

NGINX_SITE="${APP_NAME}"
NGINX_SITE_PATH="/etc/nginx/sites-available/${NGINX_SITE}"

log "Writing nginx site config: ${NGINX_SITE}"
as_root tee "${NGINX_SITE_PATH}" >/dev/null <<EOF
upstream ${APP_NAME}_backend_upstream {
    server 127.0.0.1:${BACKEND_INTERNAL_PORT};
    keepalive 32;
}

upstream ${APP_NAME}_frontend_upstream {
    server 127.0.0.1:${FRONTEND_INTERNAL_PORT};
    keepalive 16;
}

server {
    listen ${FRONTEND_PORT};
    server_name ${PUBLIC_IP};

    location /api/ {
        proxy_pass http://${APP_NAME}_backend_upstream/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://${APP_NAME}_frontend_upstream/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen ${BACKEND_PORT};
    server_name ${PUBLIC_IP};

    location / {
        proxy_pass http://${APP_NAME}_backend_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

as_root ln -sfn "${NGINX_SITE_PATH}" "/etc/nginx/sites-enabled/${NGINX_SITE}"
as_root nginx -t
as_root systemctl enable nginx
as_root systemctl restart nginx

if [[ "${SKIP_UFW}" != "true" ]]; then
  log "Configuring UFW"
  as_root ufw allow 22/tcp
  as_root ufw allow "${FRONTEND_PORT}/tcp"
  as_root ufw allow "${BACKEND_PORT}/tcp"
  as_root ufw --force enable
fi

BACKEND_HEALTH_INTERNAL_URL="http://127.0.0.1:${BACKEND_PORT}/api/health"
FRONTEND_INTERNAL_URL="http://127.0.0.1:${FRONTEND_PORT}/"
BACKEND_HEALTH_PUBLIC_URL="http://${PUBLIC_IP}:${BACKEND_PORT}/api/health"
FRONTEND_PUBLIC_URL="http://${PUBLIC_IP}:${FRONTEND_PORT}/"

log "Running HTTP health checks"
wait_for_http "Backend (internal)" "${BACKEND_HEALTH_INTERNAL_URL}" "${HEALTH_RETRIES}" "${HEALTH_SLEEP_SECONDS}" '"status":"ok"' || {
  as_app_user "${APP_USER}" pm2 status || true
  as_app_user "${APP_USER}" pm2 logs "${APP_NAME}-backend" --lines 40 --nostream || true
  die "Backend health check failed"
}
wait_for_http "Frontend (internal)" "${FRONTEND_INTERNAL_URL}" "${HEALTH_RETRIES}" "${HEALTH_SLEEP_SECONDS}" "" || die "Frontend health check failed"

# Public-IP checks are best effort (some VPS providers block hairpin/public self-access).
if ! wait_for_http "Backend (public IP)" "${BACKEND_HEALTH_PUBLIC_URL}" 5 1 '"status":"ok"'; then
  warn "Public-IP backend check failed from this host. Verify external reachability manually."
fi
if ! wait_for_http "Frontend (public IP)" "${FRONTEND_PUBLIC_URL}" 5 1 ""; then
  warn "Public-IP frontend check failed from this host. Verify external reachability manually."
fi

HEALTH_URL="http://${PUBLIC_IP}:${BACKEND_PORT}/api/health"
log "Deployment completed."
echo "Frontend: http://${PUBLIC_IP}:${FRONTEND_PORT}"
echo "Backend:  http://${PUBLIC_IP}:${BACKEND_PORT}"
echo "Health:   ${HEALTH_URL}"
echo
echo "PM2 status command:"
echo "  sudo -u ${APP_USER} -H pm2 status"
