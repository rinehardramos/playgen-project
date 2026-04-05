# Lessons Learned

> This file is the agent's self-improvement log. Every correction, mistake, or insight gets recorded here as a rule.
> Review this file at the start of every session.

---

## [process] Always verify PATH before declaring a tool missing — YYYY-MM-DD

**Trigger**: Tool returned "command not found" but was actually installed via Homebrew/nvm/cargo.

**Rule**: Before declaring any tool missing, ALWAYS try expanding PATH variants: `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`. Only ask the user after exhausting PATH checks.

**Why**: Shell environments don't source `.zshrc`/`.bashrc`, so tools installed by package managers are path-dependent.

**Example**:
```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && which gh
```

---

## [process] Fix root causes, never workarounds — YYYY-MM-DD

**Trigger**: Implemented a bandaid fix instead of diagnosing the actual root cause.

**Rule**: ALWAYS diagnose the actual root cause before writing any fix. Never patch symptoms. If a fix feels like a bandaid (skipping a step, hardcoding, special-casing), stop and find why the underlying system is broken.

**Why**: Workarounds compound. They hide real bugs, create technical debt, and cause harder failures later.

**How to apply**: Before changing a line of code, write down what EXACTLY is broken and why. If you can't explain the root cause in one sentence, keep investigating.

---

<!-- Add new lessons below in this format:

## [category] Short title — YYYY-MM-DD

**Trigger**: What went wrong or what was corrected
**Rule**: The rule to follow going forward (ALWAYS/NEVER format)
**Why**: Root cause explanation
**Example**: Concrete code or command example if applicable

Categories: [architecture] [testing] [deployment] [code-quality] [process] [tooling] [dependencies]
-->
