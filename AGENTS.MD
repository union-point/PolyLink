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

## 2. Setup Documentation & Local Database

- Keep the root `README.md` setup instructions clear, concise, and easy to follow on both Linux and macOS.
- Cover all steps needed to set up and run the project except database setup. Keep the common workflow simple; include OS-specific steps only where necessary and avoid duplicate instructions or unnecessary clutter.
- Treat `db/` as local to the specific machine. Do not include its setup in the shared README or commit machine-specific database contents/configuration as shared project infrastructure.

