import { app, BrowserWindow, ipcMain } from 'ant:desktop';

if (typeof BrowserWindow !== 'function') {
  throw new Error('BrowserWindow export is unavailable');
}

const firstReady = app.ready();
if (firstReady !== app.ready()) {
  throw new Error('app.ready() did not return the shared readiness promise');
}
if ('_readyPromise' in app) {
  throw new Error('native readiness state leaked onto the app object');
}
if (typeof app.resourcesPath !== 'string' || !app.resourcesPath) {
  throw new Error('app.resourcesPath is unavailable');
}
for (const name of [
  '__antDesktopWindowObjects',
  '__antDesktopIpcHandlers',
  '__antDesktopIpcListeners',
  '__antDesktopEncode',
  '__antDesktopDispatch',
  '__antNativeIpcReply'
]) {
  if (name in globalThis) {
    throw new Error(`native desktop bridge leaked as globalThis.${name}`);
  }
}
await firstReady;
ipcMain.handle('smoke:ping', value => value);
ipcMain.on('smoke:event', () => {});
ipcMain.removeHandler('smoke:ping');
console.log('desktop-smoke-ok');
setTimeout(() => app.quit(), 10);
