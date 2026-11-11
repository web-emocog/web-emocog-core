(function () {
  'use strict';
  var base = window.EmocogApiBase.resolve({ useStorage: false }).replace(/\/$/, '');
  var page = document.body.dataset.page, actor, csrf, rows = [];
  var link = window.identityLink;
  var token = link && link.get('token'), purpose = link && link.get('purpose');
  delete window.identityLink;
  function message(text, error) { var el = document.getElementById('message'); el.textContent = text; el.dataset.error = String(Boolean(error)); }
  async function request(route, body, method) {
    var headers = { 'Content-Type': 'application/json' };
    if (csrf) headers['X-CSRF-Token'] = csrf;
    if (actor) headers['X-Staff-User-ID'] = String(actor.id);
    return WecogHttp.json(base + route, { method: method || (body ? 'POST' : 'GET'), headers: headers,
      credentials: 'include', ...(body ? { body: JSON.stringify(body) } : {}) }, { scope: 'document', timeoutMs: 15000 });
  }
  function errorText(error) {
    var code = error.code || error.body?.code;
    var errors = { identity_disabled: 'Self-service has not been configured by the operator.',
      invalid_or_expired_token: 'This link is invalid, expired, or already used. Request another email.',
      invalid_or_expired_invitation: 'This invitation is invalid, expired, used, or belongs to another email.',
      verified_researcher_required: 'A verified researcher account is required. Account roles cannot be upgraded here.',
      last_owner_required: 'The last owner cannot be removed. Appoint another verified owner first.' };
    return errors[code] || 'The operation could not be confirmed. Check your connection and refresh before retrying.';
  }
  async function pending(button, action) {
    if (button.disabled) return;
    button.disabled = true;
    try { await action(); } catch (error) { message(errorText(error), true); }
    finally { button.disabled = false; }
  }
  function bindForm(id, action) {
    document.getElementById(id)?.addEventListener('submit', function (event) {
      event.preventDefault(); pending(event.currentTarget.querySelector('button[type="submit"]'), action);
    });
  }
  bindForm('request-form', async function () {
    await request('/identity/' + page, { email: document.getElementById('email').value.trim() });
    message('If eligible, an email will arrive. Check your inbox. You can request another link after one minute.');
  });
  if (page === 'confirm') {
    var valid = token && /^[A-Za-z0-9_-]{43}$/.test(token) && ['signup', 'reset', 'verify'].includes(purpose);
    document.getElementById('confirm-form').hidden = !valid;
    if (!valid) message('Open a valid link from your email. No changes have been made.', true);
    document.getElementById('name-field').hidden = purpose !== 'signup';
    document.getElementById('password-field').hidden = purpose === 'verify';
    document.getElementById('password').required = purpose !== 'verify';
    document.getElementById('heading').textContent = purpose === 'reset' ? 'Choose a new password' : 'Confirm your email';
    bindForm('confirm-form', async function () {
      var data = { token: token };
      if (purpose !== 'verify') {
        data.password = document.getElementById('password').value;
        if (new TextEncoder().encode(data.password).length > 72) { message('Use at most 72 UTF-8 bytes.', true); return; }
      }
      if (purpose === 'signup') data.display_name = document.getElementById('display-name').value;
      await request('/identity/confirm', data);
      token = null; document.getElementById('password').value = ''; document.getElementById('confirm-form').hidden = true;
      message('Confirmed. Sign in with your password to continue. Previous sessions have been revoked for account recovery or verification.');
    });
  }
  if (page !== 'workspace') return;
  function button(label, action) {
    var el = document.createElement('button'); el.textContent = label; el.type = 'button';
    el.addEventListener('click', function () { pending(el, action); }); return el;
  }
  function orgId() { return document.getElementById('managed-organization').value; }
  function projects() {
    var select = document.getElementById('invite-project'); select.replaceChildren();
    rows.filter(function (r) { return String(r.organization_id) === orgId() && r.project_id; }).forEach(function (r) {
      var option = document.createElement('option'); option.value = String(r.project_id); option.textContent = r.project_name; select.append(option);
    });
    document.getElementById('members').replaceChildren(); document.getElementById('invitations').replaceChildren();
  }
  async function load() {
    var data = await request('/workspace'); rows = data.workspaces;
    document.getElementById('verify-section').hidden = data.email_verified;
    document.getElementById('create-section').hidden = !data.email_verified || !data.self_service_eligible;
    document.getElementById('invite-section').hidden = !(token && purpose === 'invite' && data.email_verified && data.self_service_eligible);
    var root = document.getElementById('workspaces'), owned = new Map(); root.replaceChildren();
    rows.forEach(function (r) {
      var block = document.createElement('div'); block.className = 'workspace';
      var title = document.createElement('p'); title.textContent = r.organization_name + ' / ' + (r.project_name || 'No project access'); block.append(title);
      if (r.project_id) block.append(button('Open project', async function () {
        localStorage.setItem('emocog_selected_project_id', String(r.project_id)); location.href = '../researcher.html';
      }));
      root.append(block);
      if (r.organization_role === 'owner') owned.set(r.organization_id, r.organization_name);
    });
    var select = document.getElementById('managed-organization'); select.replaceChildren();
    owned.forEach(function (name, id) { var opt = document.createElement('option'); opt.value = String(id); opt.textContent = name; select.append(opt); });
    document.getElementById('manage-section').hidden = !owned.size || !data.email_verified || !data.self_service_eligible;
    projects();
  }
  document.getElementById('managed-organization').addEventListener('change', projects);
  document.getElementById('verify-button').addEventListener('click', function (e) { pending(e.currentTarget, async function () {
    await request('/identity/verification', {}); message('If eligible, a verification email will arrive.');
  }); });
  document.getElementById('accept-button').addEventListener('click', function (e) { pending(e.currentTarget, async function () {
    await request('/workspace/invitations/accept', { token: token }); token = null; message('Invitation accepted.'); await load();
  }); });
  bindForm('workspace-form', async function () {
    await request('/workspace/organizations', { organization_name: document.getElementById('organization-name').value,
      project_name: document.getElementById('project-name').value });
    message('Organization and first project created.'); await load();
  });
  bindForm('project-form', async function () {
    await request('/workspace/organizations/' + orgId() + '/projects', { name: document.getElementById('new-project-name').value });
    message('Project created.'); await load();
  });
  bindForm('invite-form', async function () {
    await request('/workspace/organizations/' + orgId() + '/invitations', { email: document.getElementById('invite-email').value,
      project_id: Number(document.getElementById('invite-project').value) }); message('If eligible, an invitation will arrive.');
  });
  document.getElementById('members-button').addEventListener('click', function (event) { pending(event.currentTarget, async function () {
    var org = orgId(), root = document.getElementById('members'); root.replaceChildren();
    var members = await request('/workspace/organizations/' + org + '/members');
    members.forEach(function (member) {
      var block = document.createElement('p'); block.textContent = member.email + ' (' + member.role + ') ';
      block.append(button(member.role === 'owner' ? 'Make member' : 'Make owner', async function () {
        if (!window.confirm('Change this organization membership role?')) return;
        await request('/workspace/organizations/' + org + '/members/' + member.id, { role: member.role === 'owner' ? 'member' : 'owner' }, 'PATCH'); await load();
      }));
      block.append(button('Remove from organization', async function () {
        if (!window.confirm('Remove this member from this organization and its projects?')) return;
        await request('/workspace/organizations/' + org + '/members/' + member.id, null, 'DELETE'); await load();
      })); root.append(block);
    });
    var invites = await request('/workspace/organizations/' + org + '/invitations'), target = document.getElementById('invitations'); target.replaceChildren();
    invites.forEach(function (invite) {
      var block = document.createElement('p'); block.textContent = invite.email + ': ' + (invite.accepted_at ? 'accepted' : invite.revoked_at ? 'revoked' : 'pending');
      if (!invite.accepted_at && !invite.revoked_at) block.append(button('Revoke invitation', async function () {
        await request('/workspace/organizations/' + org + '/invitations/' + invite.id, null, 'DELETE'); message('Invitation revoked.'); block.remove();
      })); target.append(block);
    });
  }); });
  async function refreshIdentity() {
    try {
      actor = await request('/auth/me'); csrf = actor.csrf_token;
      WecogAccountStorage.activate(actor.id);
      sessionStorage.setItem('emocog_csrf_token', csrf || '');
      localStorage.setItem('emocog_api_user', JSON.stringify({ id: actor.id, email: actor.email, role: actor.role, display_name: actor.display_name }));
      document.getElementById('account-label').textContent = actor.email;
      await load();
      document.getElementById('sign-in').hidden = true;
      message('');
    } catch (error) {
      if (error.status === 401) {
        actor = null; csrf = null;
        document.getElementById('sign-in').hidden = false;
      }
      else message(errorText(error), true);
    }
  }
  document.getElementById('continue-sign-in').addEventListener('click', function (event) {
    pending(event.currentTarget, refreshIdentity);
  });
  refreshIdentity();
})();
