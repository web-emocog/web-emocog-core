function ExportView(){
  document.getElementById('pageTitle').textContent='Export';
  setChips(['Data','Reports']);
  const root=document.createElement('div');
  root.className='grid';
  root.innerHTML=`
    <div class="card" style="grid-column:span 12;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
      <div>
        <h3 style="display:flex;align-items:center;gap:10px;">
          Экспорт данных
          <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:rgba(92,102,189,.12);color:var(--accent);border:1px solid rgba(92,102,189,.28);">🔒 PRO</span>
        </h3>
        <p style="margin-top:6px;">Выгрузка сессий, метрик и отчётов доступна в платных планах Pro и Enterprise.</p>
      </div>
    </div>
    <div class="card" style="grid-column:span 6;opacity:.55;pointer-events:none;">
      <h3 style="margin-bottom:8px;">Сессии (CSV / JSON)</h3>
      <p>Выгрузка всех сессий текущего эксперимента с фильтрами по QC, дате, группе.</p>
      <button style="margin-top:14px;padding:10px 18px;border-radius:12px;border:1px solid var(--stroke);background:rgba(92,102,189,.08);color:var(--accent);font-weight:700;cursor:not-allowed;font-family:var(--sans);font-size:13px;" disabled>Скачать CSV — доступно в Pro</button>
    </div>
    <div class="card" style="grid-column:span 6;opacity:.55;pointer-events:none;">
      <h3 style="margin-bottom:8px;">QC-отчёт (PDF)</h3>
      <p>Автоматический отчёт по качеству данных для передачи заказчику или IRB.</p>
      <button style="margin-top:14px;padding:10px 18px;border-radius:12px;border:1px solid var(--stroke);background:rgba(92,102,189,.08);color:var(--accent);font-weight:700;cursor:not-allowed;font-family:var(--sans);font-size:13px;" disabled>Скачать PDF — доступно в Pro</button>
    </div>
    <div class="card" style="grid-column:span 12;border:2px dashed var(--stroke);background:transparent;text-align:center;padding:40px 20px;">
      <div style="font-size:32px;margin-bottom:12px;">🔒</div>
      <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:8px;">Экспорт недоступен в бесплатном плане</div>
      <div style="font-size:13px;color:var(--muted);max-width:400px;margin:0 auto 18px;">Чтобы выгружать данные, отчёты и таблицы, перейдите на план Pro или Enterprise.</div>
      <button onclick="toast('Upgrade — coming soon')" style="padding:12px 28px;border-radius:14px;border:1px solid rgba(92,102,189,.35);background:rgba(92,102,189,.12);color:var(--accent);font-weight:700;font-family:var(--sans);font-size:14px;cursor:pointer;">Перейти на Pro →</button>
    </div>
  `;
  setInspector({type:'Export',title:'Export',subtitle:'Выгрузка данных — только для платных планов. В бесплатном плане кнопки заблокированы.',status:'warn'});
  return root;
}

function AdminView(){
  document.getElementById('pageTitle').textContent='Admin';
  setChips(['Developer Access', 'Roles']);
  const root=document.createElement('div');
  root.className='grid';
  if(!state.adminPanelEnabled){
    root.innerHTML = `
      <div class="card" style="grid-column:span 12">
        <h3>Admin panel</h3>
        <p>Access denied. This section is available only for users with <code>admin</code> role.</p>
      </div>
    `;
    setInspector({type:'Admin',title:'Admin panel',subtitle:'Доступ только для администраторов',status:'warn'});
    return root;
  }
  root.innerHTML = `
        <div class="card" style="grid-column:span 12; display:none;" id="adminRbacAccountsCard">
      <h3>Учётные записи и роли</h3>
      <p>Создание пользователей, назначение ролей и привязка к организациям (полный RBAC).</p>
      <p style="margin-top:10px;"><a href="developer/accounts.html" style="display:inline-block;padding:10px 16px;border-radius:10px;border:1px solid var(--good);background:rgba(16,185,129,.12);color:var(--good);font-weight:600;text-decoration:none;">Открыть управление аккаунтами</a></p>
    </div>
<div class="card" style="grid-column:span 12">
      <h3>Admin panel</h3>
      <p>Управление developer-доступом: сначала добавьте email в allowlist, затем выдайте роль <code>developer</code>.</p>
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <input type="email" id="adminDevEmailInput" placeholder="developer@email.com" style="min-width:240px;padding:8px 12px;border-radius:10px;border:1px solid var(--stroke);" />
        <button type="button" id="adminAddDevEmailBtn" style="padding:8px 16px;border-radius:10px;border:1px solid var(--good);background:rgba(16,185,129,.12);color:var(--good);cursor:pointer;">Add developer email</button>
        <button type="button" id="adminReloadBtn" style="padding:8px 16px;border-radius:10px;border:1px solid var(--accent);background:rgba(92,102,189,.12);color:var(--accent);cursor:pointer;">Reload</button>
        <span id="adminHint" style="font-size:12px;color:var(--muted);">Admin-only controls.</span>
      </div>
    </div>
    <div class="card" style="grid-column:span 12">
      <h3 style="margin-bottom:10px;">Developer access emails</h3>
      <div id="adminDevEmailsList"></div>
      <div class="empty-state" id="adminDevEmailsEmpty">No developer emails yet.</div>
    </div>
    <div class="card" style="grid-column:span 12">
      <h3 style="margin-bottom:10px;">Team users</h3>
      <input type="text" id="adminUsersQuery" placeholder="Search email/name" style="min-width:220px;padding:8px 12px;border-radius:10px;border:1px solid var(--stroke);margin-bottom:10px;" />
      <div id="adminUsersList"></div>
      <div class="empty-state" id="adminUsersEmpty">No users loaded yet.</div>
    </div>
  `;

  const hintEl = root.querySelector('#adminHint');
  const devEmailsListEl = root.querySelector('#adminDevEmailsList');
  const devEmailsEmptyEl = root.querySelector('#adminDevEmailsEmpty');
  const usersListEl = root.querySelector('#adminUsersList');
  const emptyEl = root.querySelector('#adminUsersEmpty');
  const queryEl = root.querySelector('#adminUsersQuery');
  const devEmailInputEl = root.querySelector('#adminDevEmailInput');
  const allowedDeveloperEmails = new Set();

  function renderDevEmails(items){
    allowedDeveloperEmails.clear();
    if(!Array.isArray(items) || !items.length){
      devEmailsListEl.innerHTML = '';
      devEmailsEmptyEl.style.display = 'block';
      return;
    }
    devEmailsEmptyEl.style.display = 'none';
    items.forEach((x)=>allowedDeveloperEmails.add(String(x.email || '').toLowerCase()));
    devEmailsListEl.innerHTML = items.map((x)=>(
      '<div class="card" style="padding:10px;margin-bottom:8px;border:1px solid var(--stroke);display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<div><div style="font-weight:700;">' + (x.email || '—') + '</div><div style="font-size:12px;color:var(--muted);">Added: ' + (x.created_at ? new Date(x.created_at).toLocaleString() : '—') + '</div></div>' +
      '<button type="button" class="admin-dev-email-remove" data-id="' + x.id + '" style="padding:6px 12px;border-radius:8px;border:1px solid var(--bad);background:rgba(239,68,68,.1);color:var(--bad);cursor:pointer;">Remove</button>' +
      '</div>'
    )).join('');
    devEmailsListEl.querySelectorAll('.admin-dev-email-remove').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        try{
          await apiDelete('/auth/developer-access-emails/' + encodeURIComponent(btn.dataset.id));
          toast('Developer email removed');
          await loadAdminData();
    }catch(e){
          toast('Remove failed: ' + e.message);
        }
      });
    });
  }

  function renderUsers(users){
    if(!Array.isArray(users) || !users.length){
      usersListEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    usersListEl.innerHTML = users.map((u)=>{
      const isDeveloper = String(u.role || '').toLowerCase() === 'developer';
      const email = String(u.email || '').toLowerCase();
      const emailAllowed = allowedDeveloperEmails.has(email);
      const canGrant = !isDeveloper && emailAllowed;
      return '<div class="card" style="padding:10px;margin-bottom:8px;border:1px solid var(--stroke);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">' +
          '<div>' +
            '<div style="font-weight:700;">' + (u.email || '—') + '</div>' +
            '<div style="font-size:12px;color:var(--muted);margin-top:3px;">Role: ' + (u.role || '—') + ' · Name: ' + (u.display_name || '—') + '</div>' +
          '</div>' +
          '<div>' +
            (canGrant
              ? '<button type="button" class="admin-grant-dev-btn" data-email="' + (u.email || '') + '" style="padding:6px 12px;border-radius:8px;border:1px solid var(--good);background:rgba(16,185,129,.12);color:var(--good);cursor:pointer;">Grant developer</button>'
              : (isDeveloper
                ? '<span style="font-size:12px;color:var(--good);font-weight:600;">Developer</span>'
                : '<span style="font-size:12px;color:var(--warn);">Email not in allowlist</span>')) +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    usersListEl.querySelectorAll('.admin-grant-dev-btn').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const email = btn.dataset.email || '';
        try{
          btn.disabled = true;
          await apiPost('/auth/grant-developer-access', { email });
          toast('Developer role granted');
          await loadAdminData();
    }catch(e){
          toast('Grant failed: ' + e.message);
          btn.disabled = false;
        }
      });
    });
  }

  async function fetchUsers(){
    const q = (queryEl.value || '').trim();
    const query = q ? ('?q=' + encodeURIComponent(q)) : '';
    const users = await apiGet('/auth/users' + query);
    return Array.isArray(users) ? users : [];
  }

  async function loadAdminData(){
    try{
      hintEl.textContent = 'Loading...';
      const [devEmails, users] = await Promise.all([
        apiGet('/auth/developer-access-emails'),
        fetchUsers()
      ]);
      renderDevEmails(Array.isArray(devEmails) ? devEmails : []);
      renderUsers(users);
      hintEl.textContent = 'Loaded users and developer allowlist (' + users.length + ' users)';
    }catch(e){
      hintEl.textContent = 'Load failed: ' + e.message;
      renderDevEmails([]);
      renderUsers([]);
    }
  }

  root.querySelector('#adminAddDevEmailBtn').addEventListener('click', async ()=>{
    const email = (devEmailInputEl.value || '').trim();
    if(!email){ toast('Enter email'); return; }
    try{
      await apiPost('/auth/developer-access-emails', { email });
      devEmailInputEl.value = '';
      toast('Developer email added');
      await loadAdminData();
    }catch(e){
      toast('Add email failed: ' + e.message);
    }
  });
  root.querySelector('#adminReloadBtn').addEventListener('click', loadAdminData);
  queryEl.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') loadAdminData(); });
  const rbacCard = root.querySelector('#adminRbacAccountsCard');
  if (rbacCard && state.authPermissions && state.authPermissions.can_grant_developer) rbacCard.style.display = 'block';
  loadAdminData();
  setInspector({type:'Admin',title:'Admin panel',subtitle:'Администратор управляет allowlist email и выдаёт developer-доступ.',status:'good'});
  return root;
}

function SettingsView(){
  document.getElementById('pageTitle').textContent=t('settingsTitle');
  setChips([]);
  const root=document.createElement('div');
  root.className='grid';
  root.innerHTML=`
    <div class="card" style="grid-column:span 12; border-radius:22px;">
      <h3>${t('settingsTitle')}</h3>
      <p style="margin-top:6px;">${t('settingsSub')}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">
        <input type="password" class="select" style="max-width:260px;background:#fff;" placeholder="${t('currentPassword')}" />
        <input type="password" class="select" style="max-width:300px;background:#fff;" placeholder="${t('newPassword')}" />
        <button class="quick-btn" style="font-weight:700;">${t('changePassword')}</button>
      </div>
    </div>
  `;
  return root;
}


function BillingView(){
  document.getElementById('pageTitle').textContent='Billing';
  setChips(['Plan','Usage']);
  const root=document.createElement('div');
  root.className='grid';
  root.innerHTML=`
    <div class="card" style="grid-column:span 12">
      <h3>Billing</h3>
      <p>Plan and usage information — locked for demo.</p>
    </div>
    <div class="empty-state">Feature locked</div>
  `;
  setInspector({type:'Billing',title:'Billing',subtitle:'Account info',status:'warn'});
  return root;
}
