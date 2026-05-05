import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { marked } from 'marked';
import { format, parseISO } from 'date-fns';

// Sub-component for the comment input to isolate re-renders while typing
function CommentInput({ onCommentSubmitted, disabled }) {
  const [text, setText] = useState('');

  const handleSubmit = async () => {
    if (!text.trim()) return;
    const success = await onCommentSubmitted(text);
    if (success) setText('');
  };

  if (disabled) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 p-4 rounded-lg text-center mb-8">
        <p className="text-gray-400">Please login with Discord to leave a comment.</p>
      </div>
    );
  }

  return (
    <div className="mb-8 space-y-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What are your thoughts?"
        className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-gray-100 focus:border-blue-500 focus:outline-none min-h-[100px]"
      />
      <div className="flex justify-end">
        <button 
          onClick={handleSubmit}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition-colors"
        >
          Post Comment
        </button>
      </div>
    </div>
  );
}

// Sub-component for individual comments to isolate edit state
function CommentItem({ comment, currentUserId, isAdmin, onDelete, onUpdate }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(comment.content);

  const handleSave = async () => {
    if (!editText.trim()) return;
    const success = await onUpdate(comment.id, editText);
    if (success) setIsEditing(false);
  };

  return (
    <div className="bg-gray-800/30 border border-gray-700/50 p-4 rounded-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          {comment.avatar && <img src={`https://cdn.discordapp.com/avatars/${comment.userId}/${comment.avatar}.png`} className="w-8 h-8 rounded-full" alt="avatar" />}
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-gray-200">{comment.username}</span>
              {comment.role === 'admin' && (
                <span className="bg-red-900/30 text-red-400 text-[10px] font-bold px-1.5 py-0.5 rounded border border-red-900/50">ADMIN</span>
              )}
            </div>
            <div className="text-[10px] text-gray-500">{new Date(comment.createdAt).toLocaleString()}</div>
          </div>
        </div>
        {(comment.userId === currentUserId || isAdmin) && (
          <div className="flex space-x-3 text-[11px]">
            <button 
              onClick={() => setIsEditing(!isEditing)}
              className="text-gray-400 hover:text-blue-400"
            >
              {isEditing ? 'Cancel' : 'Edit'}
            </button>
            <button 
              onClick={() => onDelete(comment.id)}
              className="text-gray-400 hover:text-red-400"
            >
              Delete
            </button>
          </div>
        )}
      </div>
      
      {isEditing ? (
        <div className="space-y-2">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-gray-100 text-sm focus:outline-none"
          />
          <div className="flex justify-end space-x-2">
            <button onClick={() => setIsEditing(false)} className="text-xs text-gray-500">Cancel</button>
            <button onClick={handleSave} className="text-xs text-blue-400 font-bold">Save</button>
          </div>
        </div>
      ) : (
        <p className="text-gray-300 text-sm whitespace-pre-wrap">{comment.content}</p>
      )}
    </div>
  );
}

export default function BlogPost() {
  const { id } = useParams();
  const [post, setPost] = useState(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() : null)
      .then(data => { 
        if (data && data.user) {
          setUserId(data.user.id);
          setCurrentUser(data.user);
        }
      })
      .catch(() => {});

    fetch('/api/blogs')
      .then(res => {
        if (!res.ok) throw new Error('Failed to load blog metadata');
        return res.json();
      })
      .then(data => {
        const found = data.find(b => b.id === id);
        if (found) {
          setPost(found);
          return fetch(`/api/blogs/${id}`);
        } else {
          throw new Error('Post not found or you do not have permission to view it.');
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

  const toggleLike = async () => {
    if (!userId) return alert('Please login with Discord to like posts!');
    try {
      const res = await fetch(`/api/blogs/${id}/like`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setPost(prev => ({ ...prev, likes: data.likes }));
      }
    } catch (err) {
      console.error('Failed to toggle like', err);
    }
  };

  const handleCommentSubmitted = async (text) => {
    try {
      const res = await fetch(`/api/blogs/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text })
      });
      if (res.ok) {
        const newComment = await res.json();
        setPost(prev => ({ ...prev, comments: [...(prev.comments || []), newComment] }));
        return true;
      } else {
        const errorData = await res.json();
        alert(errorData.error || 'Failed to post comment');
        return false;
      }
    } catch (err) {
      console.error('Failed to post comment', err);
      return false;
    }
  };

  const deleteComment = async (commentId) => {
    if (!confirm('Are you sure you want to delete this comment?')) return;
    try {
      const res = await fetch(`/api/blogs/${id}/comments/${commentId}`, { method: 'DELETE' });
      if (res.ok) {
        setPost(prev => ({ ...prev, comments: prev.comments.filter(c => c.id !== commentId) }));
      }
    } catch (err) {
      console.error('Failed to delete comment', err);
    }
  };

  const updateComment = async (commentId, newContent) => {
    try {
      const res = await fetch(`/api/blogs/${id}/comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent })
      });
      if (res.ok) {
        const updated = await res.json();
        setPost(prev => ({ ...prev, comments: prev.comments.map(c => c.id === updated.id ? updated : c) }));
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to update comment', err);
      return false;
    }
  };

  // Pre-render markdown content once
  const renderedContent = useMemo(() => marked(content), [content]);

  if (loading) return <div className="text-center py-10 text-gray-400">Loading...</div>;
  if (error) return (
    <div className="text-center py-10">
      <h2 className="text-2xl font-bold text-red-400 mb-4">{error}</h2>
      <Link to="/" className="text-blue-400 hover:underline">← Back to home</Link>
    </div>
  );

  return (
    <article className="prose prose-slate lg:prose-lg max-w-none">
      <div className="mb-8 border-b border-gray-700 pb-8">
        <Link to="/" className="text-sm text-blue-400 hover:underline mb-4 inline-block">← Back</Link>
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-100 mb-2 mt-4">{post.title}</h1>
        <div className="flex items-center space-x-4 text-sm text-gray-400">
          <time dateTime={post.date}>
            {format(parseISO(post.date), 'MMMM d, yyyy')}
          </time>
          <span>•</span>
          <span>{post.views ? post.views.length : 0} views</span>
          <span>•</span>
          <button 
            onClick={toggleLike} 
            className={`flex items-center space-x-1 px-2 py-1 rounded transition-colors ${
              post.likes && post.likes.includes(userId) 
                ? 'bg-blue-900/50 text-blue-400 hover:bg-blue-900/70' 
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
            }`}
          >
            <span>👍</span>
            <span>{post.likes ? post.likes.length : 0}</span>
          </button>
        </div>
      </div>
      
      <div className="markdown-body space-y-6 text-gray-300 leading-relaxed">
        <style>{`
          .markdown-body h1 { font-size: 2.25rem; font-weight: 800; margin-top: 3rem; margin-bottom: 1.5rem; color: #f3f4f6; }
          .markdown-body h2 { font-size: 1.5rem; font-weight: 700; margin-top: 2.5rem; margin-bottom: 1.25rem; color: #f3f4f6; border-bottom: 1px solid #374151; padding-bottom: 0.5rem; }
          .markdown-body h3 { font-size: 1.25rem; font-weight: 600; margin-top: 2rem; margin-bottom: 1rem; color: #f3f4f6; }
          .markdown-body p { margin-bottom: 1.5rem; }
          .markdown-body a { color: #60a5fa; text-decoration: underline; }
          .markdown-body ul { list-style-type: disc; padding-left: 1.5rem; margin-bottom: 1.5rem; }
          .markdown-body ol { list-style-type: decimal; padding-left: 1.5rem; margin-bottom: 1.5rem; }
          .markdown-body li { margin-bottom: 0.5rem; }
          .markdown-body blockquote { border-left-width: 4px; border-color: #374151; padding-left: 1rem; font-style: italic; color: #9ca3af; margin-bottom: 1.5rem; }
          .markdown-body pre { background-color: #1f2937; color: #f9fafb; padding: 1.25rem; border-radius: 0.5rem; overflow-x: auto; margin-bottom: 1.5rem; border: 1px solid #374151; }
          .markdown-body code { font-family: monospace; background-color: #374151; padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-size: 0.875em; color: #fca5a5; }
          .markdown-body pre code { background-color: transparent; color: inherit; padding: 0; }
          .markdown-body del { text-decoration: line-through; }
          .markdown-body hr { border-color: #374151; margin: 2rem 0; }
        `}</style>
        <div dangerouslySetInnerHTML={{ __html: renderedContent }}></div>
      </div>

      <div className="mt-16 border-t border-gray-700 pt-8 pb-12">
        <h2 className="text-2xl font-bold text-gray-100 mb-8">Comments ({post.comments ? post.comments.length : 0})</h2>
        
        <CommentInput 
          disabled={!userId} 
          onCommentSubmitted={handleCommentSubmitted} 
        />

        <div className="space-y-6">
          {(post.comments || []).sort((a, b) => b.createdAt - a.createdAt).map(comment => (
            <CommentItem 
              key={comment.id}
              comment={comment}
              currentUserId={userId}
              isAdmin={currentUser?.role === 'admin'}
              onDelete={deleteComment}
              onUpdate={updateComment}
            />
          ))}
          {(!post.comments || post.comments.length === 0) && (
            <p className="text-gray-500 text-center py-4">No comments yet. Be the first!</p>
          )}
        </div>
      </div>
    </article>
  );
}
