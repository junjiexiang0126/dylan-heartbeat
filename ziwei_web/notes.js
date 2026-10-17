'use strict';
// 备忘录与日程：只做转发，不存东西。真正的内容在原生侧（/ziwei/web/memos、/ziwei/web/schedule）。
// 规矩：字段白名单、大小上限、原样透传，绝不在这里改她写的字。
const { HermesClient } = require('./hermes_client');

const LIMIT = 8192;
const ID = '([a-f0-9]{16})';

function createNotes() {
  const client = new HermesClient();
  return async (req, res, url) => {
    const json = (status, value) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(value));
    };
    const path = url.pathname;
    const isMemo = path === '/api/memos' || new RegExp('^/api/memos/' + ID + '$').test(path);
    const isSchedule = path === '/api/schedule' || new RegExp('^/api/schedule/' + ID + '$').test(path);
    if (!isMemo && !isSchedule) return json(404, { error: 'not_found' });

    const memoMatch = new RegExp('^/api/memos/' + ID + '$').exec(path);
    const scheduleMatch = new RegExp('^/api/schedule/' + ID + '$').exec(path);
    const itemId = (memoMatch || scheduleMatch)?.[1] || null;

    // 只允许这几个查询参数，超长一律拒
    const allowed = isMemo ? ['q', 'limit'] : ['days'];
    const query = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
      if (!allowed.includes(key) || value.length > 200) return json(400, { error: 'invalid_query' });
      query.set(key, value);
    }

    const route = '/ziwei/web' + path.slice(4) + (query.toString() ? '?' + query : '');
    const method = req.method;

    try {
      if (method === 'GET' && !itemId) {
        const value = await client.json(route);
        return json(200, value);
      }
      if (method === 'POST' && !itemId) {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'invalid_body' });
        const fields = isMemo ? ['text'] : ['date', 'time', 'text'];
        if (Object.keys(body).some((k) => !fields.includes(k))) return json(400, { error: 'invalid_body' });
        const value = await client.json(route, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return json(201, value);
      }
      if (method === 'PATCH' && itemId) {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'invalid_body' });
        const fields = isMemo ? ['text'] : ['done'];
        if (Object.keys(body).some((k) => !fields.includes(k))) return json(400, { error: 'invalid_body' });
        const value = await client.json(route, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return json(200, value);
      }
      if (method === 'DELETE' && itemId) {
        const value = await client.json(route, { method: 'DELETE' });
        return json(200, value);
      }
      return json(405, { error: 'method_not_allowed' });
    } catch (e) {
      const code = String(e && e.message || '');
      if (/not_found/.test(code)) return json(404, { error: 'not_found' });
      return json(502, { error: 'native_unavailable' });
    }
  };
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMIT) throw Error('body_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = { createNotes };
