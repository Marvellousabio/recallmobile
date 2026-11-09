import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import { getProfile, Profile } from '@/db/repo';
import i18n from '@/i18n';

type AppState = {
  ready: boolean;
  profile: Profile | null;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AppState>({ ready: false, profile: null, refresh: async () => {} });

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  const refresh = useCallback(async () => {
    const p = await getProfile();
    if (p && i18n.language !== p.language) await i18n.changeLanguage(p.language);
    setProfile(p);
  }, []);

  useEffect(() => {
    let alive = true;
    getProfile()
      .then(async (p) => {
        if (p && i18n.language !== p.language) await i18n.changeLanguage(p.language);
        if (alive) setProfile(p);
      })
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  return <Ctx.Provider value={{ ready, profile, refresh }}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);
