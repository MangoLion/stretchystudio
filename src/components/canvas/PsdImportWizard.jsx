import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle, Circle, Scissors } from 'lucide-react';
import {
  loadDWPoseSession, runDWPose, buildArmatureNodes, analyzeGroups,
  matchTag, estimateSkeletonFromBounds, DWPOSE_URL, clearDWPoseSession,
  KNOWN_TAGS,
} from '../../io/armatureOrganizer';
import { splitLayerLR } from '../../io/splitLR';
import { HelpIcon } from '../ui/help-icon';
import { useToast } from '../../hooks/use-toast';

export default function PsdImportWizard({
  step,
  onSetStep,
  pendingPsd,
  onnxSessionRef,
  onFinalize,
  onSkip,
  onCancel,
  onComplete,
  onBack,
  onSplitArms,  // (rightLayer, leftLayer) → void  — replaces merged handwear with two layers
  onReorder,
  onApplyRig,
}) {
  const { toast } = useToast();
  const [rigStatus, setRigStatus] = useState('');
  const [rigLoading, setRigLoading] = useState(false);
  const [tagOverrides, setTagOverrides] = useState({});
  const [mappingExpanded, setMappingExpanded] = useState(false);
  const [splitError, setSplitError] = useState('');
  const [meshAllParts, setMeshAllParts] = useState(true);
  const [performSplit, setPerformSplit] = useState(true);

  const { psdW, psdH, layers, partIds } = pendingPsd || {};

  /* ── Effective layers: apply tag overrides by renaming to canonical tag ── */
  const effectiveLayers = layers
    ? layers.map(l =>
      tagOverrides[l.name] ? { ...l, name: tagOverrides[l.name] } : l
    )
    : [];

  const matchCount = effectiveLayers.filter(l => matchTag(l.name) !== null).length;
  const unmatchedLayers = layers
    ? layers.filter(l => {
      const effective = tagOverrides[l.name] ?? null;
      if (effective !== null) return false; // user-assigned
      return matchTag(l.name) === null;
    })
    : [];
  const tooFew = matchCount < 4;

  /* ── Detect merged arms (handwear present but no handwear-l or handwear-r) ── */
  const hasHandwear = effectiveLayers.some(l => matchTag(l.name) === 'handwear');
  const hasHandwearL = effectiveLayers.some(l => matchTag(l.name) === 'handwear-l');
  const hasHandwearR = effectiveLayers.some(l => matchTag(l.name) === 'handwear-r');
  const armsMerged = hasHandwear && !hasHandwearL && !hasHandwearR;

  /* ── Handle tag override dropdown change ────────────────────────────────── */
  const handleTagChange = useCallback((layerName, value) => {
    setTagOverrides(prev => {
      const next = { ...prev };
      if (value === '') {
        delete next[layerName];
      } else {
        next[layerName] = value;
      }
      return next;
    });
  }, []);

  const executeSplit = useCallback(() => {
    setSplitError('');
    // Find the merged handwear layer (using effectiveLayers so overrides are respected)
    const mergedIdx = effectiveLayers.findIndex(l => matchTag(l.name) === 'handwear');
    if (mergedIdx === -1) return false;

    const mergedLayer = effectiveLayers[mergedIdx];
    const result = splitLayerLR(mergedLayer, psdW, psdH);

    if (!result.right && !result.left) {
      const errorMsg = `Could not find two separate components in the handwear layer ` +
        `(found ${result.componentCount} component${result.componentCount !== 1 ? 's' : ''}). ` +
        `The layer may be a single connected shape.`;

      setSplitError(errorMsg + " — continuing without split.");

      toast({
        title: "Split Failed",
        description: errorMsg,
        variant: "destructive",
      });

      return false;
    }

    // Build replacement layers
    const rightLayer = result.right ? {
      ...mergedLayer,
      name: 'handwear-r',
      imageData: result.right.imageData,
      x: result.right.x,
      y: result.right.y,
      width: result.right.width,
      height: result.right.height,
    } : null;

    const leftLayer = result.left ? {
      ...mergedLayer,
      name: 'handwear-l',
      imageData: result.left.imageData,
      x: result.left.x,
      y: result.left.y,
      width: result.left.width,
      height: result.left.height,
    } : null;

    onSplitArms(mergedIdx, rightLayer, leftLayer);
    return true;
  }, [effectiveLayers, psdW, psdH, onSplitArms]);

  /* ── Handle manual rigging (bounding-box heuristic) ────────────────────── */
  const handleRigManually = useCallback(async () => {
    setRigLoading(true);
    try {
      const layerMap = {};
      effectiveLayers.forEach(l => {
        const key = l.name.toLowerCase().trim();
        layerMap[key] = l;
      });
      const groups = analyzeGroups(layerMap);

      const skeleton = estimateSkeletonFromBounds(effectiveLayers, psdW, psdH);
      const { groupDefs, assignments } = buildArmatureNodes(skeleton, groups, effectiveLayers, partIds, () => {
        return `grp-${Math.random().toString(36).substr(2, 9)}`;
      });

      if (step === 'reorder') {
        onApplyRig(groupDefs, assignments, meshAllParts);
      } else {
        onFinalize(groupDefs, assignments, meshAllParts);
      }
    } catch (err) {
      console.error('[Manual Rig]', err);
      setRigStatus(`Error: ${err.message}`);
    } finally {
      setRigLoading(false);
    }
  }, [step, effectiveLayers, psdW, psdH, partIds, meshAllParts, onFinalize, onApplyRig]);

  /* ── Handle DWPose rigging ────────────────────────────────────────────── */
  const runArmatureRig = useCallback(async (onnxPayload) => {
    setRigLoading(true);
    try {
      setRigStatus('Loading ONNX model…');
      const session = await loadDWPoseSession(onnxPayload);
      onnxSessionRef.current = session;

      const layerMap = {};
      effectiveLayers.forEach(l => {
        const key = l.name.toLowerCase().trim();
        layerMap[key] = l;
      });
      const groups = analyzeGroups(layerMap);

      const skeleton = await runDWPose(effectiveLayers, psdW, psdH, session, setRigStatus);

      setRigStatus('Building rig…');
      const { groupDefs, assignments } = buildArmatureNodes(skeleton, groups, effectiveLayers, partIds, () => {
        return `grp-${Math.random().toString(36).substr(2, 9)}`;
      });

      if (step === 'reorder') {
        onApplyRig(groupDefs, assignments, meshAllParts);
      } else {
        onFinalize(groupDefs, assignments, meshAllParts);
      }
    } catch (err) {
      console.error('[AutoRig]', err);
      setRigStatus(`Error: ${err.message}`);
      clearDWPoseSession();
    } finally {
      setRigLoading(false);
    }
  }, [step, effectiveLayers, psdW, psdH, partIds, meshAllParts, onFinalize, onApplyRig, onnxSessionRef]);


  /* ── Step: Review layer mapping ─────────────────────────────────────── */
  if (step === 'review') {
    const layerMappings = layers
      ? layers.map(l => ({
        layer: l,
        tag: tagOverrides[l.name] ?? matchTag(l.name),
        overridden: l.name in tagOverrides,
      }))
      : [];

    const hasWarnings = unmatchedLayers.length > 0;
    const allMatched = unmatchedLayers.length === 0;

    // When user clicks Continue, enter the reorder step
    const handleContinue = () => {
      if (armsMerged && performSplit) {
        const ok = executeSplit();
        if (!ok && splitError) return;
      }
      onReorder();
    };

    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="bg-popover border border-border rounded-lg shadow-2xl p-6 max-w-md w-full mx-4 flex flex-col gap-4">
          <h3 className="text-base font-semibold text-foreground">Review Layer Mapping</h3>

          {/* Collapsed summary row */}
          <button
            onClick={() => setMappingExpanded(v => !v)}
            className="flex items-center gap-2 w-full text-left px-3 py-2 rounded border border-border hover:bg-muted transition-colors"
          >
            {tooFew ? (
              <AlertTriangle size={14} className="text-amber-400 shrink-0" />
            ) : allMatched ? (
              <CheckCircle size={14} className="text-green-500 shrink-0" />
            ) : (
              <AlertTriangle size={14} className="text-amber-400 shrink-0" />
            )}
            <span className="flex-1 text-xs text-foreground">
              {matchCount} of {layers.length} layers matched
              {hasWarnings && (
                <span className="text-amber-400 ml-1">
                  · {unmatchedLayers.length} unmatched
                </span>
              )}
              {tooFew && (
                <span className="text-amber-400 ml-1">· too few for auto-rig</span>
              )}
            </span>
            {mappingExpanded
              ? <ChevronDown size={13} className="text-muted-foreground shrink-0" />
              : <ChevronRight size={13} className="text-muted-foreground shrink-0" />
            }
          </button>

          {/* Expanded layer table */}
          {mappingExpanded && (
            <div className="border border-border rounded overflow-hidden">
              <div className="max-h-56 overflow-y-auto">
                {layerMappings.map(({ layer, tag, overridden }) => (
                  <div
                    key={layer.name}
                    className="flex items-center gap-2 px-2 py-1 border-b border-border last:border-b-0 hover:bg-muted/50"
                  >
                    {/* Status icon */}
                    <span className="shrink-0">
                      {tag !== null ? (
                        <CheckCircle size={11} className={overridden ? 'text-blue-400' : 'text-green-500'} />
                      ) : (
                        <Circle size={11} className="text-amber-400" />
                      )}
                    </span>

                    {/* Layer name */}
                    <span
                      className="flex-1 text-[11px] text-muted-foreground truncate"
                      title={layer.name}
                    >
                      {layer.name}
                    </span>

                    {/* Tag dropdown */}
                    <select
                      value={tagOverrides[layer.name] ?? (matchTag(layer.name) ?? '')}
                      onChange={e => handleTagChange(layer.name, e.target.value)}
                      className={[
                        'text-[11px] rounded border px-1 py-0.5 bg-background outline-none shrink-0',
                        tag !== null
                          ? 'border-border text-foreground'
                          : 'border-amber-500/50 text-amber-400',
                      ].join(' ')}
                    >
                      <option value="">— unassigned —</option>
                      {KNOWN_TAGS.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warning messages */}
          {tooFew && (
            <p className="text-[11px] text-amber-400 leading-relaxed">
              At least 4 layers must be matched for automatic rigging. Assign unmatched layers above or skip rigging.
            </p>
          )}

          {/* Split arms toggle (only if merged arms detected) */}
          {armsMerged && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                <input
                  type="checkbox"
                  checked={performSplit}
                  onChange={e => setPerformSplit(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border border-border"
                />
                <span>Split merged arms (recommended)</span>
              </label>
              {splitError && (
                <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-amber-300 leading-relaxed">{splitError}</p>
                </div>
              )}
            </div>
          )}

          {/* Mesh all parts checkbox */}
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
            <input
              type="checkbox"
              checked={meshAllParts}
              onChange={e => setMeshAllParts(e.target.checked)}
              className="w-3.5 h-3.5 rounded border border-border"
            />
            <span>Mesh all parts after import</span>
          </label>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border pt-3 gap-1.5">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Cancel Import
            </button>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onSkip(meshAllParts)}
                className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              >
                Skip rigging
              </button>
              <button
                onClick={handleContinue}
                className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium shrink-0"
              >
                Continue →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }




  /* ── Step: Reorder Layers (floating toolbar) ───────────────────────── */
  if (step === 'reorder') {
    return (
      <div className="absolute top-0 inset-x-0 z-40 flex items-center gap-4 px-4 py-2
                      bg-background/90 border-b border-border backdrop-blur-sm
                      animate-in fade-in slide-in-from-top-4 duration-500 ease-out">
        {/* Shimmer Attention Grabber */}
        <div className="absolute top-0 inset-x-0 h-[2px] overflow-hidden opacity-30">
          <div className="h-full w-1/4 bg-gradient-to-r from-transparent via-primary to-transparent animate-shimmer" />
        </div>

        <span className="text-xs font-semibold text-foreground">Step 2: Reorder Layers</span>
        <span className="text-xs text-muted-foreground flex-1">
          Rearrange layers in the Layer Panel as needed to fix any ordering issues.
        </span>
        <button
          onClick={onCancel}
          className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleRigManually}
          className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-all font-bold
                     shadow-lg shadow-primary/20 ring-1 ring-primary/50 animate-in zoom-in-95 duration-700 delay-300 fill-mode-both"
        >
          Next: Adjust Joints →
        </button>
      </div>
    );
  }

  /* ── Step: DWPose loading ─────────────────────────────────────────── */
  if (step === 'dwpose') {
    const modelLoaded = !!onnxSessionRef?.current;
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="bg-popover border border-border rounded-lg shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-1">Load DWPose model</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Download or upload the ~50 MB DWPose ONNX model for high-accuracy pose detection.
            </p>
          </div>

          {/* Model status */}
          <div className="p-2 rounded bg-muted border border-border">
            <p className="text-xs text-muted-foreground">
              Status: {modelLoaded ? (
                <span className="text-green-500 font-medium">Loaded ✓</span>
              ) : (
                <span className="text-amber-500">Not loaded</span>
              )}
            </p>
          </div>

          {/* Load buttons */}
          <div className="flex flex-col gap-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Load Model</div>
            <div className="flex gap-2">
              {/* Local .onnx file */}
              <label className={[
                'flex-1 text-center px-3 py-1.5 text-xs rounded border cursor-pointer transition-colors',
                rigLoading
                  ? 'opacity-40 pointer-events-none border-border text-muted-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted',
              ].join(' ')}>
                Load .onnx file
                <input
                  type="file" accept=".onnx" className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    runArmatureRig(await f.arrayBuffer());
                  }}
                  disabled={rigLoading}
                />
              </label>

              {/* Download from HuggingFace */}
              <button
                disabled={rigLoading}
                className="flex-1 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-40"
                onClick={() => runArmatureRig(DWPOSE_URL)}
              >
                {rigLoading ? 'Working…' : 'Download'}
              </button>
            </div>

            {/* Status */}
            {rigStatus && (
              <p className={[
                'text-[11px] px-1',
                rigStatus.startsWith('Error') ? 'text-red-400' : 'text-muted-foreground',
              ].join(' ')}>
                {rigStatus}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-between border-t border-border pt-3">
            <button
              disabled={rigLoading}
              className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              onClick={() => onSetStep('adjust')}
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Step: Adjust joints (floating toolbar) ────────────────────────── */
  if (step === 'adjust') {
    return (
      <div className="absolute top-0 inset-x-0 z-40 flex items-center gap-4 px-4 py-2
                      bg-background/90 border-b border-border backdrop-blur-sm
                      animate-in fade-in slide-in-from-top-4 duration-500 ease-out">
        {/* Shimmer Attention Grabber */}
        <div className="absolute top-0 inset-x-0 h-[2px] overflow-hidden opacity-30">
          <div className="h-full w-1/4 bg-gradient-to-r from-transparent via-primary to-transparent animate-shimmer" />
        </div>

        <span className="text-xs font-semibold text-foreground">Step 3: Adjust Joints</span>
        <span className="text-xs text-muted-foreground flex-1">
          Drag yellow dots to reposition joints.
        </span>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors shrink-0">
          <input
            type="checkbox"
            checked={meshAllParts}
            onChange={e => setMeshAllParts(e.target.checked)}
            className="w-3.5 h-3.5 rounded border border-border"
          />
          <span>Mesh all parts</span>
        </label>
        <button
          onClick={() => onSetStep('dwpose')}
          className="px-2 py-1 text-xs rounded border border-primary/50 text-primary hover:bg-primary/10 transition-colors flex items-center gap-1.5"
        >
          <Scissors size={12} />
          AI Auto-Rig (DWPose)
        </button>
        <button
          onClick={onBack}
          className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={() => onComplete(meshAllParts)}
          className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-all font-bold
                     shadow-lg shadow-primary/25 ring-1 ring-primary/50 animate-in zoom-in-95 duration-700 delay-300 fill-mode-both"
        >
          Finish Setup
        </button>
      </div>
    );
  }

  return null;
}
