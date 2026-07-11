import { app, BrowserWindow } from 'ant:desktop';

await app.ready();
const window = new BrowserWindow({ width: 640, height: 400, show: false });
await window.loadFile(new URL('fixtures/ipc-page.html', import.meta.url).pathname);

const opened = new Promise(resolve => window.on('devtools-opened', resolve));
window.webContents.openDevTools();
await Promise.race([opened, new Promise((_, reject) => setTimeout(() => reject(new Error('Web Inspector did not open')), 3000))]);
if (!window.webContents.isDevToolsOpened()) {
  throw new Error('Web Inspector state was not updated');
}
console.log('desktop-devtools-open');
await new Promise(resolve => setTimeout(resolve, 3000));
const closed = new Promise(resolve => window.on('devtools-closed', resolve));
window.webContents.closeDevTools();
await closed;
await new Promise(resolve => setTimeout(resolve, 250));
window.close();
