/*
 * Copyright (c) 2026 by Nikola Slavchev LZ1NKL
 * SPDX-License-Identifier: Apache-2.0
 */

import { runConductorStep as runConductorStepImpl } from "../../../src/conductor.js";
import { runDebugAgentStep as runDebugAgentStepImpl } from "../../../src/debug-agent.js";
import { runDebugConductorLoop as runDebugConductorLoopImpl } from "../../../src/debug-conductor.js";
import { runDebugNextApproachRetry as runDebugNextApproachRetryImpl } from "../../../src/debug-retry.js";
import { runResearchAgentStep as runResearchAgentStepImpl } from "../../../src/research-agent.js";
import { runResearchWebWorkflow as runResearchWebWorkflowImpl } from "../../../src/research-web.js";
import { runReplanAgentStep as runReplanAgentStepImpl } from "../../../src/replan-agent.js";
import { runStageAgentStep as runStageAgentStepImpl } from "../../../src/stage-agents.js";
import {
  runStageConductorLoop as runStageConductorLoopImpl,
  runStageConductorStep as runStageConductorStepImpl,
} from "../../../src/stage-conductor.js";
import { runAutonomousStageWorkflow as runAutonomousStageWorkflowImpl } from "../../../src/stage-workflow.js";
import { runToolSchemaDiscoveryAgent as runToolSchemaDiscoveryAgentImpl } from "../../../src/tool-requests.js";
import { runValidationDebugLoopWorkflow as runValidationDebugLoopWorkflowImpl } from "../../../src/validation-debug-loop.js";
import { withTestProviderAdmissionModel } from "../../provider-model-fixture.js";

export const runConductorStep: typeof runConductorStepImpl = (cwd, state, options = {}, runner) =>
  runConductorStepImpl(cwd, state, withTestProviderAdmissionModel(options), runner);

export const runDebugConductorLoop: typeof runDebugConductorLoopImpl = (cwd, state, options = {}, runners = {}) =>
  runDebugConductorLoopImpl(cwd, state, withTestProviderAdmissionModel(options), runners);

export const runDebugAgentStep: typeof runDebugAgentStepImpl = (cwd, state, options = {}, runner) =>
  runDebugAgentStepImpl(cwd, state, withTestProviderAdmissionModel(options), runner);

export const runDebugNextApproachRetry: typeof runDebugNextApproachRetryImpl = (cwd, state, options = {}, runner) =>
  runDebugNextApproachRetryImpl(cwd, state, withTestProviderAdmissionModel(options), runner);

export const runResearchAgentStep: typeof runResearchAgentStepImpl = (cwd, state, options = {}, runner) =>
  runResearchAgentStepImpl(cwd, state, withTestProviderAdmissionModel(options), runner);

export const runResearchWebWorkflow: typeof runResearchWebWorkflowImpl = (cwd, state, options = {}, runner) =>
  runResearchWebWorkflowImpl(cwd, state, withTestProviderAdmissionModel(options), runner);

export const runReplanAgentStep: typeof runReplanAgentStepImpl = (cwd, state, options = {}, runner) =>
  runReplanAgentStepImpl(cwd, state, withTestProviderAdmissionModel(options), runner);

export const runStageAgentStep: typeof runStageAgentStepImpl = (cwd, state, stage, options = {}, runner) =>
  runStageAgentStepImpl(cwd, state, stage, withTestProviderAdmissionModel(options), runner);

export const runStageConductorStep: typeof runStageConductorStepImpl = (cwd, state, options = {}, runner) =>
  runStageConductorStepImpl(cwd, state, withTestProviderAdmissionModel(options), runner);

export const runStageConductorLoop: typeof runStageConductorLoopImpl = (cwd, state, options = {}, runner) =>
  runStageConductorLoopImpl(cwd, state, withTestProviderAdmissionModel(options), runner);

export const runAutonomousStageWorkflow: typeof runAutonomousStageWorkflowImpl = (cwd, state, options = {}, runners = {}) =>
  runAutonomousStageWorkflowImpl(cwd, state, withTestProviderAdmissionModel(options), runners);

export const runToolSchemaDiscoveryAgent: typeof runToolSchemaDiscoveryAgentImpl = (cwd, state, options, runner) =>
  runToolSchemaDiscoveryAgentImpl(cwd, state, withTestProviderAdmissionModel(options), runner);

export const runValidationDebugLoopWorkflow: typeof runValidationDebugLoopWorkflowImpl =
  (cwd, state, taskId, options = {}, runners = {}, validator) =>
    runValidationDebugLoopWorkflowImpl(cwd, state, taskId, withTestProviderAdmissionModel(options), runners, validator);
