import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_NAME = 'ant-desktop.json';

function optionalString(config, key, filename) {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${filename}: ${key} must be a non-empty string`);
  }
  return value;
}

function resolveFrom(root, value) {
  return value === undefined ? undefined : path.resolve(root, value);
}

function extraResources(config, root, filename) {
  const values = config.extraResources;
  if (values === undefined) return [];
  if (!Array.isArray(values)) {
    throw new Error(`${filename}: extraResources must be an array`);
  }
  return values.map((value, index) => {
    if (typeof value === 'string' && value.trim()) {
      return { from: path.resolve(root, value) };
    }
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new Error(`${filename}: extraResources[${index}] must be a path or object`);
    }
    const from = optionalString(value, 'from', `${filename}: extraResources[${index}]`);
    if (!from) {
      throw new Error(`${filename}: extraResources[${index}].from is required`);
    }
    return {
      from: path.resolve(root, from),
      to: optionalString(value, 'to', `${filename}: extraResources[${index}]`),
    };
  });
}

export function loadConfig(configuredPath, required = Boolean(configuredPath)) {
  const filename = path.resolve(configuredPath || CONFIG_NAME);
  if (!fs.existsSync(filename)) {
    if (required) throw new Error(`Desktop config does not exist: ${filename}`);
    return null;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${filename}: ${error.message}`, { cause: error });
  }

  if (!config || Array.isArray(config) || typeof config !== 'object') {
    throw new Error(`${filename}: root must be an object`);
  }

  const root = path.dirname(filename);
  const main = optionalString(config, 'main', filename) || 'index.js';

  return {
    filename,
    root,
    main: resolveFrom(root, main),
    renderer: resolveFrom(root, optionalString(config, 'renderer', filename)),
    icon: resolveFrom(root, optionalString(config, 'icon', filename)),
    output: resolveFrom(root, optionalString(config, 'output', filename)),
    name: optionalString(config, 'name', filename),
    identifier: optionalString(config, 'identifier', filename),
    version: optionalString(config, 'version', filename),
    extraResources: extraResources(config, root, filename),
  };
}

export function optionsFromConfig(config, command) {
  if (!config) return {};

  const options = {
    appDir: config.root,
    extraResources: config.extraResources,
    identifier: config.identifier,
    name: config.name,
    version: config.version
  };

  if (command === 'dev') {
    options.rendererDir = config.renderer;
  }

  if (command === 'package') {
    options.icon = config.icon;
    options.out = config.output;
  }

  return options;
}
