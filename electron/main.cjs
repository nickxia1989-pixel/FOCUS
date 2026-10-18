const { app, BrowserWindow, ipcMain, nativeTheme, shell, screen, Menu, safeStorage, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { startAgentServer } = require('./agent.cjs');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const isMac = process.platform === 'darwin';

// 界面按哪个系统画（标题栏、窗口边框）。开发时可用 FOCUS_FORCE_PLATFORM=win 在 Mac 上画 Windows 版来截图验证；
// 菜单、退出行为等仍按真实系统
const FORCED = (process.env.FOCUS_FORCE_PLATFORM || '').toLowerCase();
const uiPlatform = FORCED === 'win' || FORCED === 'win32' ? 'win32' : FORCED === 'mac' || FORCED === 'darwin' ? 'darwin' : process.platform;
const macChrome = uiPlatform === 'darwin';

// 开发截图用：FOCUS_FORCE_THEME=dark|light 固定浅色 / 深色，优先于界面里的「外观」设置
const FORCED_THEME = ['dark', 'light'].includes(process.env.FOCUS_FORCE_THEME) ? process.env.FOCUS_FORCE_THEME : null;
if (FORCED_THEME) nativeTheme.themeSource = FORCED_THEME;

const DEFAULT_SIZE = { width: 384, height: 680 };

/** 窗口底色（加载前、拖动时露出来的那一下）：Mac #F6F6F2 / #0B0B0C，Windows 冷一点 #F3F3EF / #121213 */
function windowBackground() {
  const dark = nativeTheme.shouldUseDarkColors;
  if (macChrome) return dark ? '#0B0B0C' : '#F6F6F2';
  return dark ? '#121213' : '#F3F3EF';
}

// 可用环境变量指定数据目录（测试或便携使用）；默认在系统的应用数据目录
if (process.env.FOCUS_USER_DATA) app.setPath('userData', path.resolve(process.env.FOCUS_USER_DATA));

/** @type {BrowserWindow | null} */
let win = null;
/** AI agent 本地接口（electron/agent.cjs） */
let agent = null;

// ---------- 本地文件读写 ----------

const userDir = () => app.getPath('userData');
const windowStateFile = () => path.join(userDir(), 'window-state.json');
const profilesFile = () => path.join(userDir(), 'profiles.json');

// 每个 profile 一个数据文件。升级前就有的数据归 default，文件位置不变，旧版本也还能读
const DEFAULT_PROFILE_ID = 'default';
const PROFILE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function checkProfileId(id) {
  if (typeof id !== 'string' || !PROFILE_ID_RE.test(id)) throw new Error(`invalid profile id: ${id}`);
  return id;
}

function dataFile(profileId) {
  checkProfileId(profileId);
  return profileId === DEFAULT_PROFILE_ID
    ? path.join(userDir(), 'focus-data.json')
    : path.join(userDir(), 'profiles', `${profileId}.json`);
}

const backupFile = (file) => file.replace(/\.json$/, '.bak.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 先写临时文件再改名，避免写到一半崩溃把数据文件写坏 */
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(obj, null, 2);
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, file);
  } catch {
    // 改名失败（例如被杀毒软件占用）时退回直接写
    fs.writeFileSync(file, text, 'utf8');
  }
}

/** 读 JSON；能正常读取就顺手备份一份，主文件损坏时用备份恢复 */
function loadJsonWithBackup(file) {
  if (fs.existsSync(file)) {
    const data = readJson(file);
    if (data) {
      // 每次读入时把上一次能正常读取的数据留一份备份
      try {
        fs.copyFileSync(file, backupFile(file));
      } catch {}
      return data;
    }
    // 主文件损坏：保留现场，尝试用备份恢复
    try {
      fs.copyFileSync(file, `${file}.broken-${Date.now()}`);
    } catch {}
    return readJson(backupFile(file));
  }
  return null;
}

const loadData = (profileId) => loadJsonWithBackup(dataFile(profileId));

// v2：所有 profile 的可同步数据在 focus-doc.json，只属于本机的状态在 focus-local.json。
// v1 的 profiles.json / focus-data.json / profiles/*.json 只在第一次迁移时读取，原样留作备份。
const STORE_FILES = { doc: 'focus-doc.json', local: 'focus-local.json' };

function storeFile(name) {
  const f = STORE_FILES[name];
  if (!f) throw new Error(`unknown store: ${name}`);
  return path.join(userDir(), f);
}

// ---------- 同步：配置、凭证、WebDAV 请求 ----------

const syncConfigFile = () => path.join(userDir(), 'sync-config.json');
const identityFile = () => path.join(userDir(), 'device-id.bin');

/**
 * 设备身份（设备 id + 本份安装的随机数）用系统钥匙串加密存放。
 * 数据目录被整个拷到另一台电脑时，那边解不开这个文件，就会生成新的身份，两台电脑不会共用一个设备 id。
 */
function deviceIdentity() {
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    if (fs.existsSync(identityFile())) {
      const v = JSON.parse(safeStorage.decryptString(fs.readFileSync(identityFile())));
      if (typeof v.deviceId === 'string' && typeof v.nonce === 'string') return v;
    }
  } catch {}
  const rand = (n) => require('node:crypto').randomBytes(n).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, n);
  const v = { deviceId: rand(10).toLowerCase(), nonce: rand(16) };
  try {
    fs.writeFileSync(identityFile(), safeStorage.encryptString(JSON.stringify(v)));
  } catch {}
  return v;
}
const syncSecretFile = () => path.join(userDir(), 'sync-secret.bin');
let simOffline = false;

function defaultDeviceName() {
  return (os.hostname() || (isMac ? 'Mac' : 'PC')).replace(/\.local$/i, '');
}

function readSyncConfig() {
  const c = readJson(syncConfigFile()) || {};
  return {
    baseUrl: typeof c.baseUrl === 'string' ? c.baseUrl : 'https://dav.jianguoyun.com/dav/',
    user: typeof c.user === 'string' ? c.user : '',
    folder: typeof c.folder === 'string' ? c.folder : 'FOCUS',
    deviceName: typeof c.deviceName === 'string' && c.deviceName ? c.deviceName : defaultDeviceName(),
  };
}

/** 应用密码只用系统钥匙串加密后存盘，渲染进程永远拿不到明文 */
function readPassword() {
  try {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(syncSecretFile())) return '';
    return safeStorage.decryptString(fs.readFileSync(syncSecretFile()));
  } catch {
    return '';
  }
}

/** 只允许 https；明文 http 只给本机测试服务器用 */
function checkBaseUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u;
}

/** 相对路径逐段编码；空路径就是 WebDAV 根目录本身（不能变成 "/"，否则会跑到主机根目录） */
function encodePath(p) {
  const segs = String(p)
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .map((seg) => encodeURIComponent(seg));
  if (!segs.length) return '';
  return segs.join('/') + (String(p).endsWith('/') ? '/' : '');
}

async function syncRequest(req) {
  if (simOffline) return { ok: false, error: 'network', message: '模拟离线' };
  const cfg = readSyncConfig();
  const base = checkBaseUrl(cfg.baseUrl);
  const password = readPassword();
  if (!base || !cfg.user || !password) return { ok: false, error: 'config', message: '同步设置不完整' };
  const url = new URL(encodePath(req.path), base);
  const headers = {
    Authorization: `Basic ${Buffer.from(`${cfg.user}:${password}`).toString('base64')}`,
    ...(req.headers || {}),
  };
  if (req.deviceId) headers['X-Focus-Device'] = String(req.deviceId);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, { method: req.method, headers, body: req.body ?? undefined, signal: ctrl.signal });
    const body = await res.text();
    return {
      ok: true,
      status: res.status,
      body,
      headers: { 'last-modified': res.headers.get('last-modified') || '', etag: res.headers.get('etag') || '' },
    };
  } catch (e) {
    return { ok: false, error: ctrl.signal.aborted ? 'timeout' : 'network', message: String(e && e.message ? e.message : e) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 窗口状态 ----------

function loadWindowState() {
  const st = readJson(windowStateFile()) || {};
  const bounds = st.bounds;
  if (bounds) {
    // 显示器配置变了以后，确保窗口仍落在某块屏幕的可见区域内
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      bounds.x < a.x + a.width - 40 &&
      bounds.x + bounds.width > a.x + 40 &&
      bounds.y >= a.y - 10 &&
      bounds.y < a.y + a.height - 40,
    );
    if (!visible) delete st.bounds;
  }
  return st;
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  writeJsonAtomic(windowStateFile(), {
    bounds: win.getNormalBounds(),
    alwaysOnTop: win.isAlwaysOnTop(),
  });
}

let saveStateTimer = null;
function scheduleSaveWindowState() {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(saveWindowState, 400);
}

// ---------- 窗口 ----------

/** 窄窗口不允许被放大到整屏 */
function preventMacMaximize(w) {
  // 构造参数里的 maximizable: false 在 macOS 上不生效（isMaximizable() 仍为 true），
  // 绿灯和双击标题栏照样会放大，要在创建后再设一次
  w.setMaximizable(false);

  // 系统「窗口 › 填充」等平铺操作不受 maximizable 控制，铺满后退回原来的位置和大小
  let normalBounds = w.getBounds();
  const remember = () => {
    if (!w.isMaximized() && !w.isFullScreen()) normalBounds = w.getBounds();
  };
  w.on('moved', remember);
  w.on('resized', () => {
    if (w.isMaximized()) w.setBounds(normalBounds, true);
    else remember();
  });
}

function createWindow() {
  const st = loadWindowState();
  const b = st.bounds || {};

  // macOS：hiddenInset 红绿灯在 (12, 14)，标题栏 40 高，窗口圆角由系统画
  // Windows：无边框，自绘 36 高标题栏（最小化 / 关闭走 IPC），Win11 由系统画 8px 圆角和阴影
  const chrome = macChrome
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 14 } }
    : { frame: false, thickFrame: true, roundedCorners: true };

  win = new BrowserWindow({
    width: b.width || DEFAULT_SIZE.width,
    height: b.height || DEFAULT_SIZE.height,
    x: b.x,
    y: b.y,
    minWidth: 320,
    minHeight: 420,
    title: 'FOCUS',
    show: false,
    backgroundColor: windowBackground(),
    ...chrome,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: !!st.alwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (isMac) preventMacMaximize(win);
  nativeTheme.on('updated', () => win && !win.isDestroyed() && win.setBackgroundColor(windowBackground()));

  win.once('ready-to-show', () => win && win.show());
  win.on('move', scheduleSaveWindowState);
  win.on('resize', scheduleSaveWindowState);
  win.on('close', saveWindowState);
  win.on('closed', () => {
    win = null;
  });
  win.on('always-on-top-changed', (_e, flag) => {
    win && win.webContents.send('win:alwaysOnTop', flag);
  });

  // 应用内不跳转、不开新窗口；外链交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // 只放行刷新当前页（出错页上的「重新加载」）
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });

  // 菜单被移除后，开发时仍保留 F12 / 刷新
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') win.webContents.toggleDevTools();
    if (DEV_URL && (input.control || input.meta) && input.key.toLowerCase() === 'r') {
      win.webContents.reload();
    }
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function buildMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  // macOS 必须有编辑菜单，输入框里的 ⌘C / ⌘V 才能用。
  // 内置 role 菜单的文字固定是英文，这里逐项写上 macOS 中文版的叫法
  const name = app.name;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: name,
        submenu: [
          { role: 'about', label: `关于 ${name}` },
          { type: 'separator' },
          { role: 'services', label: '服务' },
          { type: 'separator' },
          { role: 'hide', label: `隐藏 ${name}` },
          { role: 'hideOthers', label: '隐藏其他' },
          { role: 'unhide', label: '全部显示' },
          { type: 'separator' },
          { role: 'quit', label: `退出 ${name}` },
        ],
      },
      {
        label: '文件',
        submenu: [{ role: 'close', label: '关闭窗口' }],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '拷贝' },
          { role: 'paste', label: '粘贴' },
          { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
          { role: 'delete', label: '删除' },
          { role: 'selectAll', label: '全选' },
          { type: 'separator' },
          {
            label: '替换',
            submenu: [
              { role: 'showSubstitutions', label: '显示替换' },
              { type: 'separator' },
              { role: 'toggleSmartQuotes', label: '智能引号' },
              { role: 'toggleSmartDashes', label: '智能破折号' },
              { role: 'toggleTextReplacement', label: '文本替换' },
            ],
          },
          {
            label: '语音',
            submenu: [
              { role: 'startSpeaking', label: '开始朗读' },
              { role: 'stopSpeaking', label: '停止朗读' },
            ],
          },
        ],
      },
      {
        label: '窗口',
        role: 'window',
        submenu: [
          { role: 'minimize', label: '最小化' },
          { type: 'separator' },
          { role: 'front', label: '前置全部窗口' },
        ],
      },
    ]),
  );
}

// ---------- IPC ----------

// v1 数据：只读，供第一次迁移
ipcMain.handle('legacy:profiles', () => loadJsonWithBackup(profilesFile()));
ipcMain.handle('legacy:data', (_e, profileId) => loadData(profileId));

ipcMain.handle('store:load', (_e, name) => loadJsonWithBackup(storeFile(name)));
ipcMain.handle('store:save', (_e, name, data) => {
  writeJsonAtomic(storeFile(name), data);
  return true;
});
// 关闭窗口前同步落盘，保证最后一次修改不丢
ipcMain.on('store:saveSync', (e, name, data) => {
  try {
    writeJsonAtomic(storeFile(name), data);
    e.returnValue = true;
  } catch {
    e.returnValue = false;
  }
});

ipcMain.handle('sync:getConfig', () => ({
  ...readSyncConfig(),
  hasPassword: !!readPassword(),
  encryptionAvailable: safeStorage.isEncryptionAvailable(),
}));
ipcMain.handle('sync:setConfig', (_e, input) => {
  const cur = readSyncConfig();
  const next = {
    baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl.trim() : cur.baseUrl,
    user: typeof input.user === 'string' ? input.user.trim() : cur.user,
    folder: typeof input.folder === 'string' ? input.folder.trim().replace(/^\/+|\/+$/g, '') || 'FOCUS' : cur.folder,
    deviceName: typeof input.deviceName === 'string' ? input.deviceName.trim().slice(0, 40) || defaultDeviceName() : cur.deviceName,
  };
  if (!checkBaseUrl(next.baseUrl)) return { ok: false, message: '服务器地址必须是 https://（本机测试服务器可用 http://127.0.0.1）' };
  if (typeof input.password === 'string') {
    if (input.password === '') {
      fs.rmSync(syncSecretFile(), { force: true });
    } else {
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, message: '系统钥匙串不可用，无法安全保存密码' };
      fs.writeFileSync(syncSecretFile(), safeStorage.encryptString(input.password));
    }
  }
  writeJsonAtomic(syncConfigFile(), next);
  return { ok: true };
});
ipcMain.handle('sync:request', (_e, req) => syncRequest(req));
ipcMain.handle('sync:setSimOffline', (_e, flag) => {
  simOffline = !!flag;
  return simOffline;
});
ipcMain.handle('app:platform', () => ({ platform: process.platform, deviceName: defaultDeviceName() }));
// 预加载脚本同步取界面平台（FOCUS_FORCE_PLATFORM 生效后的值）
ipcMain.on('app:uiPlatform', (e) => {
  e.returnValue = uiPlatform;
});
ipcMain.handle('sync:identity', () => deviceIdentity());
ipcMain.handle('sync:resetIdentity', () => {
  fs.rmSync(identityFile(), { force: true });
  return deviceIdentity();
});
ipcMain.handle('store:backup', (_e, data) => {
  const file = path.join(userDir(), `focus-doc.backup-${Date.now()}.json`);
  writeJsonAtomic(file, data);
  return file;
});

ipcMain.handle('win:minimize', () => win && win.minimize());
ipcMain.handle('win:close', () => win && win.close());
ipcMain.handle('win:getAlwaysOnTop', () => !!(win && win.isAlwaysOnTop()));
ipcMain.handle('win:setAlwaysOnTop', (_e, flag) => {
  if (!win) return false;
  win.setAlwaysOnTop(!!flag);
  saveWindowState();
  return win.isAlwaysOnTop();
});
ipcMain.handle('app:openDataDir', () => shell.openPath(userDir()));
// ⋯ 菜单「外观」：跟随系统 / 浅色 / 深色。设 nativeTheme.themeSource，窗口外框、系统控件和页面的
// prefers-color-scheme 都跟着变；返回实际生效的（开发开关优先）
ipcMain.handle('app:setTheme', (_e, source) => {
  if (FORCED_THEME) return FORCED_THEME;
  nativeTheme.themeSource = ['system', 'light', 'dark'].includes(source) ? source : 'system';
  return nativeTheme.themeSource;
});
ipcMain.handle('app:version', () => app.getVersion());

// ---------- 生命周期 ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    buildMenu();
    // 先于窗口启动：要在窗口创建前挂上"页面重载时清掉就绪标记"的监听
    agent = startAgentServer({ app, ipcMain, userDir: userDir(), getWin: () => win });
    createWindow();
    // 睡眠、锁屏前让渲染进程立即上传；唤醒、解锁后立即检查远端
    for (const ev of ['suspend', 'lock-screen']) powerMonitor.on(ev, () => win && win.webContents.send('sync:flush'));
    for (const ev of ['resume', 'unlock-screen']) powerMonitor.on(ev, () => win && win.webContents.send('sync:wake'));
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });

  app.on('will-quit', () => agent && agent.stop());

  // 退出前给渲染进程最多 3 秒把还没上传的改动传完
  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting || !win || win.isDestroyed()) return;
    e.preventDefault();
    quitting = true;
    const done = () => app.quit();
    const timer = setTimeout(done, 3000);
    ipcMain.once('sync:flushed', () => {
      clearTimeout(timer);
      done();
    });
    win.webContents.send('sync:flush', { quitting: true });
  });
}
