// Utility functions
const $=s=>document.querySelector(s);
const state={
  org:'Acme Labs',
  project:'',
  experiment:'Face Recognition',
  role:(localStorage.getItem('emocog_user_role') || localStorage.getItem('user_role') || 'Исследователь'),
  focus:false,
  sidebarCollapsed:localStorage.getItem('sidebarCollapsed')==='true',
  authUser:null,
  authPermissions:null,
  adminPanelEnabled:false
};

// Phase 3: API config and auth (researcher dashboards)
window.API_BASE = window.API_BASE || localStorage.getItem('emocog_api_base') || (window.location.origin + '/api');
window.API_TOKEN = window.API_TOKEN || localStorage.getItem('emocog_api_token') || '';
function authHeaders(){ const h = {}; if(window.API_TOKEN) h['Authorization'] = 'Bearer '+window.API_TOKEN; return h; }
function apiHeaders(){ const h = {'Content-Type':'application/json'}; if(window.API_TOKEN) h['Authorization'] = 'Bearer '+window.API_TOKEN; return h; }
async function apiFailError(r){
  let detail = r.statusText || '';
  try{
    const ct = r.headers.get('content-type') || '';
    if(ct.includes('application/json')){
      const j = await r.json();
      if(j && j.error) detail = j.error;
      else if(j && j.message) detail = j.message;
      else if(j && Array.isArray(j.errors) && j.errors.length){
        detail = j.errors.map(function(e){ return e.msg || e.message || String(e); }).join('; ');
      }
    }
  }catch(_){}
  return new Error(r.status + (detail ? ' — ' + detail : ''));
}
async function apiGet(path){ const base = (window.API_BASE||'').replace(/\/$/,''); const url = base ? (base + path) : path; const r = await fetch(url, {headers: apiHeaders()}); if(!r.ok) throw await apiFailError(r); return r.json(); }
async function apiPost(path, body){
  const base = (window.API_BASE||'').replace(/\/$/,''); const url = base ? (base + path) : path;
  const isFormData = (typeof FormData !== 'undefined') && body instanceof FormData;
  const headers = isFormData ? authHeaders() : apiHeaders();
  const payload = isFormData ? body : JSON.stringify(body || {});
  const r = await fetch(url, { method: 'POST', headers, body: payload });
  if(!r.ok) throw await apiFailError(r);
  return r.status === 204 ? null : r.json();
}
async function apiPatch(path, body){ const base = (window.API_BASE||'').replace(/\/$/,''); const url = base ? (base + path) : path; const r = await fetch(url, { method: 'PATCH', headers: apiHeaders(), body: JSON.stringify(body || {}) }); if(!r.ok) throw await apiFailError(r); return r.json(); }
async function apiDelete(path){ const base = (window.API_BASE||'').replace(/\/$/,''); const url = base ? (base + path) : path; const r = await fetch(url, { method: 'DELETE', headers: apiHeaders() }); if(!r.ok) throw await apiFailError(r); return r.status === 204 ? null : r.json(); }

function applyAdminNavAccess(){
  const nav = document.getElementById('nav-admin');
  if(!nav) return;
  nav.style.display = state.adminPanelEnabled ? '' : 'none';
}

async function bootstrapAdminAccess(){
  try{
    const [me, permissions] = await Promise.all([
      apiGet('/auth/me'),
      apiGet('/auth/permissions')
    ]);
    state.authUser = me || null;
    state.authPermissions = permissions || null;
    state.adminPanelEnabled = !!(permissions && permissions.can_open_admin_panel);
  }catch(_){
    state.adminPanelEnabled = false;
  }
  applyAdminNavAccess();
}

function logoutResearcher() {
  try {
    if (window.EmocogAuthGuard && typeof window.EmocogAuthGuard.clearAuth === 'function') {
      window.EmocogAuthGuard.clearAuth();
    } else {
      localStorage.removeItem('emocog_api_token');
      localStorage.removeItem('emocog_api_user');
      localStorage.removeItem('emocog_developer_auth');
      sessionStorage.removeItem('emocog_developer_auth');
    }
  } catch (_) {}
  window.location.href = 'developer/login.html';
}


let EXPERIMENTS_TAB = localStorage.getItem('emocog_experiments_tab') || 'active';

// Toast notification
function toast(msg){
  const t=$('#toast');
  t.textContent=autoTranslateString ? autoTranslateString(msg, CURRENT_LANG) : msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2000);
}

//Стимулы и эксперименты (Аня)
let experimentBlocks = JSON.parse(localStorage.getItem('emocog_protocol_blocks')) || [];
let selectedBlockId = null;
let uploadedPsychoPyFile = null;
let uploadedResources = {};
let parsedExperimentData = null;

// Стимулы
let stimuliList = JSON.parse(localStorage.getItem('emocog_stimuli')) || [];
let selectedStimulusId = null;
let currentStimuliFilter = 'all';  // all / image / video / audio / text
let folders = JSON.parse(localStorage.getItem('emocog_folders')) || [];
let selectedFolder = null;
//Конец изменения

// Sidebar toggle
function toggleSidebar(){
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem('sidebarCollapsed', state.sidebarCollapsed);
  $('#app').classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  $('#btnToggleSidebar').classList.toggle('active', state.sidebarCollapsed);
}

// Analytics mode (hide right panel)
function setAnalyticsMode(enabled){
  $('#app').classList.toggle('analytics-mode', enabled);
}

function setOverviewMode(enabled){
  $('#app').classList.toggle('overview-mode', enabled);
}

function setStimuliMode(enabled){
  $('#app').classList.toggle('stimuli-mode', enabled);
}
function setSettingsMode(enabled){
  $('#app').classList.toggle('settings-mode', enabled);
}

function setExperimentsActiveMode(enabled){
  $('#app').classList.toggle('experiments-active-mode', enabled);
}

function setExperimentsConstructorMode(enabled){
  $('#app').classList.toggle('experiments-constructor-mode', enabled);
}

function setAdminMode(enabled){
  $('#app').classList.toggle('admin-mode', enabled);
}

// Active navigation highlight
function setActiveNav(route){
  // Clear all active states
  document.querySelectorAll('.nav a').forEach(a=>a.classList.remove('active'));
  document.querySelectorAll('.nav .has-subnav').forEach(d=>d.classList.remove('active'));

  const el=$(`#nav-${route}`);
  if(el){
    el.classList.add('active');
    // If inside a subnav div, activate the parent div.has-subnav
    const parentHasSub = el.closest('.has-subnav');
    if(parentHasSub) parentHasSub.classList.add('active');
  }

  // For any analytics route: expand the analytics subnav
  if(route && route.startsWith('analytics')){
    const analyticsParent = $('#nav-analytics-parent');
    if(analyticsParent) analyticsParent.classList.add('active');
    // Also mark the main Analytics link as active
    const mainLink = $('#nav-analytics-session-card');
    if(mainLink) mainLink.classList.add('active');
  }
  // For any stimuli route: expand the stimuli subnav
  if(route && route.startsWith('stimuli')){
    const stimuliParent = $('#nav-stimuli-parent');
    if(stimuliParent) stimuliParent.classList.add('active');
    const mainLink = $('#nav-stimuli');
    if(mainLink) mainLink.classList.add('active');
  }
}

// Breadcrumbs
function setCrumbs(){
  // Static for now
}

// Chips
function setChips(arr){
  const c=$('#chips');
  c.innerHTML=arr.map((x,i)=>`<div class="chip ${i===0?'active':''}">${x}</div>`).join('');
  c.style.display = arr.length ? '' : 'none';
}

// Inspector mode state
let inspectorMode = 'view';
let currentInspectorData = {};

function setInspectorMode(mode){
  inspectorMode = mode;
  document.getElementById('btnInspView').classList.toggle('active', mode === 'view');
  document.getElementById('btnInspEdit').classList.toggle('active', mode === 'edit');
  document.getElementById('inspectorLabel').textContent = mode === 'edit' ? 'Inspector — Edit' : 'Inspector';
  renderInspector();
}

function renderInspector(){
  const data = currentInspectorData;
  const el = $('#inspector');

  // Custom HTML override (used by Builder, Stimuli etc.)
  if(data && data.customHtml){
    el.innerHTML = data.customHtml;
    return;
  }

  if(inspectorMode === 'view'){
    // ── VIEW MODE ──────────────────────────────────────────────
    // Цель: быстро ответить на вопросы
    //   "На какие данные я сейчас смотрю?" → Scope
    //   "Всё ли в порядке с этим разделом?" → Status
    //   "Что здесь самое полезное действие?" → 1 CTA
    // Type/Title/Subtitle скрыты — это настройки страницы, а не информация для чтения.

    // Контекстный CTA зависит от страницы, а НЕ всегда ведёт на Export.
    // Каждая страница сама передаёт нужный CTA через setInspector().
    let scopeHtml = '';
    if (!data.hideScope) {
        scopeHtml = `
      <div class="insp-section">
        <h4>Scope</h4>
        <div style="display:flex;flex-direction:column;gap:8px;padding:4px 0 10px;">
          <div style="display:flex;align-items:center;gap:5px;font-size:12px;flex-wrap:wrap;">
            <span style="font-weight:700;color:var(--text);font-size:13px;">${state.org||'—'}</span>
            <span style="color:var(--muted2);font-size:10px;">▸</span>
            <span style="font-weight:500;color:var(--muted);">${state.project||'—'}</span>
            <span style="color:var(--muted2);font-size:10px;">▸</span>
            <span style="color:var(--muted);font-size:12px;">${state.experiment||'—'}</span>
          </div>
        </div>
        <div class="insp-row" style="border-bottom:none;padding-top:6px;">
          <span class="label">Status</span>
          <span class="badge ${data.status||'neutral'}">${(data.status||'neutral').toUpperCase()}</span>
        </div>
      </div>
        `;
    }

    el.innerHTML = `
      ${scopeHtml}
      ${data.cta ? `
      <div style="padding:0 0 14px;">
        <button class="quick-btn" style="width:100%;background:rgba(92,102,189,.10);border-color:rgba(92,102,189,.28);color:var(--accent);font-weight:600;justify-content:center;gap:8px;" onclick="${data.cta.action}">
          ${data.cta.label}
        </button>
      </div>` : ''}
      <div class="insp-section" style="border-top:1px solid var(--stroke);padding-top:16px;margin-top:4px;">
        <h4>About this page</h4>
        <div class="insp-row">
          <span class="label">Section</span>
          <span class="value" style="font-size:12px;">${data.title||'—'}</span>
        </div>
        ${data.subtitle ? `<div style="font-size:11px;color:var(--muted2);line-height:1.5;padding:6px 0 2px;">${data.subtitle}</div>` : ''}
      </div>
    `;
  } else {
    // ── EDIT / CUSTOMIZE MODE ──────────────────────────────────
    // Цель: настройка страницы/дашборда без лишних кликов.
    // Показываем всё: тип, заголовок, описание, scope, параметры виджетов.
    // В проде здесь будет drag-and-drop порядка карточек, выбор метрик, пороги QC и т.д.
    el.innerHTML = `
      <div class="insp-section">
        <h4>Page identity</h4>
        <div class="insp-row">
          <span class="label">Type</span>
          <span class="value">${data.type||'—'}</span>
        </div>
        <div class="insp-row">
          <span class="label">Title</span>
          <span class="value" style="font-size:12px;">${data.title||'—'}</span>
        </div>
        <div class="insp-row" style="border-bottom:none;">
          <span class="label">Status</span>
          <span class="badge ${data.status||'neutral'}">${data.status||'—'}</span>
        </div>
        ${data.subtitle ? `<div style="font-size:11px;color:var(--muted2);line-height:1.5;padding:8px 0 4px;border-top:1px solid var(--stroke);margin-top:4px;">${data.subtitle}</div>` : ''}
      </div>

      <div class="insp-section">
        <h4>Data scope</h4>
        <div class="insp-row">
          <span class="label">Org</span>
          <span class="value">${state.org||'—'}</span>
        </div>
        <div class="insp-row">
          <span class="label">Project</span>
          <span class="value">${state.project||'—'}</span>
        </div>
        <div class="insp-row" style="border-bottom:none;">
          <span class="label">Experiment</span>
          <span class="value">${state.experiment||'—'}</span>
        </div>
      </div>

      <div class="insp-section">
        <h4>Widget settings</h4>
        <div class="insp-row">
          <span class="label">QC threshold</span>
          <span class="value" style="display:flex;align-items:center;gap:6px;">
            <input type="range" min="50" max="95" value="80" style="width:72px;height:4px;cursor:pointer;accent-color:var(--accent);" oninput="this.nextElementSibling.textContent=this.value">
            <span style="font-size:12px;font-weight:700;color:var(--accent);min-width:24px;">80</span>
          </span>
        </div>
        <div class="insp-row">
          <span class="label">Date range</span>
          <span class="value" style="font-size:11px;">Last 30 days</span>
        </div>
        <div class="insp-row" style="border-bottom:none;">
          <span class="label">Cards visible</span>
          <span style="display:flex;gap:4px;flex-wrap:wrap;">
            ${['QC','Metrics','Blocks','Timeline'].map(c=>`<span style="font-size:10px;font-weight:600;padding:3px 8px;border-radius:999px;background:rgba(92,102,189,.10);border:1px solid rgba(92,102,189,.25);color:var(--accent);cursor:pointer;">${c}</span>`).join('')}
          </span>
        </div>
      </div>

      <div class="insp-section">
        <h4>Layout order</h4>
        <div style="display:flex;flex-direction:column;gap:4px;padding:4px 0;">
          ${['1. Overview summary','2. Key metrics','3. Timeline / Charts','4. Data table'].map((item,i)=>`
            <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:10px;border:1px solid var(--stroke);background:rgba(255,255,255,.35);cursor:grab;font-size:12px;color:var(--muted);">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="14" height="14" style="opacity:.4;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" d="M4 8h16M4 16h16"/></svg>
              <span>${item}</span>
            </div>
          `).join('')}
        </div>
        <div style="font-size:11px;color:var(--muted2);margin-top:6px;">Drag to reorder · в проде</div>
      </div>
    `;
  }
}

// Inspector
function setInspector(data){
  currentInspectorData = data;
  renderInspector();
}

// Initialize inspector mode buttons
function initInspectorButtons(){
  document.getElementById('btnInspView').classList.add('active');
}

// Hash parsing
function parseHash(h){
  const hash=(h||location.hash||'#/overview');
  const parts=hash.replace(/^#\/?/,'').split('/');
  return {route:(parts[0]||'overview'),parts};
}

// INSTANT render - контент остается видимым
function render(hashOverride){
  setCrumbs();
  const {route,parts}=parseHash(hashOverride);
  const view=$('#view');
  let routeKey=route;
  const subKey=parts[1]||'';
  let rk=routeKey;
  if(routeKey==='analytics'){
    // For analytics sub-routes, highlight the specific subnav item
    rk = subKey ? `analytics-${subKey}-sub` : 'analytics-session-card';
  }

  setActiveNav(rk);

  // Set analytics mode for analytics routes
  setAnalyticsMode(routeKey === 'analytics');
  setOverviewMode(routeKey === 'overview');
  setStimuliMode(routeKey === 'stimuli');
  setAdminMode(routeKey === 'admin');
  setSettingsMode(routeKey === 'settings');
  setExperimentsActiveMode(false);
  setExperimentsConstructorMode(false);

  // Create new page content
  let node;

  if(routeKey==='overview') node=OverviewView();
  //(Аня)
  else if (routeKey === 'experiments') {
    if (parts[1] === 'builder') {
      setExperimentsConstructorMode(true);
      const urlParams = new URLSearchParams(window.location.search);
      const storedStep = parseInt(localStorage.getItem('emocog_protocol_step_draft') || '0');
      const step = urlParams.get('step') ? parseInt(urlParams.get('step')) : (Number.isFinite(storedStep) ? storedStep : 0);
      node = ExperimentBuilderView({ startStep: step });
    } else if (parts[1] === 'edit' && parts[2]) {
      setExperimentsConstructorMode(true);
      node = ExperimentBuilderView({ experimentId: parts[2] });
    } else {
      node = ExperimentsListView();
    }
  }
  else if(routeKey==='stimuli') {
    // Sub-routes: /stimuli/all, /stimuli/library, /stimuli/upload — handled inside StimuliAOIView via selectedFolder/tab state
    if (subKey === 'all') { selectedFolder = null; currentStimuliFilter = 'all'; }
    node = StimuliAOIView();
  }//конец
  else if(routeKey==='sessions') node=SessionsView();
  else if(routeKey==='analytics') node=AnalyticsView(subKey||'session-card');
  else if(routeKey==='export') node=ExportView();
  else if(routeKey==='admin') node=AdminView();
  else if(routeKey==='settings') node=SettingsView();
  else if(routeKey==='billing') node=BillingView();
  else node=OverviewView();

  // Instantly replace content - NO wrapper, NO animation
  view.innerHTML = '';
  view.appendChild(node);

  applyAutoI18n(document.body);
}

// Instant navigation
let isNavigating = false;
function navigate(href){
  if(!href||!href.startsWith('#/')) return;
  isNavigating = true;
  if(location.hash!==href) location.hash=href;
  render(href);
  setTimeout(()=>isNavigating=false, 0);
}

function clearExperimentBuilderDraft() {
  localStorage.removeItem('emocog_protocol_blocks');
  localStorage.removeItem('emocog_protocol_meta_draft');
  localStorage.removeItem('emocog_protocol_step_draft');
}

function startNewExperimentBuilder() {
  clearExperimentBuilderDraft();
  navigate('#/experiments/builder');
}

// Event listeners
//$('#orgSelect').addEventListener('change',e=>{state.org=e.target.value.replace('Org: ','');render();toast('Org changed');});
$('#projectSelect').addEventListener('change',e=>{state.project=e.target.value.replace('Project: ','');render();toast('Project changed');});
// quick export replaced by + Create menu

$('#btnBack').addEventListener('click',()=>history.back());
$('#btnForward').addEventListener('click',()=>history.forward());

// Actions block is now always visible in right panel (no dropdown needed)



$('#btnFocus').addEventListener('click',()=>{state.focus=!state.focus;applyFocus();});
$('#btnToggleSidebar').addEventListener('click',toggleSidebar);

function updateRoleBadgeLabel(){
  const roleLabelEl = $('#currentUserRoleLabel');
  const roleTitleEl = $('#currentUserRoleTitle');
  const roleRaw = String(state.role || '').trim().toLowerCase();
  const isResearcher = roleRaw === 'исследователь' || roleRaw === 'researcher' || roleRaw === '';
  if(roleTitleEl) roleTitleEl.textContent = CURRENT_LANG === 'en' ? 'ROLE' : 'РОЛЬ';
  if(roleLabelEl){
    roleLabelEl.textContent = isResearcher
      ? (CURRENT_LANG === 'en' ? 'researcher' : 'исследователь')
      : roleRaw;
  }
}
updateRoleBadgeLabel();

// Keyboard shortcuts
window.addEventListener('keydown',e=>{
  if(e.altKey&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey){
    const k=e.key.toLowerCase();
    if(k==='1') navigate('#/overview');
    if(k==='2') navigate('#/experiments');
    if(k==='3') navigate('#/stimuli');
    if(k==='4') navigate('#/analytics/session-card');
    if(k==='5') navigate('#/admin');
    if(k==='6') navigate('#/settings');
    if(k==='e') navigate('#/export');
    if(k==='n') startNewExperimentBuilder();
    if(k==='\\') toggleSidebar(); // Alt+\ toggle sidebar
  }
});

// Click navigation - instant response
document.addEventListener('click',(e)=>{
  const a=e.target.closest('a[href^="#/"]');
  if(!a) return;
  const href=a.getAttribute('href');
  if(!href||!href.startsWith('#/')) return;
  e.preventDefault();

  if(a.dataset.disabled==='1'||a.classList.contains('disabled')){
    toast('Locked for demo');
    return;
  }
  navigate(href);
},true);

window.addEventListener('hashchange',()=>{
  if(isNavigating) return;
  render();
});

// Initialize
applyFocus();
initInspectorButtons();
if(state.sidebarCollapsed) {
  $('#app').classList.add('sidebar-collapsed');
  $('#btnToggleSidebar').classList.add('active');
}
updateStimuliSubnav();
(function bindResearcherChrome(){
  var lo = document.getElementById('qaLogout');
  if (lo) { lo.onclick = function(e){ e.preventDefault(); logoutResearcher(); }; }
  var ll = document.getElementById('leftLogoutBtn');
  if (ll) { ll.onclick = function(e){ e.preventDefault(); logoutResearcher(); }; }
  var br = document.querySelector('.hdr .brand');
  if (br && !br.dataset.homeBound) {
    br.dataset.homeBound = '1';
    br.style.cursor = 'pointer';
    br.setAttribute('role', 'link');
    br.setAttribute('tabindex', '0');
    br.addEventListener('click', function(){ window.location.href = 'index.html'; });
    br.addEventListener('keydown', function(ev){ if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); window.location.href = 'index.html'; } });
  }
})();
bootstrapAdminAccess();

// ===== WELCOME SCREEN LOGIC =====
(function(){
  // ── i18n texts ──
  const WS_TEXTS = {
    ru: {
      title: 'Добро пожаловать<br>на платформу <span class="hl">EMO COG!</span>',
      desc: 'Здесь вы можете создавать новые эксперименты, отслеживать подробную аналитику по проектам и управлять своими медиафайлами.<br><br><b>Создайте проект</b> или выберите существующий — и нажмите кнопку ниже.',
      btn: 'Перейти к экспериментам',
      panelTitle: 'Ваши проекты',
      panelSub: 'Выберите проект для работы или создайте новый. Выбранный проект откроется на основной странице.',
      createBtn: 'Создать проект',
      emptyHint: 'Проектов пока нет.',
      emptyHint2: 'Нажмите «Создать проект», чтобы добавить первый.',
      modalTitle: 'Новый проект',
      modalSub: 'Введите название проекта. После создания вы сможете добавлять в него эксперименты и следить за аналитикой.',
      modalPlaceholder: 'Например: Эмоции при чтении 2026',
      modalCreate: 'Создать',
      modalCancel: 'Отмена',
      selectHint: '← Выберите или создайте проект',
    },
    en: {
      title: 'Welcome<br>to the <span class="hl">EMO COG</span> Platform!',
      desc: 'Here you can create new experiments, track detailed analytics for your projects, and manage your media files.<br><br><b>Create a project</b> or select an existing one — then click the button below.',
      btn: 'Go to experiments',
      panelTitle: 'Your projects',
      panelSub: 'Select a project to work on or create a new one. The selected project will open on the main page.',
      createBtn: 'Create project',
      emptyHint: 'No projects yet.',
      emptyHint2: 'Click "Create project" to add your first one.',
      modalTitle: 'New project',
      modalSub: 'Enter the project name. Once created, you can add experiments to it and track analytics.',
      modalPlaceholder: 'E.g.: Emotions while reading 2026',
      modalCreate: 'Create',
      modalCancel: 'Cancel',
      selectHint: '← Select or create a project',
    }
  };

  const STORAGE_KEY = 'emocog_ws_projects';
  let wsLang = 'ru';
  let selectedProjectId = null;

  // ── helpers ──
  function loadProjects() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch(_){ return []; }
  }
  function saveProjects(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }
  function fmtDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(wsLang === 'ru' ? 'ru-RU' : 'en-US', {day:'numeric',month:'short',year:'numeric'});
    } catch(_){ return ''; }
  }
  function initials(name) {
    const words = (name || '').trim().split(/\s+/);
    return words.slice(0,2).map(w => w[0] || '').join('').toUpperCase() || 'P';
  }

  // ── Sync selected project to left panel ──
  function syncProjectToLeftPanel(projectName) {
    const sel = document.getElementById('projectSelect');
    if (!sel) return;
    // Check if option already exists
    let found = false;
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].textContent.trim() === projectName ||
          sel.options[i].value === projectName) {
        sel.selectedIndex = i;
        found = true;
        break;
      }
    }
    if (!found) {
      // Insert at top
      const opt = document.createElement('option');
      opt.value = projectName;
      opt.textContent = projectName;
      sel.insertBefore(opt, sel.firstChild);
      sel.selectedIndex = 0;
    }
    // Trigger state update
    if (typeof state !== 'undefined') {
      state.project = projectName;

    }
  }

  // ── Render project list ──
  function renderProjects() {
    const list = loadProjects();
    const container = document.getElementById('wsProjList');
    if (!container) return;

    const enterBtn = document.getElementById('wsEnterBtn');
    const texts = WS_TEXTS[wsLang];

    // The container itself is always the bordered box.
    // We just swap its inner content between empty-state and item cards.
    if (list.length === 0) {
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px 20px;text-align:center;height:100%;">
          <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="40" height="40" style="opacity:.30;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
          <div>
            <div style="font-weight:700;color:#64748B;margin-bottom:4px;">${texts.emptyHint}</div>
            <div style="font-size:12px;color:#94A3B8;line-height:1.5;">${texts.emptyHint2}</div>
          </div>
        </div>`;
      if (enterBtn) enterBtn.disabled = true;
      selectedProjectId = null;
      return;
    }

    // Auto-select first if nothing is selected yet
    if (!selectedProjectId) {
      selectedProjectId = list[0].id;
      if (enterBtn) enterBtn.disabled = false;
    } else if (enterBtn) {
      enterBtn.disabled = false;
    }

    container.innerHTML = list.map(p => `
      <div class="ws-proj-item ${selectedProjectId === p.id ? 'selected' : ''}" data-id="${p.id}" data-name="${p.name.replace(/"/g,'&quot;')}">
        <div class="ws-proj-dot">${initials(p.name)}</div>
        <div class="ws-proj-info">
          <div class="ws-proj-name">${p.name}</div>
          <div class="ws-proj-date">${fmtDate(p.createdAt)}</div>
        </div>
        <div class="ws-proj-check">
          ${selectedProjectId === p.id
            ? '<svg fill="none" stroke="#fff" stroke-width="3" viewBox="0 0 24 24" width="12" height="12"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>'
            : ''}
        </div>
      </div>
    `).join('');

    // Click handlers
    container.querySelectorAll('.ws-proj-item').forEach(item => {
      item.addEventListener('click', () => {
        selectedProjectId = item.dataset.id;
        renderProjects();
      });
    });
  }

  // ── Apply language ──
  function wsApplyLang(lang) {
    wsLang = lang;
    const texts = WS_TEXTS[lang];

    const titleEl = document.getElementById('wsTitle');
    const descEl = document.getElementById('wsDesc');
    const btnLabel = document.getElementById('wsEnterLabel');
    const panelTitle = document.getElementById('wsPanelTitle');
    const panelSub = document.getElementById('wsPanelSub');
    const createLabel = document.getElementById('wsCreateLabel');
    const modalTitle = document.getElementById('wsModalTitle');
    const modalSub = document.getElementById('wsModalSub');
    const modalInput = document.getElementById('wsModalInput');
    const modalCreate = document.getElementById('wsModalCreateLabel');
    const modalCancel = document.getElementById('wsModalCancelLabel');

    if (titleEl) titleEl.innerHTML = texts.title;
    if (descEl) descEl.innerHTML = texts.desc;
    if (btnLabel) btnLabel.textContent = texts.btn;
    if (panelTitle) panelTitle.textContent = texts.panelTitle;
    if (panelSub) panelSub.textContent = texts.panelSub;
    if (createLabel) createLabel.textContent = texts.createBtn;
    if (modalTitle) modalTitle.textContent = texts.modalTitle;
    if (modalSub) modalSub.textContent = texts.modalSub;
    if (modalInput) modalInput.placeholder = texts.modalPlaceholder;
    if (modalCreate) modalCreate.textContent = texts.modalCreate;
    if (modalCancel) modalCancel.textContent = texts.modalCancel;

    const ruBtn = document.getElementById('wsLangRu');
    const enBtn = document.getElementById('wsLangEn');
    if (ruBtn) ruBtn.classList.toggle('active', lang === 'ru');
    if (enBtn) enBtn.classList.toggle('active', lang === 'en');

    // Also apply to the main app
    if (typeof setLang === 'function') setLang(lang);

    renderProjects();
  }

  window.wsSetLang = function(lang) { wsApplyLang(lang); };

  // ── Create project modal ──
  // Declarations hoisted before functions that reference them
  var modal = document.getElementById('wsCreateModal');
  var wsModalInputEl = document.getElementById('wsModalInput');

  function openModal() {
    if (!modal) return;
    if (wsModalInputEl) { wsModalInputEl.value = ''; }
    modal.classList.add('open');
    setTimeout(() => { if (wsModalInputEl) wsModalInputEl.focus(); }, 80);
  }
  function closeModal() {
    if (modal) modal.classList.remove('open');
  }

  var createProjectBtn = document.getElementById('wsCreateProjectBtn');
  if (createProjectBtn) createProjectBtn.addEventListener('click', openModal);

  var cancelBtn = document.getElementById('wsModalCancelBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  if (modal) {
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  }

  var doCreate = function() {
    var name = (wsModalInputEl ? wsModalInputEl.value : '').trim();
    if (!name) {
      if (wsModalInputEl) { wsModalInputEl.style.borderColor = '#EF4444'; setTimeout(() => wsModalInputEl.style.borderColor = '', 1200); }
      return;
    }
    var list = loadProjects();
    var newProj = { id: 'proj_' + Date.now(), name: name, createdAt: new Date().toISOString() };
    list.unshift(newProj);
    saveProjects(list);
    selectedProjectId = newProj.id;
    closeModal();
    renderProjects();
    // Update enter button
    var enterBtnEl = document.getElementById('wsEnterBtn');
    if (enterBtnEl) enterBtnEl.disabled = false;
  };

  var createBtn = document.getElementById('wsModalCreateBtn');
  if (createBtn) createBtn.addEventListener('click', doCreate);

  if (wsModalInputEl) {
    wsModalInputEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') doCreate();
      if (e.key === 'Escape') closeModal();
    });
  }

  // ── Enter button ──
  const enterBtn = document.getElementById('wsEnterBtn');
  const ws = document.getElementById('welcomeScreen');

  if (enterBtn && ws) {
    enterBtn.addEventListener('click', function() {
      if (this.disabled) return;

      // Find selected project and sync to left panel
      const list = loadProjects();
      const proj = list.find(p => p.id === selectedProjectId);
      if (proj) {
        syncProjectToLeftPanel(proj.name);
        if (typeof navigate === 'function') navigate('#/overview');
        // Re-render overview to reflect project
        setTimeout(() => { if (typeof render === 'function') render(); }, 50);
      }


      ws.style.transition = 'opacity 0.22s';
      ws.style.opacity = '0';
      ws.style.pointerEvents = 'none';
      setTimeout(function() { ws.style.display = 'none'; }, 230);
    });
  }

  // ── Init ──
  renderProjects();
  wsApplyLang('ru');
})();
// ===== END WELCOME SCREEN LOGIC =====

const initialHash = location.hash || '#/overview';
render(initialHash);
if (location.hash) {
  const wsOnRouteRestore = document.getElementById('welcomeScreen');
  if (wsOnRouteRestore) {
    wsOnRouteRestore.style.display = 'none';
    wsOnRouteRestore.style.pointerEvents = 'none';
  }
}
