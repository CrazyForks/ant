Hono adapter helpers for Ant's native server runtime.

```js
import { Hono } from 'hono';
import { upgradeWebSocket } from '@ant/hono';

const app = new Hono();

app.get(
  '/ws',
  upgradeWebSocket(() => ({
    onMessage(event, ws) {
      ws.send(event.data);
    }
  }))
);

export default {
  port: 3000,
  fetch: app.fetch
};
```

`upgradeWebSocket()` delegates to Ant's native `ctx.upgradeWebSocket(request)` API.
