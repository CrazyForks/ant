const createRendererBridge = bindings => {
  const grants = new Set((bindings.capabilityManifest || '').split(';').filter(Boolean));
  const pending = new Map();
  const listeners = new Map();
  let nextRequest = 1;

  const requireGrant = (access, channel) => {
    if (typeof channel !== 'string' || !grants.has(`${access}:${channel}`)) {
      throw new DOMException(`IPC capability not granted: ${access}:${channel}`, 'SecurityError');
    }
  };

  const ipc = Object.freeze({
    send(channel, value) {
      requireGrant('send', channel);
      bindings.nativeIpc(0, 0, channel, encode(value));
    },

    invoke(channel, value) {
      requireGrant('invoke', channel);
      const id = nextRequest++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        bindings.nativeIpc(1, id, channel, encode(value));
      });
    },

    on(channel, listener) {
      requireGrant('receive', channel);
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      const values = listeners.get(channel) || [];
      values.push(listener);
      listeners.set(channel, values);
      return () =>
        listeners.set(
          channel,
          values.filter(value => value !== listener)
        );
    }
  });

  Object.defineProperty(globalThis, 'Ant', {
    value: Object.freeze({ ipc }),
    enumerable: false,
    configurable: false
  });

  return Object.freeze({
    receive(operation, id, channel, payload) {
      if (operation === 2) {
        if (!grants.has(`receive:${channel}`)) return;
        const value = decode(payload);
        for (const listener of listeners.get(channel) || []) listener(value);
        return;
      }
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      const value = decode(payload);
      (operation === 0 ? request.resolve : request.reject)(value);
    }
  });
};
