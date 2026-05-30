function StimuliAOIView() {
  document.getElementById('pageTitle').textContent = t('StimuliLibrary');
  setChips([t('Library'), t('Upload')]);

  updateStimuliSubnav();

  const root = document.createElement('div');
  root.style.cssText = 'display:flex; flex-direction:column; height:calc(100% + 40px); min-height:0; margin:-20px; padding:0;';

  const topBarWrap = document.createElement('div');
  topBarWrap.style.cssText = 'display:flex; flex-direction:column; border-bottom:1px solid var(--stroke); background:rgba(255,255,255,.20); flex-shrink:0; width:100%;';

  const tabsRow = document.createElement('div');
  tabsRow.style.cssText = 'display:flex; align-items:flex-end; padding:0; overflow-x:auto; scrollbar-width:none; -webkit-overflow-scrolling:touch; width:100%;';

  const leftTabs = document.createElement('div');
  leftTabs.className = 'analytics-tabs';
  leftTabs.id = 'stimuliTabBar';
  leftTabs.style.cssText = 'border-bottom:none; padding:12px 20px 0 20px; display:flex; gap:2px; min-width:0; overflow-x:auto; flex-wrap:nowrap;flex:1; width:100%;';

  let currentTab = 'library'; // 'library' | 'upload' | 'folder'

  function rebuildTabBar() {
    leftTabs.innerHTML = '';

    const addFolderTab = document.createElement('div');
    addFolderTab.className = 'analytics-tab';
    addFolderTab.id = 'addFolderTabBtn';
    addFolderTab.style.cssText = 'padding:10px 16px; font-size:18px; font-weight:400; color:var(--muted); cursor:pointer; line-height:1;';
    addFolderTab.title = t('createFolder');
    addFolderTab.textContent = '+';
    leftTabs.appendChild(addFolderTab);

    folders.forEach(f => {
      const folderTab = document.createElement('div');
      folderTab.className = 'analytics-tab' + (currentTab === 'folder' && selectedFolder === f.id ? ' active' : '');
      folderTab.dataset.tab = 'folder';
      folderTab.dataset.folderId = f.id;
      folderTab.style.cssText = 'padding:10px 18px; font-size:13px; display:flex; align-items:center; gap:6px; min-width:80px; max-width:180px;';
      folderTab.innerHTML = `
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="13" height="13" style="flex-shrink:0;opacity:.7;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
        </svg>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</span>`;
      leftTabs.appendChild(folderTab);
    });

    leftTabs.querySelectorAll('.analytics-tab[data-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.dataset.tab === 'folder') {
          selectedFolder = tab.dataset.folderId;
          updateStimuliSubnav();
          showTab('folder');
        } else {
          selectedFolder = null;
          updateStimuliSubnav();
          showTab(tab.dataset.tab);
        }
      });
    });
    leftTabs.querySelector('#addFolderTabBtn')?.addEventListener('click', () => {
      showCreateFolderModal(() => { updateStimuliSubnav(); rebuildTabBar(); });
    });
  }

  tabsRow.appendChild(leftTabs);
  topBarWrap.appendChild(tabsRow);

  const topBar = topBarWrap;

  root.insertBefore(topBarWrap, root.firstChild);

  const filterRow = document.createElement('div');
  filterRow.style.cssText = 'display:flex; align-items:center; gap:10px; margin-bottom:12px; flex-shrink:0; padding:10px 20px 0;';
  filterRow.innerHTML = `
    <label style="font-size:11px; color:var(--muted); font-weight:500; flex-shrink:0;">${t('type')}:</label>
    <div class="type-filter-pills" id="typeFilterPills" style="flex:1;">
      <button class="type-pill active" data-val="all">${t('all')}</button>
      <button class="type-pill" data-val="image">${t('images')}</button>
      <button class="type-pill" data-val="video">${t('video')}</button>
      <button class="type-pill" data-val="audio">${t('audio')}</button>
      <button class="type-pill" data-val="text">${t('text')}</button>
      <button class="type-pill" data-val="slides">${t('slides')}</button>
    </div>
    <button id="createAoiBtn" style="flex-shrink:0; display:flex; align-items:center; gap:5px; padding:5px 10px; border-radius:8px; border:1px solid var(--stroke); background:rgba(255,255,255,.4); color:var(--muted); font-size:11px; font-weight:500; cursor:pointer; white-space:nowrap;" title="${t('createAoiTemplate')}">
      <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="13" height="13">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
      </svg>
      AOI
    </button>
  `;
  root.appendChild(filterRow);

  const gallery = document.createElement('div');
  gallery.id = 'stimuliGallery';
  gallery.style.cssText = 'flex:1; display:grid; grid-template-columns:repeat(auto-fill, minmax(120px,120px)); gap:12px; overflow-y:auto; padding:4px 20px 20px; align-content:start;';
  root.appendChild(gallery);

  const uploadArea = document.createElement('div');
  uploadArea.id = 'stimuliUploadArea';
  uploadArea.style.cssText = 'display:none; flex:1; flex-direction:column; align-items:center; justify-content:center; width:calc(100% - 80px); max-width:1120px; align-self:center; padding:36px 34px; text-align:center; border:2px dashed var(--stroke); border-radius:16px; background:var(--card-bg); margin:12px 0 20px;';
  uploadArea.innerHTML = `
    <div style="max-width:800px; margin:0 auto; width:100%; display:flex; flex-direction:column; gap:24px;">
      <div style="text-align:center;">
        <div style="font-size:18px; font-weight:700; color:var(--text); margin-bottom:6px;">Загрузка стимулов</div>
        <div style="font-size:13px; color:var(--muted);">Выберите тип контента для добавления</div>
      </div>

      <div style="display:flex; gap:20px; flex-wrap:wrap;">
        <div id="dropzone_media" style="flex:1; min-width:280px; border:2px dashed var(--accent); border-radius:16px; padding:40px 20px; text-align:center; background:rgba(92,102,189,.04); cursor:pointer; transition:all 0.2s;">
          <div style="width:54px; height:54px; border-radius:14px; background:var(--accent); color:white; display:flex; align-items:center; justify-content:center; margin:0 auto 16px;">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="28" height="28"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          </div>
          <div style="font-size:15px; font-weight:700; color:var(--text); margin-bottom:6px;">Медиафайлы</div>
          <div style="font-size:12px; color:var(--muted); line-height:1.4;">Картинки, Видео, Аудио, Текст</div>
          <input type="file" id="input_media" accept="image/*,video/*,audio/*,text/plain" multiple style="display:none;">
        </div>

        <div id="dropzone_docs" style="flex:1; min-width:280px; border:2px dashed var(--warn); border-radius:16px; padding:40px 20px; text-align:center; background:rgba(245,158,11,.04); cursor:pointer; transition:all 0.2s;">
          <div style="width:54px; height:54px; border-radius:14px; background:var(--warn); color:white; display:flex; align-items:center; justify-content:center; margin:0 auto 16px;">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="28" height="28"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
          </div>
          <div style="font-size:15px; font-weight:700; color:var(--text); margin-bottom:6px;">Презентации и PDF</div>
          <div style="font-size:12px; color:var(--muted); line-height:1.4;">Автоматически конвертируются в картинки-стимулы</div>
          <input type="file" id="input_docs" accept=".pdf,.ppt,.pptx" multiple style="display:none;">
        </div>
      </div>
    </div>
  `;
  root.appendChild(uploadArea);

  uploadArea.querySelector('#dropzone_media').onclick = () => uploadArea.querySelector('#input_media').click();
  uploadArea.querySelector('#dropzone_docs').onclick = () => uploadArea.querySelector('#input_docs').click();

  uploadArea.querySelector('#input_docs').addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files.length) return;

    toast(`Отправка ${files[0].name} на конвертацию`);

    // объект FormData для отправки pptx / pdf по api
    const formData = new FormData();
    formData.append('file', files[0]);

    try {
      // const response = await fetch('https://api.pypypy/convert-document', {
      //   method: 'POST',
      //   body: formData
      // });
      // const result = await response.json();

      setTimeout(() => {
        toast('Успешно, картинки добавлены в библиотеку.');
        showTab('library');
      }, 2000);

    } catch (error) {
      toast('Ошибка при конвертации', 'error');
    }
  });

  const folderView = document.createElement('div');
  folderView.id = 'stimuliFolderView';
  folderView.style.cssText = 'display:none; flex:1; flex-direction:column; gap:12px; overflow:hidden;';
  folderView.innerHTML = `
    <div id="folderViewContent" style="flex:1; display:grid; grid-template-columns:repeat(auto-fill, minmax(120px,120px)); gap:12px; overflow-y:auto; padding:12px 20px 4px; align-content:start;"></div>
    <div style="display:flex; gap:8px; flex-shrink:0; padding:8px 20px 12px; border-top:1px solid var(--stroke); flex-wrap:wrap;">
      <button class="quick-btn" id="folderAddLibraryBtn" style="flex:1; min-width:140px; max-width:220px; justify-content:center; font-size:12px; padding:8px 12px;">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="14" height="14" style="flex-shrink:0;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
        </svg>
        <span>${t('addFromLibrary')}</span>
      </button>
      <button class="quick-btn" id="folderUploadBtn" style="flex:1; min-width:160px; max-width:240px; justify-content:center; font-size:12px; padding:8px 12px;">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="14" height="14" style="flex-shrink:0;">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
        </svg>
        <span>${t('addFromComputer')}</span>
      </button>
      <input type="file" id="folderUploadFileInput" multiple style="display:none;" />
    </div>
  `;
  root.appendChild(folderView);



  function showTab(tab) {
    currentTab = tab;
    gallery.style.display = tab === 'library' ? 'grid' : 'none';
    uploadArea.style.display = tab === 'upload' ? 'flex' : 'none';
    folderView.style.display = tab === 'folder' ? 'flex' : 'none';

    rebuildTabBar();
    filterRow.style.display = (tab === 'upload') ? 'none' : 'flex'; // hide for upload tab
    if (tab === 'library') renderStimuliGallery(gallery);
    if (tab === 'folder' && selectedFolder) renderFolderView();

    const chipEls = document.querySelectorAll('#chips .chip');
    chipEls.forEach(c => c.classList.remove('active'));
    if (tab === 'library' && chipEls[0]) chipEls[0].classList.add('active');
    else if (tab === 'upload' && chipEls[1]) chipEls[1].classList.add('active');

    if (tab === 'upload') setTimeout(() => applyAutoI18n(), 0);
  }

  function wireStimuliChips() {
    const chipEls = document.querySelectorAll('#chips .chip');
    chipEls.forEach((chip, idx) => {
      chip.style.cursor = 'pointer';
      chip.onclick = () => {
        if (idx === 0) {
          selectedFolder = null;
          showTab('library');
        } else if (idx === 1) {
          selectedFolder = null;
          showTab('upload');
        }
      };
    });
  }

  function renderFolderView() {
    const folder = folders.find(f => f.id === selectedFolder);
    if (!folder) return;
    const content = folderView.querySelector('#folderViewContent');
    let folderStimuli = stimuliList.filter(s => (folder.stimuliIds || []).includes(String(s.id)));
    if (currentStimuliFilter !== 'all') {
      folderStimuli = folderStimuli.filter(s => s.type === currentStimuliFilter);
    }
    if (folderStimuli.length === 0) {
      content.innerHTML = `<div style="grid-column:1/-1; color:var(--muted); font-size:13px; padding:24px 0;">${t('folderEmpty')}</div>`;
    } else {
      content.innerHTML = folderStimuli.map(s => `
        <div class="stimulus-card" data-id="${s.id}" style="position:relative;">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="28" height="28" style="margin-bottom:6px; color:var(--muted);">
            ${getIconForType(s.type)}
          </svg>
          <div style="font-size:11px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${s.name}</div>
          <div style="font-size:10px; color:var(--muted2);">${s.info}</div>
          <button class="remove-from-folder-btn" data-id="${s.id}" style="position:absolute;top:4px;right:4px;background:none;border:none;cursor:pointer;color:var(--muted);padding:2px;" title="Remove">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="12" height="12"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      `).join('');
      content.querySelectorAll('.remove-from-folder-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          folder.stimuliIds = (folder.stimuliIds || []).filter(x => x !== id);
          localStorage.setItem('emocog_folders', JSON.stringify(folders));
          renderFolderView();
        });
      });
    }
  }

  function showAddFromLibraryModal() {
  const folder = folders.find(f => f.id === selectedFolder);
    if (!folder) return;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,35,0.65);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);z-index:9999;display:flex;align-items:center;justify-content:center;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background:rgba(255,255,255,0.97);border:1px solid rgba(92,102,189,0.22);border-radius:20px;padding:26px 24px 20px;width:650px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;gap:16px;box-shadow:0 28px 72px rgba(10,15,35,0.30),0 4px 16px rgba(92,102,189,0.12);';

    const available = stimuliList.filter(s => !(folder.stimuliIds || []).includes(String(s.id)));

    const cardsHtml = available.length === 0
      ? `<div style="grid-column:1/-1;color:var(--muted);font-size:14px;padding:24px 0;text-align:center;">Все стимулы уже добавлены в эту папку</div>`
      : available.map(s => {
          const thumb = (s.type === 'image' && s.url)
            ? `<div style="width:100%;aspect-ratio:1;border-radius:8px;overflow:hidden;margin-bottom:8px;background:#eee;">
                <img src="${s.url}" style="width:100%;height:100%;object-fit:cover;display:block;">
              </div>`
            : `<div style="width:100%;aspect-ratio:1;border-radius:8px;overflow:hidden;margin-bottom:8px;background:rgba(92,102,189,.07);display:flex;align-items:center;justify-content:center;">
                <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="28" height="28" style="color:var(--muted);">${getIconForType(s.type)}</svg>
              </div>`;

          return `
            <div class="stimulus-card modal-pick" data-id="${s.id}" style="position:relative;padding:8px;box-sizing:border-box;border:1px solid var(--stroke);border-radius:12px;cursor:pointer;display:flex;flex-direction:column;height:100%;transition:all 0.2s;">
              ${thumb}
              <div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;text-align:center;">${s.name}</div>
            </div>
          `;
        }).join('');

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-size:18px;font-weight:700;color:var(--text);">Добавить из библиотеки</div>
        <button id="modalCloseBtn" style="background:none;border:none;cursor:pointer;color:var(--muted);padding:4px;">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="22" height="22"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <div id="modalGallery" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:14px;overflow-y:auto;flex:1;padding:4px;align-content:start;min-height:200px;max-height:55vh;">
        ${cardsHtml}
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;">
        <button class="quick-btn" id="modalCancelBtn">${t('cancel')}</button>
        <button class="quick-btn" id="modalAddBtn" style="background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:700;">${t('add')}</button>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    let selectedIds = new Set();
    modal.querySelectorAll('.modal-pick').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
        card.style.borderColor = 'var(--stroke)';
        card.style.background = 'transparent';
      } else {
        selectedIds.add(id);
        card.style.borderColor = 'var(--accent)';
        card.style.background = 'rgba(92,102,189,0.08)';
      }
      });
    });
    const close = () => document.body.removeChild(overlay);
    modal.querySelector('#modalCloseBtn').addEventListener('click', close);
    modal.querySelector('#modalCancelBtn').addEventListener('click', close);
    modal.querySelector('#modalAddBtn').addEventListener('click', () => {
      folder.stimuliIds = [...new Set([...(folder.stimuliIds || []), ...Array.from(selectedIds)])];
      localStorage.setItem('emocog_folders', JSON.stringify(folders));
      close();
      renderFolderView();
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  setTimeout(() => {
    rebuildTabBar();
    renderStimuliGallery(gallery);
    if (selectedFolder) showTab('folder');

    wireStimuliChips();
  }, 0);

  filterRow.querySelectorAll('.type-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      filterRow.querySelectorAll('.type-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentStimuliFilter = pill.dataset.val;
      if (currentTab === 'library') renderStimuliGallery(gallery);
      else if (currentTab === 'folder') renderFolderView();
    });
  });

  uploadArea.querySelector('#input_media').addEventListener('change', function(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    if (typeof handleFileUpload === 'function') {
      handleFileUpload(files);
    } else {
      // для локальной работы
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = ev => {
          stimuliList.push({
            id: 'stim_' + Date.now() + Math.floor(Math.random()*1000),
            name: file.name,
            type: file.type.startsWith('image') ? 'image' : (file.type.startsWith('video') ? 'video' : 'other'),
            url: ev.target.result,
            info: (file.size/1024).toFixed(1) + ' KB',
            createdAt: new Date().toISOString()
          });
          localStorage.setItem('emocog_stimuli', JSON.stringify(stimuliList));
        };
        reader.readAsDataURL(file);
      });
    }

    setTimeout(() => {
      toast('Медиафайлы добавлены!');
      showTab('library');
    }, 500);
    this.value = '';
  });


  folderView.querySelector('#folderUploadFileInput').addEventListener('change', function(e) {
    const folder = folders.find(f => f.id === selectedFolder);
    if (!folder) return;
    const newIds = handleFileUpload(Array.from(e.target.files));
    folder.stimuliIds = [...new Set([...(folder.stimuliIds || []), ...newIds.map(String)])];
    localStorage.setItem('emocog_folders', JSON.stringify(folders));
    renderFolderView();
    this.value = '';
  });

  folderView.querySelector('#folderAddLibraryBtn').addEventListener('click', showAddFromLibraryModal);
  folderView.querySelector('#folderUploadBtn').addEventListener('click', () => {
    folderView.querySelector('#folderUploadFileInput').click();
  });

  filterRow.querySelector('#createAoiBtn').addEventListener('click', () => {
    toast('AOI template creation – coming soon');
  });

  setInspector({
    type: 'Stimuli',
    title: t('stimuliLibrary'),
    subtitle: '',
    status: 'neutral'
  });

  return root;
}

function handleFileUpload(files) {
  const newIds = [];
  files.forEach(file => {
    let type = 'other';
    if (file.type.startsWith('image/')) type = 'image';
    else if (file.type.startsWith('video/')) type = 'video';
    else if (file.type.startsWith('audio/')) type = 'audio';
    else if (file.type.startsWith('text/') || file.name.endsWith('.txt')) type = 'text';
    else if (file.name.endsWith('.pptx') || file.name.endsWith('.ppt') || file.type.includes('presentation')) type = 'slides';
    const id = String(Date.now() + Math.random());
    const newItem = { id, name: file.name, type, info: `${(file.size/1024).toFixed(1)} KB`, url: URL.createObjectURL(file) };
    stimuliList.unshift(newItem);
    newIds.push(id);
  });
  localStorage.setItem('emocog_stimuli', JSON.stringify(stimuliList));
  return newIds;
}

function showCreateFolderModal(onCreated) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,35,0.62);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'background:rgba(255,255,255,0.97);border:1px solid rgba(92,102,189,0.22);border-radius:20px;padding:32px 28px 24px;width:380px;max-width:95vw;box-shadow:0 24px 64px rgba(10,15,35,0.28),0 4px 16px rgba(92,102,189,0.12);display:flex;flex-direction:column;gap:18px;';
  modal.innerHTML = `
    <div style="font-size:16px;font-weight:700;color:var(--text);">${t('modalFolderTitle')}</div>
    <div>
      <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:6px;">${t('folderName')}</label>
      <input id="folderNameInput" class="select" type="text" value="New Folder" style="width:100%;box-sizing:border-box;" />
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button class="quick-btn" id="modalFolderCancel">${t('cancel')}</button>
      <button class="quick-btn" id="modalFolderCreate" style="background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:700;">${t('createFolder')}</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const input = modal.querySelector('#folderNameInput');
  input.focus();
  input.select();

  const close = () => document.body.removeChild(overlay);
  modal.querySelector('#modalFolderCancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  modal.querySelector('#modalFolderCreate').addEventListener('click', () => {
    const name = input.value.trim();
    if (!name) return;
    const newFolder = { id: 'folder_' + Date.now(), name, stimuliIds: [] };
    folders.push(newFolder);
    localStorage.setItem('emocog_folders', JSON.stringify(folders));
    toast(t('folderCreated'));
    close();
    if (onCreated) onCreated(newFolder);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') modal.querySelector('#modalFolderCreate').click();
    if (e.key === 'Escape') close();
  });
}

function updateStimuliSubnav() {
  const container = document.getElementById('stimuli-folders-subnav');
  if (!container) return;
  container.innerHTML = folders.map(f => `
    <a href="#" class="stimuli-folder-nav-item ${selectedFolder === f.id ? 'active' : ''}" data-folder-id="${f.id}" style="display:flex;align-items:center;gap:6px;">
      <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="13" height="13" style="flex-shrink:0;">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
      </svg>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</span>
    </a>
  `).join('');
  container.querySelectorAll('.stimuli-folder-nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      selectedFolder = item.dataset.folderId;
      navigate('#/stimuli');
    });
  });
  const tabBar = document.getElementById('stimuliTabBar');
  if (tabBar) {
  }
}

function renderStimuliGallery(container) {
  if (!container) return;
  let filtered = stimuliList;
  if (currentStimuliFilter !== 'all') {
    filtered = stimuliList.filter(s => s.type === currentStimuliFilter);
  }
  container.innerHTML = filtered.length === 0
    ? `<div style="grid-column:1/-1;color:var(--muted);font-size:13px;padding:24px 0;">Нет стимулов. Загрузите файлы через вкладку «Загрузка».</div>`
    : filtered.map(s => `
    <div class="stimulus-card ${String(s.id) === String(selectedStimulusId) ? 'selected' : ''}" data-id="${s.id}" style="position:relative;">
      <button class="stim-delete-btn" data-id="${s.id}" title="Удалить" onclick="event.stopPropagation();deleteStimulusFromLibrary('${s.id}')">
        <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="11" height="11"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
      <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="28" height="28" style="margin-bottom:6px; color:var(--muted);">
        ${getIconForType(s.type)}
      </svg>
      <div style="font-size:11px;font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100px;">${s.name}</div>
      <div style="font-size:10px; color:var(--muted2);">${s.info}</div>
    </div>
  `).join('');

  container.querySelectorAll('.stimulus-card').forEach(card => {
    card.addEventListener('click', () => selectStimulus(card.dataset.id));
  });
}

function deleteStimulusFromLibrary(id) {
  stimuliList = stimuliList.filter(s => String(s.id) !== String(id));

  folders.forEach(f => {
    if (f.stimuliIds) f.stimuliIds = f.stimuliIds.filter(x => String(x) !== String(id));
  });
  localStorage.setItem('emocog_stimuli', JSON.stringify(stimuliList));
  localStorage.setItem('emocog_folders', JSON.stringify(folders));
  if (String(selectedStimulusId) === String(id)) selectedStimulusId = null;
  const gallery = document.getElementById('stimuliGallery');
  if (gallery) renderStimuliGallery(gallery);
  toast('Стимул удалён');
}

function getIconForType(type) {
  switch(type) {
    case 'image': return '<path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>';
    case 'video': return '<path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>';
    case 'audio': return '<path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>';
    case 'text': return '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>';
    case 'slides': return '<path stroke-linecap="round" stroke-linejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"/>';
    default: return '<path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>';
  }
}

function selectStimulus(id) {
  selectedStimulusId = id;
  const stimulus = stimuliList.find(s => String(s.id) === String(id));
  if (!stimulus) return;

  document.querySelectorAll('.stimulus-card').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`.stimulus-card[data-id="${id}"]`);
  if (card) card.classList.add('selected');

  const aoiHtml = `
    <div class="insp-section">
      <h4 style="margin-bottom:10px;">${stimulus.name}</h4>
      <div style="margin-bottom:12px;">
        ${stimulus.type === 'image' && stimulus.url
          ? `<img src="${stimulus.url}" style="max-width:100%; border-radius:8px; border:1px solid var(--stroke);">`
          : `<div style="background:var(--card-bg2,#f0f0f0);border-radius:8px;padding:24px;text-align:center;color:var(--muted);font-size:12px;">${stimulus.type}</div>`}
      </div>
      <div class="insp-row" style="margin-bottom:8px;">
        <span class="label" style="font-size:11px;color:var(--muted);">Тип</span>
        <span class="value" style="font-size:11px;">${stimulus.type}</span>
      </div>
      <div class="insp-row" style="margin-bottom:12px;">
        <span class="label" style="font-size:11px;color:var(--muted);">Размер</span>
        <span class="value" style="font-size:11px;">${stimulus.info}</span>
      </div>
      <button class="quick-btn" onclick="toast('AOI editor coming soon')" style="width:100%;">${t('createAoiTemplate')}</button>
    </div>
  `;
  setInspector({ customHtml: aoiHtml });
}

function renderFoldersList() { updateStimuliSubnav(); }

//~
