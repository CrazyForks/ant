'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { applicationName, bundleIdentifier, infoPlist, isInside, resourceDestination } = require('./package.cjs');

function replaceSymlink(target, link, type) {
  fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(target, link, type);
}

function createDevApp(layout, entry, options = {}) {
  const sourceEntry = path.resolve(entry);
  if (!fs.statSync(sourceEntry, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Application entry does not exist: ${sourceEntry}`);
  }
  const appRoot = path.resolve(options.appDir || path.dirname(sourceEntry));
  if (!isInside(appRoot, sourceEntry)) {
    throw new Error('Application entry must be inside --app-dir');
  }

  const name = applicationName(options.name || path.basename(appRoot));
  const identifier = bundleIdentifier(name, options.identifier);
  const key = crypto.createHash('sha256').update(`${appRoot}\0${name}\0${identifier}`).digest('hex').slice(0, 12);
  const output = path.join(options.cacheDir || path.join(os.homedir(), 'Library', 'Caches', 'ant-desktop'), 'dev', key, `${name}.app`);
  const contents = path.join(output, 'Contents');
  const macos = path.join(contents, 'MacOS');
  const resources = path.join(contents, 'Resources');
  const executable = path.join(macos, name);
  const hostBundle = path.resolve(layout.host, '../../..');
  let icon;

  if (options.icon) {
    const sourceIcon = path.resolve(options.icon);
    if (path.extname(sourceIcon).toLowerCase() !== '.icns' || !fs.statSync(sourceIcon, { throwIfNoEntry: false })?.isFile()) {
      throw new Error('macOS application icon must be an existing .icns file');
    }
    icon = `${name}.icns`;
  }
  const extraResources = (options.extraResources || []).map(value =>
    resourceDestination(resources, typeof value === 'string' ? { from: value } : value)
  );

  fs.mkdirSync(macos, { recursive: true });
  fs.mkdirSync(resources, { recursive: true });
  replaceSymlink(layout.executable, executable, 'file');
  replaceSymlink(layout.host, path.join(macos, 'Ant Chromium Host'), 'file');
  replaceSymlink(path.join(hostBundle, 'Contents', 'Frameworks'), path.join(contents, 'Frameworks'), 'dir');
  replaceSymlink(appRoot, path.join(resources, 'app'), 'dir');
  for (const resource of extraResources) {
    fs.mkdirSync(path.dirname(resource.destination), { recursive: true });
    replaceSymlink(resource.source, resource.destination, fs.statSync(resource.source).isDirectory() ? 'dir' : 'file');
  }
  if (options.icon) {
    replaceSymlink(path.resolve(options.icon), path.join(resources, icon), 'file');
  }
  fs.writeFileSync(
    path.join(contents, 'Info.plist'),
    infoPlist({
      name,
      executable: name,
      identifier,
      version: options.version || '0.0.0-dev',
      icon,
      entry: path.posix.join('app', path.relative(appRoot, sourceEntry).split(path.sep).join('/'))
    })
  );
  fs.writeFileSync(path.join(contents, 'PkgInfo'), 'APPL????');
  return { appRoot, executable, name, output };
}

function dev(layout, entry, options = {}) {
  const developmentApp = createDevApp(layout, entry, options);
  const rendererRoot = path.resolve(options.rendererDir || path.join(developmentApp.appRoot, 'renderer'));
  if (!fs.statSync(rendererRoot, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Renderer directory does not exist: ${rendererRoot} (pass --renderer-dir)`);
  }
  let child;
  let restartTimer;
  let restarting = false;
  let stopping = false;
  let rendererChangeAt = 0;

  const launch = () => {
    child = spawn(developmentApp.executable, options.args || [], {
      cwd: developmentApp.appRoot,
      env: { ...process.env, ...options.env, ANT_DESKTOP_DEV: '1' },
      stdio: 'inherit'
    });
    child.once('exit', (code, signal) => {
      if (stopping || restarting || restartTimer) return;
      if (code !== 0) {
        process.stderr.write(`ant-desktop dev: application exited (${signal || code})\n`);
      }
      stop();
    });
  };

  const restart = () => {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      if (!child || child.exitCode !== null) {
        launch();
        return;
      }
      restarting = true;
      child.once('exit', () => {
        restarting = false;
        launch();
      });
      child.kill('SIGTERM');
    }, 100);
  };

  const rendererWatcher = fs.watch(rendererRoot, { recursive: true }, () => {
    rendererChangeAt = Date.now();
    if (child?.exitCode === null) child.kill('SIGUSR1');
  });
  const applicationWatcher = fs.watch(developmentApp.appRoot, { recursive: true }, (_event, filename) => {
    if (stopping) return;
    if (!filename) return;
    const changed = path.resolve(developmentApp.appRoot, filename);
    if (filename.split(path.sep).some(part => part === '.git' || part === 'node_modules' || part === 'dist')) return;
    if (isInside(rendererRoot, changed) || Date.now() - rendererChangeAt < 250) {
      return;
    }
    restart();
  });

  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(restartTimer);
    rendererWatcher.close();
    applicationWatcher.close();
    if (child?.exitCode === null) child.kill('SIGTERM');
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  launch();
  process.stdout.write(`Ant Desktop dev app: ${developmentApp.output}\n`);
  return {
    ...developmentApp,
    applicationWatcher,
    rendererWatcher,
    stop
  };
}

module.exports = { createDevApp, dev };
