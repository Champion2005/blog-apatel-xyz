import { useState, useEffect, useMemo } from 'react';
import SimpleMDE from "react-simplemde-editor";
import "easymde/dist/easymde.min.css";

export default function Admin() {
  const [users, setUsers] = useState([]);
  const [blogs, setBlogs] = useState([]);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalList, setModalList] = useState([]);
  const [ipInfo, setIpInfo] = useState({});

  const fetchIpInfo = async (ip) => {
    if (ipInfo[ip]) return;
    try {
      const res = await fetch(`https://ipapi.co/${ip}/json/`);
      if (res.ok) {
        const data = await res.json();
        setIpInfo(prev => ({ ...prev, [ip]: data }));
      }
    } catch (err) {
      console.error('Failed to fetch IP info', err);
    }
  };

  const openModal = (title, ids) => {
    setModalTitle(title);
    setModalList(ids);
    setShowModal(true);
  };

  // Editor State
  const [isEditing, setIsEditing] = useState(false);
  const [currentPost, setCurrentPost] = useState({ id: '', title: '', date: new Date().toISOString().split('T')[0], content: '', isPublic: false, status: 'draft' });

  const fetchAdminData = async () => {
    try {
      const [uRes, bRes, iRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/blogs'),
        fetch('/api/admin/images')
      ]);
      if (!uRes.ok || !bRes.ok || !iRes.ok) throw new Error('Failed to load admin data.');
      setUsers(await uRes.json());
      const blogsData = await bRes.json();
      const sortedBlogs = blogsData.sort((a, b) => {
        const timeA = a.createdAt || new Date(a.date).getTime();
        const timeB = b.createdAt || new Date(b.date).getTime();
        return timeB - timeA;
      });
      setBlogs(sortedBlogs);
      setImages(await iRes.json());
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAdminData();
  }, []);

  const deleteImage = async (filename) => {
    if (!confirm('Are you sure you want to delete this image? This might break links in your posts.')) return;
    const res = await fetch(`/api/admin/images/${filename}`, { method: 'DELETE' });
    if (res.ok) {
      setImages(images.filter(img => img.filename !== filename));
    } else {
      alert('Failed to delete image');
    }
  };

  const cleanupImages = async () => {
    if (!confirm('This will permanently delete any image that is NOT linked in a blog post. Continue?')) return;
    try {
      const res = await fetch('/api/admin/images/cleanup', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        alert(`Cleanup complete! Deleted ${data.deletedCount} orphaned images, freeing ${(data.bytesFreed / 1024 / 1024).toFixed(2)} MB of space.`);
        fetchAdminData();
      } else {
        alert('Cleanup failed');
      }
    } catch (err) {
      console.error(err);
      alert('Cleanup error');
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

  const startNewPost = () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const createdAtStr = now.toISOString().slice(0, 16);
    const defaultContent = `***begin post***\n\n\n\n***end post***`;
    setCurrentPost({ id: '', title: '', date: new Date().toISOString().split('T')[0], createdAtStr, content: defaultContent, isPublic: false, status: 'draft' });
    setIsEditing(true);
  };

  const editPost = async (id) => {
    const res = await fetch(`/api/admin/blogs/${id}`);
    if (res.ok) {
      const post = await res.json();
      const createTime = post.createdAt ? new Date(post.createdAt) : new Date(post.date);
      createTime.setMinutes(createTime.getMinutes() - createTime.getTimezoneOffset());
      post.createdAtStr = createTime.toISOString().slice(0, 16);
      if (!post.status) post.status = 'published'; // migration fallback
      setCurrentPost(post);
      setIsEditing(true);
    }
  };

  const savePost = async (targetStatus) => {
    if (!currentPost.id || !currentPost.title || !currentPost.content) return alert('Please fill all fields');
    
    const payload = { ...currentPost };
    if (payload.createdAtStr) {
      payload.createdAt = new Date(payload.createdAtStr).getTime();
    }
    if (targetStatus) {
      payload.status = targetStatus;
    }

    const res = await fetch('/api/admin/blogs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      alert(`Post ${payload.status === 'published' ? 'published' : 'saved as draft'}!`);
      setIsEditing(false);
      fetchAdminData(); // Refresh list
    } else {
      const errData = await res.json();
      alert(errData.error || 'Failed to save post');
    }
  };

  const deletePost = async (id) => {
    if (!confirm('Are you sure you want to delete this post?')) return;
    const res = await fetch(`/api/admin/blogs/${id}`, { method: 'DELETE' });
    if (res.ok) fetchAdminData();
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('image', file);
    
    try {
      const res = await fetch('/api/admin/upload', {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        const data = await res.json();
        const imgMarkdown = `\n![${file.name}](${data.url})\n`;
        setCurrentPost(prev => ({ ...prev, content: prev.content + imgMarkdown }));
      } else {
        alert('Image upload failed');
      }
    } catch (err) {
      console.error(err);
      alert('Upload error');
    }
    // clear input
    e.target.value = '';
  };

  const mdeOptions = useMemo(() => ({
    spellChecker: false,
    maxHeight: "500px",
    autofocus: true,
    placeholder: "Write your deepest darkest secrets here...",
    status: false,
    sideBySideFullscreen: false,
    syncSideBySidePreviewScroll: true,
    toolbar: [
      "bold", "italic", "heading", "|",
      "quote", "unordered-list", "ordered-list", "|",
      "link", "image", "table", "|",
      "preview", "side-by-side", "fullscreen", "|",
      "guide"
    ],
  }), []);

  if (loading) return <div className="text-gray-400 py-10">Loading admin panel...</div>;
  if (error) return <div className="text-red-400 py-10">{error}</div>;

  if (isEditing) {
    return (
      <div className="space-y-6">
        <style>{`
          .EasyMDEContainer .CodeMirror {
            background-color: #111827 !important;
            color: #f3f4f6 !important;
            border-color: #374151 !important;
          }
          .EasyMDEContainer .CodeMirror-cursor { border-left: 2px solid #60a5fa !important; }
          .EasyMDEContainer .editor-toolbar {
            background-color: #1f2937 !important;
            border-color: #374151 !important;
          }
          .EasyMDEContainer .editor-toolbar button { color: #d1d5db !important; }
          .EasyMDEContainer .editor-toolbar button.active,
          .EasyMDEContainer .editor-toolbar button:hover {
            background-color: #374151 !important;
            color: #ffffff !important;
          }
          .EasyMDEContainer .editor-preview,
          .EasyMDEContainer .editor-preview-side {
            background-color: #111827 !important;
            color: #d1d5db !important;
          }
          .EasyMDEContainer .editor-preview h1, .EasyMDEContainer .editor-preview-side h1 { color: #f3f4f6; border-bottom: 1px solid #374151; }
          .EasyMDEContainer .editor-preview h2, .EasyMDEContainer .editor-preview-side h2 { color: #f3f4f6; border-bottom: 1px solid #374151; }
          .EasyMDEContainer .editor-preview a, .EasyMDEContainer .editor-preview-side a { color: #60a5fa; }
          .EasyMDEContainer .editor-preview code, .EasyMDEContainer .editor-preview-side code { background: #374151; color: #fca5a5; }
        `}</style>
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
            <label className="block text-sm font-medium text-gray-400 mb-1">Post Date & Time</label>
            <input 
              type="datetime-local" 
              value={currentPost.createdAtStr || ''}
              onChange={e => setCurrentPost({ ...currentPost, createdAtStr: e.target.value })}
              className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-gray-200 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="flex items-center space-x-3 text-gray-300">
              <input 
                type="checkbox" 
                checked={currentPost.isPublic}
                onChange={e => setCurrentPost({ ...currentPost, isPublic: e.target.checked })}
                className="form-checkbox h-5 w-5 text-blue-500 rounded bg-gray-900 border-gray-600 focus:ring-blue-500 focus:ring-offset-gray-800"
              />
              <span>Public Post (Viewable without Discord login)</span>
            </label>
          </div>
          <div>
            <label className="flex items-center space-x-3 text-gray-300">
              <input 
                type="checkbox" 
                checked={currentPost.isPinned}
                onChange={e => setCurrentPost({ ...currentPost, isPinned: e.target.checked })}
                className="form-checkbox h-5 w-5 text-yellow-500 rounded bg-gray-900 border-gray-600 focus:ring-yellow-500 focus:ring-offset-gray-800"
              />
              <span>📌 Pinned Post (Max 3)</span>
            </label>
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-sm font-medium text-gray-400">Content (Markdown)</label>
              <div className="relative">
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={handleImageUpload} 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  title="Upload Image"
                />
                <button className="bg-gray-700 hover:bg-gray-600 text-xs text-gray-200 px-3 py-1 rounded transition-colors">
                  📷 Insert Image
                </button>
              </div>
            </div>
            <div className="prose-invert">
              <SimpleMDE 
                value={currentPost.content} 
                onChange={val => setCurrentPost({ ...currentPost, content: val })} 
                options={mdeOptions}
              />
            </div>
          </div>
          <div className="flex space-x-4 pt-4 border-t border-gray-700/50">
            <button 
              onClick={() => savePost('draft')}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-3 rounded-lg transition-colors border border-gray-600"
            >
              Save as Draft
            </button>
            <button 
              onClick={() => savePost('published')}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg transition-colors"
            >
              {currentPost.status === 'published' ? 'Update Post' : 'Publish Post'}
            </button>
          </div>
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
            <div key={blog.id} className={`bg-gray-800 p-4 rounded-lg flex justify-between items-center ${blog.isPinned ? 'border-2 border-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.2)]' : 'border border-gray-700'}`}>
              <div>
                <h3 className="font-bold text-gray-100">
                  {blog.isPinned && <span className="mr-2" title="Pinned Post">📌</span>}
                  {blog.title}
                </h3>
                <p className="text-xs text-gray-500">
                  {blog.date} • /{blog.id} 
                  <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${blog.status === 'draft' ? 'bg-yellow-900/50 text-yellow-400 border border-yellow-700/50' : 'bg-green-900/50 text-green-400 border border-green-700/50'}`}>
                    {blog.status || 'published'}
                  </span>
                  <span className="ml-2 opacity-50">
                    {blog.isPublic ? '(Public)' : '(Private)'}
                  </span>
                </p>
                <div className="flex space-x-4 mt-2">
                  <button 
                    onClick={() => openModal(`Viewers: ${blog.title}`, blog.views || [])}
                    className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded transition flex items-center space-x-1"
                    title="Viewers"
                  >
                    <span>👁️</span> <span>{blog.views ? blog.views.length : 0}</span>
                  </button>
                  <button 
                    onClick={() => openModal(`Likes: ${blog.title}`, blog.likes || [])}
                    className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded transition flex items-center space-x-1"
                    title="Likes"
                  >
                    <span>👍</span> <span>{blog.likes ? blog.likes.length : 0}</span>
                  </button>
                </div>
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

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-lg w-full max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-100">{modalTitle}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {modalList.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No data to show.</p>
              ) : (
                <ul className="space-y-3">
                  {modalList.map((id, i) => {
                    const isIp = id.startsWith('ip:');
                    const ip = isIp ? id.slice(3) : null;
                    const user = !isIp ? users.find(u => u.id === id) : null;

                    return (
                      <li key={i} className="bg-gray-900/50 p-3 rounded-lg border border-gray-700/50">
                        {isIp ? (
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-mono text-blue-400">Public IP: {ip}</span>
                              <button 
                                onClick={() => fetchIpInfo(ip)}
                                className="text-[10px] bg-blue-900/30 text-blue-300 px-2 py-1 rounded hover:bg-blue-900/50 transition"
                              >
                                {ipInfo[ip] ? 'Refresh Info' : 'Get Location Info'}
                              </button>
                            </div>
                            {ipInfo[ip] && (
                              <div className="text-xs text-gray-400 grid grid-cols-2 gap-1 bg-black/30 p-2 rounded">
                                <div><span className="text-gray-500">City:</span> {ipInfo[ip].city || 'N/A'}</div>
                                <div><span className="text-gray-500">Region:</span> {ipInfo[ip].region || 'N/A'}</div>
                                <div><span className="text-gray-500">Country:</span> {ipInfo[ip].country_name || 'N/A'}</div>
                                <div><span className="text-gray-500">Org:</span> {ipInfo[ip].org || 'N/A'}</div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center space-x-3">
                            {user?.avatar && <img src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`} className="w-6 h-6 rounded-full" alt="avatar" />}
                            <span className="text-sm text-gray-200">{user?.username || 'Unknown User'}</span>
                            <span className="text-[10px] text-gray-500">(ID: {id})</span>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="p-4 border-t border-gray-700 bg-gray-900/30">
              <button 
                onClick={() => setShowModal(false)}
                className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 rounded-lg transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <section>
        <h2 className="text-xl font-semibold text-gray-100 mb-4">Users</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-800 text-gray-400 border-b border-gray-700">
              <tr>
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Last Sign In</th>
                <th className="px-4 py-3">Role</th>
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
                  <td className="px-4 py-3 text-gray-400">
                    {u.lastSignIn ? new Date(u.lastSignIn).toLocaleString() : 'Unknown'}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Media Manager Section */}
      <section>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-100">Media Manager</h2>
          <button 
            onClick={cleanupImages}
            className="bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1.5 rounded-lg text-sm font-bold transition flex items-center space-x-2"
          >
            <span>🧹</span>
            <span>Clean Up Unused Images</span>
          </button>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {images.map(img => (
            <div key={img.filename} className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700 flex flex-col">
              <div className="h-32 bg-gray-900 flex items-center justify-center p-2 relative group">
                <img src={img.url} alt={img.filename} className="max-h-full max-w-full object-contain" />
              </div>
              <div className="p-3 flex-1 flex flex-col justify-between">
                <div>
                  <div className="text-xs text-gray-200 font-mono truncate" title={img.filename}>
                    {img.filename}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1">
                    {(img.size / 1024).toFixed(1)} KB • {new Date(img.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex justify-between mt-3">
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(`![${img.filename}](${img.url})`);
                      alert('Markdown link copied to clipboard!');
                    }}
                    className="text-xs text-blue-400 hover:text-blue-300 bg-blue-900/30 px-2 py-1 rounded"
                  >
                    Copy MD
                  </button>
                  <button 
                    onClick={() => deleteImage(img.filename)}
                    className="text-xs text-red-400 hover:text-red-300 bg-red-900/30 px-2 py-1 rounded"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
          {images.length === 0 && (
            <div className="col-span-full text-gray-500 py-8 text-center bg-gray-800/50 rounded-lg border border-gray-700/50">
              No images uploaded yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
