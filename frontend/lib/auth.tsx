'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { ID_TOKEN_KEY, REFRESH_TOKEN_KEY } from './constants';

interface JwtPayload {
  sub: string;
  email: string;
  exp: number;
  iat: number;
}

export interface AuthUser {
  userId: string;
  email: string;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  user: AuthUser | null;
  login: (idToken: string, refreshToken: string) => void;
  logout: () => void;
  isLoading: boolean;
}

// API Gateway authorizer expects the Cognito ID token, not the access token.
export function storeTokens(idToken: string, refreshToken: string): void {
  localStorage.setItem(ID_TOKEN_KEY, idToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function getIdToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ID_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function clearTokens(): void {
  localStorage.removeItem(ID_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.location.href = '/login';
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const [, payload] = token.split('.');
    // base64url → base64
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(padded)) as JwtPayload;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  const token = getIdToken();
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  return payload.exp * 1000 > Date.now();
}

function parseUser(token: string): AuthUser | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return { userId: payload.sub, email: payload.email };
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = getIdToken();
    if (token && isAuthenticated()) {
      setUser(parseUser(token));
    }
    setIsLoading(false);
  }, []);

  function login(idToken: string, refreshToken: string) {
    storeTokens(idToken, refreshToken);
    setUser(parseUser(idToken));
  }

  function logout() {
    clearTokens();
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{ isAuthenticated: user !== null, user, login, logout, isLoading }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
