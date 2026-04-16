import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Sun, Moon, Monitor, Palette, Info, Settings2, Layout } from 'lucide-react';
import { useTheme, AVAILABLE_FONTS } from '@/contexts/ThemeProvider';
import { lightThemePresets, darkThemePresets } from '@/lib/themePresets';

export function PreferencesModal({ open, onOpenChange }) {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden outline-none border-none shadow-2xl">
        <div className="flex flex-col h-[500px]">
          <DialogHeader className="p-6 pb-2 border-b">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Settings2 className="w-5 h-5 text-primary" />
              Preferences
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="interface" className="flex flex-1 overflow-hidden">
            <TabsList className="flex flex-col h-full w-48 rounded-none border-r bg-muted/30 p-2 gap-1 items-stretch justify-start">
              <TabsTrigger
                value="general"
                className="justify-start gap-2 px-3 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Settings2 className="w-4 h-4" />
                General
              </TabsTrigger>
              <TabsTrigger
                value="interface"
                className="justify-start gap-2 px-3 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Layout className="w-4 h-4" />
                Interface
              </TabsTrigger>
              <TabsTrigger
                value="about"
                className="justify-start gap-2 px-3 py-2 data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                <Info className="w-4 h-4" />
                About
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto p-6 bg-background">
              <TabsContent value="general" className="mt-0 space-y-4">
                <div className="space-y-1">
                  <h3 className="text-lg font-medium">General Settings</h3>
                  <p className="text-sm text-muted-foreground">Nothing here yet</p>
                </div>
              </TabsContent>

              <TabsContent value="interface" className="mt-0 space-y-8">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h3 className="text-lg font-medium">Appearance</h3>
                    <p className="text-sm text-muted-foreground">Customize how Stretchy Studio looks on your screen.</p>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-semibold">Theme Mode</Label>
                    <div className="flex items-center gap-4">
                      <ToggleGroup
                        type="single"
                        value={themeMode}
                        onValueChange={(value) => {
                          if (value) setThemeMode(value);
                        }}
                        aria-label="Theme mode"
                        className="bg-muted p-1 rounded-md"
                      >
                        <ToggleGroupItem value="light" aria-label="Light mode" className="gap-2 px-3">
                          <Sun className="h-4 w-4" />
                          <span className="text-xs">Light</span>
                        </ToggleGroupItem>
                        <ToggleGroupItem value="dark" aria-label="Dark mode" className="gap-2 px-3">
                          <Moon className="h-4 w-4" />
                          <span className="text-xs">Dark</span>
                        </ToggleGroupItem>
                        <ToggleGroupItem value="system" aria-label="System mode" className="gap-2 px-3">
                          <Monitor className="h-4 w-4" />
                          <span className="text-xs">System</span>
                        </ToggleGroupItem>
                      </ToggleGroup>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleThemeSelectClick}
                        className="gap-2"
                      >
                        <Palette className="h-4 w-4" />
                        Color Preset
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="font-select" className="text-sm font-semibold">Font Family</Label>
                      <Select value={fontFamily} onValueChange={setFontFamily}>
                        <SelectTrigger id="font-select" className="h-9">
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
                      <Label htmlFor="font-size-slider" className="text-sm font-semibold">Font Size ({fontSize}px)</Label>
                      <div className="pt-2">
                        <Slider
                          id="font-size-slider"
                          min={12}
                          max={20}
                          step={1}
                          value={[fontSize]}
                          onValueChange={(value) => setFontSize(value[0])}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="about" className="mt-0 space-y-6">
                <div className="space-y-4 text-center py-4">
                  <div className="flex justify-center mb-2">
                    <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
                      <Layout className="w-10 h-10 text-primary-foreground" />
                    </div>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight">Stretchy Studio</h2>
                    <p className="text-sm text-muted-foreground font-mono">Version 0.2</p>
                  </div>
                  <p className="max-w-xs mx-auto text-sm text-balance">
                    A modern 2D animation and rigging tool focused on ease of use and rapid prototyping.
                  </p>
                </div>

                <div className="border-t pt-6 bg-primary/5 -mx-6 px-6 pb-6">
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    Ecosystem
                  </h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
                    Stretchy Studio is designed as an animation engine for the
                    <a href="https://github.com/shitagaki-lab/see-through" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium ml-1">
                      See-through
                    </a> model.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1.5" asChild>
                      <a href="https://github.com/shitagaki-lab/see-through" target="_blank" rel="noopener noreferrer">
                        See-through Repo
                      </a>
                    </Button>
                    <Button variant="default" size="sm" className="h-7 text-[10px] gap-1.5" asChild>
                      <a href="https://huggingface.co/spaces/24yearsold/see-through-demo" target="_blank" rel="noopener noreferrer">
                        Free HuggingFace Space
                      </a>
                    </Button>
                  </div>
                </div>

                <div className="border-t pt-6">
                  <h4 className="text-sm font-semibold mb-2">Project Details</h4>
                  <div className="grid grid-cols-2 gap-y-2 text-xs">
                    <span className="text-muted-foreground">Framework:</span>
                    <span>React + Vite</span>
                    <span className="text-muted-foreground">Styling:</span>
                    <span>Tailwind CSS</span>
                    <span className="text-muted-foreground">Components:</span>
                    <span>Radix UI + Shadcn UI</span>
                    <span className="text-muted-foreground">Icons:</span>
                    <span>Lucide React</span>
                  </div>
                </div>


              </TabsContent>
            </div>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
