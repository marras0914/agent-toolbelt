#!/usr/bin/env bash
set -euo pipefail

# ============================================
# Agent Toolbelt — Deployment Script
# ============================================
# Usage:
#   ./deploy.sh              Interactive mode (walks you through everything)
#   ./deploy.sh check        Validate environment only
#   ./deploy.sh railway      Deploy to Railway
#   ./deploy.sh render       Deploy to Render
#   ./deploy.sh docker       Build & run Docker locally
#   ./deploy.sh stripe-setup Guide for Stripe setup
# ============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

print_banner() {
  echo ""
  echo -e "${CYAN}╔═══════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║       ${BOLD}🔧 Agent Toolbelt — Deploy${NC}${CYAN}              ║${NC}"
  echo -e "${CYAN}╚═══════════════════════════════════════════════╝${NC}"
  echo ""
}

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${CYAN}→${NC} $1"; }
step() { echo -e "\n${BOLD}$1${NC}"; }

# ----- Pre-flight Checks -----
check_prereqs() {
  step "Pre-flight Checks"

  # Node.js
  if command -v node &>/dev/null; then
    NODE_V=$(node --version)
    ok "Node.js $NODE_V"
  else
    fail "Node.js not found. Install from https://nodejs.org"
    exit 1
  fi

  # npm
  if command -v npm &>/dev/null; then
    ok "npm $(npm --version)"
  else
    fail "npm not found"
    exit 1
  fi

  # Git
  if command -v git &>/dev/null; then
    ok "git $(git --version | cut -d' ' -f3)"
  else
    fail "git not found. Install from https://git-scm.com"
    exit 1
  fi

  # TypeScript builds
  if [ -f "package.json" ]; then
    ok "package.json found"
  else
    fail "package.json not found — are you in the project root?"
    exit 1
  fi

  # Check if deps are installed
  if [ -d "node_modules" ]; then
    ok "node_modules present"
  else
    warn "node_modules missing — running npm install..."
    npm install
    ok "Dependencies installed"
  fi
}

# ----- Environment Validation -----
check_env() {
  step "Environment Configuration"

  if [ -f ".env" ]; then
    ok ".env file found"
    source .env 2>/dev/null || true
  else
    warn ".env file not found"
    if [ -f ".env.example" ]; then
      info "Creating .env from .env.example..."
      cp .env.example .env
      ok ".env created — you'll need to fill in your secrets"
    fi
  fi

  # Check critical env vars
  local all_good=true

  if [ -n "${API_KEY_SECRET:-}" ] && [ "$API_KEY_SECRET" != "CHANGE_ME_generate_with_openssl_rand_hex_32" ]; then
    ok "API_KEY_SECRET is set"
  else
    warn "API_KEY_SECRET not configured (generate with: openssl rand -hex 32)"
    all_good=false
  fi

  if [ -n "${STRIPE_SECRET_KEY:-}" ] && [ "$STRIPE_SECRET_KEY" != "sk_live_..." ]; then
    ok "STRIPE_SECRET_KEY is set"
  else
    warn "STRIPE_SECRET_KEY not set (billing won't work — this is OK for initial deploy)"
  fi

  if [ -n "${STRIPE_WEBHOOK_SECRET:-}" ] && [ "$STRIPE_WEBHOOK_SECRET" != "whsec_..." ]; then
    ok "STRIPE_WEBHOOK_SECRET is set"
  else
    warn "STRIPE_WEBHOOK_SECRET not set"
  fi

  if [ "$all_good" = false ]; then
    echo ""
    info "Edit .env to add missing values, then re-run this script"
  fi
}

# ----- Build -----
build_project() {
  step "Building Project"

  info "Running TypeScript compiler..."
  npm run build 2>&1

  if [ -f "dist/index.js" ]; then
    ok "Build successful → dist/index.js"
  else
    fail "Build failed — check TypeScript errors above"
    exit 1
  fi
}

# ----- Local Test -----
test_local() {
  step "Local Smoke Test"

  info "Starting server in background..."
  API_KEY_SECRET="${API_KEY_SECRET:-dev-test-secret}" \
  DATABASE_PATH="./data/test-deploy.db" \
  NODE_ENV=development \
  PORT=3333 \
  node dist/index.js &
  SERVER_PID=$!

  # Wait for server to start
  sleep 2

  # Test health endpoint
  if curl -sf http://localhost:3333/api > /dev/null 2>&1; then
    ok "Health check passed (GET /api)"
  else
    fail "Health check failed"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
  fi

  # Test tool catalog
  CATALOG=$(curl -sf http://localhost:3333/api/tools/catalog 2>/dev/null)
  if echo "$CATALOG" | grep -q "schema-generator"; then
    ok "Tool catalog accessible — tools registered"
  else
    fail "Tool catalog not working"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
  fi

  # Test client registration
  REG_RESULT=$(curl -sf -X POST http://localhost:3333/api/clients/register \
    -H "Content-Type: application/json" \
    -d '{"email": "deploy-test@test.com", "name": "Deploy Test"}' 2>/dev/null || echo "")

  if echo "$REG_RESULT" | grep -q "atb_"; then
    ok "Client registration works — API key generated"

    # Extract the key and test a tool call
    API_KEY=$(echo "$REG_RESULT" | grep -o '"key":"atb_[^"]*"' | cut -d'"' -f4)
    if [ -n "$API_KEY" ]; then
      TOOL_RESULT=$(curl -sf -X POST http://localhost:3333/api/tools/schema-generator \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $API_KEY" \
        -d '{"description": "a test user"}' 2>/dev/null || echo "")

      if echo "$TOOL_RESULT" | grep -q '"success":true'; then
        ok "Tool execution works — schema-generator returned results"
      else
        warn "Tool call returned unexpected result"
      fi
    fi
  else
    warn "Client registration returned unexpected result (may already exist)"
  fi

  # Cleanup
  kill $SERVER_PID 2>/dev/null || true
  rm -f ./data/test-deploy.db
  ok "Local test complete"
}

# ----- Git Setup -----
setup_git() {
  step "Git Repository"

  if [ -d ".git" ]; then
    ok "Git repo already initialized"
    BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
    ok "Current branch: $BRANCH"
  else
    info "Initializing git repo..."
    git init
    git add .
    git commit -m "Agent Toolbelt v1.0 — ready to ship"
    ok "Git repo initialized with initial commit"
  fi

  # Check for remote
  if git remote get-url origin &>/dev/null; then
    REMOTE=$(git remote get-url origin)
    ok "Remote: $REMOTE"
  else
    warn "No git remote configured"
    echo ""
    info "To push to GitHub:"
    info "  1. Create a repo at https://github.com/new"
    info "  2. Run: git remote add origin git@github.com:YOUR_USER/agent-toolbelt.git"
    info "  3. Run: git push -u origin main"
    echo ""
    read -p "  Press Enter to continue (or Ctrl+C to set up GitHub first)..."
  fi
}

# ----- Railway Deployment -----
deploy_railway() {
  step "Railway Deployment"

  if ! command -v railway &>/dev/null; then
    info "Railway CLI not found. Installing..."
    npm install -g @railway/cli 2>/dev/null || {
      warn "Could not install Railway CLI globally"
      info "Install manually: npm install -g @railway/cli"
      info "Or use the Railway dashboard: https://railway.app"
      return 1
    }
  fi
  ok "Railway CLI available"

  info "Logging in to Railway..."
  railway login

  info "Initializing Railway project..."
  railway init

  echo ""
  step "Set Environment Variables in Railway"
  info "Go to your Railway dashboard → Service → Variables"
  info "Add these variables:"
  echo ""
  echo "  PORT=3000"
  echo "  NODE_ENV=production"
  echo "  API_KEY_SECRET=$(openssl rand -hex 32 2>/dev/null || echo 'GENERATE_WITH_openssl_rand_hex_32')"
  echo "  USAGE_TRACKING_ENABLED=true"
  echo "  STRIPE_SECRET_KEY=sk_live_..."
  echo "  STRIPE_WEBHOOK_SECRET=whsec_..."
  echo "  STRIPE_PRICE_STARTER=price_..."
  echo "  STRIPE_PRICE_PRO=price_..."
  echo "  STRIPE_PRICE_ENTERPRISE=price_..."
  echo ""

  step "Add Persistent Volume"
  info "Railway dashboard → Service → Volumes → Add Volume"
  info "Mount path: /app/data"
  echo ""

  read -p "  Have you set the env vars and volume? (y/n): " confirmed
  if [ "$confirmed" = "y" ]; then
    info "Deploying..."
    railway up
    ok "Deployed to Railway!"
    echo ""
    info "Get your URL: railway open"
    info "Don't forget to update your Stripe webhook URL!"
  else
    info "Set them up, then run: railway up"
  fi
}

# ----- Docker Local -----
deploy_docker() {
  step "Docker Build & Run"

  if ! command -v docker &>/dev/null; then
    fail "Docker not found. Install from https://docker.com"
    exit 1
  fi
  ok "Docker available"

  info "Building Docker image..."
  docker build -t agent-toolbelt:latest .
  ok "Image built: agent-toolbelt:latest"

  # Create data volume if it doesn't exist
  docker volume create toolbelt-data 2>/dev/null || true

  info "Starting container..."
  docker run -d \
    --name agent-toolbelt \
    -p 3000:3000 \
    -v toolbelt-data:/app/data \
    -e API_KEY_SECRET="${API_KEY_SECRET:-dev-secret-change-me}" \
    -e NODE_ENV=production \
    -e USAGE_TRACKING_ENABLED=true \
    agent-toolbelt:latest

  sleep 3

  if curl -sf http://localhost:3000/api > /dev/null 2>&1; then
    ok "Container running at http://localhost:3000"
    echo ""
    info "View logs:  docker logs agent-toolbelt"
    info "Stop:       docker stop agent-toolbelt && docker rm agent-toolbelt"
  else
    fail "Container started but health check failed"
    info "Check logs: docker logs agent-toolbelt"
  fi
}

# ----- Stripe Setup Guide -----
stripe_setup() {
  step "Stripe Setup Guide"
  echo ""
  info "1. Create a Stripe account at https://dashboard.stripe.com/register"
  echo ""
  info "2. Create a product:"
  info "   Dashboard → Products → Add product → Name: 'Agent Toolbelt'"
  echo ""
  info "3. Create 3 recurring monthly prices:"
  info "   • Starter: \$29/month  → copy price ID (price_...)"
  info "   • Pro:     \$99/month  → copy price ID (price_...)"
  info "   • Enterprise: \$499/month → copy price ID (price_...)"
  echo ""
  info "4. Get your API keys:"
  info "   Dashboard → Developers → API keys"
  info "   • Copy Secret key (sk_live_...)"
  echo ""
  info "5. Set up webhook:"
  info "   Dashboard → Developers → Webhooks → Add endpoint"
  info "   • URL: https://YOUR_DOMAIN/stripe/webhook"
  info "   • Events to listen for:"
  info "     - checkout.session.completed"
  info "     - customer.subscription.updated"
  info "     - customer.subscription.deleted"
  info "     - invoice.payment_failed"
  info "   • Copy Signing secret (whsec_...)"
  echo ""
  info "6. Add to your .env or deployment env vars:"
  echo ""
  echo "  STRIPE_SECRET_KEY=sk_live_..."
  echo "  STRIPE_WEBHOOK_SECRET=whsec_..."
  echo "  STRIPE_PRICE_STARTER=price_..."
  echo "  STRIPE_PRICE_PRO=price_..."
  echo "  STRIPE_PRICE_ENTERPRISE=price_..."
  echo ""

  if command -v stripe &>/dev/null; then
    ok "Stripe CLI detected"
    info "Test webhooks locally with:"
    info "  stripe listen --forward-to localhost:3000/stripe/webhook"
  else
    info "Optional: Install Stripe CLI for local webhook testing:"
    info "  brew install stripe/stripe-cli/stripe  (macOS)"
    info "  https://stripe.com/docs/stripe-cli     (other)"
  fi
}

# ----- Post-Deploy Verification -----
verify_deploy() {
  local URL="$1"
  step "Verifying Deployment: $URL"

  # Health
  if curl -sf "$URL/api" > /dev/null 2>&1; then
    ok "Health check passed"
  else
    fail "Health check failed — is the URL correct?"
    return 1
  fi

  # Catalog
  if curl -sf "$URL/api/tools/catalog" | grep -q "schema-generator"; then
    ok "Tool catalog working"
  else
    fail "Tool catalog not responding"
  fi

  # Docs
  if curl -sf "$URL/api/docs" | grep -q "Agent Toolbelt"; then
    ok "API docs endpoint working"
  else
    warn "API docs not responding"
  fi

  # OpenAPI spec
  if curl -sf "$URL/openapi/openapi-gpt-actions.json" | grep -q "openapi"; then
    ok "OpenAPI spec accessible (for GPT Actions)"
  else
    warn "OpenAPI spec not found"
  fi

  # Registration
  REG=$(curl -sf -X POST "$URL/api/clients/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"verify-$(date +%s)@test.com\"}" 2>/dev/null || echo "")
  if echo "$REG" | grep -q "atb_"; then
    ok "Client registration working"
  else
    warn "Registration test inconclusive"
  fi

  # Landing page
  if curl -sf "$URL/" | grep -q "Agent Toolbelt"; then
    ok "Landing page serving"
  else
    warn "Landing page not found"
  fi

  echo ""
  ok "Deployment verified!"
  echo ""
  info "Your API is live at: $URL"
  info "Catalog:  $URL/api/tools/catalog"
  info "Docs:     $URL/api/docs"
  info "Register: POST $URL/api/clients/register"
  echo ""
  info "Next steps:"
  info "  1. Set up Stripe (run: ./deploy.sh stripe-setup)"
  info "  2. Update Stripe webhook URL to: $URL/stripe/webhook"
  info "  3. Update OpenAPI spec servers URL to: $URL"
  info "  4. List on RapidAPI for organic discovery"
}

# ----- Interactive Mode -----
interactive() {
  print_banner

  check_prereqs
  check_env
  build_project
  test_local
  setup_git

  echo ""
  step "Choose Deployment Platform"
  echo ""
  echo "  1) Railway     — Recommended, ~\$5/mo, Docker support, persistent volumes"
  echo "  2) Render       — Simple, \$7/mo, auto-deploy from GitHub"
  echo "  3) Docker local — Build and run locally for testing"
  echo "  4) Skip         — Just validate, don't deploy yet"
  echo ""
  read -p "  Choose (1-4): " choice

  case $choice in
    1) deploy_railway ;;
    2)
      step "Render Deployment"
      info "Render deploys directly from GitHub using render.yaml"
      info "1. Push your repo to GitHub"
      info "2. Go to https://render.com → New → Web Service"
      info "3. Connect your GitHub repo"
      info "4. Render auto-detects render.yaml"
      info "5. Set environment variables in the Render dashboard"
      info "6. Add a disk: mount path /app/data, size 1 GB"
      info "7. Deploy!"
      ;;
    3) deploy_docker ;;
    4) info "Skipping deployment — everything validated!" ;;
    *) warn "Invalid choice" ;;
  esac

  echo ""
  read -p "  Verify a deployment? Enter URL (or press Enter to skip): " deploy_url
  if [ -n "$deploy_url" ]; then
    verify_deploy "$deploy_url"
  fi

  echo ""
  ok "Done! 🎉"
}

# ----- Entry Point -----
case "${1:-interactive}" in
  check)        print_banner; check_prereqs; check_env ;;
  railway)      print_banner; check_prereqs; build_project; deploy_railway ;;
  render)       print_banner; info "See Render instructions in SETUP.md" ;;
  docker)       print_banner; check_prereqs; build_project; deploy_docker ;;
  stripe-setup) print_banner; stripe_setup ;;
  verify)       print_banner; verify_deploy "${2:-http://localhost:3000}" ;;
  interactive)  interactive ;;
  *)            echo "Usage: ./deploy.sh [check|railway|docker|stripe-setup|verify <url>]" ;;
esac
