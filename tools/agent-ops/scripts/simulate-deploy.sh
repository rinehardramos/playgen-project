#!/usr/bin/env bash
# simulate-deploy.sh — Local pre-deployment simulation
# Runs production build steps locally before CD pipeline to catch failures early.
#
# Usage:
#   bash scripts/simulate-deploy.sh [OPTIONS]
#
# Options:
#   --vercel              Simulate Vercel frontend build
#   --docker              Build all Docker service images
#   --all                 Run both --vercel and --docker
#   --services a,b,c      Comma-separated Docker service list (overrides config)
#   --frontend-dir PATH   Frontend directory (default: frontend)
#   --config PATH         Path to project.config.json
#   --help                Show this message
#
# If project.config.json is present, reads docker_services and frontend_dir from it.

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
RUN_VERCEL=0
RUN_DOCKER=0
SERVICES_OVERRIDE=""
FRONTEND_DIR=""
CONFIG_FILE=""

# Auto-detect config file location
for candidate in \
    "tools/agent-ops/project.config.json" \
    "project.config.json" \
    "../project.config.json"; do
    if [ -f "$candidate" ]; then
        CONFIG_FILE="$candidate"
        break
    fi
done

# ── Argument parsing ──────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        --vercel)       RUN_VERCEL=1; shift ;;
        --docker)       RUN_DOCKER=1; shift ;;
        --all)          RUN_VERCEL=1; RUN_DOCKER=1; shift ;;
        --services)     SERVICES_OVERRIDE="$2"; shift 2 ;;
        --frontend-dir) FRONTEND_DIR="$2"; shift 2 ;;
        --config)       CONFIG_FILE="$2"; shift 2 ;;
        --help|-h)
            sed -n '/^# simulate-deploy/,/^[^#]/p' "$0" | head -20
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

if [ "$RUN_VERCEL" -eq 0 ] && [ "$RUN_DOCKER" -eq 0 ]; then
    echo "Usage: $0 [--vercel] [--docker] [--all]"
    echo "Run with --help for full options."
    exit 1
fi

# ── Load config values ────────────────────────────────────────────────────────
if [ -f "$CONFIG_FILE" ]; then
    echo "📋 Reading config: $CONFIG_FILE"

    # Parse docker_services array from JSON (requires python3 or jq)
    if [ -z "$SERVICES_OVERRIDE" ]; then
        if command -v python3 >/dev/null 2>&1; then
            SERVICES_OVERRIDE=$(python3 -c "
import json, sys
with open('$CONFIG_FILE') as f:
    cfg = json.load(f)
services = cfg.get('tech', {}).get('docker_services', [])
print(','.join(services))
" 2>/dev/null || echo "")
        elif command -v jq >/dev/null 2>&1; then
            SERVICES_OVERRIDE=$(jq -r '.tech.docker_services // [] | join(",")' "$CONFIG_FILE" 2>/dev/null || echo "")
        fi
    fi

    if [ -z "$FRONTEND_DIR" ]; then
        if command -v python3 >/dev/null 2>&1; then
            FRONTEND_DIR=$(python3 -c "
import json
with open('$CONFIG_FILE') as f:
    cfg = json.load(f)
print(cfg.get('deploy', {}).get('frontend_dir', 'frontend'))
" 2>/dev/null || echo "frontend")
        elif command -v jq >/dev/null 2>&1; then
            FRONTEND_DIR=$(jq -r '.deploy.frontend_dir // "frontend"' "$CONFIG_FILE" 2>/dev/null || echo "frontend")
        else
            FRONTEND_DIR="frontend"
        fi
    fi
else
    echo "⚠️  No config file found — using defaults"
fi

FRONTEND_DIR="${FRONTEND_DIR:-frontend}"

# ── Tracking ──────────────────────────────────────────────────────────────────
PASS=0
FAIL=0
RESULTS=()

report() {
    local label="$1"
    local status="$2"
    local detail="${3:-}"
    if [ "$status" = "pass" ]; then
        PASS=$((PASS + 1))
        RESULTS+=("  ✅ $label")
    else
        FAIL=$((FAIL + 1))
        RESULTS+=("  ❌ $label${detail:+: $detail}")
    fi
}

# ── Vercel simulation ─────────────────────────────────────────────────────────
if [ "$RUN_VERCEL" -eq 1 ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Simulating Vercel frontend build"
    echo "  Directory: $FRONTEND_DIR"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if [ ! -d "$FRONTEND_DIR" ]; then
        report "Vercel build" "fail" "Directory not found: $FRONTEND_DIR"
    else
        # Detect package manager
        PKG_MANAGER="npm"
        if [ -f "$FRONTEND_DIR/pnpm-lock.yaml" ] || [ -f "pnpm-lock.yaml" ]; then
            PKG_MANAGER="pnpm"
        elif [ -f "$FRONTEND_DIR/yarn.lock" ]; then
            PKG_MANAGER="yarn"
        fi

        echo "  Package manager: $PKG_MANAGER"
        echo ""

        # Install step
        echo "  → Installing dependencies (frozen lockfile)..."
        if (cd "$FRONTEND_DIR" && NODE_ENV=production $PKG_MANAGER install --frozen-lockfile 2>&1); then
            report "Vercel install" "pass"
        else
            report "Vercel install" "fail" "Dependency install failed"
        fi

        # Build step
        echo "  → Building..."
        if (cd "$FRONTEND_DIR" && NODE_ENV=production $PKG_MANAGER run build 2>&1); then
            report "Vercel build" "pass"
        else
            report "Vercel build" "fail" "Build failed"
        fi
    fi
fi

# ── Docker simulation ─────────────────────────────────────────────────────────
if [ "$RUN_DOCKER" -eq 1 ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Simulating Docker builds"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if [ -z "$SERVICES_OVERRIDE" ]; then
        echo "  ⚠️  No services configured. Pass --services auth,web,... or set tech.docker_services in config."
    else
        # Convert comma-separated to array
        IFS=',' read -ra SERVICES <<< "$SERVICES_OVERRIDE"

        for svc in "${SERVICES[@]}"; do
            svc=$(echo "$svc" | tr -d ' ')
            [ -z "$svc" ] && continue

            # Find Dockerfile — check common locations
            DOCKERFILE=""
            CONTEXT="."
            for path in \
                "services/$svc/Dockerfile" \
                "$svc/Dockerfile" \
                "apps/$svc/Dockerfile"; do
                if [ -f "$path" ]; then
                    DOCKERFILE="$path"
                    break
                fi
            done

            if [ -z "$DOCKERFILE" ]; then
                report "Docker $svc" "fail" "Dockerfile not found"
                continue
            fi

            echo "  → Building $svc ($DOCKERFILE)..."
            if docker build -f "$DOCKERFILE" -t "simulate-$svc:test" "$CONTEXT" --quiet 2>&1; then
                report "Docker $svc" "pass"
                # Clean up test image
                docker rmi "simulate-$svc:test" >/dev/null 2>&1 || true
            else
                report "Docker $svc" "fail" "Build failed"
            fi
        done
    fi
fi

# ── Final report ──────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Simulation Results"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for r in "${RESULTS[@]}"; do
    echo "$r"
done
echo ""
echo "  Passed: $PASS  Failed: $FAIL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$FAIL" -gt 0 ]; then
    echo "  ❌ Simulation FAILED — fix issues before pushing to main"
    exit 1
else
    echo "  ✅ Simulation PASSED — safe to push"
    exit 0
fi
