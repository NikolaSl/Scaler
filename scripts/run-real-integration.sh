#!/usr/bin/env bash
set -euo pipefail

# Run SCALER real Pi/model integration contract tests.
# Defaults to model requested by user.
: "${SCALER_REAL_PI_COMMAND:=pi}"
: "${SCALER_REAL_PI_TIMEOUT_MS:=60000}"
: "${SCALER_REAL_PI_INTEGRATION:=1}"
: "${SCALER_REAL_PI_MODEL:=gpt-5.3-codex-spark}"

export SCALER_REAL_PI_COMMAND
export SCALER_REAL_PI_TIMEOUT_MS
export SCALER_REAL_PI_INTEGRATION
export SCALER_REAL_PI_MODEL

echo "Running real Pi/model integration tests with model: ${SCALER_REAL_PI_MODEL}"
npm run test:integration:real
