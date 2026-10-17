// 用 Electron 离屏渲染把 SVG 图标导出为 build/icon.png / icon.ico / icon.icns
// 直接生成 ico / icns（内嵌 PNG），打包时就不用再转换
// 图形取自设计交接包 design_handoff_focus/icons：近黑底上一张荧光绿 NOW 卡，中间黑色星芒，下面压着两张灰卡
// - macOS（icns）：app-icon-macos.svg，带 macOS 圆角方形、留边和描边
// - Windows（ico）/ Linux（png）：app-icon-windows.svg，满版圆角 16/132
// 用法：npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 1024;

const SPARK = 'M12 2.8c.8 5 3.4 7.6 8.4 8.4-5 .8-7.6 3.4-8.4 8.4-.8-5-3.4-7.6-8.4-8.4 5-.8 7.6-3.4 8.4-8.4z';

/** 卡片组：两张灰卡 + 荧光绿 NOW 卡 + 星芒（132 网格） */
const CARDS = `
  <rect x="34" y="94" width="64" height="16" rx="7" fill="#2A2A2D"/>
  <rect x="27" y="84" width="78" height="17" rx="8" fill="#45454A"/>
  <rect x="20" y="20" width="92" height="70" rx="17" fill="#D6FF3D"/>
  <path transform="translate(66 55) scale(1.95) translate(-12 -11.2)" d="${SPARK}" fill="#0B0B0C"/>`;

const SVG_MAC = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 132" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A2A2D"/><stop offset="1" stop-color="#0B0B0C"/></linearGradient>
    <clipPath id="c"><rect x="12" y="12" width="108" height="108" rx="25"/></clipPath>
  </defs>
  <g clip-path="url(#c)">
    <rect x="12" y="12" width="108" height="108" fill="url(#g)"/>
    <g transform="translate(14.5 16) scale(.78)">${CARDS}</g>
  </g>
  <rect x="12.5" y="12.5" width="107" height="107" rx="24.5" fill="none" stroke="#fff" stroke-opacity=".14"/>
</svg>`;

const SVG_WIN = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 132" width="${SIZE}" height="${SIZE}">
  <rect width="132" height="132" rx="16" fill="#0B0B0C"/>${CARDS}
</svg>`;

/** ICO：Vista 起支持直接内嵌 PNG */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

/** ICNS：各尺寸以 PNG 块存放 */
function buildIcns(pngBySize) {
  const types = [
    ['icp4', 16],
    ['icp5', 32],
    ['ic11', 32],
    ['icp6', 64],
    ['ic12', 64],
    ['ic07', 128],
    ['ic08', 256],
    ['ic13', 256],
    ['ic09', 512],
    ['ic14', 512],
    ['ic10', 1024],
  ];
  const chunks = types.map(([type, size]) => {
    const data = pngBySize[size];
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

app.disableHardwareAcceleration();

/** 离屏渲染 SVG（同一个窗口依次渲染），返回各尺寸的 PNG */
let renderer = null;
async function render(svg) {
  renderer ??= new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    enableLargerThanScreen: true,
    webPreferences: { offscreen: true, zoomFactor: 1 },
  });
  renderer.setContentSize(SIZE, SIZE);
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`;
  await renderer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 400));
  const img = await renderer.webContents.capturePage();
  const { width, height } = img.getSize();
  if (width !== height) throw new Error(`capture is not square: ${width}x${height}`);
  const png = {};
  for (const s of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    png[s] = s === width ? img.toPNG() : img.resize({ width: s, height: s, quality: 'best' }).toPNG();
  }
  return png;
}

app.whenReady().then(async () => {
  const dir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(dir, { recursive: true });
  const mac = await render(SVG_MAC);
  const win = await render(SVG_WIN);
  fs.writeFileSync(path.join(dir, 'icon.png'), win[1024]);
  fs.writeFileSync(
    path.join(dir, 'icon.ico'),
    buildIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: win[size] }))),
  );
  fs.writeFileSync(path.join(dir, 'icon.icns'), buildIcns(mac));
  console.log(`icons written to ${dir}`);
  app.quit();
}).catch((e) => {
  console.error(e);
  app.exit(1);
});
