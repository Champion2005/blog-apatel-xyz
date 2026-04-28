import express from 'express';
import cookieParser from 'cookie-parser';
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cookieParser());
app.use(express.json());

// Load or create databases
const dbDir = path.join(__dirname, 'blogs');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const usersFile = path.join(dbDir, 'users.json');
const settingsFile = path.join(dbDir, 'settings.json');

const loadJson = (file, defaultData) => {
  if (fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return defaultData; }
  }
  fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
  return defaultData;
};
const saveJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

const sessionSecret = process.env.SESSION_SECRET || 'insecure_fallback_secret_change_me';

const secureEq = (a, b) => {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
};

const signPayload = (payload64) =>
  createHmac('sha256', sessionSecret).update(payload64).digest('base64url');

const encodeSession = (payload) => {
  const payload64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payload64}.${signPayload(payload64)}`;
};

const decodeSession = (token) => {
  if (!token) return null;
  const [payload64, signature] = token.split('.');
  if (!payload64 || !signature) return null;
  if (!secureEq(signPayload(payload64), signature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payload64, 'base64url').toString('utf-8'));
    if (!payload?.exp || payload.exp < Date.now()) return null;
    if (!payload?.discordId) return null;
    return payload;
  } catch {
    return null;
  }
};

const requireAuth = (req, res, next) => {
  const token = req.cookies['blog_session'];
  const session = decodeSession(token);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  const users = loadJson(usersFile, {});
  const user = users[session.discordId];
  if (!user) return res.status(401).json({ error: 'User not found' });
  req.user = user;
  next();
};

const checkAccess = (req, res, next) => {
  const user = req.user;
  if (user.role === 'admin') return next();
  if (user.status !== 'approved') return res.status(403).json({ error: 'Your account is pending approval or denied.' });
  next();
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};

// OAuth Config
const clientId = process.env.DISCORD_CLIENT_ID;
const clientSecret = process.env.DISCORD_CLIENT_SECRET;
const redirectUri = process.env.DISCORD_REDIRECT_URI;
const discordApi = 'https://discord.com/api';

app.get('/api/auth/discord', (req, res) => {
  if (!clientId || !clientSecret) return res.status(500).json({ error: 'Discord OAuth not configured.' });
  const state = randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, { httpOnly: true, maxAge: 1000 * 60 * 10 });
  const url = new URL(`${discordApi}/oauth2/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds');
  url.searchParams.set('state', state);
  res.json({ url: url.toString() });
});

app.get('/auth/discord/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const expectedState = req.cookies['oauth_state'];
    if (!code || !state || state !== expectedState) return res.status(400).send('Invalid state or missing code');

    const tokenRes = await fetch(`${discordApi}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    
    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const tokenData = await tokenRes.json();
    
    const userRes = await fetch(`${discordApi}/users/@me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) throw new Error('Failed to fetch user');
    const identity = await userRes.json();

    const guildsRes = await fetch(`${discordApi}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const userGuilds = await guildsRes.json();

    // Check against settings
    const settings = loadJson(settingsFile, { requireApproval: true, allowedGuildId: '' });
    const users = loadJson(usersFile, {});
    
    const isFirstUser = Object.keys(users).length === 0;
    const inAllowedGuild = settings.allowedGuildId ? userGuilds.some(g => g.id === settings.allowedGuildId) : true;
    
    let defaultStatus = 'pending';
    if (!settings.requireApproval) defaultStatus = 'approved';
    if (settings.allowedGuildId && inAllowedGuild && !settings.requireApproval) defaultStatus = 'approved';
    if (settings.allowedGuildId && !inAllowedGuild) defaultStatus = 'denied';

    const existingUser = users[identity.id];
    const role = existingUser ? existingUser.role : (isFirstUser ? 'admin' : 'user');
    const status = existingUser ? existingUser.status : (isFirstUser ? 'approved' : defaultStatus);

    users[identity.id] = {
      id: identity.id,
      username: identity.username,
      avatar: identity.avatar,
      role,
      status
    };
    saveJson(usersFile, users);

    const sessionToken = encodeSession({
      discordId: identity.id,
      exp: Date.now() + 1000 * 60 * 60 * 24 * 7 // 7 days
    });

    res.cookie('blog_session', sessionToken, { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7, path: '/' });
    res.clearCookie('oauth_state');
    res.redirect('/');
  } catch (error) {
    console.error(error);
    res.status(500).send('OAuth Error');
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('blog_session');
  res.json({ success: true });
});

// Blog Endpoints
app.get('/api/blogs', requireAuth, checkAccess, (req, res) => {
  const indexFile = path.join(__dirname, 'blogs', 'index.json');
  if (fs.existsSync(indexFile)) {
    const data = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    res.json(data);
  } else {
    res.json([]);
  }
});

app.get('/api/blogs/:id', requireAuth, checkAccess, (req, res) => {
  const { id } = req.params;
  const indexFile = path.join(__dirname, 'blogs', 'index.json');
  if (fs.existsSync(indexFile)) {
    const data = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    const blog = data.find(b => b.id === id);
    if (!blog) return res.status(404).send('Post not found');
    const markdownFile = path.join(__dirname, 'blogs', path.basename(blog.file));
    if (fs.existsSync(markdownFile)) res.sendFile(markdownFile);
    else res.status(404).send('Markdown not found');
  } else {
    res.status(404).send('Posts index not found');
  }
});

// Admin Endpoints
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const users = loadJson(usersFile, {});
  res.json(Object.values(users));
});

app.post('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const users = loadJson(usersFile, {});
  const user = users[req.params.id];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (req.body.role) user.role = req.body.role;
  if (req.body.status) user.status = req.body.status;
  saveJson(usersFile, users);
  res.json(user);
});

app.get('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
  res.json(loadJson(settingsFile, { requireApproval: true, allowedGuildId: '' }));
});

app.post('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
  const settings = {
    requireApproval: !!req.body.requireApproval,
    allowedGuildId: req.body.allowedGuildId || ''
  };
  saveJson(settingsFile, settings);
  res.json(settings);
});

// Serve frontend
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Blog backend running on port ${port}`);
});
