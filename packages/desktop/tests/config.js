import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadConfig, optionsFromConfig } from '../config.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-desktop-config-'));
try {
  const filename = path.join(root, 'desktop.json');
  fs.writeFileSync(filename, JSON.stringify({
    main: 'src/index.js',
    renderer: 'renderer',
    icon: 'assets/app.icns',
    output: 'release/My App.app',
    name: 'My App',
    identifier: 'com.example.my-app',
    version: '1.2.3',
    extraResources: [
      'assets/model.bin',
      { from: '../shared/dictionary', to: 'dictionary' }
    ]
  }));

  const config = loadConfig(filename);
  assert.equal(config.main, path.join(root, 'src/index.js'));
  assert.equal(config.renderer, path.join(root, 'renderer'));
  assert.equal(config.icon, path.join(root, 'assets/app.icns'));
  assert.equal(config.output, path.join(root, 'release/My App.app'));
  assert.deepEqual(config.extraResources, [
    { from: path.join(root, 'assets/model.bin') },
    { from: path.resolve(root, '../shared/dictionary'), to: 'dictionary' }
  ]);
  assert.deepEqual(optionsFromConfig(config, 'dev'), {
    appDir: root,
    extraResources: config.extraResources,
    identifier: 'com.example.my-app',
    name: 'My App',
    rendererDir: path.join(root, 'renderer'),
    version: '1.2.3'
  });
  assert.deepEqual(optionsFromConfig(config, 'package'), {
    appDir: root,
    extraResources: config.extraResources,
    icon: path.join(root, 'assets/app.icns'),
    identifier: 'com.example.my-app',
    name: 'My App',
    out: path.join(root, 'release/My App.app'),
    version: '1.2.3'
  });
  assert.equal(loadConfig(path.join(root, 'missing.json'), false), null);
  let missingError;
  try {
    loadConfig(path.join(root, 'missing.json'));
  } catch (error) {
    missingError = error;
  }
  assert.match(missingError?.message, /Desktop config does not exist/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('desktop-config-ok');
