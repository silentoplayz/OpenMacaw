import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { apiFetch } from '../api';
import { useAuth } from '../contexts/AuthContext';

export default function Auth() {
  const [mode, setMode] = useState<'loading' | 'login' | 'signup'>('loading');
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [allowSignup, setAllowSignup] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const { login, token } = useAuth();

  const from = (location.state as any)?.from?.pathname || '/chat';

  useEffect(() => {
    // If already logged in, redirect away from /auth
    if (token) {
      navigate(from, { replace: true });
      return;
    }

    // Check if we need initial setup (First User = Admin)
    apiFetch('/api/auth/status')
      .then(r => r.json())
      .then(data => {
        setAllowSignup(data.enableSignup !== false);
        if (data.needsSetup) {
          setMode('signup');
        } else {
          setMode('login');
        }
      })
      .catch(() => {
        setError('Failed to connect to server.');
        setMode('login'); // Fallback
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'signup' && form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    try {
      const endpoint = mode === 'signup' ? '/api/auth/register' : '/api/auth/login';
      const cacheBustedEndpoint = `${endpoint}?t=${Date.now()}`;
      
      const payload = { 
        name: form.name, 
        email: form.email, 
        password: form.password 
      };

      const res = await apiFetch(cacheBustedEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      console.log(`[DEBUG] Auth Response Status: ${res.status}${data.message ? ` Message: ${data.message}` : ''}${data.error ? ` Error: ${data.error}` : ''}`);

      if (!res.ok) {
        if (res.status === 403 && data.message === 'Account Activation Pending') {
          navigate('/auth/pending', { state: { email: form.email, password: form.password }, replace: true });
          return;
        }
        throw new Error(data.error || data.message || 'Authentication failed');
      }

      if (mode === 'signup' && !data.token) {
        navigate('/auth/pending', { state: { email: form.email, password: form.password }, replace: true });
        return;
      }

      login(data.token, data.user);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setError('');
    setMode(prev => prev === 'login' ? 'signup' : 'login');
  };

  if (mode === 'loading') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[25%] -left-[10%] w-[700px] h-[700px] bg-cyan-500/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-[25%] -right-[10%] w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-sm bg-zinc-950/50 backdrop-blur-xl border border-white/10 rounded-2xl p-8 relative z-10 shadow-2xl">
        
        <div className="flex flex-col items-center mb-8">
          <div className="text-4xl mb-4">🦜</div>
          <h1 className="text-2xl font-semibold text-white mb-2 text-center">
            {mode === 'signup' ? 'Sign Up' : 'Sign In'}
          </h1>
          <p className="text-sm text-gray-400 text-center">
            {mode === 'signup' 
              ? 'Create your account to get started' 
              : 'Sign in to access your account'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">Name</label>
              <input 
                type="text" 
                value={form.name}
                onChange={e => setForm({...form, name: e.target.value})}
                required={mode === 'signup'}
                className="w-full bg-black border border-white/10 rounded-full px-4 py-2 text-sm text-gray-200 focus:outline-none focus:border-white/30 transition-all font-sans"
                placeholder="Name"
              />
            </div>
          )}
          
          <div>
            <label className="block text-sm text-gray-300 mb-1.5">Email</label>
            <input 
              type="email" 
              value={form.email}
              onChange={e => setForm({...form, email: e.target.value})}
              required
              className="w-full bg-black border border-white/10 rounded-full px-4 py-2 text-sm text-gray-200 focus:outline-none focus:border-white/30 transition-all font-sans"
              placeholder="name@example.com"
            />
          </div>

          <div className="relative">
            <label className="block text-sm text-gray-300 mb-1.5">Password</label>
            <div className="relative">
              <input 
                type={showPassword ? "text" : "password"} 
                value={form.password}
                onChange={e => setForm({...form, password: e.target.value})}
                required
                className="w-full bg-black border border-white/10 rounded-full px-4 py-2 text-sm text-gray-200 focus:outline-none focus:border-white/30 transition-all font-sans pr-10"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {mode === 'signup' && (
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">Confirm Password</label>
              <input 
                type={showPassword ? "text" : "password"} 
                value={form.confirmPassword}
                onChange={e => setForm({...form, confirmPassword: e.target.value})}
                required={mode === 'signup'}
                className="w-full bg-black border border-white/10 rounded-full px-4 py-2 text-sm text-gray-200 focus:outline-none focus:border-white/30 transition-all font-sans"
                placeholder="••••••••"
              />
            </div>
          )}

          {error && (
            <div className="bg-red-950/30 border border-red-500/20 rounded-lg p-3 text-sm text-red-400 text-center">
              {error}
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-white hover:bg-gray-200 text-black font-semibold text-sm py-2.5 rounded-full flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-6"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {mode === 'signup' ? 'Create Account' : 'Sign in'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-500">
          {mode === 'signup' ? (
            <p>
              Already have an account?{' '}
              <button type="button" onClick={toggleMode} className="text-white hover:underline font-medium focus:outline-none">
                Sign in
              </button>
            </p>
          ) : allowSignup ? (
            <p>
              Don't have an account?{' '}
              <button type="button" onClick={toggleMode} className="text-white hover:underline font-medium focus:outline-none">
                Sign up
              </button>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
