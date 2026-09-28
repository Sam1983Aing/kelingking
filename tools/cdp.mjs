// Minimal headless Chrome over the DevTools protocol, with nothing to install.
//   const b = await launch(); const page = await b.open(url, { width, height });
//   await page.eval('1 + 1'); await b.close();

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Every Chrome still open when node exits is killed, however it exits: a tool that throws or is
// interrupted before its close() used to leave Chrome running with the page still drawing (v11
// found four, an hour old, holding the GPU at 100% and every timing 3 to 5 times too slow).
const live = new Set();
process.on('exit', () => { for (const c of live) { try { c.kill(); } catch {} } });
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.on(sig, () => process.exit(code));
}

export async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'kelingking-cdp-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=metal', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  live.add(chrome);
  chrome.on('exit', () => live.delete(chrome));
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    chrome.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
    chrome.on('exit', () => reject(new Error('Chrome exited early:\n' + buf)));
    setTimeout(() => reject(new Error('Chrome did not start')), 15000);
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const pending = new Map();
  const logs = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
    const log = logs.get(msg.sessionId);
    if (log && msg.method === 'Runtime.consoleAPICalled') log.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 1500));
    if (log && msg.method === 'Runtime.exceptionThrown') log.push('exception: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  return {
    send,
    async open(url, { width = 1280, height = 800 } = {}) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const log = [];
      logs.set(sessionId, log);
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send('Runtime.enable', {}, sessionId);
      await send('Page.enable', {}, sessionId);
      await send('Page.navigate', { url }, sessionId);
      return {
        log,
        sessionId,
        async screenshot(opts = { format: 'png' }) { return Buffer.from((await send('Page.captureScreenshot', opts, sessionId)).data, 'base64'); },
        async eval(expression, timeout = 600000) {
          const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout }, sessionId);
          if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n' + log.join('\n'));
          return r.result.value;
        },
        async waitFor(expression, timeout = 120000) {
          const t0 = Date.now();
          for (;;) {
            const r = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
            if (r.result.value) return;
            if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${expression}\n` + log.join('\n'));
            await new Promise((res) => setTimeout(res, 250));
          }
        },
        front: () => send('Page.bringToFront', {}, sessionId),
        close: () => send('Target.closeTarget', { targetId }),
      };
    },
    close() {
      ws.close();
      chrome.kill();
      setTimeout(() => { try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {} }, 800);
    },
  };
}
