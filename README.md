# Customizable React UI with Vite, Shadcn UI, and Tailwind CSS

This project is a modern React application built with Vite, featuring a highly customizable UI using Shadcn UI components, Tailwind CSS, and a custom theme provider. It serves as a showcase for dynamic theme and font management in a React environment.

## Tech Stack

- **Framework:** [React.js](https://react.dev/)
- **Build Tool:** [Vite](https://vitejs.dev/)
- **UI Components:** [Shadcn UI](https://ui.shadcn.com/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Icons:** [Lucide React](https://lucide.dev/guide/packages/lucide-react)
- **Fonts:** [Fontsource](https://fontsource.org/)

## Features

### Comprehensive Theme Customization

The application includes a robust theme management system that allows for extensive UI personalization. The theme controls can be accessed via the floating palette icon at the bottom-right of the screen.

- **Light & Dark Mode:** Switch between light and dark color schemes. The application can also be set to follow the operating system's theme preference.

- **Color Presets:** Beyond a simple light/dark toggle, users can select from a variety of color presets for both modes. This allows for different visual styles, such as "Default" or "Gray", with the ability to easily add more.

- **Dynamic Font Selection:** Users can change the application's font family on the fly. The project is configured with several fonts from Fontsource, including:
  - Inter
  - Roboto
  - Open Sans
  - Lato
  - Montserrat
  - Source Sans 3
  - Poppins

- **Adjustable Font Size:** The base font size of the application can be increased or decreased to improve readability.

### How It Works

The theme and font management is handled by a custom `ThemeProvider` React context (`src/contexts/ThemeProvider.jsx`). This provider:
- Manages the state for the current theme mode, color presets, font family, and font size.
- Persists user preferences to `localStorage`, so settings are remembered across sessions.
- Applies the selected styles to the application globally by updating CSS custom properties on the root element.

The UI components from Shadcn are built on top of Tailwind CSS and are designed to work with these CSS custom properties, allowing for effortless and instantaneous theme and font updates across the entire application.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- [npm](https://www.npmjs.com/)

### Installation

1.  Clone the repository:
    ```bash
    git clone <repository-url>
    cd <repository-directory>
    ```

2.  Install the dependencies:
    ```bash
    npm install
    ```

3.  **(Optional) Install additional fonts:**
    To add more fonts, you can install them from Fontsource. For example:
    ```bash
    npm install @fontsource/your-new-font
    ```
    After installation, you need to update the application to make the font available for selection. See the "Customization" section below.

### Running the Development Server

To start the Vite development server, run:

```bash
npm run dev
```

The application will be available at `http://localhost:5173/`.

## Customization

### Adding New Fonts

To add a new font to the selection dropdown:

1.  **Install the font package** from Fontsource:
    ```bash
    npm install @fontsource/font-name
    ```

2.  **Import the font** in `src/main.jsx`:
    ```javascript
    import '@fontsource/font-name';
    ```

3.  **Add the font to the `AVAILABLE_FONTS` array** in `src/contexts/ThemeProvider.jsx`:
    ```javascript
    export const AVAILABLE_FONTS = [
      // ... existing fonts
      { id: 'Font Name', name: 'Font Name', stack: '"Font Name", system-ui, ...' },
    ];
    ```
    The `id` should be a unique identifier, `name` is the display name in the UI, and `stack` is the CSS `font-family` string.

### Adding New Theme Presets

To add a new color theme preset:

1.  **Define the theme** in `src/lib/themePresets.js`. Add a new theme object to either the `lightThemePresets` or `darkThemePresets` array. The object should include a `name` and a `colors` object with HSL values for the various CSS variables used by Shadcn UI.

    ```javascript
    // src/lib/themePresets.js
    export const lightThemePresets = [
      // ... existing light themes
      {
        name: 'New Light Theme',
        colors: {
          background: "0 0% 98%",
          foreground: "240 10% 3.9%",
          primary: "262.1 83.3% 57.8%",
          "primary-foreground": "210 20% 98%",
          // ... other color variables
        },
      },
    ];
    ```

2.  The new theme will automatically appear in the "Select Theme" dialog for the corresponding mode (light or dark).
