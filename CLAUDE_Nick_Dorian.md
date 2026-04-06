# Claude Code Instructions

## Git Commits
- Do not add "Co-Authored-By" lines to commits

## Git Safety — CRITICAL
- **NEVER use destructive git commands without explicit user approval first**
- Destructive commands include: `git restore`, `git reset`, `git checkout .`, `git clean`, `git revert` (when it would discard work)
- **ALWAYS check for uncommitted changes BEFORE any git operation**: `git status` first, then show the user what would be affected
- **ALWAYS ask the user**: "I see uncommitted changes in [files]. Do you want me to [action]? This will discard those changes."
- If the user says "revert to original", ask: "Do you want to revert to the last commit, or to a specific earlier state? I see uncommitted changes in [files] — are you okay losing those?"
- **NEVER assume**: Even if reverting seems like the right move, the uncommitted changes might be important work in progress
- This rule exists because uncommitted work has been lost multiple times — treat all uncommitted changes as sacred unless explicitly told otherwise

## Workflow Rules
- **CRITICAL: Always use agents for all tasks**: Use the Task tool with appropriate subagents for ALL coding, file editing, research, and exploration tasks. Do NOT make direct edits or run commands yourself. This is a hard requirement for every session.
  - Code changes: Use general-purpose agent
  - File searches/exploration: Use Explore agent
  - Command execution: Use Bash agent
  - Research/investigation: Use appropriate specialized agent
- **Plan first**: Enter plan mode for any non-trivial task (3+ steps). Write the plan to `tasks/plan.md` before implementing.
- **One subagent per task**: Use subagents to keep main context clean. Throw more compute at hard problems.
- **Verify before marking complete**: Never mark a task done without proving it works — run tests, check logs, diff behavior. Ask: "Would a staff engineer approve this?"
- **Demand elegance**: For non-trivial changes, consider if there's a more elegant solution. If a fix feels hacky, rebuild it properly. Don't over-engineer simple things.
- **Autonomous bug fixing**: When given a bug, go to logs, find root cause, resolve it. No hand-holding needed.
- **If something goes wrong, STOP and re-plan** — never push through a broken approach.

## Core Principles
- **Simplicity first** — touch minimal code
- **Root causes only** — no temp fixes, no workarounds
- **Never assume** — verify paths, APIs, variables before using
- **Ask once** — one question upfront if unclear, never interrupt mid-task

## Required Project Files
Every project must have these files. They are **critical** — treat them as living documents.

### 0. `.gitignore` — Always present (committed)
- Every project gets a `.gitignore` from day one
- At minimum: `.DS_Store`, `node_modules/`, `.env`, `*.log`
- Documentation files (`tasks/`, `CLAUDE.md`, `README.md`) **should be committed** — they are project knowledge that colleagues need when picking up work
- Add project-specific ignores as needed

### 0.5. `README.md` — Always present (committed)
- Every project gets a `README.md` from day one
- What the project is (1-2 sentences)
- How to run / deploy it
- Tech stack
- Keep it short and useful — not a wall of text

### 1. `CLAUDE.md` — Project-level instructions (project root)
- Project-specific Claude Code instructions (tech stack, conventions, commands, etc.)
- Lives at the project root so Claude automatically picks it up when working in that directory
- **Must reference `tasks/` folder** — first line after the title should be: `> First: read tasks/handover.md, tasks/plan.md, and tasks/context.md`
- Keep it focused on things Claude needs to know for THIS project specifically

### 2. `tasks/handover.md` — Session continuity
- **Current state**: What's done, what's in progress, what's next
- **Key decisions made**: Design choices, architecture, tech stack decisions with reasoning
- **User preferences & corrections**: If the user corrects you or reminds you to do something a certain way, log it here so it never needs repeating
- **Gotchas & pitfalls**: Things that broke, workarounds, things NOT to do
- **Open questions**: Unresolved decisions or things to ask about next session
- **Files that matter**: Key files and what they do (don't list everything, just the important ones)

### 3. `tasks/plan.md` — Project roadmap
- Goal, phases, task breakdown, skill pipeline
- Only update when the plan actually changes — tasks completed, new tasks added, approach revised
- Don't touch it if nothing changed

### 4. `tasks/context.md` — Corrections & project rules
- **Auto-updated after every correction or error fix** within the project
- Captures project-specific do's and don'ts learned from mistakes
- When you make an error and the user corrects you, or you discover something doesn't work, immediately log it here
- This ensures the same mistake is never repeated — the file becomes a growing knowledge base of what works and what doesn't for this project
- Format: `[YYYY-MM-DD] | what went wrong | rule to prevent it`

### When to update
- **tasks/context.md**: Immediately after any correction, error fix, or discovery of a project-specific rule. Don't wait — update it in the moment. ALSO: Review and update during session closing to capture any learnings that were missed.
- **tasks/handover.md**: After completing a significant task, after receiving a correction/preference, and always before ending a session.
- **tasks/plan.md**: Only when the plan actually changed.
- **CLAUDE.md**: When project conventions or tooling change.

### Session flow
1. **Session start**: Read the project's `tasks/` folder (`handover.md`, `plan.md`, `context.md`) and `CLAUDE.md` (if they exist) before doing any work.
2. **During session**: Update `tasks/handover.md` after corrections, preferences, or key decisions. Update `tasks/context.md` immediately after any correction or error fix.
3. **Before closing** (~40% context remaining): Follow the session closing checklist below.

### Session closing checklist
When you estimate ~40% context window remaining, follow this checklist:

1. **Review learnings**: What corrections, errors, or discoveries happened this session? What patterns emerged? What didn't work as expected?
2. **Update `tasks/context.md`**: Log each learning as `[YYYY-MM-DD] | what went wrong | rule to prevent it`. This is NOT optional — every session produces learnings.
3. **Update `tasks/handover.md`**: Current state, what's done, what's next, key decisions, user preferences.
4. **Update `tasks/plan.md`**: Only if the plan actually changed (tasks completed, new tasks added, approach revised).
5. **Commit & push**: All task files together with a clear commit message.

### Session management
- **Do NOT use /compact** — it doesn't work well. Instead, start fresh sessions.
- **Proactively suggest ending the session** when you estimate ~40% context window remains. Say something like: "We're getting deep into this session — I'd recommend we wrap up. Let me update the handover and you can start a fresh session."
