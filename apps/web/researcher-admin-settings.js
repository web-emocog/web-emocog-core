function escapeAdminHtml(value){
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function adminTr(ru, en){
  return typeof CURRENT_LANG !== 'undefined' && CURRENT_LANG === 'en' ? en : ru;
}

function ExportView(){
  document.getElementById('pageTitle').textContent=adminTr('Экспорт','Export');
  setChips([adminTr('Данные','Data'),adminTr('Отчёты','Reports')]);
  const root=document.createElement('div');
  root.className='grid';
  root.innerHTML=`
    <div class="card" style="grid-column:span 12;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
      <div>
        <h3 style="display:flex;align-items:center;gap:10px;">
          ${adminTr('Экспорт данных','Data export')}
          <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:rgba(92,102,189,.12);color:var(--accent);border:1px solid rgba(92,102,189,.28);">🔒 PRO</span>
        </h3>
        <p style="margin-top:6px;">${adminTr('Выгрузка сессий, метрик и отчётов доступна в платных планах Pro и Enterprise.','Session, metric, and report exports are available on Pro and Enterprise plans.')}</p>
      </div>
    </div>
    <div class="card" style="grid-column:span 6;opacity:.55;pointer-events:none;">
      <h3 style="margin-bottom:8px;">${adminTr('Сессии (CSV / JSON)','Sessions (CSV / JSON)')}</h3>
      <p>${adminTr('Выгрузка всех сессий текущего эксперимента с фильтрами по QC, дате и группе.','Export all sessions in the current experiment with QC, date, and group filters.')}</p>
      <button style="margin-top:14px;padding:10px 18px;border-radius:12px;border:1px solid var(--stroke);background:rgba(92,102,189,.08);color:var(--accent);font-weight:700;cursor:not-allowed;font-family:var(--sans);font-size:13px;" disabled>${adminTr('Скачать CSV — доступно в Pro','Download CSV — available on Pro')}</button>
    </div>
    <div class="card" style="grid-column:span 6;opacity:.55;pointer-events:none;">
      <h3 style="margin-bottom:8px;">${adminTr('QC-отчёт (PDF)','QC report (PDF)')}</h3>
      <p>${adminTr('Автоматический отчёт по качеству данных для передачи заказчику или IRB.','Automated data-quality report for a client or IRB.')}</p>
      <button style="margin-top:14px;padding:10px 18px;border-radius:12px;border:1px solid var(--stroke);background:rgba(92,102,189,.08);color:var(--accent);font-weight:700;cursor:not-allowed;font-family:var(--sans);font-size:13px;" disabled>${adminTr('Скачать PDF — доступно в Pro','Download PDF — available on Pro')}</button>
    </div>
    <div class="card" style="grid-column:span 12;border:2px dashed var(--stroke);background:transparent;text-align:center;padding:40px 20px;">
      <div style="font-size:32px;margin-bottom:12px;">🔒</div>
      <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:8px;">${adminTr('Экспорт недоступен в бесплатном плане','Export is unavailable on the free plan')}</div>
      <div style="font-size:13px;color:var(--muted);max-width:400px;margin:0 auto 18px;">${adminTr('Чтобы выгружать данные, отчёты и таблицы, перейдите на план Pro или Enterprise.','Switch to Pro or Enterprise to export data, reports, and tables.')}</div>
      <button onclick="toast('${adminTr('Обновление тарифа скоро появится','Plan upgrade is coming soon')}')" style="padding:12px 28px;border-radius:14px;border:1px solid rgba(92,102,189,.35);background:rgba(92,102,189,.12);color:var(--accent);font-weight:700;font-family:var(--sans);font-size:14px;cursor:pointer;">${adminTr('Перейти на Pro','Switch to Pro')} →</button>
    </div>
  `;
  return root;
}

function AdminView(){
  document.getElementById('pageTitle').textContent=adminTr('Администрирование','Admin');
  setChips([adminTr('Команда','Team'), adminTr('Роли и проекты','Roles and projects')]);
  const root=document.createElement('div');
  root.className='grid';
  if(!state.adminPanelEnabled){
    root.innerHTML = `
      <div class="card" style="grid-column:span 12">
        <h3>${adminTr('Панель администратора','Admin panel')}</h3>
        <p>${adminTr('Доступ запрещён. Раздел доступен только пользователям с ролью','Access denied. This section is available only to users with the')} <code>admin</code> ${adminTr('.','role.')}</p>
      </div>
    `;
    return root;
  }
  root.innerHTML = `
    <div class="card" style="grid-column:span 12; display:none;" id="adminRbacAccountsCard">
      <h3>${adminTr('Учётные записи и роли','Accounts and roles')}</h3>
      <p>${adminTr('Создание пользователей, назначение ролей и привязка к организациям (полный RBAC).','Create users, assign roles, and link them to organisations (full RBAC).')}</p>
      <p style="margin-top:10px;"><a href="developer/accounts.html" style="display:inline-block;padding:10px 16px;border-radius:10px;border:1px solid var(--good);background:rgba(16,185,129,.12);color:var(--good);font-weight:600;text-decoration:none;">${adminTr('Открыть управление аккаунтами','Open account management')}</a></p>
    </div>
    <div id="platformDeveloperAccess" style="display:none;grid-column:span 12;">
    <div class="card" style="grid-column:span 12">
      <h3>${adminTr('Панель администратора','Admin panel')}</h3>
      <p>${adminTr('Управление доступом разработчиков: сначала добавьте email в список разрешённых, затем выдайте роль','Developer access: first add an email to the allowlist, then grant the')} <code>developer</code>${adminTr('.',' role.')}</p>
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <input type="email" id="adminDevEmailInput" placeholder="developer@email.com" style="min-width:240px;padding:8px 12px;border-radius:10px;border:1px solid var(--stroke);" />
        <button type="button" id="adminAddDevEmailBtn" style="padding:8px 16px;border-radius:10px;border:1px solid var(--good);background:rgba(16,185,129,.12);color:var(--good);cursor:pointer;">${adminTr('Добавить email разработчика','Add developer email')}</button>
        <button type="button" id="adminReloadBtn" style="padding:8px 16px;border-radius:10px;border:1px solid var(--accent);background:rgba(92,102,189,.12);color:var(--accent);cursor:pointer;">${adminTr('Обновить','Reload')}</button>
        <span id="adminHint" style="font-size:12px;color:var(--muted);">${adminTr('Доступно только администратору.','Admin-only controls.')}</span>
      </div>
    </div>
    <div class="card" style="grid-column:span 12">
      <h3 style="margin-bottom:10px;">${adminTr('Email с доступом разработчика','Developer access emails')}</h3>
      <div id="adminDevEmailsList"></div>
      <div class="empty-state" id="adminDevEmailsEmpty">${adminTr('Email разработчиков пока нет.','No developer emails yet.')}</div>
    </div>
    </div>
    <div class="card" style="grid-column:span 12">
      <h3 style="margin-bottom:10px;">${adminTr('Пользователи команды','Team users')}</h3>
      <input type="text" id="adminUsersQuery" placeholder="${adminTr('Поиск по email или имени','Search email or name')}" style="min-width:220px;padding:8px 12px;border-radius:10px;border:1px solid var(--stroke);margin-bottom:10px;" />
      <div id="adminUsersList"></div>
      <div class="empty-state" id="adminUsersEmpty">${adminTr('Пользователи ещё не загружены.','No users loaded yet.')}</div>
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
  const canGrantDeveloper = !!(state.authPermissions && state.authPermissions.can_grant_developer);

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
      '<div><div style="font-weight:700;">' + escapeAdminHtml(x.email || '—') + '</div><div style="font-size:12px;color:var(--muted);">' + adminTr('Добавлен: ','Added: ') + escapeAdminHtml(x.created_at ? new Date(x.created_at).toLocaleString() : '—') + '</div></div>' +
      '<button type="button" class="admin-dev-email-remove" data-id="' + escapeAdminHtml(x.id) + '" style="padding:6px 12px;border-radius:8px;border:1px solid var(--bad);background:rgba(239,68,68,.1);color:var(--bad);cursor:pointer;">' + adminTr('Удалить','Remove') + '</button>' +
      '</div>'
    )).join('');
    devEmailsListEl.querySelectorAll('.admin-dev-email-remove').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        try{
          await apiDelete('/auth/developer-access-emails/' + encodeURIComponent(btn.dataset.id));
          toast(adminTr('Email разработчика удалён','Developer email removed'));
          await loadAdminData();
    }catch(e){
          toast(adminTr('Не удалось удалить: ','Remove failed: ') + e.message);
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
            '<div style="font-weight:700;">' + escapeAdminHtml(u.email || '—') + '</div>' +
            '<div style="font-size:12px;color:var(--muted);margin-top:3px;">' + adminTr('Роль: ','Role: ') + escapeAdminHtml(u.role || '—') + ' · ' + adminTr('Имя: ','Name: ') + escapeAdminHtml(u.display_name || '—') + '</div>' +
          '</div>' +
          '<div>' +
            (canGrant
              ? '<button type="button" class="admin-grant-dev-btn" data-email="' + escapeAdminHtml(u.email || '') + '" style="padding:6px 12px;border-radius:8px;border:1px solid var(--good);background:rgba(16,185,129,.12);color:var(--good);cursor:pointer;">' + adminTr('Выдать роль разработчика','Grant developer') + '</button>'
              : (isDeveloper
                ? '<span style="font-size:12px;color:var(--good);font-weight:600;">Developer</span>'
                : '<span style="font-size:12px;color:var(--warn);">' + adminTr('Email отсутствует в списке разрешённых','Email not in allowlist') + '</span>')) +
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
          toast(adminTr('Роль разработчика выдана','Developer role granted'));
          await loadAdminData();
    }catch(e){
          toast(adminTr('Не удалось выдать роль: ','Grant failed: ') + e.message);
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
      hintEl.textContent = adminTr('Загрузка...','Loading...');
      const [devEmails, users] = await Promise.all([
        canGrantDeveloper ? apiGet('/auth/developer-access-emails') : Promise.resolve([]),
        fetchUsers()
      ]);
      renderDevEmails(Array.isArray(devEmails) ? devEmails : []);
      renderUsers(users);
      hintEl.textContent = adminTr('Загружены пользователи организации: ','Organization users loaded: ') + users.length;
    }catch(e){
      hintEl.textContent = adminTr('Ошибка загрузки: ','Load failed: ') + e.message;
      renderDevEmails([]);
      renderUsers([]);
    }
  }

  root.querySelector('#adminAddDevEmailBtn').addEventListener('click', async ()=>{
    if (!canGrantDeveloper) return;
    const email = (devEmailInputEl.value || '').trim();
    if(!email){ toast(adminTr('Введите email','Enter email')); return; }
    try{
      await apiPost('/auth/developer-access-emails', { email });
      devEmailInputEl.value = '';
      toast(adminTr('Email разработчика добавлен','Developer email added'));
      await loadAdminData();
    }catch(e){
      toast(adminTr('Не удалось добавить email: ','Add email failed: ') + e.message);
    }
  });
  root.querySelector('#adminReloadBtn').addEventListener('click', loadAdminData);
  queryEl.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') loadAdminData(); });
  const rbacCard = root.querySelector('#adminRbacAccountsCard');
  if (rbacCard && state.authPermissions && state.authPermissions.can_manage_organization_members) rbacCard.style.display = 'block';
  const developerAccess = root.querySelector('#platformDeveloperAccess');
  if (developerAccess && canGrantDeveloper) developerAccess.style.display = 'block';
  loadAdminData();
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
  document.getElementById('pageTitle').textContent=adminTr('Тариф','Billing');
  setChips([adminTr('План','Plan'),adminTr('Использование','Usage')]);
  const root=document.createElement('div');
  root.className='grid';
  root.innerHTML=`
    <div class="card" style="grid-column:span 12">
      <h3>${adminTr('Тариф и оплата','Billing')}</h3>
      <p>${adminTr('Информация о плане и использовании пока недоступна.','Plan and usage information is currently unavailable.')}</p>
    </div>
    <div class="empty-state">${adminTr('Функция недоступна','Feature locked')}</div>
  `;
  return root;
}
