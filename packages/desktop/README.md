# Ant Desktop

Build desktop applications with Ant and a web renderer. Write the application
process in JavaScript, build the interface with HTML, and package
the result as a standalone native application.

> [!IMPORTANT]
> Ant Desktop currently supports Apple-silicon Macs only (`darwin-arm64`) and
> requires macOS 15 or newer. Windows, Linux, and Intel Mac packages are not
> available yet. Packaged applications currently include English UI resources
> only.

## Install

Add Ant Desktop to the application as a development dependency:

```sh
ant add -D ant-desktop
```

It can also be installed from npm:

```sh
npm install --save-dev ant-desktop
```

## Create an application

Add an `ant-desktop.json` file at the project root:

```json
{
  "main": "main.js",
  "renderer": "renderer",
  "name": "My App",
  "identifier": "com.example.my-app",
  "version": "1.0.0",
  "icon": "assets/app.icns",
  "output": "dist/My App.app"
}
```

Create the application process in `main.js`:

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'ant:desktop';

await app.ready();

ipcMain.handle('app:version', () => Ant.version);

const window = new BrowserWindow({
  width: 900,
  height: 600,
  title: 'My App',
  webPreferences: {
    capabilities: [{ channel: 'app:version', access: ['invoke'] }]
  }
});

const renderer = path.join(path.dirname(fileURLToPath(import.meta.url)), 'renderer', 'index.html');

await window.loadFile(renderer);
```

The renderer uses normal browser JavaScript. Granted IPC channels are available
through `Ant.ipc`, and runtime component versions are exposed as `Ant.versions`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>My App</title>
    <script type="module">
      const version = await Ant.ipc.invoke('app:version');
      document.querySelector('main').textContent = `Ant ${version} · Desktop ${Ant.versions.desktop}`;
    </script>
  </head>
  <body>
    <main></main>
  </body>
</html>
```

## Development

Start the application from the directory containing `ant-desktop.json`:

```sh
antx ant-desktop dev
```

Renderer changes reload the open page. Changes to the application process
restart the development app.

If the package was installed with npm, the equivalent command is:

```sh
npx ant-desktop dev
```

## Package for macOS

Create the configured `.app` bundle:

```sh
antx ant-desktop package
```

Use `--overwrite` to replace an existing output:

```sh
antx ant-desktop package --overwrite
```

The output path comes from `output` in `ant-desktop.json` and can be overridden
with `--out`. Run `antx ant-desktop package --help` for all packaging options.

## Configuration

All paths in `ant-desktop.json` are relative to the manifest.

| Field            | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `main`           | Application-process entry file. Defaults to `index.js`.      |
| `renderer`       | Renderer directory watched during development.               |
| `name`           | Application and `.app` display name.                         |
| `identifier`     | macOS bundle identifier, such as `com.example.my-app`.       |
| `version`        | Application version written to the bundle metadata.          |
| `icon`           | macOS `.icns` icon file.                                     |
| `output`         | Destination `.app` path.                                     |
| `extraResources` | Files or directories copied outside the application archive. |

Use `extraResources` for assets that need to remain regular files:

```json
{
  "extraResources": ["assets/dictionary.bin", { "from": "models", "to": "models" }]
}
```

A string uses the source basename as its destination. An object can select a
resource-relative destination with `to`. Packaged resources are available to
the application process under `app.resourcesPath`.

## IPC permissions

Renderer IPC is denied unless the window explicitly grants access to a channel.
Each capability combines a channel with one or more operations:

- `invoke` allows `Ant.ipc.invoke()` in the renderer and requires an
  `ipcMain.handle()` handler.
- `send` allows `Ant.ipc.send()` in the renderer and is received with
  `ipcMain.on()`.
- `receive` allows the application process to send an event with
  `window.webContents.send()`, received through `Ant.ipc.on()`.

```js
const window = new BrowserWindow({
  webPreferences: {
    capabilities: [
      { channel: 'settings:read', access: ['invoke'] },
      { channel: 'page:ready', access: ['send'] },
      { channel: 'theme:changed', access: ['receive'] }
    ]
  }
});
```

## Preload and renderer integration

Renderer windows use secure web defaults: `sandbox` and `contextIsolation` are
enabled, while runtime integration is disabled. A preload can publish a narrow
API before the page starts:

```js
// preload.js
import { contextBridge, ipcRenderer } from 'ant:desktop/renderer';

contextBridge.exposeInMainWorld('settings', {
  read: () => ipcRenderer.invoke('settings:read')
});
```

Pass its absolute path through `webPreferences.preload`. Set `sandbox: false`
when the preload itself needs Ant builtins.

`nodeIntegration` and `antIntegration` are aliases. Either one exposes
`require`, `process`, and every registered `node:` or `ant:` builtin directly
to the renderer. The integrated runtime is Ant, not Node.js; the
`nodeIntegration` spelling exists for Electron-compatible configuration.

```js
const window = new BrowserWindow({
  webPreferences: {
    sandbox: false,
    antIntegration: true
  }
});
```

Integration is intentionally rejected while `sandbox` is enabled. Prefer a
sandboxed preload with explicit `contextBridge` methods for untrusted content.

## Main-process API

The `ant:desktop` module exports:

- `app`
- `BrowserWindow`
- `ipcMain`
- `Menu`
- `MenuItem`
- `versions`

`versions` reports the Ant Desktop, Ant, and Chrome versions included in
the current runtime. The desktop-specific entries are also available as
`process.versions['ant-desktop']` and `process.versions.chrome`.

`BrowserWindow` supports loading local files and URLs, window visibility and
state controls, application events, custom title bars, application menus, and
Chromium developer tools.
