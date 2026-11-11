const crypto = require('node:crypto');
const { promisify } = require('node:util');
const jwt = require('jsonwebtoken');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'gallery_session';
const USER_SELECT = `SELECT u.id::text, u.username, u.active, u.session_version, r.name AS role,
  COALESCE(array_agg(rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions
  FROM gallery_users u JOIN gallery_roles r ON r.id = u.role_id
  LEFT JOIN gallery_role_permissions rp ON rp.role_id = r.id`;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  const [salt, stored] = encoded.split(':');
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(stored, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function validCredentials(body) {
  return typeof body?.username === 'string' && /^[a-zA-Z0-9_.-]{3,64}$/.test(body.username.trim())
    && typeof body.password === 'string' && body.password.length >= 12 && body.password.length <= 128;
}

function publicUser(user) {
  const { session_version, ...safe } = user;
  return safe;
}

async function initializeAuth(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS gallery_roles (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS gallery_role_permissions (
      role_id INTEGER NOT NULL REFERENCES gallery_roles(id), permission TEXT NOT NULL,
      PRIMARY KEY (role_id, permission)
    );
    CREATE TABLE IF NOT EXISTS gallery_users (
      id BIGSERIAL PRIMARY KEY, username TEXT NOT NULL,
      password_hash TEXT NOT NULL, role_id INTEGER NOT NULL REFERENCES gallery_roles(id),
      active BOOLEAN NOT NULL DEFAULT TRUE, session_version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS gallery_users_username ON gallery_users (lower(username));
    CREATE TABLE IF NOT EXISTS gallery_auth_state (id INTEGER PRIMARY KEY CHECK (id = 1));
    INSERT INTO gallery_roles (name) VALUES ('admin'), ('editor'), ('viewer') ON CONFLICT DO NOTHING;
    INSERT INTO gallery_role_permissions (role_id, permission)
      SELECT id, 'artwork:write' FROM gallery_roles WHERE name IN ('admin', 'editor') ON CONFLICT DO NOTHING;
    INSERT INTO gallery_role_permissions (role_id, permission)
      SELECT id, 'artwork:delete' FROM gallery_roles WHERE name = 'admin' ON CONFLICT DO NOTHING;
    INSERT INTO gallery_role_permissions (role_id, permission)
      SELECT id, 'users:manage' FROM gallery_roles WHERE name = 'admin' ON CONFLICT DO NOTHING;
  `);
}

function installAuth(app, pool, options) {
  const { secret, setupToken = secret, ttl = 43200, secure = false } = options;
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure, path: '/' };
  const attempts = new Map();
  const dummyHash = hashPassword(crypto.randomBytes(32).toString('hex'));

  const needsSetup = async () => {
    const result = await pool.query('SELECT EXISTS (SELECT 1 FROM gallery_auth_state) OR EXISTS (SELECT 1 FROM gallery_users) AS initialized');
    return !result.rows[0].initialized;
  };

  async function getSession(request) {
    let payload;
    try {
      const token = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      if (!token) return null;
      payload = jwt.verify(decodeURIComponent(token), secret, { algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || !/^\d+$/.test(payload.sub)) return null;
    } catch {
      return null;
    }
    const result = await pool.query(`${USER_SELECT} WHERE u.id = $1 GROUP BY u.id, r.name`, [payload.sub]);
    const user = result.rows[0];
    return user?.active && user.session_version === payload.version ? user : null;
  }

  function setSession(response, user) {
    const token = jwt.sign({ version: user.session_version }, secret, { subject: user.id, expiresIn: ttl, algorithm: 'HS256' });
    response.cookie(COOKIE, token, { ...cookieOptions, maxAge: ttl * 1000 });
  }

  function requirePermission(permission) {
    return async (request, response, next) => {
      try {
        const user = await getSession(request);
        if (!user) return response.status(401).json({ error: 'Authentication required.' });
        if (!user.permissions.includes(permission)) return response.status(403).json({ error: 'Permission denied.' });
        request.user = user;
        next();
      } catch (error) { next(error); }
    };
  }

  app.use('/api', (request, response, next) => {
    if (request.path.startsWith('/auth') || request.path.startsWith('/users') || request.path.startsWith('/roles')) response.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.get('X-Gallery-Request') !== '1') {
      return response.status(403).json({ error: 'Permission denied.' });
    }
    next();
  });

  function rateLimit(request, response, next) {
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.expires <= now) attempts.delete(key);
    const key = request.ip;
    const entry = attempts.get(key) || { count: 0, expires: now + 15 * 60 * 1000 };
    if (entry.count >= 10 || (!attempts.has(key) && attempts.size >= 10000)) {
      response.set('Retry-After', '900');
      return response.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    entry.count += 1;
    attempts.set(key, entry);
    next();
  }

  app.get('/api/auth/session', async (request, response) => {
    const user = await getSession(request);
    response.json({ configured: true, setupRequired: await needsSetup(), authenticated: Boolean(user), user: user ? publicUser(user) : null });
  });

  app.post('/api/auth/setup', rateLimit, async (request, response) => {
    const providedToken = crypto.createHash('sha256').update(String(request.body?.setupToken || '')).digest();
    const expectedToken = crypto.createHash('sha256').update(setupToken).digest();
    if (!crypto.timingSafeEqual(providedToken, expectedToken)) return response.status(403).json({ error: 'Invalid setup token.' });
    if (!validCredentials(request.body)) return response.status(400).json({ error: 'Use a 3-64 character username and a 12-128 character password.' });
    const passwordHash = await hashPassword(request.body.password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(684291)');
      const initialized = await client.query('SELECT EXISTS (SELECT 1 FROM gallery_auth_state) OR EXISTS (SELECT 1 FROM gallery_users) AS initialized');
      if (initialized.rows[0].initialized) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: 'Administrator setup is already complete.' });
      }
      const created = await client.query(`INSERT INTO gallery_users (username, password_hash, role_id)
        SELECT $1, $2, id FROM gallery_roles WHERE name = 'admin' RETURNING id`, [request.body.username.trim(), passwordHash]);
      await client.query('INSERT INTO gallery_auth_state (id) VALUES (1)');
      const result = await client.query(`${USER_SELECT} WHERE u.id = $1 GROUP BY u.id, r.name`, [created.rows[0].id]);
      await client.query('COMMIT');
      setSession(response, result.rows[0]);
      response.status(201).json({ authenticated: true, user: publicUser(result.rows[0]) });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });

  app.post('/api/auth/login', rateLimit, async (request, response) => {
    const username = typeof request.body?.username === 'string' ? request.body.username.trim() : '';
    const password = typeof request.body?.password === 'string' && request.body.password.length <= 128 ? request.body.password : '';
    const result = await pool.query(`SELECT password_hash FROM gallery_users WHERE lower(username) = lower($1)`, [username]);
    const valid = await verifyPassword(password, result.rows[0]?.password_hash || await dummyHash);
    const users = await pool.query(`${USER_SELECT} WHERE lower(u.username) = lower($1) GROUP BY u.id, r.name`, [username]);
    const user = users.rows[0];
    if (!valid || !user?.active) return response.status(401).json({ error: 'Invalid username or password.' });
    setSession(response, user);
    response.json({ authenticated: true, user: publicUser(user) });
  });

  app.post('/api/auth/logout', async (request, response) => {
    const user = await getSession(request);
    if (user) await pool.query('UPDATE gallery_users SET session_version = session_version + 1 WHERE id = $1', [user.id]);
    response.clearCookie(COOKIE, cookieOptions);
    response.sendStatus(204);
  });

  app.get('/api/roles', requirePermission('users:manage'), async (request, response) => {
    const result = await pool.query(`SELECT r.name, COALESCE(array_agg(rp.permission) FILTER (WHERE rp.permission IS NOT NULL), '{}') AS permissions
      FROM gallery_roles r LEFT JOIN gallery_role_permissions rp ON rp.role_id = r.id GROUP BY r.id ORDER BY r.name`);
    response.json(result.rows);
  });

  app.get('/api/users', requirePermission('users:manage'), async (request, response) => {
    const result = await pool.query(`${USER_SELECT} GROUP BY u.id, r.name ORDER BY lower(u.username)`);
    response.json(result.rows.map(publicUser));
  });

  app.post('/api/users', requirePermission('users:manage'), async (request, response) => {
    if (!validCredentials(request.body)) return response.status(400).json({ error: 'Use a 3-64 character username and a 12-128 character password.' });
    const role = await pool.query('SELECT id FROM gallery_roles WHERE name = $1', [request.body.role]);
    if (!role.rowCount) return response.status(400).json({ error: 'Invalid role.' });
    try {
      const result = await pool.query(`INSERT INTO gallery_users (username, password_hash, role_id) VALUES ($1, $2, $3) RETURNING id::text`,
        [request.body.username.trim(), await hashPassword(request.body.password), role.rows[0].id]);
      response.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') return response.status(409).json({ error: 'Username already exists.' });
      throw error;
    }
  });

  app.patch('/api/users/:id', requirePermission('users:manage'), async (request, response) => {
    if (!/^\d+$/.test(request.params.id) || typeof request.body?.active !== 'boolean') return response.status(400).json({ error: 'Invalid user settings.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(684291)');
      const target = await client.query(`${USER_SELECT} WHERE u.id = $1 GROUP BY u.id, r.name`, [request.params.id]);
      const role = await client.query('SELECT id FROM gallery_roles WHERE name = $1', [request.body.role]);
      let error;
      if (!target.rowCount) error = [404, 'User was not found.'];
      else if (!role.rowCount) error = [400, 'Invalid role.'];
      else if (target.rows[0].active && target.rows[0].role === 'admin' && (!request.body.active || request.body.role !== 'admin')) {
        const admins = await client.query(`SELECT count(*)::int AS count FROM gallery_users u JOIN gallery_roles r ON r.id = u.role_id WHERE u.active AND r.name = 'admin'`);
        if (admins.rows[0].count <= 1) error = [409, 'Keep at least one active administrator.'];
      }
      if (error) {
        await client.query('ROLLBACK');
        return response.status(error[0]).json({ error: error[1] });
      }
      await client.query('UPDATE gallery_users SET role_id = $2, active = $3, session_version = session_version + 1 WHERE id = $1', [request.params.id, role.rows[0].id, request.body.active]);
      await client.query('COMMIT');
      response.sendStatus(204);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  });
  return { requirePermission };
}

module.exports = { initializeAuth, installAuth, hashPassword, verifyPassword, validCredentials };