#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { execute } = require('./lib/command.cjs');
const { embedRendererBridge } = require('./embed-renderer-bridge.cjs');
const { readRuntimeLock } = require('./lib/runtime-lock.cjs');

const desktopRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(desktopRoot, '../..');
const libant = path.join(repositoryRoot, 'packages', 'libant', 'dist');
const host = path.join(desktopRoot, 'runtime', 'Ant Chromium Host.app', 'Contents', 'MacOS', 'Ant Chromium Host');
const sources = [
  'app/archive/archive.c',
  'app/api/app.c',
  'app/api/browser_window.c',
  'app/api/desktop_module.c',
  'app/api/ipc_main.c',
  'app/api/web_contents.c',
  'app/core/window_state.c',
  'app/platform/mac/browser_view.mm',
  'app/platform/mac/desktop_window.mm',
  'app/platform/mac/event_loop.mm',
  'app/platform/mac/main.mm',
  'app/platform/mac/menu.mm',
  'app/platform/mac/native_menu.mm',
  'app/platform/mac/remote_layer_host.mm',
  'app/platform/mac/window_factory.mm',
  'app/platform/mac/window_options.mm',
  'app/runtime/ant_runtime.c'
];

function buildApp() {
  const desktopVersion = JSON.parse(
    fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')
  ).version;
  const runtime = readRuntimeLock();
  if (!fs.existsSync(path.join(libant, 'libant.a')) || !fs.existsSync(path.join(libant, 'ant.h'))) {
    execute(path.join(repositoryRoot, 'packages', 'libant', 'build.sh'), []);
  }

  const build = path.join(desktopRoot, 'build');
  const objectRoot = path.join(build, 'obj');
  const generated = path.join(build, 'generated');
  fs.mkdirSync(build, { recursive: true });
  for (const entry of fs.readdirSync(build)) {
    if (entry.endsWith('.o')) fs.rmSync(path.join(build, entry));
  }
  fs.rmSync(objectRoot, { recursive: true, force: true });
  fs.mkdirSync(objectRoot, { recursive: true });
  embedRendererBridge(path.join(generated, 'renderer_bridge.h'));

  const compiler = execute('xcrun', ['--find', 'clang'], { capture: true });
  const linker = process.env.CXX || 'clang++';
  const sdk = execute('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {
    capture: true
  });
  const objects = [];
  for (const source of sources) {
    const object = path.join(
      objectRoot,
      `${source.replaceAll('/', '_').replaceAll('.', '_')}.o`
    );
    const language = source.endsWith('.mm') ? 'objective-c' : 'c';
    execute(
      compiler,
      [
        '-x',
        language,
        '-std=c11',
        '-fobjc-arc',
        '-mmacosx-version-min=15.0',
        '-isysroot',
        sdk,
        `-I${libant}`,
        `-I${path.join(repositoryRoot, 'include')}`,
        `-I${generated}`,
        `-DANT_DESKTOP_DEFAULT_HOST="${host}"`,
        `-DANT_DESKTOP_VERSION="${desktopVersion}"`,
        `-DANT_DESKTOP_CHROMIUM_VERSION="${runtime.chromiumVersion}"`,
        source,
        '-c',
        '-o',
        object
      ],
      { cwd: desktopRoot }
    );
    objects.push(object);
  }

  const output = path.join(build, 'ant-desktop');
  execute(
    linker,
    [
      '-mmacosx-version-min=15.0',
      '-isysroot',
      sdk,
      ...objects,
      path.join(libant, 'libant.a'),
      '-framework',
      'AppKit',
      '-framework',
      'QuartzCore',
      '-framework',
      'Security',
      '-framework',
      'CoreFoundation',
      '-framework',
      'Hypervisor',
      '-lpthread',
      '-o',
      output
    ],
    { cwd: desktopRoot }
  );
  process.stdout.write(`Built ${output}\n`);
  return output;
}

if (require.main === module) buildApp();

module.exports = { buildApp };
