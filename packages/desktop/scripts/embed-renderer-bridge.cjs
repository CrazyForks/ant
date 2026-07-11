#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const desktopRoot = path.resolve(__dirname, '..');

function rendererBridgeSource() {
  const bridge = path.join(desktopRoot, 'ipc', 'bridge');
  const modules = ['clone.js', 'renderer.js', 'main.js'].map(filename =>
    fs.readFileSync(path.join(bridge, filename), 'utf8').trim()
  );
  return Buffer.from([
    '((bindings) => {',
    ...modules,
    "return typeof bindings.nativeIpc === 'function'",
    '  ? createRendererBridge(bindings)',
    '  : createMainBridge(bindings);',
    '})',
    ''
  ].join('\n\n'));
}

function embedRendererBridge(output) {
  const source = rendererBridgeSource();
  const rows = [];
  for (let offset = 0; offset < source.length; offset += 12) {
    rows.push(`  ${[...source.subarray(offset, offset + 12)].map(byte => `0x${byte.toString(16).padStart(2, '0')}`).join(', ')}`);
  }
  const header = [
    'unsigned char ant_desktop_ipc_bridge_source[] = {',
    rows.join(',\n'),
    '};',
    `unsigned int ant_desktop_ipc_bridge_source_len = ${source.length};`,
    ''
  ].join('\n');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, header);
}

if (require.main === module) {
  if (process.argv.length !== 3) {
    process.stderr.write('usage: embed-renderer-bridge.cjs <output-header>\n');
    process.exit(64);
  }
  embedRendererBridge(path.resolve(process.argv[2]));
}

module.exports = { embedRendererBridge, rendererBridgeSource };
