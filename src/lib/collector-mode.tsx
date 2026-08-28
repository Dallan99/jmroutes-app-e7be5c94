import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "jmroutes:modo-coletor";

type CollectorModeContextValue = {
  modoColetor: boolean;
  ativarModoColetor: () => void;
  sairModoColetor: () => void;
};

const CollectorModeContext = createContext<CollectorModeContextValue | null>(null);

export function CollectorModeProvider({ children }: { children: ReactNode }) {
  const [modoColetor, setModoColetor] = useState(false);

  useEffect(() => {
    setModoColetor(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  const value = useMemo<CollectorModeContextValue>(() => ({
    modoColetor,
    ativarModoColetor: () => {
      window.localStorage.setItem(STORAGE_KEY, "1");
      setModoColetor(true);
    },
    sairModoColetor: () => {
      window.localStorage.removeItem(STORAGE_KEY);
      setModoColetor(false);
    },
  }), [modoColetor]);

  return <CollectorModeContext.Provider value={value}>{children}</CollectorModeContext.Provider>;
}

export function useCollectorMode() {
  const context = useContext(CollectorModeContext);
  if (!context) throw new Error("useCollectorMode deve ser usado dentro de CollectorModeProvider.");
  return context;
}
