# SCALER CI/CD Environment Spec

## Purpose

Scaler should be able to build local validation environments for different software stacks when required by the PRD or planning decision.

The goal is to make build, test, integration, deployment, and acceptance validation reproducible on the local machine where possible.

## Principle

Prefer local, reproducible, isolated validation over assumptions.

Use Docker, dev containers, Docker Compose, and Minikube when they are available and appropriate for the project.

Controlled CI/CD environments are also a safety mechanism. When Scaler can run work inside an isolated sandbox, it can execute more unattended steps without asking for approval on every action.

## Sandbox safety model

A sandboxed environment may allow actions that would be risky on the host, but only inside the controlled boundary.

Sandbox requirements:

- no production credentials
- no host-sensitive paths mounted writable
- limited project/path mounts
- explicit network policy when possible
- resource limits when possible
- clear cleanup behavior
- logs/artifacts stored by reference
- generated images/containers scanned when tools are available

Security exceptions are allowed only when the impact is contained inside the sandbox and the exception is recorded in logs.

Host-level destructive actions, secret access, deployment, publishing, and external mutations still require safety policy approval.

## Environment options

Scaler may use:

- native project commands when sufficient
- Dockerfile or generated Dockerfile
- Docker Compose for multi-service dependencies
- dev containers for repeatable development/test environments
- Minikube for Kubernetes-style deployment and acceptance testing
- local CI scripts that mimic the real CI pipeline

## Planning requirement

If the PRD includes software, Stage III should decide whether CI/CD environment setup is needed.

The plan should define:

- target software stack
- required build commands
- required test commands
- required services/databases
- Docker/dev-container need
- Minikube/Kubernetes need
- acceptance/smoke test approach
- security/CVE scanning tools
- environment limitations

## Execution requirement

When CI/CD setup is part of a task, the task agent should:

1. Detect existing build/test/deploy tooling.
2. Prefer existing project conventions.
3. Add or update local CI scripts only when needed.
4. Add Docker/dev-container/Compose/Minikube configuration when planned.
5. Validate the environment by running the required gates.
6. Store logs and artifacts by reference.

## Minikube usage

Use Minikube when the project needs local Kubernetes validation or when the PRD/planner requires deployment-like acceptance tests.

Minikube tasks should define:

- image build process
- namespace
- manifests/Helm/Kustomize usage
- secrets/config handling without real production secrets
- health checks
- smoke/acceptance tests
- cleanup behavior

## Security

All generated Docker, Compose, dev-container, and Kubernetes configurations must follow `specs/safety-permissions.md`.

The preferred way to reduce approval prompts is to move risky validation into a controlled sandbox, not to weaken host safety rules.

Images and dependencies should be scanned for CVEs where tools are available.

Do not embed secrets in images, manifests, logs, or committed files.

## Validation report

CI/CD validation report should include:

- environment type used
- commands executed
- services started
- build/test/deploy results
- scanner results or scanner limitations
- logs/artifact references
- cleanup status
- remaining limitations
