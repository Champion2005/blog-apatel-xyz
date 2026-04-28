import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './components/Auth';
import BlogList from './pages/BlogList';
import BlogPost from './pages/BlogPost';
import Admin from './pages/Admin';

function Navbar() {
  const { user, login, logout, loading } = useAuth();
  
  return (
    <header className="bg-gray-800 py-4">
      <div className="max-w-3xl mx-auto px-4 md:px-8 flex justify-between items-center">
        <Link to="/" className="text-2xl font-bold text-gray-100 hover:text-gray-300">
          brain dump
        </Link>
        <div className="flex items-center space-x-4">
          {!loading && !user && (
            <button onClick={login} className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded transition">
              Login with Discord
            </button>
          )}
          {!loading && user && (
            <>
              {user.role === 'admin' && (
                <Link to="/admin" className="text-sm text-gray-300 hover:text-white">Admin</Link>
              )}
              <div className="flex items-center space-x-2">
                {user.avatar && <img src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`} alt="avatar" className="w-6 h-6 rounded-full" />}
                <button onClick={logout} className="text-sm text-gray-400 hover:text-red-400 transition">Logout</button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-gray-900 text-gray-100 font-sans">
          <Navbar />
          <main className="max-w-3xl mx-auto py-10 px-4 md:px-8">
            <Routes>
              <Route path="/" element={<BlogList />} />
              <Route path="/post/:id" element={<BlogPost />} />
              <Route path="/admin" element={<Admin />} />
            </Routes>
          </main>
          
          <footer className="max-w-3xl mx-auto py-8 px-4 md:px-8 text-center text-sm text-gray-400 border-t border-gray-700 mt-10">
            my deepest darkest secrets...
          </footer>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;