import React, { useState, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/store/projectStore';
import { useAnimationStore } from '@/store/animationStore';
import {
  exportFrames,
  computeExportFrameSpecs,
  computeAnalyticalBounds,
  resolveAnimations,
} from '@/io/exportAnimation';

export function ExportModal({ open, onClose, captureRef }) {
  // Form state
  const [type, setType] = useState('sequence');
  const [format, setFormat] = useState('png');
  const [animTarget, setAnimTarget] = useState('current');
  const [exportFps, setExportFps] = useState(24);
  const [frameIndex, setFrameIndex] = useState(0);
  const [imageContains, setImageContains] = useState('canvas_area');
  const [outputScale, setOutputScale] = useState(100);
  const [bgMode, setBgMode] = useState('transparent');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [exportDest, setExportDest] = useState('zip');

  // Progress state
  const [progress, setProgress] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  // Store access
  const project = useProjectStore(s => s.project);
  const animStore = useAnimationStore();

  // Sync defaults when modal opens
  useEffect(() => {
    if (!open) return;
    const activeAnim = project.animations.find(a => a.id === animStore.activeAnimationId);
    setExportFps(activeAnim?.fps ?? animStore.fps ?? 24);
    const hasBg = project.canvas.bgEnabled;
    setBgMode(hasBg ? 'custom' : 'transparent');
    setBgColor(project.canvas.bgColor ?? '#ffffff');
  }, [open, project, animStore]);

  const handleExport = useCallback(async () => {
    if (!captureRef?.current) {
      console.error('[Export] captureRef not available');
      return;
    }

    setIsExporting(true);
    setProgress({ current: 0, total: 1, label: 'Preparing...' });

    try {
      // Resolve which animations to export
      const animsToExport = resolveAnimations(
        project.animations,
        animTarget,
        animStore.activeAnimationId
      );

      if (animsToExport.length === 0) {
        setProgress(null);
        setIsExporting(false);
        alert('No animations to export');
        return;
      }

      // Compute frame specs
      const frameSpecs = computeExportFrameSpecs({
        type,
        animsToExport,
        exportFps,
        frameIndex,
      });

      // Compute export dimensions
      const scale = outputScale / 100;
      let cropOffset = null;
      let exportW, exportH;

      if (imageContains === 'min_image_area') {
        const bounds = computeAnalyticalBounds(project);
        exportW = Math.round(
          (bounds?.width ?? project.canvas.width) * scale
        );
        exportH = Math.round(
          (bounds?.height ?? project.canvas.height) * scale
        );
        cropOffset = bounds ? { x: bounds.x, y: bounds.y } : null;
      } else {
        exportW = Math.round(project.canvas.width * scale);
        exportH = Math.round(project.canvas.height * scale);
      }

      // Capture each frame
      const frameDataItems = [];
      const total = frameSpecs.length;

      for (let i = 0; i < total; i++) {
        const spec = frameSpecs[i];
        setProgress({
          current: i + 1,
          total,
          label: `${spec.animName} — frame ${spec.frameIndex + 1}`,
        });

        const dataUrl = captureRef.current({
          animId: spec.animId,
          timeMs: spec.timeMs,
          bgEnabled: bgMode === 'custom',
          bgColor,
          exportWidth: exportW,
          exportHeight: exportH,
          format,
          quality: 0.92,
          cropOffset,
        });

        if (dataUrl) {
          frameDataItems.push({
            animName: spec.animName,
            frameIndex: spec.frameIndex,
            dataUrl,
          });
        }

        // Yield to browser for rAF and UI updates
        await new Promise(r => setTimeout(r, 0));
      }

      // Export to ZIP or Folder
      setProgress({
        current: total,
        total,
        label: 'Writing output...',
      });

      await exportFrames({
        frames: frameDataItems,
        format,
        exportDest,
        onProgress: msg =>
          setProgress(p => (p ? { ...p, label: msg } : null)),
      });

      setProgress(null);
      setIsExporting(false);
      onClose();
    } catch (err) {
      console.error('[Export] Failed:', err);
      setProgress(null);
      setIsExporting(false);
    }
  }, [
    captureRef,
    project,
    animStore,
    type,
    format,
    animTarget,
    exportFps,
    frameIndex,
    imageContains,
    outputScale,
    bgMode,
    bgColor,
    exportDest,
    onClose,
  ]);

  const showFpsInput = type === 'sequence';
  const showFrameInput = type === 'single_frame';
  const hasFolderSupport = 'showDirectoryPicker' in window;
  const showJpgWarning = format === 'jpg' && bgMode === 'transparent';

  return (
    <Dialog open={open} onOpenChange={v => {
      if (!v && !isExporting) onClose();
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Section 1: Type + Format */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={type} onValueChange={setType} disabled={isExporting}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sequence">Sequence</SelectItem>
                  <SelectItem value="single_frame">Single Frame</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Format</Label>
              <Select value={format} onValueChange={setFormat} disabled={isExporting}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="png">PNG</SelectItem>
                  <SelectItem value="webp">WEBP</SelectItem>
                  <SelectItem value="jpg">JPG</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Section 2: Animation target + timing */}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Animation</Label>
              <Select value={animTarget} onValueChange={setAnimTarget} disabled={isExporting}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">Current</SelectItem>
                  {project.animations.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                  {project.animations.length > 1 && (
                    <SelectItem value="all">All</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {showFpsInput && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">FPS</Label>
                <Input
                  type="number"
                  className="h-8 text-xs"
                  value={exportFps}
                  min={1}
                  max={120}
                  onChange={e =>
                    setExportFps(Math.max(1, Number(e.target.value)))
                  }
                  disabled={isExporting}
                />
              </div>
            )}

            {showFrameInput && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Frame</Label>
                <Input
                  type="number"
                  className="h-8 text-xs"
                  value={frameIndex}
                  min={0}
                  onChange={e =>
                    setFrameIndex(Math.max(0, Number(e.target.value)))
                  }
                  disabled={isExporting}
                />
              </div>
            )}
          </div>

          <Separator />

          {/* Section 3: Image area, scale, BG */}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Image Contains
              </Label>
              <Select
                value={imageContains}
                onValueChange={setImageContains}
                disabled={isExporting}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="canvas_area">Canvas area</SelectItem>
                  <SelectItem value="min_image_area">Min image area</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Output Scale (%)
              </Label>
              <Input
                type="number"
                className="h-8 text-xs"
                value={outputScale}
                min={1}
                max={400}
                onChange={e =>
                  setOutputScale(Math.max(1, Number(e.target.value)))
                }
                disabled={isExporting}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Background
              </Label>
              <div className="flex items-center gap-2">
                <Select
                  value={bgMode}
                  onValueChange={setBgMode}
                  disabled={isExporting}
                >
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="transparent">Transparent</SelectItem>
                    <SelectItem value="custom">Custom color</SelectItem>
                  </SelectContent>
                </Select>
                {bgMode === 'custom' && (
                  <input
                    type="color"
                    value={bgColor}
                    className="h-8 w-10 rounded border border-input cursor-pointer p-0.5 bg-background"
                    onChange={e => setBgColor(e.target.value)}
                    disabled={isExporting}
                  />
                )}
              </div>
            </div>

            {showJpgWarning && (
              <div className="text-xs text-yellow-600 dark:text-yellow-500 px-2 py-1 rounded bg-yellow-50 dark:bg-yellow-900/20">
                JPG doesn&apos;t support transparency — pixels will be black.
              </div>
            )}
          </div>

          <Separator />

          {/* Section 4: Export destination */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Export to</Label>
            <RadioGroup
              value={exportDest}
              onValueChange={setExportDest}
              disabled={isExporting}
              className="flex gap-4"
            >
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="zip" id="dest-zip" disabled={isExporting} />
                <Label
                  htmlFor="dest-zip"
                  className="text-xs cursor-pointer"
                >
                  ZIP file
                </Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem
                  value="folder"
                  id="dest-folder"
                  disabled={!hasFolderSupport || isExporting}
                />
                <Label
                  htmlFor="dest-folder"
                  className={cn(
                    'text-xs cursor-pointer',
                    (!hasFolderSupport || isExporting) &&
                      'opacity-40 cursor-not-allowed'
                  )}
                >
                  Folder
                  {!hasFolderSupport && (
                    <span className="ml-1 text-muted-foreground">
                      (not supported)
                    </span>
                  )}
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Progress bar */}
          {progress && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{progress.label}</span>
                <span>
                  {progress.current}/{progress.total}
                </span>
              </div>
              <Progress
                value={Math.round((progress.current / progress.total) * 100)}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isExporting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? 'Exporting...' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
