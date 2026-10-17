import { createContext, useContext } from 'react';

export interface Nav { openSettings(): void; rescan(): void }
export const NavContext = createContext<Nav>({ openSettings: () => undefined, rescan: () => undefined });
export const useNav = () => useContext(NavContext);
