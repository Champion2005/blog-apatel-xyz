import { useState, useEffect, useMemo } from 'react';
import SimpleMDE from "react-simplemde-editor";
import "easymde/dist/easymde.min.css";

export default function Admin() {
  const [users, setUsers] = useState([]);
  const [blogs, setBlogs] = useState([]);
  const [settings, setSettings] = useState({ requireApproval: true, allowedGuildId: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Editor State
  const [isEditing, setIsEditing] = useState(false);
  const [currentPost, setCurrentPost] = useState({ id: '', title: '', date: new Date().toISOString().split('T')[0], content: '' });

  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAdminData = async () => {
    try {
      const [uRes, sRes, bRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/settings'),
        fetch('/api/admin/blogs')
      ]);
      if (!uRes.ok || !sRes.ok || !bRes.ok) throw new Error('Failed to load admin data.');
      setUsers(await uRes.json());
      setSettings(await sRes.json());
      setBlogs(await bRes.json());
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const updateUser = async (id, updates) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (res.ok) {
      const updated = await res.json();
      setUsers(users.map(u => u.id === id ? updated : u));
    }
  };

  const saveSettings = async () => {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    if (res.ok) alert('Settings saved!');
  };

  const startNewPost = () => {
    setCurrentPost({ id: '', title: '', date: new Date().toISOString().split('T')[0], content: '' });
    setIsEditing(true);
  };

  const editPost = async (id) => {
    const res = await fetch(`/api/admin/blogs/${id}`);
    if (res.ok) {
      setCurrentPost(await res.json());
      setIsEditing(true);
    }
  };

  const savePost = async () => {
    if (!currentPost.id || !currentPost.title || !currentPost.content) return alert('Please fill all fields');
    
    const res = await fetch('/api/admin/blogs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentPost)
    });

    if (res.ok) {
      alert('Post saved!');
      setIsEditing(false);
      fetchAdminData(); // Refresh list
    }
  };

  const deletePost = async (id) => {
    if (!confirm('Are you sure you want to delete this post?')) return;
    const res = await fetch(`/api/admin/blogs/${id}`, { method: 'DELETE' });
    if (res.ok) fetchAdminData();
  };

  const mdeOptions = useMemo(() => ({
    spellChecker: false,
    maxHeight: "400px",
    autofocus: true,
    placeholder: "Write your deepest darkest secrets here...",
    status: false,
  }), []);

  if (loading) return <div className="text-gray-400 py-10">Loading admin panel...</div>;
  if (error) return <div className="text-red-400 py-10">{error}</div>;

  if (isEditing) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-100">{currentPost.id ? 'Edit Post' : 'New Post'}</h1>
          <button onClick={() => setIsEditing(false)} className="text-gray-400 hover:text-white">Cancel</button>
        </div>

        <div className="space-y-4 bg-gray-800 p-6 rounded-lg border border-gray-700">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Slug (URL ID)</label>
            <input 
              type="text" 
              value={currentPost.id}
              onChange={e => setCurrentPost({ ...currentPost, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
              className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-gray-200 focus:border-blue-500 focus:outline-none"
              placeholder="e.g. my-first-post"
              disabled={!!currentPost._oldId} 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Title</label>
            <input 
              type="text" 
              value={currentPost.title}
              onChange={e => setCurrentPost({ ...currentPost, title: e.target.value })}
              className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-gray-200 focus:border-blue-500 focus:outline-none"
              placeholder="Post Title"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Date</label>
            <input 
              type="date" 
              value={currentPost.date}
              onChange={e => setCurrentPost({ ...currentPost, date: e.target.value })}
              className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-gray-200 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Content (Markdown)</label>
            <div className="prose-invert">
              <SimpleMDE 
                value={currentPost.content} 
                onChange={val => setCurrentPost({ ...currentPost, content: val })} 
                options={mdeOptions}
              />
            </div>
          </div>
          <button 
            onClick={savePost}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg transition-colors"
          >
            Save Blog Post
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-100">Admin Panel</h1>
        <button 
          onClick={startNewPost}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold transition"
        >
          + New Post
        </button>
      </div>

      {/* Blogs Section */}
      <section>
        <h2 className="text-xl font-semibold text-gray-100 mb-4">Blog Posts</h2>
        <div className="grid gap-4">
          {blogs.map(blog => (
            <div key={blog.id} className="bg-gray-800 p-4 rounded-lg border border-gray-700 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-gray-100">{blog.title}</h3>
                <p className="text-xs text-gray-500">{blog.date} • /{blog.id}</p>
              </div>
              <div className="space-x-4">
                <button onClick={() => editPost(blog.id)} className="text-blue-400 hover:text-blue-300">Edit</button>
                <button onClick={() => deletePost(blog.id)} className="text-red-400 hover:text-red-300">Delete</button>
              </div>
            </div>
          ))}
          {blogs.length === 0 && <p className="text-gray-500">No posts yet.</p>}
        </div>
      </section>

      <section className="bg-gray-800 p-6 rounded-lg border border-gray-700">
        <h2 className="text-xl font-semibold text-gray-100 mb-4">Site Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="flex items-center space-x-3 text-gray-300">
              <input 
                type="checkbox" 
                checked={settings.requireApproval}
                onChange={e => setSettings({ ...settings, requireApproval: e.target.checked })}
                className="form-checkbox h-5 w-5 text-blue-500 rounded bg-gray-900 border-gray-600 focus:ring-blue-500 focus:ring-offset-gray-800"
              />
              <span>Require Manual Approval for new users</span>
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Allowed Discord Server (Guild ID) - Optional</label>
            <input 
              type="text" 
              value={settings.allowedGuildId}
              onChange={e => setSettings({ ...settings, allowedGuildId: e.target.value })}
              className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-gray-200 focus:border-blue-500 focus:outline-none"
              placeholder="e.g. 123456789012345678"
            />
          </div>
          <button 
            onClick={saveSettings}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors"
          >
            Save Settings
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-gray-100 mb-4">Users</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-800 text-gray-400 border-b border-gray-700">
              <tr>
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-gray-200 font-medium">
                    <div className="flex items-center space-x-3">
                      {u.avatar && <img src={`https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png`} className="w-8 h-8 rounded-full" alt="avatar" />}
                      <span>{u.username}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${u.status === 'approved' ? 'bg-green-900 text-green-300' : u.status === 'denied' ? 'bg-red-900 text-red-300' : 'bg-yellow-900 text-yellow-300'}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    <select 
                      value={u.role}
                      onChange={e => updateUser(u.id, { role: e.target.value })}
                      className="bg-gray-900 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 space-x-2">
                    {u.status !== 'approved' && (
                      <button onClick={() => updateUser(u.id, { status: 'approved' })} className="text-green-400 hover:text-green-300">Approve</button>
                    )}
                    {u.status !== 'denied' && (
                      <button onClick={() => updateUser(u.id, { status: 'denied' })} className="text-red-400 hover:text-red-300">Deny</button>
                    )}
                    {u.status !== 'pending' && (
                      <button onClick={() => updateUser(u.id, { status: 'pending' })} className="text-yellow-400 hover:text-yellow-300">Pending</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
