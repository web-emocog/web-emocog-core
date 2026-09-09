// Utility functions
const $=s=>document.querySelector(s);
function escapeUiHtml(value){
  return String(value == null ? '' : value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
window.escapeUiHtml = window.escapeUiHtml || escapeUiHtml;
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
window.API_BASE = window.EmocogApiBase
  ? window.EmocogApiBase.resolve()
  : (window.API_BASE || (window.location.origin + '/api'));
window.API_TOKEN = '';
function authHeaders(){ const h = {}; const csrf=sessionStorage.getItem('emocog_csrf_token'); if(csrf) h['X-CSRF-Token']=csrf; return h; }
function apiHeaders(){ return {'Content-Type':'application/json'}; }
async function apiFailError(r){
  let detail = r.statusText || '';
  try{
    const ct = r.headers.get('content-type') || '';
    if(ct.includes('application/json')){
      const j = await r.json();
      if(j && j.error) detail = [j.error, j.message].filter(Boolean).join(' — ');
      else if(j && j.message) detail = j.message;
      else if(j && Array.isArray(j.errors) && j.errors.length){
        detail = j.errors.map(function(e){ return e.msg || e.message || String(e); }).join('; ');
      }
    }
  }catch(_){}
  return new Error(r.status + (detail ? ' — ' + detail : ''));
}
function apiRequestHeaders(json){ const h=json?apiHeaders():authHeaders(); const csrf=sessionStorage.getItem('emocog_csrf_token'); if(csrf) h['X-CSRF-Token']=csrf; return h; }
async function apiGet(path){ const base = (window.API_BASE||'').replace(/\/$/,''); const url = base ? (base + path) : path; const r = await fetch(url, {headers: apiRequestHeaders(true),credentials:'include'}); if(!r.ok) throw await apiFailError(r); return r.json(); }
async function apiPost(path, body){
  const base = (window.API_BASE||'').replace(/\/$/,''); const url = base ? (base + path) : path;
  const isFormData = (typeof FormData !== 'undefined') && body instanceof FormData;
  const headers = apiRequestHeaders(!isFormData);
  const payload = isFormData ? body : JSON.stringify(body || {});
  const r = await fetch(url, { method: 'POST', headers, body: payload, credentials:'include' });
  if(!r.ok) throw await apiFailError(r);
  return r.status === 204 ? null : r.json();
}
async function apiPatch(path, body){ const base = (window.API_BASE||'').replace(/\/$/,''); const url = base ? (base + path) : path; const r = await fetch(url, { method: 'PATCH', headers: apiRequestHeaders(true), body: JSON.stringify(body || {}), credentials:'include' }); if(!r.ok) throw await apiFailError(r); return r.json(); }
async function apiDelete(path){ const base = (window.API_BASE||'').replace(/\/$/,''); const url = base ? (base + path) : path; const r = await fetch(url, { method: 'DELETE', headers: apiRequestHeaders(false), credentials:'include' }); if(!r.ok) throw await apiFailError(r); return r.status === 204 ? null : r.json(); }

function getParticipantWebBasePath(){
  var pathname = window.location.pathname || '';
  var base = pathname.replace(/\/web\/[^/]*$/, '/participant-web/');
  if (base === pathname) base = pathname.replace(/\/apps\/web\/[^/]*$/, '/apps/participant-web/');
  if (base === pathname) base = '/apps/participant-web/';
  return (window.location.origin || '') + base;
}
function buildParticipantRunLink(codeOrProtocolId){
  var code = String(codeOrProtocolId || '').trim();
  if (!code) return getParticipantWebBasePath() + 'run_new.html';
  return getParticipantWebBasePath() + 'run_new.html?code=' + encodeURIComponent(code);
}
window.getParticipantWebBasePath = getParticipantWebBasePath;
window.buildParticipantRunLink = buildParticipantRunLink;
function parseParticipantInviteCodeFromHash(hash) {
  var m = String(hash || location.hash || '').match(/^#\/?participant\/([^/?#]+)/i);
  if (!m || !m[1]) return null;
  var code = decodeURIComponent(m[1]).trim();
  if (!code || code.length < 2 || code.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(code)) return null;
  return code;
}
function redirectLegacyParticipantInviteHash() {
  var code = parseParticipantInviteCodeFromHash();
  if (!code) return false;
  window.location.replace(buildParticipantRunLink(code));
  return true;
}

function getApiBaseForResearcher() {
  return String(window.EmocogApiBase ? window.EmocogApiBase.resolve() : window.API_BASE || '').replace(/\/$/, '');
}
function hasResearcherApiToken() {
  return localStorage.getItem('emocog_developer_auth') === '1'
    || sessionStorage.getItem('emocog_developer_auth') === '1';
}
function builderApiStateKey(experimentKey) {
  return 'emocog_builder_api_' + (experimentKey || 'draft');
}
function loadBuilderApiState(experimentKey) {
  try {
    return JSON.parse(localStorage.getItem(builderApiStateKey(experimentKey)) || 'null') || {};
  } catch (_) {
    return {};
  }
}
function saveBuilderApiState(experimentKey, patch) {
  var prev = loadBuilderApiState(experimentKey);
  localStorage.setItem(builderApiStateKey(experimentKey), JSON.stringify(Object.assign({}, prev, patch || {})));
}
function deriveSelectedMetricsFromBlocks(blocks) {
  var reg = typeof window !== 'undefined' ? window.RtRegistry : null;
  var metrics = [];
  (blocks || []).forEach(function (block) {
    if (!block || block.type !== 'cognitive_task') return;
    var cfg = block.blockConfig || block.content || {};
    var taskType = reg
      ? reg.mapWebTaskToAnalyzer(String(block.taskType || cfg.taskType || cfg.rt_task || 'simple'))
      : String(block.taskType || cfg.taskType || cfg.rt_task || 'simple').toLowerCase();
    var list = reg
      ? reg.resolveSelectedMetrics(taskType, cfg.selected_metrics || null)
      : (cfg.selected_metrics || []);
    if (Array.isArray(list)) {
      list.forEach(function (m) { if (m && metrics.indexOf(m) < 0) metrics.push(m); });
    }
  });
  return metrics;
}
async function resolveApiProjectId() {
  var fromStorage = parseInt(localStorage.getItem('emocog_selected_project_id'), 10);
  if (Number.isFinite(fromStorage) && fromStorage > 0) return fromStorage;
  var projects = await apiGet('/projects');
  if (Array.isArray(projects) && projects[0] && projects[0].id) {
    localStorage.setItem('emocog_selected_project_id', String(projects[0].id));
    return parseInt(projects[0].id, 10);
  }
  throw new Error('В API нет проектов. Создайте проект или войдите как исследователь.');
}
async function persistBuilderProtocolToApi(exportJson, experimentKey, options) {
  options = options || {};
  if (!hasResearcherApiToken()) {
    throw new Error('Нужен вход в API. Откройте apps/web/developer/login.html');
  }
  var projectId = options.projectId != null ? parseInt(options.projectId, 10) : await resolveApiProjectId();
  var apiState = loadBuilderApiState(experimentKey);
  var slug = String(exportJson.protocolId || options.invitationCode || '').trim();
  var definition = Object.assign({}, exportJson, {
    protocolId: slug || exportJson.protocolId || null,
    selected_metrics: deriveSelectedMetricsFromBlocks(exportJson.blocks)
  });
  var payload = { name: String(exportJson.title || 'Protocol').trim(), definition: definition };
  var targetProtocolId = options.forceProtocolId || apiState.apiProtocolId;
  var saved;
  if (targetProtocolId && !options.forceCreate) {
    saved = await apiPatch('/protocols/' + targetProtocolId, payload);
  } else {
    // A duplicate stable identity is a user-visible conflict. Never recover it
    // by patching an existing protocol: that can overwrite another experiment.
    saved = await apiPost('/protocols', Object.assign({ project_id: projectId }, payload));
  }
  saveBuilderApiState(experimentKey, {
    apiProtocolId: saved.id,
    projectId: saved.project_id || projectId,
    invitationCode: options.invitationCode || apiState.invitationCode || null,
    publishVerifiedAt: null
  });
  localStorage.setItem('emocog_selected_project_id', String(saved.project_id || projectId));
  return saved;
}
async function createInvitationForProtocol(protocolId, options) {
  options = options || {};
  var pid = parseInt(protocolId, 10);
  if (!Number.isFinite(pid)) throw new Error('Invalid protocol ID');
  var body = { protocol_id: pid };
  if (options.maxRuns) body.max_runs = parseInt(options.maxRuns, 10);
  if (options.expiresAt) body.expires_at = options.expiresAt;
  return apiPost('/invitations', body);
}
async function publishBuilderProtocolAndInvitation(exportJson, experimentKey, protocolSlug) {
  var slug = String(protocolSlug || exportJson.protocolId || '').trim();
  if (!slug) throw new Error('Укажите Protocol ID');
  var apiState = loadBuilderApiState(experimentKey);
  var isNewProtocol = String(experimentKey || '') === 'draft';
  var publishOpts = isNewProtocol ? { forceCreate: true } : {};
  var existingInvitation = null;
  var existingCode = isNewProtocol ? null : apiState.invitationCode;
  if (existingCode) {
    try {
      existingInvitation = await apiGet(
        '/invitations/by-code/' + encodeURIComponent(existingCode)
      );
      if (existingInvitation && existingInvitation.protocol_id) {
        publishOpts.forceProtocolId = parseInt(existingInvitation.protocol_id, 10);
      }
    } catch (_) { /* сохранённое приглашение больше недоступно — создадим новое */ }
  }
  var savedProtocol = await persistBuilderProtocolToApi(exportJson, experimentKey, publishOpts);
  var inv = existingInvitation && Number(existingInvitation.protocol_id) === Number(savedProtocol.id)
    ? existingInvitation
    : null;
  if (!inv) {
    var invitations = await apiGet('/invitations?protocol_id=' + encodeURIComponent(String(savedProtocol.id)));
    var now = Date.now();
    inv = Array.isArray(invitations) ? invitations.find(function (candidate) {
      var withinExpiry = !candidate.expires_at || Date.parse(candidate.expires_at) > now;
      var withinRuns = candidate.max_runs == null || Number(candidate.runs_used || 0) < Number(candidate.max_runs);
      return withinExpiry && withinRuns;
    }) : null;
  }
  if (!inv) inv = await createInvitationForProtocol(savedProtocol.id);
  saveBuilderApiState(experimentKey, {
    apiProtocolId: savedProtocol.id,
    invitationCode: inv.code,
    projectId: savedProtocol.project_id,
    publishVerifiedAt: new Date().toISOString()
  });
  return {
    protocol: savedProtocol,
    invitation: inv,
    link: buildParticipantRunLink(inv.code)
  };
}
window.publishBuilderProtocolAndInvitation = publishBuilderProtocolAndInvitation;
window.buildParticipantRunLink = buildParticipantRunLink;
window.deriveSelectedMetricsFromBlocks = deriveSelectedMetricsFromBlocks;

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

async function logoutResearcher() {
  try {
    const base = getApiBaseForResearcher();
    await fetch(base + '/auth/logout', {
      method: 'POST',
      headers: apiRequestHeaders(false),
      credentials: 'include',
      keepalive: true
    });
  } catch (_) {}
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
let stimuliList = (JSON.parse(localStorage.getItem('emocog_stimuli')) || []).map(stimulus => (
  stimulus?.sourceDocumentName && stimulus.type === 'image'
    ? { ...stimulus, type: 'slides' }
    : stimulus
));
let selectedStimulusId = null;
let currentStimuliFilter = 'all';  // all / image / video / audio / text
let folders = JSON.parse(localStorage.getItem('emocog_folders')) || [];
let selectedFolder = null;

function localizedFolderName(folder) {
  if (!folder) return '';
  if (folder.id === 'folder_standard' || folder.name === 'Стандартные') {
    return (typeof CURRENT_LANG !== 'undefined' && CURRENT_LANG === 'en') ? 'Standard' : 'Стандартные';
  }
  return folder.name;
}
//Конец изменения

// Sidebar toggle
function toggleSidebar(){
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem('sidebarCollapsed', state.sidebarCollapsed);
  $('#app').classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  $('#btnToggleSidebar').classList.toggle('active', state.sidebarCollapsed);
}

function setMobileNavigation(open){
  const app = $('#app');
  const button = $('#mobileNavToggle');
  if(!app || !button) return;
  const next = open === true;
  const iconPath = button.querySelector('path');
  app.classList.toggle('mobile-nav-open', next);
  button.setAttribute('aria-expanded', next ? 'true' : 'false');
  if(iconPath){
    iconPath.setAttribute(
      'd',
      next ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'
    );
  }
  button.setAttribute(
    'aria-label',
    next
      ? (CURRENT_LANG === 'en' ? 'Close navigation' : 'Закрыть навигацию')
      : (CURRENT_LANG === 'en' ? 'Open navigation' : 'Открыть навигацию')
  );
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
  document.querySelectorAll('.nav a').forEach(a=>{
    a.classList.remove('active');
    a.removeAttribute('aria-current');
  });
  document.querySelectorAll('.nav .has-subnav').forEach(d=>d.classList.remove('active'));

  const el=$(`#nav-${route}`);
  if(el){
    el.classList.add('active');
    if(!String(route || '').startsWith('analytics-')) el.setAttribute('aria-current','page');
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
    if(mainLink){
      mainLink.classList.add('active');
      mainLink.setAttribute('aria-current','page');
    }
  }
  // For any stimuli route: expand the stimuli subnav
  if(route && route.startsWith('stimuli')){
    const stimuliParent = $('#nav-stimuli-parent');
    if(stimuliParent) stimuliParent.classList.add('active');
    const mainLink = $('#nav-stimuli');
    if(mainLink){
      mainLink.classList.add('active');
      mainLink.setAttribute('aria-current','page');
    }
  }
}

// Chips
function setChips(arr){
  const c=$('#chips');
  c.innerHTML=arr.map((x,i)=>`<div class="chip ${i===0?'active':''}">${x}</div>`).join('');
  c.style.display = arr.length ? '' : 'none';
}

// Inspector removed — no-op for legacy callers
function setInspectorMode(){}
function setInspector(){}
function getExperimentAnalyticsConfig(experimentKey) {
  const key = 'emocog_analytics_config_' + (experimentKey || 'draft');
  const defaults = {
    tabs: {
      'session-card': true,
      'group-comparison': true,
      'data-quality': true,
      'connectedness': true
    }
  };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved) return defaults;
    if (saved.tabs) return { tabs: { ...defaults.tabs, ...saved.tabs } };
    const legacy = {
      'session-card': saved.perParticipantSessionQuality !== false,
      'group-comparison': saved.groupAnalytics !== false,
      'data-quality': saved.dataQuality !== false,
      'connectedness': saved.connectedness !== false
    };
    return { tabs: { ...defaults.tabs, ...legacy } };
  } catch (_) {
    return defaults;
  }
}
window.getExperimentAnalyticsConfig = getExperimentAnalyticsConfig;

// Hash parsing
function parseHash(h){
  const hash=(h||location.hash||'#/overview');
  const parts=hash.replace(/^#\/?/,'').split('/');
  return {route:(parts[0]||'overview'),parts};
}

// INSTANT render - контент остается видимым
function render(hashOverride){
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
  localStorage.removeItem(builderApiStateKey('draft'));
  if (window.EmocogAnalyticsPlan && typeof window.EmocogAnalyticsPlan.clearDraft === 'function') {
    window.EmocogAnalyticsPlan.clearDraft();
  }
}

function startNewExperimentBuilder() {
  clearExperimentBuilderDraft();
  navigate('#/experiments/builder');
}

// Event listeners
//$('#orgSelect').addEventListener('change',e=>{state.org=e.target.value.replace('Org: ','');render();toast('Org changed');});
$('#projectSelect').addEventListener('change',e=>{
  state.project=e.target.value.replace('Project: ','');
  try {
    const workspaceProjects = JSON.parse(localStorage.getItem('emocog_ws_projects')) || [];
    const workspaceProject = workspaceProjects.find(project => project.name === state.project || String(project.id) === String(e.target.value));
    if (workspaceProject) localStorage.setItem('emocog_selected_workspace_project_id', String(workspaceProject.id));
  } catch (_) { /* keep the previously selected project id */ }
  render();
  toast(CURRENT_LANG === 'en' ? 'Project changed' : 'Проект изменён');
});
// quick export replaced by + Create menu


// Actions block is now always visible in right panel (no dropdown needed)



$('#btnFocus').addEventListener('click',()=>{state.focus=!state.focus;applyFocus();});
$('#btnToggleSidebar').addEventListener('click',toggleSidebar);
$('#mobileNavToggle')?.addEventListener('click',()=>{
  setMobileNavigation(!$('#app').classList.contains('mobile-nav-open'));
});
$('#mobileNavBackdrop')?.addEventListener('click',()=>setMobileNavigation(false));
window.addEventListener('resize',()=>{
  if(window.innerWidth > 900) setMobileNavigation(false);
});

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
  setMobileNavigation(false);
  if(href==='#/experiments/builder'){
    startNewExperimentBuilder();
    return;
  }
  navigate(href);
},true);

window.addEventListener('hashchange',()=>{
  if (redirectLegacyParticipantInviteHash()) return;
  if(isNavigating) return;
  render();
});

// Initialize
applyFocus();
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
      title: 'Добро пожаловать<br>в <span class="hl">wecog</span>',
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
      title: 'Welcome<br>to <span class="hl">wecog</span>',
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
  function syncProjectToLeftPanel(projectName, projectId) {
    const sel = document.getElementById('projectSelect');
    if (!sel) return;
    // Check if option already exists
    let found = false;
    for (let i = 0; i < sel.options.length; i++) {
      if (String(sel.options[i].value) === String(projectId) ||
          sel.options[i].textContent.trim() === projectName ||
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
      <div class="ws-proj-item ${selectedProjectId === p.id ? 'selected' : ''}" data-no-auto-i18n data-id="${escapeUiHtml(p.id)}" data-name="${escapeUiHtml(p.name)}">
        <div class="ws-proj-dot">${escapeUiHtml(initials(p.name))}</div>
        <div class="ws-proj-info">
          <div class="ws-proj-name">${escapeUiHtml(p.name)}</div>
          <div class="ws-proj-date">${escapeUiHtml(fmtDate(p.createdAt))}</div>
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

  window.syncWelcomeProjects = function(projects) {
    const list = (Array.isArray(projects) ? projects : []).map(function(project) {
      return {
        id: String(project.id),
        name: String(project.name || ('Project ' + project.id)),
        createdAt: project.created_at || project.createdAt || new Date().toISOString(),
        organizationId: project.organization_id == null ? null : Number(project.organization_id),
      };
    });
    saveProjects(list);
    const preferred = localStorage.getItem('emocog_selected_project_id');
    selectedProjectId = list.some(function(project) { return project.id === String(preferred); })
      ? String(preferred)
      : (list[0] ? list[0].id : null);
    renderProjects();
  };

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
    const errorEl = document.getElementById('wsModalError');
    if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }
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

  var doCreate = async function() {
    var name = (wsModalInputEl ? wsModalInputEl.value : '').trim();
    if (!name) {
      if (wsModalInputEl) { wsModalInputEl.style.borderColor = '#EF4444'; setTimeout(() => wsModalInputEl.style.borderColor = '', 1200); }
      return;
    }
    var errorEl = document.getElementById('wsModalError');
    var createButton = document.getElementById('wsModalCreateBtn');
    if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }
    if (createButton) createButton.disabled = true;
    try {
      if (typeof apiGet !== 'function' || typeof apiPost !== 'function') {
        throw new Error('API недоступен. Проверьте соединение и повторите попытку.');
      }
      var projects = await apiGet('/projects');
      var organizationId = projects[0] && projects[0].organization_id;
      if (!organizationId) {
        var organizations = await apiGet('/organizations');
        organizationId = organizations[0] && organizations[0].id;
      }
      if (!organizationId) {
        throw new Error('Сначала администратор должен создать организацию и выдать доступ.');
      }
      var created = await apiPost('/projects', {
        organization_id: Number(organizationId),
        name: name,
        slug: 'project-' + Date.now().toString(36),
      });
      selectedProjectId = String(created.id);
      localStorage.setItem('emocog_selected_project_id', selectedProjectId);
      if (window.EmocogResearcherBridge) {
        await window.EmocogResearcherBridge.syncProjectsFromApi();
      } else {
        window.syncWelcomeProjects([created].concat(projects));
      }
      closeModal();
    } catch (error) {
      if (errorEl) {
        errorEl.textContent = error && error.message ? error.message : 'Не удалось создать проект.';
        errorEl.style.display = 'block';
      }
    } finally {
      if (createButton) createButton.disabled = false;
    }
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
        localStorage.setItem('emocog_selected_workspace_project_id', String(proj.id));
        localStorage.setItem('emocog_selected_project_id', String(proj.id));
        syncProjectToLeftPanel(proj.name, proj.id);
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
  let initialWorkspaceLanguage = 'ru';
  try {
    const savedLanguage = localStorage.getItem('wecog_researcher_language');
    if (savedLanguage === 'ru' || savedLanguage === 'en') initialWorkspaceLanguage = savedLanguage;
  } catch (_) {}
  wsApplyLang(initialWorkspaceLanguage);
})();
// ===== END WELCOME SCREEN LOGIC =====

if (!redirectLegacyParticipantInviteHash()) {
  const initialHash = location.hash || '#/overview';
  render(initialHash);
}
if (location.hash) {
  const wsOnRouteRestore = document.getElementById('welcomeScreen');
  if (wsOnRouteRestore) {
    wsOnRouteRestore.style.display = 'none';
    wsOnRouteRestore.style.pointerEvents = 'none';
  }
}
