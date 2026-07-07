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
const DEFAULT_SHTAT_UNITS = [
  '1-й відділ', '2-й відділ', '3-й відділ', '4-й відділ', '5-й відділ',
  '6-й відділ', '7-й відділ', '8-й відділ', '9-й відділ', '10-й відділ',
  '11-й відділ', '12-й відділ', '13-й відділ', '14-й відділ', '15-й відділ',
  '16-й відділ', '17-й відділ', '18-й відділ', 'Інші підрозділи'
];

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

      // Delete button
      const delBtn = document.createElement('div');
      delBtn.className = 'task-action-btn task-action-delete delete-task-btn';
      delBtn.innerHTML = '';
      delBtn.title = 'Видалити';
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteTaskByIdx(wsIdx, wsId); });

      cardBody.appendChild(textDiv);
      cardBody.appendChild(metaDiv);
      cardDiv.appendChild(delBtn);
      cardDiv.appendChild(cardBody);
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

      // Delete, complete, edit buttons (absolute right)
      const deleteSpan = document.createElement('div');
      deleteSpan.className = 'task-action-btn task-action-delete delete-task-btn';
      deleteSpan.innerHTML = '';
      deleteSpan.title = 'Видалити';
      deleteSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTaskByIdx(wsIdx, wsId);
      });

      const completeSpan = document.createElement('div');
      completeSpan.className = 'task-action-btn task-action-complete';
      completeSpan.innerHTML = '';
      completeSpan.title = 'Виконано';
      completeSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        completeTaskByIdx(wsIdx, wsId);
      });

      const editSpan = document.createElement('div');
      editSpan.className = 'task-action-btn task-action-edit';
      editSpan.innerHTML = '';
      editSpan.title = 'Редагувати';
      editSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditModal(wsIdx, wsId);
      });

      // Show edit/complete on card hover
      cardDiv.addEventListener('mouseenter', () => {
        editSpan.style.opacity = '1';
        completeSpan.style.opacity = '1';
      });
      cardDiv.addEventListener('mouseleave', () => {
        editSpan.style.opacity = '0';
        completeSpan.style.opacity = '0';
      });

      cardBody.appendChild(textDiv);
      cardBody.appendChild(metaDiv);
      cardBody.appendChild(timerSection);

      cardDiv.appendChild(deleteSpan);
      cardDiv.appendChild(completeSpan);
      cardDiv.appendChild(editSpan);
      cardDiv.appendChild(cardBody);
      return cardDiv;
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
    updateCalendarVisibility();
    saveToLocal();
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
  return localStorage.getItem(EDIT_MODE_KEY) !== 'false'; // default: ON
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
  else if (activeAppMode === 'shtat') renderShtatWorkspace();
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

// ===== Штат Functions =====

// Транслітерація кирилиці (укр + рос) в латиницю для генерації стабільних uid
const UNIT_SLUG_MAP = {
  'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ie','ж':'zh','з':'z',
  'и':'y','і':'i','ї':'i','й':'i','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p',
  'р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch',
  'ь':'','ю':'iu','я':'ia','ъ':'','ы':'y','э':'e',
  'А':'A','Б':'B','В':'V','Г':'H','Ґ':'G','Д':'D','Е':'E','Є':'IE','Ж':'ZH','З':'Z',
  'И':'Y','І':'I','Ї':'I','Й':'I','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P',
  'Р':'R','С':'S','Т':'T','У':'U','Ф':'F','Х':'KH','Ц':'TS','Ч':'CH','Ш':'SH','Щ':'SHCH',
  'Ь':'','Ю':'IU','Я':'IA','Ъ':'','Ы':'Y','Э':'E'
};

function slugifyUnitName(name) {
  if (!name) return '';
  let slug = '';
  for (const ch of String(name)) {
    slug += (ch in UNIT_SLUG_MAP) ? UNIT_SLUG_MAP[ch] : ch;
  }
  // Замінити пробели та дефіси на підкреслення
  slug = slug.replace(/[\s\-]+/g, '_');
  // Забрати всі символи що не a-zA-Z0-9_
  slug = slug.replace(/[^a-zA-Z0-9_]/g, '');
  // Схлопнути повторні підкреслення
  slug = slug.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return slug || 'unit_' + Date.now().toString(36);
}

// Забезпечити наявність unitOrder (порядок відображення підрозділів)
function ensureUnitOrder(data) {
  if (!Array.isArray(data.unitOrder)) {
    // Створити unitOrder з усіх ключів, крім службових
    data.unitOrder = Object.keys(data).filter(k => k !== 'unitOrder');
  } else {
    // Додати нові підрозділи, яких ще немає в order
    const allIds = Object.keys(data).filter(k => k !== 'unitOrder');
    allIds.forEach(id => {
      if (!data.unitOrder.includes(id)) data.unitOrder.push(id);
    });
    // Прибрати з order видалені підрозділи
    data.unitOrder = data.unitOrder.filter(id => data[id]);
  }
}

// Отримати масив ID підрозділів в правильному порядку
function getUnitIds(data) {
  if (Array.isArray(data.unitOrder) && data.unitOrder.length) {
    // Перевірити що всі ID існують
    return data.unitOrder.filter(id => data[id]);
  }
  return Object.keys(data).filter(k => k !== 'unitOrder');
}

// Викликати після рендеру штату — робить зебру на видимих рядках
function applyShtatZebra() {
  const tbody = document.getElementById('shtat-tbody');
  if (!tbody) return;
  const rows = tbody.querySelectorAll('.shtat-unit-row');
  rows.forEach((r, i) => r.classList.toggle('shtat-row-even', i % 2 === 0));
}

// ---- Drag & Drop для пересортування підрозділів ----
let shtatDragUnitId = null;

function onShtatDragStart(e) {
  const handle = e.target.closest('.shtat-drag-handle');
  if (!handle) return;
  shtatDragUnitId = handle.dataset.unit;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', shtatDragUnitId);
  const row = handle.closest('tr.shtat-unit-row');
  if (row) row.classList.add('shtat-dragging');
}

function onShtatDragOver(e) {
  const row = e.target.closest('tr.shtat-unit-row');
  if (!row || !shtatDragUnitId || row.dataset.unitId === shtatDragUnitId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const rect = row.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  row.classList.remove('shtat-drop-before', 'shtat-drop-after');
  row.classList.add(e.clientY < midY ? 'shtat-drop-before' : 'shtat-drop-after');
}

function onShtatDragLeave(e) {
  const row = e.target.closest('tr.shtat-unit-row');
  if (row) row.classList.remove('shtat-drop-before', 'shtat-drop-after');
}

function onShtatDrop(e) {
  const targetRow = e.target.closest('tr.shtat-unit-row');
  if (!targetRow || !shtatDragUnitId) return;
  e.preventDefault();
  const targetId = targetRow.dataset.unitId;
  if (targetId === shtatDragUnitId) return;

  const rect = targetRow.getBoundingClientRect();
  const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';

  const data = loadShtatData();
  ensureUnitOrder(data);
  const fromIdx = data.unitOrder.indexOf(shtatDragUnitId);
  const toIdx = data.unitOrder.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) { cleanupDrag(); return; }

  data.unitOrder.splice(fromIdx, 1);
  const adjustedToIdx = data.unitOrder.indexOf(targetId);
  data.unitOrder.splice(position === 'before' ? adjustedToIdx : adjustedToIdx + 1, 0, shtatDragUnitId);

  saveShtatData(data);
  cleanupDrag();
  renderShtatWorkspace();
}

function onShtatDragEnd(e) {
  cleanupDrag();
}

function cleanupDrag() {
  document.querySelectorAll('.shtat-dragging, .shtat-drop-before, .shtat-drop-after')
    .forEach(el => el.classList.remove('shtat-dragging', 'shtat-drop-before', 'shtat-drop-after'));
  shtatDragUnitId = null;
}

function loadShtatData() {
  try {
    const raw = localStorage.getItem(SHTAT_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      ensureUnitOrder(data);
      return data;
    }
  } catch(e) {}
  // Default: empty values for all default units
  const data = {};
  DEFAULT_SHTAT_UNITS.forEach(name => {
    const id = slugifyUnitName(name);
    data[id] = createDefaultUnit(id, name);
  });
  ensureUnitOrder(data);
  return data;
}

function createDefaultUnit(id, name) {
  const positions = {};
  SHTAT_POSITIONS.forEach(p => { positions[p.id] = { shtat: '', fakt: '' }; });
  const unit = {
    id, name,
    personnelShtat: '', personnelFakt: '',
    equipmentShtat: '', equipmentFakt: '',
    operationalEquipment: '',
    motorPumps: '',
    radioStations: '',
    computers: '',
    positions,
    custom: {}
  };
  ensureEquipmentItems(unit);
  return unit;
}

// Кількість рядків техніки (марка + номер + статуси) у кожному підрозділі
const EQUIPMENT_ROWS_COUNT = 8;
// Статуси техніки — галочки
const EQUIPMENT_STATUSES = [
  { key: 'opRozr',     label: 'опер. розр.' },
  { key: 'repair',     label: 'ремонт' },
  { key: 'reserve',    label: 'резерв' },
  { key: 'zvedZagin',  label: 'зведений загін' }
];

// Створити порожній слот техніки
function blankEquipmentSlot() {
  const slot = { mark: '', number: '' };
  EQUIPMENT_STATUSES.forEach(s => { slot[s.key] = false; });
  return slot;
}

// Мігратор: гарантує що в підрозділі є масив equipmentItems з 8 слотів
function ensureEquipmentItems(unit) {
  if (!Array.isArray(unit.equipmentItems)) unit.equipmentItems = [];
  while (unit.equipmentItems.length < EQUIPMENT_ROWS_COUNT) {
    unit.equipmentItems.push(blankEquipmentSlot());
  }
  // Скинути зайві (на випадок якщо раніше було більше рядків)
  if (unit.equipmentItems.length > EQUIPMENT_ROWS_COUNT) {
    unit.equipmentItems.length = EQUIPMENT_ROWS_COUNT;
  }
  // Гарантувати наявність усіх полів статусів
  unit.equipmentItems.forEach(slot => {
    if (!slot || typeof slot !== 'object') slot = {};
    if (typeof slot.mark !== 'string') slot.mark = '';
    if (typeof slot.number !== 'string') slot.number = '';
    EQUIPMENT_STATUSES.forEach(s => {
      if (typeof slot[s.key] !== 'boolean') slot[s.key] = false;
    });
  });
}

// Підрахунок заповнених рядків техніки у підрозділі
// Рядок вважається заповненим якщо є марка АБО номер
function countEquipmentItems(unit) {
  if (!Array.isArray(unit.equipmentItems)) return 0;
  return unit.equipmentItems.filter(slot => slot && ((slot.mark && slot.mark.trim()) || (slot.number && slot.number.trim()))).length;
}

function ensureUnitPositions(unit) {
  if (!unit.positions) unit.positions = {};
  SHTAT_POSITIONS.forEach(p => {
    if (!unit.positions[p.id]) unit.positions[p.id] = { shtat: '', fakt: '' };
  });
}

function saveShtatData(data) {
  localStorage.setItem(SHTAT_KEY, JSON.stringify(data));
}

function loadShtatCustomCols() {
  try {
    const raw = localStorage.getItem(SHTAT_CUSTOM_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return []; // [{ id, label }]
}

function saveShtatCustomCols(cols) {
  localStorage.setItem(SHTAT_CUSTOM_KEY, JSON.stringify(cols));
}

function getShtatData() {
  const data = loadShtatData();
  const customCols = loadShtatCustomCols();
  return { units: data, customCols };
}

let activeShtatTab = 'personnel'; // 'personnel' | 'equipment' | 'hardware' | 'custom'

// Position categories for personnel
const SHTAT_POSITIONS = [
  { id: 'brigade_chief', label: 'Начальник загону' },
  { id: 'brigade_deputy', label: 'Заступник начальника загону' },
  { id: 'brigade_deputy_ns', label: 'Заступник начальника загону з реагування на НС' },
  { id: 'chief', label: 'Начальник частини' },
  { id: 'deputy', label: 'Заступник начальника частини' },
  { id: 'post_chief', label: 'Начальник поста' },
  { id: 'guard_chief', label: 'Начальник караулу' },
  { id: 'dept_chief', label: 'Начальник відділення' },
  { id: 'squad_com', label: 'Командир відділення' },
  { id: 'firefighter', label: 'Пожежний-рятувальник' },
  { id: 'senior_driver', label: 'Старший водій' },
  { id: 'driver', label: 'Водій' },
  { id: 'squad_driver', label: 'Командир відділення-водій' },
  { id: 'vehicle_driver', label: 'Водій автотранспортних засобів' },
  { id: 'dprz_chief', label: 'Начальник відділення організації реагування на НС' },
  { id: 'dprz_spec', label: 'Фахівець відділення організації реагування на НС' },
  { id: 'dprz_instr', label: 'Фахівець-інструктор відділення організації реагування на НС' },
  { id: 'res_chief', label: 'Начальник відділення ресурсного забезпечення' },
  { id: 'res_spec', label: 'Фахівець відділення ресурсного забезпечення' },
  { id: 'proc_head', label: 'Завідувач групи закупівель' },
  { id: 'proc_spec', label: 'Фахівець групи закупівель' },
  { id: 'legal_head', label: 'Завідувач юридичної групи' },
  { id: 'legal_spec', label: 'Фахівець юридичної групи' },
  { id: 'dept_op', label: 'Начальник відділення-оператор' },
  { id: 'operator', label: 'Оператор' }
];

// Sub-tab column definitions
const SHTAT_TABS = {
  personnel: {
    label: '👤 Особовий склад',
    columns: [
      { key: 'personnelShtat', label: 'штат', cls: 'shtat-col-shtat shtat-input-shtat' },
      { key: 'personnelFakt', label: 'факт', cls: 'shtat-col-fakt shtat-input-fakt' }
    ],
    isShtatFakt: true
  },
  equipment: {
    label: '🚛 Техніка',
    columns: [
      { key: 'equipmentShtat', label: 'штат', cls: 'shtat-col-shtat shtat-input-shtat' },
      { key: 'equipmentFakt', label: 'факт', cls: 'shtat-col-fakt shtat-input-fakt' },
      { key: 'operationalEquipment', label: 'в опер.розр.', cls: '' }
    ],
    isShtatFakt: true
  },
  hardware: {
    label: '📦 Обладнання',
    columns: [
      { key: 'motorPumps', label: 'мотопомпи', cls: '' },
      { key: 'radioStations', label: 'радіостанції', cls: '' },
      { key: 'computers', label: 'комп\'ютери', cls: '' }
    ]
  },
  custom: {
    label: '➕ Додатково',
    columns: [] // filled from customCols
  }
};

function setActiveShtatTab(tab) {
  activeShtatTab = tab;
  document.querySelectorAll('.shtat-subtab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.shtatTab === tab);
  });
  // Show/hide add-category button only on custom tab
  const addColBtn = document.getElementById('shtat-add-col-btn');
  if (addColBtn) addColBtn.style.display = tab === 'custom' ? '' : 'none';
  renderShtatWorkspace();
}

function buildShtatThead(tabDef, customCols) {
  let html = '<tr><th class="shtat-th-unit">Підрозділ</th>';
  const subLabels = [];
  tabDef.columns.forEach(col => {
    html += `<th class="shtat-th-cat">${col.label}</th>`;
    subLabels.push('од.');
  });
  // Custom columns on custom tab
  if (activeShtatTab === 'custom') {
    customCols.forEach(col => {
      html += `<th class="shtat-th-cat shtat-th-custom">${escHtml(col.label)}<span class="shtat-del-col-btn" data-del-custom="${col.id}" title="Видалити категорію">✕</span></th>`;
      subLabels.push('од.');
    });
  }
  html += '</tr><tr><th class="shtat-th-sub"></th>';
  subLabels.forEach(l => { html += `<th class="shtat-th-sub">${l}</th>`; });
  html += '</tr>';
  return html;
}

function getDiffClass(val1, val2) {
  return (parseFloat(val1) || 0) !== (parseFloat(val2) || 0) ? 'shtat-input-diff' : '';
}

function renderShtatWorkspace() {
  const { units, customCols } = getShtatData();
  const tabDef = SHTAT_TABS[activeShtatTab] || SHTAT_TABS.personnel;
  const thead = document.getElementById('shtat-thead');
  const tbody = document.getElementById('shtat-tbody');
  const tfoot = document.getElementById('shtat-tfoot');
  const summary = document.getElementById('shtat-summary');
  if (!tbody || !tfoot || !thead) return;

  // Ensure all units have positions data
  Object.values(units).forEach(u => ensureUnitPositions(u));

  // ---- PERSONNEL TAB: special rendering with positions ----
  if (activeShtatTab === 'personnel') {
    renderPersonnelTab(units, thead, tbody, tfoot, summary);
    return;
  }
  if (activeShtatTab === 'equipment') {
    renderEquipmentTab(units, thead, tbody, tfoot, summary);
    return;
  }

  // ---- OTHER TABS: column-based rendering ----
  thead.innerHTML = buildShtatThead(tabDef, customCols);
  thead.querySelectorAll('.shtat-del-col-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteShtatCustomCol(btn.dataset.delCustom);
    });
  });

  const totals = {};
  tabDef.columns.forEach(c => { totals[c.key] = 0; });
  const totCustom = {};

  let rowsHtml = '';
  const unitIds = getUnitIds(units);
  unitIds.forEach(uid => {
    const u = units[uid];
    let diffClass = '';
    if (tabDef.isShtatFakt && tabDef.columns.length >= 2) {
      const v1 = tabDef.columns[0].key;
      const v2 = tabDef.columns[1].key;
      diffClass = getDiffClass(u[v1], u[v2]);
    }

    rowsHtml += `<tr data-unit-id="${uid}">
      <td>
        <span class="shtat-drag-handle" draggable="true" data-unit="${uid}" title="Перетягніть для зміни порядку">⠿</span>
        <span class="shtat-unit-name" data-rename-unit="${uid}" title="Подвійний клік — редагувати назву">${escHtml(u.name)}</span>
        <span class="shtat-edit-unit" data-rename-unit="${uid}" title="Редагувати назву">✎</span>
        <span class="shtat-delete-unit" data-del-unit="${uid}" title="Видалити підрозділ">✕</span>
      </td>`;

    tabDef.columns.forEach(col => {
      const val = u[col.key] || '';
      const num = parseFloat(val) || 0;
      totals[col.key] = (totals[col.key] || 0) + num;
      const cls = col.cls || '';
      const isFakt = col.key.includes('Fakt');
      const rowCls = (isFakt && diffClass) ? diffClass : cls;
      rowsHtml += `<td><input type="number" class="${rowCls}" data-unit="${uid}" data-field="${col.key}" value="${escHtml(String(val))}" placeholder="0"></td>`;
    });

    if (activeShtatTab === 'custom') {
      customCols.forEach(col => {
        const val = (u.custom && u.custom[col.id]) ? u.custom[col.id] : '';
        rowsHtml += `<td><input type="number" data-unit="${uid}" data-custom="${col.id}" value="${escHtml(String(val))}" placeholder="0"></td>`;
        if (!totCustom[col.id]) totCustom[col.id] = 0;
        totCustom[col.id] += parseFloat(val) || 0;
      });
    }

    rowsHtml += '</tr>';
  });

  tbody.innerHTML = rowsHtml;

  let footHtml = '<tr><td><strong>ВСЬОГО</strong></td>';
  tabDef.columns.forEach(col => { footHtml += `<td><strong>${totals[col.key] || ''}</strong></td>`; });
  if (activeShtatTab === 'custom') {
    customCols.forEach(col => { footHtml += `<td><strong>${totCustom[col.id] || ''}</strong></td>`; });
  }
  footHtml += '</tr>';
  tfoot.innerHTML = footHtml;

  const unitCount = unitIds.length;
  let summaryHtml = `<span>Підрозділів: <strong>${unitCount}</strong></span>`;
  tabDef.columns.forEach(col => { summaryHtml += `<span>${col.label}: <strong>${totals[col.key] || 0}</strong></span>`; });
  if (activeShtatTab === 'custom' && customCols.length) {
    customCols.forEach(col => { summaryHtml += `<span>${escHtml(col.label)}: <strong>${totCustom[col.id] || 0}</strong></span>`; });
  }
  if (summary) summary.innerHTML = summaryHtml;

  if (activeShtatTab === 'custom' && !customCols.length) {
    tbody.innerHTML = `<tr><td colspan="2" style="padding:32px;text-align:center;color:var(--text3);">Немає додаткових категорій. Натисніть «Додати категорію» щоб створити.</td></tr>`;
    tfoot.innerHTML = '';
  }

  attachShtatRowListeners(tbody);
}

// ---- Shared row listeners ----
function attachShtatRowListeners(tbody) {
  tbody.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', onShtatCellChange);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    });
  });
  tbody.querySelectorAll('.shtat-edit-unit').forEach(icon => {
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      startRenameShtatUnit(icon.dataset.renameUnit);
    });
  });
  tbody.querySelectorAll('.shtat-unit-name').forEach(span => {
    span.addEventListener('dblclick', () => startRenameShtatUnit(span.dataset.renameUnit));
  });
  tbody.querySelectorAll('.shtat-delete-unit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteShtatUnit(btn.dataset.delUnit);
    });
  });
  // Drag & drop handlers
  tbody.querySelectorAll('.shtat-drag-handle').forEach(h => {
    h.addEventListener('dragstart', onShtatDragStart);
    h.addEventListener('dragend', onShtatDragEnd);
  });
  tbody.addEventListener('dragover', onShtatDragOver);
  tbody.addEventListener('dragleave', onShtatDragLeave);
  tbody.addEventListener('drop', onShtatDrop);
  applyShtatZebra();
}

// ---- Personnel tab: per-unit view with positions ----
function renderPersonnelTab(units, thead, tbody, tfoot, summary) {
  const unitIds = getUnitIds(units);

  // Auto-sum positions into unit totals
  let grandS = 0, grandF = 0;
  const posTotals = {};
  SHTAT_POSITIONS.forEach(p => { posTotals[p.id] = { shtat: 0, fakt: 0 }; });

  unitIds.forEach(uid => {
    const u = units[uid];
    ensureUnitPositions(u);
    let sumS = 0, sumF = 0;
    SHTAT_POSITIONS.forEach(p => {
      const ps = parseFloat(u.positions[p.id]?.shtat) || 0;
      const pf = parseFloat(u.positions[p.id]?.fakt) || 0;
      sumS += ps; sumF += pf;
      posTotals[p.id].shtat += ps;
      posTotals[p.id].fakt += pf;
    });
    u.personnelShtat = sumS || '';
    u.personnelFakt = sumF || '';
    grandS += sumS; grandF += sumF;
  });

  // ---- Main table: units as rows ----
  thead.innerHTML = `<tr>
    <th class="shtat-th-unit">Підрозділ</th>
    <th class="shtat-th-cat shtat-col-shtat">штат</th>
    <th class="shtat-th-cat shtat-col-fakt">факт</th>
    <th class="shtat-th-cat">±</th>
    <th class="shtat-th-cat" style="text-align:left;min-width:200px;">⚠ не вистачає</th>
  </tr>`;

  let rowsHtml = '';
  unitIds.forEach(uid => {
    const u = units[uid];
    const s = parseFloat(u.personnelShtat) || 0;
    const f = parseFloat(u.personnelFakt) || 0;
    const diff = s - f;
    const diffStr = diff > 0 ? '+' + diff : diff < 0 ? String(diff) : '0';
    const diffCls = diff > 0 ? 'color:var(--amber);' : diff < 0 ? 'color:var(--red);' : 'color:var(--green);';
    const sCls = s !== f ? 'shtat-input-diff' : '';

    // Calculate shortages (штат > факт) and surpluses (факт > штат)
    const shortages = [];
    SHTAT_POSITIONS.forEach(p => {
      const ps = parseFloat(u.positions[p.id]?.shtat) || 0;
      const pf = parseFloat(u.positions[p.id]?.fakt) || 0;
      if (ps > pf) shortages.push({ label: p.label, short: ps - pf });
    });
    const shortStr = shortages.length
      ? shortages.map(sh => `<span style="color:var(--red);font-weight:600;white-space:nowrap;">${escHtml(sh.label)} −${sh.short}</span>`).join(', ')
      : '<span style="color:var(--green);font-size:11px;">✓ укомплектовано</span>';

    // Unit row (clickable to expand) + hidden position detail row
    rowsHtml += `<tr class="shtat-unit-row" data-unit-id="${uid}" data-toggle="unit" style="cursor:pointer;">
      <td>
        <span class="shtat-drag-handle" draggable="true" data-unit="${uid}" title="Перетягніть для зміни порядку">⠿</span>
        <span class="shtat-unit-toggle">▶</span>
        <span class="shtat-unit-name" data-rename-unit="${uid}" title="Подвійний клік — редагувати назву">${escHtml(u.name)}</span>
        <span class="shtat-edit-unit" data-rename-unit="${uid}" title="Редагувати назву">✎</span>
        <span class="shtat-delete-unit" data-del-unit="${uid}" title="Видалити підрозділ">✕</span>
      </td>
      <td><strong style="color:var(--blue);">${s || '—'}</strong></td>
      <td><strong style="color:var(--green);" class="${sCls}">${f || '—'}</strong></td>
      <td><strong style="${diffCls}">${diffStr}</strong></td>
      <td style="text-align:left;font-size:11px;line-height:1.4;max-width:300px;">${shortStr}</td>
    </tr>
    <tr class="shtat-pos-detail" data-unit-detail="${uid}" style="display:none;">
      <td colspan="5" style="padding:0;">
        <div class="shtat-pos-editor">
          <table class="shtat-table shtat-pos-table">
            <thead><tr><th>Посада</th><th class="shtat-col-shtat">штат</th><th class="shtat-col-fakt">факт</th></tr></thead>
            <tbody>`;

    SHTAT_POSITIONS.forEach(p => {
      const ps = u.positions[p.id]?.shtat || '';
      const pf = u.positions[p.id]?.fakt || '';
      const pdiff = (parseFloat(ps)||0) !== (parseFloat(pf)||0) ? 'shtat-input-diff' : '';
      rowsHtml += `<tr>
        <td>${escHtml(p.label)}</td>
        <td><input type="number" class="shtat-input-shtat shtat-pos-input" data-unit="${uid}" data-pos="${p.id}" data-pos-field="shtat" value="${escHtml(String(ps))}" placeholder="0"></td>
        <td><input type="number" class="shtat-input-fakt shtat-pos-input ${pdiff}" data-unit="${uid}" data-pos="${p.id}" data-pos-field="fakt" value="${escHtml(String(pf))}" placeholder="0"></td>
      </tr>`;
    });

    rowsHtml += `</tbody></table></div></td></tr>`;
  });

  tbody.innerHTML = rowsHtml;

  // Footer
  const gDiff = grandS - grandF;
  const gDiffStr = gDiff > 0 ? '+' + gDiff : gDiff < 0 ? String(gDiff) : '0';
  const totalShortages = [];
  SHTAT_POSITIONS.forEach(p => {
    if (posTotals[p.id].shtat > posTotals[p.id].fakt) {
      totalShortages.push({ label: p.label, short: posTotals[p.id].shtat - posTotals[p.id].fakt });
    }
  });
  const totalShortStr = totalShortages.length
    ? totalShortages.map(sh => `<span style="color:var(--red);font-weight:600;white-space:nowrap;">${escHtml(sh.label)} −${sh.short}</span>`).join(', ')
    : '<span style="color:var(--green);">✓</span>';

  tfoot.innerHTML = `<tr>
    <td><strong>ВСЬОГО</strong></td>
    <td><strong style="color:var(--blue);">${grandS || '—'}</strong></td>
    <td><strong style="color:var(--green);">${grandF || '—'}</strong></td>
    <td><strong>${gDiffStr}</strong></td>
    <td style="text-align:left;font-size:11px;">${totalShortStr}</td>
  </tr>`;

  // Summary
  let summaryHtml = `<span>Підрозділів: <strong>${unitIds.length}</strong></span>
    <span>Посад: <strong>${SHTAT_POSITIONS.length}</strong></span>
    <span>Загальний штат: <strong>${grandS}</strong></span>
    <span>Загальний факт: <strong>${grandF}</strong></span>`;
  // Compact position totals
  const hasPosData = Object.values(posTotals).some(p => p.shtat > 0 || p.fakt > 0);
  if (hasPosData) {
    summaryHtml += `<span style="margin-left:8px;color:var(--text3);">|</span>`;
    SHTAT_POSITIONS.forEach(p => {
      if (posTotals[p.id].shtat > 0 || posTotals[p.id].fakt > 0) {
        summaryHtml += `<span style="font-size:11px;">${escHtml(p.label)}: <strong>${posTotals[p.id].shtat}/${posTotals[p.id].fakt}</strong></span>`;
      }
    });
  }
  if (summary) summary.innerHTML = summaryHtml;

  // Attach toggle listeners
  tbody.querySelectorAll('[data-toggle="unit"]').forEach(row => {
    row.addEventListener('click', (e) => {
      // Don't toggle if clicking edit/delete/move buttons
      if (e.target.closest('.shtat-edit-unit') || e.target.closest('.shtat-delete-unit') || e.target.closest('.shtat-drag-handle')) return;
      const uid = row.dataset.unitId;
      const detail = tbody.querySelector(`[data-unit-detail="${uid}"]`);
      const toggle = row.querySelector('.shtat-unit-toggle');
      if (detail) {
        const isOpen = detail.style.display !== 'none';
        detail.style.display = isOpen ? 'none' : '';
        if (toggle) toggle.textContent = isOpen ? '▶' : '▼';
      }
    });
  });

  // Attach position input listeners
  tbody.querySelectorAll('.shtat-pos-input').forEach(inp => {
    inp.addEventListener('change', onShtatPositionChange);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    });
  });

  // Rename + delete listeners
  tbody.querySelectorAll('.shtat-edit-unit').forEach(icon => {
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      startRenameShtatUnit(icon.dataset.renameUnit);
    });
  });
  tbody.querySelectorAll('.shtat-unit-name').forEach(span => {
    span.addEventListener('dblclick', () => startRenameShtatUnit(span.dataset.renameUnit));
  });
  tbody.querySelectorAll('.shtat-delete-unit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteShtatUnit(btn.dataset.delUnit);
    });
  });
  // Drag & drop handlers
  tbody.querySelectorAll('.shtat-drag-handle').forEach(h => {
    h.addEventListener('dragstart', onShtatDragStart);
    h.addEventListener('dragend', onShtatDragEnd);
  });
  tbody.addEventListener('dragover', onShtatDragOver);
  tbody.addEventListener('dragleave', onShtatDragLeave);
  tbody.addEventListener('drop', onShtatDrop);
  applyShtatZebra();
}


function onShtatPositionChange(e) {
  const inp = e.target;
  const unitId = inp.dataset.unit;
  const posId = inp.dataset.pos;
  const field = inp.dataset.posField;
  const data = loadShtatData();
  if (!data[unitId]) return;
  ensureUnitPositions(data[unitId]);
  data[unitId].positions[posId][field] = inp.value.trim();
  // Auto-update unit totals
  let sumS = 0, sumF = 0;
  SHTAT_POSITIONS.forEach(p => {
    sumS += parseFloat(data[unitId].positions[p.id]?.shtat) || 0;
    sumF += parseFloat(data[unitId].positions[p.id]?.fakt) || 0;
  });
  data[unitId].personnelShtat = sumS || '';
  data[unitId].personnelFakt = sumF || '';
  saveShtatData(data);

  // Update unit row cells inline (no full re-render)
  const unitRow = document.querySelector(`tr.shtat-unit-row[data-unit-id="${unitId}"]`);
  if (unitRow) {
    const cells = unitRow.querySelectorAll('td');
    if (cells[1]) cells[1].innerHTML = `<strong style="color:var(--blue);">${sumS || '—'}</strong>`;
    const diff = sumS - sumF;
    const diffStr = diff > 0 ? '+' + diff : diff < 0 ? String(diff) : '0';
    const diffCls = diff > 0 ? 'color:var(--amber);' : diff < 0 ? 'color:var(--red);' : 'color:var(--green);';
    if (cells[2]) cells[2].innerHTML = `<strong style="color:var(--green);" class="${sumS !== sumF ? 'shtat-input-diff' : ''}">${sumF || '—'}</strong>`;
    if (cells[3]) cells[3].innerHTML = `<strong style="${diffCls}">${diffStr}</strong>`;
    // Update shortages column
    if (cells[4]) {
      const shortages = [];
      const unitData = data[unitId];
      SHTAT_POSITIONS.forEach(p => {
        const ps = parseFloat(unitData.positions[p.id]?.shtat) || 0;
        const pf = parseFloat(unitData.positions[p.id]?.fakt) || 0;
        if (ps > pf) shortages.push({ label: p.label, short: ps - pf });
      });
      cells[4].innerHTML = shortages.length
        ? shortages.map(sh => `<span style="color:var(--red);font-weight:600;white-space:nowrap;">${escHtml(sh.label)} −${sh.short}</span>`).join(', ')
        : '<span style="color:var(--green);font-size:11px;">✓ укомплектовано</span>';
    }
  }

  // Update totals: recalc from all units
  const allUnits = Object.values(data);
  let grandS = 0, grandF = 0;
  const posTotals = {};
  SHTAT_POSITIONS.forEach(p => { posTotals[p.id] = { shtat: 0, fakt: 0 }; });
  allUnits.forEach(u => {
    ensureUnitPositions(u);
    SHTAT_POSITIONS.forEach(p => {
      posTotals[p.id].shtat += parseFloat(u.positions[p.id]?.shtat) || 0;
      posTotals[p.id].fakt += parseFloat(u.positions[p.id]?.fakt) || 0;
    });
    grandS += parseFloat(u.personnelShtat) || 0;
    grandF += parseFloat(u.personnelFakt) || 0;
  });

  // Update footer
  const tfoot = document.getElementById('shtat-tfoot');
  if (tfoot) {
    const gDiff = grandS - grandF;
    const gDiffStr = gDiff > 0 ? '+' + gDiff : gDiff < 0 ? String(gDiff) : '0';
    tfoot.innerHTML = `<tr>
      <td><strong>ВСЬОГО</strong></td>
      <td><strong style="color:var(--blue);">${grandS || '—'}</strong></td>
      <td><strong style="color:var(--green);">${grandF || '—'}</strong></td>
      <td><strong>${gDiffStr}</strong></td>
    </tr>`;
  }

  // Update summary
  const summary = document.getElementById('shtat-summary');
  if (summary) {
    let html = `<span>Підрозділів: <strong>${allUnits.length}</strong></span>
      <span>Посад: <strong>${SHTAT_POSITIONS.length}</strong></span>
      <span>Загальний штат: <strong>${grandS}</strong></span>
      <span>Загальний факт: <strong>${grandF}</strong></span>`;
    const hasData = Object.values(posTotals).some(p => p.shtat > 0 || p.fakt > 0);
    if (hasData) {
      html += `<span style="margin-left:8px;color:var(--text3);">|</span>`;
      SHTAT_POSITIONS.forEach(p => {
        if (posTotals[p.id].shtat > 0 || posTotals[p.id].fakt > 0) {
          html += `<span style="font-size:11px;">${escHtml(p.label)}: <strong>${posTotals[p.id].shtat}/${posTotals[p.id].fakt}</strong></span>`;
        }
      });
    }
    summary.innerHTML = html;
  }
}

// ---- Equipment tab: per-unit view with equipment items ----
function renderEquipmentTab(units, thead, tbody, tfoot, summary) {
  const unitIds = getUnitIds(units);

  // Auto-sum equipment into unit totals
  let grandTotalEquipment = 0;
  const grandStatusTotals = {};
  EQUIPMENT_STATUSES.forEach(s => { grandStatusTotals[s.key] = 0; });

  unitIds.forEach(uid => {
    const u = units[uid];
    ensureEquipmentItems(u);
    let unitEquipmentCount = countEquipmentItems(u);
    u.equipmentFakt = unitEquipmentCount || ''; // FAKT = number of filled rows
    u.equipmentShtat = EQUIPMENT_ROWS_COUNT; // SHTAT = max allowed rows
    grandTotalEquipment += unitEquipmentCount;

    EQUIPMENT_STATUSES.forEach(s => {
      grandStatusTotals[s.key] += u.equipmentItems.filter(item => item[s.key]).length;
    });
  });

  // ---- Main table: units as rows ----
  thead.innerHTML = `<tr>
    <th class="shtat-th-unit">Підрозділ</th>
    <th class="shtat-th-cat shtat-col-shtat">Штат</th>
    <th class="shtat-th-cat shtat-col-fakt">Факт</th>
    <th class="shtat-th-cat">В опер.розр.</th>
    <th class="shtat-th-cat">В ремонті</th>
    <th class="shtat-th-cat">В резерві</th>
    <th class="shtat-th-cat">Звед.загін</th>
  </tr>`;

  let rowsHtml = '';
  unitIds.forEach(uid => {
    const u = units[uid];
    const s = u.equipmentShtat || 0;
    const f = u.equipmentFakt || 0;

    // Calculate equipment status counts for this unit
    const unitStatusCounts = {};
    EQUIPMENT_STATUSES.forEach(sDef => {
      unitStatusCounts[sDef.key] = u.equipmentItems.filter(item => item[sDef.key]).length;
    });

    rowsHtml += `<tr class="shtat-unit-row" data-unit-id="${uid}" data-toggle="equipment-unit" style="cursor:pointer;">
      <td>
        <span class="shtat-drag-handle" draggable="true" data-unit="${uid}" title="Перетягніть для зміни порядку">⠿</span>
        <span class="shtat-unit-toggle">▶</span>
        <span class="shtat-unit-name" data-rename-unit="${uid}" title="Подвійний клік — редагувати назву">${escHtml(u.name)}</span>
        <span class="shtat-edit-unit" data-rename-unit="${uid}" title="Редагувати назву">✎</span>
        <span class="shtat-delete-unit" data-del-unit="${uid}" title="Видалити підрозділ">✕</span>
      </td>
      <td><strong style="color:var(--blue);">${s || '—'}</strong></td>
      <td><strong style="color:var(--green);">${f || '—'}</strong></td>
      <td><strong>${unitStatusCounts.opRozr || '0'}</strong></td>
      <td><strong>${unitStatusCounts.repair || '0'}</strong></td>
      <td><strong>${unitStatusCounts.reserve || '0'}</strong></td>
      <td><strong>${unitStatusCounts.zvedZagin || '0'}</strong></td>
    </tr>
    <tr class="shtat-pos-detail shtat-equipment-detail" data-unit-detail="${uid}" style="display:none;">
      <td colspan="7" style="padding:0;">
        <div class="shtat-pos-editor">
          <table class="shtat-table shtat-equipment-table">
            <thead>
              <tr>
                <th>№</th>
                <th style="width:30%;">Марка</th>
                <th style="width:30%;">Номер</th>
                <th class="shtat-checkbox-col">${EQUIPMENT_STATUSES[0].label}</th>
                <th class="shtat-checkbox-col">${EQUIPMENT_STATUSES[1].label}</th>
                <th class="shtat-checkbox-col">${EQUIPMENT_STATUSES[2].label}</th>
                <th class="shtat-checkbox-col">${EQUIPMENT_STATUSES[3].label}</th>
              </tr>
            </thead>
            <tbody>`;

    u.equipmentItems.forEach((item, idx) => {
      rowsHtml += `<tr class="shtat-equipment-item-row">
        <td>${idx + 1}.</td>
        <td><input type="text" class="shtat-input-text" data-unit="${uid}" data-eq-idx="${idx}" data-eq-field="mark" value="${escHtml(item.mark)}" placeholder="Марка"></td>
        <td><input type="text" class="shtat-input-text" data-unit="${uid}" data-eq-idx="${idx}" data-eq-field="number" value="${escHtml(item.number)}" placeholder="Номер"></td>`;
      EQUIPMENT_STATUSES.forEach(sDef => {
        rowsHtml += `<td class="shtat-checkbox-col"><input type="checkbox" data-unit="${uid}" data-eq-idx="${idx}" data-eq-field="${sDef.key}" ${item[sDef.key] ? 'checked' : ''}></td>`;
      });
      rowsHtml += `</tr>`;
    });

    rowsHtml += `</tbody></table></div></td></tr>`;
  });

  tbody.innerHTML = rowsHtml;

  // Footer (totals)
  tfoot.innerHTML = `<tr>
    <td><strong>ВСЬОГО</strong></td>
    <td><strong style="color:var(--blue);">${EQUIPMENT_ROWS_COUNT * unitIds.length || '—'}</strong></td>
    <td><strong style="color:var(--green);">${grandTotalEquipment || '—'}</strong></td>
    <td><strong>${grandStatusTotals.opRozr || '0'}</strong></td>
    <td><strong>${grandStatusTotals.repair || '0'}</strong></td>
    <td><strong>${grandStatusTotals.reserve || '0'}</strong></td>
    <td><strong>${grandStatusTotals.zvedZagin || '0'}</strong></td>
  </tr>`;

  // Summary (top summary row)
  let summaryHtml = `<span>Підрозділів: <strong>${unitIds.length}</strong></span>
    <span>Всього слотів техніки: <strong>${EQUIPMENT_ROWS_COUNT * unitIds.length}</strong></span>
    <span>Заповнено слотів: <strong>${grandTotalEquipment}</strong></span>`;
  EQUIPMENT_STATUSES.forEach(sDef => {
    if (grandStatusTotals[sDef.key] > 0) {
      summaryHtml += `<span style="margin-left:8px;color:var(--text3);">|</span><span style="font-size:11px;">${sDef.label}: <strong>${grandStatusTotals[sDef.key]}</strong></span>`;
    }
  });
  if (summary) summary.innerHTML = summaryHtml;

  // Attach toggle listeners
  tbody.querySelectorAll('[data-toggle="equipment-unit"]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.shtat-edit-unit') || e.target.closest('.shtat-delete-unit') || e.target.closest('.shtat-drag-handle')) return;
      const uid = row.dataset.unitId;
      const detail = tbody.querySelector(`[data-unit-detail="${uid}"]`);
      const toggle = row.querySelector('.shtat-unit-toggle');
      if (detail) {
        const isOpen = detail.style.display !== 'none';
        detail.style.display = isOpen ? 'none' : '';
        if (toggle) toggle.textContent = isOpen ? '▶' : '▼';
      }
    });
  });

  // Attach equipment item input listeners
  tbody.querySelectorAll('.shtat-equipment-table input').forEach(inp => {
    inp.addEventListener('change', onEquipmentItemChange);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    });
  });

  // Rename + delete listeners (shared with personnel)
  tbody.querySelectorAll('.shtat-edit-unit').forEach(icon => {
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      startRenameShtatUnit(icon.dataset.renameUnit);
    });
  });
  tbody.querySelectorAll('.shtat-unit-name').forEach(span => {
    span.addEventListener('dblclick', () => startRenameShtatUnit(span.dataset.renameUnit));
  });
  tbody.querySelectorAll('.shtat-delete-unit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteShtatUnit(btn.dataset.delUnit);
    });
  });
  // Drag & drop handlers
  tbody.querySelectorAll('.shtat-drag-handle').forEach(h => {
    h.addEventListener('dragstart', onShtatDragStart);
    h.addEventListener('dragend', onShtatDragEnd);
  });
  tbody.addEventListener('dragover', onShtatDragOver);
  tbody.addEventListener('dragleave', onShtatDragLeave);
  tbody.addEventListener('drop', onShtatDrop);
  applyShtatZebra();
}


function onShtatCellChange(e) {
  const inp = e.target;
  const unitId = inp.dataset.unit;
  const field = inp.dataset.field;
  const customCol = inp.dataset.custom;
  const data = loadShtatData();

  if (!data[unitId]) return;

  const val = inp.value.trim();

  if (field) {
    data[unitId][field] = val;
  } else if (customCol) {
    if (!data[unitId].custom) data[unitId].custom = {};
    data[unitId].custom[customCol] = val;
  }

  saveShtatData(data);
  renderShtatWorkspace(); // re-render for diff highlighting
}

function onEquipmentItemChange(e) {
  const inp = e.target;
  const unitId = inp.dataset.unit;
  const eqIdx = parseInt(inp.dataset.eqIdx, 10);
  const field = inp.dataset.eqField;
  const data = loadShtatData();

  if (!data[unitId] || !Array.isArray(data[unitId].equipmentItems) || !data[unitId].equipmentItems[eqIdx]) return;

  const item = data[unitId].equipmentItems[eqIdx];
  if (inp.type === 'checkbox') {
    item[field] = inp.checked;
  } else {
    item[field] = inp.value.trim();
  }

  saveShtatData(data);
  renderShtatWorkspace(); // re-render to update totals
}

function addShtatUnit() {
  const name = prompt('Назва підрозділу:');
  if (!name || !name.trim()) return;
  const id = slugifyUnitName(name.trim());
  const data = loadShtatData();
  if (data[id]) { alert('Такий підрозділ вже існує'); return; }
  data[id] = createDefaultUnit(id, name.trim());
  saveShtatData(data);
  renderShtatWorkspace();
}

function deleteShtatUnit(unitId) {
  const data = loadShtatData();
  if (!data[unitId]) return;
  const name = data[unitId].name;
  if (!confirm(`Видалити підрозділ "${name}"?`)) return;
  delete data[unitId];
  saveShtatData(data);
  renderShtatWorkspace();
}

function startRenameShtatUnit(unitId) {
  const data = loadShtatData();
  if (!data[unitId]) return;
  const span = document.querySelector(`.shtat-unit-name[data-rename-unit="${unitId}"]`);
  if (!span) return;
  const oldName = data[unitId].name;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = oldName;
  input.className = 'shtat-rename-input';
  input.style.cssText = 'width:160px; text-align:left; font-weight:600; font-size:13px;';
  span.replaceWith(input);
  input.focus();
  input.select();
  const save = () => {
    const newName = input.value.trim();
    if (newName && newName !== oldName) {
      const fresh = loadShtatData();
      if (fresh[unitId]) {
        fresh[unitId].name = newName;
        saveShtatData(fresh);
      }
    }
    renderShtatWorkspace();
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = oldName; input.blur(); }
  });
}

function addShtatCustomCol() {
  const label = prompt('Назва нової категорії (наприклад: "Дрони", "Планшети"):');
  if (!label || !label.trim()) return;
  const id = slugifyUnitName(label.trim());
  const cols = loadShtatCustomCols();
  if (cols.some(c => c.id === id)) { alert('Така категорія вже існує'); return; }
  cols.push({ id, label: label.trim() });
  saveShtatCustomCols(cols);
  renderShtatWorkspace();
}

function exportShtatData() {
  const data = loadShtatData();
  const unitIds = getUnitIds(data);
  if (!unitIds.length) { alert('Немає даних для експорту.'); return; }

  // Calculate grand totals for personnel
  let grandS = 0, grandF = 0;
  Object.values(data).forEach(u => {
    ensureUnitPositions(u);
    SHTAT_POSITIONS.forEach(p => {
      grandS += parseFloat(u.positions[p.id]?.shtat) || 0;
      grandF += parseFloat(u.positions[p.id]?.fakt) || 0;
    });
  });

  // Build ODS content.xml rows
  let rowsXml = '';
  // Header Row for ODS
  rowsXml += `<table:table-row>
<table:table-cell office:value-type="string"><text:p>Підрозділ</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>Категорія / Позиція</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>Штат / Марка</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>Факт / Номер</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>${EQUIPMENT_STATUSES[0].label}</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>${EQUIPMENT_STATUSES[1].label}</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>${EQUIPMENT_STATUSES[2].label}</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>${EQUIPMENT_STATUSES[3].label}</text:p></table:table-cell>
</table:table-row>\n`;

  unitIds.forEach(uid => {
    const u = data[uid];
    ensureUnitPositions(u);
    ensureEquipmentItems(u);

    // Personnel data
    SHTAT_POSITIONS.forEach(p => {
      const s = parseFloat(u.positions[p.id]?.shtat) || 0;
      const f = parseFloat(u.positions[p.id]?.fakt) || 0;
      rowsXml += `<table:table-row>
<table:table-cell office:value-type="string"><text:p>${escXml(u.name)}</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>${escXml(p.label)}</text:p></table:table-cell>
<table:table-cell office:value-type="float" office:value="${s || 0}"><text:p>${s || ''}</text:p></table:table-cell>
<table:table-cell office:value-type="float" office:value="${f || 0}"><text:p>${f || ''}</text:p></table:table-cell>
<table:table-cell office:value-type="string"></table:table-cell>
<table:table-cell office:value-type="string"></table:table-cell>
<table:table-cell office:value-type="string"></table:table-cell>
<table:table-cell office:value-type="string"></table:table-cell>
</table:table-row>\n`;
    });

    // Equipment data
    u.equipmentItems.forEach((item, idx) => {
      if (item.mark || item.number) { // Only export filled items
        rowsXml += `<table:table-row>
<table:table-cell office:value-type="string"><text:p>${escXml(u.name)}</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>Техніка №${idx + 1}</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>${escXml(item.mark)}</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>${escXml(item.number)}</text:p></table:table-cell>
<table:table-cell office:value-type="boolean" office:value="${item.opRozr}"><text:p>${item.opRozr ? '+' : ''}</text:p></table:table-cell>
<table:table-cell office:value-type="boolean" office:value="${item.repair}"><text:p>${item.repair ? '+' : ''}</text:p></table:table-cell>
<table:table-cell office:value-type="boolean" office:value="${item.reserve}"><text:p>${item.reserve ? '+' : ''}</text:p></table:table-cell>
<table:table-cell office:value-type="boolean" office:value="${item.zvedZagin}"><text:p>${item.zvedZagin ? '+' : ''}</text:p></table:table-cell>
</table:table-row>\n`;
      }
    });
  });

  // Grand totals for personnel
  rowsXml += `<table:table-row>
<table:table-cell office:value-type="string"><text:p>ЗАГАЛОМ</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>Особовий склад (штат/факт)</text:p></table:table-cell>
<table:table-cell office:value-type="float" office:value="${grandS || 0}"><text:p>${grandS || ''}</text:p></table:table-cell>
<table:table-cell office:value-type="float" office:value="${grandF || 0}"><text:p>${grandF || ''}</text:p></table:table-cell>
<table:table-cell office:value-type="string"></table:table-cell>
<table:table-cell office:value-type="string"></table:table-cell>
<table:table-cell office:value-type="string"></table:table-cell>
<table:table-cell office:value-type="string"></table:table-cell>
</table:table-row>\n`;

  // Grand totals for equipment
  const grandTotalEquipment = Object.values(data).reduce((acc, u) => acc + countEquipmentItems(u), 0);
  const grandStatusTotals = {};
  EQUIPMENT_STATUSES.forEach(s => { grandStatusTotals[s.key] = 0; });
  Object.values(data).forEach(u => {
    ensureEquipmentItems(u);
    EQUIPMENT_STATUSES.forEach(s => {
      grandStatusTotals[s.key] += u.equipmentItems.filter(item => item[s.key]).length;
    });
  });

  rowsXml += `<table:table-row>
<table:table-cell office:value-type="string"></table:table-cell>
<table:table-cell office:value-type="string"><text:p>Техніка (заповнено слотів)</text:p></table:table-cell>
<table:table-cell office:value-type="float" office:value="${grandTotalEquipment}"><text:p>${grandTotalEquipment}</text:p></table:table-cell>
<table:table-cell office:value-type="string"></table:table-cell>
<table:table-cell office:value-type="float" office:value="${grandStatusTotals.opRozr}"><text:p>${grandStatusTotals.opRozr}</text:p></table:table-cell>
<table:table-cell office:value-type="float" office:value="${grandStatusTotals.repair}"><text:p>${grandStatusTotals.repair}</text:p></table:table-cell>
<table:table-cell office:value-type="float" office:value="${grandStatusTotals.reserve}"><text:p>${grandStatusTotals.reserve}</text:p></table:table-cell>
<table:table-cell office:value-type="float" office:value="${grandStatusTotals.zvedZagin}"><text:p>${grandStatusTotals.zvedZagin}</text:p></table:table-cell>
</table:table-row>\n`;

  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 office:version="1.2">
<office:body><office:spreadsheet>
<table:table table:name="Штат">
<table:table-column table:number-columns-repeated="8"/>
<table:table-header-rows>
<table:table-row>
<table:table-cell office:value-type="string"><text:p>Підрозділ</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>Категорія / Позиція</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>Штат / Марка</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>Факт / Номер</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>В опер.розр.</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>В ремонті</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>В резерві</text:p></table:table-cell>
<table:table-cell office:value-type="string"><text:p>Звед.загін</text:p></table:table-cell>
</table:table-row>
</table:table-header-rows>
${rowsXml}
</table:table>
</office:spreadsheet></office:body>
</office:document-content>`;

  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

  const dateFile = new Date().toISOString().slice(0, 10);
  buildAndDownloadOds(`Штат_${dateFile}.ods`, contentXml, manifestXml);
}

// ---- ODS (ZIP) packer ----
function buildAndDownloadOds(filename, contentXml, manifestXml) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getSeconds() >> 1) | (now.getMinutes() << 5) | (now.getHours() << 11);
  const dosDate = now.getDate() | ((now.getMonth() + 1) << 5) | ((now.getFullYear() - 1980) << 9);

  const files = [
    { name: 'mimetype', bytes: enc.encode('application/vnd.oasis.opendocument.spreadsheet') },
    { name: 'content.xml', bytes: enc.encode(contentXml) },
    { name: 'META-INF/manifest.xml', bytes: enc.encode(manifestXml) }
  ];

  // Calculate all CRCs and build sections
  const localHeaders = [];
  const cdEntries = [];
  let dataOffset = 0;
  const allParts = [];

  files.forEach(f => {
    const crc = crc32(f.bytes);
    const nameBytes = enc.encode(f.name);
    // Local file header: 30 + nameLen + extraLen
    const locHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(locHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);  // signature
    lv.setUint16(4, 20, true);           // version needed
    lv.setUint16(6, 0, true);            // flags
    lv.setUint16(8, 0, true);            // method (stored)
    lv.setUint16(10, dosTime, true);     // mod time
    lv.setUint16(12, dosDate, true);     // mod date
    lv.setUint32(14, crc, true);         // crc32
    lv.setUint32(18, f.bytes.length, true); // compressed size
    lv.setUint32(22, f.bytes.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);           // extra field length
    locHeader.set(nameBytes, 30);

    allParts.push(locHeader);
    allParts.push(f.bytes);
    dataOffset += locHeader.length + f.bytes.length;

    cdEntries.push({ name: f.name, nameBytes, crc, size: f.bytes.length, offset: dataOffset - f.bytes.length - locHeader.length });
  });

  const cdStart = dataOffset;

  // Central directory
  cdEntries.forEach(cd => {
    const cdHeader = new Uint8Array(46 + cd.nameBytes.length);
    const cv = new DataView(cdHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);  // version made by
    cv.setUint16(6, 20, true);  // version needed
    cv.setUint16(8, 0, true);   // flags
    cv.setUint16(10, 0, true);  // method
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, cd.crc, true);
    cv.setUint32(20, cd.size, true);
    cv.setUint32(24, cd.size, true);
    cv.setUint16(28, cd.nameBytes.length, true);
    cv.setUint16(30, 0, true);  // extra len
    cv.setUint16(32, 0, true);  // comment len
    cv.setUint16(34, 0, true);  // disk start
    cv.setUint16(36, 0, true);  // internal attrs
    cv.setUint32(38, 0, true);  // external attrs
    cv.setUint32(42, cd.offset, true);
    cdHeader.set(cd.nameBytes, 46);
    allParts.push(cdHeader);
  });

  const cdSize = allParts.reduce((s, p) => s + p.length, 0) - cdStart;
  const cdCount = cdEntries.length;

  // EOCD
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);   // disk number
  ev.setUint16(6, 0, true);   // disk with CD
  ev.setUint16(8, cdCount, true);
  ev.setUint16(10, cdCount, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  ev.setUint16(20, 0, true);  // comment len
  allParts.push(eocd);

  const blob = new Blob(allParts, { type: 'application/vnd.oasis.opendocument.spreadsheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  if (!crc32.table) {
    crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc32.table[i] = c;
    }
  }
  for (let i = 0; i < data.length; i++) {
    crc = crc32.table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function escXml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function importShtatData(file) {
  const isOds = file.name && file.name.toLowerCase().endsWith('.ods');
  if (isOds) {
    importOdsViaZipJs(file);
  } else {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        if (text.trim().startsWith('{')) {
          importShtatJson(text);
        } else {
          let best = 0;
          const tryParse = (fn) => { const c = fn(text); if (c > best) best = c; return c; };
          if (tryParse(importShtatCsv) === 0) {
            if (tryParse(importShtatHtml) === 0) {
              alert('Не вдалося знайти дані у файлі.');
            }
          }
        }
      } catch(err) { alert('Помилка читання: ' + err.message); }
    };
    reader.readAsText(file);
  }
}

function importOdsViaZipJs(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const bytes = new Uint8Array(e.target.result);
    const xml = await readOdsContentXml(bytes);
    if (xml) { importShtatOds(xml); }
    else { alert('Не вдалося прочитати .ods файл.'); }
  };
  reader.readAsArrayBuffer(file);
}

async function readOdsContentXml(bytes) {
  const get16 = (i) => bytes[i] | (bytes[i+1] << 8);
  const get32 = (i) => (bytes[i] | (bytes[i+1]<<8) | (bytes[i+2]<<16) | (bytes[i+3]<<24)) >>> 0;
  const textAt = (off, len) => new TextDecoder().decode(bytes.slice(off, off + len));

  // 1. Find EOCD
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
    if (get32(i) === 0x06054b50) { eocd = i; break; }
  }

  let entryOffset = -1;

  if (eocd >= 0) {
    // 2. Read Central Directory
    const cdOff = get32(eocd + 16);
    const total = get16(eocd + 8);
    let pos = cdOff;
    for (let i = 0; i < total && pos + 46 < bytes.length; i++) {
      if (get32(pos) !== 0x02014b50) break;
      const nLen = get16(pos + 28);
      const eLen = get16(pos + 30);
      const cLen = get16(pos + 32);
      const name = textAt(pos + 46, nLen);
      if (name === 'content.xml') {
        entryOffset = get32(pos + 42);
        break;
      }
      pos += 46 + nLen + eLen + cLen;
    }
  }

  // 3. Fallback: scan all local headers
  if (entryOffset < 0) {
    let pos = 0;
    while (pos < bytes.length - 30) {
      if (get32(pos) === 0x04034b50) {
        const nLen = get16(pos + 26);
        const eLen = get16(pos + 28);
        const cSize = get32(pos + 18);
        const name = textAt(pos + 30, nLen);
        if (name === 'content.xml') { entryOffset = pos; break; }
        pos += 30 + nLen + eLen + cSize;
      } else { pos++; }
    }
  }

  if (entryOffset < 0) {
    // Last resort: search raw text
    const text = new TextDecoder().decode(bytes);
    const idx = text.indexOf('<table:table-row');
    if (idx > 0) {
      const start = Math.max(0, text.lastIndexOf('<?xml', idx));
      return text.substring(start > 0 ? start : idx - 200);
    }
    return null;
  }

  // 4. Read local header
  const p = entryOffset;
  const method = get16(p + 8);
  const flags = get16(p + 6);
  const nLen = get16(p + 26);
  const eLen = get16(p + 28);
  let cSize = get32(p + 18);
  let dataOff = p + 30 + nLen + eLen;

  // Handle data descriptor (bit 3)
  if ((flags & 8) && cSize === 0) {
    let scan = dataOff;
    while (scan < bytes.length - 4) {
      const sig = get32(scan);
      if (sig === 0x08074b50 || sig === 0x04034b50 || sig === 0x02014b50) {
        cSize = scan - dataOff;
        break;
      }
      scan++;
    }
  }

  if (dataOff + cSize > bytes.length) return null;

  // 5. Extract
  if (method === 0) return textAt(dataOff, cSize);
  if (method === 8) {
    const raw = bytes.slice(dataOff, dataOff + cSize);
    return await inflateRaw(raw);
  }
  return null;
}

async function inflateRaw(compressed) {
  const data = new Uint8Array(compressed);
  for (const fmt of ['deflate-raw', 'deflate']) {
    try {
      const blob = new Blob([data]);
      const decompressed = blob.stream().pipeThrough(new DecompressionStream(fmt));
      const buf = await new Response(decompressed).arrayBuffer();
      const text = new TextDecoder().decode(buf);
      if (text.includes('<table:table') || text.includes('<?xml')) return text;
    } catch(e) {}
  }
  return null;
}

function importShtatOds(xml) {
  // Try DOMParser first
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  // Check for parse error
  if (doc.querySelector('parsererror')) {
    // Fallback: regex-based extraction
    importShtatOdsFallback(xml);
    return;
  }

  // Try multiple selector patterns (with/without namespace prefixes)
  let rows = doc.querySelectorAll('table\\:table-row, table-row');
  if (!rows.length) rows = doc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:table:1.0', 'table-row');
  if (!rows.length) rows = doc.getElementsByTagName('table-row');

  if (!rows.length) {
    importShtatOdsFallback(xml);
    return;
  }

  const data = loadShtatData();
  const posLabelToId = {};
  SHTAT_POSITIONS.forEach(p => { posLabelToId[p.label] = p.id; });
  let imported = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let cells = row.querySelectorAll('table\\:table-cell, table-cell');
    if (!cells.length) cells = row.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:table:1.0', 'table-cell');
    if (!cells.length) cells = row.getElementsByTagName('table-cell');

    if (cells.length < 3) continue;

    const getText = (cell) => {
      let p = cell.querySelector('text\\:p, p');
      if (!p) p = cell.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:text:1.0', 'p')[0];
      if (!p) p = cell.getElementsByTagName('p')[0];
      return p ? p.textContent.trim() : cell.textContent.trim();
    };

    const unitName = getText(cells[0]);
    const posLabel = getText(cells[1]);
    const col2 = getText(cells[2]); // штат або марка
    const col3 = cells[3] ? getText(cells[3]) : ''; // факт або номер

    if (!unitName || unitName === 'Підрозділ' || unitName === 'ЗАГАЛОМ') continue;
    if (posLabel === 'Посада' || posLabel === 'Категорія / Підрозділ' || posLabel === 'ВСЬОГО' || posLabel === 'Особовий склад (штат/факт)' || posLabel === 'Техніка (заповнено слотів)') continue;

    let unitId = Object.keys(data).find(uid => data[uid].name === unitName);
    if (!unitId) {
      unitId = slugifyUnitName(unitName);
      if (!data[unitId]) data[unitId] = createDefaultUnit(unitId, unitName);
    }
    ensureUnitPositions(data[unitId]);

    // Якщо це рядок техніки (posLabel починається з "Техніка №")
    const eqMatch = posLabel.match(/^Техніка\s*№\s*(\d+)/i);
    if (eqMatch) {
      ensureEquipmentItems(data[unitId]);
      const eqIdx = parseInt(eqMatch[1], 10) - 1;
      if (eqIdx >= 0 && eqIdx < data[unitId].equipmentItems.length) {
        const item = data[unitId].equipmentItems[eqIdx];
        item.mark = col2 || item.mark;
        item.number = col3 || item.number;
        // галочки в колонках 4-7 (індекси 4,5,6,7)
        ['opRozr','repair','reserve','zvedZagin'].forEach((key, kIdx) => {
          const cellIdx = 4 + kIdx;
          if (cells[cellIdx]) {
            const val = getText(cells[cellIdx]);
            if (val === '+' || val === 'true' || val === '+') item[key] = true;
            else if (val === '-' || val === 'false' || val === '') item[key] = false;
            else item[key] = !!val;
          }
        });
        imported++;
      }
      continue;
    }

    // Звичайний рядок позиції особового складу
    if (!col2 && !col3) continue;
    const posId = posLabelToId[posLabel];
    if (posId) {
      data[unitId].positions[posId].shtat = col2;
      data[unitId].positions[posId].fakt = col3;
      imported++;
    }
  }

  if (imported > 0) {
    recalcAndSaveShtat(data);
    alert(`Імпортовано ${imported} записів (ODS).`);
  } else {
    alert('Не знайдено даних для імпорту в .ods файлі.');
  }
}

function importShtatOdsFallback(xml) {
  // Regex-based extraction: find table-row blocks with table-cell content
  const rowRegex = /<table:table-row[^>]*>([\s\S]*?)<\/table:table-row>/gi;
  const cellRegex = /<table:table-cell[^>]*>([\s\S]*?)<\/table:table-cell>/gi;
  const textRegex = /<text:p[^>]*>([\s\S]*?)<\/text:p>/gi;

  const rows = [];
  let rowMatch;
  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      let text = '';
      let textMatch;
      while ((textMatch = textRegex.exec(cellMatch[1])) !== null) {
        text += textMatch[1];
      }
      if (!text) text = cellMatch[1].replace(/<[^>]+>/g, '').trim();
      cells.push(text.trim());
    }
    if (cells.length >= 3) rows.push(cells);
  }

  if (!rows.length) { alert('Не знайдено рядків в .ods файлі.'); return; }

  const data = loadShtatData();
  const posLabelToId = {};
  SHTAT_POSITIONS.forEach(p => { posLabelToId[p.label] = p.id; });
  let imported = 0;

  rows.forEach(cells => {
    const unitName = cells[0];
    const posLabel = cells[1];
    const col2 = cells[2]; // штат або марка
    const col3 = cells[3] || ''; // факт або номер

    if (!unitName || unitName === 'Підрозділ' || unitName === 'ЗАГАЛОМ') return;
    if (posLabel === 'Посада' || posLabel === 'Категорія / Підрозділ' || posLabel === 'ВСЬОГО' || posLabel === 'Особовий склад (штат/факт)' || posLabel === 'Техніка (заповнено слотів)') return;

    let unitId = Object.keys(data).find(uid => data[uid].name === unitName);
    if (!unitId) {
      unitId = slugifyUnitName(unitName);
      if (!data[unitId]) data[unitId] = createDefaultUnit(unitId, unitName);
    }
    ensureUnitPositions(data[unitId]);

    // Якщо це рядок техніки (posLabel починається з "Техніка №")
    const eqMatch = posLabel.match(/^Техніка\s*№\s*(\d+)/i);
    if (eqMatch) {
      ensureEquipmentItems(data[unitId]);
      const eqIdx = parseInt(eqMatch[1], 10) - 1;
      if (eqIdx >= 0 && eqIdx < data[unitId].equipmentItems.length) {
        const item = data[unitId].equipmentItems[eqIdx];
        item.mark = col2 || item.mark;
        item.number = col3 || item.number;
        // галочки в колонках 4-7 (індекси 4,5,6,7)
        ['opRozr','repair','reserve','zvedZagin'].forEach((key, kIdx) => {
          const cellIdx = 4 + kIdx;
          if (cells.length > cellIdx) {
            const val = cells[cellIdx];
            if (val === '+' || val === 'true' || val === '+') item[key] = true;
            else if (val === '-' || val === 'false' || val === '') item[key] = false;
            else item[key] = !!val;
          }
        });
        imported++;
      }
      return;
    }

    // Звичайний рядок позиції особового складу
    if (!col2 && !col3) return;
    const posId = posLabelToId[posLabel];
    if (posId) {
      data[unitId].positions[posId].shtat = col2;
      data[unitId].positions[posId].fakt = col3;
      imported++;
    }
  });

  if (imported > 0) {
    recalcAndSaveShtat(data);
    alert(`Імпортовано ${imported} записів (ODS).`);
  } else {
    alert('Не знайдено даних для імпорту в .ods файлі.');
  }
}

function importShtatHtml(text) {
  const tmp = document.createElement('div');
  tmp.innerHTML = text;
  let table = tmp.querySelector('table');
  if (!table) {
    const trs = tmp.querySelectorAll('tr');
    if (trs.length >= 2) {
      table = document.createElement('table');
      trs.forEach(tr => table.appendChild(tr.cloneNode(true)));
    }
  }
  if (!table) return 0;

  const rows = table.querySelectorAll('tr');
  if (rows.length < 2) return 0;

  const data = loadShtatData();
  const posLabelToId = {};
  SHTAT_POSITIONS.forEach(p => { posLabelToId[p.label] = p.id; });

  let imported = 0;
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].querySelectorAll('td,th');
    if (cells.length < 3) continue;
    const unitName = (cells[0].textContent || '').trim();
    const posLabel = (cells[1].textContent || '').trim();
    const shtat = (cells[2].textContent || '').trim();
    const fakt = (cells[3] && cells[3].textContent || '').trim();

    if (!unitName || unitName === 'Підрозділ' || unitName === 'ЗАГАЛОМ') continue;
    if (posLabel === 'Посада' || posLabel === 'ВСЬОГО') continue;
    if (shtat === 'Штат' || (!shtat && !fakt)) continue;
    if (shtat && isNaN(parseFloat(shtat))) continue;

    let unitId = Object.keys(data).find(uid => data[uid].name === unitName);
    if (!unitId) {
      unitId = slugifyUnitName(unitName);
      if (!data[unitId]) data[unitId] = createDefaultUnit(unitId, unitName);
    }
    ensureUnitPositions(data[unitId]);
    const posId = posLabelToId[posLabel];
    if (posId) {
      data[unitId].positions[posId].shtat = shtat;
      data[unitId].positions[posId].fakt = fakt;
      imported++;
    } else if (shtat) {
      if (!data[unitId].custom) data[unitId].custom = {};
      data[unitId].custom[posLabel] = shtat;
      imported++;
    }
  }

  if (imported > 0) {
    recalcAndSaveShtat(data);
    alert(`Імпортовано ${imported} записів (HTML).`);
  }
  return imported;
}

function recalcAndSaveShtat(data) {
  Object.values(data).forEach(u => {
    let sumS = 0, sumF = 0;
    SHTAT_POSITIONS.forEach(p => {
      sumS += parseFloat(u.positions[p.id]?.shtat) || 0;
      sumF += parseFloat(u.positions[p.id]?.fakt) || 0;
    });
    u.personnelShtat = sumS || '';
    u.personnelFakt = sumF || '';
  });
  saveShtatData(data);
  renderShtatWorkspace();
}

function importShtatJson(text) {
  const imported = JSON.parse(text);
  if (!imported.units || !imported.type || imported.type !== 'shtat_personnel') {
    alert('Невірний формат JSON. Очікується файл експорту Штату (shtat_personnel).');
    return;
  }
  const existing = loadShtatData();
  const newData = {};
  const importUnits = imported.units;
  const importIds = Object.keys(importUnits);
  if (importIds.length === 0) { alert('Файл не містить даних підрозділів.'); return; }
  Object.keys(existing).forEach(uid => { newData[uid] = existing[uid]; });
  importIds.forEach(uid => {
    const imp = importUnits[uid];
    ensureUnitPositions(imp);
    if (newData[uid]) {
      newData[uid].name = imp.name || newData[uid].name;
      if (imp.positions) {
        SHTAT_POSITIONS.forEach(p => {
          if (imp.positions[p.id]) {
            newData[uid].positions[p.id] = {
              shtat: imp.positions[p.id].shtat || '',
              fakt: imp.positions[p.id].fakt || ''
            };
          }
        });
      }
    } else {
      newData[uid] = imp;
    }
  });
  saveShtatData(newData);
  if (imported.customCols) saveShtatCustomCols(imported.customCols);
  renderShtatWorkspace();
  alert(`Імпортовано ${importIds.length} підрозділів (JSON).`);
}

function importShtatCsv(text) {
  // Parse tab-separated or semicolon-separated data
  const clean = text.replace(/^﻿/, '').replace(/^￾/, ''); // strip BOM
  const lines = clean.split(/\r?\n/).filter(l => {
    const t = l.trim();
    return t && !t.startsWith('Підрозділ') && !t.startsWith('﻿Підрозділ');
  });
  if (!lines.length) { alert('CSV файл порожній або не містить даних.'); return; }

  // Detect separator: tab or semicolon
  const sep = lines[0].includes('\t') ? '\t' : ';';

  const data = loadShtatData();
  const posLabelToId = {};
  SHTAT_POSITIONS.forEach(p => { posLabelToId[p.label] = p.id; });

  let imported = 0;
  lines.forEach(line => {
    const cols = line.split(sep);
    if (cols.length < 3) return;
    const unitName = cols[0].trim();
    const posLabel = cols[1].trim();
    const shtat = cols[2].trim();
    const fakt = (cols[3] || '').trim();

    if (!unitName || unitName === 'ВСЬОГО' || unitName === 'ЗАГАЛОМ') return;
    if (posLabel === 'ВСЬОГО' || posLabel === 'Посада') return;
    if (!shtat && !fakt) return; // skip empty rows

    let unitId = Object.keys(data).find(uid => data[uid].name === unitName);
    if (!unitId) {
      unitId = slugifyUnitName(unitName);
      if (!data[unitId]) data[unitId] = createDefaultUnit(unitId, unitName);
    }

    ensureUnitPositions(data[unitId]);
    const posId = posLabelToId[posLabel];
    if (posId) {
      data[unitId].positions[posId].shtat = shtat;
      data[unitId].positions[posId].fakt = fakt;
      imported++;
    } else {
      if (!data[unitId].custom) data[unitId].custom = {};
      data[unitId].custom[posLabel] = shtat;
      imported++;
    }
  });

  if (imported > 0) {
    recalcAndSaveShtat(data);
    alert(`Імпортовано ${imported} записів (CSV).`);
  }
  return imported;
}

function deleteShtatCustomCol(colId) {
  const cols = loadShtatCustomCols();
  const col = cols.find(c => c.id === colId);
  if (!col) return;
  if (!confirm(`Видалити категорію "${col.label}" і всі її дані?`)) return;
  saveShtatCustomCols(cols.filter(c => c.id !== colId));
  // Remove data for this column from all units
  const data = loadShtatData();
  Object.keys(data).forEach(uid => {
    if (data[uid].custom && data[uid].custom[colId] !== undefined) {
      delete data[uid].custom[colId];
    }
  });
  saveShtatData(data);
  renderShtatWorkspace();
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  console.log('[App] DOMContentLoaded, starting init...');

  // Core listeners
  document.getElementById('add-btn').addEventListener('click', openModal);
  document.getElementById('api-key').addEventListener('input', saveApiKey);
  document.getElementById('clear-storage-btn').addEventListener('click', clearStorage);
  document.getElementById('clear-tasks-btn').addEventListener('click', clearTasks);
  const clearAllBtn = document.getElementById('clear-all-btn');
  if (clearAllBtn) clearAllBtn.addEventListener('click', clearAllData);
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-close-btn').addEventListener('click', closeSettings);
  document.getElementById('btn-parse').addEventListener('click', parseWithGemini);

  document.getElementById('edit-modal-close-btn').addEventListener('click', closeEditModal);
  document.getElementById('btn-save-edit').addEventListener('click', saveEditedTask);

  // Tab bar
  document.getElementById('tab-add-btn').addEventListener('click', addNewTab);
  const requiredToggleBtn = document.getElementById('required-toggle-btn');
  if (requiredToggleBtn) requiredToggleBtn.addEventListener('click', () => setRequiredUndatedVisible(!shouldShowRequiredUndated()));
  updateRequiredToggleUI();

  // AI mode toggle (Add modal)
  const aiToggleEl = document.getElementById('ai-mode-toggle');
  if (aiToggleEl) aiToggleEl.addEventListener('change', applyAiModeVisibility);

  initSettings();
  initSettingsNav();
  initOpsWorkspace();
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

  // ---- Штат sub-tabs ----
  document.querySelectorAll('.shtat-subtab').forEach(btn => {
    btn.addEventListener('click', () => setActiveShtatTab(btn.dataset.shtatTab));
  });
  // Init sub-tab state
  setActiveShtatTab(activeShtatTab);

  // ---- Штат add buttons ----
  const shtatAddUnitBtn = document.getElementById('shtat-add-unit-btn');
  if (shtatAddUnitBtn) shtatAddUnitBtn.addEventListener('click', addShtatUnit);
  const shtatAddColBtn = document.getElementById('shtat-add-col-btn');
  if (shtatAddColBtn) shtatAddColBtn.addEventListener('click', addShtatCustomCol);

  // ---- Штат export/import ----
  const shtatExportBtn = document.getElementById('shtat-export-btn');
  if (shtatExportBtn) shtatExportBtn.addEventListener('click', exportShtatData);
  const shtatImportBtn = document.getElementById('shtat-import-btn');
  const shtatImportFile = document.getElementById('shtat-import-file');
  if (shtatImportBtn && shtatImportFile) {
    shtatImportBtn.addEventListener('click', () => shtatImportFile.click());
    shtatImportFile.addEventListener('change', () => {
      if (shtatImportFile.files[0]) {
        importShtatData(shtatImportFile.files[0]);
        shtatImportFile.value = '';
      }
    });
  }

  // Initialize Штат data if empty
  const shtatData = loadShtatData();
  if (!Object.keys(shtatData).length) {
    // noop — loadShtatData already seeds defaults
  }
  renderShtatWorkspace();
});
