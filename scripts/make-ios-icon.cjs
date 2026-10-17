// 生成 iOS 版应用图标：近黑底上一张荧光绿 NOW 卡、黑色星芒、下面压着两张灰卡（设计交接包 design_handoff_focus/icons）。
// 浅色 / 深色 / 着色三种外观各一张 1024 方图，铺满画布（圆角由系统裁切）、不透明，
// 输出到 ios/App/App/Assets.xcassets/AppIcon.appiconset/，Contents.json 里按外观登记。
// 用法：npm run icon:ios（需要在 macOS 上，用 sips 去掉 alpha 通道）
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SIZE = 1024;
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'design_handoff_focus', 'icons');
const OUT = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');

/** 外观 → 源 SVG、输出文件名 */
const VARIANTS = [
  { appearance: null, svg: 'app-icon-ios-default.svg', file: 'AppIcon-512@2x.png' },
  { appearance: 'dark', svg: 'app-icon-ios-dark.svg', file: 'AppIcon-dark.png' },
  { appearance: 'tinted', svg: 'app-icon-ios-tinted-mono.svg', file: 'AppIcon-tinted.png' },
];

app.disableHardwareAcceleration();

/** 三张图共用一个离屏窗口依次渲染 */
function makeWindow() {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    useContentSize: true,
    enableLargerThanScreen: true,
    backgroundColor: '#000000',
    webPreferences: { offscreen: true, zoomFactor: 1 },
  });
  win.setContentSize(SIZE, SIZE);
  return win;
}

async function render(win, svg) {
  // 源 SVG 自带 width/height=1024，外面再包一层确保按整张画布渲染
  const html = `<html><body style="margin:0;overflow:hidden"><div style="width:${SIZE}px;height:${SIZE}px">${svg}</div></body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  const { width, height } = img.getSize();
  if (width !== height) throw new Error(`capture is not square: ${width}x${height}`);
  return width === SIZE ? img.toPNG() : img.resize({ width: SIZE, height: SIZE, quality: 'best' }).toPNG();
}

app.whenReady().then(async () => {
  const win = makeWindow();
  const images = [];
  for (const v of VARIANTS) {
    const png = await render(win, fs.readFileSync(path.join(SRC, v.svg), 'utf8'));
    // App Store 要求图标不含 alpha 通道：经 JPEG 转一道再存回 PNG
    const tmp = path.join(os.tmpdir(), `focus-ios-icon-${process.pid}`);
    fs.writeFileSync(`${tmp}.png`, png);
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '100', `${tmp}.png`, '--out', `${tmp}.jpg`]);
    execFileSync('sips', ['-s', 'format', 'png', `${tmp}.jpg`, '--out', path.join(OUT, v.file)]);
    fs.rmSync(`${tmp}.png`, { force: true });
    fs.rmSync(`${tmp}.jpg`, { force: true });
    images.push({
      ...(v.appearance ? { appearances: [{ appearance: 'luminosity', value: v.appearance }] } : {}),
      filename: v.file,
      idiom: 'universal',
      platform: 'ios',
      size: '1024x1024',
    });
    console.log(`iOS icon (${v.appearance ?? 'default'}) written to ${path.join(OUT, v.file)}`);
  }
  const contents = { images, info: { author: 'xcode', version: 1 } };
  fs.writeFileSync(path.join(OUT, 'Contents.json'), JSON.stringify(contents, null, 2) + '\n');
  app.quit();
});
