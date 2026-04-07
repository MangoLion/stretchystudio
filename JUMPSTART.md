# JUMPSTART

This document provides a quick overview of the project's tech stack and how to customize the UI programmatically.

## Tech Stack

- **Framework:** [React.js](https://react.dev/)
- **Build Tool:** [Vite](https://vitejs.dev/)
- **UI Components:** [Shadcn UI](https://ui.shadcn.com/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Icons:** [Lucide React](https://lucide.dev/guide/packages/lucide-react)
- **Fonts:** [Fontsource](https://fontsource.org/)

## Customization Examples

The theme and font management is handled by a custom `ThemeProvider` React context located in `src/contexts/ThemeProvider.jsx`.

To interact with the theme, you can use the `useTheme` hook, which provides access to the state and functions for updating it.

### Setting the Theme

You can change the theme mode (e.g., 'light', 'dark', 'system') and also set the specific color presets for both light and dark modes.

**Example:**
```jsx
import { useTheme } from '@/contexts/ThemeProvider';
import { lightThemePresets, darkThemePresets } from '@/lib/themePresets';

function ThemeControls() {
  const { setThemeMode, setLightTheme, setDarkTheme } = useTheme();

  // Find a specific theme preset by name
  const newLightTheme = lightThemePresets.find(p => p.name === 'Green');
  const newDarkTheme = darkThemePresets.find(p => p.name === 'Violet');

  return (
    <div>
      <button onClick={() => setThemeMode('dark')}>
        Set Dark Mode
      </button>
      <button onClick={() => setLightTheme(newLightTheme)}>
        Set Light Theme to Green
      </button>
      <button onClick={() => setDarkTheme(newDarkTheme)}>
        Set Dark Theme to Violet
      </button>
    </div>
  );
}
```

### Setting the Font Family

You can dynamically change the application's font family by passing the font's `id`.

**Example:**
```jsx
import { useTheme } from '@/contexts/ThemeProvider';

function FontSelector() {
  const { setFontFamily } = useTheme();

  // The value should be one of the font IDs from AVAILABLE_FONTS
  const handleFontChange = (event) => {
    setFontFamily(event.target.value);
  };

  return (
    <select onChange={handleFontChange}>
      <option value="Inter">Inter</option>
      <option value="Roboto">Roboto</option>
      <option value="Poppins">Poppins</option>
    </select>
  );
}
```

### Setting the Font Size

You can adjust the base font size of the application.

**Example:**
```jsx
import { useTheme } from '@/contexts/ThemeProvider';

function FontSizeControls() {
  const { fontSize, setFontSize } = useTheme();

  return (
    <div>
      <p>Current Font Size: {fontSize}px</p>
      <button onClick={() => setFontSize(fontSize + 1)}>
        Increase Font Size
      </button>
      <button onClick={() => setFontSize(fontSize - 1)}>
        Decrease Font Size
      </button>
    </div>
  );
}
