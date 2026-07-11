#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { execute } = require('./lib/command.cjs');
const {
  assertHostMatches,
  readRuntimeLock
} = require('./lib/runtime-lock.cjs');
const { fetchBrowserRuntime } = require('./fetch-browser-runtime.cjs');

const desktopRoot = path.resolve(__dirname, '..');

async function buildBrowserHost() {
  const lock = readRuntimeLock();
  const target = assertHostMatches(lock);
  const cefRoot = await fetchBrowserRuntime();
  const build = path.join(desktopRoot, 'build', 'browser', 'cef');
  const product = path.join(build, 'Release', 'Ant Chromium Host.app');
  execute('cmake', ['-S', 'browser/cef', '-B', build, '-G', 'Xcode', `-DCEF_ROOT=${cefRoot}`, `-DPROJECT_ARCH=${target.cmakeArch}`, '-DUSE_SANDBOX=OFF'], {
    cwd: desktopRoot
  });
  execute('cmake', ['--build', build, '--target', 'ant_chromium_host', '--config', 'Release', '--', '-quiet'], { cwd: desktopRoot });

  const runtime = path.join(desktopRoot, 'runtime');
  fs.rmSync(runtime, { recursive: true, force: true });
  fs.mkdirSync(runtime, { recursive: true });
  execute('ditto', [product, path.join(runtime, 'Ant Chromium Host.app')]);
  process.stdout.write(`Installed pinned Chromium host in ${runtime}\n`);
  return runtime;
}

if (require.main === module) {
  buildBrowserHost().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildBrowserHost };
