import React from 'react';
import { Palette, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme, AVAILABLE_FONTS } from '@/contexts/ThemeProvider';
import { lightThemePresets, darkThemePresets } from '@/lib/themePresets';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Demo } from '@/components/Demo';

function App() {
  const { 
    themeMode, setThemeMode, 
    openThemeModal, 
    setLightTheme, setDarkTheme,
    fontFamily, setFontFamily,
    fontSize, setFontSize,
  } = useTheme();

  const handleThemeSelectClick = () => {
    const config = themeMode === 'dark' || (themeMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? {
      title: 'Select Dark Theme',
      themes: darkThemePresets,
      onSelect: setDarkTheme,
    } : {
      title: 'Select Light Theme',
      themes: lightThemePresets,
      onSelect: setLightTheme,
    };
    openThemeModal(config);
  };

  return (
    <>
      <Demo />
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            className="fixed bottom-4 right-4 rounded-none h-14 w-14 shadow-lg z-50"
          >
            <Palette size={24} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-4 space-y-4">
          <div className="flex items-center gap-2">
            <ToggleGroup
              type="single"
              value={themeMode}
              onValueChange={(value) => {
                if (value) setThemeMode(value);
              }}
              aria-label="Theme mode"
            >
              <ToggleGroupItem value="light" aria-label="Light mode">
                <Sun className="h-5 w-5" />
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" aria-label="Dark mode">
                <Moon className="h-5 w-5" />
              </ToggleGroupItem>
            </ToggleGroup>

            <Button
              variant="outline"
              onClick={handleThemeSelectClick}
            >
              Select Theme
            </Button>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="font-select">Font Family</Label>
            <Select value={fontFamily} onValueChange={setFontFamily}>
              <SelectTrigger id="font-select">
                <SelectValue placeholder="Select a font" />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_FONTS.map((font) => (
                  <SelectItem key={font.id} value={font.id}>
                    {font.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="font-size-slider">Font Size ({fontSize}px)</Label>
            <Slider
              id="font-size-slider"
              min={12}
              max={20}
              step={1}
              value={[fontSize]}
              onValueChange={(value) => setFontSize(value[0])}
            />
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

export default App;
