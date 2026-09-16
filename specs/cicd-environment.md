# Execution Environment Capabilities
Requirements: SC-20. Acceptance: AC-20.

## Product-neutral contract

An environment is a declared capability for executing a task or validation.
Possible providers include the existing host, a virtual environment, a container,
a VM, a remote worker, a CI runner or a project-specific service.
Docker, Compose, dev containers and Minikube are examples, never prerequisites.

The core MUST operate without an environment provisioning plugin when the host
already satisfies task and policy needs. Prefer existing project conventions.
Do not create infrastructure merely because the request mentions deployment.

## Selection and lifecycle

For a task needing an environment, define required runtime/services, isolation,
data/network permissions, resource limits, reproducibility and evidence needs.
Select an available provider that meets them; report unknown capabilities.

A provider contract exposes capability inspection, preparation/attachment, health
verification, bounded execution, artifact collection, cancellation and cleanup.
Distinguish owned temporary resources from pre-existing shared/user resources.
Cleanup MUST NOT destroy resources the run does not own.

If a required provider is unavailable, use an authorized equivalent or block.
No silent downgrade from required isolation to unrestricted host execution.
Record actual environment/configuration identity in validation evidence.

Provisioning, scanners and deployment acceptance are optional modules. Required
validation remains required regardless of provider availability.
