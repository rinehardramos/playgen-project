#!/usr/bin/env bash
# project-health.sh — Generic project health checker
# Compatible with Bash 3+ (no associative arrays)
#
# Usage:
#   bash scripts/project-health.sh [OPTIONS]
#
# Options:
#   --todo-file PATH   Path to TODO.md (default: tasks/TODO.md)
#   --ci               Exit 1 if any incomplete P0 item is found
#   --help             Show this message
#
# Reads tasks/TODO.md (or --todo-file), counts [x] vs [ ] per ## Phase/Milestone section,
# reports a completion % table, and optionally exits 1 on P0 blockers.

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
TODO_FILE="tasks/TODO.md"
CI_MODE=0

# ── Argument parsing ──────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        --todo-file)
            TODO_FILE="$2"
            shift 2
            ;;
        --ci)
            CI_MODE=1
            shift
            ;;
        --help|-h)
            sed -n '/^# project-health/,/^[^#]/p' "$0" | head -20
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# ── Check file exists ─────────────────────────────────────────────────────────
if [ ! -f "$TODO_FILE" ]; then
    echo "⚠️  TODO file not found: $TODO_FILE"
    echo "   Create tasks/TODO.md or pass --todo-file <path>"
    exit 0
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Project Health Check"
echo "  File: $TODO_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Parse phases and count items ──────────────────────────────────────────────
# Uses parallel arrays (Bash 3 compatible) instead of associative arrays.
# Arrays: phase_names[], phase_done[], phase_total[]

phase_names=()
phase_done=()
phase_total=()

current_phase=""
cur_done=0
cur_total=0

save_phase() {
    if [ -n "$current_phase" ]; then
        phase_names+=("$current_phase")
        phase_done+=("$cur_done")
        phase_total+=("$cur_total")
    fi
}

while IFS= read -r line; do
    # Detect a new phase/milestone heading (## or ###)
    if echo "$line" | grep -qE '^#{2,3} '; then
        save_phase
        # Strip leading # characters and whitespace
        current_phase=$(echo "$line" | sed 's/^#\+ *//')
        cur_done=0
        cur_total=0
        continue
    fi

    # Count completed items: - [x] or * [x]
    if echo "$line" | grep -qE '^\s*[-*]\s+\[x\]'; then
        cur_done=$((cur_done + 1))
        cur_total=$((cur_total + 1))
    # Count incomplete items: - [ ] or * [ ]
    elif echo "$line" | grep -qE '^\s*[-*]\s+\[ \]'; then
        cur_total=$((cur_total + 1))
    fi
done < "$TODO_FILE"

# Save last phase
save_phase

# ── Print table ───────────────────────────────────────────────────────────────
total_done=0
total_items=0
any_phase_incomplete=0

printf "\n  %-40s %8s %8s %6s\n" "Phase / Milestone" "Done" "Total" "Progress"
printf "  %-40s %8s %8s %6s\n" "─────────────────────────────────────────" "────────" "────────" "──────"

i=0
while [ $i -lt ${#phase_names[@]} ]; do
    name="${phase_names[$i]}"
    done="${phase_done[$i]}"
    total="${phase_total[$i]}"

    if [ "$total" -gt 0 ]; then
        pct=$(( done * 100 / total ))
    else
        pct=100
    fi

    # Build a simple bar (10 chars wide)
    filled=$(( pct / 10 ))
    bar=""
    j=0
    while [ $j -lt 10 ]; do
        if [ $j -lt $filled ]; then
            bar="${bar}█"
        else
            bar="${bar}░"
        fi
        j=$((j + 1))
    done

    printf "  %-40s %8s %8s %5s%%  %s\n" \
        "${name:0:40}" "$done" "$total" "$pct" "$bar"

    total_done=$((total_done + done))
    total_items=$((total_items + total))

    if [ "$done" -lt "$total" ]; then
        any_phase_incomplete=1
    fi

    i=$((i + 1))
done

# Overall summary
printf "  %-40s %8s %8s %6s\n" "─────────────────────────────────────────" "────────" "────────" "──────"
if [ "$total_items" -gt 0 ]; then
    overall_pct=$(( total_done * 100 / total_items ))
else
    overall_pct=100
fi
printf "  %-40s %8s %8s %5s%%\n\n" "TOTAL" "$total_done" "$total_items" "$overall_pct"

# ── P0 blocker check ──────────────────────────────────────────────────────────
p0_blockers=0

if grep -qiE '\[ \].*P0|P0.*\[ \]' "$TODO_FILE" 2>/dev/null; then
    echo "  ⛔ P0 BLOCKERS (incomplete):"
    grep -nE '\[ \].*P0|P0.*\[ \]' "$TODO_FILE" | while IFS= read -r bl; do
        echo "     $bl"
    done
    p0_blockers=1
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$p0_blockers" -eq 1 ]; then
    echo "  Status: ⛔ BLOCKED — P0 items must be resolved first"
elif [ "$any_phase_incomplete" -eq 1 ]; then
    echo "  Status: 🔄 IN PROGRESS — ${overall_pct}% complete"
else
    echo "  Status: ✅ ALL DONE — ${overall_pct}% complete"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── CI exit code ─────────────────────────────────────────────────────────────
if [ "$CI_MODE" -eq 1 ] && [ "$p0_blockers" -eq 1 ]; then
    exit 1
fi

exit 0
