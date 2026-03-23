import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, ShieldAlert, LogOut } from 'lucide-react';
import { apiFetch } from '../api';
import { useAuth } from '../contexts/AuthContext';

export default function Pending() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const state = location.state as { email?: string; password?: string } | null;

  const handleCheckStatus = async () => {
    if (!state?.email || !state?.password) {
      setError('Session expired. Please sign in again.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: state.email, password: state.password })
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 403 && data.message === 'Account Activation Pending') {
          setError('Your account is still pending approval. Please check back later.');
          return;
        }
        throw new Error(data.error || data.message || 'Authentication failed');
      }

      // Success! Admin changed our role.
      login(data.token, data.user);
      navigate('/chat', { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    navigate('/auth', { replace: true });
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[25%] -left-[10%] w-[700px] h-[700px] bg-cyan-500/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-[25%] -right-[10%] w-[600px] h-[600px] bg-amber-500/10 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-sm bg-zinc-950/50 backdrop-blur-xl border border-white/10 rounded-2xl p-8 relative z-10 shadow-2xl flex flex-col items-center">
        
        <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mb-6 border border-amber-500/20">
          <ShieldAlert className="w-8 h-8 text-amber-500" />
        </div>

        <h1 className="text-xl font-semibold text-white mb-2 text-center text-balance">
          Account Activation Pending
        </h1>
        <p className="text-sm text-gray-400 text-center mb-8 text-balance leading-relaxed">
          Your account has been created successfully, but it requires an administrator's approval before you can access the platform.
        </p>

        {error && (
          <div className="w-full bg-red-950/30 border border-red-500/20 rounded-lg p-3 text-sm text-red-400 text-center mb-6">
            {error}
          </div>
        )}

        <button 
          onClick={handleCheckStatus}
          disabled={loading || !state?.email}
          className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm py-2.5 rounded-full flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed mb-4"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Check Status
        </button>

        <button 
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Back to Login
        </button>

      </div>

      <div className="mt-8 text-center">
        <p className="text-xs text-gray-600">
          Need help? Contact your administrator at <span className="text-cyan-600 hover:underline">admin@openmacaw.com</span>
        </p>
      </div>
    </div>
  );
}
