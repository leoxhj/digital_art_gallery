const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const { initializeAuth, installAuth, hashPassword, verifyPassword, validCredentials } = require('../auth');

test('passwords are salted and credentials are validated', async () => {
  const password = 'a-long-test-password';
  const first = await hashPassword(password);
  assert.notEqual(first, await hashPassword(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('wrong-password', first), false);
  assert.equal(validCredentials({ username: 'admin', password }), true);
  assert.equal(validCredentials({ username: 'admin', password: 'short' }), false);
  assert.equal(validCredentials({ username: '<admin>', password }), false);
});

test('database setup, ACL, user management and session invalidation', { skip: process.env.AUTH_DATABASE_TESTS !== '1' }, async () => {
  require('dotenv').config({ quiet: true });
  const config = process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
    host: process.env.PGHOST, port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD,
  };
  const schema = `auth_test_${crypto.randomBytes(8).toString('hex')}`;
  const owner = new Pool(config);
  let pool;
  let server;
  try {
    await owner.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ ...config, options: `-c search_path=${schema}` });
    await initializeAuth(pool);
    await initializeAuth(pool);
    const app = express();
    app.use(express.json());
    const { requirePermission } = installAuth(app, pool, { secret: 'test-secret-with-more-than-32-characters', setupToken: 'test-setup-token' });
    app.post('/api/write', requirePermission('artwork:write'), (request, response) => response.sendStatus(204));
    app.delete('/api/write', requirePermission('artwork:delete'), (request, response) => response.sendStatus(204));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (path, method = 'GET', body, cookie) => fetch(`${base}${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Gallery-Request': '1', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await request('/api/auth/session')).json()).setupRequired, true);
    assert.equal((await request('/api/write', 'POST')).status, 401);
    assert.equal((await request('/api/auth/setup', 'POST', { username: 'admin', password: 'long-admin-password', setupToken: 'wrong' })).status, 403);
    const setup = { username: 'admin', password: 'long-admin-password', setupToken: 'test-setup-token' };
    const setupResults = await Promise.all([request('/api/auth/setup', 'POST', setup), request('/api/auth/setup', 'POST', setup)]);
    assert.deepEqual(setupResults.map((response) => response.status).sort(), [201, 409]);
    const adminCookie = cookieOf(setupResults.find((response) => response.status === 201));
    assert.equal((await (await request('/api/auth/session')).json()).setupRequired, false);
    assert.equal((await request('/api/auth/login', 'POST', { username: 'admin', password: 'wrong' })).status, 401);
    assert.equal((await request('/api/users', 'POST', { username: 'editor', password: 'long-editor-password', role: 'editor' }, adminCookie)).status, 201);
    assert.equal((await request('/api/users', 'POST', { username: 'viewer', password: 'long-viewer-password', role: 'viewer' }, adminCookie)).status, 201);
    assert.equal((await request('/api/users', 'POST', { username: 'VIEWER', password: 'long-viewer-password', role: 'viewer' }, adminCookie)).status, 409);
    assert.equal((await request('/api/users', 'POST', { username: 'invalid', password: 'long-viewer-password', role: 'owner' }, adminCookie)).status, 400);
    const editorCookie = cookieOf(await request('/api/auth/login', 'POST', { username: 'editor', password: 'long-editor-password' }));
    const viewerCookie = cookieOf(await request('/api/auth/login', 'POST', { username: 'viewer', password: 'long-viewer-password' }));
    assert.equal((await request('/api/write', 'POST', {}, editorCookie)).status, 204);
    assert.equal((await request('/api/write', 'DELETE', {}, editorCookie)).status, 403);
    assert.equal((await request('/api/write', 'POST', {}, viewerCookie)).status, 403);
    assert.equal((await request('/api/users', 'GET', undefined, editorCookie)).status, 403);
    assert.equal((await request('/api/users', 'POST', { username: 'hacker', password: 'long-hacker-password', role: 'admin' }, viewerCookie)).status, 403);
    assert.equal((await request('/api/write', 'DELETE', {}, adminCookie)).status, 204);
    assert.equal((await fetch(`${base}/api/write`, { method: 'POST', headers: { Cookie: adminCookie } })).status, 403);
    const users = await (await request('/api/users', 'GET', undefined, adminCookie)).json();
    assert.equal(users.some((user) => 'password_hash' in user || 'session_version' in user), false);
    const admin = users.find((user) => user.role === 'admin');
    const editor = users.find((user) => user.role === 'editor');
    assert.equal((await request(`/api/users/${admin.id}`, 'PATCH', { role: 'viewer', active: true }, adminCookie)).status, 409);
    assert.equal((await request(`/api/users/${admin.id}`, 'PATCH', { role: 'admin', active: false }, adminCookie)).status, 409);
    assert.equal((await request(`/api/users/${editor.id}`, 'PATCH', { role: 'viewer', active: false }, adminCookie)).status, 204);
    assert.equal((await request('/api/write', 'POST', {}, editorCookie)).status, 401);
    assert.equal((await request('/api/auth/login', 'POST', { username: 'editor', password: 'long-editor-password' })).status, 401);
    assert.equal((await request('/api/auth/logout', 'POST', {}, adminCookie)).status, 204);
    assert.equal((await request('/api/users', 'GET', undefined, adminCookie)).status, 401);
    assert.equal((await request('/api/auth/session', 'GET', undefined, 'gallery_session=%invalid')).status, 200);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (pool) await pool.end();
    await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await owner.end();
  }
});