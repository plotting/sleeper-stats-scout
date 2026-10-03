import type { ReactNode } from 'react';
import { Zap } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAdminSession } from '@/hooks/useAdminSession';

// ─── Admin sign-in ───────────────────────────────────────────────────────────
// Real Supabase auth. Write access is enforced in the database (row-level
// security: only emails in admin_emails can write), so this is just the login form.

export function LoginGate() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <div className="max-w-sm mx-auto mt-24 space-y-4 text-center">
      <h1 className="text-xl font-bold flex items-center justify-center gap-2">
        <Zap className="h-5 w-5 text-blue-400" />
        Admin Sign In
      </h1>
      <p className="text-slate-400 text-sm">Sign in to sync data and edit the league.</p>
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        autoComplete="username"
        autoFocus
      />
      <Input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && email && password && submit()}
        placeholder="Password"
        autoComplete="current-password"
      />
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <Button onClick={submit} disabled={busy || !email || !password} className="w-full">Sign in</Button>
    </div>
  );
}

/** Shows the sign-in form until an admin is signed in, then the page. The Trade Hub menu links to the
 *  pages behind this (shown with a lock), and the database itself only serves their data to the admin. */
export default function AdminGate({ children }: { children: ReactNode }) {
  const session = useAdminSession();
  if (session === undefined) return null;
  if (!session) return <LoginGate />;
  return <>{children}</>;
}
