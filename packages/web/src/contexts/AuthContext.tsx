import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { apiFetch } from '../api';

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  isSuperAdmin?: number;
  profileImageUrl?: string;
}

interface AuthContextType {
  token: string | null;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('openmacaw_token'));
  const [user, setUser] = useState<User | null>(() => {
    const savedUser = localStorage.getItem('openmacaw_user');
    return savedUser ? JSON.parse(savedUser) : null;
  });

  const login = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('openmacaw_token', newToken);
    localStorage.setItem('openmacaw_user', JSON.stringify(newUser));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('openmacaw_token');
    localStorage.removeItem('openmacaw_user');
  };

  const refreshUser = async () => {
    const currentToken = localStorage.getItem('openmacaw_token');
    if (!currentToken) return;
    try {
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        
        // Phase 87: Self-Healing JWT
        if (data.token) {
          setToken(data.token);
          localStorage.setItem('openmacaw_token', data.token);
        }
        
        const freshUser: User = data.user;
        setUser(freshUser);
        localStorage.setItem('openmacaw_user', JSON.stringify(freshUser));
      }
    } catch {
      // Silently ignore refresh errors — session will expire naturally
    }
  };

  useEffect(() => {
    refreshUser();

    // Automatically check for updated DB roles/permissions when the user tabs back into the app
    const onFocus = () => refreshUser();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const location = useLocation();

  if (!token) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

export function AdminRoute({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const location = useLocation();

  if (!token) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (user?.role !== 'admin') {
    return <Navigate to="/forbidden" replace />;
  }

  return <>{children}</>;
}
