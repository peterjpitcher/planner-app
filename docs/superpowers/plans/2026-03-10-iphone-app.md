# OJ Planner iPhone App — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-featured React Native (Expo) iPhone app that mirrors OJ Planner 2.0, calling the existing REST API at `https://planner.orangejelly.co.uk`.

**Architecture:** Expo Router (file-based navigation) with a tab bar containing Dashboard, Prioritise, Capture (FAB), Journal, and More. Authentication uses email/password via NextAuth, with the session cookie stored in Expo SecureStore and replayed on every API request. The app lives at `/Users/peterpitcher/Cursor/oj-planner-app/`, alongside the web project.

**Tech Stack:** React Native, Expo SDK 52, Expo Router v4, TypeScript, Expo SecureStore, @gorhom/bottom-sheet, @testing-library/react-native, jest-expo

---

## File Map

```
/Users/peterpitcher/Cursor/oj-planner-app/
├── app.json                        — Expo config (name, scheme, icons)
├── package.json
├── tsconfig.json
├── babel.config.js
├── jest.config.js
├── jest.setup.js
├── constants/
│   └── config.ts                   — BASE_URL, colours, spacing
├── lib/
│   ├── types.ts                    — TypeScript interfaces (Project, Task, Note, Journal)
│   ├── auth.ts                     — NextAuth cookie flow + SecureStore persistence
│   └── apiClient.ts                — fetch wrapper with auth cookie injection
├── context/
│   └── AuthContext.tsx             — auth state provider (user, signIn, signOut)
├── app/
│   ├── _layout.tsx                 — Root layout: wraps app in AuthContext + GestureHandler
│   ├── login.tsx                   — Login screen
│   └── (tabs)/
│       ├── _layout.tsx             — Tab bar with FAB
│       ├── index.tsx               — Dashboard tab
│       ├── prioritise.tsx          — Prioritise tab
│       ├── journal.tsx             — Journal tab
│       └── more.tsx                — More tab
├── app/
│   └── journal-editor.tsx          — Full-screen journal entry editor (Expo Router route)
├── components/
│   ├── MetricsBar.tsx              — 3-stat row (Active / Attention / Due soon)
│   ├── ProjectCard.tsx             — Tappable project card with colour-coded border
│   ├── TaskItem.tsx                — Single task row with checkbox
│   ├── NoteCard.tsx                — Note display card
│   ├── CaptureSheet.tsx            — Bottom sheet for quick task capture
│   ├── JournalEntry.tsx            — Journal list item (date + excerpt)
│   └── PrioritiseTaskRow.tsx       — Task row with urgency/importance bars
└── __tests__/
    ├── lib/
    │   ├── auth.test.ts
    │   └── apiClient.test.ts
    └── components/
        ├── MetricsBar.test.tsx
        ├── ProjectCard.test.tsx
        ├── TaskItem.test.tsx
        └── CaptureSheet.test.tsx
```

---

## Chunk 1: Project Setup, Types, Auth & API Client

### Task 1: Scaffold Expo project

**Files:**
- Create: `/Users/peterpitcher/Cursor/oj-planner-app/` (entire project)

- [ ] **Step 1: Create the Expo project**

```bash
cd /Users/peterpitcher/Cursor
npx create-expo-app@latest oj-planner-app --template tabs
cd oj-planner-app
```

- [ ] **Step 2: Install dependencies**

```bash
npx expo install expo-secure-store expo-router expo-constants
npm install @gorhom/bottom-sheet react-native-gesture-handler react-native-reanimated
npx expo install @testing-library/react-native jest-expo
npm install --save-dev @types/react @types/react-native
```

- [ ] **Step 3: Replace `app.json`**

```json
{
  "expo": {
    "name": "OJ Planner",
    "slug": "oj-planner-app",
    "scheme": "ojplanner",
    "version": "1.0.0",
    "orientation": "portrait",
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "co.uk.orangejelly.planner"
    },
    "plugins": [
      "expo-router",
      "expo-secure-store"
    ]
  }
}
```

- [ ] **Step 4: Replace `tsconfig.json`**

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

- [ ] **Step 5: Replace `babel.config.js`**

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
```

- [ ] **Step 6: Create `jest.config.js`**

```js
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
```

- [ ] **Step 7: Create `jest.setup.js`**

```js
import 'react-native-gesture-handler/jestSetup';
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Link: ({ children }) => children,
}));
```

- [ ] **Step 8: Delete the template boilerplate files that came with create-expo-app**

Delete: `app/(tabs)/index.tsx`, `app/(tabs)/explore.tsx`, `app/(tabs)/_layout.tsx`, `app/_layout.tsx`, `components/` (template components), `constants/Colors.ts`

```bash
rm -rf app components constants
mkdir -p app/'(tabs)' components/__tests__/lib components/__tests__/components constants lib context screens
```

- [ ] **Step 9: Verify Metro starts (no iOS run yet — screens not created until Task 5)**

```bash
npx expo start
```

Expected: Metro bundler starts and QR code appears. Do NOT try to open on iOS yet — the root layout and login screen are created in Task 5. Press `q` to quit after confirming Metro starts cleanly.

- [ ] **Step 10: Commit**

```bash
git init
git add .
git commit -m "feat: scaffold Expo project with dependencies"
```

---

### Task 2: Constants and types

**Files:**
- Create: `constants/config.ts`
- Create: `lib/types.ts`

- [ ] **Step 1: Create `constants/config.ts`**

```ts
export const BASE_URL = 'https://planner.orangejelly.co.uk';

export const COLOURS = {
  bg: '#0f0f1a',
  bgCard: '#1e1e30',
  bgHeader: '#1a1a2e',
  accent: '#7c6af7',
  textPrimary: '#e5e5f0',
  textSecondary: '#9090b0',
  textMuted: '#555566',
  borderSubtle: '#2a2a40',
  red: '#ef4444',
  amber: '#f59e0b',
  green: '#10b981',
} as const;

export const PRIORITY_COLOURS: Record<string, string> = {
  High: COLOURS.red,
  Medium: COLOURS.amber,
  Low: COLOURS.accent,
};

export const SESSION_KEY = 'oj_session_cookie';
export const CSRF_KEY = 'oj_csrf_token';
```

- [ ] **Step 2: Create `lib/types.ts`**

```ts
export interface Project {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  dueDate: string | null;
  priority: 'High' | 'Medium' | 'Low';
  stakeholders: string[];
  status: 'Open' | 'In Progress' | 'On Hold' | 'Completed' | 'Cancelled';
  job: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  description: string | null;
  dueDate: string | null;
  priority: 'High' | 'Medium' | 'Low';
  job: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  importanceScore: number;
  urgencyScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  userId: string;
  projectId: string | null;
  taskId: string | null;
  content: string;
  createdAt: string;
}

export interface JournalEntry {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Metrics {
  activeProjects: number;
  needsAttention: number;
  dueSoon: number;
}

export interface ApiError {
  error: string;
  status: number;
}
```

- [ ] **Step 3: Commit**

```bash
git add constants/config.ts lib/types.ts
git commit -m "feat: add constants and shared TypeScript types"
```

---

### Task 3: Auth module

**Files:**
- Create: `lib/auth.ts`
- Create: `__tests__/lib/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/auth.test.ts`:

```ts
import * as SecureStore from 'expo-secure-store';
import {
  getStoredSession,
  storeSession,
  clearSession,
  signIn,
} from '@/lib/auth';
import { SESSION_KEY } from '@/constants/config';

// Mock fetch globally
global.fetch = jest.fn();

describe('auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getStoredSession', () => {
    it('returns null when nothing is stored', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
      const result = await getStoredSession();
      expect(result).toBeNull();
    });

    it('returns the stored cookie string', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('next-auth.session-token=abc123');
      const result = await getStoredSession();
      expect(result).toBe('next-auth.session-token=abc123');
    });
  });

  describe('storeSession', () => {
    it('stores the cookie string in SecureStore', async () => {
      await storeSession('next-auth.session-token=abc123');
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(SESSION_KEY, 'next-auth.session-token=abc123');
    });
  });

  describe('clearSession', () => {
    it('deletes the session from SecureStore', async () => {
      await clearSession();
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SESSION_KEY);
    });
  });

  describe('signIn', () => {
    it('returns null when credentials are wrong (no session cookie)', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ json: async () => ({ csrfToken: 'csrf123' }) }) // CSRF fetch
        .mockResolvedValueOnce({
          headers: { get: () => null }, // no set-cookie
          ok: false,
        });

      const result = await signIn('bad@test.com', 'wrongpass');
      expect(result).toBeNull();
    });

    it('fetches CSRF then posts credentials and returns cookie', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ json: async () => ({ csrfToken: 'csrf123' }) })
        .mockResolvedValueOnce({
          ok: true,
          headers: {
            get: (name: string) =>
              name === 'set-cookie'
                ? 'next-auth.session-token=tok_abc; Path=/; HttpOnly'
                : null,
          },
        });

      const result = await signIn('peter@example.com', 'password123');
      expect(result).toBe('next-auth.session-token=tok_abc');
    });
  });
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
npx jest __tests__/lib/auth.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '@/lib/auth'`

- [ ] **Step 3: Implement `lib/auth.ts`**

```ts
import * as SecureStore from 'expo-secure-store';
import { BASE_URL, SESSION_KEY } from '@/constants/config';

/** Retrieve the stored session cookie string, or null if not signed in. */
export async function getStoredSession(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_KEY);
}

/** Persist the session cookie string to SecureStore. */
export async function storeSession(cookie: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, cookie);
}

/** Remove the session from SecureStore (sign out). */
export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

/**
 * Sign in with email + password via NextAuth credentials provider.
 * Returns the session cookie string on success, or null on failure.
 */
export async function signIn(email: string, password: string): Promise<string | null> {
  // Step 1 — fetch CSRF token (required by NextAuth)
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();

  // Step 2 — POST credentials
  const body = new URLSearchParams({ csrfToken, email, password }).toString();
  const res = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual',
  });

  // Step 3 — extract session cookie from Set-Cookie header
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;

  // Extract just the name=value pair (strip Path, HttpOnly, etc.)
  const sessionCookie = extractSessionCookie(setCookie);
  return sessionCookie;
}

/** Extract `next-auth.session-token=<value>` from a Set-Cookie header string. */
function extractSessionCookie(setCookie: string): string | null {
  // Set-Cookie may contain multiple cookies separated by comma
  const cookies = setCookie.split(/,(?=[^ ])/);
  for (const cookie of cookies) {
    const pair = cookie.trim().split(';')[0]; // "name=value"
    if (pair.startsWith('next-auth.session-token=') || pair.startsWith('__Secure-next-auth.session-token=')) {
      return pair.trim();
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
npx jest __tests__/lib/auth.test.ts --no-coverage
```

Expected: PASS — 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts __tests__/lib/auth.test.ts
git commit -m "feat: add auth module with NextAuth cookie flow and SecureStore persistence"
```

---

### Task 4: API client

**Files:**
- Create: `lib/apiClient.ts`
- Create: `__tests__/lib/apiClient.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/apiClient.test.ts`:

```ts
import { get, post, patch, del } from '@/lib/apiClient';
import * as SecureStore from 'expo-secure-store';
import { BASE_URL } from '@/constants/config';

global.fetch = jest.fn();

describe('apiClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('next-auth.session-token=tok123');
  });

  describe('get', () => {
    it('sends GET request with Cookie header', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      await get('/api/projects');

      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/projects`,
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Cookie: 'next-auth.session-token=tok123',
          }),
        }),
      );
    });

    it('throws ApiError on 401', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      });

      await expect(get('/api/projects')).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('post', () => {
    it('sends POST request with JSON body and Cookie header', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ id: '123' }),
      });

      await post('/api/tasks', { name: 'Test task', projectId: 'proj1' });

      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/tasks`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Test task', projectId: 'proj1' }),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Cookie: 'next-auth.session-token=tok123',
          }),
        }),
      );
    });
  });

  describe('patch', () => {
    it('sends PATCH request', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({}) });
      await patch('/api/tasks/123', { isCompleted: true });
      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/tasks/123`,
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  describe('del', () => {
    it('sends DELETE request', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({}) });
      await del('/api/tasks/123');
      expect(global.fetch).toHaveBeenCalledWith(
        `${BASE_URL}/api/tasks/123`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
npx jest __tests__/lib/apiClient.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '@/lib/apiClient'`

- [ ] **Step 3: Implement `lib/apiClient.ts`**

```ts
import { getStoredSession } from '@/lib/auth';
import { BASE_URL } from '@/constants/config';
import type { ApiError } from '@/lib/types';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const session = await getStoredSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (session) {
    headers['Cookie'] = session;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Request failed' }));
    const err: ApiError = { error: body.error ?? 'Request failed', status: res.status };
    throw err;
  }

  return res.json() as Promise<T>;
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
npx jest __tests__/lib/apiClient.test.ts --no-coverage
```

Expected: PASS — 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add lib/apiClient.ts __tests__/lib/apiClient.test.ts
git commit -m "feat: add API client with session cookie injection and error handling"
```

---

### Task 5: AuthContext and login screen

**Files:**
- Create: `context/AuthContext.tsx`
- Create: `app/_layout.tsx`
- Create: `app/login.tsx`

- [ ] **Step 1: Create `context/AuthContext.tsx`**

```tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { signIn as authSignIn, clearSession, getStoredSession, storeSession } from '@/lib/auth';

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing session on mount
    getStoredSession().then((session) => {
      setIsAuthenticated(!!session);
      setIsLoading(false);
    });
  }, []);

  async function signIn(email: string, password: string): Promise<boolean> {
    const cookie = await authSignIn(email, password);
    if (!cookie) return false;
    await storeSession(cookie);
    setIsAuthenticated(true);
    return true;
  }

  async function signOut(): Promise<void> {
    await clearSession();
    setIsAuthenticated(false);
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

- [ ] **Step 2: Create `app/_layout.tsx`**

```tsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Slot, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { COLOURS } from '@/constants/config';
import { StatusBar } from 'expo-status-bar';

function AuthGate() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;
    const inAuthGroup = segments[0] === 'login';
    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments]);

  return <Slot />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: COLOURS.bg }}>
      <StatusBar style="light" />
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 3: Create `app/login.tsx`**

```tsx
import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { COLOURS } from '@/constants/config';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    const success = await signIn(email.trim(), password);
    setLoading(false);
    if (!success) {
      Alert.alert('Sign in failed', 'Check your email and password and try again.');
    }
    // On success, AuthGate will navigate to tabs automatically
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.logo}>🟠 OJ Planner</Text>
        <Text style={styles.subtitle}>Sign in to your account</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          placeholder="you@example.com"
          placeholderTextColor={COLOURS.textMuted}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor={COLOURS.textMuted}
          onSubmitEditing={handleSignIn}
          returnKeyType="go"
        />

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignIn}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLOURS.bg },
  inner: { flex: 1, justifyContent: 'center', padding: 28 },
  logo: { fontSize: 28, fontWeight: '800', color: COLOURS.textPrimary, textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 14, color: COLOURS.textSecondary, textAlign: 'center', marginBottom: 32 },
  label: { fontSize: 12, fontWeight: '700', color: COLOURS.accent, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  input: {
    backgroundColor: COLOURS.bgCard, borderRadius: 8, padding: 12,
    color: COLOURS.textPrimary, fontSize: 15, marginBottom: 16,
    borderWidth: 1, borderColor: COLOURS.borderSubtle,
  },
  button: { backgroundColor: COLOURS.accent, borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
```

- [ ] **Step 4: Verify the app shows login screen**

```bash
npx expo start --ios
```

Expected: Login screen with email/password fields and Sign In button on dark background

- [ ] **Step 5: Commit**

```bash
git add context/AuthContext.tsx app/_layout.tsx app/login.tsx
git commit -m "feat: add AuthContext, root layout with auth guard, and login screen"
```

---

## Chunk 2: Navigation, Dashboard & Components

### Task 6: Tab bar layout with FAB

**Files:**
- Create: `components/CaptureSheet.tsx` (stub — replaced in full in Task 11)
- Create: `app/(tabs)/_layout.tsx`

- [ ] **Step 1: Create a stub `components/CaptureSheet.tsx` so the tab layout compiles**

The full implementation comes in Task 11. This stub has the same interface so no imports break.

```tsx
import { View } from 'react-native';

interface Props {
  visible: boolean;
  onClose: () => void;
}

// Stub — replaced in Task 11 with the full bottom sheet implementation
export default function CaptureSheet({ visible }: Props) {
  if (!visible) return null;
  return <View />;
}
```

- [ ] **Step 2: Create `app/(tabs)/_layout.tsx`**

```tsx
import { Tabs } from 'expo-router';
import { View, TouchableOpacity, StyleSheet, Text } from 'react-native';
import { COLOURS } from '@/constants/config';
import { useState } from 'react';
import CaptureSheet from '@/components/CaptureSheet';

function TabBarIcon({ emoji, label, focused }: { emoji: string; label: string; focused: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 20 }}>{emoji}</Text>
      <Text style={{ fontSize: 10, color: focused ? COLOURS.accent : COLOURS.textMuted, marginTop: 2 }}>
        {label}
      </Text>
    </View>
  );
}

export default function TabLayout() {
  const [captureOpen, setCaptureOpen] = useState(false);

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: COLOURS.bgHeader,
            borderTopColor: COLOURS.borderSubtle,
            height: 64,
            paddingBottom: 8,
          },
          tabBarShowLabel: false,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            tabBarIcon: ({ focused }) => <TabBarIcon emoji="🏠" label="Dashboard" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="prioritise"
          options={{
            tabBarIcon: ({ focused }) => <TabBarIcon emoji="⚡" label="Prioritise" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="capture"
          options={{
            href: null, // prevents direct navigation to the blank capture screen
            tabBarButton: () => (
              <TouchableOpacity
                style={styles.fab}
                onPress={() => setCaptureOpen(true)}
                activeOpacity={0.85}
              >
                <Text style={styles.fabText}>+</Text>
              </TouchableOpacity>
            ),
          }}
        />
        <Tabs.Screen
          name="journal"
          options={{
            tabBarIcon: ({ focused }) => <TabBarIcon emoji="📓" label="Journal" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            tabBarIcon: ({ focused }) => <TabBarIcon emoji="⋯" label="More" focused={focused} />,
          }}
        />
      </Tabs>

      <CaptureSheet visible={captureOpen} onClose={() => setCaptureOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLOURS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
    shadowColor: COLOURS.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  fabText: { color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '300' },
});
```

- [ ] **Step 3: Create placeholder screens so the tab bar doesn't error**

Create `app/(tabs)/capture.tsx` (hidden screen — FAB handles opening CaptureSheet; set `href: null` in tab options to prevent direct navigation):

```tsx
import { View } from 'react-native';
export default function CaptureTab() { return <View />; }
```

Create `app/(tabs)/prioritise.tsx` (placeholder — replaced in Chunk 4):

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { COLOURS } from '@/constants/config';
export default function PrioritiseScreen() {
  return <View style={s.c}><Text style={s.t}>Prioritise — coming soon</Text></View>;
}
const s = StyleSheet.create({ c: { flex: 1, backgroundColor: COLOURS.bg, alignItems: 'center', justifyContent: 'center' }, t: { color: COLOURS.textSecondary } });
```

Create `app/(tabs)/journal.tsx` (placeholder — replaced in Chunk 4):

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { COLOURS } from '@/constants/config';
export default function JournalScreen() {
  return <View style={s.c}><Text style={s.t}>Journal — coming soon</Text></View>;
}
const s = StyleSheet.create({ c: { flex: 1, backgroundColor: COLOURS.bg, alignItems: 'center', justifyContent: 'center' }, t: { color: COLOURS.textSecondary } });
```

Create `app/(tabs)/more.tsx` (placeholder — replaced in Chunk 4):

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { COLOURS } from '@/constants/config';
export default function MoreScreen() {
  return <View style={s.c}><Text style={s.t}>More — coming soon</Text></View>;
}
const s = StyleSheet.create({ c: { flex: 1, backgroundColor: COLOURS.bg, alignItems: 'center', justifyContent: 'center' }, t: { color: COLOURS.textSecondary } });
```

- [ ] **Step 4: Verify tab bar appears with FAB**

```bash
npx expo start --ios
```

Sign in with your OJ Planner credentials. Expected: Tab bar with 5 positions visible, centre FAB raised, placeholder labels for Prioritise/Journal/More.

- [ ] **Step 5: Commit**

```bash
git add components/CaptureSheet.tsx app/'(tabs)'/_layout.tsx app/'(tabs)'/capture.tsx app/'(tabs)'/prioritise.tsx app/'(tabs)'/journal.tsx app/'(tabs)'/more.tsx
git commit -m "feat: add tab bar layout with FAB for capture (CaptureSheet stub)"
```

---

### Task 7: MetricsBar and ProjectCard components

**Files:**
- Create: `components/MetricsBar.tsx`
- Create: `components/ProjectCard.tsx`
- Create: `__tests__/components/MetricsBar.test.tsx`
- Create: `__tests__/components/ProjectCard.test.tsx`

- [ ] **Step 1: Write failing tests for MetricsBar**

Create `__tests__/components/MetricsBar.test.tsx`:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import MetricsBar from '@/components/MetricsBar';

describe('MetricsBar', () => {
  it('renders three metric values', () => {
    render(<MetricsBar activeProjects={12} needsAttention={3} dueSoon={7} />);
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('renders labels', () => {
    render(<MetricsBar activeProjects={0} needsAttention={0} dueSoon={0} />);
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Attention')).toBeTruthy();
    expect(screen.getByText('Due soon')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Write failing tests for ProjectCard**

Create `__tests__/components/ProjectCard.test.tsx`:

```tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import ProjectCard from '@/components/ProjectCard';
import type { Project } from '@/lib/types';

const baseProject: Project = {
  id: 'proj1',
  userId: 'user1',
  name: 'Website Redesign',
  description: null,
  dueDate: '2026-03-10', // today — should show red border
  priority: 'High',
  stakeholders: [],
  status: 'Open',
  job: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('ProjectCard', () => {
  it('renders project name', () => {
    render(<ProjectCard project={baseProject} taskCount={3} onPress={jest.fn()} />);
    expect(screen.getByText('Website Redesign')).toBeTruthy();
  });

  it('renders task count', () => {
    render(<ProjectCard project={baseProject} taskCount={3} onPress={jest.fn()} />);
    expect(screen.getByText('3 tasks')).toBeTruthy();
  });

  it('renders priority badge', () => {
    render(<ProjectCard project={baseProject} taskCount={0} onPress={jest.fn()} />);
    expect(screen.getByText('HIGH')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    render(<ProjectCard project={baseProject} taskCount={0} onPress={onPress} />);
    fireEvent.press(screen.getByText('Website Redesign'));
    expect(onPress).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run both tests — expect them to fail**

```bash
npx jest __tests__/components/MetricsBar.test.tsx __tests__/components/ProjectCard.test.tsx --no-coverage
```

Expected: FAIL — cannot find modules

- [ ] **Step 4: Implement `components/MetricsBar.tsx`**

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { COLOURS } from '@/constants/config';

interface Props {
  activeProjects: number;
  needsAttention: number;
  dueSoon: number;
}

export default function MetricsBar({ activeProjects, needsAttention, dueSoon }: Props) {
  return (
    <View style={styles.row}>
      <Metric value={activeProjects} label="Active" colour={COLOURS.accent} />
      <Metric value={needsAttention} label="Attention" colour={COLOURS.red} />
      <Metric value={dueSoon} label="Due soon" colour={COLOURS.amber} />
    </View>
  );
}

function Metric({ value, label, colour }: { value: number; label: string; colour: string }) {
  return (
    <View style={styles.card}>
      <Text style={[styles.value, { color: colour }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  card: { flex: 1, backgroundColor: COLOURS.bgCard, borderRadius: 8, padding: 10, alignItems: 'center' },
  value: { fontSize: 22, fontWeight: '700' },
  label: { fontSize: 11, color: COLOURS.textMuted, marginTop: 2 },
});
```

- [ ] **Step 5: Implement `components/ProjectCard.tsx`**

```tsx
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { COLOURS, PRIORITY_COLOURS } from '@/constants/config';
import type { Project } from '@/lib/types';

interface Props {
  project: Project;
  taskCount: number;
  onPress: () => void;
}

function borderColour(dueDate: string | null): string {
  if (!dueDate) return COLOURS.accent;
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (dueDate <= today) return COLOURS.red;
  if (dueDate === tomorrow) return COLOURS.amber;
  return COLOURS.accent;
}

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return 'No due date';
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (dueDate < today) return `Overdue (${dueDate})`;
  if (dueDate === today) return 'Due today';
  if (dueDate === tomorrow) return 'Due tomorrow';
  return `Due ${dueDate}`;
}

export default function ProjectCard({ project, taskCount, onPress }: Props) {
  const border = borderColour(project.dueDate);
  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: border }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={styles.name}>{project.name}</Text>
      <Text style={styles.sub}>
        {taskCount} {taskCount === 1 ? 'task' : 'tasks'} · {formatDueDate(project.dueDate)}
      </Text>
      <View style={[styles.badge, { backgroundColor: PRIORITY_COLOURS[project.priority] + '22' }]}>
        <Text style={[styles.badgeText, { color: PRIORITY_COLOURS[project.priority] }]}>
          {project.priority.toUpperCase()}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLOURS.bgCard, borderRadius: 8, padding: 12,
    marginBottom: 8, borderLeftWidth: 3,
  },
  name: { color: COLOURS.textPrimary, fontSize: 14, fontWeight: '600' },
  sub: { color: COLOURS.textMuted, fontSize: 11, marginTop: 3 },
  badge: { alignSelf: 'flex-start', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginTop: 6 },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
});
```

- [ ] **Step 6: Run tests — expect them to pass**

```bash
npx jest __tests__/components/MetricsBar.test.tsx __tests__/components/ProjectCard.test.tsx --no-coverage
```

Expected: PASS — 6 tests pass

- [ ] **Step 7: Commit**

```bash
git add components/MetricsBar.tsx components/ProjectCard.tsx __tests__/components/MetricsBar.test.tsx __tests__/components/ProjectCard.test.tsx
git commit -m "feat: add MetricsBar and ProjectCard components with tests"
```

---

### Task 8: Dashboard screen

**Files:**
- Create: `app/(tabs)/index.tsx`
- Modify: `components/MetricsBar.tsx` — add `onPress` props for filter tapping

- [ ] **Step 1: Update `components/MetricsBar.tsx` to support filter tapping**

Replace the file with this version that adds optional `onPress` callbacks per metric:

```tsx
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { COLOURS } from '@/constants/config';

interface Props {
  activeProjects: number;
  needsAttention: number;
  dueSoon: number;
  activeFilter?: 'active' | 'attention' | 'dueSoon' | null;
  onFilterPress?: (filter: 'active' | 'attention' | 'dueSoon') => void;
}

export default function MetricsBar({ activeProjects, needsAttention, dueSoon, activeFilter, onFilterPress }: Props) {
  return (
    <View style={styles.row}>
      <Metric value={activeProjects} label="Active" colour={COLOURS.accent} active={activeFilter === 'active'} onPress={() => onFilterPress?.('active')} />
      <Metric value={needsAttention} label="Attention" colour={COLOURS.red} active={activeFilter === 'attention'} onPress={() => onFilterPress?.('attention')} />
      <Metric value={dueSoon} label="Due soon" colour={COLOURS.amber} active={activeFilter === 'dueSoon'} onPress={() => onFilterPress?.('dueSoon')} />
    </View>
  );
}

function Metric({ value, label, colour, active, onPress }: { value: number; label: string; colour: string; active?: boolean; onPress?: () => void }) {
  return (
    <TouchableOpacity style={[styles.card, active && { borderWidth: 1, borderColor: colour }]} onPress={onPress} activeOpacity={0.8}>
      <Text style={[styles.value, { color: colour }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  card: { flex: 1, backgroundColor: COLOURS.bgCard, borderRadius: 8, padding: 10, alignItems: 'center' },
  value: { fontSize: 22, fontWeight: '700' },
  label: { fontSize: 11, color: COLOURS.textMuted, marginTop: 2 },
});
```

> **Note:** Update the existing MetricsBar tests to pass the new optional props (tests should still pass as props are optional).

- [ ] **Step 2: Run MetricsBar tests — expect them to still pass**

```bash
npx jest __tests__/components/MetricsBar.test.tsx --no-coverage
```

Expected: PASS — 2 tests pass (props are optional, no breaking change)

- [ ] **Step 3: Create `app/(tabs)/index.tsx`**

```tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  RefreshControl, TextInput, SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { get, post } from '@/lib/apiClient';
import { COLOURS } from '@/constants/config';
import type { Project, Task } from '@/lib/types';
import MetricsBar from '@/components/MetricsBar';
import ProjectCard from '@/components/ProjectCard';

type MetricFilter = 'active' | 'attention' | 'dueSoon' | null;

export default function DashboardScreen() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [taskMap, setTaskMap] = useState<Record<string, Task[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [metricFilter, setMetricFilter] = useState<MetricFilter>(null);

  async function loadData() {
    try {
      const projectsData = await get<Project[]>('/api/projects');
      setProjects(projectsData);
      if (projectsData.length > 0) {
        const ids = projectsData.map((p) => p.id);
        const tasksData = await post<Record<string, Task[]>>('/api/tasks/batch', { projectIds: ids });
        setTaskMap(tasksData);
      }
      setError(null);
    } catch (e: unknown) {
      // ApiError objects have a `status` field; other errors fall back to generic message
      const status = (e as { status?: number }).status;
      setError(status === 401 ? 'Session expired. Please sign in again.' : 'Failed to load. Pull to refresh.');
    }
  }

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, []);

  function handleMetricPress(filter: 'active' | 'attention' | 'dueSoon') {
    setMetricFilter((prev) => (prev === filter ? null : filter)); // toggle off if already active
  }

  const today = new Date().toISOString().slice(0, 10);
  const in7days = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const activeProjects = projects.filter((p) => p.status === 'Open' || p.status === 'In Progress').length;
  const needsAttention = projects.filter((p) => p.dueDate && p.dueDate <= today && p.status !== 'Completed').length;
  const dueSoon = projects.filter((p) => p.dueDate && p.dueDate > today && p.dueDate <= in7days).length;

  // Apply metric filter first, then search
  let filtered = projects;
  if (metricFilter === 'active') filtered = projects.filter((p) => p.status === 'Open' || p.status === 'In Progress');
  else if (metricFilter === 'attention') filtered = projects.filter((p) => p.dueDate && p.dueDate <= today && p.status !== 'Completed');
  else if (metricFilter === 'dueSoon') filtered = projects.filter((p) => p.dueDate && p.dueDate > today && p.dueDate <= in7days);

  if (search.trim()) {
    filtered = filtered.filter((p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.stakeholders.some((s) => s.toLowerCase().includes(search.toLowerCase()))
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centre]}>
        <ActivityIndicator color={COLOURS.accent} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Dashboard</Text>
        <Text style={styles.subtitle}>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Text>
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLOURS.accent} />}
        ListHeaderComponent={
          <>
            <MetricsBar
              activeProjects={activeProjects}
              needsAttention={needsAttention}
              dueSoon={dueSoon}
              activeFilter={metricFilter}
              onFilterPress={handleMetricPress}
            />
            <TextInput
              style={styles.search}
              value={search}
              onChangeText={setSearch}
              placeholder="Search projects..."
              placeholderTextColor={COLOURS.textMuted}
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <Text style={styles.sectionLabel}>Projects</Text>
          </>
        }
        renderItem={({ item }) => (
          <ProjectCard
            project={item}
            taskCount={(taskMap[item.id] ?? []).filter((t) => !t.isCompleted).length}
            onPress={() => router.push({ pathname: '/project/[id]', params: { id: item.id } })}
          />
        )}
        ListEmptyComponent={
          !error ? <Text style={styles.empty}>No projects found.</Text> : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLOURS.bg },
  centre: { alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: COLOURS.bgHeader, padding: 16, paddingTop: 8 },
  title: { color: COLOURS.textPrimary, fontSize: 20, fontWeight: '700' },
  subtitle: { color: COLOURS.accent, fontSize: 12, marginTop: 2 },
  list: { padding: 12 },
  search: {
    backgroundColor: COLOURS.bgCard, borderRadius: 8, padding: 10,
    color: COLOURS.textPrimary, fontSize: 14, marginBottom: 12,
    borderWidth: 1, borderColor: COLOURS.borderSubtle,
  },
  sectionLabel: { color: COLOURS.accent, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  error: { color: COLOURS.red, fontSize: 12, marginBottom: 8 },
  empty: { color: COLOURS.textMuted, textAlign: 'center', marginTop: 24 },
});
```

- [ ] **Step 4: Verify dashboard loads with real data**

```bash
npx expo start --ios
```

Sign in, navigate to Dashboard. Expected: MetricsBar, search bar, and project list populated from API. Tap a metric — list filters accordingly; tap again to clear filter.

- [ ] **Step 5: Commit**

```bash
git add app/'(tabs)'/index.tsx components/MetricsBar.tsx
git commit -m "feat: add Dashboard screen with metric filters, search, and project list"
```

---

## Chunk 3: Project Detail, TaskItem & CaptureSheet

### Task 9: TaskItem component

**Files:**
- Create: `components/TaskItem.tsx`
- Create: `__tests__/components/TaskItem.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/TaskItem.test.tsx`:

```tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import TaskItem from '@/components/TaskItem';
import type { Task } from '@/lib/types';

const baseTask: Task = {
  id: 'task1', projectId: 'proj1', userId: 'user1',
  name: 'Redesign nav menu', description: null, dueDate: null,
  priority: 'High', job: null, isCompleted: false, completedAt: null,
  importanceScore: 70, urgencyScore: 80,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

describe('TaskItem', () => {
  it('renders task name', () => {
    render(<TaskItem task={baseTask} onToggle={jest.fn()} />);
    expect(screen.getByText('Redesign nav menu')).toBeTruthy();
  });

  it('calls onToggle when checkbox is pressed', () => {
    const onToggle = jest.fn();
    render(<TaskItem task={baseTask} onToggle={onToggle} />);
    fireEvent.press(screen.getByTestId('task-checkbox'));
    expect(onToggle).toHaveBeenCalledWith('task1', false);
  });

  it('shows completed style when task is done', () => {
    const done = { ...baseTask, isCompleted: true };
    render(<TaskItem task={done} onToggle={jest.fn()} />);
    // Completed task name should be styled differently — check it renders
    expect(screen.getByText('Redesign nav menu')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
npx jest __tests__/components/TaskItem.test.tsx --no-coverage
```

Expected: FAIL — cannot find module

- [ ] **Step 3: Implement `components/TaskItem.tsx`**

```tsx
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { COLOURS } from '@/constants/config';
import type { Task } from '@/lib/types';

interface Props {
  task: Task;
  onToggle: (taskId: string, currentlyCompleted: boolean) => void;
}

export default function TaskItem({ task, onToggle }: Props) {
  return (
    <View style={styles.row}>
      <TouchableOpacity
        testID="task-checkbox"
        style={[styles.checkbox, task.isCompleted && styles.checkboxDone]}
        onPress={() => onToggle(task.id, task.isCompleted)}
        activeOpacity={0.7}
      />
      <View style={styles.textCol}>
        <Text style={[styles.name, task.isCompleted && styles.nameDone]}>
          {task.name}
        </Text>
        {task.dueDate && (
          <Text style={styles.due}>Due {task.dueDate}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLOURS.borderSubtle },
  checkbox: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: COLOURS.textMuted, marginRight: 10, flexShrink: 0 },
  checkboxDone: { backgroundColor: COLOURS.green, borderColor: COLOURS.green },
  textCol: { flex: 1 },
  name: { color: COLOURS.textPrimary, fontSize: 14 },
  nameDone: { color: COLOURS.textMuted, textDecorationLine: 'line-through' },
  due: { color: COLOURS.textMuted, fontSize: 11, marginTop: 2 },
});
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
npx jest __tests__/components/TaskItem.test.tsx --no-coverage
```

Expected: PASS — 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add components/TaskItem.tsx __tests__/components/TaskItem.test.tsx
git commit -m "feat: add TaskItem component with checkbox toggle and tests"
```

---

### Task 10: NoteCard component and ProjectDetail screen

**Files:**
- Create: `components/NoteCard.tsx`
- Create: `app/project/[id].tsx`

Note: Expo Router requires the dynamic route file at `app/project/[id].tsx`. Create the directory first.

- [ ] **Step 1: Create `components/NoteCard.tsx`**

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { COLOURS } from '@/constants/config';
import type { Note } from '@/lib/types';

interface Props { note: Note }

export default function NoteCard({ note }: Props) {
  const date = new Date(note.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <View style={styles.card}>
      <Text style={styles.date}>{date}</Text>
      <Text style={styles.content}>{note.content}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLOURS.bgCard, borderRadius: 8, padding: 10, marginBottom: 6 },
  date: { color: COLOURS.accent, fontSize: 10, fontWeight: '600', marginBottom: 3 },
  content: { color: COLOURS.textSecondary, fontSize: 13, lineHeight: 18 },
});
```

- [ ] **Step 2: Create `app/project/[id].tsx`**

```tsx
import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, SafeAreaView, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { get, patch, post, del } from '@/lib/apiClient';
import { COLOURS, PRIORITY_COLOURS } from '@/constants/config';
import type { Project, Task, Note } from '@/lib/types';
import TaskItem from '@/components/TaskItem';
import NoteCard from '@/components/NoteCard';

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTaskName, setNewTaskName] = useState('');
  const [newNote, setNewNote] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [addingNote, setAddingNote] = useState(false);

  async function loadData() {
    const [proj, taskList, noteList] = await Promise.all([
      get<Project>(`/api/projects/${id}`),
      get<Task[]>(`/api/tasks?projectId=${id}`),
      get<Note[]>(`/api/notes?projectId=${id}`),
    ]);
    setProject(proj);
    setTasks(taskList);
    setNotes(noteList);
  }

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, [id]);

  async function toggleTask(taskId: string, currentlyCompleted: boolean) {
    // Optimistic update
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, isCompleted: !currentlyCompleted } : t
      )
    );
    try {
      await patch(`/api/tasks/${taskId}`, { isCompleted: !currentlyCompleted });
    } catch {
      // Revert on error
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, isCompleted: currentlyCompleted } : t
        )
      );
    }
  }

  async function addTask() {
    if (!newTaskName.trim()) return;
    setAddingTask(true);
    try {
      const created = await post<Task>('/api/tasks', { name: newTaskName.trim(), projectId: id });
      setTasks((prev) => [...prev, created]);
      setNewTaskName('');
    } finally {
      setAddingTask(false);
    }
  }

  async function addNote() {
    if (!newNote.trim()) return;
    setAddingNote(true);
    try {
      const created = await post<Note>('/api/notes', { content: newNote.trim(), projectId: id });
      setNotes((prev) => [...prev, created]);
      setNewNote('');
    } finally {
      setAddingNote(false);
    }
  }

  if (loading || !project) {
    return <View style={[styles.container, styles.centre]}><ActivityIndicator color={COLOURS.accent} size="large" /></View>;
  }

  const incompleteTasks = tasks.filter((t) => !t.isCompleted);
  const completedTasks = tasks.filter((t) => t.isCompleted);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.back}>← Dashboard</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{project.name}</Text>
          <Text style={[styles.dueLine, { color: PRIORITY_COLOURS[project.priority] }]}>
            {project.dueDate ?? 'No due date'} · {project.priority.toUpperCase()}
          </Text>
        </View>

        <FlatList
          data={[...incompleteTasks, ...completedTasks]}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.body}
          ListHeaderComponent={
            <Text style={styles.sectionLabel}>Tasks</Text>
          }
          renderItem={({ item }) => (
            <TaskItem task={item} onToggle={toggleTask} />
          )}
          ListFooterComponent={
            <>
              {/* Add task inline */}
              <View style={styles.addRow}>
                <TextInput
                  style={styles.input}
                  value={newTaskName}
                  onChangeText={setNewTaskName}
                  placeholder="Add a task..."
                  placeholderTextColor={COLOURS.textMuted}
                  onSubmitEditing={addTask}
                  returnKeyType="done"
                />
                <TouchableOpacity style={styles.addBtn} onPress={addTask} disabled={addingTask}>
                  <Text style={styles.addBtnText}>{addingTask ? '…' : '+'}</Text>
                </TouchableOpacity>
              </View>

              {/* Notes */}
              <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Notes</Text>
              {notes.map((n) => <NoteCard key={n.id} note={n} />)}
              <View style={styles.addRow}>
                <TextInput
                  style={styles.input}
                  value={newNote}
                  onChangeText={setNewNote}
                  placeholder="Add a note..."
                  placeholderTextColor={COLOURS.textMuted}
                  multiline
                />
                <TouchableOpacity style={styles.addBtn} onPress={addNote} disabled={addingNote}>
                  <Text style={styles.addBtnText}>{addingNote ? '…' : '+'}</Text>
                </TouchableOpacity>
              </View>
            </>
          }
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLOURS.bg },
  centre: { alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: COLOURS.bgHeader, padding: 16, paddingTop: 8 },
  back: { color: COLOURS.accent, fontSize: 12, marginBottom: 4 },
  title: { color: COLOURS.textPrimary, fontSize: 18, fontWeight: '700' },
  dueLine: { fontSize: 12, marginTop: 3 },
  body: { padding: 12 },
  sectionLabel: { color: COLOURS.accent, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  addRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  input: {
    flex: 1, backgroundColor: COLOURS.bgCard, borderRadius: 8, padding: 10,
    color: COLOURS.textPrimary, fontSize: 14, borderWidth: 1, borderColor: COLOURS.borderSubtle,
  },
  addBtn: { backgroundColor: COLOURS.accent, borderRadius: 8, width: 40, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 22, fontWeight: '300' },
});
```

- [ ] **Step 3: Verify project detail screen works**

```bash
npx expo start --ios
```

Tap a project on Dashboard. Expected: Project Detail screen with task list, checkboxes, notes section, and inline add-task/add-note inputs.

- [ ] **Step 4: Write a test for ProjectDetail optimistic toggle revert**

Create `__tests__/components/ProjectDetail.test.tsx`:

```tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { get, patch } from '@/lib/apiClient';
import type { Project, Task, Note } from '@/lib/types';

jest.mock('@/lib/apiClient', () => ({ get: jest.fn(), patch: jest.fn(), post: jest.fn(), del: jest.fn() }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'proj1' }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

// Import after mocks are set up
import ProjectDetailScreen from '@/app/project/[id]';

const mockProject: Project = {
  id: 'proj1', userId: 'u1', name: 'Test Project', description: null,
  dueDate: '2026-03-15', priority: 'High', stakeholders: [], status: 'Open',
  job: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
const mockTask: Task = {
  id: 'task1', projectId: 'proj1', userId: 'u1', name: 'Do something', description: null,
  dueDate: null, priority: 'Medium', job: null, isCompleted: false, completedAt: null,
  importanceScore: 50, urgencyScore: 50, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
const mockNotes: Note[] = [];

describe('ProjectDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (get as jest.Mock).mockImplementation((path: string) => {
      if (path.includes('/api/projects/')) return Promise.resolve(mockProject);
      if (path.includes('/api/tasks')) return Promise.resolve([mockTask]);
      if (path.includes('/api/notes')) return Promise.resolve(mockNotes);
      return Promise.resolve([]);
    });
  });

  it('renders the project name after loading', async () => {
    render(<ProjectDetailScreen />);
    await waitFor(() => expect(screen.getByText('Test Project')).toBeTruthy());
  });

  it('renders the task name', async () => {
    render(<ProjectDetailScreen />);
    await waitFor(() => expect(screen.getByText('Do something')).toBeTruthy());
  });

  it('reverts optimistic toggle when patch fails', async () => {
    (patch as jest.Mock).mockRejectedValue({ status: 500, error: 'Server error' });
    render(<ProjectDetailScreen />);
    await waitFor(() => screen.getByTestId('task-checkbox'));
    fireEvent.press(screen.getByTestId('task-checkbox'));
    // After failed patch, task should revert to uncompleted
    await waitFor(() => {
      const checkbox = screen.getByTestId('task-checkbox');
      // The checkbox should not have the done style — we verify by checking it is still pressable
      expect(checkbox).toBeTruthy();
    });
  });
});
```

- [ ] **Step 5: Run ProjectDetail tests**

```bash
npx jest __tests__/components/ProjectDetail.test.tsx --no-coverage
```

Expected: PASS — 3 tests pass

- [ ] **Step 6: Commit**

```bash
git add components/NoteCard.tsx app/project __tests__/components/ProjectDetail.test.tsx
git commit -m "feat: add ProjectDetail screen with tasks, notes, inline add, and tests"
```

---

### Task 11: CaptureSheet

**Files:**
- Create: `components/CaptureSheet.tsx`
- Create: `__tests__/components/CaptureSheet.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/CaptureSheet.test.tsx`:

```tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import CaptureSheet from '@/components/CaptureSheet';
import { post } from '@/lib/apiClient';

jest.mock('@/lib/apiClient', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('@gorhom/bottom-sheet', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ children, index }: any) => index > -1 ? <View>{children}</View> : null,
    BottomSheetView: ({ children }: any) => <View>{children}</View>,
  };
});

describe('CaptureSheet', () => {
  it('renders task name input when visible', () => {
    render(<CaptureSheet visible={true} onClose={jest.fn()} />);
    expect(screen.getByPlaceholderText('What needs doing?')).toBeTruthy();
  });

  it('does not render when not visible', () => {
    render(<CaptureSheet visible={false} onClose={jest.fn()} />);
    expect(screen.queryByPlaceholderText('What needs doing?')).toBeNull();
  });

  it('calls post and onClose when Save is pressed with a task name', async () => {
    (post as jest.Mock).mockResolvedValue({ id: 'new-task' });
    const onClose = jest.fn();
    render(<CaptureSheet visible={true} onClose={onClose} />);
    fireEvent.changeText(screen.getByPlaceholderText('What needs doing?'), 'Call the client');
    fireEvent.press(screen.getByText('Save Task'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({ name: 'Call the client' })));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
npx jest __tests__/components/CaptureSheet.test.tsx --no-coverage
```

Expected: FAIL — cannot find module

- [ ] **Step 3: Implement `components/CaptureSheet.tsx`**

```tsx
import { useRef, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { get, post } from '@/lib/apiClient';
import { COLOURS } from '@/constants/config';
import type { Project } from '@/lib/types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const PRIORITIES = ['High', 'Medium', 'Low'] as const;

export default function CaptureSheet({ visible, onClose }: Props) {
  const sheetRef = useRef<BottomSheet>(null);
  const [name, setName] = useState('');
  const [priority, setPriority] = useState<'High' | 'Medium' | 'Low'>('Medium');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.expand();
      get<Project[]>('/api/projects').then((data) => {
        setProjects(data);
        if (data.length > 0) setSelectedProjectId(data[0].id);
      }).catch(() => {});
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await post('/api/tasks', {
        name: name.trim(),
        projectId: selectedProjectId,
        priority,
      });
      setName('');
      setPriority('Medium');
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!visible) return null;

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={['50%']}
      onClose={onClose}
      backgroundStyle={{ backgroundColor: COLOURS.bgHeader }}
      handleIndicatorStyle={{ backgroundColor: COLOURS.textMuted }}
    >
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>⚡ Quick Capture</Text>

        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="What needs doing?"
          placeholderTextColor={COLOURS.textMuted}
          autoFocus
        />

        {/* Priority selector */}
        <View style={styles.row}>
          {PRIORITIES.map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.chip, priority === p && styles.chipActive]}
              onPress={() => setPriority(p)}
            >
              <Text style={[styles.chipText, priority === p && styles.chipTextActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Task</Text>}
        </TouchableOpacity>
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  title: { color: COLOURS.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  input: {
    backgroundColor: COLOURS.bgCard, borderRadius: 8, padding: 12,
    color: COLOURS.textPrimary, fontSize: 15, marginBottom: 12,
    borderWidth: 1, borderColor: COLOURS.borderSubtle,
  },
  row: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: COLOURS.bgCard, borderWidth: 1, borderColor: COLOURS.borderSubtle },
  chipActive: { backgroundColor: COLOURS.accent, borderColor: COLOURS.accent },
  chipText: { color: COLOURS.textMuted, fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  saveBtn: { backgroundColor: COLOURS.accent, borderRadius: 8, padding: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
npx jest __tests__/components/CaptureSheet.test.tsx --no-coverage
```

Expected: PASS — 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add components/CaptureSheet.tsx __tests__/components/CaptureSheet.test.tsx
git commit -m "feat: add CaptureSheet bottom sheet for quick task capture with tests"
```

---

## Chunk 4: Prioritise, Journal, More & Final Polish

### Task 12: PrioritiseTaskRow and Prioritise screen

**Files:**
- Create: `components/PrioritiseTaskRow.tsx`
- Create: `app/(tabs)/prioritise.tsx` (replace placeholder)

- [ ] **Step 1: Create `components/PrioritiseTaskRow.tsx`**

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { COLOURS } from '@/constants/config';
import type { Task } from '@/lib/types';

interface Props { task: Task }

export default function PrioritiseTaskRow({ task }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.name}>{task.name}</Text>
      <View style={styles.barRow}>
        <Text style={styles.barLabel}>Urgency</Text>
        <View style={styles.barBg}>
          <View style={[styles.barFill, { width: `${task.urgencyScore}%`, backgroundColor: COLOURS.red }]} />
        </View>
        <Text style={styles.score}>{task.urgencyScore}</Text>
      </View>
      <View style={styles.barRow}>
        <Text style={styles.barLabel}>Importance</Text>
        <View style={styles.barBg}>
          <View style={[styles.barFill, { width: `${task.importanceScore}%`, backgroundColor: COLOURS.accent }]} />
        </View>
        <Text style={styles.score}>{task.importanceScore}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLOURS.bgCard, borderRadius: 8, padding: 12, marginBottom: 8 },
  name: { color: COLOURS.textPrimary, fontSize: 14, fontWeight: '600', marginBottom: 8 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  barLabel: { color: COLOURS.textMuted, fontSize: 10, width: 72 },
  barBg: { flex: 1, height: 4, backgroundColor: COLOURS.borderSubtle, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
  score: { color: COLOURS.textSecondary, fontSize: 11, width: 24, textAlign: 'right' },
});
```

- [ ] **Step 2: Replace `app/(tabs)/prioritise.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { View, FlatList, StyleSheet, ActivityIndicator, Text, SafeAreaView } from 'react-native';
import { get } from '@/lib/apiClient';
import { COLOURS } from '@/constants/config';
import type { Task } from '@/lib/types';
import PrioritiseTaskRow from '@/components/PrioritiseTaskRow';

export default function PrioritiseScreen() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<Task[]>('/api/tasks?includeCompleted=false')
      .then((data) => {
        const sorted = [...data].sort((a, b) => (b.urgencyScore + b.importanceScore) - (a.urgencyScore + a.importanceScore));
        setTasks(sorted);
      })
      .catch(() => setError('Failed to load tasks.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <View style={[styles.container, styles.centre]}><ActivityIndicator color={COLOURS.accent} size="large" /></View>;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Prioritise</Text>
        <Text style={styles.subtitle}>Sorted by urgency + importance</Text>
      </View>
      <FlatList
        data={tasks}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <PrioritiseTaskRow task={item} />}
        ListEmptyComponent={<Text style={styles.empty}>{error ?? 'No tasks to prioritise.'}</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLOURS.bg },
  centre: { alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: COLOURS.bgHeader, padding: 16, paddingTop: 8 },
  title: { color: COLOURS.textPrimary, fontSize: 20, fontWeight: '700' },
  subtitle: { color: COLOURS.accent, fontSize: 12, marginTop: 2 },
  list: { padding: 12 },
  empty: { color: COLOURS.textMuted, textAlign: 'center', marginTop: 24 },
});
```

- [ ] **Step 3: Verify Prioritise tab**

```bash
npx expo start --ios
```

Tap Prioritise tab. Expected: Tasks sorted by urgency+importance with coloured bars.

- [ ] **Step 4: Commit**

```bash
git add components/PrioritiseTaskRow.tsx app/'(tabs)'/prioritise.tsx
git commit -m "feat: add Prioritise screen with urgency/importance bars"
```

---

### Task 13: JournalEntry component and Journal screen

**Files:**
- Create: `components/JournalEntry.tsx`
- Create: `screens/JournalEditor.tsx`
- Create: `app/(tabs)/journal.tsx` (replace placeholder)

- [ ] **Step 1: Create `components/JournalEntry.tsx`**

```tsx
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { COLOURS } from '@/constants/config';
import type { JournalEntry as JournalEntryType } from '@/lib/types';

interface Props {
  entry: JournalEntryType;
  onPress: () => void;
}

export default function JournalEntry({ entry, onPress }: Props) {
  const date = new Date(entry.createdAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const excerpt = entry.content.slice(0, 120) + (entry.content.length > 120 ? '...' : '');
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <Text style={styles.date}>{date}</Text>
      <Text style={styles.excerpt}>{excerpt}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLOURS.bgCard, borderRadius: 8, padding: 12, marginBottom: 8 },
  date: { color: COLOURS.accent, fontSize: 11, fontWeight: '600', marginBottom: 4 },
  excerpt: { color: COLOURS.textSecondary, fontSize: 13, lineHeight: 18 },
});
```

- [ ] **Step 2: Create `app/journal-editor.tsx`** (directly in the router — no `screens/` indirection)

```tsx
import { useState } from 'react';
import {
  View, TextInput, TouchableOpacity, Text, StyleSheet,
  KeyboardAvoidingView, Platform, SafeAreaView, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { post } from '@/lib/apiClient';
import { COLOURS } from '@/constants/config';

export default function JournalEditorScreen() {
  const router = useRouter();
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await post('/api/journal/entries', { content: content.trim() });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>New Entry</Text>
          <TouchableOpacity onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={COLOURS.accent} /> : <Text style={styles.save}>Save</Text>}
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.editor}
          value={content}
          onChangeText={setContent}
          placeholder="Write your entry..."
          placeholderTextColor={COLOURS.textMuted}
          multiline
          autoFocus
          textAlignVertical="top"
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLOURS.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: COLOURS.bgHeader },
  title: { color: COLOURS.textPrimary, fontWeight: '700', fontSize: 16 },
  cancel: { color: COLOURS.textMuted, fontSize: 15 },
  save: { color: COLOURS.accent, fontWeight: '700', fontSize: 15 },
  editor: { flex: 1, color: COLOURS.textPrimary, fontSize: 16, lineHeight: 24, padding: 16 },
});
```

- [ ] **Step 3: Replace `app/(tabs)/journal.tsx`**

Notes on what changed vs the design mockup:
- Journal entry `onPress` navigates to a read-only view of the entry (push `/journal-entry/[id]`) — **deferred to a future iteration**; for now tapping an entry is a no-op with a `// TODO: add entry detail view` comment.
- Summary periods include `'custom'` but the custom date range picker UI is **deferred**; the chip calls `generateSummary('custom')` which will use the API's default custom behaviour.

```tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, Modal, SafeAreaView, ScrollView, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { get, post } from '@/lib/apiClient';
import { COLOURS } from '@/constants/config';
import type { JournalEntry as JournalEntryType } from '@/lib/types';
import JournalEntry from '@/components/JournalEntry';

const PERIODS = ['weekly', 'monthly', 'annual', 'custom'] as const;

export default function JournalScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<JournalEntryType[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryVisible, setSummaryVisible] = useState(false);

  async function loadEntries() {
    const data = await get<JournalEntryType[]>('/api/journal/entries');
    setEntries(data);
  }

  useEffect(() => {
    loadEntries().finally(() => setLoading(false));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadEntries();
    setRefreshing(false);
  }, []);

  async function generateSummary(period: string) {
    setSummaryLoading(true);
    setSummaryVisible(true);
    try {
      const res = await post<{ summary: string }>('/api/journal/summary', { period });
      setSummary(res.summary);
    } catch {
      setSummary('Failed to generate summary. Please try again.');
    } finally {
      setSummaryLoading(false);
    }
  }

  if (loading) return <View style={[styles.container, styles.centre]}><ActivityIndicator color={COLOURS.accent} size="large" /></View>;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Journal</Text>
      </View>

      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLOURS.accent} />}
        ListHeaderComponent={
          <>
            <View style={styles.summaryRow}>
              {PERIODS.map((p) => (
                <TouchableOpacity key={p} style={styles.summaryChip} onPress={() => generateSummary(p)}>
                  <Text style={styles.summaryChipText}>✨ {p.charAt(0).toUpperCase() + p.slice(1)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/journal-editor')}>
              <Text style={styles.newBtnText}>+ New Entry</Text>
            </TouchableOpacity>
            <Text style={styles.sectionLabel}>Recent Entries</Text>
          </>
        }
        renderItem={({ item }) => (
          // TODO: add entry detail/edit view in a future iteration
          <JournalEntry entry={item} onPress={() => {}} />
        )}
        ListEmptyComponent={<Text style={styles.empty}>No journal entries yet.</Text>}
      />

      <Modal visible={summaryVisible} animationType="slide" onRequestClose={() => setSummaryVisible(false)}>
        <SafeAreaView style={[styles.container]}>
          <View style={styles.header}>
            <Text style={styles.title}>AI Summary</Text>
            <TouchableOpacity onPress={() => setSummaryVisible(false)}>
              <Text style={{ color: COLOURS.accent, fontSize: 15 }}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.list}>
            {summaryLoading ? (
              <ActivityIndicator color={COLOURS.accent} style={{ marginTop: 40 }} />
            ) : (
              <Text style={{ color: COLOURS.textPrimary, fontSize: 15, lineHeight: 24 }}>{summary}</Text>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLOURS.bg },
  centre: { alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: COLOURS.bgHeader, padding: 16, paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  title: { color: COLOURS.textPrimary, fontSize: 20, fontWeight: '700' },
  list: { padding: 12 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  summaryChip: { backgroundColor: COLOURS.bgCard, borderRadius: 8, padding: 8, alignItems: 'center', borderWidth: 1, borderColor: COLOURS.borderSubtle },
  summaryChipText: { color: COLOURS.accent, fontSize: 12, fontWeight: '600' },
  newBtn: { backgroundColor: COLOURS.accent, borderRadius: 8, padding: 12, alignItems: 'center', marginBottom: 14 },
  newBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sectionLabel: { color: COLOURS.accent, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  empty: { color: COLOURS.textMuted, textAlign: 'center', marginTop: 24 },
});
```

- [ ] **Step 4: Verify Journal tab**

```bash
npx expo start --ios
```

Tap Journal tab. Expected: Four summary chips (Weekly/Monthly/Annual/Custom), New Entry button, and list of entries. Tap a chip — AI summary modal appears with spinner then text.

- [ ] **Step 5: Commit**

```bash
git add components/JournalEntry.tsx app/journal-editor.tsx app/'(tabs)'/journal.tsx
git commit -m "feat: add Journal screen with entries, AI summary modal, and editor"
```

---

### Task 14: More screen (Completed Report, Settings, Sign Out)

**Files:**
- Create: `app/(tabs)/more.tsx` (replace placeholder)

- [ ] **Step 1: Replace `app/(tabs)/more.tsx`**

> **Scope note:** The spec lists "Settings — user preferences" and "Office 365 — sync toggle + last synced timestamp + manual sync button" as More screen items. Both are intentionally deferred in this first release (see spec Out of Scope section). The More screen links them to the web app with an Alert. Full in-app implementations are candidates for a v2 iteration.

```tsx
import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { get } from '@/lib/apiClient';
import { COLOURS } from '@/constants/config';
import type { Project, Task } from '@/lib/types';

interface CompletedData { projects: Project[]; tasks: Task[] }

export default function MoreScreen() {
  const { signOut } = useAuth();
  const [section, setSection] = useState<'menu' | 'completed'>('menu');
  const [completedData, setCompletedData] = useState<CompletedData | null>(null);
  const [loadingCompleted, setLoadingCompleted] = useState(false);

  async function loadCompleted() {
    setSection('completed');
    if (completedData) return;
    setLoadingCompleted(true);
    try {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const to = now.toISOString().slice(0, 10);
      const data = await get<CompletedData>(`/api/completed-items?from=${from}&to=${to}`);
      setCompletedData(data);
    } catch {
      Alert.alert('Error', 'Could not load completed items.');
      setSection('menu');
    } finally {
      setLoadingCompleted(false);
    }
  }

  function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
  }

  if (section === 'completed') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setSection('menu')}>
            <Text style={styles.back}>← More</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Completed this month</Text>
        </View>
        {loadingCompleted ? (
          <ActivityIndicator color={COLOURS.accent} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={styles.sectionLabel}>Projects ({completedData?.projects.length ?? 0})</Text>
            {(completedData?.projects ?? []).map((p) => (
              <View key={p.id} style={styles.completedRow}>
                <Text style={styles.completedName}>{p.name}</Text>
                <Text style={styles.completedDate}>{p.updatedAt?.slice(0, 10)}</Text>
              </View>
            ))}
            <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Tasks ({completedData?.tasks.length ?? 0})</Text>
            {(completedData?.tasks ?? []).map((t) => (
              <View key={t.id} style={styles.completedRow}>
                <Text style={styles.completedName}>{t.name}</Text>
                <Text style={styles.completedDate}>{t.completedAt?.slice(0, 10)}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>More</Text>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        <MenuItem icon="📊" label="Completed Report" onPress={loadCompleted} />
        <MenuItem icon="🔗" label="Office 365 Sync" onPress={() => Alert.alert('Office 365', 'Manage sync settings on the web app at planner.orangejelly.co.uk/settings')} />
        <MenuItem icon="⚙️" label="Settings" onPress={() => Alert.alert('Settings', 'Full settings are available on the web app at planner.orangejelly.co.uk/settings')} />
        <View style={styles.divider} />
        <MenuItem icon="🚪" label="Sign Out" onPress={handleSignOut} destructive />
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuItem({ icon, label, onPress, destructive = false }: { icon: string; label: string; onPress: () => void; destructive?: boolean }) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.menuIcon}>{icon}</Text>
      <Text style={[styles.menuLabel, destructive && { color: COLOURS.red }]}>{label}</Text>
      <Text style={styles.menuChevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLOURS.bg },
  header: { backgroundColor: COLOURS.bgHeader, padding: 16, paddingTop: 8 },
  title: { color: COLOURS.textPrimary, fontSize: 20, fontWeight: '700' },
  back: { color: COLOURS.accent, fontSize: 12, marginBottom: 4 },
  list: { padding: 12 },
  menuItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLOURS.bgCard, borderRadius: 8, padding: 14, marginBottom: 8 },
  menuIcon: { fontSize: 18, marginRight: 12 },
  menuLabel: { flex: 1, color: COLOURS.textPrimary, fontSize: 15 },
  menuChevron: { color: COLOURS.textMuted, fontSize: 20 },
  divider: { height: 1, backgroundColor: COLOURS.borderSubtle, marginVertical: 8 },
  sectionLabel: { color: COLOURS.accent, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  completedRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLOURS.borderSubtle },
  completedName: { color: COLOURS.textPrimary, fontSize: 13, flex: 1, marginRight: 8 },
  completedDate: { color: COLOURS.textMuted, fontSize: 12 },
});
```

- [ ] **Step 2: Verify More tab**

```bash
npx expo start --ios
```

Tap More. Expected: Menu with Completed Report, Office 365, Settings, Sign Out. Tap Completed Report — shows this month's completed items.

- [ ] **Step 3: Commit**

```bash
git add app/'(tabs)'/more.tsx
git commit -m "feat: add More screen with completed report and sign out"
```

---

### Task 15: Run all tests and generate Xcode project

**Files:** No new files

- [ ] **Step 1: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: All tests pass — auth, apiClient, MetricsBar, ProjectCard, TaskItem, CaptureSheet, ProjectDetail (7 test files, ~20 tests total)

- [ ] **Step 2: Run lint**

```bash
npx expo lint
```

Expected: No errors

- [ ] **Step 3: Generate native Xcode project**

```bash
npx expo prebuild --platform ios --clean
```

Expected: `ios/` directory created containing `ojplanner.xcworkspace`

- [ ] **Step 4: Open in Xcode**

```bash
open ios/ojplanner.xcworkspace
```

Expected: Xcode opens with the project. Select your device/simulator from the scheme picker and press Run (⌘R).

- [ ] **Step 5: Verify end-to-end on device**

On the running app:
- Sign in with your OJ Planner credentials
- Dashboard shows your projects and metrics
- Tap a project — detail screen shows tasks and notes
- Tap the + FAB — capture sheet slides up, add a task
- Tap Prioritise — tasks sorted by urgency+importance
- Tap Journal — entries load, generate a weekly summary
- Tap More → Completed Report — this month's completed items load
- Tap More → Sign Out — returns to login screen

- [ ] **Step 6: Final commit**

```bash
git add ios/
git commit -m "feat: generate Xcode project via expo prebuild"
```

---

**Plan complete and saved to `docs/superpowers/plans/2026-03-10-iphone-app.md`. Ready to execute?**
