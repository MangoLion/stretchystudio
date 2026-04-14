import React, { useRef, useCallback } from 'react';
import { useEditorStore } from '@/store/editorStore';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import CanvasViewport from '@/components/canvas/CanvasViewport';
import { LayerPanel } from '@/components/layers/LayerPanel';
import { Inspector } from '@/components/inspector/Inspector';
import { TimelinePanel } from '@/components/timeline/TimelinePanel';
import { AnimationListPanel } from '@/components/animation/AnimationListPanel';
import { ArmaturePanel } from '@/components/armature/ArmaturePanel';
import { ExportModal } from '@/components/export/ExportModal';
import { Save, FolderOpen, Palette, Sun, Moon, SquareChartGantt, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HelpIcon } from '@/components/ui/help-icon';
import { useProjectStore } from '@/store/projectStore';
import { useAnimationStore } from '@/store/animationStore';
import { useTheme, AVAILABLE_FONTS } from '@/contexts/ThemeProvider';
import { lightThemePresets, darkThemePresets } from '@/lib/themePresets';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { makeLocalMatrix } from '@/renderer/transforms';


export default function EditorLayout() {
  /**
   * remeshRef is a stable ref that CanvasViewport populates.
   * Inspector calls remeshRef.current(partId, opts) to trigger remeshing
   * without needing to lift state up or use context.
   */
  const remeshRef = useRef(null);
  const deleteMeshRef = useRef(null);

  const handleRemesh = useCallback((partId, opts) => {
    remeshRef.current?.(partId, opts);
  }, []);

  const handleDeleteMesh = useCallback((partId) => {
    deleteMeshRef.current?.(partId);
  }, []);

  const mode = useEditorStore(s => s.editorMode);
  const setEditorMode = useEditorStore(s => s.setEditorMode);
  const isAnimationMode = mode === 'animation';
  const project = useProjectStore(s => s.project);
  const captureRestPose = useAnimationStore(s => s.captureRestPose);

  // Canvas properties
  const canvas = useProjectStore(s => s.project.canvas);
  const updateCanvas = useProjectStore(s => s.updateCanvas);
  const nodes = useProjectStore(s => s.project.nodes);
  const animations = useProjectStore(s => s.project.animations);

  const saveRef = useRef(null);
  const loadRef = useRef(null);
  const captureRef = useRef(null);
  const [exportModalOpen, setExportModalOpen] = React.useState(false);

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

  // Compute bounding box of all parts across all animation keyframes + rest pose
  const computeFitBounds = useCallback(() => {
    const partNodes = nodes.filter(n => n.type === 'part');
    if (partNodes.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const part of partNodes) {
      const w = part.imageWidth ?? 0;
      const h = part.imageHeight ?? 0;
      if (!w || !h) continue;

      const corners = [[0, 0], [w, 0], [w, h], [0, h]];
      const transformsToEval = [{ ...part.transform }];

      // Collect all keyframe snapshots across all clips for this part
      for (const anim of animations) {
        const tracksByProp = {};
        for (const track of (anim.tracks ?? [])) {
          if (track.nodeId !== part.id) continue;
          if (['x', 'y', 'rotation', 'scaleX', 'scaleY'].includes(track.property)) {
            tracksByProp[track.property] = track.keyframes;
          }
        }
        if (Object.keys(tracksByProp).length === 0) continue;

        const times = new Set();
        for (const kfs of Object.values(tracksByProp)) {
          for (const kf of kfs) times.add(kf.time);
        }

        for (const t of times) {
          const snap = { ...part.transform };
          for (const [prop, kfs] of Object.entries(tracksByProp)) {
            const kf = kfs.find(k => k.time === t) ?? kfs[0];
            if (kf) snap[prop] = kf.value;
          }
          transformsToEval.push(snap);
        }
      }

      // Evaluate corners through each transform
      for (const xf of transformsToEval) {
        const m = makeLocalMatrix(xf);
        for (const [lx, ly] of corners) {
          const wx = m[0] * lx + m[3] * ly + m[6];
          const wy = m[1] * lx + m[4] * ly + m[7];
          if (wx < minX) minX = wx;
          if (wy < minY) minY = wy;
          if (wx > maxX) maxX = wx;
          if (wy > maxY) maxY = wy;
        }
      }
    }

    if (!isFinite(minX)) return null;

    const PAD = 20;
    return {
      x: Math.floor(minX - PAD),
      y: Math.floor(minY - PAD),
      width: Math.ceil(maxX - minX + PAD * 2),
      height: Math.ceil(maxY - minY + PAD * 2),
    };
  }, [nodes, animations]);

  return (
    <div className="flex h-screen w-full flex-col bg-background text-foreground overflow-hidden">
      {/* Top bar */}
      <header className="h-10 border-b flex items-center px-4 shrink-0 bg-card gap-3 relative">
        <div className="flex items-center gap-3 h-full">
          <span className="font-semibold text-sm select-none tracking-tight">Stretchy Studio</span>
          <span className="text-xs text-muted-foreground border border-border/50 px-1.5 py-0.5 font-mono">v0.1</span>

          <div className="flex h-full items-stretch border-l border-r ml-1 mr-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-full w-9 rounded-none hover:bg-muted"
              onClick={() => saveRef.current?.()}
              title="Save project (.stretch)"
            >
              <Save className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-full w-9 rounded-none border-l hover:bg-muted"
              onClick={() => loadRef.current?.()}
              title="Load project (.stretch)"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-full w-9 rounded-none border-l hover:bg-muted"
              onClick={() => setExportModalOpen(true)}
              title="Export frames"
            >
              <Download className="h-4 w-4" />
            </Button>

            {/* Canvas Properties Popover */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-full w-9 rounded-none border-l hover:bg-muted"
                  title="Canvas Properties"
                >
                  <SquareChartGantt className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-4 space-y-3 shadow-2xl border-border/60">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Canvas Properties
                </p>

                {/* Width / Height row */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Width</Label>
                    <Input
                      type="number"
                      className="h-7 text-xs"
                      value={canvas.width}
                      min={1}
                      onChange={e => updateCanvas({ width: Math.max(1, Number(e.target.value)) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Height</Label>
                    <Input
                      type="number"
                      className="h-7 text-xs"
                      value={canvas.height}
                      min={1}
                      onChange={e => updateCanvas({ height: Math.max(1, Number(e.target.value)) })}
                    />
                  </div>
                </div>

                {/* X / Y offset row */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">X Offset</Label>
                    <Input
                      type="number"
                      className="h-7 text-xs"
                      value={canvas.x ?? 0}
                      onChange={e => updateCanvas({ x: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Y Offset</Label>
                    <Input
                      type="number"
                      className="h-7 text-xs"
                      value={canvas.y ?? 0}
                      onChange={e => updateCanvas({ y: Number(e.target.value) })}
                    />
                  </div>
                </div>

                {/* Background Color row */}
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="canvas-bg-enable"
                    checked={canvas.bgEnabled ?? false}
                    onCheckedChange={checked => updateCanvas({ bgEnabled: !!checked })}
                  />
                  <Label htmlFor="canvas-bg-enable" className="text-xs cursor-pointer">
                    Background Color
                  </Label>
                </div>

                {/* Color picker — only visible when bgEnabled */}
                {canvas.bgEnabled && (
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={canvas.bgColor ?? '#ffffff'}
                      className="h-7 w-8 rounded border border-input cursor-pointer p-0.5 bg-background"
                      onChange={e => updateCanvas({ bgColor: e.target.value })}
                    />
                    <span className="text-xs text-muted-foreground font-mono">
                      {canvas.bgColor ?? '#ffffff'}
                    </span>
                  </div>
                )}

                {/* Separator */}
                <div className="border-t border-border/50" />

                {/* Fit button */}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs h-7"
                  onClick={() => {
                    const bounds = computeFitBounds();
                    if (bounds) updateCanvas(bounds);
                  }}
                >
                  Fit to minimum animation area
                </Button>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-full w-9 rounded-none border-l hover:bg-muted"
                  title="Customize Theme"
                >
                  <Palette className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-4 space-y-4 shadow-2xl border-border/60">
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
                      <Sun className="h-4 w-4" />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="dark" aria-label="Dark mode">
                      <Moon className="h-4 w-4" />
                    </ToggleGroupItem>
                  </ToggleGroup>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleThemeSelectClick}
                  >
                    Select Theme
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="font-select" className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Font Family</Label>
                  <Select value={fontFamily} onValueChange={setFontFamily}>
                    <SelectTrigger id="font-select" className="h-8 text-xs">
                      <SelectValue placeholder="Select a font" />
                    </SelectTrigger>
                    <SelectContent>
                      {AVAILABLE_FONTS.map((font) => (
                        <SelectItem key={font.id} value={font.id} className="text-xs">
                          {font.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="font-size-slider" className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Font Size ({fontSize}px)</Label>
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
          </div>
        </div>

        {/* Center Toggle */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center bg-muted/30 rounded-lg p-0.5 border border-border/40">
          <button
            onClick={() => setEditorMode('staging')}
            className={[
              'px-3 py-1 rounded-md text-[13px] font-semibold transition-all flex items-center gap-1.5',
              !isAnimationMode
                ? 'bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/20'
                : 'text-muted-foreground hover:text-foreground'
            ].join(' ')}
          >
            Staging
            <HelpIcon tip="In Staging mode, you set the base layout, mesh structure, and joint positions." className="opacity-40 hover:opacity-100" />
          </button>
          <button
            onClick={() => {
              setEditorMode('animation');
              captureRestPose(project.nodes);
            }}
            className={[
              'px-3 py-1 rounded-md text-[13px] font-semibold transition-all flex items-center gap-1.5 ml-0.5',
              isAnimationMode
                ? 'bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/20'
                : 'text-muted-foreground hover:text-foreground'
            ].join(' ')}
          >
            Animation
            <HelpIcon tip="In Animation mode, you create keyframes on the timeline." className="opacity-40 hover:opacity-100" />
          </button>
        </div>

        <div className="flex-1" />
        <span className="text-xs text-muted-foreground hidden sm:block">Scroll to zoom · Alt+drag to pan</span>
      </header>

      {/* Workspace */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* Layers */}
          <ResizablePanel defaultSize={18} minSize={12} maxSize={28}>
            <div className="flex h-full flex-col border-r">
              <div className="px-3 py-2 border-b shrink-0">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Layers</h2>
              </div>
              <div className="flex-1 overflow-hidden">
                <LayerPanel />
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle />

          {/* Center: Canvas + Timeline */}
          <ResizablePanel defaultSize={62}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={isAnimationMode ? 85 : 100}>
                <CanvasViewport
                  remeshRef={remeshRef}
                  deleteMeshRef={deleteMeshRef}
                  saveRef={saveRef}
                  loadRef={loadRef}
                  captureRef={captureRef}
                />
              </ResizablePanel>
              {isAnimationMode && (
                <>
                  <ResizableHandle />
                  <ResizablePanel defaultSize={15} minSize={12} collapsible>
                    <div className="flex h-full flex-col border-t">
                      <TimelinePanel />
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle />

          {/* Sidebar: Inspector + Animations */}
          <ResizablePanel defaultSize={20} minSize={14} maxSize={30}>
            <ResizablePanelGroup direction="vertical">
              {/* Inspector Content */}
              <ResizablePanel defaultSize={isAnimationMode ? 75 : 100} minSize={30}>
                <div className="flex h-full flex-col border-l overflow-hidden">
                  <ArmaturePanel />
                  <div className="px-3 py-2 border-b shrink-0 flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inspector</h2>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <Inspector onRemesh={handleRemesh} onDeleteMesh={handleDeleteMesh} />
                  </div>
                </div>
              </ResizablePanel>

              {isAnimationMode && (
                <>
                  <ResizableHandle />
                  {/* Animations Content */}
                  <ResizablePanel defaultSize={25} minSize={10}>
                    <AnimationListPanel />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <ExportModal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        captureRef={captureRef}
      />
    </div>
  );
}
