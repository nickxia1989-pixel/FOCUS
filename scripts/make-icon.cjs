// 用 Electron 离屏渲染把 SVG 图标导出为 build/icon.png（1024×1024，打包时自动转 ico / icns）
// 用法：npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 1024;

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff9a5a"/>
      <stop offset="1" stop-color="#ee4f24"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#7a2408" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="190" fill="url(#bg)" filter="url(#shadow)"/>
  <circle cx="512" cy="512" r="250" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="44"/>
  <path d="M392 518 L478 604 L642 430" fill="none" stroke="#fff" stroke-width="72"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    enableLargerThanScreen: true,
    webPreferences: { offscreen: true, zoomFactor: 1 },
  });
  win.setContentSize(SIZE, SIZE);
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  const { width, height } = img.getSize();
  if (width !== height) throw new Error(`capture is not square: ${width}x${height}`);
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.resize({ width: SIZE, height: SIZE }).toPNG());
  console.log(`icon written: ${out}`);
  app.quit();
});
