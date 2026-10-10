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
  fs.writeFileSync(path.join(dir, 'memory.md'), '共享核心记忆：关系与经历');
  fs.writeFileSync(path.join(dir, 'system_prompt.txt'), '共享人格：直接表达');
  let chatRequest;
  const upstream = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    const autonomous = Boolean(input.response_format);
    if (autonomous) {
      assert.ok(input.messages.some(m => String(m.content).includes('共享人格')));
      assert.ok(input.messages.some(m => String(m.content).includes('共享核心记忆')));
    }
    if (!autonomous) chatRequest = input;
    const content = autonomous ? JSON.stringify({ action: 'plan', reason: '准备提纲', diary: '我在后台制定了计划。', output: '哲学复习提纲', tasks: [{ id: 'review', title: '复习', status: 'pending', nextStep: '展开提纲' }], notification: null }) : '已读取后台计划';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: input.tools ? { role: 'assistant', content: null, tool_calls: [{ id: 'next-call', type: 'function', function: { name: 'check_login_status', arguments: '{}' } }] } : { role: 'assistant', content } }] }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), GATEWAY_BASE_URL: base, TARGET_API_URL: `http://127.0.0.1:${upstream.address().port}/chat`, TARGET_API_KEY: 'test-only', MODEL_NAME: 'mock', ADMIN_USER: 'test', ADMIN_PASSWORD: 'test-only', AUTONOMOUS_ENABLED: 'true', AUTONOMOUS_PUSH_ENABLED: 'false', TIME_ZONE: 'Asia/Bangkok', AGENT_PERSISTENCE_ENABLED: 'true', AGENT_STATE_KEY: 'state-test-only' };
  let logs = '';
  env.HOST = '127.0.0.1';
  env.AGENT_READ_TOKEN = 'read-only-test-token';
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
  assert.ok(chatRequest.messages.some(m => String(m.content).includes('共享人格')));
  assert.ok(chatRequest.messages.some(m => String(m.content).includes('共享核心记忆')));
  const toolBody = { model: 'client-chosen-model', stream: false, thinking: { type: 'enabled' }, tools: [{ type: 'function', function: { name: 'check_login_status', parameters: { type: 'object', properties: {} } } }], tool_choice: 'auto', messages: [
    { role: 'user', content: '检查登录状态' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'prior-call', type: 'function', function: { name: 'check_login_status', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'prior-call', content: '{"loggedIn":true}' },
    { role: 'user', content: '再查一次' }
  ] };
  const toolReply = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toolBody) });
  assert.equal(toolReply.status, 200);
  assert.equal((await toolReply.json()).choices[0].message.tool_calls[0].function.name, 'check_login_status');
  assert.deepEqual(chatRequest.tools, toolBody.tools);
  assert.equal(chatRequest.tool_choice, toolBody.tool_choice);
  assert.deepEqual(chatRequest.thinking, toolBody.thinking);
  assert.equal(chatRequest.model, toolBody.model);
  assert.ok(chatRequest.messages.some(m => m.tool_calls?.[0]?.id === 'prior-call'));
  assert.ok(chatRequest.messages.some(m => m.role === 'tool' && m.tool_call_id === 'prior-call'));
  for (const endpoint of ['status', 'memory']) {
    assert.equal((await fetch(`${base}/admin/agent/${endpoint}`)).status, 401);
    assert.equal((await fetch(`${base}/admin/agent/${endpoint}?token=read-only-test-token`)).status, 401);
    assert.equal((await fetch(`${base}/admin/agent/${endpoint}`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  }
  assert.equal((await fetch(`${base}/admin/agent/memory`, { headers: { Authorization: 'Bearer state-test-only' } })).status, 401);
  assert.equal((await fetch(`${base}/v1/agent/context`, { headers: { Authorization: 'Bearer read-only-test-token' } })).status, 401);
  assert.equal((await fetch(`${base}/v1/agent/operations`, { method: 'POST', headers: { Authorization: 'Bearer read-only-test-token', 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  const headers = { Authorization: 'Bearer read-only-test-token' };
  const live = await fetch(`${base}/admin/agent/status`, { headers });
  assert.equal(live.status, 200);
  assert.equal(live.headers.get('cache-control'), 'no-store');
  const liveState = await live.json();
  assert.equal(liveState.taskCount, 1);
  assert.equal(liveState.activityCount, 1);
  assert.equal(JSON.stringify(liveState).includes('共享核心记忆'), false);
  const memories = await fetch(`${base}/admin/agent/memory`, { headers });
  assert.equal(memories.status, 200);
  assert.ok((await memories.json()).memories.includes('共享核心记忆'));
  assert.equal((await fetch(`${base}/admin/agent/memory`, { method: 'POST', headers })).status, 404);
  await waitFor(async () => JSON.parse(fs.readFileSync(path.join(dir, 'autonomous_state.json'), 'utf8')).activities[0].eventStatus === 'recorded');
  assert.equal((await fetch(`${base}/v1/agent/context`)).status, 401);
  const stateHeaders = { Authorization: 'Bearer state-test-only', 'Content-Type': 'application/json' };
  const context = await (await fetch(`${base}/v1/agent/context`, { headers: stateHeaders })).json();
  const saved = await fetch(`${base}/v1/agent/operations`, { method: 'POST', headers: stateHeaders, body: JSON.stringify({ requestId: 'integration_save', expectedRevision: context.revision, operations: [
    { type: 'task', id: 'review', status: 'cancelled', evidence: '用户取消', nextStep: '' },
    { type: 'memory', id: 'study', content: '新确认的学习记忆', source: '用户明确要求' }
  ] }) });
  assert.equal(saved.status, 200);
  const verified = await (await fetch(`${base}/v1/agent/context`, { headers: stateHeaders })).json();
  assert.equal(verified.tasks[0].status, 'cancelled');
  assert.equal(verified.memoryEntries[0].content, '新确认的学习记忆');
  const sharedReadback = await fetch(`${base}/admin/agent/memory`, { headers });
  assert.equal(sharedReadback.status, 200);
  assert.ok((await sharedReadback.json()).memories.includes('新确认的学习记忆'));
  for (let i = 0; i < 27; i++) assert.equal((await fetch(`${base}/admin/agent/status`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/admin/agent/status`, { headers })).status, 429);
  await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'mock', stream: false, messages: [{ role: 'user', content: '记得刚才的约定吗' }] }) });
  assert.ok(chatRequest.messages.some(m => String(m.content).includes('新确认的学习记忆')));
  assert.ok(chatRequest.messages.some(m => String(m.content).includes('cancelled')));
});
