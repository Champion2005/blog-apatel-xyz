import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';

export default function BlogList() {
  const [blogs, setBlogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/blogs/index.json')
      .then(res => res.json())
      .then(data => {
        // Sort by date descending
        const sorted = data.sort((a, b) => new Date(b.date) - new Date(a.date));
        setBlogs(sorted);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch blog list:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="text-center py-10 text-gray-400">Loading posts...</div>;
  }

  return (
    <div className="space-y-8">
      {blogs.map(blog => (
        <article key={blog.id} className="group">
          <Link to={`/post/${blog.id}`} className="block">
            <h2 className="text-2xl font-semibold text-gray-100 group-hover:text-blue-400 transition-colors mb-2">
              {blog.title}
            </h2>
            <time className="text-sm text-gray-500" dateTime={blog.date}>
              {format(parseISO(blog.date), 'MMMM d, yyyy')}
            </time>
          </Link>
        </article>
      ))}
      
      {blogs.length === 0 && (
        <div className="text-gray-400">No posts found.</div>
      )}
    </div>
  );
}