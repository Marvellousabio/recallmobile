import { Session } from '@supabase/supabase-js';
import * as Network from 'expo-network';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { enqueueChange, getDb } from '@/db';
import { cloudConfigured, supabase } from '@/lib/supabase';
import { processAiQueue } from '@/lib/ai';
import { getLastSync, pendingCount, syncNow, SyncResult } from '@/lib/sync';

type SyncState = {
  enabled: boolean; // cloud keys configured
  session: Session | null;
  syncing: boolean;
  lastSync: string | null;
  pending: number;
  lastResult: SyncResult | null;
  /** Increments when new AI study packs arrive — screens re-query on change. */
  aiTick: number;
  sync: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<SyncState | null>(null);
const INTERVAL_MS = 5 * 60 * 1000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [aiTick, setAiTick] = useState(0);
  const sessionRef = useRef<Session | null>(null);

  const refreshMeta = useCallback(async () => {
    setPending(await pendingCount());
    setLastSync(await getLastSync());
  }, []);

  const sync = useCallback(async () => {
    if (!sessionRef.current) {
      await refreshMeta();
      return;
    }
    setSyncing(true);
    try {
      const r = await syncNow();
      setLastResult(r);
      if (!r.skipped) {
        // Uploads may have unblocked AI jobs; their results then need no further sync.
        if ((await processAiQueue()) > 0) setAiTick((n) => n + 1);
      }
    } catch (e) {
      console.warn('[sync]', e);
    } finally {
      setSyncing(false);
      await refreshMeta();
    }
  }, [refreshMeta]);

  // Auth session
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      sessionRef.current = data.session;
      setSession(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, s) => {
      sessionRef.current = s;
      setSession(s);
      if (event === 'SIGNED_IN') {
        // First sign-in: queue everything already on the phone for backup.
        await queueAllForBackup();
        sync();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [sync]);

  // Triggers: launch, foreground, network regained, every 5 min.
  useEffect(() => {
    const first = setTimeout(sync, 0);
    const app = AppState.addEventListener('change', (s) => s === 'active' && sync());
    const net = Network.addNetworkStateListener((n) => n.isConnected && sync());
    const iv = setInterval(sync, INTERVAL_MS);
    return () => {
      clearTimeout(first);
      app.remove();
      net.remove();
      clearInterval(iv);
    };
  }, [sync]);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  return (
    <Ctx.Provider value={{ enabled: cloudConfigured, session, syncing, lastSync, pending, lastResult, aiTick, sync, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSync() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSync outside SyncProvider');
  return v;
}

/** Ensures data created before the student signed in gets backed up. */
async function queueAllForBackup() {
  const db = await getDb();
  if ((await db.getFirstAsync('SELECT 1 FROM kv WHERE key = ?', 'backup_seeded'))) return;
  for (const table of ['profile', 'courses', 'timetable_slots', 'lectures', 'assets']) {
    const rows = await db.getAllAsync<{ id: string }>(`SELECT id FROM ${table}`);
    for (const r of rows) await enqueueChange(db, table, r.id, 'upsert');
  }
  await db.runAsync("INSERT OR REPLACE INTO kv (key, value) VALUES ('backup_seeded', '1')");
}
