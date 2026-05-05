import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';

export default function BlogList() {
  const [blogs, setBlogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/blogs')
      .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
        return res.json();
      })
      .then(data => {
        // Sort by createdAt descending
        const sorted = data.sort((a, b) => {
          const timeA = a.createdAt || new Date(a.date).getTime();
          const timeB = b.createdAt || new Date(b.date).getTime();
          return timeB - timeA;
        });
        setBlogs(sorted);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch blog list:', err);
        // If we get an error, it might be because the server is down or something else
        setError('Failed to load blog posts. Please try again later.');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="text-center py-10 text-gray-400">Loading posts...</div>;
  }

  if (error) {
    return (
      <div className="text-center py-10">
        <div className="text-red-400 text-lg mb-4">{error}</div>
        <p className="text-gray-400">Please click "Login with Discord" above to authenticate.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {blogs.map(blog => (
        <article key={blog.id} className="group">
          <Link to={`/post/${blog.id}`} className="block">
            <h2 className="text-2xl font-semibold text-gray-100 group-hover:text-blue-400 transition-colors mb-2">
              {blog.title}
            </h2>
            <div className="flex items-center space-x-4 text-sm text-gray-500">
              <time dateTime={blog.date}>
                {format(parseISO(blog.date), 'MMMM d, yyyy')}
              </time>
              <span>•</span>
              <span>{blog.views ? blog.views.length : 0} views</span>
              <span>•</span>
              <span>{blog.likes ? blog.likes.length : 0} likes</span>
            </div>
          </Link>
        </article>
      ))}
      
      {blogs.length === 0 && (
        <div className="text-gray-400">No posts found.</div>
      )}
    </div>
  );
}
