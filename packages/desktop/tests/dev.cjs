'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const {
  createDevApp,
  dev
} = require('../packaging/npm/darwin-arm64/dev.cjs');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-desktop-dev-'));
async function main() {
  const appRoot = path.join(temporary, 'source');
  const entry = path.join(appRoot, 'main.js');
  const executable = path.join(temporary, 'ant-desktop');
  const icon = path.join(temporary, 'app.icns');
  const hostBundle = path.join(temporary, 'Ant Chromium Host.app');
  const host = path.join(hostBundle, 'Contents', 'MacOS', 'Ant Chromium Host');
  fs.mkdirSync(path.dirname(host), { recursive: true });
  fs.mkdirSync(path.join(hostBundle, 'Contents', 'Frameworks'), {
    recursive: true
  });
  fs.mkdirSync(path.join(appRoot, 'renderer'), { recursive: true });
  fs.writeFileSync(entry, 'console.log("dev");\n');
  fs.writeFileSync(executable, 'native');
  fs.writeFileSync(icon, 'icon');
  fs.writeFileSync(host, 'chromium');

  const result = createDevApp({ executable, host }, entry, {
    cacheDir: path.join(temporary, 'cache'),
    icon,
    name: 'Dev Example'
  });
  assert.equal(result.name, 'Dev Example');
  assert.equal(fs.realpathSync(result.executable), fs.realpathSync(executable));
  assert.equal(
    fs.realpathSync(path.join(result.output, 'Contents', 'Resources', 'app')),
    fs.realpathSync(appRoot)
  );
  const plist = fs.readFileSync(
    path.join(result.output, 'Contents', 'Info.plist'),
    'utf8'
  );
  assert.match(plist, /<string>Dev Example<\/string>/);
  assert.match(plist, /<string>Dev Example\.icns<\/string>/);
  assert.match(plist, /<string>app\/main\.js<\/string>/);
  assert.equal(
    fs.realpathSync(path.join(result.output, 'Contents', 'Resources', 'Dev Example.icns')),
    fs.realpathSync(icon)
  );

  fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify({
    productName: 'Ignored Package Name'
  }));
  const fallback = createDevApp({ executable, host }, entry, {
    cacheDir: path.join(temporary, 'fallback-cache')
  });
  assert.equal(fallback.name, 'source');

  const exitProgram = path.join(temporary, 'exit.cjs');
  fs.writeFileSync(exitProgram, 'process.exit(0);\n');
  const supervisor = dev({ executable: process.execPath, host }, entry, {
    args: [exitProgram],
    cacheDir: path.join(temporary, 'supervisor-cache'),
    name: 'Dev Example'
  });
  await Promise.all([
    once(supervisor.applicationWatcher, 'close'),
    once(supervisor.rendererWatcher, 'close')
  ]);
  console.log('desktop-dev-bundle-ok');
}

main().finally(() => {
  fs.rmSync(temporary, { recursive: true, force: true });
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
