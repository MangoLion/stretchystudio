/**
 * LayerPanel — left sidebar with two tabs:
 *
 * DRAW ORDER tab (default):
 *   Flat list of part nodes sorted by draw_order descending (same as before).
 *   Shows a group-name chip badge when a part is parented.
 *   Right-click context menu: "Move into group" / "Remove from group".
 *
 * Groups tab:
 *   Tree view of all nodes (groups + parts).
 *   Drag-and-drop to reparent (only mutates node.parent, never draw_order).
 *   "New Group" button in the toolbar.
 */
import React, { useCallback, useState, useRef } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';

/* ── Icons ────────────────────────────────────────────────────────────────── */

function PartIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="10" height="10" rx="1"/>
    </svg>
  );
}

function GroupIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="10" height="8" rx="1"/>
      <path d="M3 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/>
    </svg>
  );
}


function ChevronIcon({ open }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
      style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.1s' }}>
      <path d="M3 2l4 3-4 3"/>
    </svg>
  );
}

/* ── DRAW ORDER Tab ──────────────────────────────────────────────────────── */

function DepthTabRow({ node, parentGroup, isSelected, onSelect, onToggleVisible, onOpenCtxMenu, onDragStart, onDragOver, onDrop, isDragOver }) {
  return (
    <div
      draggable
      className={`
        flex items-center gap-1 px-2 py-1.5 text-sm rounded cursor-pointer transition-colors select-none
        ${isSelected
          ? 'bg-primary/20 text-primary border border-primary/40'
          : isDragOver
            ? 'bg-accent border border-accent-foreground/30'
            : 'hover:bg-muted text-foreground border border-transparent'
        }
      `}
      onClick={() => onSelect(node.id)}
      onContextMenu={(e) => { e.preventDefault(); onOpenCtxMenu(e, node.id); }}
      onDragStart={(e) => onDragStart(e, node.id)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(node.id); }}
      onDragLeave={() => onDragOver(null)}
      onDrop={(e) => { e.preventDefault(); onDrop(node.id); }}
    >
      {/* Type icon */}
      <span className="shrink-0 w-3 h-3 text-muted-foreground flex items-center">
        <PartIcon />
      </span>

      {/* Name */}
      <span className="flex-1 truncate font-mono text-xs" title={node.name || node.id}>
        {node.name || node.id}
      </span>

      {/* Group chip */}
      {parentGroup && (
        <button
          className="shrink-0 text-[9px] px-1 py-0.5 rounded border border-primary/30 text-primary/70 bg-primary/10 hover:bg-primary/20 leading-none"
          title={`In group: ${parentGroup.name}`}
          onClick={(e) => { e.stopPropagation(); onSelect(parentGroup.id); }}
        >
          {parentGroup.name}
        </button>
      )}

    </div>
  );
}

/* ── Groups Tab tree row ──────────────────────────────────────────────────── */

function GroupsTreeRow({
  node, depth, isSelected, isExpanded,
  onSelect, onToggleExpand, onToggleVisible,
  onDragStart, onDragOver, onDrop, isDragOver,
}) {
  const indent = depth * 14;

  return (
    <div
      draggable
      className={`
        flex items-center gap-1 px-2 py-1.5 text-sm rounded cursor-pointer transition-colors select-none
        ${isSelected
          ? 'bg-primary/20 text-primary border border-primary/40'
          : isDragOver
            ? 'bg-accent border border-accent-foreground/30'
            : 'hover:bg-muted text-foreground border border-transparent'
        }
      `}
      style={{ paddingLeft: 8 + indent }}
      onClick={() => onSelect(node.id)}
      onDragStart={(e) => onDragStart(e, node.id)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(node.id); }}
      onDragLeave={() => onDragOver(null)}
      onDrop={(e) => { e.preventDefault(); onDrop(node.id); }}
    >
      {/* Expand/collapse chevron for groups */}
      {node.type === 'group' ? (
        <button
          className="shrink-0 w-3 h-3 flex items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={(e) => { e.stopPropagation(); onToggleExpand(node.id); }}
        >
          <ChevronIcon open={isExpanded} />
        </button>
      ) : (
        <span className="shrink-0 w-3 h-3" />
      )}

      {/* Type icon */}
      <span className="shrink-0 w-3 h-3 text-muted-foreground flex items-center">
        {node.type === 'group' ? <GroupIcon /> : <PartIcon />}
      </span>

      {/* Name */}
      <span className="flex-1 truncate font-mono text-xs" title={node.name || node.id}>
        {node.name || node.id}
      </span>

    </div>
  );
}

/* ── LayerPanel ───────────────────────────────────────────────────────────── */

export function LayerPanel() {
  const nodes         = useProjectStore(s => s.project.nodes);
  const updateProject = useProjectStore(s => s.updateProject);
  const createGroup   = useProjectStore(s => s.createGroup);
  const reparentNode  = useProjectStore(s => s.reparentNode);

  const selection         = useEditorStore(s => s.selection);
  const setSelection      = useEditorStore(s => s.setSelection);
  const activeLayerTab    = useEditorStore(s => s.activeLayerTab);
  const setActiveLayerTab = useEditorStore(s => s.setActiveLayerTab);
  const wizardStep        = useEditorStore(s => s.wizardStep);

  // Context menu state (Depth tab)
  const [ctxMenu, setCtxMenu] = useState(null); // { nodeId, x, y }

  // Drag state (Depth tab - reorder by draw_order)
  const dragSourceIdDepth = useRef(null);
  const [dragOverIdDepth, setDragOverIdDepth] = useState(null);

  // Drag state (Groups tab - reparent)
  const dragNodeId = useRef(null);
  const [dragOverId, setDragOverId] = useState(null);

  const expanded          = useEditorStore(s => s.expandedGroups);
  const toggleGroupExpand = useEditorStore(s => s.toggleGroupExpand);
  const expandGroup       = useEditorStore(s => s.expandGroup);
  const setExpandedGroups = useEditorStore(s => s.setExpandedGroups);

  // ── Depth tab actions ─────────────────────────────────────────────────

  const toggleVisible = useCallback((id) => {
    updateProject((proj) => {
      const node = proj.nodes.find(n => n.id === id);
      if (node) node.visible = node.visible === false ? true : false;
    });
  }, [updateProject]);

  const openCtxMenu = useCallback((e, nodeId) => {
    setCtxMenu({ nodeId, x: e.clientX, y: e.clientY });
  }, []);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const onDragStartDepth = useCallback((e, nodeId) => {
    dragSourceIdDepth.current = nodeId;
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const onDropDepth = useCallback((targetId) => {
    const sourceId = dragSourceIdDepth.current;
    dragSourceIdDepth.current = null;
    setDragOverIdDepth(null);
    if (!sourceId || sourceId === targetId) return;

    updateProject((proj) => {
      // Get all parts sorted by draw_order descending (as shown in Depth tab)
      const parts = proj.nodes.filter(n => n.type === 'part').sort((a, b) => b.draw_order - a.draw_order);

      // Find source and target indices
      const sourceIdx = parts.findIndex(n => n.id === sourceId);
      const targetIdx = parts.findIndex(n => n.id === targetId);

      if (sourceIdx === -1 || targetIdx === -1) return;

      // Remove source from its current position
      const [source] = parts.splice(sourceIdx, 1);

      // Insert above target (targetIdx might have shifted if source was before it)
      const newTargetIdx = parts.findIndex(n => n.id === targetId);
      parts.splice(newTargetIdx, 0, source);

      // Renumber draw_order from highest to lowest (as shown in Depth tab)
      parts.forEach((part, i) => {
        const node = proj.nodes.find(n => n.id === part.id);
        if (node) node.draw_order = parts.length - 1 - i;
      });
    });
  }, [updateProject]);

  // ── Groups tab actions ────────────────────────────────────────────────

  const toggleExpand = useCallback((id) => {
    toggleGroupExpand(id);
  }, [toggleGroupExpand]);

  const onDragStart = useCallback((e, nodeId) => {
    dragNodeId.current = nodeId;
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const onDrop = useCallback((targetId) => {
    const sourceId = dragNodeId.current;
    dragNodeId.current = null;
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;

    const target = nodes.find(n => n.id === targetId);

    // Only allow dropping onto a group node, or onto a part (reparent to part's parent)
    if (target?.type === 'group') {
      reparentNode(sourceId, targetId);
      expandGroup(targetId);
    } else if (target?.type === 'part') {
      // Drop onto a part → reparent to that part's parent (same level)
      reparentNode(sourceId, target.parent ?? null);
    }
  }, [nodes, reparentNode]);

  // ── Build tree for Groups tab ─────────────────────────────────────────

  function buildTreeRows(nodes) {
    const childMap = {};
    for (const n of nodes) {
      const key = n.parent ?? '__root__';
      childMap[key] = childMap[key] ?? [];
      childMap[key].push(n);
    }

    const rows = [];

    function walk(parentId, depth) {
      const children = childMap[parentId] ?? [];
      // Groups first, then parts
      const sorted = [
        ...children.filter(n => n.type === 'group').sort((a,b) => a.name.localeCompare(b.name)),
        ...children.filter(n => n.type === 'part').sort((a,b) => b.draw_order - a.draw_order),
      ];
      for (const n of sorted) {
        rows.push({ node: n, depth });
        if (n.type === 'group' && expanded.has(n.id)) {
          walk(n.id, depth + 1);
        }
      }
    }

    walk('__root__', 0);
    return rows;
  }

  // ── Derived ───────────────────────────────────────────────────────────

  const nodeMap  = new Map(nodes.map(n => [n.id, n]));
  const groups   = nodes.filter(n => n.type === 'group');
  const depthRows = [...nodes]
    .filter(n => n.type === 'part')
    .sort((a, b) => b.draw_order - a.draw_order);
  const treeRows = buildTreeRows(nodes);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col" onClick={() => ctxMenu && closeCtxMenu()}>

      {/* Tab bar */}
      <div className="flex items-center border-b shrink-0">
        {['depth', 'groups'].filter(t => !wizardStep || t !== 'groups').map(tab => (
          <button
            key={tab}
            className={`flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
              activeLayerTab === tab
                ? 'text-foreground border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveLayerTab(tab)}
          >
            {tab === 'depth' ? 'DRAW ORDER' : 'Groups'}
          </button>
        ))}
      </div>

      {/* ── DRAW ORDER TAB ────────────────────────────────────────────────── */}
      {activeLayerTab === 'depth' && (
        <>
          {/* Column headers */}
          <div className="flex items-center px-2 py-1 border-b text-[10px] text-muted-foreground font-medium shrink-0">
            <span className="w-3 mr-1" />
            <span className="flex-1">Layer</span>
            <span className="text-[10px] text-muted-foreground/50 ml-auto">Drag to reorder</span>
          </div>

          {/* Layer list */}
          <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
            {depthRows.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3 text-center">No layers yet.</p>
            ) : (
              depthRows.map(node => (
                <DepthTabRow
                  key={node.id}
                  node={node}
                  parentGroup={node.parent ? nodeMap.get(node.parent) : null}
                  isSelected={selection.includes(node.id)}
                  isDragOver={dragOverIdDepth === node.id}
                  onSelect={(id) => setSelection([id])}
                  onToggleVisible={toggleVisible}
                  onOpenCtxMenu={openCtxMenu}
                  onDragStart={onDragStartDepth}
                  onDragOver={(id) => setDragOverIdDepth(id)}
                  onDrop={onDropDepth}
                />
              ))
            )}
          </div>
        </>
      )}

      {/* ── GROUPS TAB ─────────────────────────────────────────────────── */}
      {activeLayerTab === 'groups' && (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-1 px-2 py-1 border-b shrink-0">
            <button
              className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onClick={() => {
                createGroup('Group');
              }}
            >
              + New Group
            </button>
            <span className="text-[10px] text-muted-foreground/50 ml-auto">Drag to reparent</span>
          </div>

          {/* Tree */}
          <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
            {treeRows.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3 text-center">No layers yet.</p>
            ) : (
              treeRows.map(({ node, depth }) => (
                <GroupsTreeRow
                  key={node.id}
                  node={node}
                  depth={depth}
                  isSelected={selection.includes(node.id)}
                  isExpanded={expanded.has(node.id)}
                  isDragOver={dragOverId === node.id}
                  onSelect={(id) => setSelection([id])}
                  onToggleExpand={toggleExpand}
                  onToggleVisible={toggleVisible}
                  onDragStart={onDragStart}
                  onDragOver={(id) => setDragOverId(id)}
                  onDrop={onDrop}
                />
              ))
            )}
          </div>
        </>
      )}

      {/* ── Context menu (Depth tab) ────────────────────────────────────── */}
      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[140px] bg-popover border border-border rounded-md shadow-lg py-1 text-xs"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          {/* Move into group submenu items */}
          {groups.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                Move into group
              </div>
              {groups.map(g => (
                <button
                  key={g.id}
                  className="w-full text-left px-4 py-1 hover:bg-accent hover:text-accent-foreground transition-colors"
                  onClick={() => {
                    reparentNode(ctxMenu.nodeId, g.id);
                    closeCtxMenu();
                  }}
                >
                  {g.name}
                </button>
              ))}
              <div className="border-t border-border my-1" />
            </>
          )}

          {/* New group containing this node */}
          <button
            className="w-full text-left px-3 py-1 hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={() => {
              createGroup('Group');
              // After createGroup, the new group is the last node added
              // Reparent on next tick so the group exists
              setTimeout(() => {
                const allNodes = useProjectStore.getState().project.nodes;
                const newGroup = [...allNodes].reverse().find(n => n.type === 'group');
                if (newGroup) reparentNode(ctxMenu.nodeId, newGroup.id);
              }, 0);
              closeCtxMenu();
            }}
          >
            New group with this
          </button>

          {/* Remove from group */}
          {nodeMap.get(ctxMenu.nodeId)?.parent && (
            <button
              className="w-full text-left px-3 py-1 hover:bg-accent hover:text-accent-foreground transition-colors text-destructive"
              onClick={() => {
                reparentNode(ctxMenu.nodeId, null);
                closeCtxMenu();
              }}
            >
              Remove from group
            </button>
          )}
        </div>
      )}
    </div>
  );
}
