import { useState, useEffect } from 'react';

export default function Admin() {
  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState({ requireApproval: true, allowedGuildId: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAdminData = async () => {
    try {
      const [uRes, sRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/settings')
      ]);
      if (!uRes.ok || !sRes.ok) throw new Error('Failed to load admin data. Are you an admin?');
      setUsers(await uRes.json());
      setSettings(await sRes.json());
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

  if (loading) return <div className="text-gray-400 py-10">Loading admin panel...</div>;
  if (error) return <div className="text-red-400 py-10">{error}</div>;

  return (
    <div className="space-y-10">
      <h1 className="text-3xl font-bold text-gray-100">Admin Panel</h1>

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
            <p className="text-xs text-gray-500 mt-1">If set, only members of this server will be allowed or auto-approved.</p>
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
