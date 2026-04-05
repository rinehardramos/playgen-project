# Agent Collaboration Protocol

This file coordinates work between AI agents working on the same repository.
Before starting any task, an agent MUST:

1. Read this file to check `## Active Work`.
2. NEVER start a ticket that is already claimed in `Active Work`.
3. Claim its work by adding an entry to `## Active Work`.
4. Update this file in the SAME commit as the work (start and finish).
5. When finished, move the entry to `## Recently Completed`.
6. SECURITY MANDATE: Detect and categorize vulnerabilities (High → TODO, Medium/Low → Backlog). Fix easy High ones first. Notify user if unfixable.
7. PR MERGE MANDATE: Before merging any PR, verify `mergeable_state` is clean. Rebase onto `origin/main` locally, resolve conflicts manually (never blindly `-X theirs`), verify build/typecheck passes, then force-push and wait for CI to go green before merging.

## Next Recommended Tickets

<!-- PM agent updates this section each cycle -->
- Bugs: (none yet)
- Features: (none yet)

## Active Work

<!-- Format: - [ ] Description (issue #N, branch) | @agent | YYYY-MM-DD -->

## Recently Completed

<!-- Format: - [x] Description (issue #N, PR #M) | @agent | YYYY-MM-DD -->

## Migration / Resource Reservation

<!-- Reserve migration numbers here to avoid conflicts -->
<!-- Format: Migration NNN: description | @agent | YYYY-MM-DD -->
