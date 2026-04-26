#!/usr/bin/env bash
# ============================================================================
#  setup_workspace.sh
#  Инициализация workspace для проекта "Cyprus Geo-Social TMA"
#  Среда: antigravity.google + gsd-2 + Vercel Skills
# ============================================================================

set -euo pipefail

PROJECT_NAME="cyprus-geo-tma"
echo "🚀 Bootstrapping workspace for: ${PROJECT_NAME}"

# ---------- 1. Базовая структура каталогов ----------------------------------
mkdir -p docs
mkdir -p prompts
mkdir -p data
mkdir -p services/scraper
mkdir -p services/backend
mkdir -p services/frontend
mkdir -p infra/nginx
mkdir -p infra/docker
mkdir -p db/migrations
mkdir -p db/seeds

echo "📁 Directory tree created."

# ---------- 2. Пустые файлы-«точки истины» для агентов ----------------------
touch docs/ARCHITECTURE.md
touch docs/CHANGELOG.md
touch docs/DECISIONS.md          # ADR (architecture decision records)

# Заголовки-болванки, чтобы агенты не писали в пустоту
cat > docs/ARCHITECTURE.md <<'EOF'
# ARCHITECTURE.md
> Single source of truth for DB schema, REST contracts, WebSocket events.
> Updated by every agent at the end of its phase.

## 1. Database Schema
_TBD by Agent 2 (Database Architect)_

## 2. REST API Contracts
_TBD by Agent 3 (Backend Developer)_

## 3. WebSocket Events
_TBD by Agent 3 (Backend Developer)_

## 4. Frontend State & Routes
_TBD by Agent 4 (Frontend Developer)_

## 5. Infrastructure Topology
_TBD by Agent 5 (DevOps)_
EOF

cat > docs/CHANGELOG.md <<'EOF'
# CHANGELOG.md
> Append-only log. Each agent writes here on completion.
> Format: `## [YYYY-MM-DD] Agent <N> — <Role>`

EOF

echo "📝 Doc skeletons created."

# ---------- 3. .gitignore ---------------------------------------------------
cat > .gitignore <<'EOF'
node_modules/
__pycache__/
*.pyc
.env
.env.*
dist/
build/
.DS_Store
data/*.geojson
!data/.gitkeep
EOF
touch data/.gitkeep

# ---------- 4. ОБЯЗАТЕЛЬНО: подключение Vercel Skills + find-skills ---------
echo "🧠 Installing Vercel Skills (find-skills)..."
npx -y skills add https://github.com/vercel-labs/skills --skill find-skills

# ---------- 5. Финальная проверка -------------------------------------------
echo ""
echo "✅ Workspace ready."
echo "Next steps:"
echo "  1) Review docs/CONTEXT.md"
echo "  2) Run agents sequentially via gsd-2:"
echo "     gsd-2 run prompts/agent_1_data.md"
echo "     gsd-2 run prompts/agent_2_db.md"
echo "     gsd-2 run prompts/agent_3_backend.md"
echo "     gsd-2 run prompts/agent_4_frontend.md"
echo "     gsd-2 run prompts/agent_5_devops.md"
