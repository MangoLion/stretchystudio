import React from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';
import { Eye, EyeOff, Edit3, Check, Scissors } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

/**
 * Armature panel — toggles skeleton visibility and joint editing.
 * Sits at the top of the right sidebar.
 */
export function ArmaturePanel() {
  const project = useProjectStore(s => s.project);
  const editorState = useEditorStore();
  const setShowSkeleton = useEditorStore(s => s.setShowSkeleton);
  const setSkeletonEditMode = useEditorStore(s => s.setSkeletonEditMode);
  const setOverlays = useEditorStore(s => s.setOverlays);

  const hasArmature = project.nodes.some(n => n.type === 'group' && n.boneRole);
  if (!hasArmature) return null;

  return (
    <div className="flex flex-col border-l border-b bg-card">
      <div className="px-3 py-2 border-b shrink-0 flex items-center justify-between bg-muted/30">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Armature</h2>
      </div>
      
      <div className="p-2.5 flex flex-col gap-2.5">
        <div className="flex gap-2">
          {/* Skeleton Visibility Toggle */}
          <button
            onClick={() => setShowSkeleton(!editorState.showSkeleton)}
            title={editorState.showSkeleton ? 'Hide Skeleton' : 'Show Skeleton'}
            className={[
              'flex-1 flex flex-col items-center justify-center gap-1.5 px-2 py-2.5 text-[11px] rounded-md border transition-all duration-200 font-medium',
              editorState.showSkeleton
                ? 'bg-primary/10 border-primary/40 text-primary shadow-[0_0_10px_rgba(var(--primary),0.1)]'
                : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground hover:bg-muted',
            ].join(' ')}
          >
            {editorState.showSkeleton ? <EyeOff size={16} /> : <Eye size={16} />}
            <span className="leading-none">{editorState.showSkeleton ? 'Hide' : 'Show'}</span>
          </button>

          {/* Joint Edit Toggle — only in staging mode */}
          {editorState.editorMode === 'staging' && (
            <button
              onClick={() => setSkeletonEditMode(!editorState.skeletonEditMode)}
              disabled={!editorState.showSkeleton}
              title={!editorState.showSkeleton ? 'Show skeleton to edit joints' : (editorState.skeletonEditMode ? 'Finish Editing' : 'Edit Joints')}
              className={[
                'flex-1 flex flex-col items-center justify-center gap-1.5 px-2 py-2.5 text-[11px] rounded-md border transition-all duration-200 font-medium relative',
                !editorState.showSkeleton 
                  ? 'opacity-40 cursor-not-allowed border-border text-muted-foreground bg-muted/20' 
                  : (editorState.skeletonEditMode
                    ? 'bg-yellow-500/10 border-yellow-500/40 text-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.1)]'
                    : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground hover:bg-muted'),
              ].join(' ')}
            >
              {editorState.skeletonEditMode ? <Check size={16} /> : <Edit3 size={16} />}
              <span className="leading-none">{editorState.skeletonEditMode ? 'Done' : 'Edit'}</span>
              
              {editorState.showSkeleton && editorState.skeletonEditMode && (
                <span className="absolute top-1.5 right-1.5 flex h-1.5 w-1.5 rounded-full bg-yellow-500 animate-pulse" />
              )}
            </button>
          )}
        </div>

        {/* Iris Clipping Checkbox */}
        <label className="flex items-center justify-between px-3 py-2 text-xs rounded-md border border-border/50 bg-muted/10 hover:bg-muted/30 transition-all cursor-pointer group">
          <div className="flex items-center gap-2 text-muted-foreground group-hover:text-foreground transition-colors">
            <Scissors size={14} className="opacity-70 group-hover:opacity-100" />
            <span className="font-medium">Iris Clipping</span>
          </div>
          <Checkbox 
            checked={editorState.overlays.irisClipping} 
            onCheckedChange={(val) => setOverlays({ irisClipping: val })}
          />
        </label>
      </div>
    </div>
  );
}
