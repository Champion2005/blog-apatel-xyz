import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import BlogList from './pages/BlogList';
import BlogPost from './pages/BlogPost';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
        <header className="bg-white shadow-sm py-6 px-4 md:px-8">
          <div className="max-w-3xl mx-auto flex justify-between items-center">
            <Link to="/" className="text-2xl font-bold tracking-tight text-gray-900 hover:text-blue-600 transition-colors">
              Aditya's Blog
            </Link>
          </div>
        </header>

        <main className="max-w-3xl mx-auto py-10 px-4 md:px-8">
          <Routes>
            <Route path="/" element={<BlogList />} />
            <Route path="/post/:id" element={<BlogPost />} />
          </Routes>
        </main>
        
        <footer className="max-w-3xl mx-auto py-8 px-4 md:px-8 text-center text-sm text-gray-500 border-t border-gray-200 mt-10">
          © {new Date().getFullYear()} Aditya Patel. All rights reserved.
        </footer>
      </div>
    </BrowserRouter>
  );
}

export default App;