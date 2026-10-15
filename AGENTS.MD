# Agent Execution & Git Workflow Rules

This document outlines  instructions for AI agents working in this repository.

## 1. Git & Commit Guidelines 

### Atomic Commits Policy
- **DO NOT** make all code changes in a single massive dump.
- Divide every task into small, logical, self-contained sub-tasks.
- After completing each logical sub-task  **execute a local `git commit` immediately**.
- Never commit broken or non-compiling code. Every single commit in the branch history must build cleanly.

### Conventional Commits Format
Use the Conventional Commits specification for all commit messages:
`type: short imperative description`


Rules for message body:
- Use present tense, imperative mood ("add", not "added" or "adds").
- Do not capitalize the first letter of the short description.
- Do not put a period (.) at the end.

### Safety Limits & Remote Operations
- **DO NOT** execute `git push` automatically unless explicitly instructed by the user. Keep all commits in the local branch.
- **DO NOT** perform destructive actions (`git rebase`, `git reset --hard`, `git push --force`).
- **DO NOT** commit untracked files like `.env`, binaries, or generated artifacts.

---

