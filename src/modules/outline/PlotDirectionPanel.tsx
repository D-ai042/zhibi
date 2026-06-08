import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, StraightEdge, addEdge,
  useNodesState, useEdgesState,
  type Connection, type Node, type Edge, type NodeTypes, type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import PlotStoryNode, { type PlotSegment, type PlotStoryNodeData } from "@/modules/plot-direction/PlotStoryNode";
import { uuid } from "@/lib/uuid";

// ===== localStorage =====
function sk(pid: string) { return "plot-segments-" + pid; }
function ek(pid: string) { return "plot-edges-" + pid; }
function loadSegments(pid: string): PlotSegment[] {
  try { return JSON.parse(localStorage.getItem(sk(pid)) || "[]"); } catch { return []; }
}
function saveSegments(pid: string, segs: PlotSegment[]) {
  localStorage.setItem(sk(pid), JSON.stringify(segs));
}
function loadEdges(pid: string): Edge[] {
  try { return JSON.parse(localStorage.getItem(ek(pid)) || "[]"); } catch { return []; }
}
function saveEdges(pid: string, eds: Edge[]) {
  localStorage.setItem(ek(pid), JSON.stringify(eds));
}

// ===== 撤回收缩 =====
function gk(pid: string) { return "plot-groups-" + pid; }

/** 时间轴配置（起始年 + 间隔） */
interface TimelineConfig {
  startYear: number;
  interval: number;
  label: string; // "纪元", "年", "章" 等
}

const DEFAULT_TIMELINE: TimelineConfig = { startYear: 0, interval: 1, label: "年" };

// ===== 节点位置持久化 =====
function pk(pid: string) { return "plot-positions-" + pid; }
function loadPositions(pid: string): Record<string, { x: number; y: number }> {
  try { return JSON.parse(localStorage.getItem(pk(pid)) || "{}"); } catch { return {}; }
}
function savePositions(pid: string, pos: Record<string, { x: number; y: number }>) {
  localStorage.setItem(pk(pid), JSON.stringify(pos));
}

function loadTimelineConfig(pid: string): TimelineConfig {
  try {
    const raw = localStorage.getItem("plot-timeline-config-" + pid);
    return raw ? JSON.parse(raw) : { ...DEFAULT_TIMELINE };
  } catch { return { ...DEFAULT_TIMELINE }; }
}
function saveTimelineConfig(pid: string, cfg: TimelineConfig) {
  localStorage.setItem("plot-timeline-config-" + pid, JSON.stringify(cfg));
}

export function PlotDirectionPanel() {
  const { currentProject, plotBump } = useAppStore();
  const rfRef = useRef<any>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [timelineConfig, setTimelineConfig] = useState<TimelineConfig>(DEFAULT_TIMELINE);
  const [timelineMarkers, setTimelineMarkers] = useState<{ id: string; px: number }[]>([]); // px position
  const [showTimelineConfig, setShowTimelineConfig] = useState(false);  // 剧本段可引用的项目数据
  const [characterNames, setCharacterNames] = useState<string[]>([]);
  const [placeNames, setPlaceNames] = useState<string[]>([]);
  const [termNames, setTermNames] = useState<string[]>([]); const dragRef = useRef<{ id: string; startX: number; startPx: number; zoom: number } | null>(null);
  const viewportRef = useRef(viewport);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);

  // ===== 撤回/重做 =====
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pushSnapshot = useCallback(() => {
    if (!currentProject) return;
    const segs = JSON.stringify(loadSegments(currentProject.id));
    const eds = JSON.stringify(loadEdges(currentProject.id));
    const pos = JSON.stringify(loadPositions(currentProject.id));
    const stack = undoStackRef.current;
    stack.push(JSON.stringify({ segs, eds, pos }));
    if (stack.length > 50) stack.shift(); // 最多保留 50 步
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [currentProject]);

  const handleUpdateRef = useRef<(s: PlotSegment) => void>(() => { });
  const handleDeleteRef = useRef<(id: string) => void>(() => { });

  const restoreSnapshot = useCallback((snapshotStr: string) => {
    if (!currentProject) return;
    try {
      const { segs, eds, pos } = JSON.parse(snapshotStr);
      localStorage.setItem(sk(currentProject.id), segs);
      localStorage.setItem(ek(currentProject.id), eds);
      if (pos) localStorage.setItem(pk(currentProject.id), pos);
      const parsedSegs = JSON.parse(segs);
      const parsedEds = JSON.parse(eds);
      const parsedPos = pos ? JSON.parse(pos) : {};
      const segNodes: Node[] = parsedSegs.map((s: PlotSegment) => ({
        id: s.id, type: "storyNode",
        position: parsedPos[s.id] || { x: s.type === "bright" ? 100 + parsedSegs.indexOf(s) * 260 : 100 + parsedSegs.filter((x: PlotSegment) => x.type === "dark").indexOf(s) * 260, y: s.type === "bright" ? 180 : 500 },
        data: { segment: s, onUpdate: handleUpdateRef.current, onDelete: handleDeleteRef.current, characterOptions: characterNames, placeOptions: placeNames, termOptions: termNames } as PlotStoryNodeData,
        draggable: true, selectable: true,
      }));
      setNodes(segNodes);
      setEdges(parsedEds);
    } catch { /* ignore */ }
  }, [currentProject, setNodes, setEdges]);

  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0 || !currentProject) return;
    redoStackRef.current.push(JSON.stringify({
      segs: JSON.stringify(loadSegments(currentProject.id)),
      eds: JSON.stringify(loadEdges(currentProject.id)),
      pos: JSON.stringify(loadPositions(currentProject.id)),
    }));
    const snapshot = stack.pop()!;
    restoreSnapshot(snapshot);
    setCanUndo(stack.length > 0);
    setCanRedo(true);
  }, [currentProject, restoreSnapshot]);

  const redo = useCallback(() => {
    const stack = redoStackRef.current;
    if (stack.length === 0 || !currentProject) return;
    undoStackRef.current.push(JSON.stringify({
      segs: JSON.stringify(loadSegments(currentProject.id)),
      eds: JSON.stringify(loadEdges(currentProject.id)),
      pos: JSON.stringify(loadPositions(currentProject.id)),
    }));
    const snapshot = stack.pop()!;
    restoreSnapshot(snapshot);
    setCanUndo(true);
    setCanRedo(stack.length > 0);
  }, [currentProject, restoreSnapshot]);

  // 键盘快捷键（仅 Ctrl+Z / Ctrl+Y 撤回）
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [undo, redo]);

  // ===== 节点回调 =====
  const handleUpdate = useCallback((s: PlotSegment) => {
    if (!currentProject) return;
    pushSnapshot();
    const all = loadSegments(currentProject.id);
    const idx = all.findIndex(x => x.id === s.id);
    if (idx >= 0) all[idx] = s;
    saveSegments(currentProject.id, all);
    setNodes(nds => nds.map(n => n.id === s.id ? { ...n, data: { ...n.data, segment: s } } : n));
  }, [currentProject, setNodes, pushSnapshot]);
  handleUpdateRef.current = handleUpdate;

  const handleDelete = useCallback((id: string) => {
    if (!currentProject) return;
    pushSnapshot();
    const all = loadSegments(currentProject.id).filter(x => x.id !== id);
    saveSegments(currentProject.id, all);
    const updEdges = loadEdges(currentProject.id).filter(e => e.source !== id && e.target !== id);
    saveEdges(currentProject.id, updEdges);
    // 清理被删节点的位置
    const pos = loadPositions(currentProject.id);
    delete pos[id];
    savePositions(currentProject.id, pos);
    setNodes(nds => nds.filter(n => n.id !== id));
    setEdges(updEdges);
  }, [currentProject, setNodes, setEdges, pushSnapshot]);
  handleDeleteRef.current = handleDelete;

  // ===== 加载 =====
  const load = useCallback(() => {
    if (!currentProject) return;
    const segs = loadSegments(currentProject.id);
    const savedPos = loadPositions(currentProject.id);
    const segNodes: Node[] = segs.map(s => ({
      id: s.id,
      type: "storyNode",
      position: savedPos[s.id] || { x: s.type === "bright" ? 100 + segs.indexOf(s) * 260 : 100 + segs.filter(x => x.type === "dark").indexOf(s) * 260, y: s.type === "bright" ? 180 : 500 },
      data: { segment: s, onUpdate: handleUpdateRef.current, onDelete: handleDeleteRef.current, characterOptions: characterNames, placeOptions: placeNames, termOptions: termNames } as PlotStoryNodeData,
      draggable: true, selectable: true,
    }));
    setNodes(segNodes);
    setEdges(loadEdges(currentProject.id));
  }, [currentProject, setNodes, setEdges, characterNames, placeNames, termNames]);

  // 加载角色名和世界观地名
  useEffect(() => {
    if (!currentProject) return;
    api.listCharacters(currentProject.id).then(chars => setCharacterNames(chars.map(c => c.name)));
    api.listWorldTerms(currentProject.id).then(terms => {
      setPlaceNames(terms.filter(t => t.term_type === "place").map(t => t.title));
      setTermNames(terms.map(t => t.title));
    });
  }, [currentProject]);

  // 加载时间轴配置
  useEffect(() => {
    if (!currentProject) return;
    setTimelineConfig(loadTimelineConfig(currentProject.id));
  }, [currentProject]);

  useEffect(() => { load(); }, [load, plotBump]);

  // ===== 连线 =====
  const onConnect = useCallback((conn: Connection) => {
    if (!currentProject) return;
    pushSnapshot();
    setEdges(eds => {
      const upd = addEdge({ ...conn, type: "straight", style: { stroke: "#94a3b8", strokeWidth: 2 } }, eds);
      saveEdges(currentProject.id, upd);
      return upd;
    });
  }, [currentProject, setEdges, pushSnapshot]);

  // ===== 新建段 =====
  const addSegment = useCallback((type: "bright" | "dark") => {
    if (!currentProject) return;
    pushSnapshot();
    const all = loadSegments(currentProject.id);
    const count = all.filter(s => s.type === type).length;
    const s: PlotSegment = {
      id: uuid(), project_id: currentProject.id, type,
      title: type === "bright" ? "新段落" : "新暗线",
      characters: "", location: "", time: "", event: "", chapters: "",
    };
    all.push(s);
    saveSegments(currentProject.id, all);
    setNodes(nds => {
      const updated = [...nds, {
        id: s.id, type: "storyNode",
        position: { x: 100 + count * 260, y: type === "bright" ? 180 : 500 },
        data: { segment: s, onUpdate: handleUpdateRef.current, onDelete: handleDeleteRef.current, characterOptions: characterNames, placeOptions: placeNames, termOptions: termNames } as PlotStoryNodeData,
        draggable: true, selectable: true,
      }];
      // 保存位置
      const positions: Record<string, { x: number; y: number }> = {};
      for (const n of updated) positions[n.id] = { x: n.position.x, y: n.position.y };
      savePositions(currentProject.id, positions);
      return updated;
    });
  }, [currentProject, setNodes, pushSnapshot]);

  // ===== 拖拽停止 =====
  const onNodeDragStop = useCallback((_: any, _node: Node) => {
    if (!currentProject) return;
    pushSnapshot();
    const positions: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) {
      positions[n.id] = { x: n.position.x, y: n.position.y };
    }
    savePositions(currentProject.id, positions);
  }, [currentProject, nodes, pushSnapshot]);

  // ===== 双击边删除 =====
  const onEdgeDblClick = useCallback((_: unknown, edge: Edge) => {
    if (!currentProject) return;
    pushSnapshot();
    setEdges(eds => {
      const upd = eds.filter(e => e.id !== edge.id);
      saveEdges(currentProject.id, upd);
      return upd;
    });
  }, [currentProject, setEdges, pushSnapshot]);

  // ===== 时间轴标记 =====
  const addTimelineMarker = useCallback(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const svgCenterX = (vw / 2 - viewport.x) / viewport.zoom;
    const snapPx = Math.round(svgCenterX / 120) * 120;
    const id = uuid();
    setTimelineMarkers(prev => [...prev, { id, px: snapPx }]);
  }, [viewport]);

  // 拖拽标记
  const handleMarkerMouseDown = useCallback((e: React.MouseEvent, id: string, px: number) => {
    e.preventDefault();
    e.stopPropagation();
    const vp = viewportRef.current;
    dragRef.current = { id, startX: e.clientX, startPx: px, zoom: vp.zoom };
    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const z = dragRef.current.zoom;
      const stepPx = (240 / 2) * z; // 120px * zoom
      const newAbsPx = dragRef.current.startPx + dx / z;
      const snapPx = Math.round(newAbsPx / (120)) * 120;
      setTimelineMarkers(prev => prev.map(m => m.id === dragRef.current!.id ? { ...m, px: snapPx } : m));
    };
    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  // 双击删除标记
  const handleMarkerDoubleClick = useCallback((id: string) => {
    setTimelineMarkers(prev => prev.filter(m => m.id !== id));
  }, []);

  // ===== nodeTypes =====
  const nts: NodeTypes = useMemo(() => ({ storyNode: PlotStoryNode as any }), []);
  const ets: EdgeTypes = useMemo(() => ({ straight: StraightEdge }), []);

  const btnStyle: React.CSSProperties = {
    padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 6,
    border: "none", cursor: "pointer",
  };

  if (!currentProject) return null;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b bg-white px-4 py-2" style={{ zIndex: 10, position: "relative" }}>
        <div>
          <h1 className="text-lg font-bold">剧情走向</h1>
          <p className="text-xs text-slate-400">明线在上 · 暗线在下 · 章节填区间 · 时间填纪元 · 拖拽排序 · 双击修改</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 时间轴配置：起始年 + 间隔 */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b" }}>
            <span>起点</span>
            <input type="number" value={timelineConfig.startYear}
              onChange={e => {
                const v = parseInt(e.target.value) || 0;
                if (currentProject) {
                  const cfg = { ...timelineConfig, startYear: v };
                  setTimelineConfig(cfg);
                  saveTimelineConfig(currentProject.id, cfg);
                }
              }}
              style={{ width: 50, border: "1px solid #e2e8f0", borderRadius: 4, padding: "1px 2px", fontSize: 11, textAlign: "center", outline: "none" }}
            />
            <span>间隔</span>
            <input type="number" min={1} value={timelineConfig.interval}
              onChange={e => {
                const v = Math.max(1, parseInt(e.target.value) || 1);
                if (currentProject) {
                  const cfg = { ...timelineConfig, interval: v };
                  setTimelineConfig(cfg);
                  saveTimelineConfig(currentProject.id, cfg);
                }
              }}
              style={{ width: 40, border: "1px solid #e2e8f0", borderRadius: 4, padding: "1px 2px", fontSize: 11, textAlign: "center", outline: "none" }}
            />
            <input type="text" value={timelineConfig.label}
              onChange={e => {
                if (currentProject) {
                  const cfg = { ...timelineConfig, label: e.target.value };
                  setTimelineConfig(cfg);
                  saveTimelineConfig(currentProject.id, cfg);
                }
              }}
              style={{ width: 40, border: "1px solid #e2e8f0", borderRadius: 4, padding: "1px 2px", fontSize: 11, textAlign: "center", outline: "none" }}
            />
          </div>
          <div style={{ width: 1, height: 16, background: "#e2e8f0" }} />
          <button type="button" onClick={() => addSegment("bright")} style={{ ...btnStyle, background: "#dbeafe", color: "#1d4ed8" }}>
            + 明线段落
          </button>
          <button type="button" onClick={() => addSegment("dark")} style={{ ...btnStyle, background: "#1e293b", color: "#e2e8f0" }}>
            + 暗线段落
          </button>
          <button type="button" onClick={addTimelineMarker}
            style={{ ...btnStyle, background: "#f0fdf4", color: "#16a34a", fontSize: 16, fontWeight: 700 }}>+</button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={undo} disabled={!canUndo}
            className={`rounded px-2 py-1 text-xs font-medium ${canUndo ? "text-slate-700 hover:bg-slate-100" : "text-slate-300 cursor-not-allowed"}`}
            title="撤回 (Ctrl+Z)">↩ 撤回</button>
          <button type="button" onClick={redo} disabled={!canRedo}
            className={`rounded px-2 py-1 text-xs font-medium ${canRedo ? "text-slate-700 hover:bg-slate-100" : "text-slate-300 cursor-not-allowed"}`}
            title="重做 (Ctrl+Y)">↪ 重做</button>
        </div>
      </div>

      <div className="relative flex-1">
        <ReactFlow
          onInit={(inst: any) => { rfRef.current = inst; }}
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange as any} onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeDoubleClick={onEdgeDblClick}
          nodeTypes={nts} edgeTypes={ets}
          defaultEdgeOptions={{ type: "straight", style: { stroke: "#94a3b8", strokeWidth: 2 } }}
          fitView minZoom={0.1} maxZoom={3}
          connectOnClick={true}
          nodesDraggable elementsSelectable
          panOnDrag={[2]} selectionOnDrag
          selectionMode="partial"
          deleteKeyCode={["Delete", "Backspace"]}
          multiSelectionKeyCode="Shift"
          onNodeDragStop={onNodeDragStop}
          onNodesDelete={(deletedNodes) => {
            if (!currentProject) return;
            pushSnapshot();
            const ids = new Set(deletedNodes.map(n => n.id));
            const segs = loadSegments(currentProject.id).filter(s => !ids.has(s.id));
            saveSegments(currentProject.id, segs);
            const eds = loadEdges(currentProject.id).filter(e => !ids.has(e.source) && !ids.has(e.target));
            saveEdges(currentProject.id, eds);
            const pos = loadPositions(currentProject.id);
            for (const id of ids) delete pos[id];
            savePositions(currentProject.id, pos);
          }}
          onMove={(_e: any, vp: { x: number; y: number; zoom: number }) => setViewport(vp)}
        >
          <Background color="#e2e8f0" gap={24} size={1} />
          <Controls className="!shadow-md !rounded-lg !border" />
          <MiniMap className="!shadow-md !rounded-lg !border"
            nodeColor={(n: any) => n.data?.segment?.type === "dark" ? "#6366f1" : "#0ea5e9"}
            maskColor="rgba(0,0,0,0.08)"
          />
        </ReactFlow>

        {/* 数轴时间线 - 跟随画布缩放平移 */}
        <svg style={{
          position: "absolute",
          left: 0, top: 0,
          width: "100%", height: "100%",
          pointerEvents: "none", zIndex: 5,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: "0 0",
          overflow: "visible",
        }}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0,0 L10,5 L0,10 Z" fill="#94a3b8" />
            </marker>
          </defs>
          {/* 轴线 - 无限延伸 */}
          <line x1="-50000" y1="400" x2="50000" y2="400" stroke="#94a3b8" strokeWidth="2"
            markerEnd="url(#arrow)" />
          {/* 比例尺 - 固定间距 = 框宽度的一半(120px) */}
          {(() => {
            const z = viewport.zoom;
            const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
            const halfBox = 120; // SVG坐标空间里每格120px
            // 可见范围（SVG坐标）
            const svgLeft = -viewport.x / z;
            const svgRight = svgLeft + vw / z;
            const startSvg = Math.floor(svgLeft / halfBox) * halfBox - halfBox;
            const endSvg = svgRight + halfBox;
            const ticks: { px: number; label: string; isMajor: boolean }[] = [];
            for (let px = startSvg; px <= endSvg; px += halfBox) {
              const idx = Math.round(px / halfBox);
              const yearVal = timelineConfig.startYear + idx * timelineConfig.interval;
              const label = `${yearVal}${timelineConfig.label}`;
              const screenStep = halfBox * z;
              const isMajor = screenStep > 60 ? true : idx % Math.ceil(60 / screenStep) === 0;
              ticks.push({ px, label, isMajor });
            }
            return ticks.map(t => (
              <g key={t.px}>
                <line x1={t.px} y1={t.isMajor ? 388 : 394} x2={t.px} y2={408}
                  stroke="#94a3b8" strokeWidth={t.isMajor ? 1.5 : 0.5} />
                {t.isMajor && (
                  <text x={t.px} y={424} textAnchor="middle" fill="#94a3b8" fontSize={12} fontWeight="500">
                    {t.label}
                  </text>
                )}
              </g>
            ));
          })()}
          {/* 时间轴标记虚线 - SVG内无限延伸 */}
          {timelineMarkers.map(m => (
            <g key={m.id}>
              <line x1={m.px} y1={-10000} x2={m.px} y2={10000} stroke="#16a34a" strokeWidth={2} strokeDasharray="6,4" opacity={0.7} />
            </g>
          ))}
        </svg>
        {/* 透明交互层 - 用于拖拽和双击 */}
        {timelineMarkers.map(m => {
          const screenX = (m.px) * viewport.zoom + viewport.x;
          return (
            <div key={m.id} style={{
              position: "absolute", left: screenX - 7, top: 0, width: 14, height: "100%", zIndex: 6,
              pointerEvents: "auto", cursor: "ew-resize",
            }}
              onMouseDown={(e) => { e.stopPropagation(); handleMarkerMouseDown(e, m.id, m.px); }}
              onDoubleClick={() => handleMarkerDoubleClick(m.id)}
            />
          );
        })}
      </div>

    </div>
  );
}

