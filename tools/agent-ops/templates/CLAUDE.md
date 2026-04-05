# {{PROJECT_NAME}} - CLAUDE.md

## Agent Intelligence & Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how
- After EVERY git push, you MUST actively monitor the CI/CD pipeline status (e.g., using `gh run list` and `gh run view`). If the pipeline fails, diagnose the trace logs and resolve all issues autonomously until the build is perfectly green.

### 7. L2 Memory Integration (Optional)
- For every complex issue, architectural roadblock, or bug that is successfully resolved, consider embedding the context and fix into a knowledge base.
- This creates a persistent institutional memory for future agents.

## Task Management & Organization

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

---

## Self-Improvement Loop System

### How It Works

Every session begins and ends with a feedback cycle:

1. **Session Start**: Read `tasks/lessons.md` to load all known patterns and anti-patterns
2. **During Work**: When corrected by the user or when a mistake is caught:
   - Immediately append to `tasks/lessons.md` with date, context, and the rule
   - Categorize: `[architecture]`, `[testing]`, `[deployment]`, `[code-quality]`, `[process]`
   - Write the lesson as a **rule**, not a story (e.g., "ALWAYS do X" or "NEVER do Y")
3. **Before Completion**: Review your own work against all lessons in `tasks/lessons.md`
4. **Session End**: If new lessons were learned, ensure they are persisted

### Lesson Format

```markdown
## [category] Short title — YYYY-MM-DD

**Trigger**: What went wrong or what was corrected
**Rule**: The rule to follow going forward (ALWAYS/NEVER format)
**Why**: Root cause explanation
**Example**: Concrete code or command example if applicable
```

### Escalation Protocol

- 1st occurrence: Add lesson to `tasks/lessons.md`
- 2nd occurrence of same pattern: Promote to CLAUDE.md under Core Principles
- 3rd occurrence: Add automated check (test, lint rule, or pre-commit hook)

---

## Project Structure & Stack

### Architecture Overview

{{PROJECT_NAME}} is a <!-- describe your system here -->.

```
{{PROJECT_NAME}}/
├── <!-- add your directory structure here -->
└── tasks/            # Todo tracking and lessons learned
```

### Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | <!-- e.g. Node.js 20, TypeScript, Fastify --> |
| **Frontend** | <!-- e.g. Next.js 14, Tailwind CSS --> |
| **Database** | <!-- e.g. PostgreSQL 16 --> |
| **Package Manager** | <!-- e.g. pnpm 9.0 --> |

### Key Commands

```bash
# Install dependencies
<!-- package manager install command -->

# Development
<!-- dev command -->

# Testing
<!-- test command -->

# Build
<!-- build command -->
```

### Environment

- `.env.example` has all required vars
- <!-- describe any default credentials or important env notes -->

### Agent Workflow

- Read `tasks/agent-collab.md` before starting any task
- Never claim a ticket that is already in Active Work
- Update agent-collab.md atomically with your PR
- Branch naming: `fix/issue-N` for bugs, `feat/issue-N` for features
- Base branch: `main`
