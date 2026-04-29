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

console.log('Starting backend...');
console.log('Environment Check:', {
  PORT: process.env.PORT,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID ? 'SET' : 'MISSING',
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET ? 'SET' : 'MISSING',
  DISCORD_REDIRECT_URI: process.env.DISCORD_REDIRECT_URI ? 'SET' : 'MISSING',
  SESSION_SECRET: process.env.SESSION_SECRET ? 'SET' : 'MISSING',
});

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

const getMe = (req) => {
  const token = req.cookies['blog_session'];
  const session = decodeSession(token);
  if (!session) return null;
  const users = loadJson(usersFile, {});
  return users[session.discordId] || null;
};

const requireAuth = (req, res, next) => {
  const user = getMe(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
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

    const settings = loadJson(settingsFile, { requireApproval: true, allowedGuildId: '' });
    const users = loadJson(usersFile, {});
    
    const isFirstUser = Object.keys(users).length === 0;
    const inAllowedGuild = settings.allowedGuildId ? userGuilds.some(g => g.id === settings.allowedGuildId) : false;
    
    let defaultStatus = settings.requireApproval ? 'pending' : 'approved';
    
    // If user is in the allowed guild, auto-approve them regardless of the general setting
    if (settings.allowedGuildId && inAllowedGuild) {
      defaultStatus = 'approved';
    } else if (settings.allowedGuildId && !inAllowedGuild) {
      // If not in the guild and a guild is required, we can either deny or keep pending.
      // Keeping it 'pending' allows for the "and/or" manual approval the user requested.
      defaultStatus = settings.requireApproval ? 'pending' : 'denied';
    }

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

app.get('/api/auth/me', (req, res) => {
  const user = getMe(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ user });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('blog_session');
  res.json({ success: true });
});

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
    if (!blog) return res.status(404).json({ error: 'Post not found' });
    const markdownFile = path.join(__dirname, 'blogs', path.basename(blog.file));
    if (fs.existsSync(markdownFile)) res.sendFile(markdownFile);
    else res.status(404).json({ error: 'Markdown not found' });
  } else {
    res.status(404).json({ error: 'Posts index not found' });
  }
});

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

// Blog Management Endpoints
app.get('/api/admin/blogs', requireAuth, requireAdmin, (req, res) => {
  const indexFile = path.join(dbDir, 'index.json');
  const data = loadJson(indexFile, []);
  res.json(data);
});

app.get('/api/admin/blogs/:id', requireAuth, requireAdmin, (req, res) => {
  const indexFile = path.join(dbDir, 'index.json');
  const data = loadJson(indexFile, []);
  const blog = data.find(b => b.id === req.params.id);
  if (!blog) return res.status(404).json({ error: 'Blog not found' });
  
  const content = fs.readFileSync(path.join(dbDir, blog.file), 'utf-8');
  res.json({ ...blog, content });
});

app.post('/api/admin/blogs', requireAuth, requireAdmin, (req, res) => {
  const { id, title, date, content } = req.body;
  if (!id || !title || !date || !content) return res.status(400).json({ error: 'Missing fields' });

  const indexFile = path.join(dbDir, 'index.json');
  const data = loadJson(indexFile, []);
  
  const fileName = `${id}.md`;
  fs.writeFileSync(path.join(dbDir, fileName), content);

  const existingIdx = data.findIndex(b => b.id === id);
  const blogEntry = { id, title, date, file: fileName };

  if (existingIdx >= 0) data[existingIdx] = blogEntry;
  else data.push(blogEntry);

  saveJson(indexFile, data);
  res.json({ success: true });
});

app.delete('/api/admin/blogs/:id', requireAuth, requireAdmin, (req, res) => {
  const indexFile = path.join(dbDir, 'index.json');
  let data = loadJson(indexFile, []);
  const blog = data.find(b => b.id === req.params.id);
  
  if (blog) {
    const filePath = path.join(dbDir, blog.file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    data = data.filter(b => b.id !== req.params.id);
    saveJson(indexFile, data);
  }
  
  res.json({ success: true });
});

// Handle any other /api/* routes that didn't match above to avoid returning HTML
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// Serve ALL static files from dist
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback to index.html for SPA routing (only for non-API, non-file requests)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Blog backend running on port ${port}`);
});
