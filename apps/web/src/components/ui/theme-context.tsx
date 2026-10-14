"use client";
import {createContext,useContext,type ReactNode} from 'react';
const ThemeContext=createContext<'light'|'dark'|undefined>(undefined);
export function WorkspaceThemeProvider({theme,children}:{theme:'light'|'dark';children:ReactNode}){return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;}
export function useWorkspaceTheme(){return useContext(ThemeContext);}
