import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import Markdown from 'react-markdown';
import { format, parseISO } from 'date-fns';

export default function BlogPost() {
  const { id } = useParams();
  const [post, setPost] = useState(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    // Fetch blog metadata from the secure API
    fetch('/api/blogs')
      .then(res => {
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw new Error('Access denied. Please log in or wait for approval.');
          }
          throw new Error('Failed to load blog metadata');
        }
        return res.json();
      })
      .then(data => {
        const found = data.find(b => b.id === id);
        if (found) {
          setPost(found);
          // Fetch markdown content securely
          return fetch(`/api/blogs/${id}`);
        } else {
          throw new Error('Post not found');
        }
      })
      .then(res => {
        if (!res.ok) throw new Error('Failed to load markdown');
        return res.text();
      })
      .then(text => {
        setContent(text);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return <div className="text-center py-10 text-gray-400">Loading...</div>;
  }

  if (error) {
    return (
      <div className="text-center py-10">
        <h2 className="text-2xl font-bold text-red-400 mb-4">{error}</h2>
        <Link to="/" className="text-blue-400 hover:underline">← Back to home</Link>
      </div>
    );
  }

  return (
    <article className="prose prose-slate lg:prose-lg max-w-none">
      <div className="mb-8 border-b border-gray-700 pb-8">
        <Link to="/" className="text-sm text-blue-400 hover:underline mb-4 inline-block">← Back</Link>
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-100 mb-2 mt-4">{post.title}</h1>
        <time className="text-sm text-gray-400" dateTime={post.date}>
          {format(parseISO(post.date), 'MMMM d, yyyy')}
        </time>
      </div>
      
      <div className="markdown-body space-y-4 text-gray-300 leading-relaxed">
        <style>{`
          .markdown-body h1 { font-size: 2.25rem; font-weight: 800; margin-top: 2rem; margin-bottom: 1rem; color: #f3f4f6; }
          .markdown-body h2 { font-size: 1.5rem; font-weight: 700; margin-top: 1.5rem; margin-bottom: 0.75rem; color: #f3f4f6; }
          .markdown-body h3 { font-size: 1.25rem; font-weight: 600; margin-top: 1.25rem; margin-bottom: 0.5rem; color: #f3f4f6; }
          .markdown-body p { margin-bottom: 1rem; }
          .markdown-body a { color: #60a5fa; text-decoration: underline; }
          .markdown-body ul { list-style-type: disc; padding-left: 1.5rem; margin-bottom: 1rem; }
          .markdown-body ol { list-style-type: decimal; padding-left: 1.5rem; margin-bottom: 1rem; }
          .markdown-body blockquote { border-left-width: 4px; border-color: #374151; padding-left: 1rem; font-style: italic; color: #9ca3af; }
          .markdown-body pre { background-color: #1f2937; color: #f9fafb; padding: 1rem; border-radius: 0.375rem; overflow-x: auto; margin-bottom: 1rem; }
          .markdown-body code { font-family: monospace; background-color: #374151; padding: 0.125rem 0.25rem; border-radius: 0.25rem; font-size: 0.875em; color: #fca5a5; }
          .markdown-body pre code { background-color: transparent; color: inherit; padding: 0; }
        `}</style>
        <Markdown>{content}</Markdown>
      </div>
    </article>
  );
}
