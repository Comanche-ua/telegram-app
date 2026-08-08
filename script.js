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
  const forgotBtn = document.getElementById('lock-forgot');
  if (isLockEnabled()) {
    if (lockBtn) lockBtn.style.display = 'flex';
    if (forgotBtn) forgotBtn.style.display = 'block';
    showLockScreen();
  } else {
    if (lockBtn) lockBtn.style.display = 'none';
    if (forgotBtn) forgotBtn.style.display = 'none';
    hideLockScreen();
  }
  const forgot = document.getElementById('lock-forgot');
  if (forgot) forgot.addEventListener('click', resetLockScreenProtection);
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

function resetLockScreenProtection() {
  if (!isLockEnabled()) return;
  if (!confirm('Скинути захист паролем? Список завдань більше не буде приховуватись.')) return;
  localStorage.removeItem(LOCK_HASH_KEY);
  localStorage.removeItem(AUTO_LOCK_ENABLED_KEY);
  localStorage.removeItem(AUTO_LOCK_TIMEOUT_KEY);
  hideLockScreen();
  updateLockStatusUI();
  const forgotBtn = document.getElementById('lock-forgot');
  if (forgotBtn) forgotBtn.style.display = 'none';
  alert('Захист паролем скинуто.');
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

// ---- Tombstone Sync (Синхронізація видалень) ----
const DELETED_KEYS_KEY = 'deadline_tracker_deleted_keys';
const DELETED_WS_KEY = 'deadline_tracker_deleted_workspaces';

function getDeletedKeys() {
  try { return JSON.parse(localStorage.getItem(DELETED_KEYS_KEY)) || {}; }
  catch(e) { return {}; }
}

function saveDeletedKeys(map) {
  localStorage.setItem(DELETED_KEYS_KEY, JSON.stringify(map));
}

function getDeletedWorkspaces() {
  try { return JSON.parse(localStorage.getItem(DELETED_WS_KEY)) || {}; }
  catch(e) { return {}; }
}

function saveDeletedWorkspaces(map) {
  localStorage.setItem(DELETED_WS_KEY, JSON.stringify(map));
}

function markTaskAsDeleted(item) {
  if (!item || !item.text) return;
  const key = `${(item.text || '').trim()}_${item.created || ''}_${item.deadline || ''}`;
  const map = getDeletedKeys();
  map[key] = Date.now();
  saveDeletedKeys(map);
}

function markWorkspaceAsDeleted(id) {
  if (!id) return;
  const map = getDeletedWorkspaces();
  map[id] = Date.now();
  saveDeletedWorkspaces(map);
}

// ---- Tombstones для проєктів та кроків ----
const DELETED_PROJECTS_KEY = 'deadline_tracker_deleted_projects';
const DELETED_ENTRIES_KEY = 'deadline_tracker_deleted_entries';

function getDeletedProjects() {
  try { return JSON.parse(localStorage.getItem(DELETED_PROJECTS_KEY)) || {}; }
  catch(e) { return {}; }
}
function saveDeletedProjects(map) {
  localStorage.setItem(DELETED_PROJECTS_KEY, JSON.stringify(map));
}

function getDeletedProjectEntries() {
  try { return JSON.parse(localStorage.getItem(DELETED_ENTRIES_KEY)) || {}; }
  catch(e) { return {}; }
}
function saveDeletedProjectEntries(map) {
  localStorage.setItem(DELETED_ENTRIES_KEY, JSON.stringify(map));
}

function markProjectAsDeleted(id) {
  if (!id) return;
  const map = getDeletedProjects();
  map[id] = Date.now();
  saveDeletedProjects(map);
}

function markProjectEntryAsDeleted(id) {
  if (!id) return;
  const map = getDeletedProjectEntries();
  map[id] = Date.now();
  saveDeletedProjectEntries(map);
}

function deleteWorkspace(id) {
  if (id === ALL_WORKSPACE_ID) return false;
  const ws = workspaces[id];
  if (!ws) return false;
  const name = ws.name;
  if (!confirm(`⚠️ ВИ ВПЕВНЕНІ? Видалити вкладку "${name}" разом з усіма завданнями?`)) return false;

  if (Array.isArray(ws.items)) {
    ws.items.forEach(it => markTaskAsDeleted(it));
  }
  markWorkspaceAsDeleted(id);

  delete workspaces[id];
  workspaceOrder = workspaceOrder.filter(wid => wid !== id);
  if (activeWorkspaceId === id) {
    activeWorkspaceId = ALL_WORKSPACE_ID;
  }
  saveWorkspaces();
  saveToDrive(); // Негайне видалення з Google Drive
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
  }, 2000);
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
const DEFAULT_CLIENT_ID = '170206231747-am5ds0v9nf10hp1h7k86gs6pdv081737.apps.googleusercontent.com';

function getStoredClientId() {
  // Прибираємо https:// якщо хтось випадково його додав
  const raw = (localStorage.getItem(CLIENT_ID_KEY) || '').trim().replace(/^https?:\/\//, '');
  if (raw && raw.includes('.apps.googleusercontent.com')) {
    return raw;
  }
  return DEFAULT_CLIENT_ID;
}

function saveClientId(clientId) {
  // Прибираємо https:// при збереженні
  const trimmed = (clientId || '').trim().replace(/^https?:\/\//, '');
  localStorage.setItem(CLIENT_ID_KEY, trimmed);
  gisTokenClient = null;
  if (trimmed && trimmed.includes('.apps.googleusercontent.com')) {
    initGisClient();
  }
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
// drive.file — для синхронізації; cloud-platform — для голосового розпізнавання (Speech-to-Text); spreadsheets.readonly — для доступу до штатних таблиць
const GOOGLE_SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/spreadsheets.readonly';

let gisTokenClient = null;

function initGisClient() {
  if (typeof google === 'undefined' || !google.accounts) {
    console.log('[Auth] Google Identity Services not loaded yet');
    return;
  }
  const clientId = getStoredClientId();
  if (!clientId || !clientId.includes('.apps.googleusercontent.com')) {
    console.log('[Auth] Missing or invalid Client ID — skipping GIS init');
    gisTokenClient = null;
    return;
  }
  try {
    gisTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      callback: async (tokenResponse) => {
        if (tokenResponse.error) {
          console.error('[Auth] Token error:', tokenResponse.error);
          alert('Помилка авторизації Google: ' + (tokenResponse.error_description || tokenResponse.error));
          renderAuthUI();
          return;
        }
        console.log('[Auth] Token obtained via GIS');
        localStorage.setItem('google_auth_token', tokenResponse.access_token);
        await handleAuthSuccess(tokenResponse.access_token);
      }
    });
  } catch(e) {
    console.warn('[Auth] GIS init failed:', e);
    gisTokenClient = null;
  }
}

function signInWithGoogle() {
  const clientId = getStoredClientId();
  if (!clientId || !clientId.includes('.apps.googleusercontent.com')) {
    alert('⚠️ Вказано некоректний Google OAuth Client ID!\n\nВідкрийте Налаштування (⚙️ Налаштування → Безпека) і вставте свій дійсний Client ID з Google Cloud Console.');
    document.getElementById('settings-btn')?.click();
    return;
  }

  renderAuthLoading();
  console.log('[Auth] Starting Google login with Client ID:', clientId);

  const isTelegram = Boolean(window.Telegram && window.Telegram.WebApp && (window.Telegram.WebApp.initData || window.Telegram.WebApp.platform));

  // Якщо це Telegram WebApp — НЕ використовуємо GIS (оскільки gsi/transform зависає у WebView iFrame).
  // Використовуємо прямий OAuth 2.0 редирект!
  if (!isTelegram && typeof google !== 'undefined' && google.accounts) {
    if (!gisTokenClient) initGisClient();
    if (gisTokenClient) {
      try {
        gisTokenClient.requestAccessToken();
        return;
      } catch(e) {
        console.warn('[Auth] GIS requestAccessToken failed, fallback to redirect:', e);
      }
    }
  }

  const redirectUri = window.location.origin + window.location.pathname;
  const scope = encodeURIComponent(GOOGLE_SCOPES);
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' +
    'client_id=' + encodeURIComponent(clientId) +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&response_type=token' +
    '&scope=' + scope +
    '&prompt=consent';

  console.log('[Auth] Direct redirect to Google OAuth:', authUrl);
  window.location.href = authUrl;
}

function handleRedirectAuth() {
  // Обробка redirect з implicit grant
  const hash = window.location.hash;
  if (!hash) return;
  const params = new URLSearchParams(hash.substring(1));
  const err = params.get('error');
  if (err) {
    const desc = params.get('error_description') || '';
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    if (err !== 'access_denied') {
      alert('Помилка входу Google: ' + err + (desc ? '\n' + desc : '') +
        '\n\nПеревірте:\n• Client ID у Налаштуваннях → Безпека\n• Ваш URL додано до «Authorized JavaScript origins» і «Authorized redirect URIs» у Google Cloud Console\n• Чи створено OAuth Client ID саме типу «Web application»');
    }
    return;
  }
  if (hash.includes('access_token')) {
    const token = params.get('access_token');
    if (token) {
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

  if (resp && resp.status === 401) {
    console.warn('[Drive] 401 Unauthorized — Token expired or invalid');
    const statusEl = document.getElementById('drive-status');
    if (statusEl) {
      statusEl.innerHTML = '⚠️ Потрібно оновити вхід Google';
      statusEl.style.color = 'var(--red)';
    }
  }

  return resp;
}

async function findDriveFile() {
  const q = `name='${DRIVE_FILE_NAME}' and trashed=false`;
  console.log('[Drive] Searching for file:', DRIVE_FILE_NAME);
  const resp = await driveApiFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=modifiedTime%20desc&fields=files(id,name,modifiedTime)`
  );
  if (!resp) { console.log('[Drive] No response from API'); return null; }
  if (!resp.ok) { console.error('[Drive] API error:', resp.status); return null; }
  const data = await resp.json();
  const files = data.files || [];
  console.log('[Drive] Found files:', files.length);

  if (files.length === 0) return null;

  // Видаляємо дублікати якщо вони випадково виникли
  if (files.length > 1) {
    console.warn('[Drive] Cleaning up duplicate files count:', files.length);
    for (let i = 1; i < files.length; i++) {
      driveApiFetch(`https://www.googleapis.com/drive/v3/files/${files[i].id}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  return files[0];
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
      topSites: customTopSites,
      projectsData: loadProjectsData(),
      deletedKeys: getDeletedKeys(),
      deletedWorkspaces: getDeletedWorkspaces(),
      deletedProjects: getDeletedProjects(),
      deletedEntries: getDeletedProjectEntries(),
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
      console.log('[Drive] Файл не знайдено в Drive, створюємо з локальних даних...');
      await saveToDrive();
      showSyncIndicator(false);
      return;
    }

    const resp = await driveApiFetch(
      `https://www.googleapis.com/drive/v3/files/${existing.id}?alt=media`
    );
    if (!resp || !resp.ok) {
      showSyncIndicator(false);
      return;
    }

    const cloudData = await resp.json();

    // 0. Об'єднуємо реєстр видалень (Tombstones) між локалом та хмарою
    const localDeletedKeys = getDeletedKeys();
    const cloudDeletedKeys = cloudData.deletedKeys || {};
    const mergedDeletedKeys = { ...localDeletedKeys, ...cloudDeletedKeys };
    saveDeletedKeys(mergedDeletedKeys);

    const localDeletedWs = getDeletedWorkspaces();
    const cloudDeletedWs = cloudData.deletedWorkspaces || {};
    const mergedDeletedWs = { ...localDeletedWs, ...cloudDeletedWs };
    saveDeletedWorkspaces(mergedDeletedWs);

    if (cloudData.workspaces && typeof cloudData.workspaces === 'object') {
      let dataChanged = false;

      // 1. Очищаємо видалені вкладки
      Object.keys(mergedDeletedWs).forEach(delId => {
        if (workspaces[delId]) {
          delete workspaces[delId];
          dataChanged = true;
        }
      });

      // 2. Зливаємо вкладки та завдання з урахуванням видалень
      const allWsKeys = new Set([...Object.keys(workspaces), ...Object.keys(cloudData.workspaces)]);

      allWsKeys.forEach(wsKey => {
        if (mergedDeletedWs[wsKey]) {
          delete workspaces[wsKey];
          return;
        }

        const localWs = workspaces[wsKey];
        const cloudWs = cloudData.workspaces[wsKey];

        if (!localWs && cloudWs) {
          workspaces[wsKey] = cloudWs;
          dataChanged = true;
        } else if (localWs && cloudWs) {
          const itemMap = new Map();

          // Локальні завдання (тільки не видалені)
          (localWs.items || []).forEach(it => {
            const itemKey = `${(it.text || '').trim()}_${it.created || ''}_${it.deadline || ''}`;
            if (!mergedDeletedKeys[itemKey]) {
              itemMap.set(itemKey, { ...it });
            } else {
              dataChanged = true;
            }
          });

          // Хмарні завдання (тільки не видалені)
          (cloudWs.items || []).forEach(cItem => {
            const itemKey = `${(cItem.text || '').trim()}_${cItem.created || ''}_${cItem.deadline || ''}`;
            if (mergedDeletedKeys[itemKey]) {
              dataChanged = true;
              return;
            }

            if (!itemMap.has(itemKey)) {
              itemMap.set(itemKey, { ...cItem });
              dataChanged = true;
            } else {
              const existing = itemMap.get(itemKey);
              if (cItem.done !== existing.done) {
                // Last-write-wins: compare completedAt timestamps
                const cloudTime = cItem.completedAt ? new Date(cItem.completedAt).getTime() : 0;
                const localTime = existing.completedAt ? new Date(existing.completedAt).getTime() : 0;
                if (cloudTime > localTime) {
                  // Cloud version is newer — take it
                  existing.done = cItem.done;
                  existing.completedAt = cItem.completedAt;
                  dataChanged = true;
                } else {
                  // Local version is newer — push it to cloud
                  dataChanged = true;
                }
              }
            }
          });

          localWs.items = Array.from(itemMap.values());
        }

        // Застосовуємо фільтр видалень до кожної вкладки
        if (workspaces[wsKey] && Array.isArray(workspaces[wsKey].items)) {
          const origCount = workspaces[wsKey].items.length;
          workspaces[wsKey].items = workspaces[wsKey].items.filter(it => {
            const itemKey = `${(it.text || '').trim()}_${it.created || ''}_${it.deadline || ''}`;
            return !mergedDeletedKeys[itemKey];
          });
          if (workspaces[wsKey].items.length !== origCount) dataChanged = true;
        }
      });

      // 3. Зливаємо workspaceOrder і прибираємо видалені вкладки
      if (Array.isArray(cloudData.workspaceOrder)) {
        cloudData.workspaceOrder.forEach(wid => {
          if (workspaces[wid] && !workspaceOrder.includes(wid) && !mergedDeletedWs[wid]) {
            workspaceOrder.push(wid);
            dataChanged = true;
          }
        });
      }
      workspaceOrder = workspaceOrder.filter(wid => workspaces[wid] && !mergedDeletedWs[wid]);

      // Зберігаємо локально
      localStorage.setItem(WORKSPACES_KEY, JSON.stringify(workspaces));
      localStorage.setItem(WORKSPACE_ORDER_KEY, JSON.stringify(workspaceOrder));

      // Зливаємо базу виконавців
      if (cloudData.assignees && Array.isArray(cloudData.assignees)) {
        const localDB = loadAssigneeDB();
        const merged = [...new Set([...localDB, ...cloudData.assignees])].sort((a, b) => a.localeCompare(b, 'uk'));
        saveAssigneeDB(merged);
      }

      // Зливаємо посилання (topSites)
      if (cloudData.topSites && Array.isArray(cloudData.topSites)) {
        const localIds = new Set(customTopSites.map(s => s.id));
        let sitesChanged = false;
        cloudData.topSites.forEach(cs => {
          if (!localIds.has(cs.id)) {
            customTopSites.push(cs);
            sitesChanged = true;
            dataChanged = true;
          }
        });
        if (sitesChanged) {
          saveCustomTopSites();
        }
      }

      if (dataChanged) {
        console.log('[Drive] Синхронізація завершена, оновлюємо файл в Drive...');
        await saveToDrive();
      }

      // Повна перемальовка всього UI
      const items = getActiveItems();
      if (items.length) {
        renderCards();
        startTimers();
      } else {
        renderEmpty();
      }
      renderTabBar();
      renderAssigneeChips();
      populateDatalist();
      updateCalendarVisibility();
      // Перемальовуємо посилання на обох блоках
      try { renderTopSites('top-sites', true); } catch(e) {}
      try { renderTopSites('lock-top-sites', false); } catch(e) {}

      // Зливаємо реєстр видалень проєктів та кроків
      if (cloudData.deletedProjects) {
        const localDelPrj = getDeletedProjects();
        Object.assign(localDelPrj, cloudData.deletedProjects);
        saveDeletedProjects(localDelPrj);
      }
      if (cloudData.deletedEntries) {
        const localDelEnt = getDeletedProjectEntries();
        Object.assign(localDelEnt, cloudData.deletedEntries);
        saveDeletedProjectEntries(localDelEnt);
      }

      const deletedProjectsMap = getDeletedProjects();
      const deletedEntriesMap = getDeletedProjectEntries();

      // Застосовуємо видалення локально
      let localProjects = loadProjectsData();
      let prjDataChanged = false;

      const origPrjCount = localProjects.projects.length;
      localProjects.projects = localProjects.projects.filter(p => !deletedProjectsMap[p.id]);
      if (localProjects.projects.length !== origPrjCount) {
        prjDataChanged = true;
        dataChanged = true;
      }

      localProjects.projects.forEach(p => {
        if (Array.isArray(p.entries)) {
          const origEntCount = p.entries.length;
          p.entries = p.entries.filter(e => !deletedEntriesMap[e.id]);
          if (p.entries.length !== origEntCount) {
            prjDataChanged = true;
            dataChanged = true;
          }
        }
      });

      // Зливаємо з хмарними проєктами
      if (cloudData.projectsData && Array.isArray(cloudData.projectsData.projects)) {
        const localIds = new Set(localProjects.projects.map(p => p.id));

        cloudData.projectsData.projects.forEach(cp => {
          if (deletedProjectsMap[cp.id]) return; // Пропускаємо видалений проєкт

          if (!localIds.has(cp.id)) {
            cp.entries = (cp.entries || []).filter(e => !deletedEntriesMap[e.id]);
            localProjects.projects.push(cp);
            prjDataChanged = true;
            dataChanged = true;
          } else {
            const lp = localProjects.projects.find(p => p.id === cp.id);
            if (lp) {
              const localEntryIds = new Set((lp.entries || []).map(e => e.id));
              const localEntryMap = new Map((lp.entries || []).map(e => [e.id, e]));
              (cp.entries || []).forEach(ce => {
                if (!deletedEntriesMap[ce.id]) {
                  if (!localEntryIds.has(ce.id)) {
                    // New entry from cloud — add it
                    lp.entries = lp.entries || [];
                    lp.entries.push(ce);
                    prjDataChanged = true;
                    dataChanged = true;
                  } else {
                    // Entry exists on both — sync done state via last-write-wins
                    const le = localEntryMap.get(ce.id);
                    if (le && ce.done !== le.done) {
                      const cloudTime = ce.completedAt ? new Date(ce.completedAt).getTime() : 0;
                      const localTime = le.completedAt ? new Date(le.completedAt).getTime() : 0;
                      if (cloudTime > localTime) {
                        le.done = ce.done;
                        le.completedAt = ce.completedAt;
                        prjDataChanged = true;
                        dataChanged = true;
                      } else {
                        prjDataChanged = true;
                        dataChanged = true;
                      }
                    }
                  }
                }
              });
            }
          }
        });
      }

      if (prjDataChanged) {
        saveProjectsData(localProjects);
        try { renderProjectsWorkspace(); } catch(e) {}
      }
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

  // Очищаємо всі дані акаунту з локального сховища
  localStorage.removeItem(WORKSPACES_KEY);
  localStorage.removeItem(WORKSPACE_ORDER_KEY);
  localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
  localStorage.removeItem(OLD_ITEMS_KEY);
  localStorage.removeItem(DELETED_KEYS_KEY);
  localStorage.removeItem(DELETED_WS_KEY);
  localStorage.removeItem(DELETED_PROJECTS_KEY);
  localStorage.removeItem(DELETED_ENTRIES_KEY);
  localStorage.removeItem(PROJECTS_DATA_KEY);
  localStorage.removeItem(TOPSITES_KEY);
  localStorage.removeItem(ASSIGNEES_DB_KEY);

  // Скидаємо всі змінні в пам'яті
  workspaces = {};
  workspaceOrder = [];
  activeWorkspaceId = ALL_WORKSPACE_ID;
  customTopSites = [];

  if (ticker) clearInterval(ticker);

  // Оновлюємо та очищаємо весь UI
  renderEmpty();
  renderTabBar();
  renderAuthUI();
  updateCalendarVisibility();
  try { renderProjectsWorkspace(); } catch(e) {}
  try { renderAssigneeChips(); } catch(e) {}
  try { populateDatalist(); } catch(e) {}
  try { renderTopSites('top-sites', true); } catch(e) {}
  try { renderTopSites('lock-top-sites', false); } catch(e) {}
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
function updateShtatAuthStatus() {
  const el = document.getElementById('sheets-google-status');
  if (!el) return;
  const token = localStorage.getItem('google_auth_token');
  if (token) {
    el.textContent = '✅ авторизовано';
    el.style.color = 'var(--green)';
  } else {
    el.textContent = 'не авторизовано';
    el.style.color = 'var(--text3)';
  }
}

function renderAuthUI() {
  console.log('[Auth] renderAuthUI called, currentUser:', currentUser);
  const section = document.getElementById('auth-section');
  const settingsBox = document.getElementById('settings-auth-box');

  if (currentUser) {
    if (section) {
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
      profile?.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown?.classList.toggle('active');
      });

      document.getElementById('btn-signout')?.addEventListener('click', (e) => {
        e.stopPropagation();
        signOutGoogle();
      });

      document.getElementById('btn-sync-now')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        showSyncIndicator(true);
        await saveToDrive();
        await loadFromDrive();
        showSyncIndicator(false);
        dropdown?.classList.remove('active');
      });

      document.addEventListener('click', () => {
        dropdown?.classList.remove('active');
      });
    }

    if (settingsBox) {
      settingsBox.innerHTML = `
        <div style="background:rgba(52,168,83,.1);border:1px solid rgba(52,168,83,.3);border-radius:10px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div>
            <div style="font-weight:700;font-size:12px;color:var(--green)">✅ Google авторизовано</div>
            <div style="font-size:11px;color:var(--text2)">${escHtml(currentUser.email)}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button type="button" id="settings-btn-sync" style="background:var(--blue);color:#fff;border:none;border-radius:6px;padding:5px 9px;font-size:11px;cursor:pointer">🔄 Синхрон.</button>
            <button type="button" id="settings-btn-logout" style="background:rgba(255,255,255,.1);color:var(--red);border:1px solid var(--line);border-radius:6px;padding:5px 9px;font-size:11px;cursor:pointer">🚪 Вийти</button>
          </div>
        </div>
      `;
      document.getElementById('settings-btn-sync')?.addEventListener('click', async () => {
        showSyncIndicator(true);
        await saveToDrive();
        await loadFromDrive();
        showSyncIndicator(false);
      });
      document.getElementById('settings-btn-logout')?.addEventListener('click', () => signOutGoogle());
    }

  } else {
    if (section) {
      section.innerHTML = `
        <button class="auth-btn" id="btn-google-signin">
          <svg viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          Увійти через Google
        </button>
      `;
      document.getElementById('btn-google-signin')?.addEventListener('click', signInWithGoogle);
    }

    if (settingsBox) {
      settingsBox.innerHTML = `
        <button class="auth-btn" id="settings-btn-google-signin" style="width:100%;justify-content:center;padding:8px 12px">
          <svg viewBox="0 0 24 24" style="width:16px;height:16px"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          Увійти через Google (для Google Drive)
        </button>
        <div style="margin-top:6px;text-align:center;">
          <button id="settings-manual-token-btn" type="button" style="background:none;border:none;color:var(--text3);font-size:11px;cursor:pointer;text-decoration:underline;">🔑 Вставити токен авторизації вручну</button>
        </div>
      `;
      document.getElementById('settings-btn-google-signin')?.addEventListener('click', signInWithGoogle);
      document.getElementById('settings-manual-token-btn')?.addEventListener('click', () => {
        const input = prompt('Вставте токен доступу Google (або посилання після авторизації):');
        if (input && input.trim()) {
          const match = input.match(/access_token=([^&]+)/);
          const token = match ? match[1] : input.trim();
          handleAuthSuccess(token);
        }
      });
    }
  }
  updateShtatAuthStatus();
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

  updateTabScrollButtons();
}

// ---- Повільна прокрутка вкладок стрілками (ПК) ----
let slowTabScrollTimer = null;

function updateTabScrollButtons() {
  const bar = document.getElementById('tab-bar');
  const list = document.getElementById('tab-list');
  const leftBtn = document.getElementById('tab-scroll-left');
  const rightBtn = document.getElementById('tab-scroll-right');
  if (!bar || !list) return;
  const canScroll = list.scrollWidth > list.clientWidth + 1;
  bar.classList.toggle('has-scroll', canScroll);
  if (leftBtn) leftBtn.disabled = list.scrollLeft <= 0;
  if (rightBtn) rightBtn.disabled = list.scrollLeft + list.clientWidth >= list.scrollWidth - 1;
}

function startSlowTabScroll(dir) {
  const list = document.getElementById('tab-list');
  if (!list) return;
  stopSlowTabScroll();
  slowTabScrollTimer = setInterval(() => {
    const maxLeft = list.scrollWidth - list.clientWidth;
    if (dir < 0 && list.scrollLeft <= 0) { stopSlowTabScroll(); return; }
    if (dir > 0 && list.scrollLeft >= maxLeft) { stopSlowTabScroll(); return; }
    list.scrollLeft += dir * 2;
    updateTabScrollButtons();
  }, 30);
}

function stopSlowTabScroll() {
  if (slowTabScrollTimer) {
    clearInterval(slowTabScrollTimer);
    slowTabScrollTimer = null;
  }
}

function initTabScrollArrows() {
  const leftBtn = document.getElementById('tab-scroll-left');
  const rightBtn = document.getElementById('tab-scroll-right');
  if (!leftBtn || !rightBtn) return;
  const hold = (btn, dir) => {
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); startSlowTabScroll(dir); });
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); startSlowTabScroll(dir); });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel', 'contextmenu'].forEach(ev =>
      btn.addEventListener(ev, stopSlowTabScroll)
    );
  };
  hold(leftBtn, -1);
  hold(rightBtn, 1);
  window.addEventListener('resize', updateTabScrollButtons);
  updateTabScrollButtons();
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
  saveToDrive();
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
  saveToDrive();
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
    const deletedItem = ws.items[idx];
    if (deletedItem) {
      markTaskAsDeleted(deletedItem); // Записуємо у файл Tombstone для синхронізації видалення
    }
    ws.items.splice(idx, 1);
    saveWorkspaces();
    saveToDrive(); // Негайна відправка видалення в Google Drive

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
    saveToDrive(); // Негайне відправлення нових завдань у хмару
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
  // Let CSS control the display size (60px desktop, 52px mobile via media query)

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
  const innerR = radius - 9;

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

  // Inner circle — neon pulsing glow
  const t = Date.now() / 1000;
  const pulse = (Math.sin(t * 2.2) + 1) / 2; // 0..1 smooth cycle

  // Pick neon accent colors by status
  let neonA, neonB;
  if (isOverdue || progress > 0.7) { neonA = '#FF003C'; neonB = '#FF6B6B'; }
  else if (progress > 0.4)         { neonA = '#FF8C00'; neonB = '#FFD700'; }
  else                              { neonA = '#00F5FF'; neonB = '#A78BFA'; }

  // Much brighter glow ranges
  const glowAlpha = 0.45 + pulse * 0.45; // 0.45..0.90
  const glowBlur  = 18  + pulse * 32;    // 18..50

  // Dark base fill
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, innerR, 0, 2 * Math.PI);
  ctx.fillStyle = '#080C16';
  ctx.fill();

  // Radial gradient — bright neon bloom from center
  const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, innerR);
  grad.addColorStop(0,    `${neonA}${Math.round(glowAlpha * 255).toString(16).padStart(2,'0')}`);
  grad.addColorStop(0.45, `${neonB}${Math.round(glowAlpha * 0.55 * 255).toString(16).padStart(2,'0')}`);
  grad.addColorStop(0.85, `${neonA}${Math.round(glowAlpha * 0.15 * 255).toString(16).padStart(2,'0')}`);
  grad.addColorStop(1,    'transparent');
  ctx.beginPath();
  ctx.arc(centerX, centerY, innerR, 0, 2 * Math.PI);
  ctx.fillStyle = grad;
  ctx.fill();

  // Outer neon ring glow — thick pass
  ctx.beginPath();
  ctx.arc(centerX, centerY, innerR, 0, 2 * Math.PI);
  ctx.strokeStyle = neonA;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.55 + pulse * 0.45; // 0.55..1.0
  ctx.shadowColor = neonA;
  ctx.shadowBlur = glowBlur;
  ctx.stroke();

  // Second inner ring pass — tighter, hotter core glow
  ctx.beginPath();
  ctx.arc(centerX, centerY, innerR - 3, 0, 2 * Math.PI);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.12 + pulse * 0.35; // 0.12..0.47
  ctx.shadowColor = neonA;
  ctx.shadowBlur = glowBlur * 0.6;
  ctx.stroke();

  ctx.restore();

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

// ---- Deadline focus slider (presentation state only; task data is untouched) ----
const DEADLINE_FILTER_KEY = 'deadline_focus_filter';
let activeDeadlineFilter = 'all';
localStorage.removeItem(DEADLINE_FILTER_KEY);

function shouldShowDeadlineSection(key) {
  return true;
}

function renderDeadlineFocus() {
  const items = getActiveItems().filter(item => !item.done);
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const counts = { all: items.length, critical: 0, today: 0, upcoming: 0 };

  items.forEach(item => {
    if (!item.deadline) { counts.critical++; return; }
    const deadline = getDeadlineEnd(item.deadline, item.deadlineTime);
    if (deadline < now) counts.critical++;
    else if (item.deadline === today) counts.today++;
    else counts.upcoming++;
  });

  Object.entries(counts).forEach(([key, value]) => {
    const element = document.getElementById(`focus-count-${key}`);
    if (element) element.textContent = value;
  });

  const labels = { all: 'Усі активні', critical: 'Критичні строки', today: 'Фокус на сьогодні', upcoming: 'Наступні строки' };
  const label = document.getElementById('deadline-focus-label');
  if (label) label.textContent = labels[activeDeadlineFilter] || labels.all;
  document.querySelectorAll('[data-deadline-filter]').forEach(button => {
    const selected = button.dataset.deadlineFilter === activeDeadlineFilter;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
}

function setDeadlineFocus(filter) {
  activeDeadlineFilter = ['all', 'critical', 'today', 'upcoming'].includes(filter) ? filter : 'all';
  localStorage.setItem(DEADLINE_FILTER_KEY, activeDeadlineFilter);
  renderCards();
}

function initDeadlineFocusUI() {
  document.querySelectorAll('[data-deadline-filter]').forEach(button => {
    button.addEventListener('click', () => setDeadlineFocus(button.dataset.deadlineFilter));
    button.addEventListener('keydown', event => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const buttons = [...document.querySelectorAll('[data-deadline-filter]')];
        const index = buttons.indexOf(button);
        const next = event.key === 'ArrowRight' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
        buttons[next].focus();
        setDeadlineFocus(buttons[next].dataset.deadlineFilter);
      }
    });
  });

  const slider = document.getElementById('deadline-slider');
  if (slider) {
    let startX = null;
    slider.addEventListener('touchstart', event => { startX = event.changedTouches[0]?.clientX ?? null; }, { passive: true });
    slider.addEventListener('touchend', event => {
      const endX = event.changedTouches[0]?.clientX;
      if (startX === null || endX === undefined || Math.abs(endX - startX) < 42) return;
      const filters = ['all', 'critical', 'today', 'upcoming'];
      const index = filters.indexOf(activeDeadlineFilter);
      const next = endX < startX ? Math.min(index + 1, filters.length - 1) : Math.max(index - 1, 0);
      if (next !== index) setDeadlineFocus(filters[next]);
      startX = null;
    }, { passive: true });
  }
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
      if (!shouldShowDeadlineSection(def.key)) return;
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

    if (!container.children.length) {
      container.innerHTML = '<div class="empty empty-state">У цьому фільтрі поки немає завдань. Оберіть інший період або додайте нове.</div>';
    }

    activeItems.forEach(item => {
      const wsId = item._workspaceId || activeWorkspaceId;
      const wsIdx = item._wsIndex !== undefined ? item._wsIndex : 0;
      const viewKey = item._viewKey || String(wsIdx);
      if (item.deadline) drawTimer(`timer_${wsId}_${viewKey}`, item.deadline, item.deadlineTime);
    });
  }

  // Completed section
  if (activeDeadlineFilter === 'all' && completedItems.length > 0) {
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

  renderDeadlineFocus();
  updateCalendarVisibility();
}

// ---- Побудова однієї картки завдання (винесено окремо для секцій) ----
function createTimerRabbit(status) {
  const ns = 'http://www.w3.org/2000/svg';
  const rabbit = document.createElementNS(ns, 'svg');
  rabbit.setAttribute('class', `timer-rabbit ${status}`);
  rabbit.setAttribute('viewBox', '-8 -8 56 56');
  rabbit.setAttribute('overflow', 'visible');
  rabbit.setAttribute('aria-hidden', 'true');

  let bodyFill = '#8B5CF6';
  let earOuter = '#7C3AED';
  let earInner = '#F0ABFC';
  let legFill  = '#3730A3';
  let bellyFill= '#C4B5FD';
  let strokeCol= '#1E1B4B';

  if (status === 'warn') {
    bodyFill = '#F59E0B';
    earOuter = '#D97706';
    earInner = '#FEF3C7';
    legFill  = '#B45309';
    bellyFill= '#FDE68A';
    strokeCol= '#78350F';
  } else if (status === 'urgent' || status === 'critical' || status === 'over') {
    bodyFill = '#F43F5E';
    earOuter = '#E11D48';
    earInner = '#FECDD3';
    legFill  = '#9F1239';
    bellyFill= '#FFE4E6';
    strokeCol= '#4C0519';
  }

  rabbit.innerHTML = `
    <g class="hopper" stroke="${strokeCol}" stroke-width="1.1" stroke-linejoin="round">
      <rect class="leg back" x="20" y="29" width="3.4" height="7" rx="1.6" fill="${legFill}"/>
      <ellipse cx="17" cy="24" rx="10" ry="8" fill="${bodyFill}"/>
      <ellipse cx="15" cy="26" rx="5.5" ry="4.5" fill="${bellyFill}" stroke="none"/>
      <rect class="leg front" x="11" y="29" width="3.4" height="7" rx="1.6" fill="${legFill}"/>
      <circle cx="26.5" cy="24.5" r="3" fill="#ffffff"/>
      <circle cx="17" cy="15" r="7.2" fill="${bodyFill}"/>
      <g class="ear left">
        <ellipse cx="14" cy="7" rx="3.1" ry="9.5" fill="${earOuter}"/>
        <ellipse cx="14" cy="8.5" rx="1.4" ry="6.5" fill="${earInner}" stroke="none"/>
      </g>
      <g class="ear right">
        <ellipse cx="20" cy="7" rx="3.1" ry="9.5" fill="${earOuter}"/>
        <ellipse cx="20" cy="8.5" rx="1.4" ry="6.5" fill="${earInner}" stroke="none"/>
      </g>
      <circle cx="13" cy="17" r="2.4" fill="#ffffff" stroke="none"/>
      <circle cx="11.5" cy="16.7" r="0.8" fill="#EC4899" stroke="none"/>
      <circle class="rabbit-eye" cx="14.5" cy="13.5" r="1.1" fill="#00F5FF" stroke="none">
        <animate attributeName="r" values="1.1;1.7;0.9;1.7;1.1" dur="1.8s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.6 1; 0.4 0 0.6 1; 0.4 0 0.6 1; 0.4 0 0.6 1"/>
        <animate attributeName="fill" values="#00F5FF;#A78BFA;#EC4899;#00F5FF;#F0ABFC;#00F5FF" dur="1.8s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="1;0.7;1;0.8;1" dur="1.8s" repeatCount="indefinite"/>
      </circle>
    </g>`;
  return rabbit;
}

// ---- Mobile swipe-to-reveal card actions ----
// Swipe left → slide card body left, reveal delete/edit/complete strip
// Swipe right or tap outside → close
const SWIPE_THRESHOLD = 30;  // px min horizontal drag
const SWIPE_REVEAL_PX = 126; // px to reveal 3 action buttons (delete, complete, edit)

function addSwipeReveal(cardDiv, cardBody) {
  let tx = 0, startX = 0, startY = 0, dragging = false, locked = false;

  function closeAllOtherCards() {
    document.querySelectorAll('.card-swiped').forEach(c => {
      if (c !== cardDiv) closeReveal(c);
    });
  }

  function closeReveal(card) {
    const body = card.querySelector('.card-body');
    if (body) { body.style.transform = ''; body.style.transition = 'transform 0.25s cubic-bezier(.25,.8,.25,1)'; }
    card.classList.remove('card-swiped');
  }

  function openReveal() {
    closeAllOtherCards();
    cardBody.style.transition = 'transform 0.25s cubic-bezier(.25,.8,.25,1)';
    cardBody.style.transform = `translateX(-${SWIPE_REVEAL_PX}px)`;
    cardDiv.classList.add('card-swiped');
    cardDiv.querySelectorAll('.task-action-btn, .delete-task-btn').forEach(b => {
      b.style.opacity = '1';
      b.style.pointerEvents = 'auto';
    });
  }

  function closeThis() {
    cardBody.style.transition = 'transform 0.25s cubic-bezier(.25,.8,.25,1)';
    cardBody.style.transform = '';
    cardDiv.classList.remove('card-swiped');
    cardDiv.querySelectorAll('.task-action-btn, .delete-task-btn').forEach(b => {
      b.style.opacity = '';
      b.style.pointerEvents = '';
    });
  }

  cardDiv.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragging = true;
    locked = false;
    cardBody.style.transition = 'none';
  }, { passive: true });

  cardDiv.addEventListener('touchmove', e => {
    if (!dragging) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    // Lock to horizontal if first significant move is horizontal
    if (!locked) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      locked = true;
      if (Math.abs(dy) > Math.abs(dx)) { dragging = false; return; } // vertical scroll
    }

    // Prevent page scroll during horizontal swipe
    e.preventDefault();

    const isSwiped = cardDiv.classList.contains('card-swiped');
    const base = isSwiped ? -SWIPE_REVEAL_PX : 0;
    tx = Math.min(0, Math.max(-SWIPE_REVEAL_PX - 8, base + dx));
    cardBody.style.transform = `translateX(${tx}px)`;
  }, { passive: false });

  cardDiv.addEventListener('touchend', e => {
    if (!dragging) return;
    dragging = false;
    const dx = e.changedTouches[0].clientX - startX;
    const isSwiped = cardDiv.classList.contains('card-swiped');

    if (!isSwiped && dx < -SWIPE_THRESHOLD) {
      openReveal();
    } else if (isSwiped && dx > SWIPE_THRESHOLD) {
      closeThis();
    } else if (isSwiped) {
      openReveal(); // snap back to open
    } else {
      closeThis();  // snap back to closed
    }
  }, { passive: true });

  // Tap outside any open card → close
  document.addEventListener('touchstart', e => {
    if (cardDiv.classList.contains('card-swiped') && !cardDiv.contains(e.target)) {
      closeThis();
    }
  }, { passive: true });
}



function buildTaskCard(item, arrIdx, isAllView, nearestId) {
      const wsId = item._workspaceId || activeWorkspaceId;
      const wsIdx = item._wsIndex !== undefined ? item._wsIndex : arrIdx;
      const viewKey = item._viewKey || String(wsIdx);
      const { str, cls } = countdownData(item.deadline, item.deadlineTime);
      const formatDeadlineWithDow = (ymd) => {
        if (!ymd) return '';
        const parts = ymd.split('-');
        if (parts.length !== 3) return ymd;
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        const dowNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const dow = dowNames[d.getDay()];
        return `${dow}, ${parts[2].padStart(2, '0')}.${parts[1].padStart(2, '0')}.${parts[0]}`;
      };
      const dateStr = item.deadline ? formatDeadlineWithDow(item.deadline) : '';
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
        impBadge.textContent = '❗';
        impBadge.title = 'Важлива задача';
        impBadge.style = 'font-size:16px; color:var(--red); flex-shrink:0;';
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

      let ringHtml = '';
      if (item.deadline) {
        let pct = Math.round(progressFrac * 100);
        if (item.created || item.createdAt) {
          const end = getDeadlineEnd(item.deadline, item.deadlineTime);
          const start = new Date(item.created || item.createdAt);
          const now = new Date();
          const total = end - start;
          const elapsed = now - start;
          if (total > 0) {
            pct = Math.min(Math.max(Math.round((elapsed / total) * 100), 0), 100);
          } else {
            pct = 100;
          }
        }
        ringHtml = ` <span class="deadline-ring" style="--pct: ${pct}"><span class="deadline-ring-dot"></span></span>`;
      }

      dateSpan.innerHTML = `📅 ${dateStr}${timeStr}${ringHtml}`;
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
      timerTextWrap.className = 'timer-time-wrap';
      const timerTextSpan = document.createElement('span');
      timerTextSpan.id = `txt_${wsId}_${viewKey}`;
      timerTextSpan.className = `timer-text ${cls}`;
      timerTextSpan.textContent = str;
      const timerLabel = document.createElement('span');
      timerLabel.className = 'timer-label';
      timerLabel.textContent = isOverdue ? '' : 'ЗАЛИШИЛОСЬ';
      timerTextWrap.appendChild(timerTextSpan);
      timerTextWrap.appendChild(timerLabel);
      const timerOrbit = document.createElement('div');
      timerOrbit.className = 'timer-orbit timer-orbit-wrap';
      timerOrbit.appendChild(canvas);
      timerOrbit.appendChild(createTimerRabbit(cls));
      timerSection.appendChild(timerOrbit);
      timerSection.appendChild(timerTextWrap);

      // Helper to handle both touch and click reliably on mobile & desktop
      const bindAction = (el, fn) => {
        let touchEnded = false;
        el.addEventListener('touchend', (e) => {
          e.stopPropagation();
          e.preventDefault();
          touchEnded = true;
          fn();
        });
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (touchEnded) { touchEnded = false; return; }
          fn();
        });
      };

      // Delete, complete, edit buttons (absolute right)
      const deleteSpan = document.createElement('div');
      deleteSpan.className = 'task-action-btn task-action-delete delete-task-btn';
      deleteSpan.innerHTML = '🗑️';
      deleteSpan.title = 'Видалити';
      bindAction(deleteSpan, () => deleteTaskByIdx(wsIdx, wsId));

      const completeSpan = document.createElement('div');
      completeSpan.className = 'task-action-btn task-action-complete';
      completeSpan.innerHTML = '✅';
      completeSpan.title = 'Виконано';
      bindAction(completeSpan, () => completeTaskByIdx(wsIdx, wsId));

      const editSpan = document.createElement('div');
      editSpan.className = 'task-action-btn task-action-edit';
      editSpan.innerHTML = '✏️';
      editSpan.title = 'Редагувати';
      bindAction(editSpan, () => openEditModal(wsIdx, wsId));

      // Desktop hover
      cardDiv.addEventListener('mouseenter', () => {
        editSpan.style.opacity = '1';
        completeSpan.style.opacity = '1';
      });
      cardDiv.addEventListener('mouseleave', () => {
        editSpan.style.opacity = '0';
        completeSpan.style.opacity = '0';
      });

      // Mobile swipe-to-reveal action buttons
      addSwipeReveal(cardDiv, cardBody);


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
        timerLabel.textContent = isOverdue ? '' : 'ЗАЛИШИЛОСЬ';
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
  startCanvasGlowLoop();
}

// Smooth 60fps canvas glow loop — only redraws timers, no heavy logic
let _glowRaf = null;
function startCanvasGlowLoop() {
  if (_glowRaf) cancelAnimationFrame(_glowRaf);
  function loop() {
    const items = getActiveItems().filter(i => !i.done && i.deadline);
    items.forEach(item => {
      const wsId = item._workspaceId || activeWorkspaceId;
      const wsIdx = item._wsIndex !== undefined ? item._wsIndex : 0;
      const viewKey = item._viewKey || String(wsIdx);
      drawTimer(`timer_${wsId}_${viewKey}`, item.deadline, item.deadlineTime);
    });
    _glowRaf = requestAnimationFrame(loop);
  }
  _glowRaf = requestAnimationFrame(loop);
}


// ---- Календар ----
let calYear, calMonth;

function updateCalendarVisibility() {
  const section = document.getElementById('calendar-section');
  if (!section) return;
  section.style.display = 'block';
  renderCalendar();
  renderTopAssignees();
}

function renderStats() {
  // Stats widget removed per user request
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
  let html = dayNames.map((d, idx) => {
    const isWeekend = idx >= 5;
    return `<div class="cal-dow dow-${idx} ${isWeekend ? 'weekend-dow' : ''}">${d}</div>`;
  }).join('');

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
    if (!key) return;
    deadlineMap.set(key, (deadlineMap.get(key) || 0) + 1);
    const end = getDeadlineEnd(item.deadline, item.deadlineTime);
    if (end < nowDate) urgentSet.add(key);
    else if ((end - nowDate) < 86400000) urgentSet.add(key);
    else if ((end - nowDate) < 259200000) warnSet.add(key);
  });

  const todayStr = now.toISOString().split('T')[0];

  // Previous month cells
  for (let i = startDow - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    const colIndex = (startDow - 1 - i) % 7;
    const isWeekend = colIndex >= 5;
    html += `<div class="cal-cell other-month ${isWeekend ? 'weekend-cell' : ''}">${d}</div>`;
  }

  // Current month cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const colIndex = (startDow + d - 1) % 7;
    const isWeekend = colIndex >= 5;
    let cls = 'cal-cell';
    if (isWeekend) cls += ' weekend-cell';
    if (dateStr === todayStr) cls += ' today';

    const count = deadlineMap.get(dateStr) || 0;
    let badgeHtml = '';
    if (count > 0) {
      cls += ' has-events';
      let urgencyCls = 'normal';
      if (urgentSet.has(dateStr)) urgencyCls = 'urgent';
      else if (warnSet.has(dateStr)) urgencyCls = 'warn';
      badgeHtml = `<span class="cal-count-badge ${urgencyCls}">${count}</span>`;
    }

    html += `<div class="${cls}" data-date="${dateStr}" onclick="showDayEvents('${dateStr}')"><span class="cal-day-num">${d}</span>${badgeHtml}</div>`;
  }

  // Next month cells
  const totalCells = startDow + daysInMonth;
  const remaining = totalCells % 7 ? 7 - (totalCells % 7) : 0;
  for (let d = 1; d <= remaining; d++) {
    const colIndex = (totalCells + d - 1) % 7;
    const isWeekend = colIndex >= 5;
    html += `<div class="cal-cell other-month ${isWeekend ? 'weekend-cell' : ''}">${d}</div>`;
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
  saveToDrive(); // Негайне відправлення нового завдання в хмару

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
  closeModal();

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
  renderAuthUI();
  document.getElementById('settingsModal').classList.add('active');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('active');
}

// ---- Edit mode (UI chrome visibility) ----
function loadEditMode() {
  const stored = localStorage.getItem(EDIT_MODE_KEY);
  if (stored === null) return true; // default: ON
  return stored === 'true';
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
  const savedSize = localStorage.getItem('ext_card_size') || 'normal';

  // Screen lock (password protect)
  updateLockStatusUI();
  const setLockBtn = document.getElementById('set-lock-password-btn');
  const removeLockBtn = document.getElementById('remove-lock-password-btn');
  const lockPassInput = document.getElementById('lock-password-new');
  if (setLockBtn && lockPassInput) {
    setLockBtn.addEventListener('click', async () => {
      const val = lockPassInput.value;
      if (!val || val.length < 3) { alert('Пароль має містити щонайменше 3 символи.'); return; }
      const hash = await sha256Hex(val);
      localStorage.setItem(LOCK_HASH_KEY, hash);
      lockPassInput.value = '';
      updateLockStatusUI();
      closeSettings();
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

  // Theme Settings (теми як схеми на DLE)
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.themeOption);
    });
  });
  applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME);

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

}

function applyCardSize(size) {
  document.body.className = document.body.className.replace(/size-\w+/g, '').trim();
  if (size === 'medium') document.body.classList.add('size-medium');
  else if (size === 'small') document.body.classList.add('size-small');
}

// ---- Theme system (теми як схеми на DLE) ----
const THEME_STORAGE_KEY = 'ext_theme';
const DEFAULT_THEME = 'binance';
const AVAILABLE_THEMES = ['binance', 'light'];

function applyTheme(theme) {
  const safe = AVAILABLE_THEMES.includes(theme) ? theme : DEFAULT_THEME;
  document.body.dataset.theme = safe;
  localStorage.setItem(THEME_STORAGE_KEY, safe);
  // Оновити theme-color метатег під тему
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.content = safe === 'light' ? '#F7F8FA' : '#0B0E11';
  }
  // Підсвітити активну кнопку в налаштуваннях
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeOption === safe);
  });
}

function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(saved || DEFAULT_THEME);
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
const PROJECTS_DATA_KEY = 'projects_workspace_data_v1';
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
  else if (mode === 'projects') activeAppMode = 'projects';
  else if (mode === 'procurement') activeAppMode = 'procurement';
  else if (mode === 'pmm') activeAppMode = 'pmm';
  else activeAppMode = 'deadlines';
  localStorage.setItem(APP_MODE_KEY, activeAppMode);

  document.body.classList.remove('ops-mode', 'shtat-mode', 'projects-mode', 'pmm-mode', 'procurement-mode');
  if (activeAppMode === 'ops') document.body.classList.add('ops-mode');
  if (activeAppMode === 'shtat') document.body.classList.add('shtat-mode');
  if (activeAppMode === 'projects') document.body.classList.add('projects-mode');
  if (activeAppMode === 'procurement') document.body.classList.add('procurement-mode');
  if (activeAppMode === 'pmm') document.body.classList.add('pmm-mode');

  document.querySelectorAll('.app-mode-btn').forEach(btn => {
    const isActive = btn.dataset.mode === activeAppMode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  document.querySelectorAll('.mobile-nav-item').forEach(btn => {
    const isActive = btn.dataset.mode === activeAppMode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
    // Scroll active item into center of the nav bar
    if (isActive) {
      requestAnimationFrame(() => {
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      });
    }
  });

  // Show/hide sections
  const dashLayout = document.querySelector('.dash-layout');
  const opsWorkspace = document.getElementById('ops-workspace');
  const shtatWorkspace = document.getElementById('shtat-workspace');
  const projectsWorkspace = document.getElementById('projects-workspace');
  const pmmWorkspace = document.getElementById('pmm-workspace');
  const procurementWorkspace = document.getElementById('procurement-workspace');
  const tabBar = document.getElementById('tab-bar');
  const fabContainer = document.querySelector('.fab-container');

  if (dashLayout) dashLayout.style.display = activeAppMode === 'deadlines' ? '' : 'none';
  if (opsWorkspace) opsWorkspace.style.display = (activeAppMode === 'deadlines' || activeAppMode === 'ops') ? '' : 'none';
  if (shtatWorkspace) shtatWorkspace.style.display = activeAppMode === 'shtat' ? '' : 'none';
  if (projectsWorkspace) projectsWorkspace.style.display = activeAppMode === 'projects' ? '' : 'none';
  if (procurementWorkspace) procurementWorkspace.style.display = activeAppMode === 'procurement' ? '' : 'none';
  if (pmmWorkspace) pmmWorkspace.style.display = activeAppMode === 'pmm' ? '' : 'none';
  if (tabBar) tabBar.style.display = activeAppMode === 'deadlines' ? '' : 'none';

  // FAB: always show settings + lock, hide add-btn in shtat/ops/projects/pmm mode
  if (fabContainer) fabContainer.style.display = '';
  const fabAdd = document.getElementById('add-btn');
  const fabLock = document.getElementById('lock-now-btn');
  if (fabAdd) fabAdd.style.display = activeAppMode === 'deadlines' ? '' : 'none';
  if (fabLock) fabLock.style.display = isLockEnabled() ? 'flex' : 'none';

  if (activeAppMode === 'ops') renderOpsWorkspace();
  else if (activeAppMode === 'shtat') initShtatMode();
  else if (activeAppMode === 'projects') renderProjectsWorkspace();
  else if (activeAppMode === 'procurement') renderProcurementWorkspace();
  else if (activeAppMode === 'pmm') renderPmmWorkspace();
  else updateAddButton();
}

// ---- Projects: independent local activity chains ----
function getDefaultProjectsData() {
  return { projects: [], activeProjectId: null };
}

function loadProjectsData() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROJECTS_DATA_KEY) || 'null');
    if (!saved || !Array.isArray(saved.projects)) return getDefaultProjectsData();
    return {
      projects: saved.projects.filter(project => project && typeof project.title === 'string').map(project => ({
        id: String(project.id || createProjectId()),
        title: project.title.slice(0, 120),
        createdAt: project.createdAt || new Date().toISOString(),
        entries: Array.isArray(project.entries) ? project.entries : []
      })),
      activeProjectId: saved.activeProjectId || null
    };
  } catch (error) {
    console.warn('Projects data reset:', error);
    return getDefaultProjectsData();
  }
}

function saveProjectsData(data) {
  localStorage.setItem(PROJECTS_DATA_KEY, JSON.stringify(data));
  // Миттєва синхронізація проєктів (з фото) в Google Drive
  if (typeof saveToDrive === 'function' && currentUser) {
    saveToDrive();
  }
}

// ---- Проста галерея з підтримкою наближення колесиком та пальцями (pinch-zoom) ----
let galleryZoomState = {
  scale: 1,
  translateX: 0,
  translateY: 0,
  isDragging: false,
  startX: 0,
  startY: 0
};

function updateGalleryImageTransform() {
  const img = document.getElementById('photo-gallery-img');
  if (!img) return;
  galleryZoomState.scale = Math.min(Math.max(galleryZoomState.scale, 1), 5);
  if (galleryZoomState.scale === 1) {
    galleryZoomState.translateX = 0;
    galleryZoomState.translateY = 0;
  }
  img.style.transform = `translate(${galleryZoomState.translateX}px, ${galleryZoomState.translateY}px) scale(${galleryZoomState.scale})`;
}

function resetGalleryZoom() {
  galleryZoomState.scale = 1;
  galleryZoomState.translateX = 0;
  galleryZoomState.translateY = 0;
  updateGalleryImageTransform();
}

function showPhotoGallery(src) {
  if (!src) return;
  let overlay = document.getElementById('photo-gallery-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'photo-gallery-overlay';
    overlay.className = 'photo-gallery-overlay';
    overlay.innerHTML = `
      <button class="photo-gallery-close" title="Закрити (Esc)">✕</button>
      <img id="photo-gallery-img" src="" class="photo-gallery-img" alt="Перегляд фото">
    `;
    document.body.appendChild(overlay);

    const img = overlay.querySelector('#photo-gallery-img');

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('photo-gallery-close')) {
        closePhotoGallery();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('active')) {
        closePhotoGallery();
      }
    });

    // 1. Колесико миші на ПК
    overlay.addEventListener('wheel', (e) => {
      if (!overlay.classList.contains('active')) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.2 : 0.8;
      galleryZoomState.scale *= delta;
      updateGalleryImageTransform();
    }, { passive: false });

    // 2. Подвійний клік / тапом (1x <-> 2.5x)
    img.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (galleryZoomState.scale > 1.2) {
        resetGalleryZoom();
      } else {
        galleryZoomState.scale = 2.5;
        updateGalleryImageTransform();
      }
    });

    // 3. Перетягування мишкою при наближенні
    img.addEventListener('mousedown', (e) => {
      if (galleryZoomState.scale <= 1 || e.button !== 0) return;
      e.preventDefault();
      galleryZoomState.isDragging = true;
      galleryZoomState.startX = e.clientX - galleryZoomState.translateX;
      galleryZoomState.startY = e.clientY - galleryZoomState.translateY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!galleryZoomState.isDragging || !overlay.classList.contains('active')) return;
      galleryZoomState.translateX = e.clientX - galleryZoomState.startX;
      galleryZoomState.translateY = e.clientY - galleryZoomState.startY;
      updateGalleryImageTransform();
    });

    window.addEventListener('mouseup', () => {
      galleryZoomState.isDragging = false;
    });

    // 4. Pinch-to-zoom (2 пальці на телефоні) & Drag (1 палець)
    let initialPinchDist = 0;
    let initialScale = 1;

    overlay.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        initialPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        initialScale = galleryZoomState.scale;
      } else if (e.touches.length === 1 && galleryZoomState.scale > 1) {
        galleryZoomState.isDragging = true;
        galleryZoomState.startX = e.touches[0].clientX - galleryZoomState.translateX;
        galleryZoomState.startY = e.touches[0].clientY - galleryZoomState.translateY;
      }
    }, { passive: true });

    overlay.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && initialPinchDist > 0) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        galleryZoomState.scale = initialScale * (dist / initialPinchDist);
        updateGalleryImageTransform();
      } else if (e.touches.length === 1 && galleryZoomState.isDragging) {
        e.preventDefault();
        galleryZoomState.translateX = e.touches[0].clientX - galleryZoomState.startX;
        galleryZoomState.translateY = e.touches[0].clientY - galleryZoomState.startY;
        updateGalleryImageTransform();
      }
    }, { passive: false });

    overlay.addEventListener('touchend', () => {
      initialPinchDist = 0;
      galleryZoomState.isDragging = false;
    });
  }

  const imgEl = overlay.querySelector('#photo-gallery-img');
  if (imgEl) imgEl.src = src;
  resetGalleryZoom();
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closePhotoGallery() {
  const overlay = document.getElementById('photo-gallery-overlay');
  if (overlay) {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    resetGalleryZoom();
  }
}

function createProjectId() {
  return window.crypto && crypto.randomUUID ? crypto.randomUUID() : `project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeProjectText(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[char]);
}

function projectDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Щойно';
  return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

// Дата як лист календаря: великий день, місяць, знизу рік
function projectCalendarDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '<span class="pdate-day">—</span>';
  const day = new Intl.DateTimeFormat('uk-UA', { day: '2-digit' }).format(date);
  const month = new Intl.DateTimeFormat('uk-UA', { month: 'short' }).format(date).replace(/\.$/, '');
  const year = new Intl.DateTimeFormat('uk-UA', { year: 'numeric' }).format(date);
  return `<span class="pdate-day">${day}</span><span class="pdate-month">${month}</span><span class="pdate-year">${year}</span>`;
}

function localDateTimeValue(value = new Date()) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function projectImageToDataUrl(file) {
  // Ліміт: 499 KB — МАКСИМУМ у байтах реального файлу (стискаємо рівно до бюджету, не менше)
  const MAX_BYTES = 499 * 1024;

  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Оберіть зображення.'));
      return;
    }

    // Ступені стиснення: [макс. сторона, якість JPEG]
    const steps = [
      [1440, 0.85],
      [1440, 0.72],
      [1440, 0.60],
      [1280, 0.75],
      [1280, 0.60],
      [1024, 0.80],
      [1024, 0.65],
      [1024, 0.50],
      [ 768, 0.75],
      [ 768, 0.60],
      [ 768, 0.45],
      [ 512, 0.70],
      [ 512, 0.50],
      [ 512, 0.35],
    ];

    const encode = (source, width, height) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      let result = null;

      for (const [maxSide, quality] of steps) {
        const scale = Math.min(1, maxSide / Math.max(width, height));
        canvas.width  = Math.max(1, Math.round(width  * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        // Білий фон — щоб PNG з прозорістю не ставав чорним при конвертації в JPEG
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const rawLength = atob(dataUrl.split(',')[1] || '').length;
        result = dataUrl;
        if (rawLength <= MAX_BYTES) {
          console.log(`[Photo] Стиснено до ${Math.round(rawLength / 1024)}KB (${canvas.width}×${canvas.height}, q=${quality})`);
          break;
        }
      }

      const finalLength = atob((result || '').split(',')[1] || '').length;
      if (finalLength > MAX_BYTES) {
        console.warn(`[Photo] Не вдалося стиснути до 499KB, розмір: ${Math.round(finalLength / 1024)}KB`);
      }
      resolve(result);
    };

    // Завантажуємо з урахуванням EXIF-орієнтації (вертикальні фото не будуть повернуті)
    const loadViaImage = () => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Не вдалося прочитати фото.'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('Не вдалося обробити фото.'));
        image.onload = () => encode(image, image.naturalWidth, image.naturalHeight);
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    };

    if (typeof createImageBitmap === 'function') {
      createImageBitmap(file, { imageOrientation: 'from-image' })
        .then(bitmap => encode(bitmap, bitmap.width, bitmap.height))
        .catch(loadViaImage);
    } else {
      loadViaImage();
    }
  });
}

function addProject(title) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) return null;
  const data = loadProjectsData();
  const project = { id: createProjectId(), title: cleanTitle.slice(0, 120), createdAt: new Date().toISOString(), entries: [] };
  data.projects.unshift(project);
  data.activeProjectId = project.id;
  saveProjectsData(data);
  return project;
}

function refreshProjectsWorkspace() {
  const restoreY = window.scrollY;
  const draw = () => {
    renderProjectsWorkspace();
    requestAnimationFrame(() => window.scrollTo(0, restoreY));
  };
  if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(draw);
  } else {
    draw();
  }
}

function renderProjectsWorkspace() {
  const list = document.getElementById('projects-list');
  const detail = document.getElementById('project-detail');
  if (!list || !detail) return;
  const data = loadProjectsData();
  const active = data.projects.find(project => project.id === data.activeProjectId) || data.projects[0] || null;
  if (active && data.activeProjectId !== active.id) {
    data.activeProjectId = active.id;
    saveProjectsData(data);
  }

  const pencilIcon = `<svg class="project-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const trashIcon = `<svg class="project-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
  const checkIcon = `<svg class="project-btn-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  list.innerHTML = data.projects.length
    ? data.projects.map(project => {
        const done = project.entries.filter(entry => entry.done).length;
        return `<button class="project-list-item ${project.id === active?.id ? 'active' : ''}" type="button" data-project-id="${escapeProjectText(project.id)}"><span>${escapeProjectText(project.title)}</span><small>${done}/${project.entries.length} кроків</small></button>`;
      }).join('')
    : '<p class="projects-list-empty">Створіть перший проєкт — тут збереться вся його історія.</p>';

  if (!active) {
    detail.innerHTML = `<section class="project-empty-state"><span class="project-empty-mark">⌘</span><p class="projects-eyebrow">Від ідеї до результату</p><h1>Створіть перший проєкт</h1><p>Наприклад, «Побудувати будинок». Далі додавайте кроки з датою та відмічайте виконане.</p><form class="project-first-form" id="project-first-form"><label for="project-first-title">Назва проєкту</label><div><input id="project-first-title" maxlength="120" autocomplete="off" placeholder="Побудувати будинок" required><button type="submit">Створити</button></div></form></section>`;
    document.getElementById('project-first-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const input = document.getElementById('project-first-title');
      if (addProject(input.value)) refreshProjectsWorkspace();
    });
    return;
  }

  const entries = [...active.entries].sort((a, b) => new Date(b.createdAt || b.scheduledAt || 0) - new Date(a.createdAt || a.scheduledAt || 0));
  const done = entries.filter(entry => entry.done).length;

  detail.innerHTML = `
    <div class="project-detail-header">
      <div class="project-header-main">
        <span class="projects-eyebrow">Активний проєкт</span>
        <div class="project-title-row" id="project-title-container">
          <h1 class="project-title-text" id="project-title-val">${escapeProjectText(active.title)}</h1>
          <button class="project-icon-btn" type="button" id="btn-edit-project-title" title="Редагувати назву">${pencilIcon}</button>
          <button class="project-icon-btn danger" type="button" id="btn-delete-project" title="Видалити проєкт">${trashIcon}</button>
        </div>
        <p class="project-meta-info">${done} із ${entries.length} кроків виконано · створено ${projectDateTime(active.createdAt)}</p>
      </div>
      <div class="project-progress" aria-label="Виконано ${done} із ${entries.length}">
        <span style="width:${entries.length ? Math.round(done / entries.length * 100) : 0}%"></span>
      </div>
    </div>
    <div class="project-chain" aria-label="Хронологія кроків">
      ${entries.length ? entries.map((entry, index) => `
        <article class="project-entry ${entry.done ? 'is-done' : ''}" data-entry-card-id="${escapeProjectText(entry.id)}">
          <div class="project-entry-rail">
            <time class="project-entry-time" datetime="${escapeProjectText(entry.scheduledAt || entry.createdAt)}">${projectCalendarDate(entry.scheduledAt || entry.createdAt)}</time>
            <div class="project-entry-node">${entries.length - index}</div>
          </div>
          <div class="project-entry-card">
            <div class="project-entry-top">
              <span class="project-entry-kind">${entry.imageData ? 'Фото / запис' : 'Запис'}</span>
              <div class="project-entry-actions">
                <button class="project-icon-btn" type="button" data-edit-entry="${escapeProjectText(entry.id)}" title="Редагувати крок">${pencilIcon}</button>
                ${entry.imageData ? `<button class="project-icon-btn danger" type="button" data-delete-image="${escapeProjectText(entry.id)}" title="Видалити фото">${trashIcon}</button>` : ''}
                <button class="project-icon-btn danger" type="button" data-delete-entry="${escapeProjectText(entry.id)}" title="Видалити крок">${trashIcon}</button>
                <button class="project-entry-toggle" type="button" data-entry-id="${escapeProjectText(entry.id)}" aria-pressed="${entry.done ? 'true' : 'false'}" title="${entry.done ? 'Скасувати' : 'Виконати'}">
                  ${checkIcon} ${entry.done ? 'Виконано' : 'Виконати'}
                </button>
              </div>
            </div>
            ${entry.imageData ? `<div class="project-entry-image-wrapper" onclick="showPhotoGallery('${escapeProjectText(entry.imageData)}')"><img class="project-entry-image" src="${escapeProjectText(entry.imageData)}" alt="${escapeProjectText(entry.text || 'Фото кроку проєкту')}" loading="lazy"></div>` : ''}
            <div class="project-entry-body" id="entry-body-${escapeProjectText(entry.id)}">
              ${entry.text ? `<p class="project-entry-text">${escapeProjectText(entry.text)}</p>` : ''}
            </div>
          </div>
        </article>
      `).join('') : '<div class="project-chain-empty">Поки що немає кроків. Додайте перший — він стане початком ланцюжка.</div>'}
    </div>
    <form class="project-composer" id="project-entry-form">
      <div class="project-composer-fields">
        <textarea id="project-entry-text" name="text" maxlength="500" rows="2" autocomplete="off" placeholder="Наступний крок чи запис..."></textarea>
        <label class="project-photo-picker" for="project-entry-image" title="Додати фото">
          📷 Фото<input id="project-entry-image" name="image" type="file" accept="image/*" capture="environment">
        </label>
        <input id="project-entry-time" name="time" type="datetime-local" value="${localDateTimeValue()}" aria-label="Дата та час">
        <button type="submit" class="project-composer-submit">Додати</button>
      </div>
      <div class="project-image-status" id="project-image-status" aria-live="polite"></div>
    </form>
  `;

  // Select project from sidebar
  list.querySelectorAll('[data-project-id]').forEach(button => button.addEventListener('click', () => {
    const next = loadProjectsData();
    next.activeProjectId = button.dataset.projectId;
    saveProjectsData(next);
    refreshProjectsWorkspace();
  }));

  // Toggle done status
  detail.querySelectorAll('[data-entry-id]').forEach(button => button.addEventListener('click', () => {
    const next = loadProjectsData();
    const project = next.projects.find(item => item.id === active.id);
    const entry = project?.entries.find(item => item.id === button.dataset.entryId);
    if (entry) {
      entry.done = !entry.done;
      entry.completedAt = entry.done ? new Date().toISOString() : null;
      saveProjectsData(next);
      refreshProjectsWorkspace();
    }
  }));

  // Inline edit project title
  const editTitleBtn = detail.querySelector('#btn-edit-project-title');
  if (editTitleBtn) {
    editTitleBtn.addEventListener('click', () => {
      const container = detail.querySelector('#project-title-container');
      const currentTitle = active.title;
      if (!container) return;
      container.innerHTML = `
        <form class="project-inline-edit-form" id="form-edit-project-title">
          <input class="project-inline-input" id="input-edit-project-title" value="${escapeProjectText(currentTitle)}" maxlength="120" required autocomplete="off">
          <button type="submit" class="project-inline-save-btn">Зберегти</button>
          <button type="button" class="project-inline-cancel-btn" id="btn-cancel-edit-title">Скасувати</button>
        </form>
      `;
      const input = container.querySelector('#input-edit-project-title');
      if (input) { input.focus(); input.select(); }
      container.querySelector('#form-edit-project-title')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const newTitle = input.value.trim();
        if (newTitle && newTitle !== currentTitle) {
          const next = loadProjectsData();
          const project = next.projects.find(item => item.id === active.id);
          if (project) { project.title = newTitle.slice(0, 120); saveProjectsData(next); }
        }
        refreshProjectsWorkspace();
      });
      container.querySelector('#btn-cancel-edit-title')?.addEventListener('click', () => refreshProjectsWorkspace());
    });
  }

  // Delete project
  detail.querySelector('#btn-delete-project')?.addEventListener('click', () => {
    const container = detail.querySelector('#project-title-container');
    if (!container) return;
    container.innerHTML = `
      <div class="project-inline-confirm">
        <span>Видалити проєкт і всі кроки?</span>
        <button type="button" class="project-inline-save-btn danger" id="btn-confirm-delete-project">Так, видалити</button>
        <button type="button" class="project-inline-cancel-btn" id="btn-cancel-delete-project">Скасувати</button>
      </div>
    `;
    container.querySelector('#btn-confirm-delete-project')?.addEventListener('click', () => {
      const next = loadProjectsData();
      markProjectAsDeleted(active.id);
      next.projects = next.projects.filter(p => p.id !== active.id);
      next.activeProjectId = next.projects[0]?.id || null;
      saveProjectsData(next);
      refreshProjectsWorkspace();
    });
    container.querySelector('#btn-cancel-delete-project')?.addEventListener('click', () => refreshProjectsWorkspace());
  });

  // Inline edit entry message
  detail.querySelectorAll('[data-edit-entry]').forEach(button => button.addEventListener('click', () => {
    const entryId = button.dataset.editEntry;
    const bodyEl = detail.querySelector(`#entry-body-${entryId}`);
    if (!bodyEl) return;
    const next = loadProjectsData();
    const project = next.projects.find(item => item.id === active.id);
    const entry = project?.entries.find(item => item.id === entryId);
    if (!entry) return;

    const currentText = entry.text || '';
    bodyEl.innerHTML = `
      <form class="project-entry-edit-form" data-edit-entry-form="${escapeProjectText(entryId)}">
        <textarea class="project-entry-textarea" rows="2" maxlength="500">${escapeProjectText(currentText)}</textarea>
        <div class="project-entry-edit-btns">
          <button type="submit" class="project-inline-save-btn">Зберегти</button>
          <button type="button" class="project-inline-cancel-btn" data-cancel-edit-entry="${escapeProjectText(entryId)}">Скасувати</button>
        </div>
      </form>
    `;
    const textarea = bodyEl.querySelector('.project-entry-textarea');
    if (textarea) { textarea.focus(); textarea.setSelectionRange(textarea.value.length, textarea.value.length); }

    bodyEl.querySelector('.project-entry-edit-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const updatedText = textarea.value.trim().slice(0, 500);
      const dataStore = loadProjectsData();
      const prj = dataStore.projects.find(item => item.id === active.id);
      const ent = prj?.entries.find(item => item.id === entryId);
      if (ent) {
        ent.text = updatedText;
        ent.updatedAt = new Date().toISOString();
        saveProjectsData(dataStore);
      }
      refreshProjectsWorkspace();
    });

    bodyEl.querySelector(`[data-cancel-edit-entry]`)?.addEventListener('click', () => refreshProjectsWorkspace());
  }));

  // Remove only the photo; confirmation lives in the top action row, never below the image.
  detail.querySelectorAll('[data-delete-image]').forEach(button => button.addEventListener('click', () => {
    const entryId = button.dataset.deleteImage;
    const topEl = button.closest('.project-entry-card')?.querySelector('.project-entry-top');
    if (!topEl) return;
    topEl.innerHTML = `
      <div class="project-inline-confirm project-photo-confirm">
        <span>Видалити це фото?</span>
        <button type="button" class="project-inline-save-btn danger" data-confirm-delete-image="${escapeProjectText(entryId)}">Видалити</button>
        <button type="button" class="project-inline-cancel-btn" data-cancel-delete-image>Скасувати</button>
      </div>`;
    topEl.querySelector('[data-confirm-delete-image]')?.addEventListener('click', () => {
      const dataStore = loadProjectsData();
      const project = dataStore.projects.find(item => item.id === active.id);
      const entry = project?.entries.find(item => item.id === entryId);
      if (entry) {
        entry.imageData = null;
        entry.updatedAt = new Date().toISOString();
        saveProjectsData(dataStore);
        refreshProjectsWorkspace();
      }
    });
    topEl.querySelector('[data-cancel-delete-image]')?.addEventListener('click', () => refreshProjectsWorkspace());
  }));

  // Delete entry
  detail.querySelectorAll('[data-delete-entry]').forEach(button => button.addEventListener('click', () => {
    const entryId = button.dataset.deleteEntry;
    const topEl = button.closest('.project-entry-card')?.querySelector('.project-entry-top');
    if (!topEl) return;
    topEl.innerHTML = `
      <div class="project-inline-confirm project-photo-confirm">
        <span>Видалити цей крок?</span>
        <button type="button" class="project-inline-save-btn danger" data-confirm-delete-entry="${escapeProjectText(entryId)}">Видалити</button>
        <button type="button" class="project-inline-cancel-btn" data-cancel-delete-entry="${escapeProjectText(entryId)}">Скасувати</button>
      </div>
    `;
    topEl.querySelector('[data-confirm-delete-entry]')?.addEventListener('click', () => {
      const dataStore = loadProjectsData();
      const prj = dataStore.projects.find(item => item.id === active.id);
      if (prj) {
        markProjectEntryAsDeleted(entryId);
        prj.entries = prj.entries.filter(e => e.id !== entryId);
        saveProjectsData(dataStore);
      }
      refreshProjectsWorkspace();
    });
    topEl.querySelector('[data-cancel-delete-entry]')?.addEventListener('click', () => refreshProjectsWorkspace());
  }));

  // Image status feedback
  detail.querySelector('#project-entry-image')?.addEventListener('change', event => {
    const file = event.currentTarget.files?.[0];
    const status = detail.querySelector('#project-image-status');
    if (status) status.textContent = file ? `📷 Обрано фото: ${file.name}` : '';
  });

  // Submit new step
  detail.querySelector('#project-entry-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const text = form.elements.text.value.trim();
    const imageFile = form.elements.image.files?.[0];
    const status = detail.querySelector('#project-image-status');
    if (!text && !imageFile) {
      if (status) status.textContent = 'Введіть текст або оберіть фото.';
      return;
    }
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) { submitButton.disabled = true; submitButton.textContent = '…'; }
    let imageData = null;
    try {
      if (imageFile) imageData = await projectImageToDataUrl(imageFile);
      const next = loadProjectsData();
      const project = next.projects.find(item => item.id === active.id);
      if (!project) return;
      project.entries.unshift({
        id: createProjectId(),
        text: text.slice(0, 500),
        imageData,
        scheduledAt: form.elements.time.value ? new Date(form.elements.time.value).toISOString() : new Date().toISOString(),
        createdAt: new Date().toISOString(),
        done: false
      });
      saveProjectsData(next);
      refreshProjectsWorkspace();
    } catch (error) {
      console.warn('Project image was not saved:', error);
      if (status) status.textContent = error.name === 'QuotaExceededError' ? 'Мало місця у сховищі для фото.' : error.message || 'Помилка додавання фото.';
      if (submitButton) { submitButton.disabled = false; submitButton.textContent = 'Додати'; }
    }
  });
}

function initProjectsWorkspace() {
  document.getElementById('project-create-btn')?.addEventListener('click', () => {
    const data = loadProjectsData();
    const newPrj = addProject(`Новий проєкт ${data.projects.length + 1}`);
    if (newPrj) {
      refreshProjectsWorkspace();
      setTimeout(() => {
        const editBtn = document.getElementById('btn-edit-project-title');
        if (editBtn) editBtn.click();
      }, 50);
    }
  });
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
const SHTAT_SHEET_URL_KEY = 'shtat_sheet_url';
const SHTAT_FILTER_KEY = 'shtat_unit_filter';

function loadImportedStaff() {
  try { return JSON.parse(localStorage.getItem(SHTAT_IMPORTED_KEY)) || { units: [], totalPositions: 0, stats: null }; }
  catch(e) { return { units: [], totalPositions: 0, stats: null }; }
}
function saveImportedStaff(data) { localStorage.setItem(SHTAT_IMPORTED_KEY, JSON.stringify(data)); }

function getShtatSheetUrl() {
  const v = localStorage.getItem(SHTAT_SHEET_URL_KEY);
  return (v && v.trim()) ? v.trim() : '';
}

function getStaffCsvUrls(url, opts = {}) {
  if (!url) return [];
  if (url.includes('script.google.com/macros')) return [url];
  const idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return [url];
  const docId = idMatch[1];

  // За назвою аркуша (працює навіть без gid)
  if (opts.sheet) {
    const enc = encodeURIComponent(opts.sheet);
    return [
      `https://docs.google.com/spreadsheets/d/${docId}/gviz/tq?tqx=out:csv&sheet=${enc}`,
      `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv&sheet=${enc}`
    ];
  }

  const gidMatch = url.match(/[?&]gid=([0-9]+)/) || url.match(/#gid=([0-9]+)/);

  if (gidMatch) {
    // GID found in URL — use it directly
    const gid = gidMatch[1];
    return [
      `https://docs.google.com/spreadsheets/d/${docId}/gviz/tq?tqx=out:csv&gid=${gid}`,
      `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv&gid=${gid}`
    ];
  } else {
    // No GID — try without gid (default/first sheet) then common gids
    // gviz without gid returns the first sheet
    return [
      `https://docs.google.com/spreadsheets/d/${docId}/gviz/tq?tqx=out:csv`,
      `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv`,
      `https://docs.google.com/spreadsheets/d/${docId}/gviz/tq?tqx=out:csv&gid=0`
    ];
  }
}


// Fetch staff data using Google Sheets API (authenticated) or CSV fallback
async function fetchStaffWithAuth(docId, gid, sheetHint) {
  const token = localStorage.getItem('google_auth_token');
  if (!token) return null;

  try {
    let sheetName = null;

    // Step 1: Get spreadsheet metadata to find the sheet name by gid
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${docId}?fields=sheets.properties`;
    const metaResp = await fetch(metaUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!metaResp.ok) {
      if (metaResp.status === 401 || metaResp.status === 403) {
        throw new Error('AUTH_REQUIRED');
      }
      console.warn('[Sheets API] Metadata status:', metaResp.status);
      return null;
    }

    const meta = await metaResp.json();
    const sheets = meta.sheets || [];
    if (gid) {
      const match = sheets.find(s => String(s.properties.sheetId) === String(gid));
      if (match) sheetName = match.properties.title;
    }
    if (!sheetName && sheetHint) {
      const exact = sheets.find(s => s.properties.title.toLowerCase() === String(sheetHint).toLowerCase());
      if (exact) sheetName = exact.properties.title;
    }
    if (!sheetName) {
      const shtatSheet = sheets.find(s => /штат/i.test(s.properties.title));
      if (shtatSheet) sheetName = shtatSheet.properties.title;
    }
    if (!sheetName && sheets.length > 0) {
      sheetName = sheets[0].properties.title;
    }

    // Step 2: Fetch values from the identified sheet
    const range = sheetName ? `${encodeURIComponent(sheetName)}!A:F` : 'A:F';
    const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${docId}/values/${range}?majorDimension=ROWS`;
    const resp = await fetch(apiUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (resp.ok) {
      const json = await resp.json();
      if (json.values && json.values.length > 0) {
        console.log(`[Sheets API] ✅ Loaded ${json.values.length} rows from "${sheetName || 'default'}"`);
        return json.values.map(row => row.map(c => (c || '').toString().trim()));
      }
    } else {
      if (resp.status === 401 || resp.status === 403) {
        throw new Error('AUTH_REQUIRED');
      }
      console.warn('[Sheets API] Values status:', resp.status, await resp.text());
    }
  } catch(e) {
    if (e.message === 'AUTH_REQUIRED') {
      throw new Error('Потрібно оновити авторизацію Google.\n\nБудь ласка, в розділі «Синхронізація Google» внизу налаштувань натисніть «Вийти», а потім «Увійти в Google» знову, щоб надати додатку права на читання таблиць.');
    }
    console.warn('[Sheets API] Auth fetch failed:', e.message);
  }
  return null;
}


// ── JSONP fetch (bypasses CORS completely, works in any Telegram WebApp) ──────
function fetchViaJsonp(baseUrl) {
  return new Promise((resolve, reject) => {
    const cbName = 'gvizCb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    let done = false;

    const cleanup = () => {
      done = true;
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.src = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'tqx=responseHandler:' + cbName;
    script.onerror = () => { cleanup(); reject(new Error('JSONP script error')); };
    document.head.appendChild(script);

    setTimeout(() => {
      if (!done) { cleanup(); reject(new Error('JSONP timeout')); }
    }, 12000);
  });
}

// Parse Google Visualization JSON into standard dataRows (2D string array)
function parseGvizJson(gvizData) {
  const cols = (gvizData.table && gvizData.table.cols) || [];
  const rows = (gvizData.table && gvizData.table.rows) || [];

  // Extract main unit name from col[1] label (merged header)
  const unitLabel = cols[1] ? (cols[1].label || '') : '';

  // Build synthetic header row so existing parser can handle it
  // Col[0]='№ п/п', Col[1]=unit name, Col[2]='ПІБ', Col[3]='ДСНС / Вільний найм', Col[4]='Звання'
  const headerRow = ['\u2116 \u043f/\u043f', unitLabel, '\u041f\u0406\u0411', '\u0414\u0421\u041d\u0421\n / \u0412\u0456\u043b\u044c\u043d\u0438\u0439 \u043d\u0430\u0439\u043c', '\u0417\u0432\u0430\u043d\u043d\u044f'];

  const dataRows = [headerRow];

  for (const row of rows) {
    const cells = row.c || [];
    const mapped = cells.map(cell => {
      if (!cell) return '';
      const v = cell.v;
      if (v === null || v === undefined) return String(cell.f || '');
      // Numbers come as floats: 1.0 → '1'
      if (typeof v === 'number') return String(Math.round(v));
      return String(v);
    });
    // Pad to at least 5 columns
    while (mapped.length < 5) mapped.push('');
    dataRows.push(mapped.slice(0, 6));
  }

  return dataRows;
}

async function fetchStaffCsv(url, opts = {}) {
  const idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  const gidMatch = url.match(/[?&#]gid=([0-9]+)/);
  const docId = idMatch ? idMatch[1] : null;
  const gid = gidMatch ? gidMatch[1] : null;

  // ── Step 1: Google Sheets API with auth token (if user is logged in) ──
  if (docId) {
    try {
      const rows = await fetchStaffWithAuth(docId, gid, opts.sheet);
      if (rows && rows.length > 0) {
        console.log('[Staff] Loaded via Sheets API');
        return { __rows: rows };
      }
    } catch(e) {
      // Re-throw auth errors (need re-login), swallow others
      if (e.message && e.message.includes('\u043f\u043e\u0442\u0440\u0456\u0431\u043d\u043e \u043e\u043d\u043e\u0432\u0438\u0442\u0438')) throw e;
      console.warn('[Staff] Auth API failed, trying JSONP:', e.message);
    }
  }

  // ── Step 2: JSONP (bypasses CORS — works in Telegram WebApp without auth) ──
  if (docId) {
    try {
      const q = opts.sheet ? `sheet=${encodeURIComponent(opts.sheet)}` : (gid ? `gid=${gid}` : '');
      const jsonpBase = `https://docs.google.com/spreadsheets/d/${docId}/gviz/tq${q ? '?' + q : ''}`;
      console.log('[Staff] Trying JSONP:', jsonpBase.slice(0, 80));
      const gvizData = await fetchViaJsonp(jsonpBase);
      const dataRows = parseGvizJson(gvizData);
      if (dataRows.length > 2) {
        console.log('[Staff] Loaded via JSONP, rows:', dataRows.length);
        return { __rows: dataRows };
      }
    } catch(e) {
      console.warn('[Staff] JSONP failed:', e.message);
    }
  }

  // ── Step 3: Public CSV fallback ──
  const urls = getStaffCsvUrls(url, opts);
  let lastErr = null;
  for (const csvUrl of urls) {
    try {
      const text = await tryFetchCsv(csvUrl);
      if (text && text.trim()) {
        console.log('[Staff] Loaded via public CSV');
        return text;
      }
    } catch(err) { lastErr = err; }
  }

  const token = localStorage.getItem('google_auth_token');
  if (!token) {
    throw new Error('\u041d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u0437\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0438\u0442\u0438 \u0442\u0430\u0431\u043b\u0438\u0446\u044e.\n\n\u0423\u0432\u0456\u0439\u0434\u0456\u0442\u044c \u0447\u0435\u0440\u0435\u0437 Google \u0432 \u043d\u0430\u043b\u0430\u0448\u0442\u0443\u0432\u0430\u043d\u043d\u044f\u0445 (\u0440\u043e\u0437\u0434\u0456\u043b \u00ab\u0421\u0438\u043d\u0445\u0440\u043e\u043d\u0456\u0437\u0430\u0446\u0456\u044f Google\u00bb) \u0456 \u0441\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0437\u043d\u043e\u0432\u0443.');
  }
  throw lastErr || new Error('\u041d\u0435 \u0432\u0434\u0430\u043b\u043e\u0441\u044f \u0437\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0438\u0442\u0438 \u0442\u0430\u0431\u043b\u0438\u0446\u044e. \u041f\u0435\u0440\u0435\u0432\u0456\u0440\u0442\u0435 \u0434\u043e\u0441\u0442\u0443\u043f \u0434\u043e \u043f\u043e\u0441\u0438\u043b\u0430\u043d\u043d\u044f.');
}




function parseCsvRows(csvText) {
  const rows = csvText.split(/\r?\n/);
  return rows.map(row => {
    const cols = []; let cur = '', q = false;
    for (const ch of row) { if (ch === '"') q = !q; else if (ch === ',' && !q) { cols.push(cur.trim()); cur = ''; } else cur += ch; }
    cols.push(cur.trim()); return cols;
  });
}

function staffClean(s) { return (s || '').replace(/^["']|["']$/g, '').replace(/^[•\s]+|[•\s]+$/g, '').trim().replace(/\s+/g, ' '); }
function staffIsVacant(name) { return !name || /^[-–—\s]*$/.test(name) || /vacant|вакант|вакансія|- В -|^-$|^–$/i.test(name); }
function staffIsSummaryRow(s) { return /^(всього|вакантно|зайнято|у т\.ч\.|authorized)/i.test(s); }
function staffIsHeaderRow(num, pos, person) {
  const joined = `${num} ${pos} ${person}`.toLowerCase();
  return joined.includes('№') && (joined.includes('посада') || joined.includes('підрозділ')) && joined.includes('піб');
}
// staffIsTopLevelOrg: only the main organization header (загін level)
function staffIsTopLevelOrg(s) {
  // Matches "1 державний пожежно-рятувальний загін..." but NOT "1 ДПРЧ", "1 ДПРП"
  return /загін.*управл|загін.*дснс|державний пожежно-рятувальний загін/i.test(s);
}
// staffIsSubUnit: ДПРЧ, ДПРП, відділення, група etc — all subunits
function staffIsSubUnit(s) {
  return /^(\d+\s+)?(дпрч|дпрп|відділення|група|юридична|управління|служба|сектор|відділ)/i.test(s) || /дпрч|дпрп/i.test(s);
}
// Legacy compat alias
function staffIsMainUnitName(s) { return staffIsTopLevelOrg(s) || /дпрч|дпрп|загін|державний|пожежно-рятувальн/i.test(s); }

function staffNormCategory(raw) {
  const s = staffClean(raw).toLowerCase();
  if (s.includes('вільн')) return 'vilnyi';
  if (s.includes('дснс')) return 'dsns';
  return '';
}
function staffCategoryLabel(code) {
  if (code === 'dsns') return 'ДСНС';
  if (code === 'vilnyi') return 'Вільний найм';
  return '—';
}

function computeStaffStats(units) {
  const stats = {
    dsns: { total: 0, filled: 0, vacant: 0 },
    vilnyi: { total: 0, filled: 0, vacant: 0 },
    unknown: { total: 0, filled: 0, vacant: 0 }
  };
  units.forEach(u => {
    u.positions.forEach(p => {
      const bucket = stats[p.category] || stats.unknown;
      bucket.total++;
      if (p.filled) bucket.filled++; else bucket.vacant++;
    });
  });
  const grandTotal = units.reduce((s, u) => s + u.total, 0);
  const grandFilled = units.reduce((s, u) => s + u.filled, 0);
  stats.overall = {
    total: grandTotal,
    filled: grandFilled,
    vacant: grandTotal - grandFilled,
    pct: grandTotal > 0 ? Math.round(grandFilled / grandTotal * 100) : 0
  };
  return stats;
}

function finalizeStaffUnits(units) {
  let totalPositions = 0;
  units.forEach(u => {
    u.total = u.positions.length;
    u.filled = u.positions.filter(p => p.filled).length;
    totalPositions += u.total;
  });
  const stats = computeStaffStats(units);
  return { units, totalPositions, stats };
}

function parseStandardStaffCSV(dataRows) {
  // Format: Google Sheets CSV where:
  // - Row 0 col[0]='№ п/п', col[1]='Підрозділ/Посада + MAIN_UNIT_NAME' (merged cells)
  // - Rows with empty col[0] and non-empty col[1] are subunit headers
  // - Position rows: col[0]=number, col[1]=position title, col[2]=name, col[3]=category, col[4]=rank
  // - Summary rows ('Всього', 'Вакантно', ...) appear between sections - skip them
  // - Numbering restarts at 1 for each ДПРЧ/ДПРП section

  const rawUnits = [];
  let currentMainUnit = null;
  let currentSubName = null;

  // Pre-scan: extract main unit name from header row
  let mainUnitNameFromHeader = null;
  for (let i = 0; i < Math.min(3, dataRows.length); i++) {
    const col0 = staffClean(dataRows[i][0]);
    const col1 = staffClean(dataRows[i][1]);
    if (/^\u2116/.test(col0) && staffIsTopLevelOrg(col1)) {
      // Extract just the unit name portion from the merged header
      mainUnitNameFromHeader = col1.replace(/^[\s,]+|[\s,]+$/g, '');
      break;
    }
    if (!col0 && staffIsTopLevelOrg(col1)) {
      mainUnitNameFromHeader = col1;
      break;
    }
  }

  // If we found the main unit in header, initialize it
  if (mainUnitNameFromHeader) {
    currentMainUnit = { name: mainUnitNameFromHeader, subs: {} };
    currentSubName = '__ROOT__';
    currentMainUnit.subs[currentSubName] = [];
    rawUnits.push(currentMainUnit);
  }

  // Main parse loop
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const num   = staffClean(row[0]);
    const pos   = staffClean(row[1]);
    const person = staffClean(row[2]);
    const categoryRaw = staffClean(row[3]);
    const rank  = staffClean(row[4]);

    // Skip fully empty rows
    if (!pos && !person && !num) continue;

    // Skip summary rows (Всього, Вакантно, Зайнято, у т.ч. ...)
    if (staffIsSummaryRow(pos)) continue;

    // Skip CSV header rows (col[0] starts with '№' or contains '№ п/п')
    if (/^\u2116/.test(num)) continue;

    // Skip second-line header continuation row ("/Вільний найм", "Звання")
    if (!num && !person && /вільний\s+найм/i.test(pos + ' ' + num)) continue;

    // Subunit header row: col[0] empty, col[1] = name, col[2] empty
    if (!num && pos && !person) {
      if (staffIsTopLevelOrg(pos)) {
        // Top-level organization header (загін) — positions under it are root-level
        if (!currentMainUnit || currentMainUnit.name !== pos) {
          currentMainUnit = { name: pos, subs: {} };
          rawUnits.push(currentMainUnit);
        }
        currentSubName = '__ROOT__';
        if (!currentMainUnit.subs[currentSubName]) currentMainUnit.subs[currentSubName] = [];
      } else {
        // All other section headers are subunits (ДПРЧ, ДПРП, відділення, група, etc.)
        if (!currentMainUnit) {
          currentMainUnit = { name: 'Штатний розпис', subs: {} };
          currentSubName = '__ROOT__';
          currentMainUnit.subs[currentSubName] = [];
          rawUnits.push(currentMainUnit);
        }
        currentSubName = pos;
        if (!currentMainUnit.subs[currentSubName]) {
          currentMainUnit.subs[currentSubName] = [];
        }
      }
      continue;
    }

    // Position row: col[0] is a digit number
    if (num && /^\d+$/.test(num) && pos) {
      if (!currentMainUnit) {
        currentMainUnit = { name: 'Штатний розпис', subs: {} };
        currentSubName = '__ROOT__';
        currentMainUnit.subs[currentSubName] = [];
        rawUnits.push(currentMainUnit);
      }
      const filled = !staffIsVacant(person);
      const category = staffNormCategory(categoryRaw);
      const entry = { position: pos, name: person, filled, category, rank, categoryRaw };
      const key = currentSubName || '__ROOT__';
      if (!currentMainUnit.subs[key]) currentMainUnit.subs[key] = [];
      currentMainUnit.subs[key].push(entry);
    }
  }

  // Flatten: each subunit becomes a separate unit in the filter dropdown
  const units = [];
  rawUnits.forEach(mainUnit => {
    const subKeys = Object.keys(mainUnit.subs);
    subKeys.forEach(subKey => {
      const positions = mainUnit.subs[subKey];
      if (!positions || positions.length === 0) return;
      const displayName = subKey === '__ROOT__' ? 'Загальне керівництво загону' : subKey;
      units.push({ name: displayName, parentName: mainUnit.name, positions, subunits: {} });
    });
  });

  return finalizeStaffUnits(units);
}

function detectStandardStaffFormat(dataRows) {
  // Check first 10 rows for any signature of the standard format:
  // 1) Header contains піб + дснс/вільн (merged cells format)
  // 2) Row with col[0]='№ п/п' and col[1] contains main unit name (Google Sheets export format)
  // 3) Data rows with col[3] = 'ДСНС' or 'Вільний найм'
  for (let i = 0; i < Math.min(10, dataRows.length); i++) {
    const row = dataRows[i].map(staffClean);
    const joined = row.join(' ').toLowerCase();
    if (joined.includes('піб') && (joined.includes('дснс') || joined.includes('вільн'))) return true;
    if (row.some(c => /дснс\s*\/?\s*вільн/i.test(c))) return true;
    // Google Sheets export: Row 0 col[0] starts with '№', col[1] has unit name
    if (i === 0 && /^№/.test(row[0]) && staffIsMainUnitName(row[1])) return true;
    // Any row has ДСНС or Вільний найм in col[3]
    if ((row[3] === 'ДСНС' || /вільний найм/i.test(row[3])) && /^\d+$/.test(row[0])) return true;
  }
  return false;
}

function parseLegacyStaffCSV(dataRows) {
  const units = [];
  function looksLikeStationName(s) { return /дпрч|дпрп|державний|пожежно|загін|дснс/i.test(s); }

  let hqUnit = null, hqSub = null;
  let i = 0;

  for (; i < dataRows.length; i++) {
    const c0 = staffClean(dataRows[i][0]), c1 = staffClean(dataRows[i][1]), c2 = staffClean(dataRows[i][2]), c3 = staffClean(dataRows[i][3]);
    if (c0.includes('№') && c1.toLowerCase().includes('посада') && looksLikeStationName(c2) && !c3) {
      hqUnit = { name: c2, positions: [], subunits: {} };
      i++; break;
    }
  }

  for (; i < dataRows.length; i++) {
    const num = staffClean(dataRows[i][0]), posRaw = staffClean(dataRows[i][1]), person = staffClean(dataRows[i][2]), c3 = staffClean(dataRows[i][3]);
    if (!num && !posRaw && !person) { if (c3) break; continue; }
    if (staffIsSummaryRow(posRaw + ' ' + person)) { i++; break; }
    if (!hqUnit) continue;
    if (!num && posRaw && !person && posRaw.length < 60 && !staffIsSummaryRow(posRaw)) {
      hqSub = posRaw;
      if (!hqUnit.subunits[hqSub]) hqUnit.subunits[hqSub] = [];
      continue;
    }
    if (num && /^\d/.test(num) && posRaw) {
      const filled = !staffIsVacant(person);
      const entry = { position: posRaw, name: person, filled, category: '', rank: '' };
      hqUnit.positions.push(entry);
      if (hqSub && hqUnit.subunits[hqSub]) hqUnit.subunits[hqSub].push(entry);
    }
  }
  if (hqUnit && hqUnit.positions.length > 0) units.push(hqUnit);

  while (i < dataRows.length) {
    let stations = [];
    for (; i < dataRows.length; i++) {
      const c2 = staffClean(dataRows[i][2]), c3 = staffClean(dataRows[i][3]), c4 = staffClean(dataRows[i][4]);
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

    let lastPosition = '';
    for (; i < dataRows.length; i++) {
      const num = staffClean(dataRows[i][0]), posRaw = staffClean(dataRows[i][1]);
      const c2 = staffClean(dataRows[i][2]), c3 = staffClean(dataRows[i][3]), c4 = staffClean(dataRows[i][4]);
      if (staffIsSummaryRow(c2 + ' ' + c3 + ' ' + c4)) { i++; break; }
      if (!num && !posRaw && !c2 && !c3 && !c4) continue;
      const position = posRaw || lastPosition;
      if (position) lastPosition = position; else continue;
      [c2, c3, c4].forEach((person, si) => {
        if (si >= stations.length) return;
        if (person === '-' || person === '- В -' || person === '') person = '';
        const filled = !staffIsVacant(person);
        stations[si].positions.push({ position, name: person, filled, category: '', rank: '' });
      });
    }
    stations.forEach(s => { if (s.positions.length > 0) units.push(s); });
  }

  return finalizeStaffUnits(units);
}

function parseStaffCSV(csvOrRows) {
  // Accept either a CSV string or pre-parsed rows array (from Sheets API)
  let dataRows;
  if (csvOrRows && typeof csvOrRows === 'object' && csvOrRows.__rows) {
    // Rows already parsed by Google Sheets API (array of arrays)
    dataRows = csvOrRows.__rows;
  } else {
    // Standard CSV text
    dataRows = parseCsvRows(csvOrRows);
  }
  if (detectStandardStaffFormat(dataRows)) return parseStandardStaffCSV(dataRows);
  return parseLegacyStaffCSV(dataRows);
}

async function refreshStaffFromSheets(options = {}) {
  const { silent = false, urlOverride = null } = options;
  const url = (urlOverride || getShtatSheetUrl()).trim();
  const statusEl = document.getElementById('sheets-status');
  const previewEl = document.getElementById('sheets-preview');
  const btn = document.getElementById('sheets-import-btn');
  const refreshBtn = document.getElementById('shtat-refresh-btn');

  if (!url) {
    if (!silent) {
      const msg = '❌ Спочатку збережіть посилання на таблицю в налаштуваннях';
      if (statusEl) { statusEl.textContent = msg; statusEl.style.color = 'var(--red)'; }
    }
    return null;
  }

  if (!silent && statusEl) { statusEl.textContent = '⏳ Завантаження...'; statusEl.style.color = 'var(--blue)'; }
  if (btn) btn.disabled = true;
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    const token = localStorage.getItem('google_auth_token');
    const hasToken = !!token;

    if (!silent && statusEl) {
      statusEl.textContent = hasToken
        ? '⏳ Завантаження через Google API...'
        : '⏳ Завантаження (публічний CSV)...';
      statusEl.style.color = 'var(--blue)';
    }

    let csv = await fetchStaffCsv(url);
    let data = parseStaffCSV(csv);

    // Якщо розпізнано 0 підрозділів — спробувати ще раз, вказавши аркуш «Штат» за назвою
    if (data.units.length === 0) {
      const retryCsv = await fetchStaffCsv(url, { sheet: 'Штат' }).catch(() => null);
      if (retryCsv) {
        const retryData = parseStaffCSV(retryCsv);
        if (retryData.units.length > 0) { csv = retryCsv; data = retryData; }
      }
    }

    if (data.units.length === 0) {
      const hasGid = /[?&#]gid=\d+/.test(url);
      const hint = hasGid
        ? '\nПеревірте що таблиця відкрита для перегляду (не приватна).'
        : '\n⚠️ Порада: включіть номер аркуша (gid) в посилання.\nВідкрийте аркуш «Штат» → скопіюйте URL з браузера\n(він містить #gid=XXXXX в кінці).';
      const preview = typeof csv === 'string'
        ? csv.replace(/\s+/g, ' ').slice(0, 200)
        : JSON.stringify((csv && csv.__rows ? csv.__rows : []).slice(0, 3)).slice(0, 200);
      throw new Error('Не знайдено підрозділів у таблиці' + hint + (preview ? '\n\n📄 Отримані дані (початок):\n' + preview : ''));
    }
    saveImportedStaff(data);

    if (previewEl) {
      let html = `<strong>✅ Знайдено ${data.units.length} підрозділів, ${data.totalPositions} посад</strong><br><br>`;
      data.units.forEach(u => {
        const pct = u.total > 0 ? Math.round(u.filled / u.total * 100) : 0;
        html += `• <strong>${escHtml(u.name)}</strong> — ${u.filled}/${u.total} (${pct}%)<br>`;
      });
      previewEl.innerHTML = html;
      previewEl.style.display = 'block';
    }

    if (!silent && statusEl) {
      statusEl.textContent = `✅ Завантажено ${data.units.length} підрозділів`;
      statusEl.style.color = 'var(--green)';
      statusEl.style.background = 'var(--green-bg)';
    }

    renderShtatDashboard();
    return data;
  } catch (err) {
    let msg = err.message || String(err);

    // Provide actionable hints based on error type
    if (msg.includes('Failed to fetch') || msg.includes('fetch')) {
      const token = localStorage.getItem('google_auth_token');
      if (token) {
        msg = '❌ Помилка доступу до Google Sheets API.\n\nМожливі причини:\n• Потрібно вийти та увійти в Google знову (для нового дозволу)\n• Google Sheets API не ввімкнено у вашому Google Cloud проєкті\n• Таблиця приватна й потрібна повторна авторизація';
      } else {
        msg = '❌ Не вдалось завантажити таблицю.\n\nПеревірте:\n• Таблиця відкрита для перегляду за посиланням\n• Ви авторизовані в Google (у налаштуваннях)\n• Посилання правильне і містить #gid= аркуша';
      }
    }

    if (!silent && statusEl) {
      statusEl.style.whiteSpace = 'pre-wrap';
      statusEl.textContent = msg;
      statusEl.style.color = 'var(--red)';
    }
    if (previewEl) previewEl.style.display = 'none';
    console.error('[Staff] Error:', err);
    throw err;
  } finally {
    if (btn) btn.disabled = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

function importStaffFromSheets() {
  const urlInput = document.getElementById('sheets-url');
  const url = urlInput ? urlInput.value.trim() : '';
  if (!url) {
    const statusEl = document.getElementById('sheets-status');
    if (statusEl) { statusEl.textContent = '❌ Вставте посилання на таблицю'; statusEl.style.color = 'var(--red)'; }
    return;
  }
  localStorage.setItem(SHTAT_SHEET_URL_KEY, url);
  refreshStaffFromSheets({ urlOverride: url });
}

// Діагностика завантаження: показує, який шлях до Google спрацював, а який ні
async function runShtatDiagnostics() {
  const statusEl = document.getElementById('sheets-status');
  const previewEl = document.getElementById('sheets-preview');
  const urlInput = document.getElementById('sheets-url');
  const url = (getShtatSheetUrl() || (urlInput ? urlInput.value.trim() : '')).trim();
  const lines = [];
  const add = (s) => lines.push(s);

  add('🩺 Діагностика завантаження Штату');
  add('--------------------------------');
  if (!url) {
    add('❌ Посилання на таблицю не збережене.');
  } else {
    add('URL: ' + url);
    const idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const gidMatch = url.match(/[?&#]gid=([0-9]+)/);
    add('docId: ' + (idMatch ? idMatch[1] : '— (не знайдено /d/)'));
    add('gid: ' + (gidMatch ? gidMatch[1] : '— (не вказано → перший аркуш)'));
    add('Токен Google: ' + (localStorage.getItem('google_auth_token') ? '✅ є' : '❌ немає'));
    add('');

    if (idMatch) {
      const docId = idMatch[1];
      const gid = gidMatch ? gidMatch[1] : '';

      // 1) JSONP (gviz)
      try {
        const jsonpBase = `https://docs.google.com/spreadsheets/d/${docId}/gviz/tq${gid ? '?gid=' + gid : ''}`;
        add('1) JSONP: ' + jsonpBase.slice(0, 100));
        const t0 = Date.now();
        const gvizData = await fetchViaJsonp(jsonpBase);
        const rowsCount = (gvizData && gvizData.table && gvizData.table.rows) ? gvizData.table.rows.length : 0;
        add(`   ✅ відповідь за ${Date.now() - t0} мс, рядків: ${rowsCount}`);
        const dataRows = parseGvizJson(gvizData);
        const parsed = parseStaffCSV({ __rows: dataRows });
        add(`   → парсинг: ${parsed.units.length} підрозділів, ${parsed.totalPositions} посад`);
      } catch (e) {
        add('   ❌ JSONP: ' + e.message);
      }
      add('');

      // 2) Публічний CSV (export)
      try {
        const csvUrl = `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv${gid ? '&gid=' + gid : ''}`;
        add('2) CSV: ' + csvUrl.slice(0, 100));
        const t0 = Date.now();
        const text = await tryFetchCsv(csvUrl);
        if (text) {
          add(`   ✅ відповідь за ${Date.now() - t0} мс, символів: ${text.length}`);
          add('   початок: ' + text.replace(/\s+/g, ' ').slice(0, 130));
          const parsed = parseStaffCSV(text);
          add(`   → парсинг: ${parsed.units.length} підрозділів, ${parsed.totalPositions} посад`);
        } else {
          add('   ❌ CSV: порожня відповідь або не CSV (можливо, таблиця приватна)');
        }
      } catch (e) {
        add('   ❌ CSV: ' + e.message);
      }
      add('');

      // 3) Google Sheets API (авторизовано)
      if (localStorage.getItem('google_auth_token')) {
        try {
          add('3) Sheets API (з токеном):');
          const rows = await fetchStaffWithAuth(docId, gid, null);
          if (rows && rows.length) {
            add(`   ✅ отримано ${rows.length} рядків`);
            const parsed = parseStaffCSV({ __rows: rows });
            add(`   → парсинг: ${parsed.units.length} підрозділів, ${parsed.totalPositions} посад`);
          } else {
            add('   ❌ API повернув порожньо');
          }
        } catch (e) {
          add('   ❌ Sheets API: ' + e.message);
        }
      } else {
        add('3) Sheets API: пропущено (немає токена)');
      }
    }
  }

  const out = lines.join('\n');
  console.log('[Staff] Diagnostics:\n' + out);
  if (statusEl) {
    statusEl.style.whiteSpace = 'pre-wrap';
    statusEl.textContent = out;
    statusEl.style.color = 'var(--text2)';
    statusEl.style.background = 'var(--surface2)';
  }
  if (previewEl) {
    previewEl.style.display = 'block';
    previewEl.style.whiteSpace = 'pre-wrap';
    previewEl.textContent = out;
  }
}

function shtatPctColor(pct) {
  if (pct >= 90) return 'var(--green)';
  if (pct >= 70) return 'var(--amber)';
  return 'var(--red)';
}

function getShtatFilterValue() {
  return localStorage.getItem(SHTAT_FILTER_KEY) || 'all';
}

function setShtatFilterValue(value) {
  localStorage.setItem(SHTAT_FILTER_KEY, value || 'all');
}

function renderShtatPositionRow(p) {
  const catLabel = staffCategoryLabel(p.category);
  const catClass = p.category === 'dsns' ? 'cat-dsns' : (p.category === 'vilnyi' ? 'cat-vilnyi' : '');
  return `<div class="shtat-position-row ${p.filled ? '' : 'vacant'}">
    <span class="shtat-position-name">${escHtml(p.position)}</span>
    <span class="shtat-position-cat ${catClass}">${escHtml(catLabel)}</span>
    <span class="shtat-position-status ${p.filled ? 'filled' : 'vacant'}">${p.filled ? '✓' : 'Вакант'}</span>
    <span class="shtat-position-person">${p.filled ? escHtml(p.name) : '—'}</span>
    ${p.rank ? `<span class="shtat-position-rank">${escHtml(p.rank)}</span>` : ''}
  </div>`;
}

function renderShtatDashboard() {
  const container = document.getElementById('shtat-dashboard');
  const toolbar = document.getElementById('shtat-toolbar');
  const filterSelect = document.getElementById('shtat-unit-filter');
  if (!container) return;

  const data = loadImportedStaff();

  if (!data.units.length) {
    if (toolbar) toolbar.style.display = 'none';
    container.innerHTML = `
      <div class="shtat-empty">
        <div class="shtat-empty-icon">📊</div>
        <div class="shtat-empty-title">Немає даних штатного розпису</div>
        <div class="shtat-empty-sub">
          Вкажіть посилання на Google Таблицю в <code>Налаштування → 📊 Google Таблиці</code><br>
          і натисніть «Зберегти посилання» або «Завантажити Штат»
        </div>
      </div>`;
    return;
  }

  if (toolbar) toolbar.style.display = '';

  const stats = data.stats || computeStaffStats(data.units);
  const filterValue = getShtatFilterValue();
  const visibleUnits = filterValue === 'all'
    ? data.units
    : data.units.filter((_, i) => String(i) === filterValue);

  if (filterSelect) {
    const prev = filterSelect.value;
    filterSelect.innerHTML = `<option value="all">Всі підрозділи (${data.units.length})</option>` +
      data.units.map((u, i) => {
        const pct = u.total > 0 ? Math.round(u.filled / u.total * 100) : 0;
        const label = u.name.length > 55 ? u.name.slice(0, 52) + '…' : u.name;
        return `<option value="${i}">${escHtml(label)} — ${u.filled}/${u.total} (${pct}%)</option>`;
      }).join('');
    filterSelect.value = [...filterSelect.options].some(o => o.value === prev) ? prev : filterValue;
  }

  const showStats = filterValue === 'all' ? stats : computeStaffStats(visibleUnits);
  const barColor = shtatPctColor(showStats.overall.pct);

  // --- Rank category analysis ---
  const OFFICER_RANKS = ['полковник','підполковник','майор','капітан','старший лейтенант','лейтенант','молодший лейтенант'];
  const SERGEANT_RANKS = ['головний майстер-сержант','майстер-сержант','сержант','рядовий'];
  function rankGroup(r) {
    const rv = (r || '').toLowerCase();
    if (OFFICER_RANKS.some(rr => rv.includes(rr))) return 'officer';
    if (SERGEANT_RANKS.some(rr => rv.includes(rr))) return 'sergeant';
    return 'norank';
  }
  const allVis = visibleUnits.flatMap(u => u.positions);
  const rankStats = { officer: {total:0,filled:0}, sergeant: {total:0,filled:0}, vilnyi: {total:0,filled:0}, norank: {total:0,filled:0} };
  allVis.forEach(p => {
    const g = p.category === 'vilnyi' ? 'vilnyi' : rankGroup(p.rank);
    if (!rankStats[g]) rankStats[g] = { total: 0, filled: 0 };
    rankStats[g].total++;
    if (p.filled) rankStats[g].filled++;
  });

  let html = '';
  html += `<div class="shtat-summary-cards">
    <div class="shtat-stat total"><div class="shtat-stat-label">Всього посад</div><div class="shtat-stat-value">${showStats.overall.total}</div><div class="shtat-stat-sub">за штатним розписом</div></div>
    <div class="shtat-stat filled"><div class="shtat-stat-label">Укомплектовано</div><div class="shtat-stat-value">${showStats.overall.filled}</div><div class="shtat-stat-sub">особового складу</div></div>
    <div class="shtat-stat vacant"><div class="shtat-stat-label">Вакантно</div><div class="shtat-stat-value">${showStats.overall.vacant}</div><div class="shtat-stat-sub">вільних посад</div></div>
    <div class="shtat-stat pct" style="--pct-color:${barColor}"><div class="shtat-stat-label">Укомплектованість</div><div class="shtat-stat-value" style="color:${barColor}">${showStats.overall.pct}%</div><div class="shtat-stat-sub">від штатної чисельності</div></div>
  </div>`;



  html += `<div class="shtat-analysis-grid">
    <div class="shtat-analysis-card">
      <div class="shtat-analysis-title">🔵 ДСНС</div>
      <div class="shtat-analysis-main">${showStats.dsns.filled}<span class="shtat-analysis-of"> / ${showStats.dsns.total}</span></div>
      <div class="shtat-analysis-sub">вакантно: <strong>${showStats.dsns.vacant}</strong> · ${showStats.dsns.total > 0 ? Math.round(showStats.dsns.filled / showStats.dsns.total * 100) : 0}%</div>
      <div class="shtat-mini-bar"><div class="shtat-mini-bar-fill cat-dsns" style="width:${showStats.dsns.total ? Math.round(showStats.dsns.filled / showStats.dsns.total * 100) : 0}%"></div></div>
    </div>
    <div class="shtat-analysis-card">
      <div class="shtat-analysis-title">🟡 Вільний найм</div>
      <div class="shtat-analysis-main">${showStats.vilnyi.filled}<span class="shtat-analysis-of"> / ${showStats.vilnyi.total}</span></div>
      <div class="shtat-analysis-sub">вакантно: <strong>${showStats.vilnyi.vacant}</strong> · ${showStats.vilnyi.total > 0 ? Math.round(showStats.vilnyi.filled / showStats.vilnyi.total * 100) : 0}%</div>
      <div class="shtat-mini-bar"><div class="shtat-mini-bar-fill cat-vilnyi" style="width:${showStats.vilnyi.total ? Math.round(showStats.vilnyi.filled / showStats.vilnyi.total * 100) : 0}%"></div></div>
    </div>
    <div class="shtat-analysis-card">
      <div class="shtat-analysis-title">🎖 Офіцерський склад</div>
      <div class="shtat-analysis-main">${rankStats.officer.filled}<span class="shtat-analysis-of"> / ${rankStats.officer.total}</span></div>
      <div class="shtat-analysis-sub">вакантно: <strong>${rankStats.officer.total - rankStats.officer.filled}</strong> · ${rankStats.officer.total > 0 ? Math.round(rankStats.officer.filled / rankStats.officer.total * 100) : 0}%</div>
      <div class="shtat-mini-bar"><div class="shtat-mini-bar-fill cat-officer" style="width:${rankStats.officer.total ? Math.round(rankStats.officer.filled / rankStats.officer.total * 100) : 0}%"></div></div>
    </div>
    <div class="shtat-analysis-card">
      <div class="shtat-analysis-title">🪖 Сержанти / рядові</div>
      <div class="shtat-analysis-main">${rankStats.sergeant.filled}<span class="shtat-analysis-of"> / ${rankStats.sergeant.total}</span></div>
      <div class="shtat-analysis-sub">вакантно: <strong>${rankStats.sergeant.total - rankStats.sergeant.filled}</strong> · ${rankStats.sergeant.total > 0 ? Math.round(rankStats.sergeant.filled / rankStats.sergeant.total * 100) : 0}%</div>
      <div class="shtat-mini-bar"><div class="shtat-mini-bar-fill cat-sergeant" style="width:${rankStats.sergeant.total ? Math.round(rankStats.sergeant.filled / rankStats.sergeant.total * 100) : 0}%"></div></div>
    </div>
    ${rankStats.norank.total > 0 ? `<div class="shtat-analysis-card">
      <div class="shtat-analysis-title">🎖 Без рангу</div>
      <div class="shtat-analysis-main">${rankStats.norank.filled}<span class="shtat-analysis-of"> / ${rankStats.norank.total}</span></div>
      <div class="shtat-analysis-sub">вакантно: <strong>${rankStats.norank.total - rankStats.norank.filled}</strong></div>
      <div class="shtat-mini-bar"><div class="shtat-mini-bar-fill" style="width:${rankStats.norank.total ? Math.round(rankStats.norank.filled / rankStats.norank.total * 100) : 0}%;background:var(--text3)"></div></div>
    </div>` : ''}
    ${showStats.unknown.total > 0 ? `<div class="shtat-analysis-card">
      <div class="shtat-analysis-title">⚪ Не визначено</div>
      <div class="shtat-analysis-main">${showStats.unknown.filled}<span class="shtat-analysis-of"> / ${showStats.unknown.total}</span></div>
      <div class="shtat-analysis-sub">вакантно: <strong>${showStats.unknown.vacant}</strong></div>
      <div class="shtat-mini-bar"><div class="shtat-mini-bar-fill" style="width:${showStats.unknown.total ? Math.round(showStats.unknown.filled / showStats.unknown.total * 100) : 0}%;background:var(--text3)"></div></div>
    </div>` : ''}
    <div class="shtat-analysis-card shtat-analysis-wide">
      <div class="shtat-analysis-title">📊 Укомплектованість по підрозділах (топ вакантних)</div>
      <div class="shtat-unit-ranking">`;



  const ranked = [...(filterValue === 'all' ? data.units : visibleUnits)]
    .map(u => ({ name: u.name, pct: u.total > 0 ? Math.round(u.filled / u.total * 100) : 0, filled: u.filled, total: u.total, vacant: u.total - u.filled }))
    .sort((a, b) => a.pct - b.pct);

  ranked.slice(0, 8).forEach(u => {
    const color = shtatPctColor(u.pct);
    const shortName = u.name.length > 42 ? u.name.slice(0, 39) + '…' : u.name;
    const vacantBadge = u.vacant > 0 ? ` <span class="shtat-rank-vac">${u.vacant} вак.</span>` : '';
    html += `<div class="shtat-rank-row">
      <span class="shtat-rank-name" title="${escHtml(u.name)}">${escHtml(shortName)}${vacantBadge}</span>
      <div class="shtat-rank-bar-wrap"><div class="shtat-rank-bar-fill" style="width:${u.pct}%;background:${color}"></div></div>
      <span class="shtat-rank-pct" style="color:${color}">${u.filled}/${u.total}</span>
    </div>`;
  });

  html += `</div></div></div>`;

  html += `<div class="shtat-overall-bar-wrap">
    <div class="shtat-overall-label">
      <span class="shtat-overall-title">Загальна укомплектованість</span>
      <span class="shtat-overall-pct" style="color:${barColor}">${showStats.overall.filled} з ${showStats.overall.total}</span>
    </div>
    <div class="shtat-overall-track"><div class="shtat-overall-fill" style="width:${showStats.overall.pct}%;background:${barColor};"></div></div>
  </div>`;

  html += `<div class="shtat-units-list">`;
  visibleUnits.forEach((u, vi) => {
    const unitIndex = filterValue === 'all' ? data.units.indexOf(u) : Number(filterValue);
    const pct = u.total > 0 ? Math.round(u.filled / u.total * 100) : 0;
    const color = shtatPctColor(pct);
    const openClass = filterValue !== 'all' ? ' open' : '';

    html += `<div class="shtat-unit-card${openClass}" id="shtat-unit-${unitIndex}">
      <div class="shtat-unit-header" onclick="toggleShtatUnit(${unitIndex})">
        <div class="shtat-unit-name"><span class="shtat-unit-chevron">▶</span> ${escHtml(u.name)}</div>
        <div class="shtat-unit-meta">
          <span class="shtat-unit-cats">ДСНС ${u.positions.filter(p => p.category === 'dsns' && p.filled).length}/${u.positions.filter(p => p.category === 'dsns').length}</span>
          <span class="shtat-unit-cats">ВН ${u.positions.filter(p => p.category === 'vilnyi' && p.filled).length}/${u.positions.filter(p => p.category === 'vilnyi').length}</span>
        </div>
        <div class="shtat-unit-bar-wrap"><div class="shtat-unit-bar-fill" style="width:${pct}%;background:${color};"></div></div>
        <div class="shtat-unit-count" style="color:${color}">${u.filled}/${u.total}</div>
      </div>
      <div class="shtat-unit-detail">`;

    if (u.subunits && Object.keys(u.subunits).length > 0) {
      Object.entries(u.subunits).forEach(([subName, positions]) => {
        if (!positions || !positions.length) return;
        html += `<div class="shtat-unit-subsection">
          <div class="shtat-subsection-title">${escHtml(subName)}</div>`;
        positions.forEach(p => { html += renderShtatPositionRow(p); });
        html += `</div>`;
      });
    } else {
      html += `<div class="shtat-unit-subsection">`;
      u.positions.forEach(p => { html += renderShtatPositionRow(p); });
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

function initShtatToolbar() {
  const filterSelect = document.getElementById('shtat-unit-filter');
  const refreshBtn = document.getElementById('shtat-refresh-btn');
  if (filterSelect && !filterSelect.dataset.bound) {
    filterSelect.dataset.bound = '1';
    filterSelect.addEventListener('change', () => {
      setShtatFilterValue(filterSelect.value);
      renderShtatDashboard();
    });
  }
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = '1';
    refreshBtn.addEventListener('click', () => {
      refreshStaffFromSheets().catch(() => {});
    });
  }
}

function initShtatMode() {
  initShtatToolbar();
  renderShtatDashboard();
  // Якщо посилання збережене, але дані ще не завантажені — завантажити автоматично
  if (getShtatSheetUrl() && !loadImportedStaff().units.length && !window.__shtatAutoLoaded) {
    window.__shtatAutoLoaded = true;
    refreshStaffFromSheets({ silent: true }).catch(() => {});
  }
}

// ---- Init ----
// ---- Голосове введення (безкоштовний Web Speech API, без ключів і лімітів) ----
// Підтримка: Chrome/Edge (десктоп + Android, у т.ч. Telegram Android WebView).
// НЕ підтримується: Safari/iOS та Telegram iOS WebView — кнопки мікрофону
// на таких пристроях автоматично приховуються, решта функціоналу не страждає.
// ---- Голосове введення: Web Speech API → фолбек на запис через Gemini ----
let voiceStatusTimer = null;
function showVoiceStatus(text, isError = false) {
  let el = document.getElementById('voice-status-tip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'voice-status-tip';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(voiceStatusTimer);
  voiceStatusTimer = setTimeout(() => el.classList.remove('show'), isError ? 6000 : 4000);
}

// webm/opus → 16-бітний WAV (моно, 16кГц), base64 для Gemini
function audioBlobToWavBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не вдалося прочитати аудіо'));
    reader.onload = async () => {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AC();
        const audioBuffer = await audioCtx.decodeAudioData(reader.result);
        const wavBase64 = audioBufferToWavBase64(audioBuffer);
        audioCtx.close();
        resolve(wavBase64);
      } catch (e) {
        reject(new Error('Аудіоформат не підтримується'));
      }
    };
    reader.readAsArrayBuffer(blob);
  });
}

function audioBufferToWavBase64(buffer) {
  const numChannels = 1;
  const sampleRate = Math.min(16000, buffer.sampleRate);
  const length = Math.max(1, Math.floor(buffer.length * sampleRate / buffer.sampleRate));
  const wav = new ArrayBuffer(44 + length * 2);
  const view = new DataView(wav);
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length * 2, true);

  const source = buffer.getChannelData(0);
  const step = buffer.sampleRate / sampleRate;
  let offset = 44;
  for (let i = 0; i < length; i++) {
    let s = source[Math.min(source.length - 1, Math.floor(i * step))];
    s = Math.max(-1, Math.min(1, s));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  let binary = '';
  const bytes = new Uint8Array(wav);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Кешуємо потік мікрофона — запит дозволу браузера з'являється максимум один раз за сесію
let cachedMicStream = null;
let cachedMicStreamPromise = null;
function getMicStream() {
  if (cachedMicStream) return Promise.resolve(cachedMicStream);
  if (!cachedMicStreamPromise) {
    cachedMicStreamPromise = navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => { cachedMicStream = stream; return stream; })
      .catch((err) => { cachedMicStreamPromise = null; throw err; });
  }
  return cachedMicStreamPromise;
}
async function micPermissionState() {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    return status.state; // 'granted' | 'prompt' | 'denied'
  } catch (e) {
    return 'prompt';
  }
}

// Транскрипція через Google Cloud Speech-to-Text (використовує Google-авторизацію застосунку)
async function transcribeViaGoogleSpeech(wavBase64) {
  const token = localStorage.getItem('google_auth_token');
  if (!token) return { needAuth: true };
  const resp = await fetch('https://speech.googleapis.com/v1/speech:recognize', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: { encoding: 'LINEAR16', sampleRateHertz: 16000, languageCode: 'uk-UA' },
      audio: { content: wavBase64 }
    })
  });
  if (resp.status === 401 || resp.status === 403 || !resp.ok) {
    // Токен старий (без speech-скоупу), недійсний або проєкт без billing —
    // сигнал спробувати інший бекенд (Gemini)
    return { needAuth: true };
  }
  const data = await resp.json();
  const text = (data.results || [])
    .map(r => r.alternatives?.[0]?.transcript || '')
    .join(' ')
    .trim();
  return { text };
}

// Транскрипція через Gemini (фолбек, якщо немає Google-доступу)
async function transcribeViaGemini(wavBase64, key) {
  const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: 'Транскрибуй українське аудіо. Поверни ТІЛЬКИ розпізнаний текст без лапок, пояснень та зайвих слів.' },
        { inlineData: { mimeType: 'audio/wav', data: wavBase64 } }
      ] }],
      generationConfig: { temperature: 0, maxOutputTokens: 2048 }
    })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || 'HTTP ' + resp.status);
  }
  const data = await resp.json();
  return (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
}

function initVoiceInput() {
  const micButtons = document.querySelectorAll('.mic-btn');
  let session = null; // { btn, field, stop() }

  function endSession() {
    if (session) {
      try { session.stop(); } catch (e) { /* ignore */ }
      session.btn.classList.remove('is-recording');
      session = null;
    }
  }

  // Запис через MediaRecorder → транскрипція (Google Speech або Gemini)
  async function startRecordSession(btn, field) {
    if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;
    const hasGoogle = !!localStorage.getItem('google_auth_token');
    const hasGemini = (localStorage.getItem('gemini_api_key') || '').trim().length >= 10;
    if (!hasGoogle && !hasGemini) {
      showVoiceStatus('Для голосу потрібен вхід у Google (Налаштування → Безпека) або Gemini API Key', true);
      return null;
    }

    const perm = await micPermissionState();
    if (perm === 'denied') {
      showVoiceStatus('Доступ до мікрофона заборонено — дозвольте його у налаштуваннях браузера', true);
      return null;
    }

    let stream;
    try {
      stream = await getMicStream();
    } catch (e) {
      showVoiceStatus('Доступ до мікрофона заборонено', true);
      return null;
    }

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
    let recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    let chunks = [];

    async function transcribe() {
      if (!chunks.length) { showVoiceStatus('Запис порожній', true); return; }
      showVoiceStatus('Розпізнаю…');
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const wavBase64 = await audioBlobToWavBase64(blob);

        // 1) Google Speech-to-Text (якщо користувач авторизований в Google)
        let text = '';
        const googleRes = await transcribeViaGoogleSpeech(wavBase64);
        if (googleRes.text) {
          text = googleRes.text;
        } else if (googleRes.needAuth) {
          // 2) Google недоступний (billing/скоуп) — пробуємо Gemini (безкоштовно)
          const key = (localStorage.getItem('gemini_api_key') || '').trim();
          if (key.length >= 10) {
            showVoiceStatus('Розпізнаю через Gemini…');
            text = await transcribeViaGemini(wavBase64, key);
          } else {
            showVoiceStatus('Google Speech вимагає billing — вставте безкоштовний Gemini API Key (Налаштування → AI та дані)', true);
            return;
          }
        }

        if (!text) { showVoiceStatus('Не вдалося розпізнати мову', true); return; }
        const base = field.value ? (field.value.replace(/\s+$/, '') + ' ') : '';
        field.value = (base + text).trim();
        field.dispatchEvent(new Event('input', { bubbles: true }));
        showVoiceStatus('Готово');
      } catch (e) {
        console.warn('[VoiceInput] Помилка розпізнавання:', e);
        showVoiceStatus('Помилка розпізнавання: ' + e.message, true);
      }
    }

    const sessionObj = {
      btn, field,
      stop() {
        if (recorder && recorder.state !== 'inactive') {
          try { recorder.stop(); } catch (e) { /* ignore */ }
        }
      }
    };

    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => { transcribe(); };
    recorder.start();
    // Автостоп через 45 секунд, щоб запис не висів вічно
    setTimeout(() => {
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (e) { /* ignore */ }
      }
    }, 45000);
    showVoiceStatus('Запис… Торкніться мікрофона ще раз, щоб завершити');
    return sessionObj;
  }

  // Стандартне розпізнавання Web Speech API (з дедуплікацією фінального тексту)
  function startSpeechSession(btn, field) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    let rec;
    try { rec = new SR(); } catch (e) { return null; }

    rec.lang = 'uk-UA';
    rec.continuous = true;
    rec.interimResults = true;

    let baseValue = field.value ? (field.value.replace(/\s+$/, '') + ' ') : '';
    const seenFinals = new Set();

    const sessionObj = {
      btn, field,
      stop() { try { rec.stop(); } catch (e) { /* ignore */ } }
    };

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          const t = res[0].transcript.trim();
          if (t && !seenFinals.has(t)) {
            seenFinals.add(t);
            baseValue += t + ' ';
          }
        } else {
          interim += res[0].transcript;
        }
      }
      field.value = (baseValue + interim).trim();
      field.dispatchEvent(new Event('input', { bubbles: true }));
      // Шлях спрацював — наступного разу починаємо з нього
      localStorage.setItem('voice_mode', 'speech');
    };

    rec.onerror = (event) => {
      const fatal = ['network', 'not-allowed', 'service-not-allowed', 'language-not-supported'];
      endSession();
      if (fatal.includes(event.error)) {
        // Стандартне розпізнавання недоступне — перемикаємось на запис через Gemini
        localStorage.setItem('voice_mode', 'gemini');
        startRecordSession(btn, field).then((s) => {
          if (s) {
            session = s;
            btn.classList.add('is-recording');
            showVoiceStatus('Стандартне розпізнавання недоступне — записую через Gemini…');
          }
        });
      } else {
        showVoiceStatus('Розпізнавання перервано (' + event.error + ')', true);
      }
    };

    rec.onend = () => { if (session === sessionObj) endSession(); };

    try { rec.start(); } catch (e) { return null; }
    return sessionObj;
  }

  micButtons.forEach((btn) => {
    const field = document.getElementById(btn.dataset.target);
    if (!field) { btn.classList.add('is-unsupported'); return; }

    btn.addEventListener('click', async () => {
      // Повторний клік по активній кнопці — зупинити запис
      if (session && session.btn === btn) { endSession(); return; }

      // Перемикання на інше поле — зупинити попередній запис
      endSession();

      // У Telegram WebView Speech API запитує дозвіл мікрофона щоразу і погано працює —
      // одразу йдемо в запис через Gemini (один запит дозволу за сесію, потік кешується)
      const inTelegram = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
      const useGemini = inTelegram || localStorage.getItem('voice_mode') === 'gemini';
      const canSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

      if (!useGemini && canSpeech) {
        session = startSpeechSession(btn, field);
        if (session) { btn.classList.add('is-recording'); return; }
      }

      session = await startRecordSession(btn, field);
      if (session) btn.classList.add('is-recording');
      else showVoiceStatus('Голосове введення недоступне на цьому пристрої', true);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('[App] DOMContentLoaded, starting init...');

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
  document.querySelectorAll('.mobile-nav-item').forEach(btn => btn.addEventListener('click', () => setAppMode(btn.dataset.mode)));
  initDeadlineFocusUI();
  const requiredToggleBtn = document.getElementById('required-toggle-btn');
  if (requiredToggleBtn) requiredToggleBtn.addEventListener('click', () => setRequiredUndatedVisible(!shouldShowRequiredUndated()));
  updateRequiredToggleUI();

  // AI mode toggle (Add modal)
  const aiToggleEl = document.getElementById('ai-mode-toggle');
  if (aiToggleEl) aiToggleEl.addEventListener('change', applyAiModeVisibility);

  initSettings();
  initSettingsNav();
  initTheme();
  initProjectsWorkspace();
  initOpsWorkspace();
  initTabScrollArrows();
  initVoiceInput();
  populateDatalist();
  loadFromLocal();

  // Автоматична двостороння синхронізація з Google Drive
  window.addEventListener('focus', () => {
    if (currentUser) loadFromDrive();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentUser) loadFromDrive();
  });
  setInterval(() => {
    if (currentUser) loadFromDrive();
  }, 16000);

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
  // Аварійний скид блокування через URL: index.html?reset_lock=1
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset_lock') === '1') {
      localStorage.removeItem(LOCK_HASH_KEY);
      localStorage.removeItem(AUTO_LOCK_ENABLED_KEY);
      localStorage.removeItem(AUTO_LOCK_TIMEOUT_KEY);
      history.replaceState(null, '', window.location.pathname);
      console.log('[Lock] Protection reset via ?reset_lock=1');
    }
  } catch (e) { console.warn('Lock reset param failed:', e); }
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
  const sheetsUrlInput = document.getElementById('sheets-url');
  const sheetsImportBtn = document.getElementById('sheets-import-btn');
  const sheetsSaveBtn = document.getElementById('sheets-save-btn');
  const sheetsResetBtn = document.getElementById('sheets-reset-btn');
  const sheetsStatusSpan = document.getElementById('sheets-status');

  if (sheetsUrlInput) {
    const savedShtatUrl = getShtatSheetUrl();
    if (savedShtatUrl) sheetsUrlInput.value = savedShtatUrl;
  }

  if (sheetsSaveBtn) {
    sheetsSaveBtn.addEventListener('click', () => {
      const raw = sheetsUrlInput ? sheetsUrlInput.value.trim() : '';
      if (!raw) {
        localStorage.removeItem(SHTAT_SHEET_URL_KEY);
        if (sheetsStatusSpan) sheetsStatusSpan.textContent = 'Посилання видалено';
      } else if (!/\/d\/[a-zA-Z0-9-_]+/.test(raw)) {
        if (sheetsStatusSpan) { sheetsStatusSpan.textContent = '❌ Невірне посилання'; sheetsStatusSpan.style.color = 'var(--red)'; }
        return;
      } else {
        localStorage.setItem(SHTAT_SHEET_URL_KEY, raw);
        const hasGid = /[?&#]gid=\d+/.test(raw);
        if (!hasGid) {
          if (sheetsStatusSpan) {
            sheetsStatusSpan.textContent = '⚠️ Збережено, але gid не вказано. Відкрийте аркуш «Штат» і скопіюйте URL з браузера.';
            sheetsStatusSpan.style.color = 'var(--amber)';
          }
        } else {
          if (sheetsStatusSpan) { sheetsStatusSpan.textContent = '💾 Збережено!'; sheetsStatusSpan.style.color = 'var(--green)'; }
        }
      }
      setTimeout(() => { if (sheetsStatusSpan) { sheetsStatusSpan.textContent = ''; sheetsStatusSpan.style.background = ''; } }, 5000);
    });
  }

  if (sheetsResetBtn) {
    sheetsResetBtn.addEventListener('click', () => {
      localStorage.removeItem(SHTAT_SHEET_URL_KEY);
      localStorage.removeItem(SHTAT_IMPORTED_KEY);
      localStorage.removeItem(SHTAT_FILTER_KEY);
      if (sheetsUrlInput) sheetsUrlInput.value = '';
      if (sheetsStatusSpan) sheetsStatusSpan.textContent = 'Скинуто';
      const previewEl = document.getElementById('sheets-preview');
      if (previewEl) previewEl.style.display = 'none';
      renderShtatDashboard();
      setTimeout(() => { if (sheetsStatusSpan) sheetsStatusSpan.textContent = ''; }, 3000);
    });
  }

  if (sheetsImportBtn) {
    sheetsImportBtn.addEventListener('click', importStaffFromSheets);
  }

  const sheetsGoogleLoginBtn = document.getElementById('sheets-google-login-btn');
  if (sheetsGoogleLoginBtn) {
    sheetsGoogleLoginBtn.addEventListener('click', signInWithGoogle);
  }
  const sheetsDiagnosticsBtn = document.getElementById('sheets-diagnostics-btn');
  if (sheetsDiagnosticsBtn) {
    sheetsDiagnosticsBtn.addEventListener('click', runShtatDiagnostics);
  }
  updateShtatAuthStatus();

  // ---- Clear Cache & Force Reload ----
  const clearCacheBtn = document.getElementById('clear-cache-btn');
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', async () => {
      clearCacheBtn.disabled = true;
      clearCacheBtn.textContent = '⏳ Очищення кешу...';
      try {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            await registration.unregister();
          }
        }
        if (window.caches) {
          const keys = await caches.keys();
          for (const key of keys) {
            await caches.delete(key);
          }
        }
        localStorage.removeItem('shtat_imported_data');
        alert('Кеш успішно очищено! Додаток буде перезавантажено.');
        window.location.reload(true);
      } catch (err) {
        console.error(err);
        alert('Помилка при очищенні кешу. Перезавантажуємо сторінку...');
        window.location.reload();
      }
    });
  }

  // ---- PMM Custom Google Sheet URL Settings ----
  const pmmUrlInput = document.getElementById('pmm-sheets-url');
  const pmmSaveBtn = document.getElementById('pmm-sheets-save-btn');
  const pmmResetBtn = document.getElementById('pmm-sheets-reset-btn');
  const pmmStatusSpan = document.getElementById('pmm-sheets-status');

  if (pmmUrlInput) {
    const savedCustomUrl = localStorage.getItem(PMM_CUSTOM_URL_KEY);
    if (savedCustomUrl) pmmUrlInput.value = savedCustomUrl;
  }

  if (pmmSaveBtn) {
    pmmSaveBtn.addEventListener('click', async () => {
      const raw = pmmUrlInput ? pmmUrlInput.value.trim() : '';
      if (!raw) {
        localStorage.removeItem(PMM_CUSTOM_URL_KEY);
        if (pmmStatusSpan) pmmStatusSpan.textContent = 'Використовується стандартне посилання';
      } else {
        localStorage.setItem(PMM_CUSTOM_URL_KEY, raw);
        if (pmmStatusSpan) pmmStatusSpan.textContent = 'Збережено!';
      }
      fetchPmmData().then(freshData => {
        if (freshData && activeAppMode === 'pmm') {
          renderPmmWorkspace();
        }
      });
      setTimeout(() => { if (pmmStatusSpan) pmmStatusSpan.textContent = ''; }, 3000);
    });
  }

  if (pmmResetBtn) {
    pmmResetBtn.addEventListener('click', () => {
      localStorage.removeItem(PMM_CUSTOM_URL_KEY);
      if (pmmUrlInput) pmmUrlInput.value = '';
      if (pmmStatusSpan) pmmStatusSpan.textContent = 'Скинуто до стандартного';
      fetchPmmData().then(freshData => {
        if (freshData && activeAppMode === 'pmm') {
          renderPmmWorkspace();
        }
      });
      setTimeout(() => { if (pmmStatusSpan) pmmStatusSpan.textContent = ''; }, 3000);
    });
  }

  // Ініціалізація дашборду Штату
  initShtatMode();
});

// ═══════════════════════════════════════════════════════════════════
// ⛽ ПММ (Пально-Мастильні Матеріали) — Google Sheet Integration & Infographics
// ═══════════════════════════════════════════════════════════════════
const PMM_CUSTOM_URL_KEY = 'deadline_pmm_custom_sheet_url';
const PMM_CACHE_KEY = 'deadline_pmm_cache_v1';

let pmmSearchQuery = '';
let pmmActiveFilter = 'all'; // 'all', 'low'

// Returns null if no URL has been configured by the user
function getPmmCustomUrl() {
  const v = localStorage.getItem(PMM_CUSTOM_URL_KEY);
  return (v && v.trim()) ? v.trim() : null;
}

function getCandidateCsvUrls() {
  const url = getPmmCustomUrl();
  if (!url) return []; // no URL configured — nothing to try

  // Apps Script URL — use directly (no CORS issues)
  if (url.includes('script.google.com/macros')) {
    return [url];
  }

  // Google Sheets URL — derive CSV export variants
  const idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return [url]; // unknown format, try as-is
  const docId = idMatch[1];
  const gidMatch = url.match(/[?&]gid=([0-9]+)/) || url.match(/#gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : '0';

  return [
    `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${docId}/gviz/tq?tqx=out:csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv`
  ];
}

async function tryFetchCsv(url) {
  // Attempt 1: direct with cache bypass + credentials
  try {
    const r1 = await fetch(url, { cache: 'no-store', credentials: 'include', redirect: 'follow' });
    console.log(`PMM fetch [creds] ${url.slice(0, 60)} => status:${r1.status}`);
    if (r1.ok) {
      const t = await r1.text();
      console.log(`PMM response preview: ${t.slice(0, 120).replace(/\n/g, '|')}`);
      if (t && !t.trimStart().startsWith('<') && t.includes(',')) return t;
      console.warn('PMM: response looks like HTML, not CSV');
    }
  } catch (e) { console.warn('PMM fetch [creds] error:', e.message); }

  // Attempt 2: simple fetch without credentials (for public sheets with CORS)
  try {
    const r2 = await fetch(url, { cache: 'no-store', redirect: 'follow' });
    console.log(`PMM fetch [no-creds] ${url.slice(0, 60)} => status:${r2.status}`);
    if (r2.ok) {
      const t = await r2.text();
      console.log(`PMM response preview: ${t.slice(0, 120).replace(/\n/g, '|')}`);
      if (t && !t.trimStart().startsWith('<') && t.includes(',')) return t;
      console.warn('PMM: response looks like HTML, not CSV');
    }
  } catch (e) { console.warn('PMM fetch [no-creds] error:', e.message); }

  return null;
}

async function fetchPmmData() {
  const candidateUrls = getCandidateCsvUrls();

  // No URL configured by user — don't try anything
  if (candidateUrls.length === 0) {
    console.info('PMM: no URL configured, skipping fetch');
    return null;
  }

  let csvText = null;

  for (const url of candidateUrls) {
    csvText = await tryFetchCsv(url);
    if (csvText) {
      console.log('PMM: loaded CSV from', url.slice(0, 70));
      break;
    }
    console.warn('PMM: no valid CSV from', url.slice(0, 70));
  }

  if (csvText) {
    const data = parsePmmCsv(csvText);
    data.lastFetchedAt = new Date().toISOString();
    localStorage.setItem(PMM_CACHE_KEY, JSON.stringify(data));
    return data;
  }

  console.warn('PMM: all candidates failed, loading from cache');
  const cached = localStorage.getItem(PMM_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* corrupted cache */ }
  }
  return null;
}

function parseCsvLines(csvText) {
  const lines = [];
  let currentField = '';
  let inQuotes = false;
  let currentRow = [];

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentField.trim());
      if (currentRow.some(field => field.length > 0)) lines.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(field => field.length > 0)) lines.push(currentRow);
  }
  return lines;
}

function parseNumber(val) {
  if (!val) return 0;
  const clean = String(val).replace(/\s+/g, '').replace(',', '.');
  const num = parseFloat(clean);
  return Number.isNaN(num) ? 0 : num;
}

function parsePmmCsv(csvText) {
  const rows = parseCsvLines(csvText);
  let asOfDate = 'Сьогодні';
  const units = [];
  let currentUnit = null;

  let overallStock = { dt: 0, petrol: 0, foam: 0 };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 4) continue;

    // Check for date row: "Станом на", "31.07.2026"
    for (let j = 0; j < row.length; j++) {
      if (row[j].includes('Станом на')) {
        asOfDate = row[j + 1] || asOfDate;
      }
    }

    // Check for "ВСЬОГО ПО ЗАГОНУ НА СКЛАДІ"
    if (row.some(cell => cell.includes('ВСЬОГО ПО ЗАГОНУ НА СКЛАДІ'))) {
      const type = (row[6] || '').toLowerCase();
      const amount = parseNumber(row[8]);
      if (type.includes('дт') || type.includes('дп')) overallStock.dt = amount;
      if (type.includes('бензин')) overallStock.petrol = amount;
      if (type.includes('піноутворювач')) overallStock.foam = amount;
      continue;
    }

    const unitNameRaw = row[1] ? row[1].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const mark = row[3] ? row[3].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const model = row[6] ? row[6].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const plate = row[7] ? row[7].replace(/\n/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const inTank = parseNumber(row[8]);
    const consumption = parseNumber(row[9]);
    const capacity = parseNumber(row[10]);
    const fuelType = (row[11] || '').trim().toLowerCase();

    // If unit name is present in col 1, start a new unit
    if (unitNameRaw && unitNameRaw !== 'Підрозділ') {
      currentUnit = {
        name: unitNameRaw,
        vehicles: [],
        generators: [],
        stock: { dt: 0, petrol: 0, foam: 0 }
      };
      units.push(currentUnit);
    }

    if (!currentUnit || !mark) continue;

    // Check if this row is warehouse stock ("Склад")
    if (mark === 'Склад' || mark.toLowerCase().includes('склад')) {
      const itemType = model.toLowerCase();
      if (itemType.includes('дп') || itemType.includes('дт')) currentUnit.stock.dt = inTank;
      else if (itemType.includes('бензин')) currentUnit.stock.petrol = inTank;
      else if (itemType.includes('піноутворювач')) currentUnit.stock.foam = inTank;

      // Also check next rows if they belong to stock
      let k = i + 1;
      while (k < rows.length && (!rows[k][1] || rows[k][1].trim() === '') && (!rows[k][3] || rows[k][3].trim() === '')) {
        const subType = (rows[k][6] || '').toLowerCase();
        const subVal = parseNumber(rows[k][8]);
        if (subType.includes('дп') || subType.includes('дт')) currentUnit.stock.dt = subVal;
        else if (subType.includes('бензин')) currentUnit.stock.petrol = subVal;
        else if (subType.includes('піноутворювач')) currentUnit.stock.foam = subVal;
        k++;
      }
      i = k - 1;
      continue;
    }

    // Check if this row is generator / equipment
    if (mark.toLowerCase().includes('генератор') || mark.toLowerCase().includes('агрегат') || mark.toLowerCase().includes('мотопомпа')) {
      currentUnit.generators.push({
        name: mark + (model ? ` (${model})` : ''),
        inTank,
        consumption,
        fuelType: fuelType || (mark.toLowerCase().includes('дизель') ? 'дп' : 'бензин')
      });
      continue;
    }

    // Otherwise, it's a vehicle
    currentUnit.vehicles.push({
      mark,
      model,
      plate,
      inTank,
      consumption,
      capacity,
      fuelType: fuelType || 'дп'
    });
  }

  // Fallback for overall stock if summary row wasn't present
  if (!overallStock.dt && !overallStock.petrol && !overallStock.foam) {
    units.forEach(u => {
      overallStock.dt += u.stock.dt;
      overallStock.petrol += u.stock.petrol;
      overallStock.foam += u.stock.foam;
    });
  }

  // Calculate totals
  let totalVehicles = 0;
  let totalTankFuel = 0;
  let lowFuelCount = 0;

  units.forEach(u => {
    u.vehicles.forEach(v => {
      totalVehicles++;
      totalTankFuel += v.inTank;
      if (v.capacity > 0 && (v.inTank / v.capacity) < 0.3) {
        lowFuelCount++;
      }
    });
  });

  return {
    asOfDate,
    units,
    overallStock,
    kpi: {
      totalVehicles,
      totalTankFuel,
      lowFuelCount
    }
  };
}



function loadPmmDataFromCache() {
  try {
    const cached = localStorage.getItem(PMM_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch (e) {
    return null;
  }
}

function showPmmManualCsvInput() {
  const overlay = document.createElement('div');
  overlay.id = 'pmm-csv-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.75);
    display:flex;align-items:center;justify-content:center;padding:16px;
  `;
  overlay.innerHTML = `
    <div style="
      background:#1e2030;border-radius:16px;padding:20px;
      width:100%;max-width:520px;max-height:90vh;overflow-y:auto;
      border:1px solid rgba(255,255,255,.12);
    ">
      <h3 style="margin:0 0 8px;font-size:16px;color:#e2e8f0">📋 Вставити CSV вручну</h3>
      <p style="font-size:12px;color:#94a3b8;margin:0 0 12px">
        Відкрийте Google Таблицю → Файл → Завантажити → CSV (.csv),<br>
        потім вставте вміст файлу нижче:
      </p>
      <textarea id="pmm-csv-textarea" rows="10" style="
        width:100%;box-sizing:border-box;
        background:#0d1117;color:#e2e8f0;
        border:1px solid rgba(255,255,255,.15);border-radius:8px;
        padding:10px;font-size:11px;font-family:monospace;resize:vertical;
      " placeholder="Вставте CSV тут…"></textarea>
      <div style="display:flex;gap:10px;margin-top:12px">
        <button id="pmm-csv-apply" style="
          flex:1;background:linear-gradient(135deg,#4f8ef7,#7c5ce8);
          color:#fff;border:none;border-radius:8px;padding:10px;
          font-size:14px;cursor:pointer;
        ">✅ Завантажити</button>
        <button id="pmm-csv-cancel" style="
          flex:1;background:rgba(255,255,255,.08);
          color:#e2e8f0;border:none;border-radius:8px;padding:10px;
          font-size:14px;cursor:pointer;
        ">Скасувати</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('pmm-csv-cancel')?.addEventListener('click', () => overlay.remove());
  document.getElementById('pmm-csv-apply')?.addEventListener('click', () => {
    const text = document.getElementById('pmm-csv-textarea')?.value?.trim();
    if (!text) return;
    try {
      const data = parsePmmCsv(text);
      data.lastFetchedAt = new Date().toISOString();
      data._manual = true;
      localStorage.setItem(PMM_CACHE_KEY, JSON.stringify(data));
      overlay.remove();
      renderPmmWorkspace();
    } catch (e) {
      alert('Помилка розбору CSV: ' + e.message);
    }
  });
}

async function renderPmmWorkspace() {
  const container = document.getElementById('pmm-workspace');
  if (!container) return;

  let data = loadPmmDataFromCache();

  // Initial loader if no cache
  if (!data) {
    if (getPmmCustomUrl()) {
      container.innerHTML = `
        <div class="pmm-loading-box">
          <div class="pmm-spinner"></div>
          <p>Завантажуємо інформацію з Google Таблиці ПММ…</p>
        </div>
      `;
    }
    data = await fetchPmmData();
  }

  if (!data || !data.units || data.units.length === 0) {
    const configuredUrl = getPmmCustomUrl();
    const hasAppsScript = configuredUrl && configuredUrl.includes('script.google.com/macros');

    // ── State 1: No URL configured at all ──────────────────────────────
    if (!configuredUrl) {
      container.innerHTML = `
        <div class="pmm-empty-box" style="text-align:center;max-width:380px;margin:0 auto">
          <span style="font-size:48px">⛽</span>
          <h2 style="margin:12px 0 8px;font-size:18px">Розділ ПММ</h2>
          <p style="font-size:13px;color:#94a3b8;margin:0 0 20px;line-height:1.6">
            Щоб завантажувати дані пального,<br>вкажіть URL таблиці у налаштуваннях.
          </p>
          <button type="button" class="pmm-btn-primary" id="pmm-open-settings-btn"
            style="width:100%;max-width:260px">
            ⚙️ Відкрити налаштування
          </button>
        </div>
      `;
      document.getElementById('pmm-open-settings-btn')?.addEventListener('click', () => {
        document.getElementById('settings-btn')?.click();
      });
      return;
    }

    // ── State 2: URL configured but fetch failed ────────────────────────
    const debugInfo = data
      ? `CSV завантажено, але розпізнано 0 підрозділів.`
      : hasAppsScript
        ? `Apps Script URL не відповідає або повертає помилку.`
        : `Google Таблиця заблокована для прямого доступу (CORS/авторизація).`;

    container.innerHTML = `
      <div class="pmm-empty-box" style="text-align:left;max-width:480px;margin:0 auto">
        <div style="text-align:center;margin-bottom:16px">
          <span style="font-size:36px">⛽</span>
          <h2 style="margin:8px 0 4px;font-size:17px">Не вдалося завантажити ПММ</h2>
          <p style="font-size:13px;opacity:.7;margin:0">${debugInfo}</p>
        </div>

        <div style="background:rgba(79,142,247,.08);border:1px solid rgba(79,142,247,.25);border-radius:12px;padding:14px;margin-bottom:12px">
          <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#4f8ef7">⚡ Рішення: Google Apps Script (1 хв)</p>
          <ol style="margin:0;padding-left:18px;font-size:12px;line-height:1.8;color:#cbd5e0">
            <li>Відкрий <b>script.google.com</b> → «Новий проєкт»</li>
            <li>Встав код (кнопка нижче → скопіювати)</li>
            <li>«Розгорнути» → «Нове розгортання» → Тип: <b>Вебзасток</b></li>
            <li>Доступ: <b>Усі (анонімні)</b> → Розгорнути</li>
            <li>Скопіюй URL виду <code style="font-size:10px">script.google.com/macros/s/…/exec</code></li>
            <li>Встав його в <b>Налаштування → URL таблиці ПММ</b></li>
          </ol>
          <button id="pmm-copy-script-btn" type="button" style="
            margin-top:12px;width:100%;
            background:rgba(79,142,247,.2);border:1px solid rgba(79,142,247,.4);
            color:#4f8ef7;border-radius:8px;padding:9px;font-size:13px;cursor:pointer;
          ">📋 Скопіювати код скрипту</button>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px">
          <button type="button" class="pmm-btn-primary" id="pmm-retry-btn">🔄 Спробувати знову</button>
          <button type="button" class="pmm-btn-secondary" id="pmm-manual-csv-btn">📄 Вставити CSV вручну</button>
        </div>
      </div>
    `;

    // Build Apps Script code — user must set the sheet URL in settings first;
    // we extract the doc ID from their configured URL for the template
    const scriptDocUrl = getPmmCustomUrl() || '';
    const docIdForScript = (() => {
      const m = scriptDocUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
      return m ? m[1] : 'PASTE_YOUR_SPREADSHEET_ID_HERE';
    })();

    const APPS_SCRIPT_CODE = `function doGet() {
  var ss = SpreadsheetApp.openById('${docIdForScript}');
  var sheet = ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var csv = data.map(function(row) {
    return row.map(function(cell) {
      var s = String(cell == null ? '' : cell);
      if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\\n') >= 0)
        return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }).join(',');
  }).join('\\n');
  return ContentService.createTextOutput(csv)
    .setMimeType(ContentService.MimeType.TEXT);
}`;

    document.getElementById('pmm-copy-script-btn')?.addEventListener('click', () => {
      navigator.clipboard.writeText(APPS_SCRIPT_CODE).then(() => {
        const btn = document.getElementById('pmm-copy-script-btn');
        if (btn) { btn.textContent = '✅ Скопійовано!'; setTimeout(() => { btn.textContent = '📋 Скопіювати код скрипту'; }, 2000); }
      }).catch(() => {
        prompt('Скопіюй код вручну:', APPS_SCRIPT_CODE);
      });
    });
    document.getElementById('pmm-retry-btn')?.addEventListener('click', () => {
      localStorage.removeItem(PMM_CACHE_KEY);
      renderPmmWorkspace();
    });
    document.getElementById('pmm-manual-csv-btn')?.addEventListener('click', () => {
      showPmmManualCsvInput();
    });
    return;
  }

  // Filter units & vehicles
  const query = pmmSearchQuery.toLowerCase().trim();

  const filteredUnits = data.units.map(unit => {
    const matchesUnit = unit.name.toLowerCase().includes(query);
    const matchingVehicles = unit.vehicles.filter(v => {
      if (pmmActiveFilter === 'low') {
        const isLow = v.capacity > 0 && (v.inTank / v.capacity) < 0.3;
        if (!isLow) return false;
      }
      if (!query) return true;
      return matchesUnit || v.mark.toLowerCase().includes(query) || v.model.toLowerCase().includes(query) || v.plate.toLowerCase().includes(query) || (v.fuelType && v.fuelType.toLowerCase().includes(query));
    });

    return {
      ...unit,
      matchingVehicles,
      hasMatch: matchesUnit || matchingVehicles.length > 0 || (query.includes('склад') && (unit.stock.dt || unit.stock.petrol || unit.stock.foam))
    };
  }).filter(u => u.hasMatch);

  const formatLiters = (num) => `${Math.round(num).toLocaleString('uk-UA')} л`;

  container.innerHTML = `
    <div class="pmm-shell">
      <!-- Top Control Bar -->
      <header class="pmm-header">
        <div class="pmm-title-block">
          <span class="pmm-eyebrow">Моніторинг пального та резервів</span>
          <h1 class="pmm-main-title">⛽ Запас та витрата ПММ</h1>
          <p class="pmm-subtitle">
            Дані з Google Таблиці · Станом на <strong>${escapeProjectText(data.asOfDate)}</strong>
            ${data.lastFetchedAt ? `· Оновлено ${new Date(data.lastFetchedAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </p>
        </div>
        <div class="pmm-header-actions">
          <button type="button" class="pmm-btn-refresh" id="pmm-sync-btn" title="Оновити з Google Таблиці">
            <span class="pmm-refresh-icon">🔄</span> Оновити дані
          </button>
        </div>
      </header>

      <!-- KPI Dashboard Grid -->
      <div class="pmm-kpi-grid">
        <div class="pmm-kpi-card blue">
          <div class="pmm-kpi-icon">🛢️</div>
          <div class="pmm-kpi-content">
            <div class="pmm-kpi-label">Склад ДТ</div>
            <div class="pmm-kpi-value">${formatLiters(data.overallStock.dt)}</div>
            <div class="pmm-kpi-sub">Загальний резерв ДП</div>
          </div>
        </div>

        <div class="pmm-kpi-card amber">
          <div class="pmm-kpi-icon">⛽</div>
          <div class="pmm-kpi-content">
            <div class="pmm-kpi-label">Склад Бензин</div>
            <div class="pmm-kpi-value">${formatLiters(data.overallStock.petrol)}</div>
            <div class="pmm-kpi-sub">Загальний резерв А-92/95</div>
          </div>
        </div>

        <div class="pmm-kpi-card green">
          <div class="pmm-kpi-icon">🧯</div>
          <div class="pmm-kpi-content">
            <div class="pmm-kpi-label">Піноутворювач</div>
            <div class="pmm-kpi-value">${formatLiters(data.overallStock.foam)}</div>
            <div class="pmm-kpi-sub">На складах підрозділів</div>
          </div>
        </div>

        <div class="pmm-kpi-card purple">
          <div class="pmm-kpi-icon">🚒</div>
          <div class="pmm-kpi-content">
            <div class="pmm-kpi-label">Спецтехніка</div>
            <div class="pmm-kpi-value">${data.kpi.totalVehicles} <small>од.</small></div>
            <div class="pmm-kpi-sub">Запас в баках: ${formatLiters(data.kpi.totalTankFuel)}</div>
          </div>
        </div>
      </div>

      <!-- Filters and Search Controls -->
      <div class="pmm-toolbar">
        <div class="pmm-search-wrap">
          <span class="pmm-search-icon">🔍</span>
          <input type="text" class="pmm-search-input" id="pmm-search-input" value="${escapeProjectText(pmmSearchQuery)}" placeholder="Пошук підрозділу, авто (марка, держномер)...">
          ${pmmSearchQuery ? `<button type="button" class="pmm-search-clear" id="pmm-search-clear">✕</button>` : ''}
        </div>
        <div class="pmm-filter-group">
          <button type="button" class="pmm-filter-btn ${pmmActiveFilter === 'all' ? 'active' : ''}" data-pmm-filter="all">Всі підрозділи</button>
          <button type="button" class="pmm-filter-btn ${pmmActiveFilter === 'low' ? 'active' : ''}" data-pmm-filter="low">
            ⚠️ Низький запас ${data.kpi.lowFuelCount > 0 ? `<span class="pmm-badge-alert">${data.kpi.lowFuelCount}</span>` : ''}
          </button>
        </div>
      </div>

      <!-- Units Grid -->
      <div class="pmm-units-grid">
        ${filteredUnits.length ? filteredUnits.map(unit => {
          const unitVehicles = pmmActiveFilter === 'low' ? unit.matchingVehicles : unit.vehicles;
          return `
            <div class="pmm-unit-card">
              <div class="pmm-unit-header">
                <div>
                  <span class="pmm-unit-tag">Підрозділ</span>
                  <h3 class="pmm-unit-title">${escapeProjectText(unit.name)}</h3>
                </div>
                <div class="pmm-unit-stock-pills">
                  <span class="pmm-pill dt" title="Запас ДТ на складі">🛢️ ДТ: ${unit.stock.dt} л</span>
                  <span class="pmm-pill petrol" title="Запас Бензину на складі">⛽ Б: ${unit.stock.petrol} л</span>
                  ${unit.stock.foam ? `<span class="pmm-pill foam" title="Запас піноутворювача">🧯 П: ${unit.stock.foam} л</span>` : ''}
                </div>
              </div>

              <!-- Vehicles Table / Cards -->
              <div class="pmm-vehicles-list">
                ${unitVehicles.length ? unitVehicles.map(v => {
                  const fillPct = v.capacity > 0 ? Math.min(100, Math.round((v.inTank / v.capacity) * 100)) : (v.inTank > 0 ? 100 : 0);
                  let fillStatus = 'good';
                  if (fillPct < 30) fillStatus = 'low';
                  else if (fillPct < 60) fillStatus = 'warn';

                  return `
                    <div class="pmm-vehicle-row ${fillStatus === 'low' ? 'is-low' : ''}">
                      <div class="pmm-vehicle-info">
                        <div class="pmm-vehicle-name">${escapeProjectText(v.mark)}</div>
                        <div class="pmm-vehicle-sub">
                          ${v.model ? `<span class="pmm-v-tag">${escapeProjectText(v.model)}</span>` : ''}
                          ${v.plate ? `<span class="pmm-v-plate">${escapeProjectText(v.plate)}</span>` : ''}
                          <span class="pmm-v-fueltype">${v.fuelType ? v.fuelType.toUpperCase() : ''}</span>
                        </div>
                      </div>

                      <div class="pmm-vehicle-tank">
                        <div class="pmm-tank-header">
                          <span class="pmm-tank-text">
                            <strong>${v.inTank} л</strong> ${v.capacity ? `/ ${v.capacity} л` : ''}
                            ${v.consumption ? `<small class="pmm-consumption">(витрата ${v.consumption}л)</small>` : ''}
                          </span>
                          <span class="pmm-tank-pct ${fillStatus}">${v.capacity ? `${fillPct}%` : ''}</span>
                        </div>
                        ${v.capacity ? `
                          <div class="pmm-tank-bar-track">
                            <div class="pmm-tank-bar-fill ${fillStatus}" style="width: ${fillPct}%"></div>
                          </div>
                        ` : ''}
                      </div>
                    </div>
                  `;
                }).join('') : '<div class="pmm-no-vehicles">Немає авто за обраними критеріями.</div>'}
              </div>

              ${unit.generators && unit.generators.length ? `
                <div class="pmm-generators-section">
                  <div class="pmm-gen-title">⚡ Генератори та агрегати:</div>
                  <div class="pmm-gen-tags">
                    ${unit.generators.map(g => `
                      <span class="pmm-gen-tag">
                        ${escapeProjectText(g.name)}: <strong>${g.inTank} л</strong> (${g.fuelType})
                      </span>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          `;
        }).join('') : '<div class="pmm-empty-search">За вашим запитом нічого не знайдено.</div>'}
      </div>
    </div>
  `;

  // Attach event listeners
  const syncBtn = container.querySelector('#pmm-sync-btn');
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      syncBtn.innerHTML = `<span class="pmm-refresh-icon spinning">🔄</span> Оновлюємо…`;
      await fetchPmmData();
      renderPmmWorkspace();
    });
  }

  const searchInput = container.querySelector('#pmm-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      pmmSearchQuery = e.target.value;
      renderPmmWorkspace();
      const updatedInput = container.querySelector('#pmm-search-input');
      if (updatedInput) {
        updatedInput.focus();
        updatedInput.setSelectionRange(pmmSearchQuery.length, pmmSearchQuery.length);
      }
    });
  }

  const searchClear = container.querySelector('#pmm-search-clear');
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      pmmSearchQuery = '';
      renderPmmWorkspace();
    });
  }

  container.querySelectorAll('[data-pmm-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      pmmActiveFilter = btn.dataset.pmmFilter;
      renderPmmWorkspace();
    });
  });

  // Background fetch silently if cache is older than 5 minutes
  if (data && data.lastFetchedAt) {
    const ageMs = Date.now() - new Date(data.lastFetchedAt).getTime();
    if (ageMs > 5 * 60 * 1000) {
      fetchPmmData().then(freshData => {
        if (freshData && activeAppMode === 'pmm') {
          renderPmmWorkspace();
        }
      });
    }
  }
}

// ============================================================
// PROCUREMENT WORKSPACE (План закупівель)
// ============================================================
const PROC_DATA_KEY = 'procurement_plan_data_v1';
const PROC_SHEET_URL_KEY = 'procurement_plan_sheet_url';
const DEFAULT_PROC_SHEET_URL = 'https://docs.google.com/spreadsheets/d/19LXzN-l0uAnJen8-NtcXDdL6iBDfAY3UYKUAV7e1P-I/edit?usp=sharing';

let procState = null; // { items: [{id, kekv, text, amount, procType, done}] }
let procEventsBound = false;

function loadProcState() {
  try {
    const raw = localStorage.getItem(PROC_DATA_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.items)) return d;
    }
  } catch (e) { /* ignore */ }
  return { items: [] };
}

function saveProcState() {
  localStorage.setItem(PROC_DATA_KEY, JSON.stringify(procState));
}

function getProcSheetUrl() {
  const v = (localStorage.getItem(PROC_SHEET_URL_KEY) || '').trim();
  return v || DEFAULT_PROC_SHEET_URL;
}

function procUid() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalizeProcType(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('prozzoo') || s.includes('prozorro') || s.includes('market')) return 'prozorro';
  if (s.includes('прям')) return 'direct';
  if (s.includes('тендер') || s.includes('торг')) return 'tender';
  return '';
}

function parseProcurementCsv(csvText) {
  const rows = parseCsvLines(csvText);
  const items = [];
  let periodLabel = '';
  let headerFound = false;
  const monthRe = /(Січ|Лют|Бер|Кві|Тра|Чер|Лип|Сер|Вер|Жов|Лис|Гру)/i;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;

    const first = String(r[0] || '').trim();

    // Мітка періоду, напр. «Серпень 2026»
    if (!headerFound && r.length <= 3 && monthRe.test(first) && !/предмет/i.test(first)) {
      periodLabel = r.join(' ');
      continue;
    }

    // Рядок заголовків
    if (!headerFound && (/№/.test(first) || /предмет/i.test(String(r[2] || '')) || /КЕКВ/i.test(String(r[1] || '')))) {
      headerFound = true;
      continue;
    }

    if (!headerFound) continue;

    const num = first.replace(/\D/g, '');
    const kekv = String(r[1] || '').trim();
    const text = String(r[2] || '').trim();
    const amount = String(r[3] || '').trim();
    const typeRaw = String(r[4] || '').trim();

    if (!num && !text && !kekv && !amount) continue;
    if (/^всього|^разом|^итого|^итог/i.test(text)) continue;

    items.push({
      id: procUid(),
      kekv: kekv,
      text: text,
      amount: amount,
      procType: normalizeProcType(typeRaw),
      done: false
    });
  }
  return { items, period: periodLabel };
}

async function fetchProcurementCsv() {
  const url = getProcSheetUrl();
  if (!url) return null;

  let candidates;
  if (url.includes('script.google.com/macros')) {
    candidates = [url];
  } else {
    const idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch) {
      candidates = [url];
    } else {
      const docId = idMatch[1];
      const gidMatch = url.match(/[?&]gid=([0-9]+)/) || url.match(/#gid=([0-9]+)/);
      const gid = gidMatch ? gidMatch[1] : '0';
      candidates = [
        `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv&gid=${gid}`,
        `https://docs.google.com/spreadsheets/d/${docId}/gviz/tq?tqx=out:csv&gid=${gid}`,
        `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv`
      ];
    }
  }

  for (const c of candidates) {
    const txt = await tryFetchCsv(c);
    if (txt) return txt;
  }
  return null;
}

function procFmtMoney(n) {
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function procParseAmount(raw) {
  if (raw === null || raw === undefined) return 0;
  const s = String(raw).trim().replace(/[\s ]/g, '');
  if (!s) return 0;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized = s;
  if (lastComma > -1 && lastDot > -1) {
    normalized = lastComma > lastDot ? s.split('.').join('').replace(',', '.') : s.split(',').join('');
  } else if (lastComma > -1) {
    normalized = s.replace(',', '.');
  }
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}

function procEscapeAttr(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function procTypeSelectHtml(item) {
  const sel = item.procType ? ' ' + item.procType : '';
  return '<select class="proc-type' + sel + '" title="Тип угоди">' +
    '<option value="">Тип угоди —</option>' +
    '<option value="prozorro"' + (item.procType === 'prozorro' ? ' selected' : '') + '>Prozorro Market</option>' +
    '<option value="direct"' + (item.procType === 'direct' ? ' selected' : '') + '>Пряма угода</option>' +
    '<option value="tender"' + (item.procType === 'tender' ? ' selected' : '') + '>Відкриті торги (тендер)</option>' +
    '</select>';
}

/* ---- Гейдж виконання плану закупівель (SVG) ---- */
const GAUGE_CX = 105, GAUGE_CY = 118;

function gaugePoint(r, pct) {
  const thetaDeg = 180 * (1 - pct / 100);
  const thetaRad = thetaDeg * Math.PI / 180;
  return {
    x: GAUGE_CX + r * Math.cos(thetaRad),
    y: GAUGE_CY - r * Math.sin(thetaRad)
  };
}

function buildGaugeStatic(prefix) {
  prefix = prefix || '';
  const ticksGroup = document.getElementById(prefix + 'ticksGroup');
  const labelsGroup = document.getElementById(prefix + 'labelsGroup');
  if (!ticksGroup || !labelsGroup || ticksGroup.childNodes.length) return; // build once
  const glowId = 'url(#' + (prefix ? prefix + 'Glow' : 'glow') + ')';

  let ticksHtml = '';
  for (let v = 0; v <= 100; v += 10) {
    const major = (v % 25 === 0);
    const p1 = gaugePoint(major ? 60 : 68, v);
    const p2 = gaugePoint(76, v);
    ticksHtml += '<line class="' + (major ? 'gauge-tick-major' : 'gauge-tick') + '" x1="' + p1.x.toFixed(1) + '" y1="' + p1.y.toFixed(1) + '" x2="' + p2.x.toFixed(1) + '" y2="' + p2.y.toFixed(1) + '"/>';
  }
  ticksGroup.innerHTML = ticksHtml;

  const labelColors = { 0: '#ff1b3d', 25: '#ff7200', 50: '#ffd800', 75: '#82ff00', 100: '#00df63' };
  let labelsHtml = '';
  [0, 25, 50, 75, 100].forEach(v => {
    const p = gaugePoint(100, v);
    p.y += 10;
    labelsHtml += '<text class="gauge-label-glow" x="' + p.x.toFixed(1) + '" y="' + p.y.toFixed(1) + '" fill="' + labelColors[v] + '" filter="' + glowId + '">' + v + '%</text>';
    labelsHtml += '<text class="gauge-label" x="' + p.x.toFixed(1) + '" y="' + p.y.toFixed(1) + '" fill="' + labelColors[v] + '">' + v + '%</text>';
  });
  labelsGroup.innerHTML = labelsHtml;
}

function updateGauge(pct, prefix) {
  prefix = prefix || '';
  const needleGroup = document.getElementById(prefix + 'needleGroup');
  if (needleGroup) needleGroup.style.transform = 'rotate(' + (1.8 * pct).toFixed(1) + 'deg)';

  const complete = pct >= 100;
  const pivot = document.getElementById(prefix + 'gaugePivot');
  if (pivot) pivot.classList.toggle('complete', complete);

  const pctEl = document.getElementById(prefix + 'gaugePct');
  if (pctEl) {
    pctEl.textContent = pct + '%';
    pctEl.classList.toggle('complete', complete);
  }
}

function updateProcGauge() {
  const items = procState ? procState.items : [];
  const done = items.filter(it => it.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  updateGauge(pct, 'proc');
  const label = document.getElementById('procGaugeLabel');
  if (label) {
    const word = items.length === 1 ? 'позицію' : (items.length >= 2 && items.length <= 4 ? 'позиції' : 'позицій');
    label.textContent = 'Виконано ' + done + ' з ' + items.length + ' ' + word;
  }
}

function updateProcTotals() {
  const items = procState ? procState.items : [];
  let total = 0, doneTotal = 0, doneCount = 0;
  const byType = { prozorro: 0, direct: 0, tender: 0 };
  items.forEach(it => {
    const v = procParseAmount(it.amount);
    total += v;
    if (it.done) { doneTotal += v; doneCount++; }
    if (byType[it.procType] !== undefined) byType[it.procType] += v;
  });
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set('procurement-total-sum', procFmtMoney(total) + ' грн');
  set('procurement-total-done', procFmtMoney(doneTotal) + ' грн (' + doneCount + ' поз.)');
  set('procurement-total-prozorro', procFmtMoney(byType.prozorro) + ' грн');
  set('procurement-total-direct', procFmtMoney(byType.direct) + ' грн');
  set('procurement-total-tender', procFmtMoney(byType.tender) + ' грн');
}

function updateProcKekvSummary() {
  const el = document.getElementById('procurement-kekv-summary');
  if (!el) return;
  const items = procState ? procState.items : [];
  const map = {};
  items.forEach(it => {
    if (it.kekv) map[it.kekv] = (map[it.kekv] || 0) + procParseAmount(it.amount);
  });
  const keys = Object.keys(map);
  if (!keys.length) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  el.innerHTML = '<span>Підсумок за КЕКВ:</span> ' + keys.map(k =>
    '<span><b>' + procEscapeAttr(k) + '</b> — ' + procFmtMoney(map[k]) + ' грн</span>'
  ).join('');
}

function renderProcurementTable() {
  const body = document.getElementById('procurement-table-body');
  const empty = document.getElementById('procurement-empty');
  if (!body) return;

  const items = procState ? procState.items : [];
  body.innerHTML = '';
  if (empty) empty.style.display = items.length ? 'none' : 'block';

  items.forEach((item, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="proc-num">' + (idx + 1) + '</td>' +
      '<td><input type="text" class="proc-kekv" value="' + procEscapeAttr(item.kekv || '') + '" placeholder="КЕКВ"></td>' +
      '<td><input type="text" class="proc-text" value="' + procEscapeAttr(item.text) + '" placeholder="Предмет закупівлі…"></td>' +
      '<td><input type="text" inputmode="decimal" class="proc-amount" value="' + procEscapeAttr(item.amount || '') + '" placeholder="0,00"></td>' +
      '<td>' + procTypeSelectHtml(item) + '</td>' +
      '<td><input type="checkbox" class="proc-check" ' + (item.done ? 'checked' : '') + '></td>' +
      '<td><button class="proc-del" title="Видалити">×</button></td>';

    const textInput = tr.querySelector('.proc-text');
    textInput.addEventListener('input', e => { item.text = e.target.value; });
    textInput.addEventListener('blur', saveProcState);
    textInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); textInput.blur(); }
    });

    const kekvInput = tr.querySelector('.proc-kekv');
    kekvInput.addEventListener('input', e => { item.kekv = e.target.value; });
    kekvInput.addEventListener('blur', () => { saveProcState(); updateProcKekvSummary(); });

    const amountInput = tr.querySelector('.proc-amount');
    amountInput.addEventListener('input', e => { item.amount = e.target.value; updateProcTotals(); });
    amountInput.addEventListener('blur', () => { saveProcState(); updateProcTotals(); });

    const typeSel = tr.querySelector('.proc-type');
    typeSel.addEventListener('change', e => {
      item.procType = e.target.value;
      typeSel.className = 'proc-type' + (item.procType ? ' ' + item.procType : '');
      saveProcState();
      updateProcTotals();
    });

    tr.querySelector('.proc-check').addEventListener('change', e => {
      item.done = e.target.checked;
      saveProcState();
      updateProcTotals();
      updateProcGauge();
    });

    tr.querySelector('.proc-del').addEventListener('click', () => {
      if (item.text && !confirm('Видалити позицію "' + item.text + '"?')) return;
      procState.items = procState.items.filter(it => it.id !== item.id);
      saveProcState();
      renderProcurementTable();
      updateProcTotals();
      updateProcKekvSummary();
    });

    body.appendChild(tr);
  });

  updateProcTotals();
  updateProcKekvSummary();
  updateProcGauge();
}

function setProcStatus(msg, color) {
  const el = document.getElementById('procurement-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = color || '';
}

function showProcCsvBox() {
  const box = document.getElementById('procurement-csv-box');
  if (box) box.style.display = 'block';
  setProcStatus('⚠️ Пряме завантаження таблиці заблоковане браузером. Відкрийте таблицю → Файл → Завантажити → CSV і вставте дані нижче.', 'var(--amber)');
}

async function syncProcurementFromSheet() {
  const btn = document.getElementById('procurement-sync-btn');
  if (!procState) procState = loadProcState();
  if (btn) { btn.classList.add('loading'); btn.textContent = '🔄 Завантаження…'; }
  try {
    const csv = await fetchProcurementCsv();
    if (csv) {
      const parsed = parseProcurementCsv(csv);
      if (parsed.items.length) {
        // Зберігаємо статус виконання за текстом позиції
        const doneMap = {};
        (procState.items || []).forEach(it => {
          if (it.text) doneMap[it.text] = doneMap[it.text] || it.done;
        });
        parsed.items.forEach(it => { it.done = !!doneMap[it.text]; });
        procState.items = parsed.items;
        saveProcState();
        renderProcurementTable();
        setProcStatus('✅ Синхронізовано з Google Таблицею: ' + parsed.items.length + ' позицій' + (parsed.period ? ' · ' + parsed.period : ''), 'var(--green)');
      } else {
        setProcStatus('⚠️ У таблиці поки немає заповнених позицій.', 'var(--amber)');
        showProcCsvBox();
      }
    } else {
      showProcCsvBox();
    }
  } catch (err) {
    console.error('Procurement sync error:', err);
    showProcCsvBox();
  } finally {
    if (btn) { btn.classList.remove('loading'); btn.textContent = '🔄 Оновити з Google Таблиці'; }
  }
}

function bindProcurementEvents() {
  if (procEventsBound) return;
  procEventsBound = true;

  document.getElementById('procurement-sync-btn')?.addEventListener('click', syncProcurementFromSheet);

  document.getElementById('procurement-add-btn')?.addEventListener('click', () => {
    if (!procState) procState = loadProcState();
    procState.items.push({ id: procUid(), kekv: '', text: '', amount: '', procType: '', done: false });
    saveProcState();
    renderProcurementTable();
    const inputs = document.querySelectorAll('#procurement-table-body .proc-text');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  document.getElementById('procurement-export-btn')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(procState, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'procurement_plan.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  document.getElementById('procurement-import-btn')?.addEventListener('click', () => {
    document.getElementById('procurement-import-file').click();
  });
  document.getElementById('procurement-import-file')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data.items)) throw new Error('bad format');
        procState = data;
        saveProcState();
        renderProcurementTable();
        setProcStatus('✅ Імпортовано ' + data.items.length + ' позицій', 'var(--green)');
      } catch (err) {
        alert('Не вдалося прочитати файл. Перевірте, що це коректний файл експорту плану закупівель.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('procurement-clear-btn')?.addEventListener('click', () => {
    if (!procState || !procState.items.length) return;
    if (confirm('Видалити всі позиції плану закупівель? Цю дію не можна скасувати.')) {
      procState.items = [];
      saveProcState();
      renderProcurementTable();
    }
  });

  document.getElementById('procurement-url-save-btn')?.addEventListener('click', () => {
    const url = document.getElementById('procurement-sheet-url').value.trim();
    if (url) localStorage.setItem(PROC_SHEET_URL_KEY, url);
    else localStorage.removeItem(PROC_SHEET_URL_KEY);
    alert('URL Google Таблиці плану закупівель збережено.');
  });

  document.getElementById('procurement-csv-import-btn')?.addEventListener('click', () => {
    const csv = document.getElementById('procurement-csv-textarea').value;
    if (!csv.trim()) {
      alert('Спочатку вставте текст CSV у поле вище.');
      return;
    }
    const parsed = parseProcurementCsv(csv);
    if (!parsed.items.length) {
      alert('Не вдалося розпізнати позиції. Перевірте формат: №,КЕКВ,Предмет,Вартість,Тип угоди');
      return;
    }
    if (!procState) procState = loadProcState();
    const doneMap = {};
    (procState.items || []).forEach(it => {
      if (it.text) doneMap[it.text] = doneMap[it.text] || it.done;
    });
    parsed.items.forEach(it => { it.done = !!doneMap[it.text]; });
    procState.items = parsed.items;
    saveProcState();
    document.getElementById('procurement-csv-box').style.display = 'none';
    document.getElementById('procurement-csv-textarea').value = '';
    renderProcurementTable();
    setProcStatus('✅ CSV імпортовано: ' + parsed.items.length + ' позицій' + (parsed.period ? ' · ' + parsed.period : ''), 'var(--green)');
  });

  document.getElementById('procurement-csv-cancel-btn')?.addEventListener('click', () => {
    document.getElementById('procurement-csv-box').style.display = 'none';
    document.getElementById('procurement-csv-textarea').value = '';
    setProcStatus('');
  });
}

function renderProcurementWorkspace() {
  const container = document.getElementById('procurement-workspace');
  if (!container) return;

  if (!procState) procState = loadProcState();
  bindProcurementEvents();
  buildGaugeStatic('proc');

  // URL-поле
  const urlInput = document.getElementById('procurement-sheet-url');
  if (urlInput) urlInput.value = getProcSheetUrl();

  renderProcurementTable();

  // Заголовок з поточним місяцем
  const title = document.getElementById('procurement-title');
  if (title) {
    const now = new Date();
    const months = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
      'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
    title.textContent = 'План закупівель — ' + months[now.getMonth()] + ' ' + now.getFullYear();
  }
}

