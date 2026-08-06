// ========== VIEW CONSTRUCTORS ==========

function OverviewView(){
  document.getElementById('pageTitle').textContent=(CURRENT_LANG==='en'?'Home':'Главная');
  setChips([]);

  const isEn = CURRENT_LANG === 'en';
  const cabinetTitle = isEn ? 'Researcher Cabinet' : 'Кабинет исследователя';
  const cabinetDesc = isEn
    ? 'Here you can create an experiment and explore analytics for your project.'
    : 'Здесь вы можете создать эксперимент и изучить аналитику по вашему проекту.';
  const btnCreateLabel = isEn ? 'Create experiment' : 'Создать эксперимент';
  const btnCreateSub = isEn
    ? 'Click the button to go to the protocol constructor'
    : 'Нажмите кнопку, чтобы перейти в конструктор создания протокола';
  const btnAnalyticsLabel = isEn ? 'Go to analytics' : 'Перейти к аналитике';
  const btnAnalyticsSub = isEn
    ? 'Click the button to check your experiment progress'
    : 'Нажмите кнопку, чтобы узнать прогресс по вашему эксперименту';

  const root = document.createElement('div');
  root.className = 'overview-page';
  root.innerHTML = `
      <div>
        <h2 class="overview-title">${cabinetTitle}</h2>
        <p class="overview-desc">${cabinetDesc}</p>
      </div>
      <div class="overview-actions">
        <!-- Create experiment button -->
        <button id="ovBtnCreate" style="
          display:flex;flex-direction:column;align-items:flex-start;gap:10px;
          background:linear-gradient(135deg, rgba(92,102,189,.18), rgba(119,169,232,.12));
          border:1.5px solid rgba(92,102,189,.35);
          border-radius:20px;
          padding:24px 22px;
          cursor:pointer;
          text-align:left;
          transition:box-shadow 0.15s, transform 0.1s;
          box-shadow:0 4px 18px rgba(92,102,189,.10);
        ">
          <div style="font-size:11px;font-weight:600;color:var(--muted);letter-spacing:.06em;line-height:1.4;opacity:.85;">${btnCreateSub}</div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:auto;">
            <span style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;background:var(--accent);color:#fff;flex-shrink:0;">
              <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
            </span>
            <span style="font-size:17px;font-weight:800;color:var(--accent);letter-spacing:-.2px;">${btnCreateLabel}</span>
          </div>
        </button>
        <!-- Analytics button -->
        <button id="ovBtnAnalytics" style="
          display:flex;flex-direction:column;align-items:flex-start;gap:10px;
          background:linear-gradient(135deg, rgba(16,185,129,.10), rgba(119,169,232,.08));
          border:1.5px solid rgba(16,185,129,.32);
          border-radius:20px;
          padding:24px 22px;
          cursor:pointer;
          text-align:left;
          transition:box-shadow 0.15s, transform 0.1s;
          box-shadow:0 4px 18px rgba(16,185,129,.08);
        ">
          <div style="font-size:11px;font-weight:600;color:var(--muted);letter-spacing:.06em;line-height:1.4;opacity:.85;">${btnAnalyticsSub}</div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:auto;">
            <span style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;background:var(--good);color:#fff;flex-shrink:0;">
              <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
            </span>
            <span style="font-size:17px;font-weight:800;color:var(--good);letter-spacing:-.2px;">${btnAnalyticsLabel}</span>
          </div>
        </button>
      </div>
  `;

  root.querySelector('#ovBtnCreate').addEventListener('click', startNewExperimentBuilder);
  root.querySelector('#ovBtnAnalytics').addEventListener('click', () => navigate('#/analytics/session-card'));

  // Hover effects
  ['#ovBtnCreate','#ovBtnAnalytics'].forEach(sel => {
    const btn = root.querySelector(sel);
    btn.addEventListener('mouseenter', () => { btn.style.transform='translateY(-2px)'; btn.style.boxShadow='0 8px 28px rgba(92,102,189,.18)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform=''; btn.style.boxShadow=''; });
  });

  // ── ONBOARDING TRACK (inserted BEFORE the action buttons) ──
  const isEn2 = CURRENT_LANG === 'en';
  const trackSteps = isEn2 ? [
    { icon: '🧪', label: 'Create experiment', desc: 'Set up protocol, stimuli, and blocks', color: '#5C66BD' },
    { icon: '👥', label: 'Add participants', desc: 'Invite people to your research', color: '#77A9E8' },
    { icon: '▶', label: 'Run sessions', desc: 'Collect real-time eye-tracking data', color: '#10B981' },
    { icon: '📊', label: 'View analytics', desc: 'Explore QC, metrics and group results', color: '#F59E0B' },
  ] : [
    { icon: '🧪', label: 'Создать эксперимент', desc: 'Настройте протокол, стимулы и блоки', color: '#5C66BD' },
    { icon: '👥', label: 'Добавить участников', desc: 'Пригласите людей в ваше исследование', color: '#77A9E8' },
    { icon: '▶', label: 'Провести сессии', desc: 'Сбор данных айтрекинга в реальном времени', color: '#10B981' },
    { icon: '📊', label: 'Смотреть аналитику', desc: 'QC, метрики и групповые результаты', color: '#F59E0B' },
  ];

  const trackTitle = isEn2 ? 'How it works' : 'Как это работает';
  const trackWrap = document.createElement('div');
  trackWrap.style.cssText = 'margin-top:28px;margin-bottom:0;';
  trackWrap.innerHTML = `
    <div style="font-size:16px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:var(--text);margin-bottom:20px;">${trackTitle}</div>
    <div style="display:flex;align-items:flex-start;gap:0;overflow-x:auto;padding-bottom:8px;">
      ${trackSteps.map((step, i) => `
        <div style="display:flex;align-items:flex-start;gap:0;flex:1;min-width:160px;">
          <div class="onb-step" style="flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;padding:0 12px;">
            <div style="width:72px;height:72px;border-radius:20px;background:linear-gradient(135deg,${step.color}28,${step.color}14);border:2px solid ${step.color}55;display:flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:14px;flex-shrink:0;">${step.icon}</div>
            <div style="font-size:14px;font-weight:800;color:var(--text);white-space:pre-line;line-height:1.3;margin-bottom:6px;">${step.label}</div>
            <div style="font-size:12px;color:var(--muted);line-height:1.45;">${step.desc}</div>
          </div>
          ${i < trackSteps.length - 1 ? `<div style="flex-shrink:0;width:44px;display:flex;align-items:center;justify-content:center;padding-top:20px;"><svg fill="none" stroke="var(--muted2)" stroke-width="2.8" viewBox="0 0 24 24" width="26" height="26" style="opacity:.55;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg></div>` : ''}
        </div>
      `).join('')}
    </div>
  `;

  // Insert onboarding BEFORE the action buttons
  const actionsDiv = root.querySelector('.overview-actions');
  root.insertBefore(trackWrap, actionsDiv);

  // ── USER PROJECTS ON OVERVIEW (right side / below) ──
  let userProjects = [];
  try { userProjects = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch(_){}

  if (userProjects.length > 0) {
    const projSection = document.createElement('div');
    projSection.style.cssText = 'margin-top:36px;';
    const projSectionTitle = isEn2 ? 'Your projects' : 'Ваши проекты';
    projSection.innerHTML = `
      <div style="font-size:11px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:var(--muted2);margin-bottom:14px;">${projSectionTitle}</div>
      <div style="display:flex;flex-wrap:wrap;gap:12px;">
        ${userProjects.map(p => {
          const words = (p.name||'').trim().split(/\s+/);
          const ini = words.slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'P';
          const d = new Date(p.createdAt);
          const dateStr = isNaN(d) ? '' : d.toLocaleDateString(isEn2?'en-US':'ru-RU',{day:'numeric',month:'short',year:'numeric'});
          return `<div class="ov-proj-card" data-proj="${escapeUiHtml(p.name)}" style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-radius:14px;border:1.5px solid rgba(92,102,189,.20);background:rgba(255,255,255,.52);cursor:pointer;transition:all .12s;min-width:200px;flex:1;max-width:280px;">
            <div style="width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#5C66BD,#77A9E8);display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:800;flex-shrink:0;">${escapeUiHtml(ini)}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeUiHtml(p.name)}</div>
              ${dateStr ? `<div style="font-size:11px;color:var(--muted2);">${escapeUiHtml(dateStr)}</div>` : ''}
            </div>
            <svg fill="none" stroke="var(--muted2)" stroke-width="2" viewBox="0 0 24 24" width="14" height="14" style="flex-shrink:0;opacity:.5;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
          </div>`;
        }).join('')}
      </div>
    `;
    projSection.querySelectorAll('.ov-proj-card').forEach(card => {
      card.addEventListener('mouseenter', () => { card.style.borderColor='rgba(92,102,189,.40)'; card.style.background='rgba(255,255,255,.75)'; card.style.transform='translateY(-1px)'; });
      card.addEventListener('mouseleave', () => { card.style.borderColor=''; card.style.background=''; card.style.transform=''; });
      card.addEventListener('click', () => {
        if(typeof state !== 'undefined') state.project = card.dataset.proj;
        const sel = document.getElementById('projectSelect');
        if(sel) { for(let i=0;i<sel.options.length;i++){ if(sel.options[i].textContent.trim()===card.dataset.proj){sel.selectedIndex=i;break;} } }
        const projectId = typeof getSelectedProjectRouteId === 'function'
          ? getSelectedProjectRouteId()
          : null;
        navigate(projectId ? `#/projects/${projectId}/overview` : '#/experiments');
      });
    });
    root.appendChild(projSection);
  }

  return root;
}

//Стимулы и эксперименты (Аня)
function ExperimentsListView() {
  document.getElementById('pageTitle').textContent = t('experimentsListTitle');

  setChips([]);

  function participantLinkForExperiment(exp) {
    const protocolId = (exp?.metadata?.protocolId || exp?.protocolId || exp?.id || 'protocol').trim();
    if (typeof window.buildParticipantRunLink === 'function') {
      return window.buildParticipantRunLink(protocolId);
    }
    return (window.location.origin || '') + '/invite/' + encodeURIComponent(protocolId);
  }

  const root = document.createElement('div');
  root.style.cssText = 'display:flex; flex-direction:column; height:calc(100% + 40px); min-height:0; margin:-20px; padding:0;';

  const content = document.createElement('div');
  content.style.cssText = 'flex:1; overflow-y:auto; min-height:0; padding:20px;';
  root.appendChild(content);

  function renderActiveTab() {
    let experiments = JSON.parse(localStorage.getItem('emocog_my_experiments')) || [];

    if (experiments.length === 0) {
      content.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--muted);text-align:center;">
          <div style="font-size:15px;margin-bottom:8px;">${t('noExperiments')}</div>
          <div style="font-size:13px;opacity:0.7;">${t('noExperimentsDesc')}</div>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px; max-width:1200px; margin:0 auto;">
        ${experiments.map(exp => `
          <div class="card exp-card" data-id="${escapeUiHtml(exp.id)}" style="padding:20px;cursor:pointer;transition:transform 0.1s;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
              <div style="font-size:16px;font-weight:700;color:var(--text);line-height:1.3;">${escapeUiHtml(exp.title || (CURRENT_LANG === 'en' ? 'Untitled' : 'Без названия'))}</div>
              <span style="font-size:10px;font-weight:700;padding:4px 8px;border-radius:6px;background:${exp.status==='active'?'rgba(16,185,129,.15)':'rgba(92,102,189,.1)'};color:${exp.status==='active'?'var(--good)':'var(--muted)'};">
                ${exp.status === 'active' ? t('active') : t('draft')}
              </span>
      </div>
            <div style="font-size:12px;color:var(--muted);margin-bottom:16px;">
              ${(exp.blocks||[]).length} ${CURRENT_LANG === 'en' ? 'blocks' : 'блоков'} · ${new Date(exp.updatedAt||Date.now()).toLocaleDateString(CURRENT_LANG === 'en' ? 'en-US' : 'ru-RU')}
    </div>
            <div style="display:flex;gap:8px;border-top:1px solid var(--stroke);padding-top:12px;flex-wrap:wrap;">
              <button class="quick-btn edit-exp-btn" data-id="${escapeUiHtml(exp.id)}" style="flex:1;justify-content:center;font-size:12px;">${t('editExperiment')}</button>
              <button class="quick-btn copy-exp-link-btn" data-link="${escapeUiHtml(participantLinkForExperiment(exp))}" style="flex:1;justify-content:center;font-size:12px;background:rgba(92,102,189,.08);border-color:rgba(92,102,189,.24);color:var(--accent);font-weight:700;">
                ${autoTranslateString('Скопировать ссылку', CURRENT_LANG)}
              </button>
              <button class="quick-btn del-exp-btn" data-id="${escapeUiHtml(exp.id)}" style="padding:8px;color:var(--bad);border-color:rgba(239,68,68,.2);"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
      </div>
    </div>
        `).join('')}
    </div>
  `;

    content.querySelectorAll('.edit-exp-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); navigate(`#/experiments/edit/${btn.dataset.id}`); });
    });
    content.querySelectorAll('.copy-exp-link-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const link = btn.dataset.link;
        try {
          await navigator.clipboard.writeText(link);
        } catch (_) {
          const temp = document.createElement('input');
          temp.value = link;
          document.body.appendChild(temp);
          temp.select();
          document.execCommand('copy');
          document.body.removeChild(temp);
        }
        toast(CURRENT_LANG === 'en' ? 'Participant link copied' : 'Ссылка для участника скопирована');
      });
    });
    content.querySelectorAll('.del-exp-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        let exps = JSON.parse(localStorage.getItem('emocog_my_experiments')) || [];
        exps = exps.filter(ex => ex.id !== btn.dataset.id);
        localStorage.setItem('emocog_my_experiments', JSON.stringify(exps));
        renderActiveTab();
        toast(t('deleteExperiment') + ' ✓');
      });
    });
    content.querySelectorAll('.exp-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        navigate(`#/experiments/edit/${card.dataset.id}`);
      });
    });
  }

  setExperimentsActiveMode(true);
  setExperimentsConstructorMode(false);
  renderActiveTab();

  return root;
}
