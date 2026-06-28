import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  type Node, type Edge, type Connection, type NodeTypes, type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Lock, Unlock, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import type { WorldTerm } from "@/types";
import WorldviewTermNode from "./WorldviewTermNode";
import { uuid } from "@/lib/uuid";

// ==== colors ====
const TC: Record<string, { bg: string; border: string }> = {
  rule: { bg: "#dbeafe", border: "#3b82f6" },
  faction: { bg: "#fce7f3", border: "#ec4899" },
  place: { bg: "#d1fae5", border: "#10b981" },
  item: { bg: "#ede9fe", border: "#8b5cf6" },
  system: { bg: "#fed7aa", border: "#f97316" },
  other: { bg: "#f3f4f6", border: "#9ca3af" },
};

// ==== storage ====
import { getJSONSync, setJSONSync } from "@/lib/storage";
import { confirmDialog } from "@/lib/confirm";
function ek(pid: string) { return "worldview-edges-" + pid; }
function gk(pid: string) { return "worldview-groups-" + pid; }
function loadEdges(pid: string): Edge[] { return getJSONSync(ek(pid), []); }
function saveEdges(pid: string, ed: Edge[]) { setJSONSync(ek(pid), ed); }
interface SavedGroup { id: string; name: string; locked: boolean; x: number; y: number; w: number; h: number; bg: string; border: string; childIds: string[] }
function saveGroups(pid: string, gs: SavedGroup[]) { setJSONSync(gk(pid), gs); }
function loadGroups(pid: string): SavedGroup[] { return getJSONSync(gk(pid), []); }

/**
 * ★ 横平竖直步进连线 — 双模式对称
 *
 * 规则：
 * - 手柄在左右（right/left）→ 水平→垂直→水平
 * - 手柄在上下（bottom/top）→ 垂直→水平→垂直
 * - 永远镜像对称
 */
function StepMergeEdge({
  sourceX, sourceY, targetX, targetY,
  sourcePosition, style, markerEnd,
}: any) {
  let path;

  // 用手柄方向决定路径模式，而非坐标差值
  const isHorizontal =
    sourcePosition === "right" || sourcePosition === "left";

  if (isHorizontal) {
    // 水平→垂直→水平
    const midX = (sourceX + targetX) / 2;
    path = `M ${sourceX},${sourceY} L ${midX},${sourceY} L ${midX},${targetY} L ${targetX},${targetY}`;
  } else {
    // 垂直→水平→垂直
    const midY = (sourceY + targetY) / 2;
    path = `M ${sourceX},${sourceY} L ${sourceX},${midY} L ${targetX},${midY} L ${targetX},${targetY}`;
  }

  return (
    <g>
      {/* 透明宽路径：加大双击/点击判定区域（60px vs 可见的2px） */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={60}
        style={{ cursor: "pointer" }}
        className="react-flow__edge-path"
      />
      {/* 可见路径 */}
      <path
        d={path}
        fill="none"
        stroke="#94a3b8"
        strokeWidth={2}
        style={style}
        markerEnd={markerEnd}
        className="react-flow__edge-path"
      />
    </g>
  );
}

/**
 * ★ 合流分组渲染：对同一 target 的边，合并末端主干
 */
export function MergedEdgesGroup({ edges, nodeMap }: { edges: any[]; nodeMap: Map<string, { x: number; y: number }> }) {
  // 按 target 分组
  const groups = new Map<string, any[]>();
  for (const e of edges) {
    if (!groups.has(e.target)) groups.set(e.target, []);
    groups.get(e.target)!.push(e);
  }

  const paths: JSX.Element[] = [];

  for (const [targetId, groupEdges] of groups) {
    const tgt = nodeMap.get(targetId);
    if (!tgt) continue;

    const mergeX = tgt.x - 32;  // 在 target 左侧 32px 处汇聚
    const sorted = [...groupEdges].sort((a, b) => a.sourceY - b.sourceY);

    if (sorted.length === 1) {
      // 单条：标准步进
      const e = sorted[0];
      const src = nodeMap.get(e.source);
      if (!src) continue;
      paths.push(
        <path key={e.id}
          d={`M ${src.x + 100},${src.y + 24} L ${src.x + 100 + 24},${src.y + 24} L ${src.x + 100 + 24},${tgt.y + 24} L ${mergeX},${tgt.y + 24} L ${tgt.x},${tgt.y + 24}`}
          fill="none" stroke="#94a3b8" strokeWidth={2} className="react-flow__edge-path" />
      );
      continue;
    }

    // 多条：各自水平到合流点，然后合为一条主干
    const trunkY = tgt.y + 24;
    const trunkStartX = mergeX;
    const trunkEndX = tgt.x;

    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      const src = nodeMap.get(e.source);
      if (!src) continue;
      const srcX = src.x + 100;
      const srcY = src.y + 24;
      // 各分支独立走到合流点
      const branchEndX = trunkStartX - 4; // 留 4px 间距接入主干
      paths.push(
        <path key={e.id}
          d={`M ${srcX},${srcY} L ${srcX + 24},${srcY} L ${srcX + 24},${trunkY} L ${branchEndX},${trunkY}`}
          fill="none" stroke="#94a3b8" strokeWidth={2} className="react-flow__edge-path" />
      );
    }
    // 主干：从合流点到 target
    paths.push(
      <path key={`trunk-${targetId}`}
        d={`M ${trunkStartX},${trunkY} L ${trunkEndX},${trunkY}`}
        fill="none" stroke="#94a3b8" strokeWidth={2} opacity={0.7} className="react-flow__edge-path" />
    );
  }

  return <>{paths}</>;
}

// ==== GroupNode - only title bar, no background/border ====
function GroupNode({ data }: { data: any }) {
  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "visible", pointerEvents: "none" }}>
      <div style={{ position: "absolute", top: -30, left: 6, display: "flex", alignItems: "center", gap: 6, background: "white", borderRadius: 8, border: "1.5px solid " + (data.borderColor || "#9ca3af"), padding: "2px 8px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", zIndex: 10, whiteSpace: "nowrap", pointerEvents: "auto" }}>
        <button className="nodrag" onClick={(e) => { e.stopPropagation(); data.onToggleLock?.(); }} style={{ cursor: "pointer", background: "none", border: "none", padding: 0, lineHeight: 0 }}>
          {data.locked ? <Lock size={12} color={data.borderColor || "#9ca3af"} /> : <Unlock size={12} color={data.borderColor || "#9ca3af"} />}
        </button>
        <Pencil size={12} color="#94a3b8" />
        <span style={{ fontSize: 12, fontWeight: 600, color: data.borderColor || "#9ca3af" }}>{(data.label as string) || "编组"}</span>
      </div>
    </div>
  );
}

export function WorldviewPanel() {
  const { currentProject, setSelectedEntity, worldTermBump, groupBump, setWorldviewGroups, focusGroupBump, worldviewZoneEnabled, setWorldviewZoneEnabled } = useAppStore();
  const rfRef = useRef<any>(null);
  const [terms, setTerms] = useState<WorldTerm[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [showDlg, setShowDlg] = useState(false);
  const [gName, setGName] = useState("新编组");
  const [pendSel, setPendSel] = useState<string[]>([]);
  const [editingTermId, setEditingTermId] = useState<string | null>(null); // which term title is being edited
  const [groupCtx, setGroupCtx] = useState<{ x: number; y: number; gid: string; name: string } | null>(null);
  const [renameDlg, setRenameDlg] = useState<{ gid: string; name: string } | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => { });
  // 四象限十字线中心坐标（画布坐标系）
  const CX = 600, CY = 400;
  // 视口追踪（用于 SVG 覆盖层同步）
  const [vp, setVp] = useState({ x: 0, y: 0, zoom: 1 });
  // 根据坐标判断所在分区
  const zoneFromPos = useCallback((x: number, y: number): "core" | "locked" | "active" | "other" => {
    if (x < CX && y < CY) return "core";
    if (x >= CX && y < CY) return "locked";
    if (x < CX && y >= CY) return "active";
    return "other";
  }, []);
  // 分区中文名 + 颜色
  const ZONE_META: Record<string, { label: string; desc: string; color: string; pale: string }> = {
    core: { label: "核心规则", desc: "上下文必定加载的词条", color: "#dc2626", pale: "rgba(220,38,38,0.06)" },
    locked: { label: "词条锁定", desc: "写作台AI不可见（右侧AI聊天可见）", color: "#4b5563", pale: "rgba(75,85,99,0.06)" },
    active: { label: "当前创作", desc: "当前所处剧情需要的词条", color: "#16a34a", pale: "rgba(22,163,74,0.06)" },
    other: { label: "其他", desc: "出现频次低、影响小的词条", color: "#ea580c", pale: "rgba(234,88,12,0.06)" },
  };

  // ==== callbacks ====
  const pushHRef = useRef<() => void>(() => { });
  const handleUpdate = useCallback(async (u: WorldTerm) => { pushHRef.current(); await api.saveWorldTerm(u); setTerms(p => p.map(t => t.id === u.id ? u : t)); setNodes(nds => nds.map(n => n.id === u.id ? { ...n, draggable: !u.is_locked, data: { ...n.data, term: u } } : n)); }, [setNodes]);
  const handleSelect = useCallback((t: WorldTerm) => { setSelectedEntity({ type: "world_term", id: t.id, name: t.title }); }, [setSelectedEntity]);
  const delRef = useRef<(id: string, title: string) => void>(() => { });
  delRef.current = useCallback(async (id: string, title: string) => {
    pushHRef.current();
    // ★ 优先使用节点传入的 title（避免 terms 闭包过期导致显示 id）
    const term = terms.find(t => t.id === id);
    const displayTitle = title || term?.title || id;
    if (!await confirmDialog(`确定删除词条「${displayTitle}」？此操作不可撤销。`)) return;
    await api.deleteWorldTerm(id);
    setTerms(p => p.filter(t => t.id !== id));
    // remove edges pointing to/from this node
    setEdges(eds => { const u = eds.filter(e => e.source !== id && e.target !== id); if (currentProject) saveEdges(currentProject.id, u); return u; });
    // clean group childIds
    if (currentProject) {
      const gs = loadGroups(currentProject.id);
      let dirty = false;
      for (const g of gs) {
        const idx = g.childIds.indexOf(id);
        if (idx >= 0) { g.childIds.splice(idx, 1); dirty = true; }
      }
      if (dirty) saveGroups(currentProject.id, gs.filter(g => g.childIds.length > 0));
    }
    setNodes(nds => nds.filter(n => n.id !== id));
  }, [setNodes, setEdges, currentProject, terms]);

  // ==== load ====

  /** 基于连线关系的智能布局：未定位词条按连线关系分层、横向排列 */
  const computeLayout = useCallback((loaded: WorldTerm[], pid: string): { x: number; y: number }[] => {
    const SPACING_X = 320;
    const SPACING_Y = 260;
    const MARGIN = 80;
    const MAX_PER_ROW = 6;

    // 拆分已定位 / 未定位
    const positioned = new Map<string, { x: number; y: number }>();
    const unpositioned: WorldTerm[] = [];
    for (const t of loaded) {
      if (t.layout_x > 0 || t.layout_y > 0) {
        positioned.set(t.id, { x: t.layout_x, y: t.layout_y });
      } else {
        unpositioned.push(t);
      }
    }

    // 已定位节点直接返回，不参与任何布局计算
    if (unpositioned.length === 0) {
      return loaded.map(t => positioned.get(t.id)!);
    }

    // 构建邻接表（所有边，无论节点是否已定位）
    const children = new Map<string, string[]>();
    const parents = new Map<string, string[]>();
    const allEdges = loadEdges(pid);
    for (const e of allEdges) {
      if (!children.has(e.source)) children.set(e.source, []);
      children.get(e.source)!.push(e.target);
      if (!parents.has(e.target)) parents.set(e.target, []);
      parents.get(e.target)!.push(e.source);
    }

    const unposSet = new Set(unpositioned.map(t => t.id));
    const visited = new Set<string>();
    const assigned = new Map<string, { x: number; y: number }>();

    // ── 第1步：已定位节点 → 未定位子节点（锚定在父节点下方） ──
    const anchoredByParent = new Map<string, string[]>();
    for (const t of unpositioned) {
      const pList = parents.get(t.id) || [];
      for (const pid of pList) {
        if (positioned.has(pid)) {
          if (!anchoredByParent.has(pid)) anchoredByParent.set(pid, []);
          anchoredByParent.get(pid)!.push(t.id);
        }
      }
    }
    for (const [pid, childIds] of anchoredByParent) {
      const pp = positioned.get(pid)!;
      // 把子节点排在父节点正下方，水平展开
      const startX = pp.x;
      const startY = pp.y + SPACING_Y;
      for (let i = 0; i < childIds.length; i++) {
        if (visited.has(childIds[i])) continue;
        visited.add(childIds[i]);
        assigned.set(childIds[i], { x: startX + i * SPACING_X, y: startY });
      }
    }

    // ── 第2步：BFS 分层处理剩余未定位节点 ──
    const layers: string[][] = [];
    let queue: string[] = [];
    for (const t of unpositioned) {
      if (visited.has(t.id)) continue;
      const p = parents.get(t.id) || [];
      // 根：所有父节点都已定位或已被分配
      if (p.every(pid => positioned.has(pid) || assigned.has(pid) || !unposSet.has(pid))) {
        queue.push(t.id);
      }
    }

    while (queue.length > 0) {
      const layer: string[] = [];
      const nextSet = new Set<string>();
      for (const id of queue) {
        if (visited.has(id)) continue;
        visited.add(id);
        layer.push(id);
        for (const cid of children.get(id) || []) {
          if (unposSet.has(cid) && !visited.has(cid)) nextSet.add(cid);
        }
      }
      if (layer.length > 0) layers.push(layer);
      queue = [...nextSet];
    }

    // 剩余孤立/环路节点
    const remaining = unpositioned.filter(t => !visited.has(t.id));
    if (remaining.length > 0) layers.push(remaining.map(t => t.id));

    // ── 第3步：模板检测 + 坐标分配（仅未定位节点，不影响已有节点） ──
    let anchorX = MARGIN;
    if (positioned.size > 0) {
      const allPos = [...positioned.values()];
      anchorX = Math.max(...allPos.map(p => p.x)) + SPACING_X + 80;
    } else {
      anchorX = MARGIN;
    }
    const titleMap = new Map(loaded.map(t => [t.id, t.title]));
    // 方位型检测：第一层为单根节点，第二层含方向词
    const L1 = layers[0] ?? [];
    const L2 = layers[1] ?? [];
    const L2Titles = L2.map(id => titleMap.get(id) || "");
    const hasCenter = L2Titles.some(t => /^中/.test(t));
    const dirCount = L2Titles.filter(t => /^[东南西北]/.test(t)).length;
    const isDirectional = hasCenter && dirCount >= 3 && L2.length >= 4 && L1.length === 1;
    const isChain = layers.length >= 3 && layers.every(l => l.length === 1);

    if (isDirectional) {
      // ═══ 方位型：中心 + 十字 ═══
      const cx = anchorX + SPACING_X;
      const cy = MARGIN + SPACING_Y;
      // L1: 根节点居中
      for (const id of L1) assigned.set(id, { x: cx, y: cy });
      // L2: 方向子节点按方位排列（不重叠）
      for (const id of L2) {
        const t = titleMap.get(id) || "";
        if (/^中/.test(t)) assigned.set(id, { x: cx, y: cy + SPACING_Y });
        else if (/^东/.test(t)) assigned.set(id, { x: cx + SPACING_X, y: cy + SPACING_Y });
        else if (/^南/.test(t)) assigned.set(id, { x: cx, y: cy + SPACING_Y * 2 });
        else if (/^西/.test(t)) assigned.set(id, { x: cx - SPACING_X, y: cy + SPACING_Y });
        else if (/^北/.test(t)) assigned.set(id, { x: cx, y: cy - SPACING_Y });
        else assigned.set(id, { x: cx + (L2.indexOf(id) - 2) * SPACING_X, y: cy + SPACING_Y });
      }
      let ry = cy + SPACING_Y * 3;
      for (let li = 2; li < layers.length; li++) {
        const layer = layers[li];
        for (let ni = 0; ni < layer.length; ni++) {
          const pp = assigned.get((parents.get(layer[ni]) || [])[0]);
          const sx = pp ? pp.x - ((layer.length - 1) * SPACING_X) / 2 : anchorX;
          assigned.set(layer[ni], { x: sx + ni * SPACING_X, y: ry });
        }
        ry += SPACING_Y;
      }
    } else if (isChain) {
      // ═══ 层层递进 / 时间线型 ═══
      let cy = MARGIN;
      for (let li = 0; li < layers.length; li++) {
        for (const id of layers[li]) assigned.set(id, { x: anchorX, y: cy });
        cy += SPACING_Y;
      }
    } else {
      // ═══ 族谱/树型 & 循环型 ═══
      let ry = MARGIN;
      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        const hasIntraEdges = allEdges.some(e => layer.includes(e.source) && layer.includes(e.target));
        const gap = hasIntraEdges && layer.length <= 5 ? SPACING_X * 0.75 : SPACING_X;
        const sx = anchorX - ((layer.length - 1) * gap) / 2;
        let col = 0;
        for (let ni = 0; ni < layer.length; ni++) {
          if (col >= MAX_PER_ROW) { col = 0; ry += SPACING_Y; }
          assigned.set(layer[ni], { x: sx + col * gap, y: ry + Math.floor(ni / MAX_PER_ROW) * SPACING_Y });
          col++;
        }
        ry += SPACING_Y;
      }
    }

    return loaded.map(t => positioned.get(t.id) ?? assigned.get(t.id) ?? { x: anchorX, y: MARGIN + layers.length * SPACING_Y });
  }, []);
  void computeLayout;

  const load = useCallback(async () => {
    if (!currentProject) return;
    const loaded = await api.listWorldTerms(currentProject.id);
    // ★ 每次加载都根据坐标重新计算 zone（不依赖持久化，新旧数据兼容）
    for (const t of loaded) {
      const computed = zoneFromPos(t.layout_x || 400, t.layout_y || 200);
      if (t.zone !== computed) {
        t.zone = computed;
        // 异步持久化 zone（不阻塞渲染）
        api.saveWorldTerm(t).catch(() => { });
      }
    }
    setTerms(loaded);

    const termNodes: Node[] = loaded.map((t) => {
      const base = {
        id: t.id,
        data: { term: t, onUpdate: handleUpdate, onSelect: handleSelect, onDelete: delRef.current },
        type: "worldviewTerm" as const,
        draggable: !t.is_locked,
      };
      // 已定位节点 → 使用 localStorage 保存的坐标
      if (t.layout_x !== 0 || t.layout_y !== 0) {
        return { ...base, position: { x: t.layout_x, y: t.layout_y } };
      }
      // 新节点（layout 为 0,0）→ 随机偏移避免全部堆叠在一起
      const offsetX = Math.round(Math.random() * 200 - 100);
      const offsetY = Math.round(Math.random() * 200 - 100);
      return { ...base, position: { x: 400 + offsetX, y: 200 + offsetY } };
    });

    // restore groups: convert child coords to relative, group node first
    const termIdSet = new Set(termNodes.map(n => n.id));
    let groupsDirty = false;
    const saved = loadGroups(currentProject.id).map(g => {
      const childIds = (g.childIds || []).filter(id => termIdSet.has(id));
      if (childIds.length !== (g.childIds || []).length) groupsDirty = true;
      return { ...g, childIds };
    }).filter(g => {
      if (g.childIds.length > 0) return true;
      groupsDirty = true;
      return false;
    });
    if (groupsDirty) saveGroups(currentProject.id, saved);
    const gNodes: Node[] = [];
    const childIds = new Set<string>();
    for (const g of saved) {
      // ★ 防御：补全可能缺失的字段（旧数据/手动修改 JSON 可能导致 undefined → NaN）
      g.x = g.x ?? 0; g.y = g.y ?? 0;
      g.w = g.w ?? 400; g.h = g.h ?? 300;
      g.bg = g.bg ?? "#f3f4f6"; g.border = g.border ?? "#9ca3af";
      for (const cn of termNodes) {
        if (g.childIds.includes(cn.id)) {
          cn.position = { x: cn.position.x - g.x, y: cn.position.y - g.y };
          cn.parentId = g.id;
          cn.extent = "parent";
          cn.draggable = false;
          childIds.add(cn.id);
        }
      }
      gNodes.push({
        id: g.id, type: "group", position: { x: g.x, y: g.y }, draggable: !g.locked, selectable: true,
        data: { label: g.name, locked: g.locked, borderColor: g.border, bgColor: g.bg, onToggleLock: () => toggleLock(g.id) },
        style: { width: g.w, height: g.h, backgroundColor: g.bg + "1a", border: "1.5px solid " + g.border, borderRadius: 12 },
      } as any);
    }
    setNodes([...gNodes, ...termNodes]);

    // 为缺少 handle 的连线自动推算最佳方向，同时过滤孤立边
    const rawEdges = loadEdges(currentProject.id);
    const termIds = new Set(termNodes.map(n => n.id));
    const validEdges = rawEdges.filter(e => termIds.has(e.source) && termIds.has(e.target));
    const orphanedCount = rawEdges.length - validEdges.length;
    const posMap = new Map(termNodes.map(n => [n.id, n.position]));
    let dirty = orphanedCount > 0;
    for (const e of validEdges) {
      if (e.type !== "step-merge") { e.type = "step-merge"; e.style = { stroke: "#94a3b8", strokeWidth: 2 }; dirty = true; }
      if (e.sourceHandle && e.targetHandle) continue;
      const sp = posMap.get(e.source) ?? { x: 0, y: 0 };
      const tp = posMap.get(e.target) ?? { x: 0, y: 0 };
      const dx = Math.abs(tp.x - sp.x);
      const dy = Math.abs(tp.y - sp.y);
      if (dy < dx) {
        e.sourceHandle = "right"; e.targetHandle = "left";
      } else {
        e.sourceHandle = "bottom"; e.targetHandle = "top";
      }
      dirty = true;
    }
    if (dirty) saveEdges(currentProject.id, validEdges);
    setEdges(validEdges);
    setWorldviewGroups(saved.map(g => ({ id: g.id, name: g.name, x: g.x, y: g.y, locked: g.locked })));
  }, [currentProject, handleUpdate, handleSelect, setNodes, setEdges, setWorldviewGroups]);
  loadRef.current = load;

  // Toggle editing flag on node data when editingTermId changes
  useEffect(() => {
    setNodes(nds => nds.map(n => ({
      ...n,
      data: { ...n.data, editing: n.id === editingTermId },
    })));
  }, [editingTermId, setNodes]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (worldTermBump > 0) load(); }, [worldTermBump]);
  useEffect(() => { if (groupBump > 0) load(); }, [groupBump]);

  // focus
  useEffect(() => {
    if (focusGroupBump > 0 && rfRef.current) {
      const targetId = useAppStore.getState().activeExtraId;
      if (targetId) {
        const node = nodes.find(n => n.id === targetId);
        if (node) rfRef.current.setCenter(node.position.x + 180, node.position.y + 120, { zoom: 0.6, duration: 400 });
      }
    }
  }, [focusGroupBump]);

  // ==== drag ====
  const onDragStop = useCallback(async (_: unknown, node: Node, allNodes?: Node[]) => {
    if (node.type === "group" && currentProject) {
      const gs = loadGroups(currentProject.id);
      const g = gs.find(x => x.id === node.id);
      if (g) {
        g.x = node.position.x; g.y = node.position.y; saveGroups(currentProject.id, gs);
        // 编组整块分区检测：编组中心点压线则所有子词条继承新分区
        const gCenter = { x: node.position.x + (g.w ?? 400) / 2, y: node.position.y + (g.h ?? 300) / 2 };
        const newZone = zoneFromPos(gCenter.x, gCenter.y);
        const liveNodes: Node[] = rfRef.current?.getNodes() || nodes;
        for (const cid of g.childIds) {
          const childNode = liveNodes.find((n: Node) => n.id === cid);
          if (childNode) {
            const absX = node.position.x + childNode.position.x;
            const absY = node.position.y + childNode.position.y;
            api.saveNodeLayout("world_term", cid, absX, absY).catch(e => console.error("saveNodeLayout failed:", e));
            // ★ 全部子词条更新 layout 到 DB（不论 zone 是否变化）
            const ct = terms.find(x => x.id === cid);
            if (ct) {
              const u = { ...ct, layout_x: absX, layout_y: absY, zone: ct.zone !== newZone ? newZone : ct.zone };
              if (ct.zone !== newZone || ct.layout_x !== absX || ct.layout_y !== absY) {
                await api.saveWorldTerm(u as WorldTerm).catch(() => { });
                setTerms(p => p.map(t => t.id === cid ? u : t));
                setNodes(nds => nds.map(n => n.id === cid ? { ...n, data: { ...n.data, term: u } } : n));
              }
            }
          }
        }
        setWorldviewGroups(p => p.map(gr => gr.id === g.id ? { ...gr, x: g.x, y: g.y } : gr));
      }
      return;
    }
    // ★ 处理多选拖拽：保存 ALL 被拖动词条的位置，而非仅主节点
    const batch = allNodes && allNodes.length > 1
      ? allNodes.filter(n => n.type === "worldviewTerm")
      : [node];
    for (const n of batch) {
      if (n.type !== "worldviewTerm") continue;
      const t = terms.find(x => x.id === n.id);
      if (!t) continue;
      const newZone = zoneFromPos(n.position.x + 50, n.position.y + 24);
      const u = { ...t, layout_x: n.position.x, layout_y: n.position.y, zone: newZone };
      setTerms(p => p.map(x => x.id === t.id ? u : x));
      setNodes(nds => nds.map(n2 => n2.id === u.id ? { ...n2, data: { ...n2.data, term: u } } : n2));
      await api.saveWorldTerm(u as WorldTerm);
    }
  }, [terms, currentProject, setWorldviewGroups, zoneFromPos, setNodes]);

  // ==== onNodesChange wrapper: 自动保存编组位置 ====
  const handleNodesChange = useCallback((changes: any[]) => {
    // 先应用 ReactFlow 的默认变更
    onNodesChange(changes);

    // 检测位置变更并保存编组位置
    if (!currentProject) return;
    const positionChanges = changes.filter((c: any) => c.type === "position" && c.position && !c.dragging);
    if (positionChanges.length === 0) return;

    const gs = loadGroups(currentProject.id);
    let dirty = false;

    for (const change of positionChanges) {
      const g = gs.find(x => x.id === change.id);
      if (g) {
        const newX = change.position.x;
        const newY = change.position.y;
        g.x = newX;
        g.y = newY;
        dirty = true;

        // 用 ReactFlow 实时相对位置反算绝对坐标（不依赖可能已损坏的 DB 旧值）
        const liveNodes: Node[] = rfRef.current?.getNodes() || nodes;
        for (const cid of g.childIds) {
          const childNode = liveNodes.find((n: Node) => n.id === cid);
          if (childNode) {
            const absX = newX + childNode.position.x;
            const absY = newY + childNode.position.y;
            api.saveNodeLayout("world_term", cid, absX, absY).catch(e => console.error("saveNodeLayout failed:", e));
            setTerms(p => p.map(t => t.id === cid ? { ...t, layout_x: absX, layout_y: absY } : t));
          }
        }
      }
    }

    if (dirty) {
      saveGroups(currentProject.id, gs);
      setWorldviewGroups(gs.map(g => ({ id: g.id, name: g.name, x: g.x, y: g.y, locked: g.locked })));
    }
  }, [currentProject, onNodesChange, terms, setTerms, setWorldviewGroups]);

  // ==== connect + infect ====
  const onConnect = useCallback((conn: Connection) => {
    pushH();
    if (!currentProject || !conn.source || !conn.target || conn.source === conn.target) return;
    // 感染逻辑：仅右引线(→左接头) 或 下引线(→上接头) 时传染类型
    let sh = conn.sourceHandle || "right";
    let th = conn.targetHandle || "left";
    const shouldInfect = (sh === "right" && th === "left") || (sh === "bottom" && th === "top");
    if (shouldInfect) {
      const srcT = terms.find(t => t.id === conn.source);
      const tgtT = terms.find(t => t.id === conn.target);
      if (srcT && tgtT && tgtT.term_type !== srcT.term_type) {
        const u = { ...tgtT, term_type: srcT.term_type };
        api.saveWorldTerm(u); setTerms(p => p.map(t => t.id === u.id ? u : t));
        setNodes(nds => nds.map(n => n.id === u.id ? { ...n, data: { ...n.data, term: u } } : n));
      }
    }
    // 推算方向：根据节点位置决定横/纵（仅当用户未指定手柄时）
    const srcNode = nodes.find(n => n.id === conn.source);
    const tgtNode = nodes.find(n => n.id === conn.target);
    // 根据方向选择手柄
    if ((!sh || !th) && srcNode && tgtNode) {
      const dx = Math.abs(tgtNode.position.x - srcNode.position.x);
      const dy = Math.abs(tgtNode.position.y - srcNode.position.y);
      if (dy < dx) {
        if (!sh) sh = "right"; if (!th) th = "left";
      } else {
        if (!sh) sh = "bottom"; if (!th) th = "top";
      }
    }
    hist.current.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)), terms: JSON.parse(JSON.stringify(terms)) });
    if (hist.current.length > 50) hist.current.shift();
    setEdges(eds => {
      const upd = [...eds, {
        id: uuid(),
        source: conn.source, target: conn.target,
        sourceHandle: sh, targetHandle: th,
        type: "step-merge", style: { stroke: "#94a3b8", strokeWidth: 2 },
      }];
      saveEdges(currentProject.id, upd); return upd;
    });
  }, [currentProject, terms, setTerms, setNodes, nodes, setEdges]);

  const onEdgeDbl = useCallback((_: unknown, edge: Edge) => {
    if (!currentProject) return;
    pushHRef.current();
    setEdges(eds => { const u = eds.filter(e => e.id !== edge.id); saveEdges(currentProject.id, u); return u; });
  }, [currentProject, setEdges]);

  // ==== undo ==== （必须在 onConnect/onEdgeDbl 之前定义）
  // 快照同时保存节点/边/词条数据，确保撤销能恢复数据库
  const hist = useRef<{ nodes: Node[]; edges: Edge[]; terms: WorldTerm[] }[]>([]);
  const redoStack = useRef<{ nodes: Node[]; edges: Edge[]; terms: WorldTerm[] }[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const pushH = useCallback(() => {
    hist.current.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)), terms: JSON.parse(JSON.stringify(terms)) });
    if (hist.current.length > 50) hist.current.shift();
    redoStack.current = []; setCanUndo(true); setCanRedo(false);
  }, [nodes, edges, terms]);
  // 同步到 ref 供 handleUpdate 等早期定义使用
  pushHRef.current = pushH;
  const undo = useCallback(() => {
    const s = hist.current.pop();
    if (s) {
      redoStack.current.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)), terms: JSON.parse(JSON.stringify(terms)) });
      setNodes(s.nodes); setEdges(s.edges);
      // 恢复词条数据到 mock-backend
      if (currentProject) {
        for (const t of s.terms) {
          const exists = terms.find(x => x.id === t.id);
          if (!exists) {
            // 被删除的词条 → 重新创建
            api.saveWorldTerm(t).catch(() => { });
          } else if (JSON.stringify(exists) !== JSON.stringify(t)) {
            // 被修改的词条 → 恢复原值
            api.saveWorldTerm(t).catch(() => { });
          }
        }
        // 删除本次快照后不存在的词条（由 redo 新增的）
        for (const t of terms) {
          if (!s.terms.find(x => x.id === t.id)) {
            api.deleteWorldTerm(t.id).catch(() => { });
          }
        }
      }
      setTerms(s.terms);
      setCanUndo(hist.current.length > 0);
      setCanRedo(true);
    }
  }, [setNodes, setEdges, nodes, edges, terms, currentProject]);
  const redo = useCallback(() => {
    const s = redoStack.current.pop();
    if (s) {
      hist.current.push({ nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)), terms: JSON.parse(JSON.stringify(terms)) });
      setNodes(s.nodes); setEdges(s.edges);
      if (currentProject) {
        for (const t of s.terms) {
          const exists = terms.find(x => x.id === t.id);
          if (!exists) {
            api.saveWorldTerm(t).catch(() => { });
          } else if (JSON.stringify(exists) !== JSON.stringify(t)) {
            api.saveWorldTerm(t).catch(() => { });
          }
        }
        for (const t of terms) {
          if (!s.terms.find(x => x.id === t.id)) {
            api.deleteWorldTerm(t.id).catch(() => { });
          }
        }
      }
      setTerms(s.terms);
      setCanUndo(true);
      setCanRedo(redoStack.current.length > 0);
    }
  }, [setNodes, setEdges, nodes, edges, terms, currentProject]);
  const onNodeDragStart = useCallback(() => { pushH(); }, [pushH]);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.ctrlKey && !e.shiftKey && e.key === "z") { e.preventDefault(); undo(); } if ((e.ctrlKey && e.key === "y") || (e.ctrlKey && e.shiftKey && e.key === "z")) { e.preventDefault(); redo(); } }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [undo, redo]);

  // ==== connect + infect ====

  // right-click on any node → if group, show group menu; if term inside group, also show group menu
  const onNodeCtx = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    if (node.type === "group") {
      setGroupCtx({ x: e.clientX, y: e.clientY, gid: node.id, name: (node.data as any)?.label || "编组" });
    } else if (node.type === "worldviewTerm" && node.parentId) {
      const gNode = nodes.find(n => n.id === node.parentId && n.type === "group");
      if (gNode) {
        setGroupCtx({ x: e.clientX, y: e.clientY, gid: gNode.id, name: (gNode.data as any)?.label || "编组" });
      }
    }
  }, [nodes]);

  // Native contextmenu fallback: ReactFlow onNodeContextMenu may not fire with panOnDrag
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => {
    const el = document.querySelector(".worldview-flow") as HTMLElement | null;
    if (!el) return;
    const handler = (e: Event) => {
      const me = e as MouseEvent;
      const target = me.target as HTMLElement;
      const nodeEl = target.closest(".react-flow__node") as HTMLElement | null;
      if (!nodeEl) return;
      const nodeId = nodeEl.getAttribute("data-id");
      if (!nodeId) return;
      const nd = nodesRef.current.find(n => n.id === nodeId);
      if (!nd) return;
      e.preventDefault();
      if (nd.type === "group") {
        setGroupCtx({ x: me.clientX, y: me.clientY, gid: nd.id, name: (nd.data as any)?.label || "编组" });
      } else if (nd.type === "worldviewTerm" && nd.parentId) {
        const gNode = nodesRef.current.find(n => n.id === nd.parentId && n.type === "group");
        if (gNode) {
          setGroupCtx({ x: me.clientX, y: me.clientY, gid: gNode.id, name: (gNode.data as any)?.label || "编组" });
        }
      }
    };
    el.addEventListener("contextmenu", handler as EventListener);
    return () => el.removeEventListener("contextmenu", handler as EventListener);
  }, [setGroupCtx]);

  // rename a group (from context menu or sidebar)
  const doRenameGroup = useCallback((gid: string, newName: string) => {
    if (!currentProject) return;
    const gs = loadGroups(currentProject.id);
    const g = gs.find(x => x.id === gid);
    if (!g) return;
    g.name = newName; saveGroups(currentProject.id, gs);
    setNodes(nds => nds.map(n => n.id === gid ? { ...n, data: { ...n.data, label: newName } } : n));
    setWorldviewGroups(p => p.map(gr => gr.id === gid ? { ...gr, name: newName } : gr));
  }, [currentProject, setNodes, setWorldviewGroups]);
  const [selIds, setSelIds] = useState<string[]>([]);
  // 选中包含 term 和 group 节点，支持框选编组（多重组合）
  const onSel = useCallback(({ nodes: ns }: { nodes: Node[] }) => { setSelIds(ns.map(n => n.id)); }, []);

  // ==== align / distribute ====
  // 编组后的排列以编组框为判定单位（Adobe AI 风格）：
  // 选中编组内词条 → 替换为其所属编组框；选中编组框本身也直接参与
  const resolveEffective = useCallback((ids: string[]) => {
    const groups = nodes.filter(n => n.type === "group");
    const groupChildMap = new Map<string, string>();
    for (const g of groups) {
      for (const n of nodes) { if (n.parentId === g.id) groupChildMap.set(n.id, g.id); }
    }
    const effectiveIds = new Set<string>();
    for (const id of ids) {
      const nd = nodes.find(n => n.id === id);
      if (nd?.type === "group") { effectiveIds.add(id); continue; }
      const gid = groupChildMap.get(id);
      if (gid) effectiveIds.add(gid);
      else effectiveIds.add(id);
    }
    return effectiveIds;
  }, [nodes]);

  const align = useCallback((dir: string) => {
    const effectiveIds = resolveEffective(selIds);
    if (effectiveIds.size < 2) return;
    pushH();
    const sel = nodes.filter(n => effectiveIds.has(n.id));
    const xs = sel.map(n => n.position.x), ys = sel.map(n => n.position.y);
    const targetX = dir === "left" ? Math.min(...xs) : dir === "ch" ? (Math.min(...xs) + Math.max(...xs)) / 2 : dir === "right" ? Math.max(...xs) : undefined;
    const targetY = dir === "top" ? Math.min(...ys) : dir === "cv" ? (Math.min(...ys) + Math.max(...ys)) / 2 : dir === "bottom" ? Math.max(...ys) : undefined;

    setNodes(nds => nds.map(n => {
      if (!effectiveIds.has(n.id)) return n;
      let nx = n.position.x, ny = n.position.y;
      if (targetX !== undefined) nx = targetX;
      if (targetY !== undefined) ny = targetY;
      return { ...n, position: { x: nx, y: ny } };
    }));

    // 保存编组位置到 localStorage，并同步子词条绝对坐标
    if (currentProject) {
      const gs = loadGroups(currentProject.id);
      let dirty = false;
      for (const id of effectiveIds) {
        const g = gs.find(x => x.id === id);
        if (g) {
          const node = nodes.find(n => n.id === id);
          if (node) {
            const dx = (targetX ?? g.x) - g.x;
            const dy = (targetY ?? g.y) - g.y;
            g.x = targetX ?? g.x;
            g.y = targetY ?? g.y;
            dirty = true;
            // ★ 同步子词条绝对坐标，否则下次 load 时相对位置错位
            for (const cid of g.childIds) {
              const ct = terms.find(t => t.id === cid);
              if (ct) {
                const nx = ct.layout_x + dx;
                const ny = ct.layout_y + dy;
                api.saveNodeLayout("world_term", cid, nx, ny).catch(e => console.error("saveNodeLayout failed:", e));
                setTerms(p => p.map(t => t.id === cid ? { ...t, layout_x: nx, layout_y: ny } : t));
              }
            }
          }
        }
      }
      if (dirty) saveGroups(currentProject.id, gs);
    }
  }, [selIds, nodes, setNodes, pushH, resolveEffective, currentProject, terms]);

  const dist = useCallback((d: "h" | "v") => {
    const effectiveIds = resolveEffective(selIds);
    if (effectiveIds.size < 3) return;
    pushH();
    const sel = nodes.filter(n => effectiveIds.has(n.id)).sort((a, b) => d === "h" ? a.position.x - b.position.x : a.position.y - b.position.y);
    const f = sel[0].position, l = sel[sel.length - 1].position;
    const newPositions = new Map<string, { x: number; y: number }>();

    setNodes(nds => nds.map(n => {
      const i = sel.findIndex(s => s.id === n.id);
      if (i < 0 || i === 0 || i === sel.length - 1) return n;
      const t = i / (sel.length - 1);
      let nx = n.position.x, ny = n.position.y;
      if (d === "h") nx = f.x + t * (l.x - f.x);
      else ny = f.y + t * (l.y - f.y);
      newPositions.set(n.id, { x: nx, y: ny });
      return { ...n, position: { x: nx, y: ny } };
    }));

    // 保存编组位置到 localStorage，并同步子词条绝对坐标
    if (currentProject) {
      const gs = loadGroups(currentProject.id);
      let dirty = false;
      for (const id of effectiveIds) {
        const g = gs.find(x => x.id === id);
        if (g) {
          const pos = newPositions.get(id);
          if (pos) {
            const dx = pos.x - g.x;
            const dy = pos.y - g.y;
            g.x = pos.x;
            g.y = pos.y;
            dirty = true;
            // ★ 同步子词条绝对坐标，否则下次 load 时相对位置错位
            for (const cid of g.childIds) {
              const ct = terms.find(t => t.id === cid);
              if (ct) {
                const nx = ct.layout_x + dx;
                const ny = ct.layout_y + dy;
                api.saveNodeLayout("world_term", cid, nx, ny).catch(e => console.error("saveNodeLayout failed:", e));
                setTerms(p => p.map(t => t.id === cid ? { ...t, layout_x: nx, layout_y: ny } : t));
              }
            }
          }
        }
      }
      if (dirty) saveGroups(currentProject.id, gs);
    }
  }, [selIds, nodes, setNodes, pushH, resolveEffective, currentProject, terms]);

  // ==== group =====================================================================
  const toggleLock = useCallback((gid: string) => {
    if (!currentProject) return;
    const gs = loadGroups(currentProject.id);
    const g = gs.find(x => x.id === gid); if (!g) return;
    g.locked = !g.locked; saveGroups(currentProject.id, gs);
    setNodes(nds => nds.map(n => {
      if (n.id === gid) return { ...n, draggable: !g.locked, data: { ...n.data, locked: g.locked } };
      if (n.parentId === gid) return n;
      return n;
    }));
    setWorldviewGroups(p => p.map(gr => gr.id === gid ? { ...gr, locked: g.locked } : gr));
  }, [currentProject, setNodes, setWorldviewGroups]);

  // Ctrl+G → show dialog (支持词条 + 编组的混合选择)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "g") {
        // 筛选出有效的可选择项（词条 + 未锁定的编组）
        const valid = selIds.filter(id => {
          const n = nodes.find(x => x.id === id);
          if (!n) return false;
          if (n.type === "group") return !(n.data as any)?.locked;
          return n.type === "worldviewTerm";
        });
        if (valid.length >= 2) { e.preventDefault(); setPendSel([...valid]); setGName("新编组"); setShowDlg(true); }
      }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [selIds, nodes]);

  const doGroup = useCallback(() => {
    if (pendSel.length < 2 || !currentProject) return;
    pushH();
    const set = new Set(pendSel);
    const sel = nodes.filter(n => set.has(n.id));
    // 识别选中的编组和普通词条
    const selectedGroups = sel.filter(n => n.type === "group");
    const selectedTerms = sel.filter(n => n.type !== "group");
    // 展平：被选中编组内的词条继承到新编组下，原编组框被移除
    const subChildIds = new Set<string>();
    const oldGroupIds = new Set(selectedGroups.map(g => g.id));
    if (selectedGroups.length > 0) {
      const allSaved = loadGroups(currentProject!.id);
      for (const g of selectedGroups) {
        const sg = allSaved.find(x => x.id === g.id);
        if (sg) { for (const cid of sg.childIds) subChildIds.add(cid); }
      }
    }
    // 所有最终子节点 = 直接选中的词条 + 被选中编组内的词条
    const allChildIds = [...new Set([...selectedTerms.map(n => n.id), ...subChildIds])];
    if (allChildIds.length < 2) { setSelIds([]); setShowDlg(false); return; }
    // 计算包围盒（包含词条 + 编组框）
    const xs = sel.map(n => n.position.x);
    const ys = sel.map(n => n.position.y);
    const rs = sel.map(n => n.position.x + (n.measured?.width ?? 360));
    const bs = sel.map(n => n.position.y + (n.measured?.height ?? 240));
    // majority type (from terms only)
    const tc: Record<string, number> = {};
    for (const n of [...selectedTerms, ...nodes.filter(n => subChildIds.has(n.id))]) {
      const tt = (n.data as any)?.term?.term_type ?? "other"; tc[tt] = (tc[tt] || 0) + 1;
    }
    let dt = "other", mc = 0;
    for (const [k, v] of Object.entries(tc)) { if (v > mc) { mc = v; dt = k; } }
    const bd = TC[dt]?.border ?? "#9ca3af";
    const bg = TC[dt]?.bg ?? "#f3f4f6";
    const pH = 60, pV = 100;
    const gx = Math.min(...xs) - pH / 2;
    const gy = Math.min(...ys) - pV / 2;
    const gw = Math.max(...rs) - Math.min(...xs) + pH;
    const gh = Math.max(...bs) - Math.min(...ys) + pV;
    const gid = "group-" + uuid();
    const name = gName.trim() || "新编组";
    // 一次 setNodes：保留未涉及的编组，移除被合并的旧编组，创建新编组
    setNodes(nds => {
      const survivingGroups = nds.filter(n => n.type === "group" && !oldGroupIds.has(n.id));
      const groupNode: any = {
        id: gid, type: "group", position: { x: gx, y: gy }, draggable: true, selectable: true,
        data: { label: name, locked: false, borderColor: bd, bgColor: bg, onToggleLock: () => toggleLock(gid) },
        style: { width: gw, height: gh, backgroundColor: bg + "1a", border: "1.5px solid " + bd, borderRadius: 12 },
      };
      // 所有词条：解除从旧编组的 parentId，挂到新编组
      const childSet = new Set(allChildIds);
      const updatedTerms = nds.filter(n => n.type !== "group").map(n => {
        if (!childSet.has(n.id)) return n;
        // ★ 如果节点已有 parentId（来自被合并的旧编组），先转绝对坐标再算相对新编组
        let absX = n.position.x, absY = n.position.y;
        if (n.parentId) {
          const oldParent = nds.find(x => x.id === n.parentId && x.type === "group");
          if (oldParent) { absX += oldParent.position.x; absY += oldParent.position.y; }
        }
        return { ...n, parentId: gid, extent: "parent", draggable: false, position: { x: absX - gx, y: absY - gy } };
      });
      return [groupNode, ...survivingGroups, ...updatedTerms];
    });
    // 保存：移除旧编组，新增超级编组
    let gs = loadGroups(currentProject.id).filter(g => !oldGroupIds.has(g.id));
    gs.push({ id: gid, name, locked: false, x: gx, y: gy, w: gw, h: gh, bg, border: bd, childIds: allChildIds });
    saveGroups(currentProject.id, gs);
    setWorldviewGroups(p => [...p.filter(gr => !oldGroupIds.has(gr.id)), { id: gid, name, x: gx, y: gy, locked: false }]);
    // 同步所有子节点的绝对坐标到 DB
    // 注意：nodes 中是编组前的旧状态；有 parentId 的节点 position 是相对坐标（需 + 父编组坐标）
    for (const cid of allChildIds) {
      const n = nodes.find(x => x.id === cid);
      if (n) {
        let absX: number, absY: number;
        if (n.parentId) {
          const oldParent = nodes.find(x => x.id === n.parentId);
          absX = (oldParent ? oldParent.position.x : 0) + n.position.x;
          absY = (oldParent ? oldParent.position.y : 0) + n.position.y;
        } else {
          absX = n.position.x;
          absY = n.position.y;
        }
        api.saveNodeLayout("world_term", cid, absX, absY).catch(e => console.error("saveNodeLayout failed:", e));
        setTerms(p => p.map(t => t.id === cid ? { ...t, layout_x: absX, layout_y: absY } : t));
      }
    }
    setSelIds([]); setShowDlg(false);
  }, [pendSel, nodes, gName, currentProject, pushH, setNodes, setWorldviewGroups, toggleLock]);

  // ungroup — specific groups (from context menu) or groups containing selected items (terms + groups)
  const doUngroup = useCallback((targetGroupIds?: string[]) => {
    if (!currentProject) return;
    pushH();
    const allGroups = nodes.filter(n => n.type === "group");
    let targetGids: string[];
    if (targetGroupIds) {
      targetGids = targetGroupIds;
    } else {
      // Collect: groups whose child is selected + groups directly selected
      const direct = selIds.filter(id => allGroups.some(g => g.id === id));
      const byChild = allGroups.filter(g => {
        const gData = loadGroups(currentProject.id).find(x => x.id === g.id);
        return gData && gData.childIds.some(cid => selIds.includes(cid));
      }).map(g => g.id);
      targetGids = [...new Set([...direct, ...byChild])];
    }
    if (targetGids.length === 0) return;
    const gs = allGroups.filter(g => targetGids.includes(g.id));
    const gids = new Set(gs.map(g => g.id));
    setNodes(nds => {
      return nds.map(n => {
        const p = gs.find(g => g.id === n.parentId);
        if (p) {
          const ax = p.position.x + n.position.x;
          const ay = p.position.y + n.position.y;
          api.saveNodeLayout("world_term", n.id, ax, ay).catch(e => console.error("saveNodeLayout failed:", e));
          setTerms(prev => prev.map(t => t.id === n.id ? { ...t, layout_x: ax, layout_y: ay } : t));
          return { ...n, parentId: undefined, extent: undefined, draggable: true, position: { x: ax, y: ay } };
        }
        return n;
      }).filter(n => n.type !== "group" || !gids.has(n.id));
    });
    const all = loadGroups(currentProject.id).filter(g => !gids.has(g.id));
    saveGroups(currentProject.id, all);
    setWorldviewGroups(p => p.filter(g => !gids.has(g.id)));
    setSelIds([]);
  }, [nodes, currentProject, pushH, setNodes, setWorldviewGroups]);

  // ==== nodeTypes ====
  const nts: NodeTypes = useMemo(() => ({ worldviewTerm: WorldviewTermNode as any, group: GroupNode as any }), []);
  const ets: EdgeTypes = useMemo(() => ({ "step-merge": StepMergeEdge as any }), []);

  if (!currentProject) return null;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b bg-white px-4 py-2">
        <div>
          <h1 className="text-lg font-bold">世界观 · 概念图谱</h1>
          <p className="text-xs text-slate-400">双击编辑 · 拖拽连线 · 右键平移 · Ctrl+G 编组</p>
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

      {showDlg && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => setShowDlg(false)}>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()} style={{ minWidth: 300 }}>
            <h3 className="font-semibold text-sm mb-3">命名编组</h3>
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-400" value={gName} onChange={e => setGName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") doGroup(); if (e.key === "Escape") setShowDlg(false); }} autoFocus />
            <div className="mt-3 flex justify-end gap-2">
              <button className="rounded-lg border px-4 py-1.5 text-sm hover:bg-slate-50" onClick={() => setShowDlg(false)}>取消</button>
              <button className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm text-white hover:bg-amber-600" onClick={doGroup}>确定</button>
            </div>
          </div>
        </div>
      )}

      {/* 编组重命名弹窗 */}
      {renameDlg && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => setRenameDlg(null)}>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()} style={{ minWidth: 300 }}>
            <h3 className="font-semibold text-sm mb-3">重命名编组</h3>
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-400" value={renameDlg.name}
              onChange={e => setRenameDlg({ ...renameDlg, name: e.target.value })}
              onKeyDown={e => { if (e.key === "Enter") { doRenameGroup(renameDlg.gid, renameDlg.name); setRenameDlg(null); } if (e.key === "Escape") setRenameDlg(null); }} autoFocus />
            <div className="mt-3 flex justify-end gap-2">
              <button className="rounded-lg border px-4 py-1.5 text-sm hover:bg-slate-50" onClick={() => setRenameDlg(null)}>取消</button>
              <button className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm text-white hover:bg-amber-600" onClick={() => { doRenameGroup(renameDlg.gid, renameDlg.name); setRenameDlg(null); }}>确定</button>
            </div>
          </div>
        </div>
      )}

      {/* 编组框右键菜单 */}
      {groupCtx && (
        <div className="fixed z-50 rounded-lg border bg-white shadow-xl py-1 text-sm" style={{ left: groupCtx.x, top: groupCtx.y }}
          onClick={() => setGroupCtx(null)}>
          <button className="block w-full text-left px-3 py-1.5 hover:bg-slate-50" onClick={() => { setRenameDlg({ gid: groupCtx.gid, name: groupCtx.name }); setGroupCtx(null); }}>✏️ 重命名</button>
          <button className="block w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600" onClick={() => { doUngroup([groupCtx.gid]); setGroupCtx(null); }}>取消编组</button>
        </div>
      )}

      <div className="relative flex-1 overflow-hidden" onClick={() => { setGroupCtx(null); }}>
        {/* 四象限覆盖层（随画布缩放移动），利用父容器 overflow hidden 裁切 */}
        <svg className="pointer-events-none absolute inset-0 z-[5]"
          style={{
            width: "100%", height: "100%", overflow: "visible",
            transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
            transformOrigin: "0 0",
          }}>
          {/* 四个分区背景（画布坐标），跟随勾选状态联动 */}
          <rect x={-50000} y={-50000} width={CX + 50000} height={CY + 50000} fill={worldviewZoneEnabled.core ? "rgba(220,38,38,0.09)" : "rgba(220,38,38,0.02)"} />
          <rect x={CX} y={-50000} width={50000} height={CY + 50000} fill={worldviewZoneEnabled.locked ? "rgba(75,85,99,0.09)" : "rgba(75,85,99,0.02)"} />
          <rect x={-50000} y={CY} width={CX + 50000} height={50000} fill={worldviewZoneEnabled.active ? "rgba(22,163,74,0.09)" : "rgba(22,163,74,0.02)"} />
          <rect x={CX} y={CY} width={50000} height={50000} fill={worldviewZoneEnabled.other ? "rgba(234,88,12,0.09)" : "rgba(234,88,12,0.02)"} />
          {/* 十字线 — 深色高对比度虚线 */}
          <line x1={CX} y1={-50000} x2={CX} y2={50000} stroke="#475569" strokeWidth="2" strokeDasharray="10,6" opacity="0.7" />
          <line x1={-50000} y1={CY} x2={50000} y2={CY} stroke="#475569" strokeWidth="2" strokeDasharray="10,6" opacity="0.7" />
        </svg>

        <ReactFlow
          onInit={(inst: any) => { rfRef.current = inst; const v = inst.getViewport(); setVp(v); }}
          nodes={nodes} edges={edges}
          onNodesChange={handleNodesChange as any} onEdgesChange={onEdgesChange}
          onNodeDrag={(_e: any, node: Node) => {
            // 拖拽中实时更新 zone 预览（不保存到 DB）
            if (node.type === "worldviewTerm") {
              const newZone = zoneFromPos(node.position.x + 50, node.position.y + 24);
              const t = terms.find(x => x.id === node.id);
              if (t && t.zone !== newZone) {
                const u = { ...t, zone: newZone };
                setTerms(p => p.map(x => x.id === t.id ? u : x));
                setNodes(nds => nds.map(n => n.id === u.id ? { ...n, data: { ...n.data, term: u } } : n));
              }
            } else if (node.type === "group" && currentProject) {
              // 编组实时检测：从 localStorage 读取子节点列表
              const allGroups = loadGroups(currentProject.id);
              const gData = allGroups.find(x => x.id === node.id);
              const cids = gData?.childIds || [];
              const gW = gData?.w ?? 400;
              const gH = gData?.h ?? 300;
              const newZone = zoneFromPos(node.position.x + gW / 2, node.position.y + gH / 2);
              if (cids.length > 0) {
                setTerms(p => p.map(t => cids.includes(t.id) ? { ...t, zone: newZone } : t));
                setNodes(nds => nds.map(n => cids.includes(n.id) ? { ...n, data: { ...n.data, term: { ...(n.data?.term || {}), zone: newZone } } } : n));
              }
            }
          }}
          onNodeDragStop={onDragStop} onNodeDragStart={onNodeDragStart} onConnect={onConnect}
          onEdgeDoubleClick={onEdgeDbl} onSelectionChange={onSel}
          onNodeContextMenu={onNodeCtx as any}
          onMove={(_e: any, v: any) => setVp(v)}
          onNodeDoubleClick={(_e: any, node: Node) => {
            if (node.type === "worldviewTerm") {
              const t = (node.data as any)?.term;
              if (t && !t.is_locked) {
                setEditingTermId(node.id);
                setTimeout(() => setEditingTermId(null), 100);
              }
            }
          }}
          nodeTypes={nts} edgeTypes={ets}
          defaultEdgeOptions={{ type: "step-merge", style: { stroke: "#94a3b8", strokeWidth: 2 } }}
          fitView minZoom={0.1} maxZoom={3}
          nodesDraggable elementsSelectable
          selectionMode={"partial" as any} selectionOnDrag
          panOnDrag={[2]} selectNodesOnDrag
          deleteKeyCode="Delete" multiSelectionKeyCode="Shift"
          className="worldview-flow"
        >
          <Background className="!opacity-30" color="#e2e8f0" gap={24} size={1} />
          <Controls className="!shadow-md !rounded-lg !border" />
          <MiniMap className="!shadow-md !rounded-lg !border"
            nodeColor={(n: any) => {
              if (n.type === "group") return "#a78bfa";
              const t = n.data?.term?.term_type;
              const cs: Record<string, string> = { rule: "#3b82f6", faction: "#ec4899", place: "#10b981", item: "#8b5cf6", system: "#f97316", other: "#9ca3af" };
              return t ? cs[t] ?? "#94a3b8" : "#94a3b8";
            }}
            maskColor="rgba(0,0,0,0.08)"
          />
        </ReactFlow>

        {/* 分区勾选工具栏 */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border bg-white/90 px-3 py-2 text-xs shadow-lg backdrop-blur">
          {["core", "locked", "active", "other"].map(zk => {
            const zm = ZONE_META[zk];
            const enabled = worldviewZoneEnabled[zk] ?? true;
            return (
              <div key={zk} className="group relative flex items-center gap-1">
                <button
                  onClick={() => setWorldviewZoneEnabled({ ...worldviewZoneEnabled, [zk]: !enabled })}
                  className="rounded px-2 py-0.5 font-medium transition-colors"
                  style={{
                    backgroundColor: enabled ? zm.color : zm.pale,
                    color: enabled ? "#fff" : zm.color,
                  }}
                >
                  {enabled ? "☑" : "☐"} {zm.label}
                </button>
                {/* 悬浮注释 */}
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[10px] text-white shadow-lg z-50 pointer-events-none">
                  {zm.desc}
                </div>
              </div>
            );
          })}
        </div>

        {selIds.length >= 2 && !showDlg && (
          <div style={{
            position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 50,
            borderRadius: 12, border: "1px solid #e2e8f0", background: "white", padding: "6px 10px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)", display: "flex", alignItems: "center", gap: 4, fontSize: 11,
          }}>
            <span style={{ color: "#94a3b8", marginRight: 2, fontSize: 10 }}>{selIds.length}</span>
            <span style={{ width: 1, height: 14, background: "#e2e8f0" }} />
            <button className="hover:bg-amber-50 rounded px-1 py-0.5" onClick={() => align("left")} title="左对齐" style={{ color: "#475569", border: "none", background: "none", cursor: "pointer" }}>L</button>
            <button className="hover:bg-amber-50 rounded px-1 py-0.5" onClick={() => align("ch")} title="水平居中" style={{ color: "#475569", border: "none", background: "none", cursor: "pointer" }}>CH</button>
            <button className="hover:bg-amber-50 rounded px-1 py-0.5" onClick={() => align("right")} title="右对齐" style={{ color: "#475569", border: "none", background: "none", cursor: "pointer" }}>R</button>
            <span style={{ width: 1, height: 14, background: "#e2e8f0" }} />
            <button className="hover:bg-amber-50 rounded px-1 py-0.5" onClick={() => align("top")} title="顶对齐" style={{ color: "#475569", border: "none", background: "none", cursor: "pointer" }}>T</button>
            <button className="hover:bg-amber-50 rounded px-1 py-0.5" onClick={() => align("cv")} title="垂直居中" style={{ color: "#475569", border: "none", background: "none", cursor: "pointer" }}>CV</button>
            <button className="hover:bg-amber-50 rounded px-1 py-0.5" onClick={() => align("bottom")} title="底对齐" style={{ color: "#475569", border: "none", background: "none", cursor: "pointer" }}>B</button>
            <span style={{ width: 1, height: 14, background: "#e2e8f0" }} />
            <button className="hover:bg-amber-50 rounded px-1.5 py-0.5 font-medium" onClick={() => dist("h")} title="水平等距" style={{ color: "#b45309", border: "none", background: "none", cursor: "pointer" }}>H=</button>
            <button className="hover:bg-amber-50 rounded px-1.5 py-0.5 font-medium" onClick={() => dist("v")} title="垂直等距" style={{ color: "#b45309", border: "none", background: "none", cursor: "pointer" }}>V=</button>
            <span style={{ width: 1, height: 14, background: "#e2e8f0" }} />
            <button className="hover:bg-violet-50 rounded px-1.5 py-0.5 text-violet-700" onClick={() => { setPendSel([...selIds]); setGName("新编组"); setShowDlg(true); }} style={{ border: "none", background: "none", cursor: "pointer" }}>编组</button>
            <button className="hover:bg-violet-50 rounded px-1.5 py-0.5 text-violet-500" onClick={() => doUngroup()} style={{ border: "none", background: "none", cursor: "pointer" }}>解散</button>
            <span style={{ width: 1, height: 14, background: "#e2e8f0" }} />
            <button className="hover:bg-red-50 rounded px-1.5 py-0.5 text-red-600" onClick={() => { const targetIds = selIds.filter(id => nodes.find(x => x.id === id)?.type === "worldviewTerm"); if (targetIds.length === 0) return; confirmDialog(`确定一次性删除选中的 ${targetIds.length} 个词条？此操作不可撤销。`).then(ok => { if (!ok) return; pushH(); const p = currentProject; for (const id of targetIds) { api.deleteWorldTerm(id); setTerms(p2 => p2.filter(t => t.id !== id)); if (p) { const gs = loadGroups(p.id); let dirty = false; for (const g of gs) { const idx = g.childIds.indexOf(id); if (idx >= 0) { g.childIds.splice(idx, 1); dirty = true; } } if (dirty) saveGroups(p.id, gs.filter(g => g.childIds.length > 0)); } } setEdges(eds => { const u = eds.filter(e => !targetIds.includes(e.source) && !targetIds.includes(e.target)); if (p) saveEdges(p.id, u); return u; }); setNodes(nds => nds.filter(n => !targetIds.includes(n.id))); setSelIds([]); }); }} style={{ border: "none", background: "none", cursor: "pointer" }}>X</button>
          </div>
        )}
      </div>
    </div>
  );
}
