function absoluteStimulusApiUrl(pathValue) {
  const value = String(pathValue || '').trim();
  if (!value) return '';
  if (/^(https?:|blob:|data:)/i.test(value)) return value;
  const base = String(window.EmocogApiBase ? window.EmocogApiBase.resolve() : window.API_BASE || '').replace(/\/$/, '');
  return base + (value.startsWith('/') ? value : '/' + value);
}

function escapeStimulusHtml(value) {
  if (typeof window.escapeUiHtml === 'function') return window.escapeUiHtml(value);
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function hydrateApiStimulusPreview(stimulus) {
  if (!stimulus?.apiContentUrl || typeof fetch !== 'function') return stimulus;
  const url = absoluteStimulusApiUrl(stimulus.apiContentUrl);
  if (!url) return stimulus;
  const response = await fetch(url, { headers: typeof authHeaders === 'function' ? authHeaders() : {}, credentials: 'include' });
  if (!response.ok) throw typeof apiFailError === 'function' ? await apiFailError(response) : new Error(String(response.status));
  const blob = await response.blob();
  if (stimulus._previewObjectUrl) URL.revokeObjectURL(stimulus._previewObjectUrl);
  stimulus._previewObjectUrl = URL.createObjectURL(blob);
  return stimulus;
}

function persistStimuliList() {
  const serializable = stimuliList.map(stimulus => {
    const copy = { ...stimulus };
    delete copy._previewObjectUrl;
    delete copy._previewHydrating;
    if (copy.apiContentUrl && String(copy.url || '').startsWith('blob:')) {
      copy.url = absoluteStimulusApiUrl(copy.apiContentUrl);
    }
    return copy;
  });
  localStorage.setItem('emocog_stimuli', JSON.stringify(serializable));
}

function convertedStimulusFromApi(row, sourceFile, index, count) {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const id = String(row?.id || `converted_${Date.now()}_${index + 1}`);
  const apiContentUrl = row?.content_url || row?.preview_url || metadata.content_url || metadata.preview_url || `/stimuli/${encodeURIComponent(id)}/content`;
  return {
    id,
    name: row?.name || `${sourceFile.name.replace(/\.[^.]+$/, '')}_${index + 1}.jpg`,
    type: 'slides',
    info: `${CURRENT_LANG === 'en' ? 'Page' : 'Страница'} ${index + 1}/${count}`,
    url: absoluteStimulusApiUrl(apiContentUrl),
    apiContentUrl,
    apiStimulusId: row?.id || null,
    mimeType: row?.mime_type || 'image/jpeg',
    sourceDocumentName: sourceFile.name,
    sourcePage: metadata.source_page || index + 1,
    createdAt: row?.created_at || new Date().toISOString()
  };
}

function isConvertibleStimulusDocument(file) {
  return /\.(pdf|ppt|pptx)$/i.test(String(file?.name || ''));
}

function showStimulusImportProgress(fileName) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10020;background:rgba(10,15,35,.58);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `<div style="width:min(460px,94vw);padding:24px;border-radius:18px;background:var(--card-bg);border:1px solid var(--stroke);box-shadow:var(--shadow);color:var(--text);">
    <div style="font-size:16px;font-weight:800;">${CURRENT_LANG === 'en' ? 'Preparing stimuli' : 'Подготовка стимулов'}</div>
    <div style="font-size:12px;color:var(--muted);margin-top:6px;overflow-wrap:anywhere;">${escapeStimulusHtml(fileName)}</div>
    <div data-progress-label style="font-size:13px;font-weight:650;margin-top:18px;">${CURRENT_LANG === 'en' ? 'Uploading and converting the document…' : 'Загрузка и конвертация документа…'}</div>
    <div style="height:9px;border-radius:999px;background:var(--panel2);overflow:hidden;margin-top:10px;"><div data-progress-bar style="height:100%;width:12%;border-radius:inherit;background:linear-gradient(90deg,var(--accent),var(--good));transition:width .2s;"></div></div>
    <div style="font-size:11px;color:var(--muted);line-height:1.5;margin-top:12px;">${CURRENT_LANG === 'en' ? 'Do not refresh the page until processing is complete.' : 'Не обновляйте страницу до завершения обработки.'}</div>
  </div>`;
  document.body.appendChild(overlay);
  const label = overlay.querySelector('[data-progress-label]');
  const bar = overlay.querySelector('[data-progress-bar]');
  return {
    update(current, total, phase) {
      const safeTotal = Math.max(1, Number(total) || 1);
      const safeCurrent = Math.min(safeTotal, Math.max(0, Number(current) || 0));
      bar.style.width = `${Math.max(12, Math.round((safeCurrent / safeTotal) * 100))}%`;
      label.textContent = phase || (CURRENT_LANG === 'en'
        ? `Preparing page ${safeCurrent} of ${safeTotal}`
        : `Подготовка страницы ${safeCurrent} из ${safeTotal}`);
    },
    close() { overlay.remove(); }
  };
}

function wireStimulusDropzone(zone, acceptFile, onFiles) {
  if (!zone) return;
  const reset = () => {
    zone.style.transform = '';
    zone.style.filter = '';
  };
  zone.addEventListener('dragover', event => {
    event.preventDefault();
    zone.style.transform = 'translateY(-2px)';
    zone.style.filter = 'brightness(1.04)';
  });
  zone.addEventListener('dragleave', reset);
  zone.addEventListener('drop', event => {
    event.preventDefault();
    reset();
    const files = Array.from(event.dataTransfer?.files || []).filter(acceptFile);
    if (!files.length) {
      toast(CURRENT_LANG === 'en' ? 'These file types are not supported.' : 'Этот тип файлов не поддерживается.', 'error');
      return;
    }
    Promise.resolve(onFiles(files)).catch(error => {
      toast(`${CURRENT_LANG === 'en' ? 'Import failed.' : 'Ошибка импорта.'} ${error?.message || ''}`.trim(), 'error');
    });
  });
}

async function convertDocumentToStimuli(file, onProgress) {
  if (!isConvertibleStimulusDocument(file)) {
    throw new Error(CURRENT_LANG === 'en' ? 'Only PDF, PPT, and PPTX files are supported.' : 'Поддерживаются только файлы PDF, PPT и PPTX.');
  }
  if (Number(file?.size) > 50 * 1024 * 1024) {
    throw new Error(CURRENT_LANG === 'en' ? 'The document exceeds the 50 MB limit.' : 'Документ превышает ограничение 50 МБ.');
  }
  if (typeof apiPost !== 'function' || typeof resolveApiProjectId !== 'function' || typeof hasResearcherApiToken !== 'function' || !hasResearcherApiToken()) {
    throw new Error(CURRENT_LANG === 'en'
      ? 'Document conversion requires the backend API and researcher sign-in.'
      : 'Для конвертации документов нужен backend API и вход исследователя.');
  }
  const projectId = await resolveApiProjectId();
  const formData = new FormData();
  formData.append('file', file);
  formData.append('project_id', String(projectId));
  onProgress?.(0, 1, CURRENT_LANG === 'en' ? 'Uploading and converting the document…' : 'Загрузка и конвертация документа…');
  const result = await apiPost('/stimuli/convert', formData);
  const rows = Array.isArray(result?.stimuli)
    ? result.stimuli
    : Array.isArray(result?.images)
      ? result.images
      : Array.isArray(result?.slides)
        ? result.slides
        : [];
  if (!rows.length) {
    throw new Error(CURRENT_LANG === 'en'
      ? 'The conversion service returned no images.'
      : 'Сервис конвертации не вернул изображения.');
  }
  const converted = rows.map((row, index) => convertedStimulusFromApi(row, file, index, rows.length));
  for (let index = 0; index < converted.length; index += 1) {
    onProgress?.(index + 1, converted.length);
    try { await hydrateApiStimulusPreview(converted[index]); } catch (_) { /* API URL remains available for retry. */ }
  }
  return converted;
}

function stimulusTypeFromFile(file) {
  const mime = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/') || name.endsWith('.txt')) return 'text';
  return 'other';
}

function readStimulusDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

function stimulusPreviewHtml(stimulus) {
  const name = escapeStimulusHtml(typeof localizedStimulusName === 'function' ? localizedStimulusName(stimulus) : stimulus?.name || '');
  const url = escapeStimulusHtml(stimulus?._previewObjectUrl || stimulus?.url || '');
  if ((stimulus?.type === 'image' || stimulus?.type === 'slides') && url) return `<img src="${url}" alt="${name}" style="width:100%;height:100%;display:block;object-fit:contain;">`;
  if (stimulus?.type === 'video' && url) return `<video src="${url}" muted preload="metadata" style="width:100%;height:100%;display:block;object-fit:contain;"></video>`;
  if (stimulus?.type === 'audio' && url) return `<audio src="${url}" controls preload="metadata" style="width:92%;height:34px;"></audio>`;
  const standard = window.StandardStimuli?.resolveStandardStimulus?.(stimulus?.id, stimulus, { lang: CURRENT_LANG });
  if (standard?.type === 'image' && standard.src) return `<img src="${escapeStimulusHtml(standard.src)}" alt="${name}" style="width:100%;height:100%;display:block;object-fit:contain;">`;
  if (standard?.type === 'text') {
    return `<div style="font-size:clamp(18px,3vw,32px);font-weight:900;color:${escapeStimulusHtml(standard.style?.color || 'var(--text)')};white-space:nowrap;transform:scale(.78);">${escapeStimulusHtml(standard.text)}</div>`;
  }
  if (standard?.type === 'shape') {
    const style = standard.style || {};
    const shapeCss = Object.entries(style).map(([key, value]) => `${key.replace(/[A-Z]/g, char => '-' + char.toLowerCase())}:${value}`).join(';');
    return `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;"><div style="${escapeStimulusHtml(shapeCss)};transform:scale(.48);"></div></div>`;
  }
  return `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="34" height="34" style="color:var(--muted);"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`;
}

function StimuliAOIView() {
  // Standard stimuli are system-owned and must also exist when the library is
  // opened directly, not only after visiting the protocol builder.
  if (typeof ensureStandardStimuli === 'function') ensureStandardStimuli();
  document.getElementById('pageTitle').textContent = t('StimuliLibrary');
  setChips([t('Library'), t('Upload')]);

  updateStimuliSubnav();

  const root = document.createElement('div');
  root.style.cssText = 'display:flex; flex-direction:column; height:calc(100% + 40px); min-height:0; margin:-20px; padding:0;';

  const topBarWrap = document.createElement('div');
  topBarWrap.style.cssText = 'display:flex; flex-direction:column; border-bottom:1px solid var(--stroke); background:var(--card-bg); flex-shrink:0; width:100%;';

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
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeStimulusHtml(typeof localizedFolderName === 'function' ? localizedFolderName(f) : f.name)}</span>`;
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
  `;
  root.appendChild(filterRow);

  const gallery = document.createElement('div');
  gallery.id = 'stimuliGallery';
  gallery.style.cssText = 'flex:1; display:grid; grid-template-columns:repeat(auto-fill,minmax(170px,1fr)); gap:14px; overflow-y:auto; padding:4px 20px 20px; align-content:start;';
  root.appendChild(gallery);

  const uploadArea = document.createElement('div');
  uploadArea.id = 'stimuliUploadArea';
  uploadArea.style.cssText = 'display:none; flex:1; flex-direction:column; align-items:center; justify-content:center; width:calc(100% - 80px); max-width:1120px; align-self:center; padding:36px 34px; text-align:center; border:2px dashed var(--stroke); border-radius:16px; background:var(--card-bg); margin:12px 0 20px;';
  uploadArea.innerHTML = `
    <div style="max-width:800px; margin:0 auto; width:100%; display:flex; flex-direction:column; gap:24px;">
      <div style="text-align:center;">
        <div style="font-size:18px; font-weight:700; color:var(--text); margin-bottom:6px;">${CURRENT_LANG === 'en' ? 'Upload stimuli' : 'Загрузка стимулов'}</div>
        <div style="font-size:13px; color:var(--muted);">${CURRENT_LANG === 'en' ? 'Select the type of content to add' : 'Выберите тип контента для добавления'}</div>
      </div>

      <div style="display:flex; gap:20px; flex-wrap:wrap;">
        <div id="dropzone_media" style="flex:1; min-width:280px; border:2px dashed var(--accent); border-radius:16px; padding:40px 20px; text-align:center; background:rgba(92,102,189,.04); cursor:pointer; transition:all 0.2s;">
          <div style="width:54px; height:54px; border-radius:14px; background:var(--accent); color:white; display:flex; align-items:center; justify-content:center; margin:0 auto 16px;">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="28" height="28"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          </div>
          <div style="font-size:15px; font-weight:700; color:var(--text); margin-bottom:6px;">${CURRENT_LANG === 'en' ? 'Media files' : 'Медиафайлы'}</div>
          <div style="font-size:12px; color:var(--muted); line-height:1.4;">${CURRENT_LANG === 'en' ? 'Images, video, audio, text' : 'Картинки, Видео, Аудио, Текст'}</div>
          <input type="file" id="input_media" accept="image/*,video/*,audio/*,text/plain" multiple style="display:none;">
        </div>

        <div id="dropzone_docs" style="flex:1; min-width:280px; border:2px dashed var(--warn); border-radius:16px; padding:40px 20px; text-align:center; background:rgba(245,158,11,.04); cursor:pointer; transition:all 0.2s;">
          <div style="width:54px; height:54px; border-radius:14px; background:var(--warn); color:white; display:flex; align-items:center; justify-content:center; margin:0 auto 16px;">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="28" height="28"><path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
          </div>
          <div style="font-size:15px; font-weight:700; color:var(--text); margin-bottom:6px;">${CURRENT_LANG === 'en' ? 'Presentations and PDFs' : 'Презентации и PDF'}</div>
          <div style="font-size:12px; color:var(--muted); line-height:1.4;">${CURRENT_LANG === 'en' ? 'Automatically converted into separate slides' : 'Автоматически конвертируются в отдельные слайды'}</div>
          <div style="font-size:10px;color:var(--muted2);line-height:1.4;margin-top:7px;">${CURRENT_LANG === 'en' ? 'Requires a connection to the conversion API' : 'Требуется подключение к API конвертации'}</div>
          <input type="file" id="input_docs" accept=".pdf,.ppt,.pptx" multiple style="display:none;">
        </div>
      </div>
    </div>
  `;
  root.appendChild(uploadArea);

  uploadArea.querySelector('#dropzone_media').onclick = () => uploadArea.querySelector('#input_media').click();
  uploadArea.querySelector('#dropzone_docs').onclick = () => uploadArea.querySelector('#input_docs').click();

  async function importDocumentFiles(files, folder) {
    if (!files.length) return;
    const dropzone = uploadArea.querySelector('#dropzone_docs');
    dropzone.style.pointerEvents = 'none';
    dropzone.style.opacity = '.55';
    let convertedCount = 0;
    try {
      for (const file of files) {
        const progress = showStimulusImportProgress(file.name);
        let converted;
        try {
          converted = await convertDocumentToStimuli(file, (current, total, phase) => progress.update(current, total, phase));
        } finally {
          progress.close();
        }
        stimuliList.unshift(...converted);
        if (folder) {
          folder.stimuliIds = [...new Set([...(folder.stimuliIds || []), ...converted.map(stimulus => String(stimulus.id))])];
          localStorage.setItem('emocog_folders', JSON.stringify(folders));
        }
        convertedCount += converted.length;
        persistStimuliList();
      }
      if (folder) renderFolderView();
      else {
        renderStimuliGallery(gallery);
        showTab('library');
      }
      toast(CURRENT_LANG === 'en'
        ? `${convertedCount} slides added.`
        : `Добавлено слайдов: ${convertedCount}.`);
    } catch (error) {
      const unavailable = /\b404\b/.test(String(error?.message || ''));
      const prefix = unavailable
        ? (CURRENT_LANG === 'en' ? 'The server conversion endpoint is not implemented.' : 'Endpoint конвертации на сервере не реализован.')
        : (CURRENT_LANG === 'en' ? 'Conversion failed.' : 'Ошибка при конвертации.');
      toast(`${prefix} ${error?.message || ''}`.trim(), 'error');
    } finally {
      dropzone.style.pointerEvents = '';
      dropzone.style.opacity = '';
    }
  }

  async function importMediaFiles(files, folder) {
    if (!files.length) return;
    const dropzone = uploadArea.querySelector('#dropzone_media');
    const progress = showStimulusImportProgress(files.length === 1
      ? files[0].name
      : (CURRENT_LANG === 'en' ? `${files.length} media files` : `${files.length} медиафайлов`));
    dropzone.style.pointerEvents = 'none';
    dropzone.style.opacity = '.55';
    try {
      const newIds = (await handleFileUpload(files, (current, total) => {
        progress.update(current, total, CURRENT_LANG === 'en'
          ? `Uploading file ${current} of ${total}`
          : `Загрузка файла ${current} из ${total}`);
      })).map(String);
      if (folder) {
        folder.stimuliIds = [...new Set([...(folder.stimuliIds || []), ...newIds])];
        localStorage.setItem('emocog_folders', JSON.stringify(folders));
        renderFolderView();
      } else {
        renderStimuliGallery(gallery);
        showTab('library');
      }
      toast(CURRENT_LANG === 'en' ? 'Media files added.' : 'Медиафайлы добавлены.');
      return newIds;
    } catch (error) {
      toast(`${CURRENT_LANG === 'en' ? 'Media upload failed.' : 'Ошибка загрузки медиа.'} ${error?.message || ''}`.trim(), 'error');
      return [];
    } finally {
      progress.close();
      dropzone.style.pointerEvents = '';
      dropzone.style.opacity = '';
    }
  }

  uploadArea.querySelector('#input_docs').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    await importDocumentFiles(files);
    e.target.value = '';
  });
  wireStimulusDropzone(uploadArea.querySelector('#dropzone_docs'), isConvertibleStimulusDocument, importDocumentFiles);
  wireStimulusDropzone(uploadArea.querySelector('#dropzone_media'), file => !isConvertibleStimulusDocument(file), importMediaFiles);

  const folderView = document.createElement('div');
  folderView.id = 'stimuliFolderView';
  folderView.style.cssText = 'display:none; flex:1; flex-direction:column; gap:12px; overflow:hidden;';
  folderView.innerHTML = `
    <div id="folderViewContent" style="flex:1; display:grid; grid-template-columns:repeat(auto-fill,minmax(170px,1fr)); gap:14px; overflow-y:auto; padding:12px 20px 4px; align-content:start;"></div>
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
        <div class="stimulus-card" data-id="${escapeStimulusHtml(s.id)}" style="position:relative;width:auto;height:176px;justify-content:flex-start;padding:9px;">
          <div style="width:100%;height:118px;border-radius:9px;background:var(--panel2);display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:8px;">${stimulusPreviewHtml(s)}</div>
          <div style="font-size:11px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;max-width:100%;">${escapeStimulusHtml(typeof localizedStimulusName === 'function' ? localizedStimulusName(s) : s.name)}</div>
          <div style="font-size:10px; color:var(--muted2);">${escapeStimulusHtml(typeof localizedStimulusInfo === 'function' ? localizedStimulusInfo(s) : s.info)}</div>
          ${s.standard ? '' : `<button class="folder-stim-edit-btn" data-id="${escapeStimulusHtml(s.id)}" style="position:absolute;top:4px;right:26px;width:20px;height:20px;border:1px solid var(--stroke);border-radius:6px;background:var(--card-bg);cursor:pointer;color:var(--muted);padding:2px;display:flex;align-items:center;justify-content:center;" title="${CURRENT_LANG === 'en' ? 'Rename' : 'Изменить название'}">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="11" height="11"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536M9 17l-4 1 1-4L16.5 3.5a2.5 2.5 0 013.536 3.536L9 17z"/></svg>
          </button>`}
          <button class="remove-from-folder-btn" data-id="${escapeStimulusHtml(s.id)}" style="position:absolute;top:4px;right:4px;background:none;border:none;cursor:pointer;color:var(--muted);padding:2px;" title="${CURRENT_LANG === 'en' ? 'Remove' : 'Убрать'}">
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
      content.querySelectorAll('.folder-stim-edit-btn').forEach(button => {
        button.addEventListener('click', event => {
          event.stopPropagation();
          renameStimulusInLibrary(button.dataset.id, null, renderFolderView);
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
    modal.style.cssText = 'background:var(--card-bg);color:var(--text);border:1px solid var(--stroke);border-radius:20px;padding:26px 24px 20px;width:650px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;gap:16px;box-shadow:var(--shadow);';

    const available = stimuliList.filter(s => !(folder.stimuliIds || []).includes(String(s.id)));

    const cardsHtml = available.length === 0
      ? `<div style="grid-column:1/-1;color:var(--muted);font-size:14px;padding:24px 0;text-align:center;">${CURRENT_LANG === 'en' ? 'All stimuli have already been added to this folder' : 'Все стимулы уже добавлены в эту папку'}</div>`
      : available.map(s => {
          const previewUrl = s._previewObjectUrl || s.url;
          const thumb = ((s.type === 'image' || s.type === 'slides') && previewUrl)
            ? `<div style="width:100%;aspect-ratio:1;border-radius:8px;overflow:hidden;margin-bottom:8px;background:#eee;">
                <img src="${escapeStimulusHtml(previewUrl)}" style="width:100%;height:100%;object-fit:cover;display:block;">
              </div>`
            : `<div style="width:100%;aspect-ratio:1;border-radius:8px;overflow:hidden;margin-bottom:8px;background:rgba(92,102,189,.07);display:flex;align-items:center;justify-content:center;">
                <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="28" height="28" style="color:var(--muted);">${getIconForType(s.type)}</svg>
              </div>`;

          return `
            <div class="stimulus-card modal-pick" data-id="${escapeStimulusHtml(s.id)}" style="position:relative;padding:8px;box-sizing:border-box;border:1px solid var(--stroke);border-radius:12px;cursor:pointer;display:flex;flex-direction:column;height:100%;transition:all 0.2s;">
              ${thumb}
              <div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;text-align:center;">${escapeStimulusHtml(typeof localizedStimulusName === 'function' ? localizedStimulusName(s) : s.name)}</div>
            </div>
          `;
        }).join('');

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="font-size:18px;font-weight:700;color:var(--text);">${CURRENT_LANG === 'en' ? 'Add from library' : 'Добавить из библиотеки'}</div>
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
    const remoteStimuli = stimuliList.filter(stimulus => stimulus?.apiContentUrl);
    if (remoteStimuli.length) {
      Promise.allSettled(remoteStimuli.map(stimulus => hydrateApiStimulusPreview(stimulus)))
        .then(() => renderStimuliGallery(gallery));
    }
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

  uploadArea.querySelector('#input_media').addEventListener('change', async function(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    await importMediaFiles(files);
    this.value = '';
  });


  folderView.querySelector('#folderUploadFileInput').addEventListener('change', async function(e) {
    const folder = folders.find(f => f.id === selectedFolder);
    if (!folder) return;
    const files = Array.from(e.target.files || []);
    const documents = files.filter(isConvertibleStimulusDocument);
    const mediaFiles = files.filter(file => !isConvertibleStimulusDocument(file));
    try {
      if (mediaFiles.length) await importMediaFiles(mediaFiles, folder);
      if (documents.length) await importDocumentFiles(documents, folder);
    } catch (error) {
      renderFolderView();
      toast(`${CURRENT_LANG === 'en' ? 'Conversion failed.' : 'Ошибка при конвертации.'} ${error?.message || ''}`.trim(), 'error');
    } finally {
      this.value = '';
    }
  });

  folderView.querySelector('#folderAddLibraryBtn').addEventListener('click', showAddFromLibraryModal);
  folderView.querySelector('#folderUploadBtn').addEventListener('click', () => {
    folderView.querySelector('#folderUploadFileInput').click();
  });

  return root;
}

async function handleFileUpload(files, onProgress) {
  const newIds = [];
  const useApi = typeof apiPost === 'function' && typeof resolveApiProjectId === 'function'
    && typeof hasResearcherApiToken === 'function' && hasResearcherApiToken();
  const projectId = useApi ? await resolveApiProjectId() : null;
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    onProgress?.(fileIndex + 1, files.length);
    const type = stimulusTypeFromFile(file);
    let newItem;
    if (useApi) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('project_id', String(projectId));
      formData.append('name', file.name);
      const row = await apiPost('/stimuli/upload', formData);
      const apiContentUrl = row.content_url || `/stimuli/${encodeURIComponent(row.id)}/content`;
      newItem = {
        id: String(row.id),
        name: row.name || file.name,
        type,
        info: `${(Number(row.size_bytes || file.size) / 1024).toFixed(1)} KB`,
        url: absoluteStimulusApiUrl(apiContentUrl),
        apiContentUrl,
        apiStimulusId: row.id,
        mimeType: row.mime_type || file.type,
        createdAt: row.created_at || new Date().toISOString()
      };
      try { await hydrateApiStimulusPreview(newItem); } catch (_) { /* Retry on the next library render. */ }
    } else {
      const id = String(Date.now() + Math.random());
      newItem = {
        id,
        name: file.name,
        type,
        info: `${(file.size / 1024).toFixed(1)} KB`,
        url: await readStimulusDataUrl(file),
        createdAt: new Date().toISOString()
      };
    }
    stimuliList.unshift(newItem);
    newIds.push(String(newItem.id));
  }
  persistStimuliList();
  return newIds;
}

function showCreateFolderModal(onCreated) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,35,0.62);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'background:var(--card-bg);color:var(--text);border:1px solid var(--stroke);border-radius:20px;padding:32px 28px 24px;width:380px;max-width:95vw;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:18px;';
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
    <a href="#" class="stimuli-folder-nav-item ${selectedFolder === f.id ? 'active' : ''}" data-folder-id="${escapeStimulusHtml(f.id)}" style="display:flex;align-items:center;gap:6px;">
      <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="13" height="13" style="flex-shrink:0;">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
      </svg>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeStimulusHtml(typeof localizedFolderName === 'function' ? localizedFolderName(f) : f.name)}</span>
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
    ? `<div style="grid-column:1/-1;color:var(--muted);font-size:13px;padding:24px 0;">${CURRENT_LANG === 'en' ? 'No stimuli. Upload files using the Upload tab.' : 'Нет стимулов. Загрузите файлы через вкладку «Загрузка».'}</div>`
    : filtered.map(s => `
    <div class="stimulus-card ${String(s.id) === String(selectedStimulusId) ? 'selected' : ''}" data-id="${escapeStimulusHtml(s.id)}" style="position:relative;width:auto;height:176px;justify-content:flex-start;padding:9px;">
      ${s.standard ? '' : `<div style="position:absolute;top:5px;right:5px;z-index:3;display:flex;gap:4px;">
        <button class="stim-edit-btn" data-id="${escapeStimulusHtml(s.id)}" title="${CURRENT_LANG === 'en' ? 'Rename' : 'Изменить название'}" style="width:24px;height:24px;border:1px solid var(--stroke);border-radius:7px;background:var(--card-bg);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="12" height="12"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536M9 17l-4 1 1-4L16.5 3.5a2.5 2.5 0 013.536 3.536L9 17z"/></svg>
        </button>
        <button class="stim-delete-btn" data-id="${escapeStimulusHtml(s.id)}" title="${CURRENT_LANG === 'en' ? 'Delete' : 'Удалить'}" style="position:static;">
          <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="11" height="11"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>`}
      <div style="width:100%;height:118px;border-radius:9px;background:var(--panel2);display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:8px;">${stimulusPreviewHtml(s)}</div>
      <div style="font-size:11px;font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%;">${escapeStimulusHtml(typeof localizedStimulusName === 'function' ? localizedStimulusName(s) : s.name)}</div>
      <div style="font-size:10px; color:var(--muted2);">${escapeStimulusHtml(typeof localizedStimulusInfo === 'function' ? localizedStimulusInfo(s) : s.info)}</div>
    </div>
  `).join('');

  container.querySelectorAll('.stim-delete-btn').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      deleteStimulusFromLibrary(button.dataset.id);
    });
  });
  container.querySelectorAll('.stim-edit-btn').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      renameStimulusInLibrary(button.dataset.id, container);
    });
  });
  container.querySelectorAll('.stimulus-card').forEach(card => {
    card.addEventListener('click', () => selectStimulus(card.dataset.id));
  });
}

async function renameStimulusInLibrary(id, container, onRenamed) {
  const stimulus = stimuliList.find(item => String(item.id) === String(id));
  if (!stimulus || stimulus.standard) return;
  const proposed = window.prompt(
    CURRENT_LANG === 'en' ? 'Stimulus title' : 'Название стимула',
    stimulus.name || ''
  );
  if (proposed == null) return;
  const name = proposed.trim();
  if (!name || name === stimulus.name) return;
  try {
    if (stimulus.apiStimulusId && typeof apiPatch === 'function') {
      const updated = await apiPatch('/stimuli/' + encodeURIComponent(stimulus.apiStimulusId), { name });
      stimulus.name = updated?.name || name;
    } else {
      stimulus.name = name;
    }
    persistStimuliList();
    if (typeof onRenamed === 'function') onRenamed();
    else renderStimuliGallery(container || document.getElementById('stimuliGallery'));
    toast(CURRENT_LANG === 'en' ? 'Stimulus renamed' : 'Название стимула сохранено');
  } catch (error) {
    toast(`${CURRENT_LANG === 'en' ? 'Could not rename stimulus.' : 'Не удалось изменить название.'} ${error?.message || ''}`.trim(), 'error');
  }
}

function deleteStimulusFromLibrary(id) {
  stimuliList = stimuliList.filter(s => String(s.id) !== String(id));

  folders.forEach(f => {
    if (f.stimuliIds) f.stimuliIds = f.stimuliIds.filter(x => String(x) !== String(id));
  });
  persistStimuliList();
  localStorage.setItem('emocog_folders', JSON.stringify(folders));
  if (String(selectedStimulusId) === String(id)) selectedStimulusId = null;
  const gallery = document.getElementById('stimuliGallery');
  if (gallery) renderStimuliGallery(gallery);
  toast(CURRENT_LANG === 'en' ? 'Stimulus deleted' : 'Стимул удалён');
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

}

function renderFoldersList() { updateStimuliSubnav(); }

const AOI_SCHEMA_VERSION = '1.2';

function aoiEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function clampAoiCoordinate(value) {
  const number = Number(value);
  return Math.round(Math.min(1, Math.max(0, Number.isFinite(number) ? number : 0)) * 10000) / 10000;
}

function normalizeAoi(aoi, stimulusId, fallbackOrder = 1) {
  if (!aoi || (aoi.shape !== 'rectangle' && aoi.shape !== 'polygon')) return null;
  const geometry = globalThis.EmocogAoiGeometry?.normalizeGeometry(aoi.shape, aoi.points);
  if (!geometry?.ok) return null;
  const points = geometry.points;
  const startMs = Math.max(0, parseInt(aoi.validityInterval?.startMs, 10) || 0);
  const endRaw = parseInt(aoi.validityInterval?.endMs, 10);
  const endMs = Number.isFinite(endRaw) && endRaw > startMs ? endRaw : Math.max(startMs + 1, 1000);
  const orderRaw = parseInt(aoi.order, 10);
  return {
    id: String(aoi.id || `aoi-${Date.now()}`),
    name: String(aoi.name || (aoi.shape === 'rectangle'
      ? (CURRENT_LANG === 'en' ? 'Rectangle AOI' : 'Прямоугольник AOI')
      : (CURRENT_LANG === 'en' ? 'Polygon AOI' : 'Полигон AOI'))),
    shape: aoi.shape,
    points,
    order: Number.isFinite(orderRaw) && orderRaw > 0 ? orderRaw : fallbackOrder,
    isTarget: aoi.isTarget === true,
    validityInterval: { startMs, endMs }
  };
}

function persistStimulusAois(stimulus, aois) {
  stimulus.aois = (aois || []).map((aoi, index) => normalizeAoi(aoi, stimulus.id, index + 1)).filter(Boolean);
  stimulus.aoiSchemaVersion = AOI_SCHEMA_VERSION;
  persistStimuliList();
}

// Legacy import only: new protocols keep AOIs in each blockConfig.aoiDefinitions.
function applyStimuliDefinitionsToLibrary(definitions) {
  if (!definitions || typeof definitions !== 'object') return;
  let changed = false;
  Object.entries(definitions).forEach(([stimulusId, definition]) => {
    if (!definition || typeof definition !== 'object') return;
    let stimulus = stimuliList.find(item => String(item.id) === String(stimulusId));
    if (!stimulus) {
      stimulus = { id: stimulusId, name: stimulusId, type: definition.type || 'unknown', info: CURRENT_LANG === 'en' ? 'Protocol stimulus' : 'Стимул протокола' };
      stimuliList.push(stimulus);
    }
    stimulus.type = definition.type || stimulus.type;
    stimulus.aoiSchemaVersion = definition.schemaVersion || AOI_SCHEMA_VERSION;
    stimulus.aois = (definition.aois || []).map((aoi, index) => normalizeAoi(aoi, stimulusId, index + 1)).filter(Boolean);
    changed = true;
  });
  if (changed) persistStimuliList();
}

function openAoiEditor(stimulusId, options = {}) {
  const stimulus = stimuliList.find(item => String(item.id) === String(stimulusId));
  if (!stimulus) return;

  const hasScopedAois = Object.prototype.hasOwnProperty.call(options, 'initialAois');
  let aois = (hasScopedAois ? options.initialAois : stimulus.aois || [])
    .map((aoi, index) => normalizeAoi(aoi, stimulus.id, index + 1))
    .filter(Boolean)
    .sort((left, right) => left.order - right.order);
  aois.forEach((aoi, index) => { aoi.order = index + 1; });
  let selectedId = aois[0]?.id || null;
  let drawMode = null;
  let rectangleStart = null;
  let rectangleCurrent = null;
  let draftPoints = [];
  let polygonCursor = null;
  let dragging = null;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,35,.65);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';
  const modal = document.createElement('div');
  modal.style.cssText = 'width:min(1180px,98vw);height:min(760px,94vh);background:var(--card-bg);color:var(--text);border:1px solid var(--stroke);border-radius:20px;box-shadow:var(--shadow);display:flex;flex-direction:column;overflow:hidden;';
  const queueIndex = Number.isInteger(options.queueIndex) ? options.queueIndex : null;
  const queueTotal = Number.isInteger(options.queueTotal) ? options.queueTotal : null;
  const hasQueue = queueIndex !== null && queueTotal !== null && queueTotal > 0;
  const isQueueLast = hasQueue && queueIndex >= queueTotal - 1;
  modal.innerHTML = `
    <div style="padding:14px 18px;border-bottom:1px solid var(--stroke);display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div><div style="font-size:16px;font-weight:800;color:var(--text);">AOI · ${aoiEscape(typeof localizedStimulusName === 'function' ? localizedStimulusName(stimulus) : stimulus.name)}</div><div style="font-size:11px;color:var(--muted);margin-top:2px;">${aoiEscape(stimulus.id)} · ${CURRENT_LANG === 'en' ? 'schema' : 'схема'} ${AOI_SCHEMA_VERSION}${hasQueue ? ` · ${CURRENT_LANG === 'en' ? 'queue' : 'очередь'} ${queueIndex + 1}/${queueTotal}` : ''}</div></div>
      <button id="aoiClose" class="quick-btn" aria-label="${CURRENT_LANG === 'en' ? 'Close' : 'Закрыть'}">✕</button>
    </div>
    <div style="padding:10px 14px;border-bottom:1px solid var(--stroke);display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <button id="aoiRect" class="quick-btn">▭ ${CURRENT_LANG === 'en' ? 'Rectangle' : 'Прямоугольник'}</button>
      <button id="aoiPoly" class="quick-btn">⬠ ${CURRENT_LANG === 'en' ? 'Polygon' : 'Полигон'}</button>
      <button id="aoiFinishPoly" class="quick-btn" style="display:none;background:rgba(16,185,129,.12);color:var(--good);">✓ ${CURRENT_LANG === 'en' ? 'Finish' : 'Завершить'}</button>
      <button id="aoiCancelDraw" class="quick-btn" style="display:none;">${CURRENT_LANG === 'en' ? 'Cancel drawing' : 'Отменить рисование'}</button>
      <span id="aoiHint" style="font-size:11px;color:var(--muted);margin-left:auto;">${CURRENT_LANG === 'en' ? 'Drag an AOI to move; use corner handles to resize' : 'Тяните AOI для перемещения, угловые маркеры — для масштаба'}</span>
    </div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) 310px;flex:1;min-height:0;">
      <div id="aoiViewport" style="padding:18px;display:flex;align-items:center;justify-content:center;background:var(--panel2);min-width:0;min-height:0;overflow:hidden;">
        <div id="aoiStage" style="position:relative;width:100%;aspect-ratio:16/9;background:#fff;border:1px solid #d8deea;border-radius:12px;box-shadow:0 8px 24px rgba(30,41,59,.10);overflow:hidden;user-select:none;touch-action:none;flex:none;">
          ${(stimulus.type === 'image' || stimulus.type === 'slides') && stimulus.url
            ? `<img id="aoiMedia" src="${aoiEscape(stimulus.url)}" alt="" draggable="false" style="position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;">`
            : stimulus.type === 'video' && stimulus.url
              ? `<video id="aoiMedia" src="${aoiEscape(stimulus.url)}" muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;"></video>`
              : options.previewHtml
                ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:none;">${options.previewHtml}</div>`
                : `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#111827;font-size:42px;font-weight:800;">${aoiEscape(stimulus.text || stimulus.name)}</div>`}
          <svg id="aoiSvg" viewBox="0 0 1000 1000" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;"></svg>
        </div>
      </div>
      <aside style="border-left:1px solid var(--stroke);padding:14px;overflow-y:auto;display:flex;flex-direction:column;gap:12px;">
        <div><div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;margin-bottom:7px;">AOI</div><div id="aoiList" style="display:flex;flex-direction:column;gap:6px;"></div></div>
        <div id="aoiForm" style="display:none;border-top:1px solid var(--stroke);padding-top:12px;flex-direction:column;gap:9px;">
          <label style="font-size:11px;color:var(--muted);">${CURRENT_LANG === 'en' ? 'Name' : 'Название'}<input id="aoiName" type="text" style="width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:1px solid var(--stroke);border-radius:8px;"></label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text);"><input id="aoiTarget" type="checkbox"> ${CURRENT_LANG === 'en' ? 'Target area' : 'Целевая зона'}</label>
          <label style="font-size:11px;color:var(--muted);">${CURRENT_LANG === 'en' ? 'Gaze sequence number' : 'Номер в последовательности взгляда'}<select id="aoiOrder" style="width:100%;box-sizing:border-box;margin-top:4px;padding:7px;border:1px solid var(--stroke);border-radius:8px;background:var(--card-bg);color:var(--text);"></select></label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <label style="font-size:11px;color:var(--muted);">startMs<input id="aoiStart" type="number" min="0" style="width:100%;box-sizing:border-box;margin-top:4px;padding:7px;border:1px solid var(--stroke);border-radius:8px;"></label>
            <label style="font-size:11px;color:var(--muted);">endMs<input id="aoiEnd" type="number" min="1" style="width:100%;box-sizing:border-box;margin-top:4px;padding:7px;border:1px solid var(--stroke);border-radius:8px;"></label>
          </div>
          <div id="aoiCoordinates" style="font:10px/1.45 var(--mono,monospace);color:var(--muted);background:rgba(92,102,189,.06);padding:8px;border-radius:8px;word-break:break-all;"></div>
          <div style="display:flex;gap:7px;"><button id="aoiSave" class="quick-btn" style="flex:1;background:var(--accent);color:white;border-color:var(--accent);">${CURRENT_LANG === 'en' ? 'Save changes' : 'Сохранить изменения'}</button><button id="aoiDelete" class="quick-btn" style="color:var(--bad);">${CURRENT_LANG === 'en' ? 'Delete' : 'Удалить'}</button></div>
        </div>
      </aside>
    </div>
    ${hasQueue ? `<div style="padding:12px 14px;border-top:1px solid var(--stroke);display:flex;align-items:center;justify-content:flex-end;gap:10px;background:var(--card-bg);"><button id="aoiSaveNext" class="quick-btn" style="background:var(--accent);border-color:var(--accent);color:white;font-weight:800;">${isQueueLast ? (CURRENT_LANG === 'en' ? 'Save and finish queue' : 'Сохранить и завершить очередь') : (CURRENT_LANG === 'en' ? 'Save material and continue' : 'Сохранить материал и далее')} →</button></div>` : ''}`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const svg = modal.querySelector('#aoiSvg');
  const stage = modal.querySelector('#aoiStage');
  const viewport = modal.querySelector('#aoiViewport');
  const list = modal.querySelector('#aoiList');
  const form = modal.querySelector('#aoiForm');
  const finishButton = modal.querySelector('#aoiFinishPoly');
  const cancelButton = modal.querySelector('#aoiCancelDraw');
  const hint = modal.querySelector('#aoiHint');
  const pointFromEvent = event => {
    const rect = stage.getBoundingClientRect();
    return { x: clampAoiCoordinate((event.clientX - rect.left) / rect.width), y: clampAoiCoordinate((event.clientY - rect.top) / rect.height) };
  };
  const newId = shape => {
    const prefix = `aoi-${shape === 'rectangle' ? 'rect' : 'poly'}-`;
    let index = aois.length + 1;
    while (aois.some(aoi => aoi.id === prefix + index)) index += 1;
    return prefix + index;
  };
  const selectedAoi = () => aois.find(aoi => aoi.id === selectedId) || null;
  let stimulusAspectRatio = 16 / 9;
  function fitStage() {
    const bounds = viewport.getBoundingClientRect();
    const availableWidth = Math.max(1, bounds.width - 36);
    const availableHeight = Math.max(1, bounds.height - 36);
    let width = availableWidth;
    let height = width / stimulusAspectRatio;
    if (height > availableHeight) {
      height = availableHeight;
      width = height * stimulusAspectRatio;
    }
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    stage.style.aspectRatio = 'auto';
  }
  const media = modal.querySelector('#aoiMedia');
  const useMediaRatio = () => {
    const width = media?.naturalWidth || media?.videoWidth;
    const height = media?.naturalHeight || media?.videoHeight;
    if (width > 0 && height > 0) stimulusAspectRatio = width / height;
    fitStage();
  };
  if (media) {
    media.addEventListener(stimulus.type === 'video' ? 'loadedmetadata' : 'load', useMediaRatio, { once: true });
    if (media.complete || media.readyState >= 1) useMediaRatio();
  }
  window.addEventListener('resize', fitStage);
  requestAnimationFrame(fitStage);

  function saveAll() {
    const normalized = aois.map((aoi, index) => normalizeAoi(aoi, stimulus.id, index + 1));
    if (normalized.some(aoi => !aoi)) {
      toast(CURRENT_LANG === 'en'
        ? 'AOI was not saved: check its size and polygon intersections'
        : 'AOI не сохранена: проверьте размер и пересечения полигона');
      return false;
    }
    aois = normalized.sort((left, right) => left.order - right.order);
    aois.forEach((aoi, index) => { aoi.order = index + 1; });
    if (hasScopedAois && typeof options.onPersist === 'function') {
      options.onPersist(aois);
    } else {
      persistStimulusAois(stimulus, aois);
    }
    const gallery = document.getElementById('stimuliGallery');
    if (gallery) renderStimuliGallery(gallery);
    if (typeof options.onChange === 'function') options.onChange(stimulus, aois);
    return true;
  }
  function captureSelectedFormDraft() {
    const aoi = selectedAoi();
    if (!aoi || form.style.display === 'none') return;
    const name = modal.querySelector('#aoiName').value.trim();
    const startMs = parseInt(modal.querySelector('#aoiStart').value, 10);
    const endMs = parseInt(modal.querySelector('#aoiEnd').value, 10);
    if (name) aoi.name = name;
    aoi.isTarget = modal.querySelector('#aoiTarget').checked;
    if (Number.isFinite(startMs) && startMs >= 0 && Number.isFinite(endMs) && endMs > startMs) {
      aoi.validityInterval = { startMs, endMs };
    }
  }
  function moveAoiToOrder(aoiId, requestedOrder) {
    captureSelectedFormDraft();
    const fromIndex = aois.findIndex(aoi => aoi.id === aoiId);
    const toIndex = Math.max(0, Math.min(aois.length - 1, requestedOrder - 1));
    if (fromIndex < 0 || fromIndex === toIndex) return false;
    const [moved] = aois.splice(fromIndex, 1);
    aois.splice(toIndex, 0, moved);
    aois.forEach((aoi, index) => { aoi.order = index + 1; });
    saveAll();
    renderAll();
    return true;
  }
  function moveAoiRelative(aoiId, targetId, placeAfter) {
    captureSelectedFormDraft();
    const fromIndex = aois.findIndex(aoi => aoi.id === aoiId);
    if (fromIndex < 0 || aoiId === targetId) return false;
    const [moved] = aois.splice(fromIndex, 1);
    const targetIndex = aois.findIndex(aoi => aoi.id === targetId);
    if (targetIndex < 0) {
      aois.splice(fromIndex, 0, moved);
      return false;
    }
    aois.splice(targetIndex + (placeAfter ? 1 : 0), 0, moved);
    aois.forEach((aoi, index) => { aoi.order = index + 1; });
    saveAll();
    renderAll();
    return true;
  }
  function clearDropIndicators() {
    list.querySelectorAll('.aoi-list-row').forEach(row => {
      row.style.borderTopColor = 'transparent';
      row.style.borderBottomColor = 'transparent';
      row.style.opacity = '1';
    });
  }
  function renderList() {
    list.innerHTML = aois.length ? aois.map(aoi => `<div class="aoi-list-row" data-id="${aoiEscape(aoi.id)}" style="display:flex;align-items:stretch;gap:4px;border-top:2px solid transparent;border-bottom:2px solid transparent;transition:border-color .12s ease,opacity .12s ease;">
      <span class="aoi-drag-handle" draggable="true" data-id="${aoiEscape(aoi.id)}" title="${CURRENT_LANG === 'en' ? 'Drag to change order' : 'Перетащите, чтобы изменить порядок'}" aria-label="${CURRENT_LANG === 'en' ? 'Drag to change order' : 'Перетащите, чтобы изменить порядок'}" style="width:20px;display:inline-flex;align-items:center;justify-content:center;color:var(--muted);font-size:14px;letter-spacing:-4px;cursor:grab;user-select:none;flex-shrink:0;">⋮⋮</span>
      <button class="aoi-list-item quick-btn" data-id="${aoiEscape(aoi.id)}" style="min-width:0;flex:1;justify-content:flex-start;text-align:left;${aoi.id === selectedId ? 'border-color:rgba(92,102,189,.45);background:rgba(92,102,189,.07);box-shadow:0 2px 8px rgba(92,102,189,.08);' : ''}"><span style="width:18px;height:18px;border-radius:6px;background:${aoi.isTarget ? 'rgba(16,185,129,.12)' : 'rgba(92,102,189,.10)'};color:${aoi.isTarget ? 'var(--good)' : 'var(--accent)'};border:1px solid ${aoi.isTarget ? 'rgba(16,185,129,.24)' : 'rgba(92,102,189,.20)'};display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;flex-shrink:0;">${aoi.order}</span><span style="color:${aoi.isTarget ? 'var(--good)' : 'var(--muted)'};font-size:11px;">${aoi.shape === 'rectangle' ? '▭' : '⬠'}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${aoiEscape(aoi.name)}</span></button>
    </div>`).join('') : `<div style="font-size:11px;color:var(--muted);padding:8px 0;">${CURRENT_LANG === 'en' ? 'No AOIs yet' : 'AOI пока нет'}</div>`;
    list.querySelectorAll('.aoi-list-item').forEach(button => button.addEventListener('click', () => { selectedId = button.dataset.id; renderAll(); }));
    list.querySelectorAll('.aoi-drag-handle').forEach(handle => {
      handle.addEventListener('dragstart', event => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', handle.dataset.id);
        requestAnimationFrame(() => { handle.closest('.aoi-list-row').style.opacity = '.45'; });
      });
      handle.addEventListener('dragend', clearDropIndicators);
    });
    list.querySelectorAll('.aoi-list-row').forEach(row => {
      row.addEventListener('dragover', event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        clearDropIndicators();
        const placeAfter = event.clientY >= row.getBoundingClientRect().top + row.offsetHeight / 2;
        row.dataset.dropPosition = placeAfter ? 'after' : 'before';
        row.style[placeAfter ? 'borderBottomColor' : 'borderTopColor'] = 'var(--accent)';
      });
      row.addEventListener('drop', event => {
        event.preventDefault();
        const aoiId = event.dataTransfer.getData('text/plain');
        const placeAfter = row.dataset.dropPosition === 'after';
        clearDropIndicators();
        if (moveAoiRelative(aoiId, row.dataset.id, placeAfter)) {
          toast(CURRENT_LANG === 'en' ? 'AOI order updated' : 'Порядок AOI обновлён');
        }
      });
    });
  }
  function renderForm() {
    const aoi = selectedAoi();
    form.style.display = aoi ? 'flex' : 'none';
    if (!aoi) return;
    modal.querySelector('#aoiName').value = aoi.name;
    modal.querySelector('#aoiTarget').checked = aoi.isTarget;
    modal.querySelector('#aoiOrder').innerHTML = aois.map((item, index) => `<option value="${index + 1}" ${aoi.order === index + 1 ? 'selected' : ''}>${index + 1}</option>`).join('');
    modal.querySelector('#aoiStart').value = aoi.validityInterval.startMs;
    modal.querySelector('#aoiEnd').value = aoi.validityInterval.endMs;
    modal.querySelector('#aoiCoordinates').textContent = aoi.points.map(point => `(${point.x.toFixed(4)}, ${point.y.toFixed(4)})`).join(' · ');
  }
  function shapeMarkup(aoi) {
    const selected = aoi.id === selectedId;
    const color = aoi.isTarget ? '#10b981' : '#5c66bd';
    const points = aoi.points.map(point => `${point.x * 1000},${point.y * 1000}`).join(' ');
    const minX = Math.min(...aoi.points.map(point => point.x)) * 1000;
    const minY = Math.min(...aoi.points.map(point => point.y)) * 1000;
    const maxX = Math.max(...aoi.points.map(point => point.x)) * 1000;
    const maxY = Math.max(...aoi.points.map(point => point.y)) * 1000;
    let markup = aoi.shape === 'rectangle'
      ? `<rect data-select="${aoiEscape(aoi.id)}" x="${aoi.points[0].x * 1000}" y="${aoi.points[0].y * 1000}" width="${(aoi.points[1].x - aoi.points[0].x) * 1000}" height="${(aoi.points[1].y - aoi.points[0].y) * 1000}" fill="${color}" fill-opacity="${selected ? '.12' : '.075'}" stroke="${color}" stroke-width="${selected ? 4 : 2.5}" style="cursor:move;"/>`
      : `<polygon data-select="${aoiEscape(aoi.id)}" points="${points}" fill="${color}" fill-opacity="${selected ? '.12' : '.075'}" stroke="${color}" stroke-width="${selected ? 4 : 2.5}" style="cursor:move;"/>`;
    const labelX = aoi.points.reduce((sum, point) => sum + point.x, 0) / aoi.points.length * 1000;
    const labelY = aoi.points.reduce((sum, point) => sum + point.y, 0) / aoi.points.length * 1000;
    markup += `<text x="${labelX}" y="${labelY + 7}" text-anchor="middle" font-size="22" font-weight="500" fill="${color}" stroke="#ffffff" stroke-width="4" paint-order="stroke" pointer-events="none">${aoi.order}</text>`;
    if (selected && !drawMode) {
      markup += `<rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" fill="none" stroke="${color}" stroke-opacity=".55" stroke-width="2" stroke-dasharray="8 7" pointer-events="none"/>`;
      const scaleHandles = [
        ['nw', minX, minY, 'nwse-resize'], ['ne', maxX, minY, 'nesw-resize'],
        ['se', maxX, maxY, 'nwse-resize'], ['sw', minX, maxY, 'nesw-resize']
      ];
      if (aoi.shape === 'polygon') markup += aoi.points.map((point, index) => `<circle data-handle="${index}" cx="${point.x * 1000}" cy="${point.y * 1000}" r="6" fill="#fff" stroke="${color}" stroke-width="3" style="cursor:grab;"><title>${CURRENT_LANG === 'en' ? 'Move vertex' : 'Переместить вершину'}</title></circle>`).join('');
      markup += scaleHandles.map(([corner, x, y, cursor]) => `<rect data-scale-handle="${corner}" x="${x - 8}" y="${y - 8}" width="16" height="16" rx="3" fill="#fff" stroke="${color}" stroke-width="3" style="cursor:${cursor};"><title>${CURRENT_LANG === 'en' ? 'Resize AOI' : 'Изменить размер AOI'}</title></rect>`).join('');
    }
    return markup;
  }
  function renderSvg() {
    let markup = aois.map(shapeMarkup).join('');
    if (drawMode === 'rectangle' && rectangleStart && rectangleCurrent) {
      const x = Math.min(rectangleStart.x, rectangleCurrent.x) * 1000;
      const y = Math.min(rectangleStart.y, rectangleCurrent.y) * 1000;
      const width = Math.abs(rectangleCurrent.x - rectangleStart.x) * 1000;
      const height = Math.abs(rectangleCurrent.y - rectangleStart.y) * 1000;
      markup += `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#f97316" fill-opacity=".10" stroke="#ffffff" stroke-opacity=".9" stroke-width="8" stroke-dasharray="15 10" pointer-events="none"/>`;
      markup += `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="#f97316" stroke-width="4" stroke-dasharray="15 10" pointer-events="none"/>`;
    }
    if (drawMode === 'polygon' && draftPoints.length) {
      const previewPoints = polygonCursor ? [...draftPoints, polygonCursor] : draftPoints;
      const points = previewPoints.map(point => `${point.x * 1000},${point.y * 1000}`).join(' ');
      markup += `<polyline points="${points}" fill="none" stroke="#ffffff" stroke-opacity=".9" stroke-width="8" stroke-dasharray="15 10" pointer-events="none"/>`;
      markup += `<polyline points="${points}" fill="none" stroke="#f97316" stroke-width="4" stroke-dasharray="15 10" pointer-events="none"/>`;
      markup += draftPoints.map(point => `<circle cx="${point.x * 1000}" cy="${point.y * 1000}" r="7" fill="#ffffff" stroke="#f97316" stroke-width="3.5" pointer-events="none"/>`).join('');
    }
    svg.innerHTML = markup;
  }
  function renderAll() { renderList(); renderForm(); renderSvg(); }
  function setDrawMode(mode) {
    drawMode = mode;
    rectangleStart = null;
    rectangleCurrent = null;
    draftPoints = [];
    polygonCursor = null;
    finishButton.style.display = mode === 'polygon' ? '' : 'none';
    cancelButton.style.display = mode ? '' : 'none';
    hint.textContent = mode === 'rectangle'
      ? (CURRENT_LANG === 'en' ? 'Drag across the preview' : 'Протяните мышью по preview')
      : mode === 'polygon'
        ? (CURRENT_LANG === 'en' ? 'Click at least 3 vertices' : 'Поставьте минимум 3 вершины')
        : (CURRENT_LANG === 'en' ? 'Drag the AOI to move it; use corner handles to resize' : 'Перетаскивайте AOI для перемещения, угловые маркеры — для масштаба');
    renderSvg();
  }
  function finishPolygon() {
    if (draftPoints.length < 3) return toast(CURRENT_LANG === 'en' ? 'Polygon needs at least 3 points' : 'Полигону нужно минимум 3 точки');
    const aoi = normalizeAoi({ id: newId('polygon'), name: CURRENT_LANG === 'en' ? 'Polygon AOI' : 'Полигон AOI', shape: 'polygon', points: draftPoints, order: Math.max(0, ...aois.map(item => item.order)) + 1, isTarget: false, validityInterval: { startMs: 0, endMs: 1000 } }, stimulus.id, aois.length + 1);
    if (!aoi) return toast(CURRENT_LANG === 'en' ? 'Polygon must not intersect itself' : 'Полигон не должен пересекать сам себя');
    aois.push(aoi); selectedId = aoi.id; setDrawMode(null); saveAll(); renderAll();
  }

  modal.querySelector('#aoiRect').addEventListener('click', () => setDrawMode('rectangle'));
  modal.querySelector('#aoiPoly').addEventListener('click', () => setDrawMode('polygon'));
  finishButton.addEventListener('click', finishPolygon);
  cancelButton.addEventListener('click', () => setDrawMode(null));
  svg.addEventListener('pointerdown', event => {
    const scaleHandle = event.target.closest('[data-scale-handle]');
    const handle = event.target.closest('[data-handle]');
    const select = event.target.closest('[data-select]');
    if (!drawMode && scaleHandle && selectedAoi()) {
      const originalPoints = selectedAoi().points.map(point => ({ ...point }));
      dragging = {
        type: 'scale',
        corner: scaleHandle.dataset.scaleHandle,
        originalPoints,
        bounds: {
          minX: Math.min(...originalPoints.map(point => point.x)),
          minY: Math.min(...originalPoints.map(point => point.y)),
          maxX: Math.max(...originalPoints.map(point => point.x)),
          maxY: Math.max(...originalPoints.map(point => point.y))
        },
        pointerId: event.pointerId
      };
      svg.setPointerCapture(event.pointerId);
      return;
    }
    if (!drawMode && handle && selectedAoi()) {
      dragging = { type: 'vertex', index: parseInt(handle.dataset.handle, 10), pointerId: event.pointerId };
      svg.setPointerCapture(event.pointerId);
      return;
    }
    if (!drawMode && select) {
      selectedId = select.dataset.select;
      const aoi = selectedAoi();
      dragging = {
        type: 'move',
        start: pointFromEvent(event),
        originalPoints: aoi.points.map(point => ({ ...point })),
        pointerId: event.pointerId
      };
      svg.setPointerCapture(event.pointerId);
      renderAll();
      return;
    }
    if (drawMode === 'rectangle') {
      rectangleStart = pointFromEvent(event);
      rectangleCurrent = rectangleStart;
      svg.setPointerCapture(event.pointerId);
      renderSvg();
    } else if (drawMode === 'polygon') {
      draftPoints.push(pointFromEvent(event));
      polygonCursor = pointFromEvent(event);
      renderSvg();
    }
  });
  svg.addEventListener('pointermove', event => {
    if (dragging && selectedAoi()) {
      const aoi = selectedAoi();
      const current = pointFromEvent(event);
      if (dragging.type === 'vertex') {
        aoi.points[dragging.index] = current;
      } else if (dragging.type === 'move') {
        const minX = Math.min(...dragging.originalPoints.map(point => point.x));
        const minY = Math.min(...dragging.originalPoints.map(point => point.y));
        const maxX = Math.max(...dragging.originalPoints.map(point => point.x));
        const maxY = Math.max(...dragging.originalPoints.map(point => point.y));
        const dx = Math.max(-minX, Math.min(1 - maxX, current.x - dragging.start.x));
        const dy = Math.max(-minY, Math.min(1 - maxY, current.y - dragging.start.y));
        aoi.points = dragging.originalPoints.map(point => ({
          x: clampAoiCoordinate(point.x + dx),
          y: clampAoiCoordinate(point.y + dy)
        }));
      } else if (dragging.type === 'scale') {
        const bounds = dragging.bounds;
        const west = dragging.corner.includes('w');
        const north = dragging.corner.includes('n');
        const newMinX = west ? Math.min(current.x, bounds.maxX - 0.005) : bounds.minX;
        const newMaxX = west ? bounds.maxX : Math.max(current.x, bounds.minX + 0.005);
        const newMinY = north ? Math.min(current.y, bounds.maxY - 0.005) : bounds.minY;
        const newMaxY = north ? bounds.maxY : Math.max(current.y, bounds.minY + 0.005);
        const sourceWidth = Math.max(0.0001, bounds.maxX - bounds.minX);
        const sourceHeight = Math.max(0.0001, bounds.maxY - bounds.minY);
        aoi.points = dragging.originalPoints.map(point => ({
          x: clampAoiCoordinate(newMinX + ((point.x - bounds.minX) / sourceWidth) * (newMaxX - newMinX)),
          y: clampAoiCoordinate(newMinY + ((point.y - bounds.minY) / sourceHeight) * (newMaxY - newMinY))
        }));
      }
      if (selectedAoi().shape === 'rectangle') {
        const normalized = normalizeAoi(selectedAoi(), stimulus.id);
        if (normalized) selectedAoi().points = normalized.points;
      }
      renderForm(); renderSvg();
      return;
    }
    if (drawMode === 'rectangle' && rectangleStart) {
      rectangleCurrent = pointFromEvent(event);
      renderSvg();
      return;
    }
    if (drawMode === 'polygon') {
      polygonCursor = pointFromEvent(event);
      renderSvg();
    }
  });
  svg.addEventListener('pointerup', event => {
    if (dragging) { dragging = null; saveAll(); renderAll(); return; }
    if (drawMode !== 'rectangle' || !rectangleStart) return;
    const end = rectangleCurrent || pointFromEvent(event);
    if (Math.abs(end.x - rectangleStart.x) < 0.005 || Math.abs(end.y - rectangleStart.y) < 0.005) {
      rectangleStart = null;
      rectangleCurrent = null;
      renderSvg();
      return toast(CURRENT_LANG === 'en' ? 'Draw a larger rectangle' : 'Нарисуйте прямоугольник большего размера');
    }
    const aoi = normalizeAoi({ id: newId('rectangle'), name: CURRENT_LANG === 'en' ? 'Rectangle AOI' : 'Прямоугольник AOI', shape: 'rectangle', points: [rectangleStart, end], order: Math.max(0, ...aois.map(item => item.order)) + 1, isTarget: false, validityInterval: { startMs: 0, endMs: 1000 } }, stimulus.id, aois.length + 1);
    if (!aoi) return toast(CURRENT_LANG === 'en' ? 'Draw a larger rectangle' : 'Нарисуйте прямоугольник большего размера');
    aois.push(aoi); selectedId = aoi.id; setDrawMode(null); saveAll(); renderAll();
  });
  svg.addEventListener('pointercancel', () => {
    if (dragging) {
      dragging = null;
      saveAll();
      renderAll();
      return;
    }
    rectangleStart = null;
    rectangleCurrent = null;
    renderSvg();
  });
  modal.querySelector('#aoiName').addEventListener('input', event => {
    const aoi = selectedAoi();
    if (!aoi) return;
    aoi.name = event.target.value;
    renderList();
    if (event.target.value.trim()) saveAll();
  });
  modal.querySelector('#aoiOrder').addEventListener('change', event => {
    const aoi = selectedAoi();
    const order = parseInt(event.target.value, 10);
    if (!aoi || !Number.isFinite(order)) return;
    if (moveAoiToOrder(aoi.id, order)) {
      toast(CURRENT_LANG === 'en' ? 'AOI order updated' : 'Порядок AOI обновлён');
    }
  });
  modal.querySelector('#aoiSave').addEventListener('click', () => {
    const aoi = selectedAoi();
    if (!aoi) return;
    const name = modal.querySelector('#aoiName').value.trim();
    const order = parseInt(modal.querySelector('#aoiOrder').value, 10);
    const startMs = Math.max(0, parseInt(modal.querySelector('#aoiStart').value, 10) || 0);
    const endMs = parseInt(modal.querySelector('#aoiEnd').value, 10);
    if (!name) return toast(CURRENT_LANG === 'en' ? 'Enter an AOI name' : 'Введите название AOI');
    if (!Number.isFinite(order) || order < 1 || order > aois.length) return toast(CURRENT_LANG === 'en' ? `Order must be from 1 to ${aois.length}` : `Номер должен быть от 1 до ${aois.length}`);
    if (!Number.isFinite(endMs) || endMs <= startMs) return toast(CURRENT_LANG === 'en' ? 'endMs must be greater than startMs' : 'endMs должен быть больше startMs');
    const previousOrder = aoi.order;
    const occupied = aois.find(item => item.id !== aoi.id && item.order === order);
    if (occupied) occupied.order = previousOrder;
    aoi.name = name; aoi.order = order; aoi.isTarget = modal.querySelector('#aoiTarget').checked; aoi.validityInterval = { startMs, endMs };
    if (saveAll()) {
      renderAll();
      toast(CURRENT_LANG === 'en' ? 'AOI saved' : 'AOI сохранена');
    }
  });
  modal.querySelector('#aoiDelete').addEventListener('click', () => {
    if (!selectedId) return;
    aois = aois.filter(aoi => aoi.id !== selectedId);
    selectedId = aois[0]?.id || null;
    saveAll(); renderAll();
  });
  const close = (notify = true) => {
    window.removeEventListener('resize', fitStage);
    if (document.body.contains(overlay)) document.body.removeChild(overlay);
    if (notify && typeof options.onClose === 'function') options.onClose(stimulus, aois);
  };
  modal.querySelector('#aoiSaveNext')?.addEventListener('click', () => {
    captureSelectedFormDraft();
    if (!aois.length) {
      toast(CURRENT_LANG === 'en' ? 'Create at least one AOI' : 'Создайте хотя бы одну AOI');
      return;
    }
    if (!saveAll()) return;
    close(false);
    if (typeof options.onSaveAndNext === 'function') {
      options.onSaveAndNext({ stimulus, aois, queueIndex, queueTotal, isLast: isQueueLast });
    }
  });
  modal.querySelector('#aoiClose').addEventListener('click', () => close());
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  renderAll();
}

//~
