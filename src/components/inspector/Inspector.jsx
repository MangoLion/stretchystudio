/**
 * Inspector panel — shown in the right sidebar.
 *
 * Sections:
 *  1. Overlay toggles: showImage, showWireframe, showVertices, showEdgeOutline
 *  2. Selected-node details: name, opacity, visibility (part or group)
 *  3. Transform panel: x, y, rotation, scale, pivot (part or group)
 *  4. Mesh settings: +V/-V buttons (only if mesh exists), collapsible sliders, Remesh button (part only)
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';
import { useAnimationStore } from '@/store/animationStore';
import { computePoseOverrides } from '@/renderer/animationEngine';
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
import { HelpIcon } from '@/components/ui/help-icon';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

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

/* ── Node details (part or group) ─────────────────────────────────────────── */

function NodeDetails({ node }) {
  const updateProject = useProjectStore(s => s.updateProject);

  const setOpacity = useCallback((v) => {
    if (useEditorStore.getState().editorMode === 'animation') {
      useAnimationStore.getState().setDraftPose(node.id, { opacity: v });
      if (useEditorStore.getState().autoKeyframe) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK' }));
      }
    } else {
      updateProject((proj) => {
        const n = proj.nodes.find(x => x.id === node.id);
        if (n) n.opacity = v;
      });
    }
  }, [node.id, updateProject]);

  const setVisible = useCallback((checked) => {
    if (useEditorStore.getState().editorMode === 'animation') {
      useAnimationStore.getState().setDraftPose(node.id, { visible: checked });
      if (useEditorStore.getState().autoKeyframe) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK' }));
      }
    } else {
      updateProject((proj) => {
        const n = proj.nodes.find(x => x.id === node.id);
        if (n) n.visible = checked;
      });
    }
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
    </div>
  );
}

/* ── Transform panel ──────────────────────────────────────────────────────── */

function TransformPanel({ node, allNodes }) {
  const updateProject = useProjectStore(s => s.updateProject);

  const setTransformField = useCallback((field, value) => {
    if (useEditorStore.getState().editorMode === 'animation') {
      useAnimationStore.getState().setDraftPose(node.id, { [field]: value });
      if (useEditorStore.getState().autoKeyframe) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', code: 'KeyK' }));
      }
    } else {
      updateProject((proj) => {
        const n = proj.nodes.find(x => x.id === node.id);
        if (!n) return;
        if (!n.transform) n.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
        n.transform[field] = value;
      });
    }
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
      
      {/* Limb skinning warning */}
      {(() => {
        const JSKinningRoles = new Set(['leftElbow', 'rightElbow', 'leftKnee', 'rightKnee']);
        if (!JSKinningRoles.has(node.boneRole)) return null;
        const hasDependent = allNodes.some(n => n.type === 'part' && n.mesh?.jointBoneId === node.id);
        if (hasDependent) return null;
        return (
          <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-xs leading-relaxed text-amber-500">
            <span className="font-bold">⚠ Limb mesh required.</span> To enable rotation deformation: (1) Hide armature, (2) Select the limb layer, and (3) Click 'Remesh'.
          </div>
        );
      })()}
    </div>
  );
}

/* ── Mesh settings ────────────────────────────────────────────────────────── */

function MeshPanel({ node, onRemesh, onDeleteMesh }) {
  const [expanded, setExpanded] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const meshDefaults = useEditorStore(s => s.meshDefaults);
  const setMeshDefaults = useEditorStore(s => s.setMeshDefaults);
  const meshEditMode = useEditorStore(s => s.meshEditMode);
  const setMeshEditMode = useEditorStore(s => s.setMeshEditMode);
  const meshSubMode = useEditorStore(s => s.meshSubMode);
  const setMeshSubMode = useEditorStore(s => s.setMeshSubMode);
  const toolMode = useEditorStore(s => s.toolMode);
  const setToolMode = useEditorStore(s => s.setToolMode);
  const brushSize = useEditorStore(s => s.brushSize);
  const brushHardness = useEditorStore(s => s.brushHardness);
  const setBrush = useEditorStore(s => s.setBrush);
  const updateProject = useProjectStore(s => s.updateProject);

  const handleDeleteMesh = () => {
    onDeleteMesh(node.id);
    setConfirmDelete(false);
  };

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
        <SectionTitle>Mesh</SectionTitle>
        <div className="flex items-center gap-1">
          {node.mesh && (
            <Button
              size="sm"
              variant="destructive"
              className="h-6 px-2 text-[10px]"
              onClick={() => setConfirmDelete(true)}
            >
              Delete Mesh
            </Button>
          )}
          {!node.mesh && !node.meshOpts && (
            <button
              onClick={enablePerPart}
              className="text-[10px] text-primary underline-offset-2 hover:underline"
            >
              override
            </button>
          )}
        </div>
      </div>

      {/* Mesh info + Edit Mode toggle */}
      {node.mesh && (
        <div className="space-y-2">
          <div className="space-y-1">
            <Row label="Vertices">
              <span className="text-xs tabular-nums">{node.mesh?.vertices?.length ?? '—'}</span>
            </Row>
            <Row label="Triangles">
              <span className="text-xs tabular-nums">{node.mesh?.triangles?.length ?? '—'}</span>
            </Row>
          </div>
          <Button
            size="sm"
            variant={meshEditMode ? 'default' : 'outline'}
            className="w-full h-7 text-xs"
            onClick={() => setMeshEditMode(!meshEditMode)}
          >
            {meshEditMode ? 'Exit Edit Mode' : 'Edit Mesh'}
          </Button>
          {meshEditMode && (
            <div className="space-y-1.5">
              <div className="flex rounded overflow-hidden border border-border text-xs">
                <button
                  className={`flex-1 py-1 ${meshSubMode === 'deform' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setMeshSubMode('deform')}
                >
                  Deform
                </button>
                <button
                  className={`flex-1 py-1 border-l border-border ${meshSubMode === 'adjust' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setMeshSubMode('adjust')}
                >
                  Adjust
                </button>
              </div>
              {meshSubMode === 'deform' && (
                <div className="space-y-2 pt-0.5">
                  <SliderRow
                    label="Brush Size"
                    value={brushSize}
                    min={5} max={300} step={1}
                    onChange={(v) => setBrush({ brushSize: v })}
                  />
                  <SliderRow
                    label="Hardness"
                    value={Math.round(brushHardness * 100)}
                    min={0} max={100} step={1}
                    onChange={(v) => setBrush({ brushHardness: v / 100 })}
                  />
                </div>
              )}
              {meshSubMode === 'adjust' && (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={toolMode === 'add_vertex' ? 'default' : 'outline'}
                    className="flex-1 h-7 text-xs"
                    onClick={() => setToolMode(toolMode === 'add_vertex' ? 'select' : 'add_vertex')}
                  >
                    + Vertex
                  </Button>
                  <Button
                    size="sm"
                    variant={toolMode === 'remove_vertex' ? 'destructive' : 'outline'}
                    className="flex-1 h-7 text-xs"
                    onClick={() => setToolMode(toolMode === 'remove_vertex' ? 'select' : 'remove_vertex')}
                  >
                    − Vertex
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!node.mesh && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          No mesh. Generate one to enable vertex editing and mesh warp animation.
        </p>
      )}

      {/* Skin weight warning — shown when mesh exists but has no bone weights */}
      {node.mesh && !node.mesh.jointBoneId && (() => {
        // Only show if this part's parent is a limb bone
        const LIMB_ROLES = new Set(['leftArm', 'rightArm', 'leftLeg', 'rightLeg']);
        const allNodes = useProjectStore.getState().project.nodes;
        const parentNode = allNodes.find(n => n.id === node.parent);
        if (!parentNode || !LIMB_ROLES.has(parentNode.boneRole)) return null;
        return (
          <p className="text-xs leading-relaxed rounded px-2 py-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-400">
            ⚠ Mesh was generated before rigging. Click <strong>Remesh</strong> to enable elbow/knee deformation.
          </p>
        );
      })()}

      {/* Collapsible sliders section */}
      <div className="space-y-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground py-0.5"
        >
          <span>{expanded ? '▼' : '▶'}</span>
          <span className="font-medium">Settings</span>
        </button>
        {expanded && (
          <div className="space-y-2 pl-2 border-l border-border/50">
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
          </div>
        )}
      </div>

      <Button
        size="sm"
        className="w-full h-7 text-xs mt-1"
        onClick={() => onRemesh(node.id, opts)}
      >
        {node.mesh ? 'Remesh' : 'Generate Mesh'}
      </Button>

      {/* Delete mesh confirmation dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogTitle>Delete Mesh?</DialogTitle>
          <DialogDescription>
            This will permanently delete the mesh for "{node.name || node.id}". This action cannot be undone.
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteMesh}>
              Delete Mesh
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Root Inspector ───────────────────────────────────────────────────────── */

export function Inspector({ onRemesh, onDeleteMesh }) {
  const selection = useEditorStore(s => s.selection);
  const editorMode = useEditorStore(s => s.editorMode);
  const nodes = useProjectStore(s => s.project.nodes);
  const animations = useProjectStore(s => s.project.animations);
  
  const activeAnimationId = useAnimationStore(s => s.activeAnimationId);
  const currentTime = useAnimationStore(s => s.currentTime);
  const draftPose = useAnimationStore(s => s.draftPose);
  const loopKeyframes = useAnimationStore(s => s.loopKeyframes);
  const fps = useAnimationStore(s => s.fps);
  const endFrame = useAnimationStore(s => s.endFrame);

  const effectiveNode = React.useMemo(() => {
    const baseNode = nodes.find(n => n.id === selection[0]);
    if (!baseNode) return null;
    if (editorMode !== 'animation') return baseNode;

    const activeAnim = animations.find(a => a.id === activeAnimationId) ?? null;
    const endMs = (endFrame / fps) * 1000;
    const overrides = computePoseOverrides(activeAnim, currentTime, loopKeyframes, endMs);
    
    const kfOv = overrides.get(baseNode.id);
    const drOv = draftPose.get(baseNode.id);
    if (!kfOv && !drOv) return baseNode;

    const tr = { ...baseNode.transform };
    const ANIM_KEYS = ['x', 'y', 'rotation', 'scaleX', 'scaleY'];
    if (kfOv) { for (const k of ANIM_KEYS) { if (kfOv[k] !== undefined) tr[k] = kfOv[k]; } }
    if (drOv) { for (const k of ANIM_KEYS) { if (drOv[k] !== undefined) tr[k] = drOv[k]; } }

    return {
      ...baseNode,
      transform: tr,
      opacity: drOv?.opacity ?? kfOv?.opacity ?? baseNode.opacity,
      visible: drOv?.visible ?? kfOv?.visible ?? baseNode.visible,
    };
  }, [selection, nodes, editorMode, animations, activeAnimationId, currentTime, draftPose, loopKeyframes, fps, endFrame]);

  return (
    <div className="flex flex-col gap-4 p-3 h-full overflow-y-auto">
      {effectiveNode ? (
        <>
          <NodeDetails node={effectiveNode} />
          <Separator />
          <TransformPanel node={effectiveNode} allNodes={nodes} />
          {effectiveNode.type === 'part' && (
            <>
              <Separator />
              <MeshPanel node={effectiveNode} onRemesh={onRemesh} onDeleteMesh={onDeleteMesh} />
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
