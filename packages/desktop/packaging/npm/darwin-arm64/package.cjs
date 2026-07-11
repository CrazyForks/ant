'use strict';

const fs = require('node:fs');
const path = require('node:path');

function xml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function plistValue(value, depth = 0) {
  const indent = '  '.repeat(depth);
  if (typeof value === 'string') return `${indent}<string>${xml(value)}</string>`;
  if (typeof value === 'boolean') return `${indent}<${value ? 'true' : 'false'}/>`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${indent}<${Number.isInteger(value) ? 'integer' : 'real'}>${value}</${Number.isInteger(value) ? 'integer' : 'real'}>`;
  }
  if (Array.isArray(value)) {
    const entries = value.map(entry => plistValue(entry, depth + 1)).join('\n');
    return entries ? `${indent}<array>\n${entries}\n${indent}</array>` : `${indent}<array/>`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, entry]) => `${'  '.repeat(depth + 1)}<key>${xml(key)}</key>\n${plistValue(entry, depth + 1)}`)
      .join('\n');
    return entries ? `${indent}<dict>\n${entries}\n${indent}</dict>` : `${indent}<dict/>`;
  }
  throw new TypeError(`Unsupported property-list value: ${value}`);
}

function propertyList(value) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${plistValue(value)}
</plist>
`;
}

function applicationName(value) {
  if (!value.trim() || /[/:\\]/.test(value) || value.includes('\0')) {
    throw new Error('Application name must not be empty or contain /, :, or NUL');
  }
  return value.trim();
}

function bundleIdentifier(name, configured) {
  const fallback = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const value = configured || `org.antjs.${fallback}`;
  if (!/^[A-Za-z0-9.-]+$/.test(value)) {
    throw new Error('Application identifier may contain only letters, numbers, dots, and hyphens');
  }
  return value;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function copyTree(source, destination, excluded, include = () => true) {
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    filter(candidate) {
      const resolved = path.resolve(candidate);
      return include(candidate) && !excluded.some(value => isInside(value, resolved));
    }
  });
}

const ARCHIVE_MAGIC = Buffer.from('ANTAPP01');

function writeUnsigned(buffer, offset, value, bytes) {
  let remaining = value;
  for (let index = 0; index < bytes; index++) {
    buffer[offset + index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
}

function archiveEntries(root, excluded) {
  const entries = [];
  const visit = current => {
    const resolved = path.resolve(current);
    if (excluded.some(value => isInside(value, resolved))) return;
    const stat = fs.lstatSync(current);
    const relative = path.relative(root, current).split(path.sep).join('/');
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort()) visit(path.join(current, name));
      return;
    }
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      throw new Error(`Application archive cannot contain this file type: ${current}`);
    }
    entries.push({ current, relative, stat });
  };
  visit(root);
  return entries;
}

function writeApplicationArchive(root, destination, excluded) {
  const entries = archiveEntries(root, excluded);
  const fd = fs.openSync(destination, 'w');
  try {
    const count = Buffer.alloc(4);
    writeUnsigned(count, 0, entries.length, 4);
    fs.writeSync(fd, ARCHIVE_MAGIC);
    fs.writeSync(fd, count);
    for (const entry of entries) {
      const name = Buffer.from(entry.relative);
      const symbolic = entry.stat.isSymbolicLink();
      const data = symbolic ? Buffer.from(fs.readlinkSync(entry.current)) : fs.readFileSync(entry.current);
      const header = Buffer.alloc(20);
      writeUnsigned(header, 0, name.length, 4);
      writeUnsigned(header, 4, data.length, 8);
      writeUnsigned(header, 12, entry.stat.mode & 0o777, 4);
      header[16] = symbolic ? 2 : 1;
      fs.writeSync(fd, header);
      fs.writeSync(fd, name);
      fs.writeSync(fd, data);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function resourceDestination(resources, value) {
  const source = path.resolve(value.from);
  if (!fs.existsSync(source)) {
    throw new Error(`Extra resource does not exist: ${source}`);
  }
  const relative = value.to || path.basename(source);
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) {
    throw new Error(`Extra resource destination must stay inside Resources: ${relative}`);
  }
  if (relative.split(/[\\/]/)[0] === 'app.ant') {
    throw new Error('Extra resources cannot replace the app.ant archive');
  }
  const destination = path.resolve(resources, relative);
  if (!isInside(resources, destination) || destination === resources) {
    throw new Error(`Invalid extra resource destination: ${relative}`);
  }
  return { source, destination };
}

function isEnglishFrameworkResource(candidate) {
  const name = path.basename(candidate);
  return !name.endsWith('.lproj') || name === 'en.lproj';
}

function infoPlist({ name, executable, identifier, version, entry, icon, archive }) {
  return propertyList({
    CFBundleDevelopmentRegion: 'English',
    CFBundleDisplayName: name,
    CFBundleExecutable: executable,
    CFBundleIdentifier: identifier,
    CFBundleInfoDictionaryVersion: '6.0',
    ...(icon ? { CFBundleIconFile: icon } : {}),
    CFBundleName: name,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
    LSMinimumSystemVersion: '15.0',
    NSHighResolutionCapable: true,
    AntDesktopEntry: entry,
    ...(archive ? { AntDesktopArchive: archive } : {})
  });
}

function packageApp(layout, entry, options = {}) {
  const sourceEntry = path.resolve(entry);
  if (!fs.statSync(sourceEntry, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Application entry does not exist: ${sourceEntry}`);
  }
  const appRoot = path.resolve(options.appDir || path.dirname(sourceEntry));
  if (!fs.statSync(appRoot, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Application directory does not exist: ${appRoot}`);
  }
  if (!isInside(appRoot, sourceEntry)) {
    throw new Error('Application entry must be inside --app-dir');
  }

  const name = applicationName(options.name || path.basename(sourceEntry, path.extname(sourceEntry)));
  const executable = name;
  const identifier = bundleIdentifier(name, options.identifier);
  const version = options.version || '1.0.0';
  const requestedOutput = path.resolve(options.out || path.join(process.cwd(), 'dist', `${name}.app`));
  const output = requestedOutput.endsWith('.app') ? requestedOutput : `${requestedOutput}.app`;
  if (fs.existsSync(output) && !options.overwrite) {
    throw new Error(`Output already exists: ${output} (pass --overwrite to replace it)`);
  }

  let icon;
  if (options.icon) {
    const sourceIcon = path.resolve(options.icon);
    if (path.extname(sourceIcon).toLowerCase() !== '.icns' || !fs.statSync(sourceIcon, { throwIfNoEntry: false })?.isFile()) {
      throw new Error('macOS application icon must be an existing .icns file');
    }
    icon = `${name}.icns`;
  }

  const hostBundle = path.resolve(layout.host, '../../..');
  const hostFrameworks = path.join(hostBundle, 'Contents', 'Frameworks');
  const temporary = `${output}.tmp-${process.pid}-${Date.now()}`;
  const contents = path.join(temporary, 'Contents');
  const macos = path.join(contents, 'MacOS');
  const frameworks = path.join(contents, 'Frameworks');
  const resources = path.join(contents, 'Resources');
  const relativeEntry = path.relative(appRoot, sourceEntry);
  const archive = 'app.ant';
  const extraResources = (options.extraResources || []).map(value =>
    resourceDestination(resources, typeof value === 'string' ? { from: value } : value)
  );
  const excluded = [output, temporary, ...extraResources.map(value => value.source)];

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.rmSync(temporary, { recursive: true, force: true });
  try {
    fs.mkdirSync(macos, { recursive: true });
    fs.mkdirSync(frameworks, { recursive: true });
    fs.mkdirSync(resources, { recursive: true });
    fs.copyFileSync(layout.executable, path.join(macos, executable));
    fs.chmodSync(path.join(macos, executable), 0o755);
    fs.copyFileSync(layout.host, path.join(macos, 'Ant Chromium Host'));
    fs.chmodSync(path.join(macos, 'Ant Chromium Host'), 0o755);
    for (const entry of fs.readdirSync(hostFrameworks)) {
      copyTree(path.join(hostFrameworks, entry), path.join(frameworks, entry), [], isEnglishFrameworkResource);
    }
    writeApplicationArchive(appRoot, path.join(resources, archive), excluded);
    for (const resource of extraResources) {
      fs.mkdirSync(path.dirname(resource.destination), { recursive: true });
      copyTree(resource.source, resource.destination, []);
    }
    if (options.icon) fs.copyFileSync(path.resolve(options.icon), path.join(resources, icon));
    fs.writeFileSync(
      path.join(contents, 'Info.plist'),
      infoPlist({
        name,
        executable,
        identifier,
        version,
        entry: relativeEntry.split(path.sep).join('/'),
        icon,
        archive
      })
    );
    fs.writeFileSync(path.join(contents, 'PkgInfo'), 'APPL????');
    if (fs.existsSync(output)) fs.rmSync(output, { recursive: true, force: true });
    fs.renameSync(temporary, output);
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }

  return { format: 'app', path: output, platform: 'darwin-arm64' };
}

module.exports = {
  bundleIdentifier,
  infoPlist,
  isInside,
  packageApp,
  applicationName,
  resourceDestination,
  writeApplicationArchive
};
