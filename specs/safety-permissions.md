# SCALER Safety, Permissions, and Secure Development Spec

## Purpose

Scaler may run for long periods and perform real project changes. It must protect the project, machine, secrets, users, and external systems.

Safety rules are deterministic policy gates around agent and tool execution.

## Principles

- Default safe behavior.
- Least privilege per task agent.
- No silent high-risk actions.
- Protect secrets and private data.
- Keep actions inside the project boundary unless approved.
- Prefer reversible actions and checkpoints.
- Prefer sandboxed execution for unattended risky work.
- Apply secure-development practices by default.

## Risk levels

Actions should be classified as:

- `low` — read-only project inspection and harmless status commands.
- `medium` — project file edits, dependency install, local build/test commands.
- `high` — auth, permissions, crypto, migrations, CI/CD, infrastructure, package manager scripts.
- `destructive` — delete, overwrite, reset, clean, drop database, irreversible changes.
- `external` — deploy, publish, mutate remote APIs, send project/private data to internet.
- `secret` — read, write, log, transmit, or transform credentials/secrets.

## Approval gates

Require explicit approval or configured policy allowance for:

- destructive file operations
- protected path access
- secret access or transmission
- deployment/publishing
- production or remote service mutations
- force push, reset, clean, rebase, history rewrite
- running unknown scripts
- installing global/system packages
- internet transmission of private code/data
- security-sensitive code changes

If approval is unavailable, task should pause with a clear blocked report, unless the action can be safely moved into an approved sandbox environment.

## Protected paths and data

Protected examples:

- `.env`, `.env.*`
- `*.pem`, `*.key`, `*.p12`, `*.crt`
- SSH keys and config
- cloud credentials/config
- password/token files
- `.git/`
- system folders outside the project
- production deployment configs

Secrets must not be injected into LLM context, internet requests, or logs. Logs should redact known secret patterns.

## Agent permission manifest

Each task/tool agent should receive an explicit permission manifest:

- allowed tools
- allowed paths
- allowed network access
- allowed write scope
- allowed risk level
- approval requirements
- forbidden actions

Agents must request permission instead of bypassing the manifest.

## Internet policy

Internet access should be controlled and logged.

Allowed when configured:

- documentation lookup following `specs/research.md`
- CVE/security research
- package metadata checks
- official sources and trusted references

Restricted:

- uploading private code/data
- sending secrets
- unknown endpoints
- executing downloaded scripts without review

## Secure development

Scaler should follow security-by-design when creating or modifying software.

Agents should avoid:

- hardcoded secrets
- unsafe eval/exec/deserialization
- injection vulnerabilities
- weak crypto or custom crypto
- insecure defaults
- missing authentication/authorization checks
- unsafe file/path handling
- leaking sensitive data in logs/errors
- disabling security checks to make tests pass

Security-sensitive changes should be explicitly identified in task reports and validated with stronger review.

## Dependency and image security

When software tasks introduce or update dependencies, containers, or third-party modules, Scaler should check for known vulnerabilities where tools are available.

Applicable checks:

- package manager audit (`npm audit`, `pnpm audit`, `pip-audit`, `cargo audit`, etc.)
- container/image scan (`trivy`, `grype`, or available equivalent)
- dependency lockfile review
- license/policy checks when configured
- review of install scripts and postinstall behavior for high-risk packages

If scanners are unavailable, report the limitation and request setup or approval.

## Sandboxed execution

Scaler should prefer controlled sandbox environments for unattended execution.

Inside an approved sandbox, some actions may be allowed without repeated approval if they are contained and cannot harm the host, production systems, secrets, or external users.

Sandbox exceptions must be explicit, logged, and limited to the sandbox boundary.

They must not allow:

- host destructive operations
- access to real secrets
- deployment or publishing
- production or external service mutation
- unrestricted host filesystem access
- uncontrolled network exfiltration

## Docker/container safety

Docker, dev-container, Compose, and Minikube usage should also follow `specs/cicd-environment.md`.

Docker images and dev containers should:

- use trusted base images where possible
- avoid running as root when practical
- minimize installed packages
- pin versions when useful
- avoid embedding secrets
- be scanned for CVEs where tools are available
- separate dev/test from production credentials

## Blocked action report

When an action is blocked, report:

- action requested
- risk level
- policy rule triggered
- required approval or configuration
- safer alternative, if any
- effect on current task

## Logging

Log safety decisions, approvals, blocked actions, security scans, scanner limitations, and policy overrides according to `specs/logging.md`.

Do not log raw secrets.
