const path = require('path');
const { createHash, timingSafeEqual } = require('crypto');
const { readState, readMemories, acquireLock } = require('./autonomous_agent');
const { writeJsonAtomicSync } = require('./runtime_paths');

function fail(status, message) { throw Object.assign(Error(message), { statusCode: status }); }
function value(x, max, name) {
  if (typeof x !== 'string' || !x.trim() || x.length > max) fail(400, `Invalid ${name}`);
  return x.trim();
}
function identifier(x) {
  const id = value(x, 80, 'id');
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail(400, 'Invalid id');
  return id;
}
function digest(x) { return createHash('sha256').update(x).digest(); }
function authenticated(header, key) {
  const token = String(header || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return Boolean(key && token && timingSafeEqual(digest(token), digest(key)));
}
function snapshot(dir) {
  const state = readState(dir);
  return { revision: state.revision || 0, tasks: state.tasks, memoryEntries: state.memoryEntries || [], references: readMemories(dir), nextRunAt: state.nextRunAt, lastError: state.lastError || null };
}
function mutate(dir, body, now = new Date()) {
  if (!body || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) fail(400, 'expectedRevision required');
  const requestId = identifier(body.requestId);
  if (!Array.isArray(body.operations) || !body.operations.length || body.operations.length > 10) fail(400, '1 to 10 operations required');
  const hash = digest(JSON.stringify(body)).toString('hex');
  const release = acquireLock(dir);
  if (!release) fail(409, 'Worker busy; read state and retry later');
  try {
    const state = readState(dir);
    const receipts = state.mutationReceipts || [];
    const previous = receipts.find(r => r.requestId === requestId);
    if (previous) {
      if (previous.hash !== hash) fail(409, 'requestId reused with different payload');
      return { ...previous.receipt, replayed: true };
    }
    if ((state.revision || 0) !== body.expectedRevision) fail(409, 'Revision changed; read state before retry');
    state.memoryEntries ||= [];
    const seen = new Set();
    for (const op of body.operations) {
      const id = identifier(op.id);
      const identity = `${op.type}:${id}`;
      if (seen.has(identity)) fail(400, 'Duplicate operation');
      seen.add(identity);
      if (op.type === 'task') {
        if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(op.status)) fail(400, 'Invalid task status');
        const index = state.tasks.findIndex(t => t.id === id);
        const old = state.tasks[index];
        if (['completed', 'cancelled'].includes(old?.status)) fail(409, 'Closed task cannot be changed');
        if (!old && ['completed', 'cancelled'].includes(op.status)) fail(400, 'Cannot close an unknown task');
        const evidence = ['completed', 'cancelled'].includes(op.status) ? value(op.evidence, 1000, 'completion evidence or cancellation instruction') : '';
        if (op.nextStep !== undefined && (typeof op.nextStep !== 'string' || op.nextStep.length > 1000)) fail(400, 'Invalid nextStep');
        const task = { id, title: value(op.title || old?.title, 300, 'title'), status: op.status, nextStep: op.nextStep === undefined ? old?.nextStep || '' : op.nextStep.trim(), evidence, updatedAt: now.toISOString(), source: 'chat_api' };
        if (index < 0) { if (state.tasks.length >= 100) fail(400, 'Task limit reached'); state.tasks.push(task); }
        else state.tasks[index] = task;
      } else if (op.type === 'memory') {
        const entry = { id, content: value(op.content, 2000, 'memory content'), source: value(op.source, 300, 'memory source'), updatedAt: now.toISOString() };
        const index = state.memoryEntries.findIndex(m => m.id === id);
        if (index < 0) state.memoryEntries.push(entry); else state.memoryEntries[index] = entry;
        if (state.memoryEntries.length > 100 || state.memoryEntries.reduce((n, m) => n + m.content.length, 0) > 20000) fail(400, 'Memory limit reached');
      } else fail(400, 'Unsupported operation');
    }
    state.revision = (state.revision || 0) + 1;
    const receipt = { persisted: true, requestId, revision: state.revision, updatedAt: now.toISOString(), changed: body.operations.map(o => ({ type: o.type, id: o.id })) };
    state.mutationReceipts = [...receipts, { requestId, hash, receipt }].slice(-200);
    // One atomic authoritative commit: failed batches never publish partial updates.
    writeJsonAtomicSync(path.join(dir, 'autonomous_state.json'), state);
    return receipt;
  } finally { release(); }
}
function registerAgentPersistence(app, { dir, enabled, key }) {
  let windowStart = 0, requests = 0;
  function guard(req, reply, done) {
    reply.header('Cache-Control', 'no-store');
    if (!enabled()) return reply.code(404).send({ error: 'Agent persistence disabled' });
    if (!authenticated(req.headers.authorization, key())) return reply.code(401).send({ error: 'Bearer authentication required' });
    const now = Date.now();
    if (now - windowStart >= 60000) { windowStart = now; requests = 0; }
    if (++requests > 60) return reply.code(429).header('Retry-After', '60').send({ error: 'Persistence rate limit reached' });
    done();
  }
  app.get('/v1/agent/context', { preHandler: guard }, async (req, reply) => {
    try {
      const result = snapshot(dir);
      req.log.info({ event: 'agent_state_read', revision: result.revision });
      return result;
    } catch { return reply.code(500).send({ error: 'Cannot read persistent state' }); }
  });
  app.post('/v1/agent/operations', { preHandler: guard, bodyLimit: 40000 }, async (req, reply) => {
    try {
      const result = mutate(dir, req.body);
      req.log.info({ event: 'agent_state_persisted', revision: result.revision, replayed: Boolean(result.replayed), changes: result.changed.length });
      return result;
    } catch (error) {
      const status = error.statusCode || 500;
      if (status === 409) reply.header('Retry-After', '5');
      return reply.code(status).send({ error: status === 500 ? 'Cannot persist state' : error.message });
    }
  });
}
module.exports = { mutate, snapshot, authenticated, registerAgentPersistence };
