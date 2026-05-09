import express from 'express';
import cookieParser from 'cookie-parser';
import { createHmac, timingSafeEqual, randomBytes, createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import multer from 'multer';

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

const imagesDir = path.join(dbDir, 'images');
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, imagesDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + path.extname(file.originalname))
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({ storage: storage, fileFilter: fileFilter });

app.use('/images', express.static(imagesDir));

const usersFile = path.join(dbDir, 'users.json');

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

const maybeAuth = (req, res, next) => {
  req.user = getMe(req);
  next();
};

const checkAccess = (req, res, next) => {
  // Approval process removed; all authenticated users have access.
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
  res.cookie('oauth_state', state, { httpOnly: true, maxAge: 1000 * 60 * 10, path: '/', sameSite: 'lax' });
  const url = new URL(`${discordApi}/oauth2/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
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

    const users = loadJson(usersFile, {});
    
    const isFirstUser = Object.keys(users).length === 0;
    const existingUser = users[identity.id];
    const role = existingUser ? existingUser.role : (isFirstUser ? 'admin' : 'user');

    users[identity.id] = {
      id: identity.id,
      username: identity.username,
      avatar: identity.avatar,
      role,
      lastSignIn: Date.now()
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

app.get('/api/blogs', maybeAuth, (req, res) => {
  const indexFile = path.join(__dirname, 'blogs', 'index.json');
  if (fs.existsSync(indexFile)) {
    let data = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    // Filter out drafts for everyone on the public feed
    // Treat any post without a status as 'published' (migration fallback)
    data = data.filter(b => !b.status || b.status === 'published');
    // If not logged in, only show public published blogs
    if (!req.user) {
      data = data.filter(b => b.isPublic);
    }

    // Sort by createdAt descending, fallback to date
    data.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      const timeA = a.createdAt || new Date(a.date).getTime() || 0;
      const timeB = b.createdAt || new Date(b.date).getTime() || 0;
      return timeB - timeA;
    });

    res.json(data);
  } else {
    res.json([]);
  }
});

app.get('/api/blogs/:id', maybeAuth, (req, res) => {
  const { id } = req.params;
  const indexFile = path.join(__dirname, 'blogs', 'index.json');
  if (fs.existsSync(indexFile)) {
    const data = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    const blog = data.find(b => b.id === id);
    if (!blog) return res.status(404).json({ error: 'Post not found' });
    
    // Check if user is allowed to see this
    const isAdmin = req.user?.role === 'admin';
    const isDraft = blog.status === 'draft';

    if (isDraft && !isAdmin) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (!blog.isPublic && !req.user) {
      return res.status(401).json({ error: 'This post is private. Please log in.' });
    }

    if (!blog.views) blog.views = [];
    
    let viewerId = null;
    if (req.user) {
      // Don't track admin views
      if (req.user.role !== 'admin') viewerId = req.user.id;
    } else {
      // Unauthenticated view - track by IP
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      viewerId = `ip:${ip}`;
    }

    if (viewerId && !blog.views.includes(viewerId)) {
      blog.views.push(viewerId);
      saveJson(indexFile, data);
    }

    const markdownFile = path.join(__dirname, 'blogs', path.basename(blog.file));
    if (fs.existsSync(markdownFile)) res.sendFile(markdownFile);
    else res.status(404).json({ error: 'Markdown not found' });
  } else {
    res.status(404).json({ error: 'Posts index not found' });
  }
});

app.post('/api/blogs/:id/like', requireAuth, checkAccess, (req, res) => {
  const { id } = req.params;
  const indexFile = path.join(__dirname, 'blogs', 'index.json');
  if (!fs.existsSync(indexFile)) return res.status(404).json({ error: 'Posts index not found' });

  const data = loadJson(indexFile, []);
  const blog = data.find(b => b.id === id);
  if (!blog) return res.status(404).json({ error: 'Post not found' });

  if (!blog.likes) blog.likes = [];
  const userIdx = blog.likes.indexOf(req.user.id);
  
  if (userIdx > -1) {
    blog.likes.splice(userIdx, 1); // unlike
  } else {
    blog.likes.push(req.user.id); // like
  }
  
  saveJson(indexFile, data);
  res.json({ likes: blog.likes });
});

app.post('/api/blogs/:id/comments', requireAuth, checkAccess, (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Comment content required' });

  const indexFile = path.join(__dirname, 'blogs', 'index.json');
  const data = loadJson(indexFile, []);
  const blog = data.find(b => b.id === id);
  if (!blog) return res.status(404).json({ error: 'Post not found' });

  if (!blog.comments) blog.comments = [];
  
  const userComments = blog.comments.filter(c => c.userId === req.user.id);
  if (userComments.length >= 10 && req.user.role !== 'admin') {
    return res.status(400).json({ error: 'Maximum of 10 comments per post reached.' });
  }
  
  const newComment = {
    id: randomBytes(8).toString('hex'),
    userId: req.user.id,
    username: req.user.username,
    avatar: req.user.avatar,
    content: content.slice(0, 1000), // Basic length limit
    createdAt: Date.now(),
    role: req.user.role
  };

  blog.comments.push(newComment);
  saveJson(indexFile, data);
  res.json(newComment);
});

app.patch('/api/blogs/:id/comments/:commentId', requireAuth, checkAccess, (req, res) => {
  const { id, commentId } = req.params;
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });

  const indexFile = path.join(__dirname, 'blogs', 'index.json');
  const data = loadJson(indexFile, []);
  const blog = data.find(b => b.id === id);
  if (!blog?.comments) return res.status(404).json({ error: 'Comment not found' });

  const comment = blog.comments.find(c => c.id === commentId);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  if (comment.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  comment.content = content.slice(0, 1000);
  comment.updatedAt = Date.now();
  saveJson(indexFile, data);
  res.json(comment);
});

app.delete('/api/blogs/:id/comments/:commentId', requireAuth, checkAccess, (req, res) => {
  const { id, commentId } = req.params;
  const indexFile = path.join(__dirname, 'blogs', 'index.json');
  const data = loadJson(indexFile, []);
  const blog = data.find(b => b.id === id);
  if (!blog?.comments) return res.status(404).json({ error: 'Comment not found' });

  const commentIdx = blog.comments.findIndex(c => c.id === commentId);
  if (commentIdx === -1) return res.status(404).json({ error: 'Comment not found' });

  const comment = blog.comments[commentIdx];
  if (comment.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  blog.comments.splice(commentIdx, 1);
  saveJson(indexFile, data);
  res.json({ success: true });
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
  saveJson(usersFile, users);
  res.json(user);
});

// Blog Management Endpoints
app.get('/api/admin/blogs', requireAuth, requireAdmin, (req, res) => {
  const indexFile = path.join(dbDir, 'index.json');
  const data = loadJson(indexFile, []);
  
  const pinnedPosts = data.filter(b => b.isPinned);
  const regularPosts = data.filter(b => !b.isPinned);

  const sortFn = (a, b) => {
    const timeA = a.createdAt || new Date(a.date).getTime() || 0;
    const timeB = b.createdAt || new Date(b.date).getTime() || 0;
    return timeB - timeA;
  };

  pinnedPosts.sort(sortFn);
  regularPosts.sort(sortFn);
  
  res.json([...pinnedPosts, ...regularPosts]);
});

app.get('/api/admin/blogs/:id', requireAuth, requireAdmin, (req, res) => {
  const indexFile = path.join(dbDir, 'index.json');
  const data = loadJson(indexFile, []);
  const blog = data.find(b => b.id === req.params.id);
  if (!blog) return res.status(404).json({ error: 'Blog not found' });
  
  const content = fs.readFileSync(path.join(dbDir, blog.file), 'utf-8');
  res.json({ ...blog, content });
});

app.post('/api/admin/upload', requireAuth, requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const imageUrl = `/images/${req.file.filename}`;
  res.json({ url: imageUrl });
});

app.get('/api/admin/images', requireAuth, requireAdmin, (req, res) => {
  if (!fs.existsSync(imagesDir)) return res.json([]);
  const files = fs.readdirSync(imagesDir);
  const images = files.map(file => {
    const stats = fs.statSync(path.join(imagesDir, file));
    return {
      filename: file,
      url: `/images/${file}`,
      size: stats.size,
      createdAt: stats.birthtimeMs
    };
  }).sort((a, b) => b.createdAt - a.createdAt);
  res.json(images);
});

app.delete('/api/admin/images/:filename', requireAuth, requireAdmin, (req, res) => {
  const filePath = path.join(imagesDir, req.params.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Image not found' });
  }
});

app.post('/api/admin/images/cleanup', requireAuth, requireAdmin, (req, res) => {
  if (!fs.existsSync(imagesDir)) return res.json({ deletedCount: 0, bytesFreed: 0 });
  
  // 1. Find all images used in markdown files
  const usedImages = new Set();
  const mdFiles = fs.readdirSync(dbDir).filter(f => f.endsWith('.md'));
  
  mdFiles.forEach(file => {
    const content = fs.readFileSync(path.join(dbDir, file), 'utf-8');
    // Match anything that looks like /images/filename.ext
    const matches = content.match(/\/images\/([^\s)"']+)/g);
    if (matches) {
      matches.forEach(match => {
        const filename = match.replace('/images/', '');
        usedImages.add(filename);
      });
    }
  });

  // 2. Iterate over all images in imagesDir and delete if not used
  const allImages = fs.readdirSync(imagesDir);
  let deletedCount = 0;
  let bytesFreed = 0;

  allImages.forEach(file => {
    if (!usedImages.has(file)) {
      const filePath = path.join(imagesDir, file);
      const stats = fs.statSync(filePath);
      bytesFreed += stats.size;
      fs.unlinkSync(filePath);
      deletedCount++;
    }
  });

  res.json({ deletedCount, bytesFreed });
});

app.post('/api/admin/blogs', requireAuth, requireAdmin, (req, res) => {
  const { id, title, date, content } = req.body;
  if (!id || !title || !date || !content) return res.status(400).json({ error: 'Missing fields' });

  const indexFile = path.join(dbDir, 'index.json');
  const data = loadJson(indexFile, []);
  
  const fileName = `${id}.md`;
  fs.writeFileSync(path.join(dbDir, fileName), content);

  const existingIdx = data.findIndex(b => b.id === id);
  const existingBlog = existingIdx >= 0 ? data[existingIdx] : null;
  
  // Logic: 
  // 1. If manual createdAt was sent (from the Admin UI input), use it.
  // 2. If it's a NEW post and is being published, use now.
  // 3. If it was a DRAFT and is now being PUBLISHED, update to now.
  // 4. Otherwise preserve existing.
  let createdAt = existingBlog && existingBlog.createdAt ? existingBlog.createdAt : Date.now();
  if (req.body.createdAt) {
    createdAt = req.body.createdAt; // Manual override from UI
  } else if (!existingBlog && req.body.status === 'published') {
    createdAt = Date.now();
  } else if (existingBlog && existingBlog.status === 'draft' && req.body.status === 'published') {
    createdAt = Date.now();
  }

  const views = existingBlog && existingBlog.views ? existingBlog.views : [];
  const likes = existingBlog && existingBlog.likes ? existingBlog.likes : [];
  const comments = existingBlog && existingBlog.comments ? existingBlog.comments : [];
  const isPublic = !!req.body.isPublic;
  const status = req.body.status === 'published' ? 'published' : 'draft';
  const isPinned = !!req.body.isPinned;

  if (isPinned) {
    const pinnedCount = data.filter(b => b.isPinned && b.id !== id).length;
    if (pinnedCount >= 3) {
      return res.status(400).json({ error: 'Maximum of 3 pinned posts allowed' });
    }
  }

  const blogEntry = { id, title, date, createdAt, file: fileName, views, likes, isPublic, status, comments, isPinned };

  if (existingIdx >= 0) data[existingIdx] = blogEntry;
  else data.push(blogEntry);

  saveJson(indexFile, data);

  // Notify Discord via Webhook if it's being published
  const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1501037122046529636/VyYNodK28K7SP7evvD2SFnOty7ZrYKmyh7PWSOWIaawY3SjTKBzmnrUyOywBpHxQXNK_';
  
  const wasDraft = !existingBlog || existingBlog.status === 'draft';
  const isNowPublished = status === 'published';

  if (wasDraft && isNowPublished) {
    const blogUrl = `https://blog.apatel.xyz/post/${id}`;
    
    // Only include description/preview if it's a public post
    const embed = {
      title: title,
      url: blogUrl,
      color: isPublic ? 5814783 : 16731136, // Purple for public, Orange for private
      fields: [
        { name: 'Slug', value: id, inline: true },
        { name: 'Date', value: date, inline: true },
        { name: 'Visibility', value: isPublic ? '🌍 Public' : '🔒 Private (Login Required)', inline: true }
      ],
      footer: { text: 'blog.apatel.xyz' },
      timestamp: new Date().toISOString()
    };

    if (isPublic) {
      embed.description = content.slice(0, 200) + '...';
    }

    fetch(discordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: isPublic ? `🚀 **New Public Blog Post Published!**` : `🔑 **New Private Blog Post Published!**`,
        embeds: [embed]
      })
    }).catch(err => console.error('Failed to send Discord webhook:', err));
  }

  res.json({ success: true });
});

app.patch('/api/admin/blogs/:id', requireAuth, requireAdmin, (req, res) => {
  const indexFile = path.join(dbDir, 'index.json');
  const data = loadJson(indexFile, []);
  const existingIdx = data.findIndex(b => b.id === req.params.id);
  if (existingIdx === -1) return res.status(404).json({ error: 'Blog not found' });
  
  const blog = data[existingIdx];
  if (req.body.isPinned !== undefined) {
    const isPinned = !!req.body.isPinned;
    if (isPinned) {
      const pinnedCount = data.filter(b => b.isPinned && b.id !== blog.id).length;
      if (pinnedCount >= 3) {
        return res.status(400).json({ error: 'Maximum of 3 pinned posts allowed' });
      }
    }
    blog.isPinned = isPinned;
  }
  if (req.body.isPublic !== undefined) blog.isPublic = !!req.body.isPublic;
  if (req.body.status !== undefined) blog.status = req.body.status;
  
  saveJson(indexFile, data);
  res.json(blog);
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

// Serve static files with proper MIME types
app.use(express.static(path.join(__dirname, 'dist'), {
  index: false // Don't serve index.html automatically
}));

// Fallback to index.html for SPA routing (only for non-API, non-file requests)
app.use((req, res) => {
  // If the request is for a file (has an extension), don't send index.html
  if (path.extname(req.path)) {
    return res.status(404).send('Not found');
  }
  
  // Send index.html for SPA routes, disabling cache so browser always gets the latest asset hashes
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Blog backend running on port ${port}`);
});
