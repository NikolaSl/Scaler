/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { selectComplexity } from "../src/adaptive.js";

test("domain vocabulary in English and Bulgarian lookups stays lightweight", () => {
  const requests = [
    "What is Docker?",
    "Какво е Docker?",
    "Explain Kubernetes security in one paragraph.",
    "Обясни сигурността на Kubernetes в един абзац.",
  ];

  for (const request of requests) {
    const decision = selectComplexity(request);
    assert.equal(decision.level, 1, request);
    assert.equal(decision.stage, "execution", request);
  }
});

test("verbosity and request length alone do not force staged planning", () => {
  const verboseLookup = "Explain the same parser term without changing anything. ".repeat(16);

  assert.ok(verboseLookup.length > 500);
  const decision = selectComplexity(verboseLookup);
  assert.equal(decision.level, 1);
  assert.equal(decision.stage, "execution");
});

test("equivalent English and Bulgarian workspace changes use lightweight planning", () => {
  const english = selectComplexity("Add parser validation and update its unit tests.");
  const bulgarian = selectComplexity("Добави валидация на парсера и обнови unit тестовете му.");

  assert.equal(english.level, 2);
  assert.equal(english.stage, "planning");
  assert.deepEqual(
    { level: bulgarian.level, stage: bulgarian.stage },
    { level: english.level, stage: english.stage },
  );
});

test("equivalent English and Bulgarian multi-workstream changes use staged planning", () => {
  const english = selectComplexity(
    "Plan and implement a parser migration, integrate it with two services, and update validation.",
  );
  const bulgarian = selectComplexity(
    "Планирай и реализирай миграция на парсера, интегрирай я с две услуги и обнови валидацията.",
  );

  assert.equal(english.level, 3);
  assert.equal(english.stage, "prd");
  assert.deepEqual(
    { level: bulgarian.level, stage: bulgarian.stage },
    { level: english.level, stage: english.stage },
  );
});

test("actual sensitive deployment remains a full-workflow positive control", () => {
  const decision = selectComplexity("Deploy the Kubernetes auth service to production.");

  assert.equal(decision.level, 4);
  assert.equal(decision.stage, "prd");
});

test("advice about an external effect does not authorize that effect", () => {
  const requests = [
    "Explain how to deploy the service without making changes.",
    "Обясни как да разгърна услугата, без да правиш промени.",
    "Explain why we must not deploy the service.",
  ];

  for (const request of requests) {
    const decision = selectComplexity(request);
    assert.equal(decision.level, 1, request);
    assert.equal(decision.stage, "execution", request);
  }
});

test("a workspace edit that quotes an external verb does not become an external effect", () => {
  const decision = selectComplexity("Update the documentation about how to deploy the service.");

  assert.equal(decision.level, 2);
  assert.equal(decision.stage, "planning");
});

test("an explicit follow-on external effect overrides informational framing", () => {
  const requests = [
    "Explain the release, then deploy it to production.",
    "Обясни release-а и после го разгърни в production.",
  ];

  for (const request of requests) {
    const decision = selectComplexity(request);
    assert.equal(decision.level, 4, request);
    assert.equal(decision.stage, "prd", request);
  }
});
