import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import { lightThemePresets, darkThemePresets } from '@/lib/themePresets';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ThemeContext = createContext();

export const AVAILABLE_FONTS = [
  { id: 'Inter', name: 'Inter', stack: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { id: 'Roboto', name: 'Roboto', stack: '"Roboto", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif' },
  { id: 'Open Sans', name: 'Open Sans', stack: '"Open Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { id: 'Lato', name: 'Lato', stack: '"Lato", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { id: 'Montserrat', name: 'Montserrat', stack: '"Montserrat", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { id: 'Source Sans 3', name: 'Source Sans 3', stack: '"Source Sans 3", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { id: 'Poppins', name: 'Poppins', stack: '"Poppins", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
];

const DEFAULT_FONT_FAMILY = AVAILABLE_FONTS[0].id;
const DEFAULT_FONT_SIZE = 16;


export const ThemeProvider = ({ children }) => {
  const [themeMode, setThemeMode] = useState('system'); // 'light', 'dark', or 'system'
  const [lightTheme, setLightTheme] = useState(lightThemePresets[0]);
  const [darkTheme, setDarkTheme] = useState(darkThemePresets[0]);
  const [fontFamily, setFontFamilyState] = useState(DEFAULT_FONT_FAMILY);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [osTheme, setOsTheme] = useState('light');
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const [themeModalConfig, setThemeModalConfig] = useState({
    title: '',
    themes: [],
    onSelect: () => {},
  });


  // Effect to load settings from localStorage on mount
  useEffect(() => {
    const savedThemeMode = localStorage.getItem('theme_mode');
    const savedLightThemeName = localStorage.getItem('theme_light_name');
    const savedDarkThemeName = localStorage.getItem('theme_dark_name');
    const savedFontFamily = localStorage.getItem('font_family');
    const savedFontSize = localStorage.getItem('font_size');

    if (savedThemeMode) setThemeMode(JSON.parse(savedThemeMode));
    if (savedFontFamily) setFontFamilyState(JSON.parse(savedFontFamily));
    if (savedFontSize) setFontSize(JSON.parse(savedFontSize));
    
    if (savedLightThemeName) {
      const foundTheme = lightThemePresets.find(p => p.name === savedLightThemeName);
      if (foundTheme) setLightTheme(foundTheme);
    }
    
    if (savedDarkThemeName) {
      const foundTheme = darkThemePresets.find(p => p.name === savedDarkThemeName);
      if (foundTheme) setDarkTheme(foundTheme);
    }
  }, []);

  // Effect to save settings to localStorage when they change
  useEffect(() => {
    localStorage.setItem('theme_mode', JSON.stringify(themeMode));
    localStorage.setItem('font_family', JSON.stringify(fontFamily));
    localStorage.setItem('font_size', JSON.stringify(fontSize));
    if (lightTheme) {
      localStorage.setItem('theme_light_name', lightTheme.name);
    }
    if (darkTheme) {
      localStorage.setItem('theme_dark_name', darkTheme.name);
    }
  }, [themeMode, lightTheme, darkTheme, fontFamily, fontSize]);

  // Effect to listen for OS theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => setOsTheme(mediaQuery.matches ? 'dark' : 'light');
    mediaQuery.addEventListener('change', handleChange);
    handleChange(); // Initial check
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Effect to apply theme to the DOM
  useEffect(() => {
    if (!lightTheme || !darkTheme) return;

    // Apply font family and font size
    const selectedFont = AVAILABLE_FONTS.find(f => f.id === fontFamily) || AVAILABLE_FONTS[0];
    document.documentElement.style.setProperty('--font-sans', selectedFont.stack);
    document.documentElement.style.setProperty('font-size', `${fontSize}px`);

    let effectiveColors;
    let isDark;

    if (themeMode === 'system') {
      isDark = osTheme === 'dark';
      effectiveColors = isDark ? darkTheme.colors : lightTheme.colors;
    } else {
      isDark = themeMode === 'dark';
      effectiveColors = isDark ? darkTheme.colors : lightTheme.colors;
    }

    const root = document.documentElement;
    for (const [variable, hslValue] of Object.entries(effectiveColors)) {
      root.style.setProperty(`--${variable}`, hslValue);
    }

    root.classList.toggle('dark', isDark);
  }, [themeMode, lightTheme, darkTheme, osTheme, fontFamily, fontSize]);

  const setFontFamily = useCallback((newFontFamilyId) => {
    if (AVAILABLE_FONTS.some(f => f.id === newFontFamilyId)) {
      setFontFamilyState(newFontFamilyId);
    }
  }, []);

  const value = {
    themeMode,
    setThemeMode,
    lightTheme,
    setLightTheme,
    darkTheme,
    setDarkTheme,
    fontFamily,
    setFontFamily,
    fontSize,
    setFontSize,
    osTheme,
    openThemeModal: (config) => {
      setThemeModalConfig(config);
      setIsThemeModalOpen(true);
    },
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
      <ThemeSelectModal
        isOpen={isThemeModalOpen}
        onOpenChange={setIsThemeModalOpen}
        title={themeModalConfig.title}
        themes={themeModalConfig.themes}
        onSelectTheme={themeModalConfig.onSelect}
      />
    </ThemeContext.Provider>
  );
};

const ThemeSelectModal = ({ isOpen, onOpenChange, title, themes, onSelectTheme }) => {
  const handleSelect = (theme) => {
    onSelectTheme(theme);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex-grow overflow-y-auto -mx-6 px-6">
          <div className="space-y-2">
            {themes.map((theme) => (
              <button
                key={theme.name}
                onClick={() => handleSelect(theme)}
                className="w-full flex items-center p-3 text-left rounded-lg hover:bg-muted transition-colors"
              >
                <div className="w-5 h-5 rounded-none mr-3 border" style={{ backgroundColor: `hsl(${theme.colors.primary})` }} />
                <span>{theme.name}</span>
              </button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};


export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
