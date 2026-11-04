export async function authorizeDiagnostic(run, feature = 'camera') {
    const access = await run.wait(() => window.WecogDiagnosticAccess || window.WecogBpmAccess);
    const allowed = actor => actor?.id && ['admin', 'developer'].includes(actor.role);
    if (!access?.ok || !allowed(access.user)) throw Object.assign(new Error('Diagnostic access unavailable'), { code: 'diagnostic_access_denied' });
    window.WecogStaffSession?.assertCurrent();
    const fresh = await run.wait(() => window.WecogHttp.json(window.EmocogApiBase.resolve() + '/auth/me', {
        credentials: 'include', signal: run.signal
    }, { scope: 'document', timeoutMs: 15000 }));
    run.check();
    const actor = fresh?.user || fresh;
    if (!allowed(actor) || String(actor.id) !== String(access.user.id)) throw Object.assign(new Error('Diagnostic access unavailable'), { code: 'diagnostic_access_denied' });
    const policy = document.permissionsPolicy || document.featurePolicy;
    if (policy?.allowsFeature && !policy.allowsFeature(feature)) throw Object.assign(new Error('Diagnostic sensor denied'), { code: 'diagnostic_sensor_policy_denied' });
    window.WecogStaffSession?.assertCurrent();
    return actor;
}
