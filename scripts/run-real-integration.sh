#!/usr/bin/env bash
# Copyright (c) 2026 by Nikola Slavchev LZ1NKL
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

# Run SCALER real Pi/model integration contract tests.
# Defaults to the provider-qualified model shown by `pi` /model.
: "${SCALER_REAL_PI_COMMAND:=pi}"
: "${SCALER_REAL_PI_TIMEOUT_MS:=60000}"
: "${SCALER_REAL_PI_INTEGRATION:=1}"
: "${SCALER_REAL_PI_MODEL:=openai-codex/gpt-5.3-codex-spark}"

export SCALER_REAL_PI_COMMAND
export SCALER_REAL_PI_TIMEOUT_MS
export SCALER_REAL_PI_INTEGRATION
export SCALER_REAL_PI_MODEL

echo "Running real Pi/model integration tests with model: ${SCALER_REAL_PI_MODEL}"
npm run test:integration:real
