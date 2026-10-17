// 生成 iOS 版应用图标：与桌面图标同一套图形，但铺满方形画布（圆角由系统裁切）、不透明
// 输出到 ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
// 用法：npm run icon:ios（需要在 macOS 上，用 sips 去掉 alpha 通道）
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SIZE = 1024;

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff9a5a"/>
      <stop offset="1" stop-color="#ee4f24"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <circle cx="512" cy="512" r="300" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="54"/>
  <path d="M367 519 L471 623 L670 412" fill="none" stroke="#fff" stroke-width="88"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    useContentSize: true,
    enableLargerThanScreen: true,
    backgroundColor: '#ee4f24',
    webPreferences: { offscreen: true, zoomFactor: 1 },
  });
  win.setContentSize(SIZE, SIZE);
  const html = `<html><body style="margin:0;overflow:hidden">${svg}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  const { width, height } = img.getSize();
  if (width !== height) throw new Error(`capture is not square: ${width}x${height}`);

  const out = path.join(__dirname, '..', 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png');
  const png = width === SIZE ? img.toPNG() : img.resize({ width: SIZE, height: SIZE, quality: 'best' }).toPNG();
  // App Store 要求大图标不含 alpha 通道：经 JPEG 转一道再存回 PNG
  const tmp = path.join(os.tmpdir(), `focus-ios-icon-${process.pid}`);
  fs.writeFileSync(`${tmp}.png`, png);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '100', `${tmp}.png`, '--out', `${tmp}.jpg`]);
  execFileSync('sips', ['-s', 'format', 'png', `${tmp}.jpg`, '--out', out]);
  fs.rmSync(`${tmp}.png`, { force: true });
  fs.rmSync(`${tmp}.jpg`, { force: true });
  console.log(`iOS icon written to ${out}`);
  app.quit();
});
