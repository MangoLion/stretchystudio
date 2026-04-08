/**
 * Inspector panel — shown in the right sidebar.
 *
 * Sections:
 *  1. Overlay toggles: showImage, showWireframe, showVertices, showEdgeOutline
 *  2. Tool mode buttons: select / add_vertex / remove_vertex
 *  3. Selected-node details: name, opacity, visibility (part or group)
 *  4. Transform panel: x, y, rotation, scale, pivot (part or group)
 *  5. Mesh settings: sliders + Remesh button (part only)
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/* ── Small helpers ────────────────────────────────────────────────────────── */

function SectionTitle({ children }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
      {children}
    </p>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <Label className="text-xs text-muted-foreground shrink-0">{label}</Label>
      <div className="flex-1 flex items-center justify-end gap-2">{children}</div>
    </div>
  );
}

function HelpIcon({ tip }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1"
            className="text-muted-foreground/40 hover:text-muted-foreground/60 cursor-help flex-shrink-0">
            <circle cx="6" cy="6" r="5.5"/>
            <text x="6" y="8" fontSize="8" textAnchor="middle" fill="currentColor" fontWeight="bold">?</text>
          </svg>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs text-xs">
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function SliderRow({ label, value, min, max, step = 1, onChange, help }) {
  return (
    <div className="space-y-1 py-0.5">
      <div className="flex justify-between items-center gap-1">
        <div className="flex items-center gap-1">
          <Label className="text-xs text-muted-foreground">{label}</Label>
          {help && <HelpIcon tip={help} />}
        </div>
        <span className="text-xs tabular-nums text-foreground">{value}</span>
      </div>
      <Slider
        min={min} max={max} step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="w-full"
      />
    </div>
  );
}

/**
 * A numeric input that:
 * - Shows the current value
 * - Updates on blur or Enter
 * - Syncs externally when not focused
 */
function NumericInput({ value, onChange, step = 1, precision = 1, className = '' }) {
  const ref = useRef(null);

  // Keep the input in sync with external value changes (when not focused)
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.value = Number(value).toFixed(precision);
    }
  });

  const commit = () => {
    const v = parseFloat(ref.current.value);
    if (!isNaN(v)) onChange(v);
  };

  return (
    <input
      ref={ref}
      type="number"
      step={step}
      defaultValue={Number(value).toFixed(precision)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className={`w-16 text-xs bg-input text-foreground border border-border rounded px-1.5 py-0.5 text-right
        [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
        focus:outline-none focus:ring-1 focus:ring-primary/50 ${className}`}
    />
  );
}

/* ── Overlay toggles ──────────────────────────────────────────────────────── */

function OverlayToggles() {
  const overlays    = useEditorStore(s => s.overlays);
  const setOverlays = useEditorStore(s => s.setOverlays);

  const toggle = (key) => setOverlays({ [key]: !overlays[key] });

  return (
    <div className="space-y-1">
      <SectionTitle>Overlays</SectionTitle>
      {[
        ['showImage',       'Image'],
        ['showWireframe',   'Wireframe'],
        ['showVertices',    'Vertices'],
        ['showEdgeOutline', 'Edge Outline'],
      ].map(([key, label]) => (
        <Row key={key} label={label}>
          <Switch
            checked={overlays[key] ?? true}
            onCheckedChange={() => toggle(key)}
            className="scale-75 origin-right"
          />
        </Row>
      ))}
    </div>
  );
}

/* ── Tool mode ────────────────────────────────────────────────────────────── */

function ToolModeButtons() {
  const toolMode    = useEditorStore(s => s.toolMode);
  const setToolMode = useEditorStore(s => s.setToolMode);

  const tools = [
    { mode: 'select',        label: 'Select' },
    { mode: 'add_vertex',    label: '+ Vertex' },
    { mode: 'remove_vertex', label: '− Vertex' },
  ];

  return (
    <div className="space-y-1">
      <SectionTitle>Tool</SectionTitle>
      <div className="flex gap-1">
        {tools.map(({ mode, label }) => (
          <Button
            key={mode}
            size="sm"
            variant={toolMode === mode ? 'default' : 'outline'}
            className="flex-1 text-xs h-7 px-1"
            onClick={() => setToolMode(mode)}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/* ── Node details (part or group) ─────────────────────────────────────────── */

function NodeDetails({ node }) {
  const updateProject = useProjectStore(s => s.updateProject);

  const setOpacity = useCallback((v) => {
    updateProject((proj) => {
      const n = proj.nodes.find(x => x.id === node.id);
      if (n) n.opacity = v;
    });
  }, [node.id, updateProject]);

  const setVisible = useCallback((checked) => {
    updateProject((proj) => {
      const n = proj.nodes.find(x => x.id === node.id);
      if (n) n.visible = checked;
    });
  }, [node.id, updateProject]);

  return (
    <div className="space-y-1">
      <SectionTitle>{node.type === 'group' ? 'Group' : 'Part'}</SectionTitle>
      <Row label="Name">
        <span className="text-xs font-mono truncate max-w-[100px] text-right" title={node.name}>
          {node.name || node.id}
        </span>
      </Row>
      <Row label="Visible">
        <Switch
          checked={node.visible !== false}
          onCheckedChange={setVisible}
          className="scale-75 origin-right"
        />
      </Row>
      <SliderRow
        label="Opacity"
        value={Math.round((node.opacity ?? 1) * 100)}
        min={0} max={100}
        onChange={(v) => setOpacity(v / 100)}
      />
      {node.type === 'part' && (
        <>
          <Row label="Vertices">
            <span className="text-xs tabular-nums">{node.mesh?.vertices?.length ?? '—'}</span>
          </Row>
          <Row label="Triangles">
            <span className="text-xs tabular-nums">{node.mesh?.triangles?.length ?? '—'}</span>
          </Row>
        </>
      )}
    </div>
  );
}

/* ── Transform panel ──────────────────────────────────────────────────────── */

function TransformPanel({ node }) {
  const updateProject = useProjectStore(s => s.updateProject);

  const setTransformField = useCallback((field, value) => {
    updateProject((proj) => {
      const n = proj.nodes.find(x => x.id === node.id);
      if (!n) return;
      if (!n.transform) n.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
      n.transform[field] = value;
    });
  }, [node.id, updateProject]);

  const t = node.transform ?? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };

  return (
    <div className="space-y-1.5">
      <SectionTitle>Transform</SectionTitle>

      {/* Position */}
      <div className="flex items-center gap-1 py-0.5">
        <Label className="text-xs text-muted-foreground w-8 shrink-0">Pos</Label>
        <div className="flex gap-1 flex-1 justify-end">
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground/60">X</span>
            <NumericInput value={t.x ?? 0} onChange={v => setTransformField('x', v)} step={1} precision={1} />
          </div>
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground/60">Y</span>
            <NumericInput value={t.y ?? 0} onChange={v => setTransformField('y', v)} step={1} precision={1} />
          </div>
        </div>
      </div>

      {/* Rotation */}
      <Row label="Rotation °">
        <NumericInput value={t.rotation ?? 0} onChange={v => setTransformField('rotation', v)} step={0.5} precision={1} />
      </Row>

      {/* Scale */}
      <div className="flex items-center gap-1 py-0.5">
        <Label className="text-xs text-muted-foreground w-8 shrink-0">Scale</Label>
        <div className="flex gap-1 flex-1 justify-end">
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground/60">X</span>
            <NumericInput value={t.scaleX ?? 1} onChange={v => setTransformField('scaleX', v)} step={0.05} precision={2} />
          </div>
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground/60">Y</span>
            <NumericInput value={t.scaleY ?? 1} onChange={v => setTransformField('scaleY', v)} step={0.05} precision={2} />
          </div>
        </div>
      </div>

      {/* Pivot */}
      <div className="flex items-center gap-1 py-0.5">
        <Label className="text-xs text-muted-foreground w-8 shrink-0">Pivot</Label>
        <div className="flex gap-1 flex-1 justify-end">
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground/60">X</span>
            <NumericInput value={t.pivotX ?? 0} onChange={v => setTransformField('pivotX', v)} step={1} precision={1} />
          </div>
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground/60">Y</span>
            <NumericInput value={t.pivotY ?? 0} onChange={v => setTransformField('pivotY', v)} step={1} precision={1} />
          </div>
        </div>
      </div>

      {/* Reset button */}
      <Button
        size="sm"
        variant="outline"
        className="w-full h-6 text-[10px] mt-1"
        onClick={() => updateProject((proj) => {
          const n = proj.nodes.find(x => x.id === node.id);
          if (n) n.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
        })}
      >
        Reset Transform
      </Button>
    </div>
  );
}

/* ── Mesh settings ────────────────────────────────────────────────────────── */

function MeshPanel({ node, onRemesh }) {
  const meshDefaults    = useEditorStore(s => s.meshDefaults);
  const setMeshDefaults = useEditorStore(s => s.setMeshDefaults);
  const updateProject   = useProjectStore(s => s.updateProject);

  const opts = node.meshOpts ?? meshDefaults;

  const setOpt = useCallback((key, value) => {
    if (node.meshOpts) {
      updateProject((proj) => {
        const n = proj.nodes.find(x => x.id === node.id);
        if (n?.meshOpts) n.meshOpts[key] = value;
      });
    } else {
      setMeshDefaults({ [key]: value });
    }
  }, [node.id, node.meshOpts, updateProject, setMeshDefaults]);

  const enablePerPart = useCallback(() => {
    updateProject((proj) => {
      const n = proj.nodes.find(x => x.id === node.id);
      if (n) n.meshOpts = { ...meshDefaults };
    });
  }, [node.id, meshDefaults, updateProject]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionTitle>Mesh Generation</SectionTitle>
        {!node.meshOpts && (
          <button
            onClick={enablePerPart}
            className="text-[10px] text-primary underline-offset-2 hover:underline"
          >
            override
          </button>
        )}
      </div>

      <SliderRow
        label="Alpha Threshold"
        value={opts.alphaThreshold}
        min={1} max={254}
        onChange={(v) => setOpt('alphaThreshold', v)}
        help="Pixel opacity threshold (0–255). Higher = stricter boundary detection."
      />
      <SliderRow
        label="Smooth Passes"
        value={opts.smoothPasses}
        min={0} max={10}
        onChange={(v) => setOpt('smoothPasses', v)}
        help="Laplacian smoothing iterations on the contour. Smooths jagged edges."
      />
      <SliderRow
        label="Grid Spacing"
        value={opts.gridSpacing}
        min={6} max={100}
        onChange={(v) => setOpt('gridSpacing', v)}
        help="Distance between interior sample points. Lower = more vertices, higher detail."
      />
      <SliderRow
        label="Edge Padding"
        value={opts.edgePadding}
        min={0} max={40}
        onChange={(v) => setOpt('edgePadding', v)}
        help="Minimum distance interior points must be from the boundary. Prevents clustering."
      />
      <SliderRow
        label="Edge Points"
        value={opts.numEdgePoints}
        min={8} max={300}
        onChange={(v) => setOpt('numEdgePoints', v)}
        help="Number of points sampled along the contour. More = smoother outline."
      />

      <Button
        size="sm"
        className="w-full h-7 text-xs mt-1"
        onClick={() => onRemesh(node.id, opts)}
      >
        Remesh
      </Button>
    </div>
  );
}

/* ── Root Inspector ───────────────────────────────────────────────────────── */

export function Inspector({ onRemesh }) {
  const selection  = useEditorStore(s => s.selection);
  const nodes      = useProjectStore(s => s.project.nodes);

  const selectedNode = nodes.find(n => n.id === selection[0]) ?? null;

  return (
    <div className="flex flex-col gap-4 p-3 h-full overflow-y-auto">
      <OverlayToggles />
      <Separator />
      <ToolModeButtons />

      {selectedNode ? (
        <>
          <Separator />
          <NodeDetails node={selectedNode} />
          <Separator />
          <TransformPanel node={selectedNode} />
          {selectedNode.type === 'part' && (
            <>
              <Separator />
              <MeshPanel node={selectedNode} onRemesh={onRemesh} />
            </>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground text-center mt-4">
          Select a layer to inspect it.
        </p>
      )}
    </div>
  );
}
