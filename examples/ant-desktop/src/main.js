import { app } from 'ant:desktop';

import { registerIpc } from './ipc.js';
import { createApplicationMenu } from './menu/index.js';
import { createMainWindow, rendererEntry } from './window.js';

await app.ready();
const mainWindow = createMainWindow();

registerIpc(mainWindow);
app.setApplicationMenu(createApplicationMenu(mainWindow));

if (process.env.ANT_DESKTOP_RENDERER_URL) {
  await mainWindow.loadURL(process.env.ANT_DESKTOP_RENDERER_URL);
} else {
  await mainWindow.loadFile(rendererEntry);
}

console.log('ant desktop started');
