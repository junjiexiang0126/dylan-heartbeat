const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { setTimeout: delay } = require('timers/promises');

test('real gateway and worker wake without Kelivo, persist and inject activity into chat', { timeout: 30000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-integration-'));
  let chatRequest;
  const upstream = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    const autonomous = Boolean(input.response_format);
    if (!autonomous) chatRequest = input;
    const content = autonomous ? JSON.stringify({ action: 'plan', reason: '准备提纲', diary: '我在后台制定了计划。', output: '哲学复习提纲', tasks: [{ id: 'review', title: '复习', status: 'pending', nextStep: '展开提纲' }], notification: null }) : '已读取后台计划';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), GATEWAY_BASE_URL: base, TARGET_API_URL: `http://127.0.0.1:${upstream.address().port}/chat`, TARGET_API_KEY: 'test-only', MODEL_NAME: 'mock', ADMIN_USER: 'test', ADMIN_PASSWORD: 'test-only', AUTONOMOUS_ENABLED: 'true', AUTONOMOUS_PUSH_ENABLED: 'false', TIME_ZONE: 'Asia/Bangkok' };
  let logs = '';
  env.HOST = '127.0.0.1';
  const children = ['server.js', 'wake_up.js'].map(file => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', file)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    return child;
  });
  t.after(async () => {
    await Promise.all(children.map(child => new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve); child.kill('SIGTERM');
    })));
    await new Promise(resolve => upstream.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  async function waitFor(predicate) {
    for (let i = 0; i < 100; i++) {
      if (await predicate()) return;
      await delay(200);
    }
    assert.fail(`Timed out waiting for real processes: ${logs}`);
  }
  await waitFor(async () => { try { return (await fetch(`${base}/healthz`)).ok; } catch { return false; } });
  await waitFor(async () => fs.existsSync(path.join(dir, 'autonomous_state.json')));
  assert.equal((await fetch(`${base}/admin/autonomy`)).status, 401);
  const status = await fetch(`${base}/admin/autonomy`, { headers: { Authorization: `Basic ${Buffer.from('test:test-only').toString('base64')}` } });
  const state = await status.json();
  assert.equal(state.tasks[0].id, 'review');
  assert.equal(state.activities[0].diary, '我在后台制定了计划。');
  const chat = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'mock', messages: [{ role: 'user', content: '你做了什么？' }], stream: false }) });
  assert.equal(chat.status, 200);
  await chat.text();
  assert.ok(chatRequest.messages.some(m => String(m.content).includes('哲学复习提纲')));
  await waitFor(async () => JSON.parse(fs.readFileSync(path.join(dir, 'autonomous_state.json'), 'utf8')).activities[0].eventStatus === 'recorded');
});
