import { createContext, useContext } from 'react';

/** Lets any dashboard tab return to the app's home screen. */
export const DashboardContext = createContext<{ onExit: () => void }>({ onExit: () => {} });

export function useDashboard() {
  return useContext(DashboardContext);
}
