// 用 Electron 离屏渲染把 SVG 图标导出为 build/icon.png / icon.ico / icon.icns
// 直接生成 ico / icns（内嵌 PNG），打包时就不用再转换
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
  const dir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(dir, { recursive: true });

  const png = {};
  for (const s of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    png[s] = s === SIZE ? img.toPNG() : img.resize({ width: s, height: s, quality: 'best' }).toPNG();
  }
  fs.writeFileSync(path.join(dir, 'icon.png'), png[1024]);
  fs.writeFileSync(
    path.join(dir, 'icon.ico'),
    buildIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: png[size] }))),
  );
  fs.writeFileSync(path.join(dir, 'icon.icns'), buildIcns(png));
  console.log(`icons written to ${dir}`);
  app.quit();
});
