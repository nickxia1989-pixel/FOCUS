const { app, BrowserWindow, ipcMain, nativeTheme, shell, screen, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const isMac = process.platform === 'darwin';

const DEFAULT_SIZE = { width: 360, height: 660 };

// 可用环境变量指定数据目录（测试或便携使用）；默认在系统的应用数据目录
if (process.env.FOCUS_USER_DATA) app.setPath('userData', path.resolve(process.env.FOCUS_USER_DATA));

/** @type {BrowserWindow | null} */
let win = null;

// ---------- 本地文件读写 ----------

const userDir = () => app.getPath('userData');
const dataFile = () => path.join(userDir(), 'focus-data.json');
const backupFile = () => path.join(userDir(), 'focus-data.bak.json');
const windowStateFile = () => path.join(userDir(), 'window-state.json');

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

function loadData() {
  const file = dataFile();
  if (fs.existsSync(file)) {
    const data = readJson(file);
    if (data) {
      // 每次启动时把上一次能正常读取的数据留一份备份
      try {
        fs.copyFileSync(file, backupFile());
      } catch {}
      return data;
    }
    // 主文件损坏：保留现场，尝试用备份恢复
    try {
      fs.copyFileSync(file, `${file}.broken-${Date.now()}`);
    } catch {}
    return readJson(backupFile());
  }
  return null;
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

  win = new BrowserWindow({
    width: b.width || DEFAULT_SIZE.width,
    height: b.height || DEFAULT_SIZE.height,
    x: b.x,
    y: b.y,
    minWidth: 300,
    minHeight: 420,
    title: 'FOCUS',
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#17181b' : '#f6f5f2',
    // macOS 保留红绿灯，Windows / Linux 用自绘标题栏
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 12, y: 14 } : undefined,
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
  win.webContents.on('will-navigate', (e) => e.preventDefault());

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

ipcMain.handle('data:load', () => ({ data: loadData(), path: dataFile() }));
ipcMain.handle('data:save', (_e, data) => {
  writeJsonAtomic(dataFile(), data);
  return true;
});
// 关闭窗口前同步落盘，保证最后一次修改不丢
ipcMain.on('data:saveSync', (e, data) => {
  try {
    writeJsonAtomic(dataFile(), data);
    e.returnValue = true;
  } catch {
    e.returnValue = false;
  }
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
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
