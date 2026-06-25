const {
  AsyncLocalStorage,
  AsyncResource,
  createHook,
  executionAsyncId,
} = require('node:async_hooks');

const als = new AsyncLocalStorage();
const seen = [];

function check(label, expected) {
  const store = als.getStore();
  seen.push(`${label}:${store ? store.name : String(store)}`);
  if ((store && store.name) !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${store ? store.name : String(store)}`);
  }
}

(async () => {
  let resource;
  als.run({ name: 'resource' }, () => {
    resource = new AsyncResource('test');
  });
  resource.runInAsyncScope(() => check('resource-scope', 'resource'));

  await als.run({ name: 'outer' }, async () => {
    check('sync', 'outer');
    await Promise.resolve();
    check('await', 'outer');

    await als.run({ name: 'inner' }, async () => {
      check('inner-sync', 'inner');
      await Promise.resolve();
      check('inner-await', 'inner');
    });

    check('after-inner', 'outer');

    await new Promise((resolve, reject) => {
      queueMicrotask(() => {
        try {
          check('microtask', 'outer');
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    await new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          check('timeout', 'outer');
          resolve();
        } catch (err) {
          reject(err);
        }
      }, 0);
    });

    await Promise.resolve().then(() => check('then', 'outer'));

    als.exit(() => {
      const store = als.getStore();
      seen.push(`exit:${String(store)}`);
      if (store !== undefined) throw new Error('exit should clear the current store');
    });

    check('after-exit', 'outer');
  });

  const store = als.getStore();
  seen.push(`after-run:${String(store)}`);
  if (store !== undefined) throw new Error('run should restore the previous store');

  let resume;
  const disabled = als.run({ name: 'disabled' }, () => new Promise((resolve) => {
    resume = resolve;
  }));
  als.disable();
  resume();
  await disabled.then(() => {
    const disabledStore = als.getStore();
    seen.push(`disabled:${String(disabledStore)}`);
    if (disabledStore !== undefined)
      throw new Error('disable should invalidate captured stores');
  });

  const hookEvents = [];
  const lifecycleIds = { manual: 0, timeout: 0 };
  const hook = createHook({
    init(id, type) {
      if (type === 'manual-test') {
        lifecycleIds.manual = id;
        hookEvents.push(`manual:init:${id}`);
      } else if (type === 'Timeout' && lifecycleIds.timeout === 0) {
        lifecycleIds.timeout = id;
        hookEvents.push(`timeout:init:${id}`);
      }
    },
    before(id) {
      if (id === lifecycleIds.manual) hookEvents.push('manual:before');
      if (id === lifecycleIds.timeout) hookEvents.push('timeout:before');
    },
    after(id) {
      if (id === lifecycleIds.manual) hookEvents.push('manual:after');
      if (id === lifecycleIds.timeout) hookEvents.push('timeout:after');
    },
    destroy(id) {
      if (id === lifecycleIds.manual) hookEvents.push('manual:destroy');
      if (id === lifecycleIds.timeout) hookEvents.push('timeout:destroy');
    },
  }).enable();

  const manual = new AsyncResource('manual-test');
  if (manual.asyncId() !== lifecycleIds.manual)
    throw new Error('AsyncResource init should report the resource async id');

  manual.runInAsyncScope(() => {
    if (executionAsyncId() !== lifecycleIds.manual)
      throw new Error('runInAsyncScope should switch executionAsyncId');
  });
  manual.emitDestroy();

  let timeoutFired = false;
  setTimeout(() => {
    timeoutFired = true;
  }, 0);
  await new Promise((resolve) => setTimeout(resolve, 5));
  if (!timeoutFired) throw new Error('timeout lifecycle test did not fire');
  hook.disable();

  for (const expected of [
    `manual:init:${lifecycleIds.manual}`,
    'manual:before',
    'manual:after',
    'manual:destroy',
    `timeout:init:${lifecycleIds.timeout}`,
    'timeout:before',
    'timeout:after',
    'timeout:destroy',
  ]) {
    if (!hookEvents.includes(expected))
      throw new Error(`missing async_hooks lifecycle event ${expected}; saw ${hookEvents.join(',')}`);
  }
  seen.push(hookEvents.join('|'));

  console.log(seen.join('\n'));
})();
