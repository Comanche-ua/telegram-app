// ===== Workspace State =====
let workspaces = {};          // { [id]: { name: string, items: Item[] } }
let workspaceOrder = [];      // string[] — порядок вкладок (не включає __all__)
let activeWorkspaceId = null; // string — ID активної вкладки

const ALL_WORKSPACE_ID = '__all__';
const WORKSPACES_KEY = 'defects_workspaces';
const WORKSPACE_ORDER_KEY = 'defects_workspace_order';
const ACTIVE_WORKSPACE_KEY = 'defects_active_workspace';
const OLD_ITEMS_KEY = 'defects_items';
const SHOW_REQUIRED_KEY = 'show_required_undated_tasks';

let ticker = null;
let editTargetIdx = -1;
let editTargetWsId = null; // ID workspace'у для редагування (якщо з "Всі")
const EDIT_MODE_KEY = 'ui_edit_mode_enabled';

// ===== Штат State =====
const SHTAT_KEY = 'shtat_data';
const SHTAT_CUSTOM_KEY = 'shtat_custom_cols';

// ---- Screen Lock (privacy protect) ----
const LOCK_HASH_KEY = 'screen_lock_hash';
const AUTO_LOCK_ENABLED_KEY = 'auto_lock_enabled';
const AUTO_LOCK_TIMEOUT_KEY = 'auto_lock_timeout';
let autoLockTimer = null;
let autoLockEnabled = false;
let autoLockTimeoutMs = 5 * 60 * 1000; // default 5 min

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isLockEnabled() {
  return !!localStorage.getItem(LOCK_HASH_KEY);
}

function showLockScreen() {
  document.body.classList.add('app-locked');
  const errEl = document.getElementById('lock-error');
  if (errEl) errEl.style.display = 'none';
  const input = document.getElementById('lock-password-input');
  if (input) { input.value = ''; setTimeout(() => input.focus(), 50); }
  renderTopSites('lock-top-sites', false);
}

function hideLockScreen() {
  document.body.classList.remove('app-locked');
}

async function initLockScreen() {
  const lockBtn = document.getElementById('lock-now-btn');
  if (isLockEnabled()) {
    if (lockBtn) lockBtn.style.display = 'flex';
    showLockScreen();
  } else {
    if (lockBtn) lockBtn.style.display = 'none';
    hideLockScreen();
  }
}

async function attemptUnlock() {
  const input = document.getElementById('lock-password-input');
  const errEl = document.getElementById('lock-error');
  const pass = input ? input.value : '';
  if (!pass) return;
  const storedHash = localStorage.getItem(LOCK_HASH_KEY);
  const inputHash = await sha256Hex(pass);
  if (inputHash === storedHash) {
    hideLockScreen();
    if (errEl) errEl.style.display = 'none';
    if (input) input.value = '';
  } else {
    if (errEl) errEl.style.display = 'block';
    if (input) { input.value = ''; input.focus(); }
  }
}

function manualLockNow() {
  if (!isLockEnabled()) {
    alert('Спочатку встановіть пароль у налаштуваннях (⚙️ → Захист екрана паролем).');
    return;
  }
  closeSettings();
  closeModal();
  closeEditModal();
  showLockScreen();
}

function updateLockStatusUI() {
  const statusEl = document.getElementById('lock-password-status');
  if (!statusEl) return;
  const enabled = isLockEnabled();
  statusEl.textContent = enabled ? '🔒 захист активний' : 'захист вимкнено';
  statusEl.style.background = enabled ? 'var(--green-bg)' : 'var(--surface2)';
  statusEl.style.color = enabled ? 'var(--green)' : 'var(--text3)';
  const lockBtn = document.getElementById('lock-now-btn');
  if (lockBtn) lockBtn.style.display = enabled ? 'flex' : 'none';
}

// ---- Auto-lock (idle timer) ----
function loadAutoLockSettings() {
  autoLockEnabled = localStorage.getItem(AUTO_LOCK_ENABLED_KEY) === 'true';
  const savedTimeout = parseInt(localStorage.getItem(AUTO_LOCK_TIMEOUT_KEY), 10);
  autoLockTimeoutMs = (savedTimeout > 0) ? savedTimeout * 60 * 1000 : 5 * 60 * 1000;
  // Update UI
  const autoLockCb = document.getElementById('auto-lock-checkbox');
  if (autoLockCb) autoLockCb.checked = autoLockEnabled;
  const timeoutSel = document.getElementById('auto-lock-timeout');
  if (timeoutSel) timeoutSel.value = String(autoLockTimeoutMs / 60000);
}

function saveAutoLockSettings() {
  localStorage.setItem(AUTO_LOCK_ENABLED_KEY, autoLockEnabled ? 'true' : 'false');
  localStorage.setItem(AUTO_LOCK_TIMEOUT_KEY, String(autoLockTimeoutMs / 60000));
}

function resetAutoLockTimer() {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  if (!autoLockEnabled || !isLockEnabled() || document.body.classList.contains('app-locked')) return;
  autoLockTimer = setTimeout(() => {
    showLockScreen();
  }, autoLockTimeoutMs);
}

function initAutoLock() {
  loadAutoLockSettings();
  // Reset timer on any user activity
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, resetAutoLockTimer, { passive: true });
  });
  // Also reset on visibility change (tab becomes active again)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resetAutoLockTimer();
  });
  resetAutoLockTimer();
}

// ---- Google Auth State ----
let currentUser = null;
const AUTH_USER_KEY = 'google_auth_user';
const CLIENT_ID_KEY = 'google_oauth_client_id';
let driveSyncTimer = null;
let driveSyncPending = false;

// ---- Workspace Management ----
function generateWorkspaceId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let r = '';
  for (let i = 0; i < 3; i++) r += chars[Math.floor(Math.random() * 26)];
  return `ws_${Date.now()}_${r}`;
}

function getActiveWorkspace() {
  if (activeWorkspaceId === ALL_WORKSPACE_ID) return null;
  return workspaces[activeWorkspaceId] || null;
}


function parseDateOnly(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateOnly(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function addRepeatInterval(date, repeatMode) {
  const next = new Date(date);
  if (repeatMode === 'weekly') next.setDate(next.getDate() + 7);
  else if (repeatMode === 'monthly') next.setMonth(next.getMonth() + 1);
  else if (repeatMode === 'quarterly') next.setMonth(next.getMonth() + 3);
  return next;
}

function expandRecurringItemForView(item, meta = {}) {
  const repeatMode = item.repeat || 'none';
  if (item.done || repeatMode === 'none' || !item.deadline) {
    return [{ ...item, ...meta, _viewKey: String(meta._wsIndex ?? 0) }];
  }

  const baseDate = parseDateOnly(item.deadline);
  if (!baseDate) return [{ ...item, ...meta, _viewKey: String(meta._wsIndex ?? 0) }];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let cursor = new Date(baseDate);

  while (cursor < today) {
    const next = addRepeatInterval(cursor, repeatMode);
    if (next <= cursor) break;
    cursor = next;
  }

  const horizon = new Date(cursor);
  horizon.setDate(horizon.getDate() + 31);

  const expanded = [];
  let occurrence = 0;
  while (cursor <= horizon && occurrence < 12) {
    const occurrenceDate = formatDateOnly(cursor);
    expanded.push({
      ...item,
      ...meta,
      deadline: occurrenceDate,
      _baseDeadline: item.deadline,
      _repeatOccurrence: occurrence,
      _viewKey: String(meta._wsIndex ?? 0) + '_' + occurrenceDate + '_' + occurrence
    });
    occurrence++;
    cursor = addRepeatInterval(cursor, repeatMode);
  }

  return expanded.length ? expanded : [{ ...item, ...meta, _viewKey: String(meta._wsIndex ?? 0) }];
}

function sortItemsByDeadline(a, b) {
  if (!a.deadline && !b.deadline) return 0;
  if (!a.deadline) return 1;
  if (!b.deadline) return -1;
  return new Date(a.deadline) - new Date(b.deadline);
}



function shouldShowRequiredUndated() {
  return localStorage.getItem(SHOW_REQUIRED_KEY) !== 'false';
}

function setRequiredUndatedVisible(show) {
  localStorage.setItem(SHOW_REQUIRED_KEY, show ? 'true' : 'false');
  updateRequiredToggleUI();
  if (getActiveItems().length) startTimers();
  else renderEmpty();
}

function updateRequiredToggleUI() {
  const btn = document.getElementById('required-toggle-btn');
  if (!btn) return;
  const show = shouldShowRequiredUndated();
  btn.classList.toggle('is-hidden', !show);
  btn.textContent = show ? 'Обов’язкові' : 'Обов’язкові сховано';
  btn.title = show ? 'Сховати задачі без дати' : 'Показати задачі без дати';
}

function getActiveItems() {
  if (activeWorkspaceId === ALL_WORKSPACE_ID) {
    const allItems = [];
    workspaceOrder.forEach(wsId => {
      const ws = workspaces[wsId];
      if (ws && ws.items) {
        ws.items.forEach((item, idx) => {
          allItems.push(...expandRecurringItemForView(item, {
            _workspaceId: wsId,
            _workspaceName: ws.name,
            _wsIndex: idx
          }));
        });
      }
    });
    allItems.sort(sortItemsByDeadline);
    return allItems;
  }
  const ws = workspaces[activeWorkspaceId];
  if (!ws) return [];
  return ws.items.flatMap((item, idx) => expandRecurringItemForView(item, { _wsIndex: idx })).sort(sortItemsByDeadline);
}

function addWorkspace(name) {
  const id = generateWorkspaceId();
  workspaces[id] = { id, name: name.trim(), items: [] };
  workspaceOrder.push(id);
  saveWorkspaces();
  return id;
}

function deleteWorkspace(id) {
  if (id === ALL_WORKSPACE_ID) return false;
  const ws = workspaces[id];
  if (!ws) return false;
  const name = ws.name;
  if (!confirm(`⚠️ ВИ ВПЕВНЕНІ? Видалити вкладку "${name}" разом з усіма завданнями?`)) return false;
  delete workspaces[id];
  workspaceOrder = workspaceOrder.filter(wid => wid !== id);
  if (activeWorkspaceId === id) {
    activeWorkspaceId = ALL_WORKSPACE_ID;
  }
  saveWorkspaces();
  return true;
}

function renameWorkspace(id, newName) {
  if (id === ALL_WORKSPACE_ID) return;
  const ws = workspaces[id];
  if (!ws) return;
  ws.name = newName.trim();
  saveWorkspaces();
}

function reorderWorkspaces(draggedId, targetId) {
  const fromIdx = workspaceOrder.indexOf(draggedId);
  const toIdx = workspaceOrder.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  workspaceOrder.splice(fromIdx, 1);
  const newToIdx = workspaceOrder.indexOf(targetId);
  workspaceOrder.splice(newToIdx, 0, draggedId);
  saveWorkspaces();
  renderTabBar();
}

function switchWorkspace(id) {
  activeWorkspaceId = id;
  localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
  if (ticker) clearInterval(ticker);
  if (getActiveItems().length) startTimers();
  else renderEmpty();
  renderTabBar();
  updateAddButton();
  updateCalendarVisibility();
}

function getItemsForActiveWorkspaceRaw() {
  // Повертає сирий масив items (без _wsIndex) для активного workspace
  if (activeWorkspaceId === ALL_WORKSPACE_ID) return getActiveItems(); // для "всі" повертаємо аггреговані
  const ws = workspaces[activeWorkspaceId];
  return ws ? ws.items : [];
}

function saveWorkspaces() {
  localStorage.setItem(WORKSPACES_KEY, JSON.stringify(workspaces));
  localStorage.setItem(WORKSPACE_ORDER_KEY, JSON.stringify(workspaceOrder));
  localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeWorkspaceId || ALL_WORKSPACE_ID);
  syncToDriveDebounced();
}

function loadWorkspaces() {
  // Міграція старих даних
  const oldItemsRaw = localStorage.getItem(OLD_ITEMS_KEY);
  const workspacesRaw = localStorage.getItem(WORKSPACES_KEY);

  if (!workspacesRaw && oldItemsRaw) {
    // Мігруємо старі дані
    try {
      const oldItems = JSON.parse(oldItemsRaw);
      if (Array.isArray(oldItems) && oldItems.length > 0) {
        const id = generateWorkspaceId();
        workspaces[id] = { id, name: 'Основне', items: oldItems };
        workspaceOrder = [id];
        saveWorkspaces();
        localStorage.removeItem(OLD_ITEMS_KEY); // чистимо старий ключ
        console.log('[Migration] Мігровано', oldItems.length, 'завдань у workspace "Основне"');
      }
    } catch(e) { console.warn('[Migration] Помилка міграції:', e); }
  }

  // Завантажуємо workspaces
  if (workspacesRaw) {
    try {
      workspaces = JSON.parse(workspacesRaw);
    } catch(e) { workspaces = {}; }
  }

  const orderRaw = localStorage.getItem(WORKSPACE_ORDER_KEY);
  if (orderRaw) {
    try {
      workspaceOrder = JSON.parse(orderRaw);
      // Фільтруємо неіснуючі workspace'и
      workspaceOrder = workspaceOrder.filter(wid => workspaces[wid]);
    } catch(e) { workspaceOrder = Object.keys(workspaces); }
  } else {
    workspaceOrder = Object.keys(workspaces);
  }

  // Якщо взагалі немає workspace'ів — створюємо дефолтний
  if (workspaceOrder.length === 0) {
    const id = generateWorkspaceId();
    workspaces[id] = { id, name: 'Основне', items: [] };
    workspaceOrder = [id];
    saveWorkspaces();
  }

  // Відновлюємо активну вкладку
  const savedActive = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  if (savedActive && (savedActive === ALL_WORKSPACE_ID || workspaces[savedActive])) {
    activeWorkspaceId = savedActive;
  } else {
    activeWorkspaceId = ALL_WORKSPACE_ID;
  }
}

// ---- Sync helpers ----
function syncToDriveDebounced() {
  if (!currentUser) return;
  driveSyncPending = true;
  if (driveSyncTimer) clearTimeout(driveSyncTimer);
  driveSyncTimer = setTimeout(async () => {
    if (driveSyncPending) {
      driveSyncPending = false;
      showSyncIndicator(true);
      await saveToDrive();
      showSyncIndicator(false);
    }
  }, 10000);
}

function showSyncIndicator(show) {
  const el = document.getElementById('sync-indicator');
  if (el) el.classList.toggle('active', show);
}

// ---- Save / Load ----
function saveToLocal() {
  // Key management
  const key = document.getElementById('api-key').value.trim();
  if (key && key.length > 10) localStorage.setItem('gemini_api_key', key);
  saveWorkspaces();
}

function loadFromLocal() {
  const savedKey = localStorage.getItem('gemini_api_key');
  if (savedKey) {
    document.getElementById('api-key').value = savedKey;
    checkKey();
  }
  loadWorkspaces();
  renderTabBar(); // <-- отрисовываем таб-бар сразу после загрузки
  updateAddButton();
  const items = getActiveItems();
  if (items.length) startTimers();
  else renderEmpty();
}

function saveApiKey() {
  const k = document.getElementById('api-key').value.trim();
  if (k && k.length > 10) localStorage.setItem('gemini_api_key', k);
  checkKey();
}

function checkKey() {
  const k = document.getElementById('api-key').value.trim();
  const s = document.getElementById('api-status');
  if (k.length > 10) {
    s.textContent = '✓ активний'; s.style.background = 'var(--green-bg)'; s.style.color = 'var(--green)';
  } else {
    s.textContent = 'недійсний ключ'; s.style.background = 'var(--surface2)'; s.style.color = 'var(--text3)';
  }
}

function clearStorage() {
  if (confirm("⚠️ ВИ ВПЕВНЕНІ? Це видалить API-ключ та всі завдання без можливості відновлення.")) {
    localStorage.removeItem('gemini_api_key');
    localStorage.removeItem(WORKSPACES_KEY);
    localStorage.removeItem(WORKSPACE_ORDER_KEY);
    localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
    localStorage.removeItem(OLD_ITEMS_KEY);
    document.getElementById('api-key').value = '';
    workspaces = {};
    workspaceOrder = [];
    activeWorkspaceId = ALL_WORKSPACE_ID;
    if (ticker) clearInterval(ticker);
    renderEmpty();
    renderTabBar();
    updateCalendarVisibility();
    setStatus('Усі дані очищено');
    checkKey();
  }
}

function clearAllData() {
  if (confirm("⚠️ УВАГА! Це видалить абсолютно всі дані:\n\n• Усі завдання та вкладки\n• API ключ Gemini\n• Google акаунт\n• Базу виконавців\n• Дані Штату\n• Оперативну область\n• Топ-сайти\n• Тему, шпалери, налаштування\n• Пароль блокування екрана\n\nПісля скидання сторінка перезавантажиться.\n\nПРОДОВЖИТИ?")) {
    localStorage.clear();
    window.location.reload();
  }
}

function clearTasks() {
  const ws = getActiveWorkspace();
  if (!ws) {
    // Для "Всі" — очищаємо всі workspace'и
    if (!confirm("⚠️ ВИ ВПЕВНЕНІ? Усі завдання в усіх вкладках будуть видалені назавжди.")) return;
    workspaceOrder.forEach(wid => {
      if (workspaces[wid]) workspaces[wid].items = [];
    });
  } else {
    if (!confirm(`⚠️ ВИ ВПЕВНЕНІ? Усі завдання у вкладці "${ws.name}" будуть видалені назавжди.`)) return;
    ws.items = [];
  }
  saveWorkspaces();
  if (ticker) clearInterval(ticker);
  renderEmpty();
  updateCalendarVisibility();
  setStatus('Список завдань очищено');
}

// ---- Google OAuth ----
function getStoredClientId() {
  return localStorage.getItem(CLIENT_ID_KEY) || '';
}

function saveClientId(clientId) {
  localStorage.setItem(CLIENT_ID_KEY, clientId);
}

function initAuth() {
  console.log('[Auth] initAuth called');
  // Ініціалізуємо Google Identity Services (web)
  if (typeof google !== 'undefined' && google.accounts) {
    initGisClient();
  }
  const savedUser = localStorage.getItem(AUTH_USER_KEY);
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      console.log('[Auth] Restored user:', currentUser.email);
      renderAuthUI();
      silentTokenCheck();
      return;
    } catch(e) { console.warn('[Auth] Failed to restore user:', e); }
  }
  renderAuthUI();
}

function silentTokenCheck() {
  const savedToken = localStorage.getItem('google_auth_token');
  if (!savedToken) {
    currentUser = null;
    localStorage.removeItem(AUTH_USER_KEY);
    renderAuthUI();
    return;
  }
  Promise.all([
    fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${savedToken}` }
    }),
    fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${savedToken}` }
    })
  ]).then(([userResp, driveResp]) => {
    if (!userResp.ok || !driveResp.ok) {
      console.log('[Auth] Token invalid or missing Drive scope, clearing');
      currentUser = null;
      localStorage.removeItem(AUTH_USER_KEY);
      localStorage.removeItem('google_auth_token');
      renderAuthUI();
    }
  }).catch(() => {});
}

// ---- Google OAuth (Web) ----
let gisTokenClient = null;

function initGisClient() {
  if (typeof google === 'undefined' || !google.accounts) {
    console.log('[Auth] Google Identity Services not loaded yet');
    return;
  }
  const clientId = getStoredClientId();
  if (!clientId) {
    console.log('[Auth] No Client ID configured — skipping GIS init');
    return;
  }
  gisTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
    callback: async (tokenResponse) => {
      if (tokenResponse.error) {
        console.error('[Auth] Token error:', tokenResponse.error);
        alert('Помилка авторизації: ' + (tokenResponse.error_description || tokenResponse.error));
        renderAuthUI();
        return;
      }
      console.log('[Auth] Token obtained via GIS');
      localStorage.setItem('google_auth_token', tokenResponse.access_token);
      await handleAuthSuccess(tokenResponse.access_token);
    }
  });
}

function signInWithGoogle() {
  if (typeof google === 'undefined' || !google.accounts) {
    // Fallback: спробувати через popup вручну (мобільний резерв)
    const clientId = getStoredClientId();
    const redirectUri = window.location.origin + window.location.pathname;
    const scope = encodeURIComponent('openid email profile https://www.googleapis.com/auth/drive.file');
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' +
      'client_id=' + clientId +
      '&redirect_uri=' + encodeURIComponent(redirectUri) +
      '&response_type=token' +
      '&scope=' + scope +
      '&prompt=consent';
    window.location.href = authUrl;
    return;
  }

  renderAuthLoading();
  console.log('[Auth] Starting GIS token flow...');

  if (!gisTokenClient) initGisClient();
  if (gisTokenClient) {
    gisTokenClient.requestAccessToken();
  } else {
    alert('⚠️ Сервіс авторизації Google недоступний. Спробуйте оновити сторінку.');
    renderAuthUI();
  }
}

function handleRedirectAuth() {
  // Обробка redirect з implicit grant (якщо GIS popup не спрацював)
  const hash = window.location.hash;
  if (hash && hash.includes('access_token')) {
    const params = new URLSearchParams(hash.substring(1));
    const token = params.get('access_token');
    if (token) {
      // Очищаємо hash з URL
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      localStorage.setItem('google_auth_token', token);
      handleAuthSuccess(token);
    }
  }
}

async function handleAuthSuccess(accessToken) {
  try {
    localStorage.setItem('google_auth_token', accessToken);

    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!resp.ok) throw new Error('Не вдалося отримати дані користувача');

    const profile = await resp.json();
    currentUser = {
      name: profile.name || profile.email,
      email: profile.email,
      picture: profile.picture || ''
    };

    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(currentUser));
    renderAuthUI();

    await loadFromDrive();
  } catch(e) {
    console.error('[Auth] Userinfo error:', e);
    renderAuthUI();
  }
}

// ---- Google Drive Sync ----
const DRIVE_FILE_NAME = 'deadline-tracker-data.json';

function getDriveToken() {
  return localStorage.getItem('google_auth_token');
}

async function driveApiFetch(url, options = {}) {
  const token = getDriveToken();
  if (!token) return null;
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  return resp;
}

async function findDriveFile() {
  const q = `name='${DRIVE_FILE_NAME}' and trashed=false`;
  console.log('[Drive] Searching for file:', DRIVE_FILE_NAME);
  const resp = await driveApiFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)`
  );
  if (!resp) { console.log('[Drive] No response from API'); return null; }
  if (!resp.ok) { console.error('[Drive] API error:', resp.status, await resp.text()); return null; }
  const data = await resp.json();
  console.log('[Drive] Found files:', data.files ? data.files.length : 0);
  return data.files && data.files.length > 0 ? data.files[0] : null;
}

async function saveToDrive() {
  if (!currentUser) { console.log('[Drive] No user, skipping save'); return; }
  const token = getDriveToken();
  if (!token) { console.log('[Drive] No token, skipping save'); return; }

  console.log('[Drive] Saving to Drive...');
  try {
    const fileData = JSON.stringify({
      workspaces: workspaces,
      workspaceOrder: workspaceOrder,
      assignees: loadAssigneeDB(),
      savedAt: new Date().toISOString(),
      savedBy: currentUser.email
    }, null, 2);

    const existing = await findDriveFile();

    if (existing) {
      console.log('[Drive] Updating existing file:', existing.id);
      const updateResp = await driveApiFetch(
        `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: fileData
        }
      );
      console.log('[Drive] Update response:', updateResp ? updateResp.status : 'null');
      if (updateResp && !updateResp.ok) {
        console.error('[Drive] Update failed:', await updateResp.text());
      }
    } else {
      console.log('[Drive] Creating new file...');
      const metadata = JSON.stringify({
        name: DRIVE_FILE_NAME,
        mimeType: 'application/json'
      });
      const form = new FormData();
      form.append('metadata', new Blob([metadata], { type: 'application/json' }));
      form.append('file', new Blob([fileData], { type: 'application/json' }));

      const createResp = await driveApiFetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
        { method: 'POST', body: form }
      );
      console.log('[Drive] Create response:', createResp ? createResp.status : 'null');
      if (createResp && !createResp.ok) {
        console.error('[Drive] Create failed:', await createResp.text());
      }
      console.log('[Drive] Файл створено');
    }
  } catch(e) {
    console.error('[Drive] Помилка збереження:', e);
  }
}

async function loadFromDrive() {
  if (!currentUser) return;
  const token = getDriveToken();
  if (!token) return;

  showSyncIndicator(true);
  try {
    const existing = await findDriveFile();
    if (!existing) {
      console.log('[Drive] Файл не знайдено в Drive, використовуємо локальні дані');
      return;
    }

    const resp = await driveApiFetch(
      `https://www.googleapis.com/drive/v3/files/${existing.id}?alt=media`
    );
    if (!resp || !resp.ok) return;

    const cloudData = await resp.json();

    // Завантажуємо workspaces з хмари
    if (cloudData.workspaces && typeof cloudData.workspaces === 'object') {
      const cloudTime = new Date(cloudData.savedAt).getTime();
      const localTime = workspaceOrder.length > 0 ? Date.now() : 0;

      if (cloudTime > localTime || workspaceOrder.length === 0) {
        workspaces = cloudData.workspaces;
        workspaceOrder = cloudData.workspaceOrder || Object.keys(workspaces);
        // Фільтруємо неіснуючі
        workspaceOrder = workspaceOrder.filter(wid => workspaces[wid]);
        saveWorkspaces();
        console.log('[Drive] Завантажено з Drive:', workspaceOrder.length, 'вкладок');
      } else {
        console.log('[Drive] Локальні дані новіші, синхронізуємо в Drive');
        await saveToDrive();
      }

      // Завантажуємо базу виконавців
      if (cloudData.assignees && Array.isArray(cloudData.assignees)) {
        const localDB = loadAssigneeDB();
        const merged = [...new Set([...localDB, ...cloudData.assignees])].sort((a, b) => a.localeCompare(b, 'uk'));
        saveAssigneeDB(merged);
      }

      // Перемальовуємо UI
      const items = getActiveItems();
      if (items.length) startTimers();
      else renderEmpty();
      renderTabBar();
      renderAssigneeChips();
      populateDatalist();
    }
  } catch(e) {
    console.error('[Drive] Помилка завантаження:', e);
  }
  showSyncIndicator(false);
}

function signOutGoogle() {
  const token = localStorage.getItem('google_auth_token');
  if (token) {
    // Ревокуємо токен через Google API
    fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`).catch(() => {});
  }

  currentUser = null;
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem('google_auth_token');
  workspaces = {};
  workspaceOrder = [];
  activeWorkspaceId = ALL_WORKSPACE_ID;
  if (ticker) clearInterval(ticker);
  renderEmpty();
  renderTabBar();
  renderAuthUI();
  updateCalendarVisibility();
}

async function exportToGoogleDoc() {
  if (!currentUser) {
    alert('Будь ласка, увійдіть через Google для експорту в Doc');
    return;
  }

  setStatus('Створення Google Doc...', true);
  try {
    let htmlContent = `
      <h1>Звіт по недоліках (Транскрибація)</h1>
      <p>Дата створення: ${new Date().toLocaleString('uk-UA')}</p>
      <p>Створено користувачем: ${currentUser.email}</p>
      <hr>
    `;

    // Групуємо по вкладках
    workspaceOrder.forEach(wsId => {
      const ws = workspaces[wsId];
      if (!ws || !ws.items.length) return;

      htmlContent += `<h2>📁 ${escHtml(ws.name)}</h2>`;
      htmlContent += `
        <table border="1" style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
          <thead>
            <tr style="background-color: #f2f2f2;">
              <th style="padding: 8px; text-align: left;">№</th>
              <th style="padding: 8px; text-align: left;">Опис недоліку</th>
              <th style="padding: 8px; text-align: left;">Дедлайн</th>
              <th style="padding: 8px; text-align: left;">Виконавець</th>
              <th style="padding: 8px; text-align: left;">Статус</th>
            </tr>
          </thead>
          <tbody>
      `;

      ws.items.forEach((item, idx) => {
        const dateStr = item.deadline ? new Date(item.deadline).toLocaleDateString('uk-UA') : 'Без терміну';
        const timeStr = item.deadlineTime || '';
        const statusStr = item.done ? 'Виконано' : '⏳ В роботі';
        htmlContent += `
          <tr>
            <td style="padding: 8px;">${idx + 1}</td>
            <td style="padding: 8px;">${escHtml(item.text)}</td>
            <td style="padding: 8px;">${dateStr} ${timeStr}</td>
            <td style="padding: 8px;">${escHtml(item.assignee || 'Не призначено')}</td>
            <td style="padding: 8px;">${statusStr}</td>
          </tr>
        `;
      });

      htmlContent += `</tbody></table>`;
    });

    const metadata = {
      name: `Звіт_по_недоліках_${new Date().toISOString().split('T')[0]}.html`,
      mimeType: 'application/vnd.google-apps.document'
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([htmlContent], { type: 'text/html' }));

    const resp = await driveApiFetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'POST', body: form }
    );

    if (resp && resp.ok) {
      const data = await resp.json();
      alert(`Звіт успішно створено! ID файлу: ${data.id}`);
    } else {
      throw new Error('Помилка при завантаженні у Google Drive');
    }
  } catch (e) {
    console.error(e);
    alert('Помилка експорту: ' + e.message);
  } finally {
    setStatus('');
  }
}

// ---- Auth UI ----
function renderAuthUI() {
  console.log('[Auth] renderAuthUI called, currentUser:', currentUser);
  const section = document.getElementById('auth-section');
  if (!section) { console.error('[Auth] #auth-section not found!'); return; }

  if (currentUser) {
    section.innerHTML = `
      <div class="user-profile" id="user-profile" title="${escHtml(currentUser.email)}">
        ${currentUser.picture
          ? `<img class="user-avatar" src="${currentUser.picture}" alt="avatar" referrerpolicy="no-referrer">`
          : `<div class="user-avatar" style="background:var(--blue-bg);display:flex;align-items:center;justify-content:center;font-size:14px;">👤</div>`
        }
        <span class="user-name">${escHtml(currentUser.name)}</span>
        <span class="sync-indicator" id="sync-indicator"><span class="spinner"></span> ☁️</span>
        <div class="user-dropdown" id="user-dropdown">
          <div class="user-dropdown-item" style="opacity:0.6;cursor:default;font-size:12px;">${escHtml(currentUser.email)}</div>
          <div class="user-dropdown-item" style="opacity:0.5;cursor:default;font-size:11px;" id="drive-status">☁️ Google Drive: підключено</div>
          <div class="user-dropdown-item" id="btn-sync-now">🔄 Синхронізувати зараз</div>
          <div class="user-dropdown-item danger" id="btn-signout">🚪 Вийти</div>
        </div>
      </div>
    `;

    const profile = document.getElementById('user-profile');
    const dropdown = document.getElementById('user-dropdown');
    profile.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('active');
    });

    document.getElementById('btn-signout').addEventListener('click', (e) => {
      e.stopPropagation();
      signOutGoogle();
    });

    document.getElementById('btn-sync-now').addEventListener('click', async (e) => {
      e.stopPropagation();
      showSyncIndicator(true);
      await saveToDrive();
      await loadFromDrive();
      showSyncIndicator(false);
      dropdown.classList.remove('active');
    });

    document.addEventListener('click', () => {
      dropdown.classList.remove('active');
    });
  } else {
    section.innerHTML = `
      <button class="auth-btn" id="btn-google-signin">
        <svg viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
        Увійти через Google
      </button>
    `;

    document.getElementById('btn-google-signin').addEventListener('click', signInWithGoogle);
  }
}

function renderAuthLoading() {
  const section = document.getElementById('auth-section');
  if (!section) return;
  section.innerHTML = `<div class="auth-loading"><span class="spinner"></span> Авторизація...</div>`;
}

// ---- Tab Bar ----
function renderTabBar() {
  const tabList = document.getElementById('tab-list');
  if (!tabList) return;

  let html = '';

  // Вкладка "Всі" (завжди перша)
  html += `<div class="tab-item ${activeWorkspaceId === ALL_WORKSPACE_ID ? 'active' : ''}" data-ws-id="${ALL_WORKSPACE_ID}" title="Всі завдання">
    <span class="tab-name tab-name-all"><span class="ui-glyph ui-glyph-board" aria-hidden="true"></span>Всі</span>
  </div>`;

  // Решта вкладок
  workspaceOrder.forEach(wsId => {
    const ws = workspaces[wsId];
    if (!ws) return;
    const isActive = activeWorkspaceId === wsId;
    const count = ws.items ? ws.items.filter(i => !i.done).length : 0;
    html += `<div class="tab-item ${isActive ? 'active' : ''}" data-ws-id="${wsId}" draggable="true" title="${escHtml(ws.name)} (${count} активних) · перетягніть, щоб змінити порядок">
      <span class="tab-name">${escHtml(ws.name)}</span>
      <span class="tab-count">${count}</span>
      <span class="tab-close" data-ws-id="${wsId}" title="Видалити вкладку" aria-label="Видалити вкладку"></span>
    </div>`;
  });

  tabList.innerHTML = html;

  // Event listeners для вкладок
  tabList.querySelectorAll('.tab-item').forEach(tab => {
    const wsId = tab.dataset.wsId;
    if (!wsId) return;

    // Клік — перемикання
    tab.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) return; // обробляється окремо
      if (e.target.tagName === 'INPUT') return; // редагування
      switchWorkspace(wsId);
    });

    // Подвійний клік — редагування (тільки не для "Всі")
    if (wsId !== ALL_WORKSPACE_ID) {
      tab.addEventListener('dblclick', (e) => {
        if (e.target.classList.contains('tab-close')) return;
        startTabRename(wsId, tab);
      });
    }

    // Перетягування вкладок для зміни порядку (не для "Всі")
    if (wsId !== ALL_WORKSPACE_ID) {
      tab.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', wsId);
        tab.classList.add('dragging');
      });
      tab.addEventListener('dragend', () => {
        tab.classList.remove('dragging');
        tabList.querySelectorAll('.tab-item').forEach(t => t.classList.remove('drag-over'));
      });
      tab.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!tab.classList.contains('dragging')) tab.classList.add('drag-over');
      });
      tab.addEventListener('dragleave', () => {
        tab.classList.remove('drag-over');
      });
      tab.addEventListener('drop', (e) => {
        e.preventDefault();
        tab.classList.remove('drag-over');
        const draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId || draggedId === wsId) return;
        reorderWorkspaces(draggedId, wsId);
      });
    }
  });

  // Event listeners для кнопок закриття
  tabList.querySelectorAll('.tab-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wsId = btn.dataset.wsId;
      if (deleteWorkspace(wsId)) {
        switchWorkspace(activeWorkspaceId === wsId ? ALL_WORKSPACE_ID : activeWorkspaceId);
        const items = getActiveItems();
        if (items.length) startTimers();
        else renderEmpty();
        renderTabBar();
        updateCalendarVisibility();
      }
    });
  });
}

function startTabRename(wsId, tabEl) {
  const ws = workspaces[wsId];
  if (!ws) return;

  const nameSpan = tabEl.querySelector('.tab-name');
  const oldName = ws.name;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = oldName;
  input.className = 'tab-rename-input';
  input.style.cssText = 'background:var(--surface2);border:1px solid var(--blue);color:var(--text);padding:2px 6px;border-radius:4px;font-size:13px;font-family:Inter,sans-serif;width:120px;outline:none;';

  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  const finishRename = () => {
    const newName = input.value.trim();
    if (newName && newName !== oldName) {
      renameWorkspace(wsId, newName);
    }
    renderTabBar();
  };

  input.addEventListener('blur', finishRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = oldName; input.blur(); }
  });
}

function updateAddButton() {
  const addBtn = document.getElementById('add-btn');
  if (!addBtn) return;
  if (activeWorkspaceId === ALL_WORKSPACE_ID && workspaceOrder.length === 0) {
    addBtn.style.opacity = '0.5';
    addBtn.title = 'Спочатку створіть вкладку';
  } else {
    addBtn.style.opacity = '1';
    addBtn.title = activeWorkspaceId === ALL_WORKSPACE_ID ? 'Додати завдання (виберіть вкладку)' : 'Додати завдання';
  }
}

// ---- База виконавців ----
const ASSIGNEES_DB_KEY = 'assignees_db';

function loadAssigneeDB() {
  try {
    const raw = localStorage.getItem(ASSIGNEES_DB_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch(e) { return []; }
}

function saveAssigneeDB(db) {
  localStorage.setItem(ASSIGNEES_DB_KEY, JSON.stringify(db));
}

function addAssigneeToDB(name) {
  if (!name || !name.trim()) return false;
  const trimmed = name.trim();
  const db = loadAssigneeDB();
  if (db.some(a => a.toLowerCase() === trimmed.toLowerCase())) return false;
  db.push(trimmed);
  db.sort((a, b) => a.localeCompare(b, 'uk'));
  saveAssigneeDB(db);
  populateDatalist();
  renderAssigneeChips();
  return true;
}

function deleteAssigneeFromDB(name) {
  const db = loadAssigneeDB().filter(a => a !== name);
  saveAssigneeDB(db);
  populateDatalist();
  renderAssigneeChips();
}

function populateDatalist() {
  const dl = document.getElementById('assignees-datalist');
  if (!dl) return;
  const db = loadAssigneeDB();
  dl.innerHTML = db.map(a => `<option value="${escHtml(a)}">`).join('');
}

function renderAssigneeChips() {
  const container = document.getElementById('assignees-list');
  if (!container) return;
  const db = loadAssigneeDB();
  if (!db.length) {
    container.innerHTML = '<span style="font-size:12px; color:var(--text3);">Поки що порожньо. Виконавці додаються автоматично при збереженні завдань.</span>';
    return;
  }
  container.innerHTML = db.map(name => `
    <span class="assignee-chip">
      👤 ${escHtml(name)}
      <span class="chip-del" data-name="${escHtml(name)}" title="Видалити">✕</span>
    </span>
  `).join('');
  container.querySelectorAll('.chip-del').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteAssigneeFromDB(el.dataset.name);
    });
  });
}

function setStatus(msg, loading = false) {
  const el = document.getElementById('status');
  if (loading) el.innerHTML = '<span class="spinner"></span> ' + msg;
  else el.textContent = msg;
}

function renderEmpty() {
  const c = document.getElementById('container');
  const wsName = activeWorkspaceId === ALL_WORKSPACE_ID ? 'жодній вкладці' : `вкладці "${getActiveWorkspace()?.name || ''}"`;
  c.innerHTML = `<div class="empty empty-state">Немає активних завдань у ${wsName}. Додайте список та натисніть "Розпізнати + додати до списку"</div>`;
}

// ---- Часто відвідувані сайти (редаговані користувачем) ----
const TOPSITES_KEY = 'defects_custom_topsites';
let customTopSites = [];   // [{id, title, url}]
let editingSiteId = null;

function generateSiteId() {
  return 'site_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
}

function loadCustomTopSites() {
  const raw = localStorage.getItem(TOPSITES_KEY);
  if (raw) {
    try {
      customTopSites = JSON.parse(raw);
      return true;
    } catch (e) { customTopSites = []; }
  }
  return false;
}

function saveCustomTopSites() {
  localStorage.setItem(TOPSITES_KEY, JSON.stringify(customTopSites));
}

function faviconUrl(pageUrl) {
  try {
    const u = new URL(pageUrl);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch (e) {
    return '';
  }
}

function normalizeUrl(raw) {
  let u = (raw || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

// Ініціалізація: якщо у користувача ще немає власного списку — підставляємо
// системні часто відвідувані сайти як стартовий набір (можна редагувати).
function initTopSites() {
  loadCustomTopSites();
  renderTopSites('top-sites', true);
  renderTopSites('lock-top-sites', false);
}

// editable=true → показує кнопки додавання/редагування/видалення (топбар)
// editable=false → лише перегляд (екран блокування)
function renderTopSites(containerId, editable) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  customTopSites.forEach(site => {
    const item = document.createElement('div');
    item.className = 'site-item' + (editable ? ' editable' : '');
    item.dataset.siteId = site.id;

    const link = document.createElement('a');
    link.className = 'site-link';
    link.href = site.url;
    link.title = site.title;

    const wrapper = document.createElement('div');
    wrapper.className = 'site-icon-wrapper';

    const img = document.createElement('img');
    img.src = faviconUrl(site.url);
    img.alt = '';
    img.addEventListener('error', () => {
      wrapper.innerHTML = `<span class="site-fallback">${escHtml((site.title || '?').charAt(0).toUpperCase())}</span>`;
    });

    const titleSpan = document.createElement('span');
    titleSpan.className = 'site-title';
    titleSpan.textContent = site.title;

    wrapper.appendChild(img);
    link.appendChild(wrapper);
    link.appendChild(titleSpan);
    item.appendChild(link);

    if (editable) {
      const actions = document.createElement('div');
      actions.className = 'site-actions';
      actions.innerHTML = `<span class="site-edit" title="Редагувати" aria-label="Редагувати"></span><span class="site-del" title="Видалити" aria-label="Видалити"></span>`;
      item.appendChild(actions);
    }

    container.appendChild(item);
  });

  if (editable) {
    const addBtn = document.createElement('div');
    addBtn.className = 'site-item site-add-btn';
    addBtn.title = 'Додати сайт';
    addBtn.innerHTML = `<div class="site-icon-wrapper site-add-icon" aria-hidden="true"></div>`;
    addBtn.addEventListener('click', () => openTopSiteEditor(null));
    container.appendChild(addBtn);

    container.querySelectorAll('.site-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.closest('.site-item').dataset.siteId;
        const site = customTopSites.find(s => s.id === id);
        if (site) openTopSiteEditor(site);
      });
    });

    container.querySelectorAll('.site-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.closest('.site-item').dataset.siteId;
        removeTopSite(id);
      });
    });

    // Клік по посиланню не має спрацьовувати, поки триває наведення на кнопки дій
    container.querySelectorAll('.site-link').forEach(link => {
      link.addEventListener('click', (e) => {
        if (!link.getAttribute('href')) e.preventDefault();
      });
    });
  }
}

function removeTopSite(id) {
  const site = customTopSites.find(s => s.id === id);
  if (!site) return;
  if (!confirm(`Видалити сайт "${site.title}" зі списку часто відвідуваних?`)) return;
  customTopSites = customTopSites.filter(s => s.id !== id);
  saveCustomTopSites();
  renderTopSites('top-sites', true);
  renderTopSites('lock-top-sites', false);
}

function openTopSiteEditor(site) {
  editingSiteId = site ? site.id : null;
  const titleEl = document.getElementById('site-edit-modal-title');
  const titleInput = document.getElementById('site-edit-title');
  const urlInput = document.getElementById('site-edit-url');
  const delLink = document.getElementById('site-edit-delete-link');

  if (titleEl) titleEl.textContent = site ? 'Редагувати сайт' : 'Додати сайт';
  if (titleInput) titleInput.value = site ? site.title : '';
  if (urlInput) urlInput.value = site ? site.url : '';
  if (delLink) delLink.style.display = site ? 'inline' : 'none';

  const modal = document.getElementById('siteEditModal');
  if (modal) modal.classList.add('active');
  setTimeout(() => { if (titleInput) titleInput.focus(); }, 50);
}

function closeTopSiteEditor() {
  const modal = document.getElementById('siteEditModal');
  if (modal) modal.classList.remove('active');
  editingSiteId = null;
}

function saveTopSiteFromModal() {
  const titleInput = document.getElementById('site-edit-title');
  const urlInput = document.getElementById('site-edit-url');
  if (!titleInput || !urlInput) return;

  const url = normalizeUrl(urlInput.value);
  if (!url) {
    alert('⚠️ Вкажіть адресу сайту (URL)');
    return;
  }
  try { new URL(url); } catch (e) {
    alert('⚠️ Невірний формат адреси. Приклад: https://example.com');
    return;
  }

  let title = titleInput.value.trim();
  if (!title) {
    try { title = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { title = url; }
  }

  if (editingSiteId) {
    const site = customTopSites.find(s => s.id === editingSiteId);
    if (site) { site.title = title; site.url = url; }
  } else {
    customTopSites.push({ id: generateSiteId(), title, url });
  }

  saveCustomTopSites();
  renderTopSites('top-sites', true);
  renderTopSites('lock-top-sites', false);
  closeTopSiteEditor();
}

// ---- Видалення окремого завдання ----
function deleteTaskByIdx(idx, wsIdOverride) {
  const userConfirmed = confirm("❓ ВИ ВПЕВНЕНІ? Видалити це завдання?");
  if (!userConfirmed) return;

  let targetWsId = wsIdOverride || activeWorkspaceId;
  if (targetWsId === ALL_WORKSPACE_ID) {
    // Це не повинно статись, але про всяк випадок
    return;
  }

  const ws = workspaces[targetWsId];
  if (!ws) return;

  if (idx >= 0 && idx < ws.items.length) {
    ws.items.splice(idx, 1);
    saveWorkspaces();
    const items = getActiveItems();
    if (items.length === 0) {
      if (ticker) clearInterval(ticker);
      renderEmpty();
      setStatus("Завдання видалено. Список порожній.");
    } else {
      ws.items.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
      renderCards();
      setStatus("Завдання видалено");
    }
    renderTabBar();
    updateCalendarVisibility();
  }
}

// ---- Gemini AI ----
function extractJsonFromText(text) {
  let match = text.match(/\[\s*\{.*?\}\s*\]/s);
  if (match) return match[0];
  match = text.match(/```json\s*(\[\s*\{.*?\}\s*\])\s*```/s);
  if (match) return match[1];
  match = text.match(/```\s*(\[\s*\{.*?\}\s*\])\s*```/s);
  if (match) return match[1];
  return text;
}

async function parseWithGemini() {
  const key = document.getElementById('api-key').value.trim();
  if (!key || key.length < 10) {
    alert('Введіть коректний Gemini API Key');
    return;
  }
  const raw = document.getElementById('raw').value.trim();
  if (!raw) { setStatus('Введіть список недоліків'); return; }

  // Визначаємо цільовий workspace (завжди з селекта)
  let targetWsId = activeWorkspaceId;
  const wsSelect = document.getElementById('add-workspace-select');
  if (wsSelect && wsSelect.value) {
    targetWsId = wsSelect.value;
  }
  if (!targetWsId || targetWsId === ALL_WORKSPACE_ID || !workspaces[targetWsId]) {
    alert('Будь ласка, виберіть вкладку для додавання завдань.');
    return;
  }

  const targetWs = workspaces[targetWsId];
  if (!targetWs) {
    alert('Помилка: вкладку не знайдено.');
    return;
  }

  const btn = document.getElementById('btn-parse');
  btn.disabled = true;
  setStatus('Gemini аналізує...', true);

  try {
    const model = 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const prompt = `Ти парсер списків недоліків українською мовою.
Поверни ТІЛЬКИ JSON масив, без жодних пояснень. Кожен елемент: {"text":"короткий опис недоліку","deadline":"YYYY-MM-DD","time":"HH:mm або \"\"","assignee":"ім'я виконавця або \"\""}
Дати конвертуй з форматів: ДД.ММ.РРРР, ДД/ММ/РРРР, "до 25 червня 2025", "термін 2025-07-10" в YYYY-MM-DD.
Якщо в тексті вказано час (наприклад: "о 14:30", "на 10:00", "15:45", "о 9 ранку" → "09:00") — запиши його в поле time у форматі HH:mm. Якщо час не вказано — залиш time порожнім рядком "".
Якщо в тексті згадується виконавець (наприклад: "Іваненко відповідальний", "виконавець: Петров", "закріплено за Сидоренком") — запиши його ім'я в поле assignee. Якщо виконавця не вказано — залиш assignee порожнім рядком "".
Якщо дата не зрозуміла або її немає — залиш deadline порожнім значенням null, але пункт не пропускай.
Відповідай лише масивом JSON. Порожній масив якщо нічого немає.

Текст: """${raw}"""`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 4096 } })
    });
    if (!resp.ok) {
      const errData = await resp.json();
      throw new Error(errData.error?.message || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    let rawText = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    const clean = extractJsonFromText(rawText);
    let parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) throw new Error('Не масив');

    const defaultRepeat = document.getElementById('default-repeat').value || 'none';
    const defaultAssignee = document.getElementById('default-assignee').value.trim() || '';
    const newItems = parsed.filter(i => i.text).map(i => ({
      text: i.text.trim(),
      deadline: i.deadline || null,
      deadlineTime: (i.time && i.time.trim()) || '',
      repeat: defaultRepeat,
      assignee: (i.assignee && i.assignee.trim()) || defaultAssignee,
      done: false,
      completedAt: null
    }));

    if (newItems.length === 0) {
      setStatus('Не знайдено жодного завдання з датою');
      btn.disabled = false;
      return;
    }

    // Автоматично додаємо нових виконавців у базу
    if (defaultAssignee) addAssigneeToDB(defaultAssignee);
    newItems.forEach(ni => { if (ni.assignee) addAssigneeToDB(ni.assignee); });

    const existingKeys = new Set(targetWs.items.map(it => `${it.text}|${it.deadline}|${it.assignee || ''}`));
    let addedCount = 0;
    for (const ni of newItems) {
      const key = `${ni.text}|${ni.deadline}|${ni.assignee || ''}`;
      if (!existingKeys.has(key)) {
        targetWs.items.push(ni);
        addedCount++;
        existingKeys.add(key);
      }
    }

    if (addedCount === 0) {
      setStatus(`⚠️ Нових унікальних завдань не знайдено (усі вже у списку вкладки "${targetWs.name}").`);
      btn.disabled = false;
      return;
    }

    targetWs.items.sort(sortItemsByDeadline);
    saveWorkspaces();
    setStatus(`Додано ${addedCount} нових завдань у "${targetWs.name}".`);
    renderTabBar();

    // Якщо ми не в цільовому workspace, переключаємось
    if (activeWorkspaceId !== targetWsId && activeWorkspaceId !== ALL_WORKSPACE_ID) {
      // залишаємось на місці
    }

    startTimers();
    setTimeout(() => {
      closeModal();
      setStatus('');
      document.getElementById('raw').value = '';
    }, 1500);
  } catch (e) {
    console.error(e);
    setStatus('Помилка: ' + e.message);
    alert('Помилка Gemini: ' + e.message);
  }
  btn.disabled = false;
}

// ---- Таймери та графіка ----
function getDeadlineEnd(deadline, deadlineTime) {
  if (!deadline) return null;
  const end = new Date(deadline);
  if (deadlineTime) {
    const [h, m] = deadlineTime.split(':').map(Number);
    end.setHours(h, m, 0, 0);
  } else {
    end.setHours(17, 0, 0, 0);
  }
  return end;
}

function getProgressFraction(deadline, deadlineTime) {
  const now = new Date();
  const end = getDeadlineEnd(deadline, deadlineTime);
  if (now >= end) return 1;
  const start = new Date(deadline);
  start.setHours(0, 0, 0, 0);
  const total = end - start;
  const elapsed = now - start;
  if (total <= 0) return 1;
  let frac = elapsed / total;
  frac = Math.min(Math.max(frac, 0), 1);
  return frac;
}

function drawTimer(canvasId, deadline, deadlineTime) {
  if (!deadline) return;
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = canvas.width = canvas.height = 120;
  canvas.style.width = '60px';
  canvas.style.height = '60px';

  const progress = getProgressFraction(deadline, deadlineTime);
  const now = new Date();
  const endD = getDeadlineEnd(deadline, deadlineTime);
  const isOverdue = now > endD;

  let mainColor = '#22C55E';
  if (isOverdue) mainColor = '#DC2626';
  else if (progress > 0.7) mainColor = '#DC2626';
  else if (progress > 0.4) mainColor = '#D97706';
  else mainColor = '#16A34A';

  const bgColor = 'rgba(0,0,0,0.15)';
  const radius = 54;
  const centerX = 60, centerY = 60;

  ctx.clearRect(0, 0, size, size);

  // Glow effect behind the ring
  ctx.save();
  ctx.shadowColor = mainColor;
  ctx.shadowBlur = isOverdue ? 12 : 8;

  // Background circle
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  ctx.fillStyle = bgColor;
  ctx.fill();

  // Track ring
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(128,128,128,0.2)';
  ctx.lineWidth = 6;
  ctx.stroke();

  // Progress ring
  const startAngle = -Math.PI / 2;
  const sweepAngle = 2 * Math.PI * (isOverdue ? 1 : Math.max(0.02, 1 - progress));
  const endAngle = startAngle + sweepAngle;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, startAngle, endAngle);
  ctx.strokeStyle = mainColor;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();

  // Inner circle
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius - 9, 0, 2 * Math.PI);
  ctx.fillStyle = 'var(--surface)';
  ctx.fill();
}

function countdownData(deadline, deadlineTime) {
  if (!deadline) return { str: 'Без терміну', cls: 'ok', days: 0, hours: 0, minutes: 0, seconds: 0 };
  const now = new Date();
  const end = getDeadlineEnd(deadline, deadlineTime);
  const diff = end - now;
  if (diff <= 0) return { str: 'ПРОСТРОЧЕНО', cls: 'over', days: 0, hours: 0, minutes: 0, seconds: 0 };
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  const str = days > 0 ? `${days}д ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}` : `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  let cls = 'ok';
  if (diff < 86400000) cls = 'urgent';        // < 1 день — червоний
  else if (diff < 172800000) cls = 'critical'; // 1-2 дні — червоний
  else if (diff < 345600000) cls = 'warn';     // 2-4 дні — жовтий
  return { str, cls };
}

function completeTaskByIdx(idx, wsIdOverride) {
  let targetWsId = wsIdOverride || activeWorkspaceId;
  if (targetWsId === ALL_WORKSPACE_ID) return;

  const ws = workspaces[targetWsId];
  if (!ws) return;
  const item = ws.items[idx];
  if (!item) return;

  const repeatMode = item.repeat || 'none';

  if (repeatMode !== 'none') {
    const doneItem = { ...item, done: true, completedAt: new Date().toISOString() };
    ws.items.push(doneItem);

    const d = new Date(item.deadline);
    if (repeatMode === 'weekly') d.setDate(d.getDate() + 7);
    else if (repeatMode === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (repeatMode === 'quarterly') d.setMonth(d.getMonth() + 3);

    item.deadline = d.toISOString().split('T')[0];
    setStatus("Завдання перенесено на наступний період 🔄");
  } else {
    item.done = true;
    item.completedAt = new Date().toISOString();
    setStatus("Завдання виконано ");
  }

  ws.items.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  saveWorkspaces();
  renderCards();
  renderTabBar();
  updateCalendarVisibility();
}

// ---- Render Cards ----
function renderCards() {
  const container = document.getElementById('container');
  const compContainer = document.getElementById('completed-container');
  const compSection = document.getElementById('completed-section');
  if (!container || !compContainer) return;

  const allItems = getActiveItems();
  const isAllView = activeWorkspaceId === ALL_WORKSPACE_ID;

  const activeItems = allItems.filter(i => !i.done);
  const completedItems = allItems.filter(i => i.done);

  if (!activeItems.length) {
    const wsName = isAllView ? 'жодній вкладці' : `вкладці "${getActiveWorkspace()?.name || ''}"`;
    container.innerHTML = `<div class="empty empty-state">Немає активних завдань у ${wsName}.</div>`;
  } else {
    const nowDate = new Date();
    const futureItems = activeItems.filter(i => i.deadline && new Date(i.deadline).setHours(17, 0, 0, 0) > nowDate);
    const nearestId = futureItems.length ? futureItems[0].deadline : null;

    // ---- Групування завдань по термінових секціях (для фокусу керівника) ----
    const todayStr0 = nowDate.toISOString().split('T')[0];
    const tmrDate = new Date(nowDate); tmrDate.setDate(tmrDate.getDate() + 1);
    const tomorrowStr0 = tmrDate.toISOString().split('T')[0];
    const weekEndDate = new Date(nowDate); weekEndDate.setDate(weekEndDate.getDate() + 7);

    const sectionDefs = [
      { key: 'none',     label: 'Обов’язкові до виконання', icon: '', cls: 'sec-required' },
      { key: 'overdue',  label: 'Прострочено',      icon: '🔴', cls: 'sec-overdue' },
      { key: 'today',    label: 'Сьогодні',          icon: '🟠', cls: 'sec-today' },
      { key: 'tomorrow', label: 'Завтра',            icon: '🟡', cls: 'sec-tomorrow' },
      { key: 'week',     label: 'Найближчі дні',     icon: '📆', cls: 'sec-week' },
      { key: 'later',    label: 'Пізніше',           icon: '🗓️', cls: 'sec-later' },
    ];
    const buckets = { overdue: [], today: [], tomorrow: [], week: [], later: [], none: [] };

    activeItems.forEach(item => {
      if (!item.deadline) { if (shouldShowRequiredUndated()) buckets.none.push(item); return; }
      const end = getDeadlineEnd(item.deadline, item.deadlineTime);
      if (end < nowDate) buckets.overdue.push(item);
      else if (item.deadline === todayStr0) buckets.today.push(item);
      else if (item.deadline === tomorrowStr0) buckets.tomorrow.push(item);
      else if (new Date(item.deadline) <= weekEndDate) buckets.week.push(item);
      else buckets.later.push(item);
    });

    container.innerHTML = '';
    let globalIdx = 0;
    sectionDefs.forEach(def => {
      const list = buckets[def.key];
      if (!list.length) return;

      const secWrap = document.createElement('div');
      secWrap.className = `task-section ${def.cls}`;
      secWrap.id = `section-${def.key}`;

      const header = document.createElement('div');
      header.className = 'section-header';
      header.innerHTML = `<span class="section-icon">${def.icon}</span><span class="section-title">${def.label}</span><span class="section-count">${list.length}</span>`;
      secWrap.appendChild(header);

      const grid = document.createElement('div');
      grid.className = 'items-grid';
      list.forEach(item => {
        grid.appendChild(buildTaskCard(item, globalIdx, isAllView, nearestId));
        globalIdx++;
      });
      secWrap.appendChild(grid);
      container.appendChild(secWrap);
    });

    activeItems.forEach(item => {
      const wsId = item._workspaceId || activeWorkspaceId;
      const wsIdx = item._wsIndex !== undefined ? item._wsIndex : 0;
      const viewKey = item._viewKey || String(wsIdx);
      if (item.deadline) drawTimer(`timer_${wsId}_${viewKey}`, item.deadline, item.deadlineTime);
    });
  }

  // Completed section
  if (completedItems.length > 0) {
    compSection.style.display = 'block';
    compContainer.innerHTML = '';
    const compGrid = document.createElement('div');
    compGrid.className = 'items-grid';

    completedItems.forEach(item => {
      const wsId = item._workspaceId || activeWorkspaceId;
      const wsIdx = item._wsIndex !== undefined ? item._wsIndex : 0;

      const cardDiv = document.createElement('div');
      cardDiv.className = 'card ok';
      cardDiv.style.opacity = '0.65';

      const cardBody = document.createElement('div');
      cardBody.className = 'card-body';

      const textDiv = document.createElement('div');
      textDiv.className = 'card-text';
      textDiv.style.textDecoration = 'line-through';
      textDiv.textContent = item.text;

      const metaDiv = document.createElement('div');
      metaDiv.className = 'card-meta';
      const dateSpan = document.createElement('span');
      dateSpan.className = 'card-date';
      const cDate = item.completedAt ? new Date(item.completedAt).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
      dateSpan.textContent = `${cDate}`;
      metaDiv.appendChild(dateSpan);
      if (item.assignee) {
        const assigneeSpan = document.createElement('span');
        assigneeSpan.className = 'assignee-badge';
        assigneeSpan.textContent = '👤 ' + item.assignee;
        metaDiv.appendChild(assigneeSpan);
      }

      cardBody.appendChild(textDiv);
      cardBody.appendChild(metaDiv);

      // Background: delete only
      const cardBg = document.createElement('div');
      cardBg.className = 'card-background';
      const delBtn = document.createElement('div');
      delBtn.className = 'swipe-action-btn swipe-action-delete';
      delBtn.innerHTML = '<span class="swipe-action-label">Видалити</span>';
      delBtn.title = 'Видалити';
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteTaskByIdx(wsIdx, wsId); });
      cardBg.appendChild(delBtn);

      // Foreground
      const triggerBtn = document.createElement('div');
      triggerBtn.className = 'card-swipe-trigger';
      triggerBtn.title = 'Дії';
      triggerBtn.textContent = '⋯';
      triggerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cardDiv.classList.contains('is-swiped')) {
          closeActiveSwipedCard();
        } else {
          if (activeSwipedCard && activeSwipedCard !== cardDiv) closeActiveSwipedCard();
          cardFg.style.transition = 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)';
          cardFg.style.transform = 'translateX(-192px)';
          cardDiv.classList.add('is-swiped');
          activeSwipedCard = cardDiv;
        }
      });

      const cardFg = document.createElement('div');
      cardFg.className = 'card-foreground';
      cardFg.appendChild(cardBody);
      cardFg.appendChild(triggerBtn);

      cardDiv.appendChild(cardBg);
      cardDiv.appendChild(cardFg);

      setupCardSwipe(cardDiv, cardFg);
      compGrid.appendChild(cardDiv);
    });

    compContainer.appendChild(compGrid);
  } else {
    compSection.style.display = 'none';
  }

  updateCalendarVisibility();
}

// ---- Побудова однієї картки завдання (винесено окремо для секцій) ----
function buildTaskCard(item, arrIdx, isAllView, nearestId) {
      const wsId = item._workspaceId || activeWorkspaceId;
      const wsIdx = item._wsIndex !== undefined ? item._wsIndex : arrIdx;
      const viewKey = item._viewKey || String(wsIdx);
      const { str, cls } = countdownData(item.deadline, item.deadlineTime);
      const dateObj = item.deadline ? new Date(item.deadline) : null;
      const dateStr = dateObj ? dateObj.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
      const isNearest = (item.deadline === nearestId && nearestId !== null);
      const canvasId = `timer_${wsId}_${viewKey}`;

      // Progress fraction for bar
      const progressFrac = item.deadline ? getProgressFraction(item.deadline, item.deadlineTime) : 0;
      const endD = item.deadline ? getDeadlineEnd(item.deadline, item.deadlineTime) : null;
      const isOverdue = endD ? new Date() > endD : false;

      const cardDiv = document.createElement('div');
      cardDiv.className = `card ${cls}` + (item.important ? ' card-important' : '');
      cardDiv.setAttribute('data-ws-id', wsId);
      cardDiv.setAttribute('data-idx', viewKey);
      cardDiv.setAttribute('data-base-idx', wsIdx);
      cardDiv.style.animationDelay = `${Math.min(arrIdx * 0.03, 0.4)}s`;

      // Card body — horizontal row
      const cardBody = document.createElement('div');
      cardBody.className = 'card-body';

      // Number + badges
      const numSpan = document.createElement('span');
      numSpan.className = 'card-num';
      numSpan.textContent = `#${arrIdx + 1}`;
      cardBody.appendChild(numSpan);

      if (item.repeat && item.repeat !== 'none') {
        const repMap = { weekly: 'ЩОТИЖНЯ', monthly: 'ЩОМІСЯЦЯ', quarterly: 'ЩОКВАРТАЛУ' };
        const repBadge = document.createElement('span');
        repBadge.style = 'font-size:10px; background:var(--blue-bg); color:var(--blue); border-radius:6px; padding:3px 8px; font-weight:700; white-space:nowrap; flex-shrink:0;';
        repBadge.textContent = '🔄 ' + repMap[item.repeat];
        cardBody.appendChild(repBadge);
      }

      if (item.important) {
        const impBadge = document.createElement('span');
        impBadge.className = 'badge-important';
        impBadge.textContent = '❗❗❗';
        impBadge.title = 'Важлива задача';
        impBadge.style = 'font-size:18px; color:var(--red); flex-shrink:0; animation: pulse-important 1.5s ease-in-out infinite;';
        cardBody.appendChild(impBadge);
      }

      if (isNearest) {
        const badge = document.createElement('span');
        badge.className = 'badge-nearest';
        badge.textContent = '⚡';
        badge.title = 'Найближчий дедлайн';
        cardBody.appendChild(badge);
      }

      // Text (з префіксом вкладки в режимі "Всі")
      const textDiv = document.createElement('div');
      textDiv.className = 'card-text';
      if (isAllView && item._workspaceName) {
        const wsPrefix = document.createElement('span');
        wsPrefix.className = 'task-ws-prefix';
        wsPrefix.textContent = item._workspaceName + ': ';
        textDiv.appendChild(wsPrefix);
      }
      textDiv.appendChild(document.createTextNode(item.text));

      // Meta (date + assignee)
      const metaDiv = document.createElement('div');
      metaDiv.className = 'card-meta';
      const dateSpan = document.createElement('span');
      dateSpan.className = 'card-date';
      const timeStr = item.deadlineTime ? ' ' + item.deadlineTime : '';
      dateSpan.textContent = `📅 ${dateStr}${timeStr}`;
      metaDiv.appendChild(dateSpan);
      if (item.assignee) {
        const assigneeSpan = document.createElement('span');
        assigneeSpan.className = 'assignee-badge';
        assigneeSpan.textContent = '👤 ' + item.assignee;
        metaDiv.appendChild(assigneeSpan);
      }

      // Timer section
      const timerSection = document.createElement('div');
      timerSection.className = 'timer-section';
      const canvas = document.createElement('canvas');
      canvas.id = canvasId;
      canvas.className = 'timer-canvas';
      canvas.width = 120; canvas.height = 120;
      const timerTextWrap = document.createElement('div');
      timerTextWrap.style = 'display:flex; flex-direction:column; align-items:flex-end;';
      const timerTextSpan = document.createElement('span');
      timerTextSpan.id = `txt_${wsId}_${viewKey}`;
      timerTextSpan.className = `timer-text ${cls}`;
      timerTextSpan.textContent = str;
      const timerLabel = document.createElement('span');
      timerLabel.className = 'timer-label';
      timerLabel.textContent = isOverdue ? 'ПРОСТРОЧЕНО' : 'ЗАЛИШИЛОСЬ';
      timerTextWrap.appendChild(timerTextSpan);
      timerTextWrap.appendChild(timerLabel);
      timerSection.appendChild(canvas);
      timerSection.appendChild(timerTextWrap);

      // Background action buttons (revealed on swipe)
      const cardBg = document.createElement('div');
      cardBg.className = 'card-background';

      const completeBtn = document.createElement('div');
      completeBtn.className = 'swipe-action-btn swipe-action-complete';
      completeBtn.title = 'Виконано';
      completeBtn.innerHTML = '<span class="swipe-action-label">Готово</span>';
      completeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        completeTaskByIdx(wsIdx, wsId);
      });

      const editBtn = document.createElement('div');
      editBtn.className = 'swipe-action-btn swipe-action-edit';
      editBtn.title = 'Редагувати';
      editBtn.innerHTML = '<span class="swipe-action-label">Змінити</span>';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditModal(wsIdx, wsId);
      });

      const deleteBtn = document.createElement('div');
      deleteBtn.className = 'swipe-action-btn swipe-action-delete';
      deleteBtn.title = 'Видалити';
      deleteBtn.innerHTML = '<span class="swipe-action-label">Видалити</span>';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTaskByIdx(wsIdx, wsId);
      });

      cardBg.appendChild(completeBtn);
      cardBg.appendChild(editBtn);
      cardBg.appendChild(deleteBtn);

      cardBody.appendChild(textDiv);
      cardBody.appendChild(metaDiv);
      cardBody.appendChild(timerSection);

      // Desktop trigger button (three dots) — appears on hover
      const triggerBtn = document.createElement('div');
      triggerBtn.className = 'card-swipe-trigger';
      triggerBtn.title = 'Дії';
      triggerBtn.textContent = '⋯';
      triggerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cardDiv.classList.contains('is-swiped')) {
          closeActiveSwipedCard();
        } else {
          if (activeSwipedCard && activeSwipedCard !== cardDiv) closeActiveSwipedCard();
          cardFg.style.transition = 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)';
          cardFg.style.transform = 'translateX(-192px)';
          cardDiv.classList.add('is-swiped');
          activeSwipedCard = cardDiv;
        }
      });

      const cardFg = document.createElement('div');
      cardFg.className = 'card-foreground';
      cardFg.appendChild(cardBody);
      cardFg.appendChild(triggerBtn);

      cardDiv.appendChild(cardBg);
      cardDiv.appendChild(cardFg);

      setupCardSwipe(cardDiv, cardFg);

      return cardDiv;
}

// ---- Swipe-to-Reveal Handler ----
let activeSwipedCard = null;

const SWIPE_MENU_WIDTH = 192;

function closeActiveSwipedCard() {
  if (activeSwipedCard) {
    const fg = activeSwipedCard.querySelector('.card-foreground');
    if (fg) {
      fg.style.transition = 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)';
      fg.style.transform = 'translateX(0px)';
    }
    activeSwipedCard.classList.remove('is-swiped');
    activeSwipedCard = null;
  }
}

function setupCardSwipe(cardDiv, cardFg) {
  let startX = 0;
  let startY = 0;
  let currentTranslateX = 0;
  let isHorizontal = null;
  let isDragging = false;
  const MENU_WIDTH = SWIPE_MENU_WIDTH;

  function onTouchStart(e) {
    if (e.touches.length > 1) return;

    if (activeSwipedCard && activeSwipedCard !== cardDiv) {
      closeActiveSwipedCard();
    }

    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isHorizontal = null;
    isDragging = true;

    const transformStr = cardFg.style.transform;
    const match = transformStr ? transformStr.match(/translateX\(([-0-9.]+)px\)/) : null;
    currentTranslateX = match ? parseFloat(match[1]) : (cardDiv.classList.contains('is-swiped') ? -MENU_WIDTH : 0);

    cardFg.style.transition = 'none';
  }

  function onTouchMove(e) {
    if (!isDragging) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - startX;
    const diffY = currentY - startY;

    if (isHorizontal === null) {
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 6) {
        isHorizontal = true;
      } else if (Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 6) {
        isHorizontal = false;
      }
    }

    if (isHorizontal === false) return;

    if (e.cancelable) e.preventDefault();

    let targetX = currentTranslateX + diffX;

    if (targetX > 0) {
      targetX = targetX * 0.2;
    } else if (targetX < -MENU_WIDTH) {
      const over = targetX + MENU_WIDTH;
      targetX = -MENU_WIDTH + over * 0.2;
    }

    cardFg.style.transform = `translateX(${targetX}px)`;
  }

  function onTouchEnd() {
    if (!isDragging) return;
    isDragging = false;
    cardFg.style.transition = 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)';

    const transformStr = cardFg.style.transform;
    const match = transformStr ? transformStr.match(/translateX\(([-0-9.]+)px\)/) : null;
    const currentX = match ? parseFloat(match[1]) : 0;

    if (currentX < -60) {
      cardFg.style.transform = `translateX(-${MENU_WIDTH}px)`;
      cardDiv.classList.add('is-swiped');
      activeSwipedCard = cardDiv;
    } else if (currentX < 0) {
      // snap back if not past threshold
      cardFg.style.transform = 'translateX(0px)';
      cardDiv.classList.remove('is-swiped');
      if (activeSwipedCard === cardDiv) activeSwipedCard = null;
    } else {
      cardFg.style.transform = 'translateX(0px)';
      cardDiv.classList.remove('is-swiped');
      if (activeSwipedCard === cardDiv) activeSwipedCard = null;
    }
  }

  cardFg.addEventListener('touchstart', onTouchStart, { passive: true });
  cardFg.addEventListener('touchmove', onTouchMove, { passive: false });
  cardFg.addEventListener('touchend', onTouchEnd);
  cardFg.addEventListener('touchcancel', onTouchEnd);

  cardFg.addEventListener('click', (e) => {
    if (cardDiv.classList.contains('is-swiped')) {
      e.stopPropagation();
      e.preventDefault();
      closeActiveSwipedCard();
    }
  });
}

// ---- Edit Modal ----
function openEditModal(idx, wsIdOverride) {
  editTargetIdx = idx;
  editTargetWsId = wsIdOverride || activeWorkspaceId;
  if (editTargetWsId === ALL_WORKSPACE_ID) return;

  const ws = workspaces[editTargetWsId];
  if (!ws) return;
  const item = ws.items[idx];
  if (!item) return;

  document.getElementById('edit-text').value = item.text || '';
  document.getElementById('edit-deadline').value = item.deadline || '';
  document.getElementById('edit-deadline-time').value = item.deadlineTime || '';
  document.getElementById('edit-repeat').value = item.repeat || 'none';
  document.getElementById('edit-assignee').value = item.assignee || '';
  const editImportantCb = document.getElementById('edit-important');
  if (editImportantCb) editImportantCb.checked = !!item.important;

  // Заповнюємо селект вкладок
  const wsSelect = document.getElementById('edit-workspace');
  if (wsSelect) {
    wsSelect.innerHTML = workspaceOrder.map(wid => {
      const w = workspaces[wid];
      return w ? `<option value="${wid}" ${wid === editTargetWsId ? 'selected' : ''}>${escHtml(w.name)}</option>` : '';
    }).join('');
  }

  document.getElementById('editModal').classList.add('active');
}

function closeEditModal() {
  document.getElementById('editModal').classList.remove('active');
  editTargetIdx = -1;
  editTargetWsId = null;
}

function saveEditedTask() {
  const oldWs = workspaces[editTargetWsId];
  if (!oldWs) return;
  if (editTargetIdx < 0 || editTargetIdx >= oldWs.items.length) return;

  const newText = document.getElementById('edit-text').value.trim();
  const newDeadline = document.getElementById('edit-deadline').value;
  const newDeadlineTime = document.getElementById('edit-deadline-time').value;
  const newRepeat = document.getElementById('edit-repeat').value;
  const newAssignee = document.getElementById('edit-assignee').value.trim();
  const newWsId = document.getElementById('edit-workspace')?.value || editTargetWsId;

  if (!newText) {
    alert('Текст не може бути порожнім');
    return;
  }

  // Витягуємо завдання зі старого workspace
  const [item] = oldWs.items.splice(editTargetIdx, 1);

  // Оновлюємо поля
  item.text = newText;
  item.deadline = newDeadline;
  item.deadlineTime = newDeadlineTime;
  item.repeat = newRepeat;
  item.assignee = newAssignee;
  const editImportantCb = document.getElementById('edit-important');
  if (editImportantCb) item.important = editImportantCb.checked;

  if (newAssignee) addAssigneeToDB(newAssignee);

  // Додаємо в цільовий workspace
  const targetWs = workspaces[newWsId];
  if (targetWs) {
    targetWs.items.push(item);
    targetWs.items.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  }

  saveWorkspaces();
  renderCards();
  renderTabBar();
  closeEditModal();
}

function updateTimersAndCounters() {
  const items = getActiveItems();
  if (!items.length) return;
  const activeItems = items.filter(i => !i.done);

  activeItems.forEach(item => {
    const wsId = item._workspaceId || activeWorkspaceId;
    const wsIdx = item._wsIndex !== undefined ? item._wsIndex : 0;
    const viewKey = item._viewKey || String(wsIdx);
    const { str, cls } = countdownData(item.deadline, item.deadlineTime);
    const endD = item.deadline ? getDeadlineEnd(item.deadline, item.deadlineTime) : null;
    const isOverdue = endD ? new Date() > endD : false;
    const progressFrac = item.deadline ? getProgressFraction(item.deadline, item.deadlineTime) : 0;

    const txtSpan = document.getElementById(`txt_${wsId}_${viewKey}`);
    if (txtSpan) {
      txtSpan.textContent = str;
      txtSpan.className = `timer-text ${cls}`;
    }

    const cardDiv = document.querySelector(`.card[data-ws-id="${wsId}"][data-idx="${viewKey}"]`);
    if (cardDiv) {
      cardDiv.classList.remove('ok', 'warn', 'critical', 'urgent', 'over', 'none');
      cardDiv.classList.add(cls);
      if (item.important) cardDiv.classList.add('card-important');

      // Update timer label
      const timerLabel = cardDiv.querySelector('.timer-label');
      if (timerLabel) {
        timerLabel.textContent = isOverdue ? 'ПРОСТРОЧЕНО' : 'ЗАЛИШИЛОСЬ';
        timerLabel.style.color = isOverdue ? 'var(--red)' : '';
      }
    }
    drawTimer(`timer_${wsId}_${viewKey}`, item.deadline, item.deadlineTime);
  });

  const now = new Date();
  const future = activeItems.filter(i => i.deadline && new Date(i.deadline).setHours(23, 59, 59, 999) > now);
  if (future.length) {
    const nearestDeadline = future[0].deadline;
    activeItems.forEach(item => {
      const wsId = item._workspaceId || activeWorkspaceId;
      const wsIdx = item._wsIndex !== undefined ? item._wsIndex : 0;
      const viewKey = item._viewKey || String(wsIdx);
      const isNearest = (item.deadline === nearestDeadline);
      const cardDiv = document.querySelector(`.card[data-ws-id="${wsId}"][data-idx="${viewKey}"]`);
      if (cardDiv) {
        const existingBadge = cardDiv.querySelector('.badge-nearest');
        if (isNearest && !existingBadge) {
          const header = cardDiv.querySelector('.card-header');
          if (header) {
            const badgeSpan = document.createElement('span');
            badgeSpan.className = 'badge-nearest';
            badgeSpan.textContent = '⚡ НАЙБЛИЖЧИЙ';
            header.appendChild(badgeSpan);
          }
        } else if (!isNearest && existingBadge) {
          existingBadge.remove();
        }
      }
    });
  }
}

function startTimers() {
  if (ticker) clearInterval(ticker);
  renderCards();
  ticker = setInterval(() => {
    updateTimersAndCounters();
  }, 1000);
}

// ---- Календар ----
let calYear, calMonth;

function updateCalendarVisibility() {
  const section = document.getElementById('calendar-section');
  if (!section) return;
  const items = getActiveItems();
  const activeItems = items.filter(i => !i.done);
  section.style.display = activeItems.length ? 'block' : 'none';
  if (activeItems.length) renderCalendar();
  renderStats();
  renderTopAssignees();
}

function renderStats() {
  const widget = document.getElementById('stats-widget');
  if (!widget) return;
  const items = getActiveItems();
  const active = items.filter(i => !i.done);
  const doneCount = items.filter(i => i.done).length;
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  let overdueCount = 0;
  let todayCount = 0;
  active.forEach(it => {
    if (!it.deadline) return;
    const end = getDeadlineEnd(it.deadline, it.deadlineTime);
    if (end < now) overdueCount++;
    if (it.deadline === todayStr) todayCount++;
  });
  const shown = active.length > 0 || doneCount > 0;
  widget.style.display = shown ? 'block' : 'none';
  document.getElementById('stat-active').textContent = active.length;
  document.getElementById('stat-overdue').textContent = overdueCount;
  document.getElementById('stat-today').textContent = todayCount;
  document.getElementById('stat-done').textContent = doneCount;
}

function renderTopAssignees() {
  const widget = document.getElementById('top-assignees-widget');
  const list = document.getElementById('top-assignees-list');
  if (!widget || !list) return;
  const items = getActiveItems();
  const counts = new Map();
  items.filter(i => !i.done && i.assignee).forEach(it => {
    counts.set(it.assignee, (counts.get(it.assignee) || 0) + 1);
  });
  if (counts.size === 0) {
    widget.style.display = 'none';
    list.innerHTML = '<div class="top-assignee-empty">Поки що порожньо</div>';
    return;
  }
  widget.style.display = 'block';
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxCount = sorted[0][1] || 1;
  list.innerHTML = sorted.map(([name, n]) => `
    <div class="top-assignee-item">
      <span class="top-assignee-name">👤 ${escHtml(name)}</span>
      <span class="top-assignee-bar"><span class="top-assignee-bar-fill" style="width:${Math.round(n / maxCount * 100)}%"></span></span>
      <span class="top-assignee-count">${n}</span>
    </div>
  `).join('');
}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  const title = document.getElementById('cal-title');
  if (!grid || !title) return;

  const now = new Date();
  if (calYear === undefined) { calYear = now.getFullYear(); calMonth = now.getMonth(); }

  const monthNames = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
    'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
  title.textContent = `${monthNames[calMonth]} ${calYear}`;

  const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
  let html = dayNames.map(d => `<div class="cal-dow">${d}</div>`).join('');

  const firstDay = new Date(calYear, calMonth, 1);
  let startDow = firstDay.getDay() - 1; if (startDow < 0) startDow = 6;

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrev = new Date(calYear, calMonth, 0).getDate();

  const items = getActiveItems();
  const deadlineMap = new Map();
  const urgentSet = new Set();
  const warnSet = new Set();
  const nowDate = new Date();
  items.filter(i => !i.done).forEach(item => {
    const key = item.deadline;
    deadlineMap.set(key, (deadlineMap.get(key) || 0) + 1);
    const end = getDeadlineEnd(item.deadline, item.deadlineTime);
    if (end < nowDate) urgentSet.add(key);
    else if ((end - nowDate) < 86400000) urgentSet.add(key);
    else if ((end - nowDate) < 259200000) warnSet.add(key);
  });

  const todayStr = now.toISOString().split('T')[0];

  for (let i = startDow - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    html += `<div class="cal-cell other-month">${d}</div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    let cls = 'cal-cell';
    if (dateStr === todayStr) cls += ' today';
    const count = deadlineMap.get(dateStr) || 0;
    let barHtml = '';
    if (count > 0) {
      cls += ' has-events';
      if (urgentSet.has(dateStr)) barHtml = '<span class="dot urgent"></span>';
      else if (warnSet.has(dateStr)) barHtml = '<span class="dot warn"></span>';
      else barHtml = '<span class="dot normal"></span>';
    }
    html += `<div class="${cls}" data-date="${dateStr}" onclick="showDayEvents('${dateStr}')">${d}${barHtml}</div>`;
  }

  const totalCells = startDow + daysInMonth;
  const remaining = totalCells % 7 ? 7 - (totalCells % 7) : 0;
  for (let d = 1; d <= remaining; d++) {
    html += `<div class="cal-cell other-month">${d}</div>`;
  }

  grid.innerHTML = html;

  const eventsList = document.getElementById('cal-events-list');
  if (eventsList) eventsList.classList.remove('active');
}

function jumpToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (el.classList.contains('task-section')) {
    el.classList.remove('flash');
    void el.offsetWidth; // restart animation
    el.classList.add('flash');
  }
}

function showDayEvents(dateStr) {
  const items = getActiveItems();
  const activeItems = items.filter(i => !i.done && i.deadline === dateStr);
  let listEl = document.getElementById('cal-events-list');
  if (!listEl) {
    listEl = document.createElement('div');
    listEl.id = 'cal-events-list';
    listEl.className = 'cal-events-list';
    document.getElementById('calendar-section').appendChild(listEl);
  }

  if (!activeItems.length) {
    listEl.classList.remove('active');
    return;
  }

  const dateObj = new Date(dateStr);
  const dateFormatted = dateObj.toLocaleDateString('uk-UA', { day: '2-digit', month: 'long', year: 'numeric' });
  let html = `<div style="font-size:14px; font-weight:700; margin-bottom:8px; color:var(--text);">📅 ${dateFormatted} — ${activeItems.length} подій</div>`;

  activeItems.forEach((item) => {
    const wsId = item._workspaceId || activeWorkspaceId;
    const wsIdx = item._wsIndex !== undefined ? item._wsIndex : 0;
    const viewKey = item._viewKey || String(wsIdx);
    const timeStr = item.deadlineTime || '';
    const assigneeStr = item.assignee ? ` — 👤 ${escHtml(item.assignee)}` : '';
    const wsLabel = item._workspaceName ? ` [${item._workspaceName}]` : '';
    html += `<div class="cal-event-item" onclick="scrollToTask('${wsId}', '${viewKey}')">
      <span class="cal-event-time">${timeStr || 'весь день'}</span>
      <span>${escHtml(item.text)}${wsLabel}${assigneeStr}</span>
    </div>`;
  });

  listEl.innerHTML = html;
  listEl.classList.add('active');
}

function quickAddTask() {
  const text = document.getElementById('quick-task-text').value.trim();
  const date = document.getElementById('quick-task-date').value;
  const time = document.getElementById('quick-task-time').value;
  const repeat = document.getElementById('quick-task-repeat').value;
  const assignee = document.getElementById('quick-task-assignee').value.trim();
  const important = document.getElementById('quick-task-important')?.checked || false;

  if (!text) { alert('Введіть опис завдання'); return; }
  if (!date && repeat !== 'none') { alert('Для повторюваного завдання потрібна дата старту.'); return; }

  // Визначаємо цільовий workspace (завжди з селекта)
  let targetWsId = activeWorkspaceId;
  const wsSelect = document.getElementById('add-workspace-select');
  if (wsSelect && wsSelect.value) {
    targetWsId = wsSelect.value;
  }
  if (!targetWsId || targetWsId === ALL_WORKSPACE_ID || !workspaces[targetWsId]) {
    if (workspaceOrder.length > 0) targetWsId = workspaceOrder[0];
    else { alert('Спочатку створіть вкладку'); return; }
  }

  const targetWs = workspaces[targetWsId];
  if (!targetWs) { alert('Помилка: вкладку не знайдено'); return; }

  const newItem = {
    text: text,
    deadline: date || null,
    deadlineTime: time || '',
    repeat: repeat,
    assignee: assignee,
    important: important,
    done: false,
    completedAt: null
  };

  // Перевірка на дублікат
  const dupKey = `${newItem.text}|${newItem.deadline}|${newItem.assignee}`;
  const exists = targetWs.items.some(it => `${it.text}|${it.deadline}|${it.assignee||''}` === dupKey);
  if (exists) {
    alert('Таке завдання вже існує в цій вкладці.');
    return;
  }

  targetWs.items.push(newItem);
  targetWs.items.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

  // Автододавання виконавця
  if (assignee) addAssigneeToDB(assignee);

  saveWorkspaces();

  // Очистити форму швидкого додавання
  document.getElementById('quick-task-text').value = '';
  document.getElementById('quick-task-date').value = '';
  document.getElementById('quick-task-time').value = '';
  document.getElementById('quick-task-assignee').value = '';
  const impCb = document.getElementById('quick-task-important');
  if (impCb) impCb.checked = false;

  setStatus(`Завдання додано у "${targetWs.name}"`);
  renderTabBar();
  startTimers();

  setTimeout(() => setStatus(''), 2000);
}

function scrollToTask(wsId, idx) {
  closeSettings();
  closeModal();
  closeEditModal();
  // Спершу переключаємось на потрібний workspace
  if (activeWorkspaceId === ALL_WORKSPACE_ID && wsId !== ALL_WORKSPACE_ID) {
    switchWorkspace(wsId);
  }
  const card = document.querySelector(`.card[data-ws-id="${wsId}"][data-idx="${idx}"]`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.style.boxShadow = '0 0 0 3px var(--blue)';
    setTimeout(() => { card.style.boxShadow = ''; }, 2000);
  }
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- Modals ----
function openModal() {
  // Завжди показуємо селект вибору вкладки
  const wsSelectContainer = document.getElementById('workspace-select-container');
  if (wsSelectContainer) {
    wsSelectContainer.style.display = 'block';
    const wsSelect = document.getElementById('add-workspace-select');
    if (wsSelect) {
      wsSelect.innerHTML = workspaceOrder.map(wid => {
        const ws = workspaces[wid];
        return ws ? `<option value="${wid}" ${wid === activeWorkspaceId ? 'selected' : ''}>${escHtml(ws.name)}</option>` : '';
      }).join('');
      // Якщо "Всі" — вибираємо першу доступну вкладку
      if (activeWorkspaceId === ALL_WORKSPACE_ID && workspaceOrder.length > 0) {
        wsSelect.value = workspaceOrder[0];
      }
    }
  }

  // Встановити сьогоднішню дату в календарі
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('quick-task-date').value = today;
  document.getElementById('quick-task-text').value = '';
  document.getElementById('quick-task-time').value = '';
  document.getElementById('quick-task-assignee').value = '';
  document.getElementById('quick-task-repeat').value = 'none';

  // Скинути перемикач ШІ на дефолт (вимкнено = швидке додавання)
  const aiToggle = document.getElementById('ai-mode-toggle');
  if (aiToggle) {
    aiToggle.checked = false;
    applyAiModeVisibility();
  }

  document.getElementById('addModal').classList.add('active');
  updateAddButton();
}

function applyAiModeVisibility() {
  const useAI = document.getElementById('ai-mode-toggle')?.checked;
  const aiFields = document.getElementById('ai-mode-fields');
  const quickFields = document.getElementById('quick-mode-fields');
  if (aiFields) aiFields.style.display = useAI ? 'block' : 'none';
  if (quickFields) quickFields.style.display = useAI ? 'none' : 'block';
}

function closeModal() {
  document.getElementById('addModal').classList.remove('active');
}

function openSettings() {
  renderAssigneeChips();
  document.getElementById('settingsModal').classList.add('active');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('active');
}

// ---- Edit mode (UI chrome visibility) ----
function loadEditMode() {
  return localStorage.getItem(EDIT_MODE_KEY) === 'true'; // default: OFF
}

function applyEditMode() {
  const enabled = loadEditMode();
  document.body.classList.toggle('edit-mode-off', !enabled);
  const cb = document.getElementById('edit-mode-checkbox');
  if (cb) cb.checked = enabled;
  const status = document.getElementById('edit-mode-status');
  if (status) status.innerHTML = enabled ? '✅ Редагування увімкнено' : '🔒 Редагування вимкнено — інтерфейс оптимізовано для перегляду';
}

function toggleEditMode() {
  const current = loadEditMode();
  localStorage.setItem(EDIT_MODE_KEY, current ? 'false' : 'true');
  applyEditMode();
}

function initSettingsNav() {
  const navItems = document.querySelectorAll('.settings-nav-item');
  navItems.forEach(navItem => {
    navItem.addEventListener('click', () => {
      const group = navItem.dataset.group;
      document.querySelectorAll('.settings-nav-item').forEach(n => n.classList.remove('active'));
      navItem.classList.add('active');
      document.querySelectorAll('.settings-group').forEach(g => {
        g.classList.toggle('active', g.dataset.group === group);
      });
      const panels = document.querySelector('.settings-panels');
      if (panels) panels.scrollTop = 0;
    });
  });
}

// ---- Tab Add Button ----
function addNewTab() {
  const name = prompt('Назва нової вкладки:', `Вкладка ${workspaceOrder.length + 1}`);
  if (!name || !name.trim()) return;
  const id = addWorkspace(name.trim());
  switchWorkspace(id);
  renderTabBar();
  renderEmpty();
  updateCalendarVisibility();
}

// ---- Settings Init ----
function initSettings() {
  const savedTheme = localStorage.getItem('ext_theme') || 'neutral';
  const savedWp = localStorage.getItem('ext_wp') || 'none';
  const savedSize = localStorage.getItem('ext_card_size') || 'normal';

  // Screen lock (password protect)
  updateLockStatusUI();
  const setLockBtn = document.getElementById('set-lock-password-btn');
  const removeLockBtn = document.getElementById('remove-lock-password-btn');
  const lockPassInput = document.getElementById('lock-password-new');
  if (setLockBtn && lockPassInput) {
    setLockBtn.addEventListener('click', async () => {
      const val = lockPassInput.value;
      if (!val || val.length < 4) { alert('Пароль має містити щонайменше 4 символи.'); return; }
      const hash = await sha256Hex(val);
      localStorage.setItem(LOCK_HASH_KEY, hash);
      lockPassInput.value = '';
      updateLockStatusUI();
      alert('Пароль встановлено. Захист екрана активовано.');
    });
    lockPassInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') setLockBtn.click(); });
  }
  if (removeLockBtn) {
    removeLockBtn.addEventListener('click', () => {
      if (!isLockEnabled()) { alert('Захист і так вимкнено.'); return; }
      if (!confirm('Прибрати захист паролем? Список завдань більше не буде приховуватись.')) return;
      localStorage.removeItem(LOCK_HASH_KEY);
      updateLockStatusUI();
    });
  }

  // Google Client ID
  const clientIdInput = document.getElementById('google-client-id');
  const clientIdStatus = document.getElementById('client-id-status');
  if (clientIdInput) {
    const savedClientId = getStoredClientId();
    if (savedClientId) {
      clientIdInput.value = savedClientId;
      clientIdStatus.textContent = '✓ збережено';
      clientIdStatus.style.background = 'var(--green-bg)';
      clientIdStatus.style.color = 'var(--green)';
    }
    clientIdInput.addEventListener('input', () => {
      const val = clientIdInput.value.trim();
      if (val && val.includes('.apps.googleusercontent.com')) {
        saveClientId(val);
        clientIdStatus.textContent = '✓ збережено';
        clientIdStatus.style.background = 'var(--green-bg)';
        clientIdStatus.style.color = 'var(--green)';
      } else {
        clientIdStatus.textContent = 'некоректний формат';
        clientIdStatus.style.background = 'var(--surface2)';
        clientIdStatus.style.color = 'var(--text3)';
      }
    });
  }

  applyTheme(savedTheme);
  applyWallpaper(savedWp);
  applyCardSize(savedSize);

  // Size Settings
  document.querySelectorAll('.size-btn').forEach(btn => {
    if (btn.dataset.size === savedSize) btn.classList.add('active');
    else btn.classList.remove('active');

    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const size = e.target.dataset.size;
      localStorage.setItem('ext_card_size', size);
      applyCardSize(size);
    });
  });

  // Export / Import
  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const importFile = document.getElementById('import-file');

  // Assignee DB
  const addAssigneeBtn = document.getElementById('add-assignee-btn');
  const newAssigneeInput = document.getElementById('new-assignee-input');
  if (addAssigneeBtn && newAssigneeInput) {
    addAssigneeBtn.addEventListener('click', () => {
      const name = newAssigneeInput.value.trim();
      if (!name) return;
      if (addAssigneeToDB(name)) {
        newAssigneeInput.value = '';
      } else {
        newAssigneeInput.value = '';
      }
    });
    newAssigneeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addAssigneeBtn.click();
      }
    });
  }
  renderAssigneeChips();

  if (exportBtn && importBtn && importFile) {
    exportBtn.addEventListener('click', () => {
      const dataStr = JSON.stringify({ workspaces, workspaceOrder }, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `deadline_archive_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    const exportDocBtn = document.getElementById('export-doc-btn');
    if (exportDocBtn) {
      exportDocBtn.addEventListener('click', exportToGoogleDoc);
    }

    importBtn.addEventListener('click', () => {
      importFile.click();
    });

    importFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (parsed.workspaces && parsed.workspaceOrder) {
            // Новий формат з вкладками
            workspaces = parsed.workspaces;
            workspaceOrder = parsed.workspaceOrder;
          } else if (Array.isArray(parsed)) {
            // Старий формат — масив завдань
            const id = generateWorkspaceId();
            workspaces = {};
            workspaces[id] = { id, name: 'Імпортоване', items: parsed };
            workspaceOrder = [id];
          } else {
            throw new Error('Файл має неправильний формат.');
          }
          saveWorkspaces();
          activeWorkspaceId = ALL_WORKSPACE_ID;
          const items = getActiveItems();
          if (items.length) startTimers();
          else renderEmpty();
          renderTabBar();
          syncToDriveDebounced();
          alert(`Успішно відновлено ${workspaceOrder.length} вкладок з архіву!`);
          closeSettings();
        } catch (err) {
          alert('Помилка читання файлу архіву: ' + err.message);
        }
      };
      reader.readAsText(file);
    });
  }

  // Theme Settings
  document.querySelectorAll('.theme-option').forEach(el => {
    const themeVal = el.dataset.theme;
    if (themeVal === savedTheme || (!themeVal && savedTheme === 'neutral')) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }

    el.addEventListener('click', (e) => {
      document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
      e.target.classList.add('active');
      const t = e.target.dataset.theme || 'neutral';
      localStorage.setItem('ext_theme', t);
      applyTheme(t);
    });
  });

  const customWpInput = document.getElementById('custom-wp-url');
  customWpInput.addEventListener('input', (e) => {
    const url = e.target.value.trim();
    if (url) {
      document.querySelectorAll('.wp-option').forEach(o => o.classList.remove('active'));
      localStorage.setItem('ext_wp', url);
      applyWallpaper(url);
    }
  });

  const customWpBtn = document.getElementById('custom-wp-btn');
  const customWpFile = document.getElementById('custom-wp-file');

  if (customWpBtn && customWpFile) {
    customWpBtn.addEventListener('click', () => {
      customWpFile.click();
    });

    customWpFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        try {
          localStorage.setItem('custom_wp_data', dataUrl);
          localStorage.setItem('ext_wp', 'custom_upload');
          customWpInput.value = '';
          document.querySelectorAll('.wp-option').forEach(o => o.classList.remove('active'));
          applyWallpaper('custom_upload');
        } catch (err) {
          alert("Зображення занадто велике! Виберіть файл меншого розміру (до 2-3 МБ).");
        }
      };
      reader.readAsDataURL(file);
    });
  }

  document.querySelectorAll('.wp-option').forEach(el => {
    if (el.dataset.wp === savedWp) {
      el.classList.add('active');
    } else el.classList.remove('active');

    el.addEventListener('click', (e) => {
      customWpInput.value = '';
      document.querySelectorAll('.wp-option').forEach(o => o.classList.remove('active'));
      e.target.classList.add('active');
      const w = e.target.dataset.wp;
      localStorage.setItem('ext_wp', w);
      applyWallpaper(w);
    });
  });

  if (savedWp !== 'none' && !document.querySelector(`.wp-option[data-wp="${savedWp}"]`)) {
    customWpInput.value = savedWp;
  }
}

function applyTheme(theme) {
  document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
  if (theme === 'dark') document.body.classList.add('theme-dark');
  else if (theme === 'light') document.body.classList.add('theme-light');
  else if (theme === 'ocean') document.body.classList.add('theme-ocean');
  else if (theme === 'forest') document.body.classList.add('theme-forest');
}

function applyCardSize(size) {
  document.body.className = document.body.className.replace(/size-\w+/g, '').trim();
  if (size === 'medium') document.body.classList.add('size-medium');
  else if (size === 'small') document.body.classList.add('size-small');
}

function applyWallpaper(wp) {
  if (!wp || wp === 'none') {
    document.body.style.backgroundImage = 'none';
    document.body.classList.remove('has-wallpaper');
  } else if (wp === 'custom_upload') {
    const dataUrl = localStorage.getItem('custom_wp_data');
    if (dataUrl) {
      document.body.style.backgroundImage = `url('${dataUrl}')`;
      document.body.classList.add('has-wallpaper');
    } else {
      document.body.style.backgroundImage = 'none';
      document.body.classList.remove('has-wallpaper');
    }
  } else {
    document.body.style.backgroundImage = `url('${wp}')`;
    document.body.classList.add('has-wallpaper');
  }
}

// ---- Operations Workspace ----
const APP_MODE_KEY = 'app_active_mode';
const OPS_DATA_KEY = 'ops_workspace_data';
let activeAppMode = localStorage.getItem(APP_MODE_KEY) || 'deadlines';

function getDefaultOpsData() {
  return {
    fuel: [
      { name: 'Дизельне паливо', unit: 'л', limit: 0, used: 0 },
      { name: 'Бензин', unit: 'л', limit: 0, used: 0 }
    ],
    procurement: [{ item: 'Позиції плану закупівель', status: 'чернетка', planned: 0, contracted: 0 }],
    budgets: [{ article: 'Кошторисні призначення', planned: 0, spent: 0, balance: 0 }],
    tables: []
  };
}

function loadOpsData() {
  try {
    const raw = localStorage.getItem(OPS_DATA_KEY);
    if (!raw) return getDefaultOpsData();
    return { ...getDefaultOpsData(), ...JSON.parse(raw) };
  } catch (e) {
    console.warn('Ops data reset:', e);
    return getDefaultOpsData();
  }
}

function saveOpsData(data) {
  localStorage.setItem(OPS_DATA_KEY, JSON.stringify(data));
}

function formatOpsNumber(value, suffix = '') {
  const n = Number(value) || 0;
  return n.toLocaleString('uk-UA', { maximumFractionDigits: 1 }) + suffix;
}

function getOpsTotals(data) {
  const fuelLimit = data.fuel.reduce((sum, row) => sum + (Number(row.limit) || 0), 0);
  const fuelUsed = data.fuel.reduce((sum, row) => sum + (Number(row.used) || 0), 0);
  const procurementPlan = data.procurement.reduce((sum, row) => sum + (Number(row.planned) || 0), 0);
  const procurementContracted = data.procurement.reduce((sum, row) => sum + (Number(row.contracted) || 0), 0);
  const budgetPlan = data.budgets.reduce((sum, row) => sum + (Number(row.planned) || 0), 0);
  const budgetSpent = data.budgets.reduce((sum, row) => sum + (Number(row.spent) || 0), 0);
  return { fuelLimit, fuelUsed, fuelLeft: Math.max(fuelLimit - fuelUsed, 0), procurementPlan, procurementContracted, budgetPlan, budgetSpent, budgetLeft: Math.max(budgetPlan - budgetSpent, 0) };
}

function setAppMode(mode) {
  if (mode === 'ops') activeAppMode = 'ops';
  else if (mode === 'shtat') activeAppMode = 'shtat';
  else activeAppMode = 'deadlines';
  localStorage.setItem(APP_MODE_KEY, activeAppMode);

  document.body.classList.remove('ops-mode', 'shtat-mode');
  if (activeAppMode === 'ops') document.body.classList.add('ops-mode');
  if (activeAppMode === 'shtat') document.body.classList.add('shtat-mode');

  document.querySelectorAll('.app-mode-btn').forEach(btn => {
    const isActive = btn.dataset.mode === activeAppMode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  // Show/hide sections
  const dashLayout = document.querySelector('.dash-layout');
  const opsWorkspace = document.getElementById('ops-workspace');
  const shtatWorkspace = document.getElementById('shtat-workspace');
  const tabBar = document.getElementById('tab-bar');
  const fabContainer = document.querySelector('.fab-container');

  if (dashLayout) dashLayout.style.display = activeAppMode === 'deadlines' ? '' : 'none';
  if (opsWorkspace) opsWorkspace.style.display = (activeAppMode === 'deadlines' || activeAppMode === 'ops') ? '' : 'none';
  if (shtatWorkspace) shtatWorkspace.style.display = activeAppMode === 'shtat' ? '' : 'none';
  if (tabBar) tabBar.style.display = activeAppMode === 'shtat' ? 'none' : '';

  // FAB: always show settings + lock, hide add-btn in shtat/ops mode
  if (fabContainer) fabContainer.style.display = '';
  const fabAdd = document.getElementById('add-btn');
  const fabLock = document.getElementById('lock-now-btn');
  if (fabAdd) fabAdd.style.display = activeAppMode === 'deadlines' ? '' : 'none';
  if (fabLock) fabLock.style.display = isLockEnabled() ? 'flex' : 'none';

  if (activeAppMode === 'ops') renderOpsWorkspace();
  else if (activeAppMode === 'shtat') initShtatMode();
  else updateAddButton();
}

function renderOpsWorkspace() {
  const root = document.getElementById('ops-workspace');
  if (!root) return;
  const data = loadOpsData();
  const totals = getOpsTotals(data);
  const fuelPct = totals.fuelLimit ? Math.min(100, Math.round(totals.fuelUsed / totals.fuelLimit * 100)) : 0;
  const procurementPct = totals.procurementPlan ? Math.min(100, Math.round(totals.procurementContracted / totals.procurementPlan * 100)) : 0;
  const budgetPct = totals.budgetPlan ? Math.min(100, Math.round(totals.budgetSpent / totals.budgetPlan * 100)) : 0;

  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setText('ops-nav-fuel', data.fuel.length);
  setText('ops-nav-procurement', data.procurement.length);
  setText('ops-nav-budgets', data.budgets.length);

  const ledger = document.getElementById('ops-ledger');
  if (ledger) {
    ledger.innerHTML = `
      <div class="ops-ledger-cell"><div class="ops-ledger-label">Паливо використано</div><div class="ops-ledger-value">${formatOpsNumber(totals.fuelUsed, ' л')}</div><div class="ops-ledger-note">залишок ${formatOpsNumber(totals.fuelLeft, ' л')}</div></div>
      <div class="ops-ledger-cell"><div class="ops-ledger-label">Закупівлі в плані</div><div class="ops-ledger-value">${formatOpsNumber(totals.procurementPlan, ' грн')}</div><div class="ops-ledger-note">законтрактовано ${formatOpsNumber(totals.procurementContracted, ' грн')}</div></div>
      <div class="ops-ledger-cell"><div class="ops-ledger-label">Кошторис</div><div class="ops-ledger-value">${formatOpsNumber(totals.budgetPlan, ' грн')}</div><div class="ops-ledger-note">використано ${formatOpsNumber(totals.budgetSpent, ' грн')}</div></div>
      <div class="ops-ledger-cell"><div class="ops-ledger-label">Інтегровані таблиці</div><div class="ops-ledger-value">${data.tables.length}</div><div class="ops-ledger-note">джерела даних буде додано окремо</div></div>
    `;
  }

  const summary = document.getElementById('ops-summary-lines');
  if (summary) {
    summary.innerHTML = `
      <div class="ops-progress-line"><div class="ops-progress-track"><div class="ops-progress-fill" style="--value:${fuelPct}%"></div></div><div class="ops-progress-value">${fuelPct}% паливо</div></div>
      <div class="ops-progress-line"><div class="ops-progress-track"><div class="ops-progress-fill" style="--value:${procurementPct}%"></div></div><div class="ops-progress-value">${procurementPct}% закупівлі</div></div>
      <div class="ops-progress-line"><div class="ops-progress-track"><div class="ops-progress-fill" style="--value:${budgetPct}%"></div></div><div class="ops-progress-value">${budgetPct}% кошторис</div></div>
    `;
  }

  renderOpsFuelModule(data.fuel);
  renderOpsProcurementModule(data.procurement);
  renderOpsBudgetModule(data.budgets);
}

function renderOpsFuelModule(rows) {
  const el = document.getElementById('ops-module-fuel');
  if (!el) return;
  const body = rows.map(row => {
    const left = Math.max((Number(row.limit) || 0) - (Number(row.used) || 0), 0);
    return `<tr><td>${escHtml(row.name)}</td><td class="num">${formatOpsNumber(row.limit, ' ' + row.unit)}</td><td class="num">${formatOpsNumber(row.used, ' ' + row.unit)}</td><td class="num">${formatOpsNumber(left, ' ' + row.unit)}</td></tr>`;
  }).join('');
  el.innerHTML = `<div class="ops-module-head"><div><div class="ops-module-title">Паливо</div><div class="ops-module-meta">ліміти, використання, залишки</div></div><span class="ops-status-pill">облік</span></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Тип</th><th class="num">Ліміт</th><th class="num">Використано</th><th class="num">Залишок</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderOpsProcurementModule(rows) {
  const el = document.getElementById('ops-module-procurement');
  if (!el) return;
  const body = rows.map(row => `<tr><td>${escHtml(row.item)}</td><td>${escHtml(row.status)}</td><td class="num">${formatOpsNumber(row.planned, ' грн')}</td><td class="num">${formatOpsNumber(row.contracted, ' грн')}</td></tr>`).join('');
  el.innerHTML = `<div class="ops-module-head"><div><div class="ops-module-title">Плани закупівель</div><div class="ops-module-meta">позиції, очікувана вартість, договори</div></div><span class="ops-status-pill">план</span></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Позиція</th><th>Статус</th><th class="num">План</th><th class="num">Договір</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderOpsBudgetModule(rows) {
  const el = document.getElementById('ops-module-budgets');
  if (!el) return;
  const body = rows.map(row => {
    const balance = Number(row.balance) || Math.max((Number(row.planned) || 0) - (Number(row.spent) || 0), 0);
    return `<tr><td>${escHtml(row.article)}</td><td class="num">${formatOpsNumber(row.planned, ' грн')}</td><td class="num">${formatOpsNumber(row.spent, ' грн')}</td><td class="num">${formatOpsNumber(balance, ' грн')}</td></tr>`;
  }).join('');
  el.innerHTML = `<div class="ops-module-head"><div><div class="ops-module-title">Кошториси</div><div class="ops-module-meta">призначення, використання, залишок</div></div><span class="ops-status-pill">фінанси</span></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Стаття</th><th class="num">План</th><th class="num">Використано</th><th class="num">Залишок</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function initOpsWorkspace() {
  document.querySelectorAll('.app-mode-btn').forEach(btn => btn.addEventListener('click', () => setAppMode(btn.dataset.mode)));
  document.querySelectorAll('.ops-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ops-nav-item').forEach(item => item.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(`ops-module-${btn.dataset.opsTarget}`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  const addRowBtn = document.getElementById('ops-add-row-btn');
  if (addRowBtn) addRowBtn.addEventListener('click', () => alert('Наступним кроком додамо форму запису для вибраного реєстру.'));
  const importBtn = document.getElementById('ops-import-btn');
  if (importBtn) importBtn.addEventListener('click', () => alert('Імпорт таблиць зробимо окремим кроком: CSV/XLSX або вставка з буфера.'));
  setAppMode(activeAppMode);
  saveOpsData(loadOpsData());
}

// ===== Штат Dashboard =====
const SHTAT_IMPORTED_KEY = 'shtat_imported_data';

function loadImportedStaff() {
  try { return JSON.parse(localStorage.getItem(SHTAT_IMPORTED_KEY)) || { units: [], totalPositions: 0 }; }
  catch(e) { return { units: [], totalPositions: 0 }; }
}
function saveImportedStaff(data) { localStorage.setItem(SHTAT_IMPORTED_KEY, JSON.stringify(data)); }

// ---- Імпорт з Google Таблиці (викликається ТІЛЬКИ з налаштувань) ----
function importStaffFromSheets() {
  const urlInput = document.getElementById('sheets-url');
  const statusEl = document.getElementById('sheets-status');
  const previewEl = document.getElementById('sheets-preview');
  const btn = document.getElementById('sheets-import-btn');
  if (!urlInput || !statusEl) return;

  const url = urlInput.value.trim();
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) { statusEl.textContent = '❌ Невірне посилання'; statusEl.style.color = 'var(--red)'; return; }

  const gidMatch = url.match(/gid=(\d+)/);
  const csvUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq?tqx=out:csv&gid=${gidMatch ? gidMatch[1] : '0'}`;

  statusEl.textContent = '⏳ Завантаження...'; statusEl.style.color = 'var(--blue)'; btn.disabled = true;

  fetch(csvUrl).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
  .then(csv => {
    const data = parseStaffCSV(csv);
    if (data.units.length === 0) throw new Error('Не знайдено підрозділів');
    saveImportedStaff(data);

    let html = `<strong>✅ Знайдено ${data.units.length} підрозділів, ${data.totalPositions} посад</strong><br><br>`;
    data.units.forEach(u => {
      const pct = u.total > 0 ? Math.round(u.filled / u.total * 100) : 0;
      html += `• <strong>${escHtml(u.name)}</strong> — ${u.filled}/${u.total} (${pct}%)<br>`;
    });
    if (previewEl) { previewEl.innerHTML = html; previewEl.style.display = 'block'; }

    statusEl.textContent = `✅ Імпортовано ${data.units.length} підрозділів!`;
    statusEl.style.color = 'var(--green)'; statusEl.style.background = 'var(--green-bg)';
    btn.disabled = false;
    renderShtatDashboard();
  })
  .catch(err => {
    statusEl.textContent = '❌ ' + err.message; statusEl.style.color = 'var(--red)'; btn.disabled = false;
    if (previewEl) previewEl.style.display = 'none';
  });
}

// ---- Парсер CSV з Google Таблиці ----
function parseStaffCSV(csvText) {
  const rows = csvText.split(/\r?\n/);
  const dataRows = rows.map(row => {
    const cols = []; let cur = '', q = false;
    for (const ch of row) { if (ch === '"') q = !q; else if (ch === ',' && !q) { cols.push(cur.trim()); cur = ''; } else cur += ch; }
    cols.push(cur.trim()); return cols;
  });

  const units = [];

  function clean(s) { return (s||'').replace(/^["']|["']$/g,'').replace(/^[-–•\s]+|[-–•\s]+$/g,'').trim().replace(/\s+/g,' '); }
  function isVacant(name) { return !name || /^[-–—\s]*$/.test(name) || /vacant|вакант|вакансія|- В -|^-$|^–$/i.test(name); }
  function isSummaryRow(s) { return /по штату|authorized|всього/i.test(s); }
  function looksLikeStationName(s) { return /дпрч|дпрп|державний|пожежно|загін|дснс/i.test(s); }

  // ── Фаза 1: Headquarters (рядки де col C = назва загону, немає даних у col D/E) ──
  let hqUnit = null, hqSub = null;
  let i = 0;

  // Шукаємо заголовок апарату управління (рядок з "№ п/п" і назвою загону в col C)
  for (; i < dataRows.length; i++) {
    const c0 = clean(dataRows[i][0]), c1 = clean(dataRows[i][1]), c2 = clean(dataRows[i][2]), c3 = clean(dataRows[i][3]), c4 = clean(dataRows[i][4]);
    if (c0.includes('№') && c1.toLowerCase().includes('посада') && looksLikeStationName(c2) && !c3) {
      hqUnit = { name: c2, positions: [], subunits: {} };
      i++; break;
    }
  }

  // Парсимо апарат управління
  for (; i < dataRows.length; i++) {
    const num = clean(dataRows[i][0]), posRaw = clean(dataRows[i][1]), person = clean(dataRows[i][2]), c3 = clean(dataRows[i][3]);
    if (!num && !posRaw && !person) {
      if (c3) break; // новий блок (станції)
      continue;
    }
    if (isSummaryRow(posRaw + ' ' + person)) { i++; break; } // кінець апарату
    if (!hqUnit) continue;

    if (!num && posRaw && !person && posRaw.length < 60 && !isSummaryRow(posRaw)) {
      hqSub = posRaw;
      if (!hqUnit.subunits[hqSub]) hqUnit.subunits[hqSub] = [];
      continue;
    }
    if (num && /^\d/.test(num) && posRaw) {
      const filled = !isVacant(person);
      const entry = { position: posRaw, name: person, filled };
      hqUnit.positions.push(entry);
      if (hqSub && hqUnit.subunits[hqSub]) hqUnit.subunits[hqSub].push(entry);
    }
  }
  if (hqUnit && hqUnit.positions.length > 0) units.push(hqUnit);

  // ── Фаза 2: Станції (ДПРЧ/ДПРП) в блоках по 3 колонки ──
  while (i < dataRows.length) {
    // Шукаємо заголовок блоку станцій (рядок з назвами станцій у cols C/D/E)
    let stations = [];
    for (; i < dataRows.length; i++) {
      const c0 = clean(dataRows[i][0]), c1 = clean(dataRows[i][1]), c2 = clean(dataRows[i][2]), c3 = clean(dataRows[i][3]), c4 = clean(dataRows[i][4]);
      if (!c2 && !c3 && !c4) continue;
      if (looksLikeStationName(c2) || looksLikeStationName(c3) || looksLikeStationName(c4)) {
        [c2, c3, c4].forEach(name => {
          const n = name.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
          if (n && looksLikeStationName(n)) stations.push({ name: n, positions: [], subunits: {} });
        });
        if (stations.length > 0) { i++; break; }
      }
    }
    if (!stations.length) break;

    // Парсимо позиції для цих станцій
    let lastPosition = '';
    for (; i < dataRows.length; i++) {
      const num = clean(dataRows[i][0]), posRaw = clean(dataRows[i][1]);
      const c2 = clean(dataRows[i][2]), c3 = clean(dataRows[i][3]), c4 = clean(dataRows[i][4]);

      if (isSummaryRow(c2 + ' ' + c3 + ' ' + c4)) { i++; break; }
      if (!num && !posRaw && !c2 && !c3 && !c4) continue;

      const position = posRaw || lastPosition;
      if (position) lastPosition = position;
      else continue;

      [c2, c3, c4].forEach((person, si) => {
        if (si >= stations.length) return;
        if (person === '-' || person === '- В -' || person === '') person = '';
        const filled = !isVacant(person);
        const entry = { position, name: person, filled };
        stations[si].positions.push(entry);
      });
    }

    stations.forEach(s => { if (s.positions.length > 0) units.push(s); });
  }

  // Порахувати totals
  let totalPositions = 0;
  units.forEach(u => {
    u.total = u.positions.length;
    u.filled = u.positions.filter(p => p.filled).length;
    totalPositions += u.total;
  });

  return { units, totalPositions };
}

// ---- Рендер дашборду Штату ----
function renderShtatDashboard() {
  const container = document.getElementById('shtat-dashboard');
  if (!container) return;

  const data = loadImportedStaff();

  if (!data.units.length) {
    container.innerHTML = `
      <div class="shtat-empty">
        <div class="shtat-empty-icon">📊</div>
        <div class="shtat-empty-title">Немає даних штатного розпису</div>
        <div class="shtat-empty-sub">
          Імпортуйте дані через <code>Налаштування → 📊 Google Таблиці</code><br>
          Вставте посилання на Google Таблицю зі штатним розписом
        </div>
      </div>`;
    return;
  }

  const grandTotal = data.totalPositions;
  const grandFilled = data.units.reduce((s, u) => s + u.filled, 0);
  const grandVacant = grandTotal - grandFilled;
  const overallPct = grandTotal > 0 ? Math.round(grandFilled / grandTotal * 100) : 0;

  // Колір за % заповнення
  function pctColor(pct) {
    if (pct >= 90) return 'var(--green)';
    if (pct >= 70) return 'var(--amber)';
    return 'var(--red)';
  }

  let html = '';

  // ── Summary Cards ──
  html += `<div class="shtat-summary-cards">
    <div class="shtat-stat total"><div class="shtat-stat-label">Всього посад</div><div class="shtat-stat-value">${grandTotal}</div><div class="shtat-stat-sub">за штатним розписом</div></div>
    <div class="shtat-stat filled"><div class="shtat-stat-label">Укомплектовано</div><div class="shtat-stat-value">${grandFilled}</div><div class="shtat-stat-sub">особового складу</div></div>
    <div class="shtat-stat vacant"><div class="shtat-stat-label">Некомплект</div><div class="shtat-stat-value">${grandVacant}</div><div class="shtat-stat-sub">вакантних посад</div></div>
    <div class="shtat-stat pct"><div class="shtat-stat-label">Укомплектованість</div><div class="shtat-stat-value">${overallPct}%</div><div class="shtat-stat-sub">від штатної чисельності</div></div>
  </div>`;

  // ── Overall Progress Bar ──
  const barColor = pctColor(overallPct);
  html += `<div class="shtat-overall-bar-wrap">
    <div class="shtat-overall-label">
      <span class="shtat-overall-title">Загальна укомплектованість</span>
      <span class="shtat-overall-pct" style="color:${barColor}">${grandFilled} з ${grandTotal}</span>
    </div>
    <div class="shtat-overall-track"><div class="shtat-overall-fill" style="width:${overallPct}%;background:${barColor};"></div></div>
  </div>`;

  // ── Units List ──
  html += `<div class="shtat-units-list">`;
  data.units.forEach((u, i) => {
    const pct = u.total > 0 ? Math.round(u.filled / u.total * 100) : 0;
    const color = pctColor(pct);
    const shortage = u.total - u.filled;

    html += `<div class="shtat-unit-card" id="shtat-unit-${i}">
      <div class="shtat-unit-header" onclick="toggleShtatUnit(${i})">
        <div class="shtat-unit-name">
          <span class="shtat-unit-chevron">▶</span> ${escHtml(u.name)}
        </div>
        <div class="shtat-unit-bar-wrap"><div class="shtat-unit-bar-fill" style="width:${pct}%;background:${color};"></div></div>
        <div class="shtat-unit-count" style="color:${color}">${u.filled}/${u.total}</div>
      </div>
      <div class="shtat-unit-detail">`;

    // Позиції згруповані за підсекціями
    if (u.subunits && Object.keys(u.subunits).length > 0) {
      Object.entries(u.subunits).forEach(([subName, positions]) => {
        if (!positions || !positions.length) return;
        html += `<div class="shtat-unit-subsection">
          <div class="shtat-subsection-title">${escHtml(subName)}</div>`;
        positions.forEach(p => {
          html += `<div class="shtat-position-row">
            <span class="shtat-position-name">${escHtml(p.position)}</span>
            <span class="shtat-position-status ${p.filled ? 'filled' : 'vacant'}">${p.filled ? '✓' : 'Вакант'}</span>
            <span class="shtat-position-person">${p.filled ? escHtml(p.name) : '—'}</span>
          </div>`;
        });
        html += `</div>`;
      });
    } else {
      // Без підсекцій — просто список позицій
      html += `<div class="shtat-unit-subsection">`;
      u.positions.forEach(p => {
        html += `<div class="shtat-position-row">
          <span class="shtat-position-name">${escHtml(p.position)}</span>
          <span class="shtat-position-status ${p.filled ? 'filled' : 'vacant'}">${p.filled ? '✓' : 'Вакант'}</span>
          <span class="shtat-position-person">${p.filled ? escHtml(p.name) : '—'}</span>
        </div>`;
      });
      html += `</div>`;
    }

    html += `</div></div>`;
  });
  html += `</div>`;

  container.innerHTML = html;
}

function toggleShtatUnit(idx) {
  const card = document.getElementById('shtat-unit-' + idx);
  if (card) card.classList.toggle('open');
}

// ---- Ініціалізація при переході в режим Штату ----
function initShtatMode() {
  renderShtatDashboard();
}

// ---- Init ----
// ---- Голосове введення (безкоштовний Web Speech API, без ключів і лімітів) ----
// Підтримка: Chrome/Edge (десктоп + Android, у т.ч. Telegram Android WebView).
// НЕ підтримується: Safari/iOS та Telegram iOS WebView — кнопки мікрофону
// на таких пристроях автоматично приховуються, решта функціоналу не страждає.
function initVoiceInput() {
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micButtons = document.querySelectorAll('.mic-btn');

  if (!SpeechRecognitionAPI) {
    micButtons.forEach((btn) => btn.classList.add('is-unsupported'));
    return;
  }

  // Створення єдиного екземпляру для запобігання повторним запитам дозволу в Telegram WebApp
  let recognition = new SpeechRecognitionAPI();
  recognition.lang = 'uk-UA';
  recognition.continuous = true;
  recognition.interimResults = true;

  let activeBtn = null;
  let activeField = null;
  let initialFieldValue = '';
  let isRecording = false;

  function stopRecording() {
    if (isRecording && recognition) {
      try { recognition.stop(); } catch (e) { /* ignore */ }
    }
    isRecording = false;
    if (activeBtn) activeBtn.classList.remove('is-recording');
    activeBtn = null;
    activeField = null;
  }

  recognition.onresult = (event) => {
    if (!activeField) return;

    const finalParts = [];
    let interimText = '';

    for (let i = 0; i < event.results.length; i++) {
      const res = event.results[i];
      const txt = res[0].transcript.trim();
      if (res.isFinal) {
        // Дедуплікація повторюваних однакових фразових сегментів
        if (txt && (finalParts.length === 0 || finalParts[finalParts.length - 1] !== txt)) {
          finalParts.push(txt);
        }
      } else {
        // Беремо тільки найновіший проміжний результат
        if (i === event.results.length - 1) {
          interimText = txt;
        }
      }
    }

    const sessionFinal = finalParts.join(' ');
    let fullText = initialFieldValue;
    if (sessionFinal) fullText += sessionFinal + ' ';
    if (interimText) fullText += interimText;

    activeField.value = fullText.trim();
    activeField.dispatchEvent(new Event('input', { bubbles: true }));
  };

  recognition.onerror = (event) => {
    console.warn('[VoiceInput] Помилка розпізнавання:', event.error);
    if (event.error !== 'no-speech') {
      stopRecording();
    }
  };

  recognition.onend = () => {
    if (isRecording && activeBtn) {
      try {
        recognition.start();
      } catch (e) {
        stopRecording();
      }
    } else {
      stopRecording();
    }
  };

  micButtons.forEach((btn) => {
    const targetId = btn.dataset.target;
    const field = document.getElementById(targetId);
    if (!field) { btn.classList.add('is-unsupported'); return; }

    btn.addEventListener('click', () => {
      // Повторний клік по активній кнопці — зупинити запис
      if (activeBtn === btn && isRecording) {
        stopRecording();
        return;
      }

      // Зупинити попередній запис
      stopRecording();

      activeBtn = btn;
      activeField = field;
      initialFieldValue = field.value ? (field.value.trim() + ' ') : '';
      isRecording = true;
      btn.classList.add('is-recording');

      try {
        recognition.start();
      } catch (e) {
        console.warn('[VoiceInput] Помилка старту:', e);
        stopRecording();
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('[App] DOMContentLoaded, starting init...');

  // Close any open swipe menu when tapping outside a card
  document.addEventListener('click', (e) => {
    if (activeSwipedCard && !e.target.closest('.card')) {
      closeActiveSwipedCard();
    }
  }, { capture: true });
  document.addEventListener('touchstart', (e) => {
    if (activeSwipedCard && !e.target.closest('.card')) {
      closeActiveSwipedCard();
    }
  }, { passive: true });

  // Core listeners (з null-захистом)
  const $ = (id) => document.getElementById(id);
  const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };
  on('add-btn', 'click', openModal);
  on('api-key', 'input', saveApiKey);
  on('clear-storage-btn', 'click', clearStorage);
  on('clear-tasks-btn', 'click', clearTasks);
  const clearAllBtn = $('clear-all-btn');
  if (clearAllBtn) clearAllBtn.addEventListener('click', clearAllData);
  on('modal-close-btn', 'click', closeModal);
  on('settings-btn', 'click', openSettings);
  on('settings-close-btn', 'click', closeSettings);
  on('btn-parse', 'click', parseWithGemini);
  on('edit-modal-close-btn', 'click', closeEditModal);
  on('btn-save-edit', 'click', saveEditedTask);
  on('tab-add-btn', 'click', addNewTab);
  const requiredToggleBtn = document.getElementById('required-toggle-btn');
  if (requiredToggleBtn) requiredToggleBtn.addEventListener('click', () => setRequiredUndatedVisible(!shouldShowRequiredUndated()));
  updateRequiredToggleUI();

  // AI mode toggle (Add modal)
  const aiToggleEl = document.getElementById('ai-mode-toggle');
  if (aiToggleEl) aiToggleEl.addEventListener('change', applyAiModeVisibility);

  initSettings();
  initSettingsNav();
  initOpsWorkspace();
  initVoiceInput();
  populateDatalist();
  loadFromLocal();

  try { initTopSites(); } catch (e) { console.warn('TopSites unavailable:', e); }

  // Top-site editor modal
  const siteEditCloseBtn = document.getElementById('site-edit-close-btn');
  if (siteEditCloseBtn) siteEditCloseBtn.addEventListener('click', closeTopSiteEditor);
  const btnSaveSite = document.getElementById('btn-save-site');
  if (btnSaveSite) btnSaveSite.addEventListener('click', saveTopSiteFromModal);
  const siteEditDeleteLink = document.getElementById('site-edit-delete-link');
  if (siteEditDeleteLink) {
    siteEditDeleteLink.addEventListener('click', () => {
      if (editingSiteId) {
        const id = editingSiteId;
        closeTopSiteEditor();
        removeTopSite(id);
      }
    });
  }
  const siteEditUrlInput = document.getElementById('site-edit-url');
  if (siteEditUrlInput) {
    siteEditUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveTopSiteFromModal(); }
    });
  }
  const siteEditTitleInput = document.getElementById('site-edit-title');
  if (siteEditTitleInput) {
    siteEditTitleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveTopSiteFromModal(); }
    });
  }
  handleRedirectAuth();
  initAuth();

  // ===== Telegram WebApp Integration =====
  if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();

    // Adapt to Telegram theme
    if (tg.colorScheme === 'dark') {
      document.body.classList.add('theme-dark');
    }
    tg.onEvent('themeChanged', () => {
      if (tg.colorScheme === 'dark') {
        document.body.classList.add('theme-dark');
      } else {
        document.body.classList.remove('theme-dark', 'theme-light', 'theme-ocean', 'theme-forest');
      }
    });

    // Show share button
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) shareBtn.style.display = '';
  }

  // ===== Share Functionality =====
  window.shareActiveTasks = function() {
    const items = getActiveItems().filter(i => !i.done);
    let text = '';
    if (items.length === 0) {
      text = 'Немає активних завдань';
    } else {
      text = '📋 *Контроль дедлайнів*\n\n';
      // Group by workspace
      const byWs = {};
      items.forEach(it => {
        const wsName = it._workspaceName || 'Завдання';
        if (!byWs[wsName]) byWs[wsName] = [];
        byWs[wsName].push(it);
      });
      Object.entries(byWs).forEach(([wsName, wsItems]) => {
        if (Object.keys(byWs).length > 1) text += `*${wsName}:*\n`;
        wsItems.forEach((it, i) => {
          const dateStr = it.deadline ? ' — ' + new Date(it.deadline).toLocaleDateString('uk-UA') : '';
          const timeStr = it.deadlineTime ? ' ' + it.deadlineTime : '';
          text += `${i + 1}. ${it.text}${dateStr}${timeStr}\n`;
        });
        text += '\n';
      });
    }

    const url = window.location.href;
    const shareTitle = 'Контроль дедлайнів';

    if (navigator.share) {
      navigator.share({ title: shareTitle, text: text, url: url }).catch(() => {
        // User cancelled — no big deal
      });
    } else {
      // Fallback: копіюємо в буфер
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          alert('📋 Список завдань скопійовано в буфер обміну!');
        }).catch(() => {
          alert('⚠️ Не вдалося скопіювати. Спробуйте виділити текст вручну.');
        });
      } else {
        // WhatsApp fallback URL
        const waText = encodeURIComponent(text);
        const waUrl = 'https://wa.me/?text=' + waText;
        window.open(waUrl, '_blank');
      }
    }
  };

  const shareBtnEl = document.getElementById('share-btn');
  if (shareBtnEl) shareBtnEl.addEventListener('click', shareActiveTasks);

  // ===== Install / Add to Home Screen =====
  (function initInstallPrompt() {
    const INSTALL_DISMISSED_KEY = 'install_banner_dismissed';
    const banner = document.getElementById('install-banner');
    const bannerTitle = document.getElementById('install-banner-title');
    const bannerSub = document.getElementById('install-banner-sub');
    const bannerBtn = document.getElementById('install-banner-btn');
    const bannerClose = document.getElementById('install-banner-close');
    if (!banner) return;

    let deferredPrompt = null;

    // 1. Відловлюємо beforeinstallprompt (Android Chrome / Samsung / Edge)
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      // Показуємо банер тільки якщо його ще не закривали
      if (localStorage.getItem(INSTALL_DISMISSED_KEY)) return;
      showInstallBanner('android');
    });

    // 2. Відловлюємо успішну установку
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      hideBanner();
      console.log('[PWA] App installed successfully');
    });

    // 3. Визначаємо платформу і показуємо банер
    function detectPlatform() {
      const ua = navigator.userAgent || '';
      const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isAndroid = /Android/.test(ua);
      const isTelegram = /Telegram/i.test(ua) || (window.Telegram && window.Telegram.WebApp);
      return { isIOS, isAndroid, isTelegram };
    }

    function showInstallBanner(trigger) {
      const { isIOS, isAndroid, isTelegram } = detectPlatform();

      // Якщо вже показували і закрили — не турбуємо
      if (localStorage.getItem(INSTALL_DISMISSED_KEY)) return;

      if (isTelegram) {
        // У Telegram: iOS-style інструкція для обох платформ
        if (isIOS) {
          bannerTitle.textContent = 'На головний екран iPhone';
          bannerSub.textContent = 'Натисніть ⋯ → «На екрані “Дім”» або поділіться через Share';
        } else {
          bannerTitle.textContent = 'На головний екран';
          bannerSub.textContent = 'Натисніть ⋮ → «Додати на головний екран» для швидкого доступу';
        }
        bannerBtn.textContent = 'Як це зробити?';
        bannerBtn.onclick = () => {
          if (isIOS) {
            alert('📱 Як додати на головний екран iPhone:\n\n1. Натисніть кнопку «Поділитися» (квадрат зі стрілкою) внизу екрана\n2. Гортайте вниз і виберіть «На екрані “Дім”»\n3. Натисніть «Додати»\n\nПісля цього іконка зʼявиться на головному екрані!');
          } else {
            alert('📱 Як додати на головний екран Android:\n\n1. Натисніть ⋮ (три крапки) вгорі справа\n2. Виберіть «Додати на головний екран»\n3. Натисніть «Додати»\n\nПісля цього іконка зʼявиться на головному екрані!');
          }
        };
        banner.style.display = 'flex';
      } else if (trigger === 'android' && deferredPrompt) {
        // Android Chrome: стандартний PWA install prompt
        bannerTitle.textContent = 'Встановити додаток';
        bannerSub.textContent = 'Швидкий доступ до дедлайнів без браузера';
        bannerBtn.textContent = 'Встановити';
        bannerBtn.onclick = async () => {
          try {
            await deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log('[PWA] User choice:', outcome);
            deferredPrompt = null;
            if (outcome === 'accepted') {
              hideBanner();
            }
          } catch (e) {
            console.warn('[PWA] Install prompt failed:', e);
          }
        };
        banner.style.display = 'flex';
      } else if (isIOS && !isTelegram) {
        // iOS Safari: показуємо інструкцію
        bannerTitle.textContent = 'Додайте на головний екран';
        bannerSub.textContent = 'Натисніть кнопку «Поділитися» → «На екрані “Дім”»';
        bannerBtn.textContent = 'Детальніше';
        bannerBtn.onclick = () => {
          alert('📱 Як додати на головний екран iPhone:\n\n1. Натисніть кнопку «Поділитися» (квадрат зі стрілкою) внизу екрана Safari\n2. Гортайте вниз і виберіть «На екрані “Дім”»\n3. Натисніть «Додати»\n\nПісля цього іконка зʼявиться на головному екрані!');
        };
        banner.style.display = 'flex';
      }
    }

    function hideBanner() {
      banner.style.display = 'none';
    }

    // Закриття банера
    if (bannerClose) {
      bannerClose.addEventListener('click', () => {
        hideBanner();
        localStorage.setItem(INSTALL_DISMISSED_KEY, 'true');
      });
    }

    // Авто-показ через 3 секунди (якщо не було beforeinstallprompt)
    setTimeout(() => {
      if (!deferredPrompt && !localStorage.getItem(INSTALL_DISMISSED_KEY)) {
        const { isIOS, isTelegram } = detectPlatform();
        if (isIOS || isTelegram) {
          showInstallBanner('auto');
        }
      }
    }, 3000);

    // Якщо користувач вже встановив (відкрито з PWA) — не показуємо
    if (window.matchMedia('(display-mode: standalone)').matches) {
      hideBanner();
    }
  })();

  // ===== Screen lock (password protect) =====
  try { initLockScreen(); } catch (e) { console.warn('LockScreen unavailable:', e); }
  const lockUnlockBtn = document.getElementById('lock-unlock-btn');
  if (lockUnlockBtn) lockUnlockBtn.addEventListener('click', attemptUnlock);
  const lockPassInputEl = document.getElementById('lock-password-input');
  if (lockPassInputEl) {
    lockPassInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); attemptUnlock(); }
    });
  }
  const lockNowBtn = document.getElementById('lock-now-btn');
  if (lockNowBtn) lockNowBtn.addEventListener('click', manualLockNow);

  // Calendar navigation (sidebar)
  const calPrev = document.getElementById('cal-prev');
  const calNext = document.getElementById('cal-next');
  if (calPrev && calNext) {
    calPrev.addEventListener('click', () => {
      calMonth--;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      renderCalendar();
    });
    calNext.addEventListener('click', () => {
      calMonth++;
      if (calMonth > 11) { calMonth = 0; calYear++; }
      renderCalendar();
    });
  }

  // Quick add button
  const quickAddBtn = document.getElementById('btn-quick-add');
  if (quickAddBtn) {
    quickAddBtn.addEventListener('click', quickAddTask);
  }

  // Enter key in quick task text → submit
  const quickTaskText = document.getElementById('quick-task-text');
  if (quickTaskText) {
    quickTaskText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        quickAddTask();
      }
    });
  }

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
      }
    });
  });

  // ---- Auto-lock settings ----
  const autoLockCb = document.getElementById('auto-lock-checkbox');
  const autoLockTimeout = document.getElementById('auto-lock-timeout');
  const autoLockStatus = document.getElementById('auto-lock-status');
  loadAutoLockSettings();
  if (autoLockCb) {
    autoLockCb.addEventListener('change', () => {
      autoLockEnabled = autoLockCb.checked;
      saveAutoLockSettings();
      if (autoLockStatus) autoLockStatus.textContent = autoLockEnabled ? '⏱ активно' : '⏱ вимкнено';
      resetAutoLockTimer();
    });
  }
  if (autoLockTimeout) {
    autoLockTimeout.addEventListener('change', () => {
      autoLockTimeoutMs = parseInt(autoLockTimeout.value, 10) * 60 * 1000;
      saveAutoLockSettings();
      resetAutoLockTimer();
    });
  }
  if (autoLockStatus) {
    autoLockStatus.textContent = autoLockEnabled ? '⏱ активно' : '⏱ вимкнено';
  }
  initAutoLock();

  // ---- Edit mode toggle ----
  const editModeCb = document.getElementById('edit-mode-checkbox');
  if (editModeCb) {
    editModeCb.checked = loadEditMode();
    editModeCb.addEventListener('change', toggleEditMode);
  }
  applyEditMode();

  // ---- Google Sheets Import (тільки в налаштуваннях) ----
  const sheetsImportBtn = document.getElementById('sheets-import-btn');
  if (sheetsImportBtn) {
    sheetsImportBtn.addEventListener('click', importStaffFromSheets);
  }

  // Ініціалізація дашборду Штату
  initShtatMode();
});
