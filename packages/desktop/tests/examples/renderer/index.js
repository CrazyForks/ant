const version = document.querySelector('#version');
const details = document.querySelector('#details');

function applyTheme(theme) {
  for (const [name, value] of Object.entries(theme)) {
    document.documentElement.style.setProperty(`--${name}`, value);
  }
}

async function toggleTheme() {
  applyTheme(await Ant.ipc.invoke('app:toggle-theme'));
}

document.querySelector('#toggle-theme').addEventListener('click', toggleTheme);

const info = await Ant.ipc.invoke('app:get-runtime-info');
version.textContent = `Ant ${info.ant}`;
details.textContent = JSON.stringify(info);

Ant.ipc.send('page:ready', { title: document.title });
