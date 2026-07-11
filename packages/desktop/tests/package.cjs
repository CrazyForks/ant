'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { packageApp } = require('../packaging/npm/darwin-arm64/package.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-desktop-package-'));
try {
  const appRoot = path.join(root, 'source');
  const entry = path.join(appRoot, 'main.js');
  const executable = path.join(root, 'ant-desktop');
  const host = path.join(root, 'Ant Chromium Host.app', 'Contents', 'MacOS', 'Ant Chromium Host');
  const hostFrameworks = path.join(root, 'Ant Chromium Host.app', 'Contents', 'Frameworks');
  fs.mkdirSync(appRoot, { recursive: true });
  fs.mkdirSync(path.dirname(host), { recursive: true });
  fs.mkdirSync(hostFrameworks, { recursive: true });
  fs.writeFileSync(entry, 'console.log("packaged");\n');
  fs.writeFileSync(path.join(appRoot, 'page.html'), '<h1>Packaged</h1>\n');
  const extra = path.join(root, 'model.bin');
  fs.writeFileSync(extra, 'model-data\n');
  fs.writeFileSync(executable, '#!/bin/sh\n');
  fs.writeFileSync(host, '#!/bin/sh\n');
  const frameworkResources = path.join(hostFrameworks, 'Fake.framework', 'Versions', 'A', 'Resources');
  fs.mkdirSync(path.join(frameworkResources, 'en.lproj'), { recursive: true });
  fs.mkdirSync(path.join(frameworkResources, 'fr.lproj'), { recursive: true });
  fs.writeFileSync(path.join(frameworkResources, 'en.lproj', 'locale.pak'), 'english\n');
  fs.writeFileSync(path.join(frameworkResources, 'fr.lproj', 'locale.pak'), 'french\n');
  fs.chmodSync(executable, 0o755);
  fs.chmodSync(host, 0o755);

  const output = path.join(root, 'dist', 'PackageTest.app');
  const result = packageApp({ executable, host }, entry, {
    appDir: appRoot,
    identifier: 'com.antjs.package-test',
    name: 'PackageTest',
    out: output,
    version: '1.2.3',
    extraResources: [{ from: extra, to: 'models/model.bin' }]
  });

  assert.equal(result.format, 'app');
  assert.equal(result.path, output);
  assert.ok(fs.statSync(path.join(output, 'Contents', 'MacOS', 'PackageTest')).mode & 0o100);
  const archive = path.join(output, 'Contents', 'Resources', 'app.ant');
  assert.equal(fs.readFileSync(archive).subarray(0, 8).toString(), 'ANTAPP01');
  assert.ok(!fs.existsSync(path.join(output, 'Contents', 'Resources', 'app')));
  assert.equal(
    fs.readFileSync(path.join(output, 'Contents', 'Resources', 'models', 'model.bin'), 'utf8'),
    'model-data\n'
  );
  assert.ok(fs.existsSync(path.join(output, 'Contents', 'Frameworks', 'Fake.framework', 'Versions', 'A', 'Resources', 'en.lproj', 'locale.pak')));
  assert.ok(!fs.existsSync(path.join(output, 'Contents', 'Frameworks', 'Fake.framework', 'Versions', 'A', 'Resources', 'fr.lproj')));
  assert.ok(fs.existsSync(path.join(output, 'Contents', 'MacOS', 'Ant Chromium Host')));
  const plist = fs.readFileSync(path.join(output, 'Contents', 'Info.plist'), 'utf8');
  assert.match(plist, /<string>com\.antjs\.package-test<\/string>/);
  assert.match(plist, /<key>CFBundleDevelopmentRegion<\/key>\s*<string>English<\/string>/);
  assert.match(plist, /<key>AntDesktopEntry<\/key>\s*<string>main\.js<\/string>/);
  assert.match(plist, /<key>AntDesktopArchive<\/key>\s*<string>app\.ant<\/string>/);
  assert.throws(() => packageApp({ executable, host }, entry, { appDir: appRoot, out: output }), /Output already exists/);
  console.log('desktop-package-smoke-ok');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
