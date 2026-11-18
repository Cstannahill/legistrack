"use client"

import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTheme } from "./ThemeProvider"

interface ThemeToggleProps {
    showLabel?: boolean
    className?: string
}

/**
 * Accessible button that toggles between light and dark themes.
 */
export function ThemeToggle({ showLabel = false, className }: ThemeToggleProps) {
    const { theme, toggleTheme, mounted } = useTheme()
    const isDark = mounted && theme === "dark"

    return (
        <Button
            type="button"
            variant="ghost"
            size={showLabel ? "sm" : "icon"}
            onClick={toggleTheme}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className={className}
        >
            {isDark ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
            ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
            )}
            {showLabel && (
                <span>{isDark ? "Light mode" : "Dark mode"}</span>
            )}
        </Button>
    )
}
