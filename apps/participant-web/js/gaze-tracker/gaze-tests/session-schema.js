import { TEST_HUB_VERSION } from './constants.js';

export function ensureTestHubSessionFields(sessionData) {
    if (!sessionData || typeof sessionData !== 'object') return;

    if (!sessionData.testHub || typeof sessionData.testHub !== 'object') {
        sessionData.testHub = {
            version: TEST_HUB_VERSION,
            selections: [],
            runs: []
        };
    }

    if (!Array.isArray(sessionData.testHub.selections)) {
        sessionData.testHub.selections = [];
    }
    if (!Array.isArray(sessionData.testHub.runs)) {
        sessionData.testHub.runs = [];
    }

    if (!sessionData.gazeTests || typeof sessionData.gazeTests !== 'object') {
        sessionData.gazeTests = {
            vpcRuns: [],
            visuospatialRuns: []
        };
    }

    if (!Array.isArray(sessionData.gazeTests.vpcRuns)) {
        sessionData.gazeTests.vpcRuns = [];
    }
    if (!Array.isArray(sessionData.gazeTests.visuospatialRuns)) {
        sessionData.gazeTests.visuospatialRuns = [];
    }
}

export function pushHubSelection(sessionData, selection) {
    ensureTestHubSessionFields(sessionData);
    sessionData.testHub.selections.push(selection);
}

export function pushHubRun(sessionData, run) {
    ensureTestHubSessionFields(sessionData);
    sessionData.testHub.runs.push(run);
}

export function pushVPCSessionRun(sessionData, run) {
    ensureTestHubSessionFields(sessionData);
    sessionData.gazeTests.vpcRuns.push(run);
}

export function pushVisuospatialSessionRun(sessionData, run) {
    ensureTestHubSessionFields(sessionData);
    sessionData.gazeTests.visuospatialRuns.push(run);
}