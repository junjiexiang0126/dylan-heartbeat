const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Fastify = require('fastify');
const { mutate, snapshot, registerAgentPersistence } = require('../agent_persistence');
const { runAutonomousCycle, readState, readMemories, parseDecision } = require('../autonomous_agent');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-persistence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function request(revision, id, operations) { return { expectedRevision: revision, requestId: id, operations }; }
const task = { type: 'task', id: 'review', title: '复习', status: 'pending', nextStep: '写提纲' };
const memory = { type: 'memory', id: 'study_style', content: '先写骨架再展开', source: '用户明确要求保存' };
test('chat writes survive restart, replay is idempotent and both contexts read current memory', t => {
  const dir = fixture(t);
  const body = request(0, 'save_1', [task, memory]);
  const result = mutate(dir, body);
  assert.equal(result.revision, 1);
  assert.equal(snapshot(dir).tasks[0].status, 'pending');
  assert.match(readMemories(dir), /先写骨架再展开/);
  assert.equal(mutate(dir, body).replayed, true);
  assert.equal(readState(dir).mutationReceipts.length, 1);
  assert.throws(() => mutate(dir, { ...body, operations: [task] }), /different payload/);
  assert.throws(() => mutate(dir, request(0, 'save_2', [memory])), /Revision changed/);
  mutate(dir, request(1, 'cancel_1', [{ type: 'task', id: 'review', status: 'cancelled', nextStep: '', evidence: '用户说全部不做了' }]));
  assert.equal(snapshot(dir).tasks[0].status, 'cancelled');
  assert.throws(() => mutate(dir, request(2, 'reopen', [task])), /Closed task/);
  assert.throws(() => parseDecision(JSON.stringify({ action: 'continue_task', reason: 'x', output: 'x', tasks: [{ ...task, status: 'completed' }] }), snapshot(dir).tasks), /Closed task/);
});
test('invalid batch and corrupt state never overwrite saved data; completion needs evidence', t => {
  const dir = fixture(t);
  assert.throws(() => mutate(dir, request(0, 'invalid', [memory, { type: 'shell', id: 'x' }])), /Unsupported/);
  assert.equal(fs.existsSync(path.join(dir, 'autonomous_state.json')), false);
  mutate(dir, request(0, 'task_1', [task]));
  assert.throws(() => mutate(dir, request(1, 'finish_1', [{ ...task, status: 'completed' }])), /evidence/);
  assert.equal(readState(dir).tasks[0].status, 'pending');
  mutate(dir, request(1, 'finish_2', [{ ...task, status: 'completed', evidence: '用户确认已写完提纲' }]));
  assert.equal(readState(dir).tasks[0].status, 'completed');
  fs.writeFileSync(path.join(dir, 'autonomous_state.json'), 'broken');
  assert.throws(() => mutate(dir, request(2, 'corrupt', [memory])));
  assert.equal(fs.readFileSync(path.join(dir, 'autonomous_state.json'), 'utf8'), 'broken');
});
test('worker and chat serialize writes and a later cycle preserves chat memory and closed tasks', async t => {
  const dir = fixture(t);
  mutate(dir, request(0, 'setup', [task, memory]));
  let finish;
  const cycle = runAutonomousCycle({ dir, model: messages => {
    assert.ok(messages.some(m => m.content.includes('先写骨架再展开')));
    return new Promise(resolve => { finish = resolve; });
  }, push: async () => ({ ok: true }), recordEvent: async () => {} });
  assert.throws(() => mutate(dir, request(1, 'busy', [memory])), /Worker busy/);
  finish(JSON.stringify({ action: 'diary', reason: '记录', diary: '日记', tasks: [], notification: null }));
  await cycle;
  assert.equal(readState(dir).revision, 2);
  assert.equal(readState(dir).memoryEntries.length, 1);
  mutate(dir, request(2, 'cancel', [{ ...task, status: 'cancelled', evidence: '用户取消' }]));
  await runAutonomousCycle({ dir, now: new Date(Date.now() + 3600001), model: async messages => {
    assert.equal(JSON.parse(messages.at(-1).content).tasks[0].status, 'cancelled');
    return JSON.stringify({ action: 'rest', reason: '无待办', tasks: [], notification: null });
  }, push: async () => ({ ok: true }), recordEvent: async () => {} });
  assert.equal(readState(dir).tasks[0].status, 'cancelled');
});
test('HTTP API is opt in, requires dedicated Bearer even locally, and returns verifiable state', async t => {
  const dir = fixture(t);
  const app = Fastify();
  t.after(() => app.close());
  let enabled = false;
  registerAgentPersistence(app, { dir, enabled: () => enabled, key: () => 'state-test-only' });
  assert.equal((await app.inject({ url: '/v1/agent/context' })).statusCode, 404);
  enabled = true;
  assert.equal((await app.inject({ url: '/v1/agent/context' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/v1/agent/context?token=state-test-only' })).statusCode, 401);
  const headers = { authorization: 'Bearer state-test-only' };
  const result = await app.inject({ method: 'POST', url: '/v1/agent/operations', headers, payload: request(0, 'http_1', [task, memory]) });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().persisted, true);
  const read = await app.inject({ url: '/v1/agent/context', headers });
  assert.equal(read.headers['cache-control'], 'no-store');
  assert.equal(read.json().memoryEntries[0].content, memory.content);
  const collision = await app.inject({ method: 'POST', url: '/v1/agent/operations', headers, payload: request(0, 'http_2', [memory]) });
  assert.equal(collision.statusCode, 409);
});

test('missing configured key fails closed and authenticated reads are rate limited', async t => {
  const dir = fixture(t);
  const app = Fastify();
  t.after(() => app.close());
  let key = '';
  registerAgentPersistence(app, { dir, enabled: () => true, key: () => key });
  assert.equal((await app.inject({ url: '/v1/agent/context', headers: { authorization: 'Bearer test' } })).statusCode, 401);
  key = 'test';
  for (let i = 0; i < 60; i++) assert.equal((await app.inject({ url: '/v1/agent/context', headers: { authorization: 'Bearer test' } })).statusCode, 200);
  const limited = await app.inject({ url: '/v1/agent/context', headers: { authorization: 'Bearer test' } });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['retry-after'], '60');
});
