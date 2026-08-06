export function uniqueQualityIssues(issues) {
    const byCode = new Map();
    for (const issue of issues || []) {
        if (!issue || issue.invalidatesBlock === false) continue;
        const key = issue.code || issue.issueId;
        if (key && !byCode.has(key)) byCode.set(key, issue);
    }
    return [...byCode.values()];
}

export function collectTrialQualityIssues({
    activeAtStart = [],
    blockIssues = [],
    issueStartIndex = 0,
    activeNow = []
} = {}) {
    return uniqueQualityIssues([
        ...activeAtStart,
        ...blockIssues.slice(Math.max(0, issueStartIndex)),
        ...activeNow
    ]);
}

export function buildTrialRepeatPlan(activeTrialPlan, attemptResults) {
    const invalidById = new Map();
    for (const result of attemptResults || []) {
        if (result?.qualityValid !== false || result?.trialId == null) continue;
        invalidById.set(String(result.trialId), result);
    }
    const repeatTrialPlan = (activeTrialPlan || [])
        .filter(item => invalidById.has(String(item?.trialId)));
    const invalidResults = repeatTrialPlan
        .map(item => invalidById.get(String(item.trialId)));
    return {
        invalidResults,
        repeatTrialPlan,
        repeatItems: invalidResults.map(result => ({
            id: String(result.trialId),
            issueCodes: Array.isArray(result.qualityIssueCodes)
                ? [...new Set(result.qualityIssueCodes.map(String))]
                : []
        }))
    };
}
