import { mockControls } from './data/client.js';
import { auth } from './services/index.js';
import { start } from './shared/ui.js';

start(async () => {
  const controls = await mockControls();
  const operations = document.getElementById('operation');
  controls.operations.forEach(name => operations.add(new Option(name, name)));
  async function session() { const user = await auth.me(); document.getElementById('session').textContent = user ? `${user.name} (${user.id}) — ${user.email}` : 'Signed out. Automatic login stays suppressed until reset.'; }
  function bind(id, action) {
    document.getElementById(id).onclick = async event => {
      const button = event.currentTarget; button.disabled = true;
      try { await action(); document.getElementById('result').textContent = 'Done.'; await session(); }
      catch (error) { document.getElementById('result').textContent = `${error.code}: ${error.message}`; }
      finally { button.disabled = false; }
    };
  }
  bind('reset', () => controls.reset());
  bind('logout', () => auth.logout());
  bind('clear', () => controls.clearScenarios());
  bind('set-latency', () => controls.latency(Number(document.getElementById('latency').value)));
  bind('fail', () => controls.failNext(operations.value, document.getElementById('code').value));
  bind('incoming', () => controls.incoming(document.getElementById('room').value, document.getElementById('text').value));
  await session();
});
