import React from 'react';
import { Palette, Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/contexts/ThemeProvider';
import { lightThemePresets, darkThemePresets } from '@/lib/themePresets';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";


const PhoneLayout = ({ children, isLandscape }) => {
  const { themeMode, setThemeMode, openThemeModal, setLightTheme, setDarkTheme } = useTheme();

  const handleThemeSelectClick = () => {
    const config = themeMode === 'dark' ? {
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
      <div className="phone-shell relative">
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-28 h-5 bg-border rounded-b-lg z-30"></div>
        
        <div className="phone-screen">
          {children}
        </div>
      </div>

      {isLandscape && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              className="fixed bottom-4 right-4 rounded-full h-14 w-14 shadow-lg z-50"
            >
              <Palette size={24} />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2">
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
          </PopoverContent>
        </Popover>
      )}
    </>
  );
};

export default PhoneLayout;
