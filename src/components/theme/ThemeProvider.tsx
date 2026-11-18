"use client"

import React, { createContext, useContext, useEffect, useState } from "react"

export type Theme = "light" | "dark"

interface ThemeContextValue {
    theme: Theme
    setTheme: (theme: Theme) => void
    toggleTheme: () => void
    mounted: boolean
}

const STORAGE_KEY = "legistrack-theme"

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function applyThemeClass(theme: Theme) {
    if (typeof document === "undefined") return
    const root = document.documentElement
    root.classList.toggle("dark", theme === "dark")
    root.style.colorScheme = theme
}

/**
 * Provides light/dark theme state synchronized with localStorage and the root `.dark` class.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>("light")
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        const stored = window.localStorage.getItem(STORAGE_KEY)
        const initial: Theme =
            stored === "dark" || stored === "light"
                ? stored
                : document.documentElement.classList.contains("dark")
                    ? "dark"
                    : "light"
        setThemeState(initial)
        applyThemeClass(initial)
        setMounted(true)
    }, [])

    const setTheme = (next: Theme) => {
        setThemeState(next)
        applyThemeClass(next)
        try {
            window.localStorage.setItem(STORAGE_KEY, next)
        } catch {
            // Ignore storage errors in restricted browsing contexts
        }
    }

    const toggleTheme = () => {
        setTheme(theme === "dark" ? "light" : "dark")
    }

    return (
        <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, mounted }}>
            {children}
        </ThemeContext.Provider>
    )
}

export function useTheme() {
    const ctx = useContext(ThemeContext)
    if (!ctx) {
        throw new Error("useTheme must be used within a ThemeProvider")
    }
    return ctx
}
