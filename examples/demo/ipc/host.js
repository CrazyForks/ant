import { Sandbox } from 'ant:sandbox';

const sandbox = new Sandbox({ memory: '128mb' });

let finish;
const finished = new Promise(resolve => {
  finish = resolve;
});

sandbox.on('message', message => {
  console.log('host received:', message);

  if (message.type === 'ready') {
    sandbox.send({ type: 'ping' });
  } else if (message.type === 'pong') {
    sandbox.send({ type: 'add', left: 20, right: 22 });
  } else if (message.type === 'result') {
    finish();
  }
});

const running = sandbox.run('examples/demo/ipc/guest.js');

await finished;
await sandbox.close();
await running;
