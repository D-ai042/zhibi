import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, Background, MiniMap,
  useNodesState, useEdgesState, addEdge,
  type Connection, type Node, type Edge, type NodeTypes, type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import type { Character, RelationshipEdge } from "@/types";
import CharacterNode from "./CharacterNode";
import CustomEdge from "./CustomEdge";
import CharGroupNode from "./CharGroupNode";
import { useUndoRedo } from "./useUndoRedo";
import { uuid } from "@/lib/uuid";

const STORAGE_KEY = "novel-workbench-mock";

// ===== 编组数据（与世界观完全一致，仅样式不同） =====
interface SavedGroup {
  id: string; name: string; locked: boolean;
  x: number; y: number; w: number; h: number;
  bg: string; border: string; childIds: string[];
}
function gk(pid: string) { return "char-groups-" + pid; }
function loadGroups(pid: string): SavedGroup[] {
  try { return JSON.parse(localStorage.getItem(gk(pid)) || "[]"); } catch { return []; }
}
function saveGroups(pid: string, gs: SavedGroup[]) {
  localStorage.setItem(gk(pid), JSON.stringify(gs));
}
const GROUP_COLORS = ["#8b5cf6", "#ec4899", "#f97316", "#10b981", "#3b82f6", "#ef4444", "#14b8a6", "#f59e0b"];

/** 从关系列表构建 ReactFlow 边（不碰节点位置） */
function rebuildEdges(
  rels: RelationshipEdge[],
  setEdges: (updater: (prev: Edge[]) => Edge[]) => void,
  onDelete?: (rels: RelationshipEdge[]) => void,
  onUpdate?: (rels: RelationshipEdge[], newType: string) => void,
) {
  const edgeMap = new Map<string, { rels: RelationshipEdge[] }>();
  for (const e of rels) {
    const key = `${e.source_id}::${e.target_id}`;
    if (!edgeMap.has(key)) edgeMap.set(key, { rels: [] });
    edgeMap.get(key)!.rels.push(e);
  }
  setEdges(() => [...edgeMap.entries()].map(([key, { rels }]) => {
    const e = rels[0];
    const color = e.is_secret ? "#8b5cf6" : e.relation_type === "敌对" ? "#ef4444" : e.relation_type === "爱慕" ? "#ec4899" : e.relation_type === "师徒" ? "#3b82f6" : "#94a3b8";
    const [src, tgt] = key.split("::");
    const label = rels.map(r => r.relation_type).join("·");
    return {
      id: e.id, source: src, target: tgt,
      type: "customEdge",
      animated: rels.some(r => r.is_secret),
      data: { label, color, rels, onDelete, onUpdate },
      style: { stroke: color, strokeWidth: 1.5, strokeDasharray: rels.some(r => r.is_secret) ? "5,5" : undefined },
    };
  }));
}

export function CharactersModule() {
  const { currentProject, setSelectedEntity, characterBump } = useAppStore();
  const rfRef = useRef<any>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [chars, setChars] = useState<Character[]>([]);
  const [selectedChar, setSelectedChar] = useState<Character | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [selIds, setSelIds] = useState<string[]>([]);
  const [showDlg, setShowDlg] = useState(false);
  const [gName, setGName] = useState("");
  const [pendSel, setPendSel] = useState<string[]>([]);
  const [groupCtx, setGroupCtx] = useState<{ x: number; y: number; gid: string; name: string } | null>(null);
  const [renameDlg, setRenameDlg] = useState<{ gid: string; name: string } | null>(null);
  const restoringRef = useRef(false);

  /** 撤回恢复 */
  const handleRestore = useCallback(
    (snapshot: { chars: any[]; rawEdges: any[]; groups: any[] }) => {
      if (!currentProject) return;
      restoringRef.current = true;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          data.characters = snapshot.chars;
          data.edges = snapshot.rawEdges;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }
        saveGroups(currentProject.id, snapshot.groups as any[]);
      } catch { /* ignore */ }
      const store = useAppStore.getState();
      store.bumpCharacters();
    },
    [currentProject]
  );

  const { pushSnapshot, canUndo, canRedo, undo, redo } = useUndoRedo(currentProject?.id, handleRestore);

  // ===== 基础回调 =====
  const handleUpdate = useCallback(async (c: Character) => {
    await api.saveCharacter(c);
    const store = useAppStore.getState(); store.bumpCharacters();
  }, []);
  const handleSelect = useCallback((c: Character) => {
    setSelectedEntity({ type: "character", id: c.id, name: c.name });
    setSelectedChar(c);
  }, [setSelectedEntity]);
  const handleDelete = useCallback(async (id: string) => {
    pushSnapshot();
    await api.deleteCharacter(id);
    const store = useAppStore.getState(); store.bumpCharacters();
  }, [pushSnapshot]);

  // 用 ref 打破 handleEdgeDelete / handleEdgeUpdate 相互引用
  const edgeDeleteRef = useRef<(rels: RelationshipEdge[]) => void>(async () => { });
  const edgeUpdateRef = useRef<(rels: RelationshipEdge[], newType: string) => void>(async () => { });
  edgeDeleteRef.current = useCallback(async (rels: RelationshipEdge[]) => {
    pushSnapshot();
    for (const r of rels) await api.deleteRelationshipEdge(r.id);
    if (!currentProject) return;
    const fresh = await api.listRelationshipEdges(currentProject.id);
    rebuildEdges(fresh, setEdges, edgeDeleteRef.current, edgeUpdateRef.current);
  }, [pushSnapshot, currentProject, setEdges]);
  edgeUpdateRef.current = useCallback(async (rels: RelationshipEdge[], newType: string) => {
    pushSnapshot();
    for (const r of rels) await api.saveRelationshipEdge({ ...r, relation_type: newType });
    if (!currentProject) return;
    const fresh = await api.listRelationshipEdges(currentProject.id);
    rebuildEdges(fresh, setEdges, edgeDeleteRef.current, edgeUpdateRef.current);
  }, [pushSnapshot, currentProject, setEdges]);
  const handleEdgeDelete = edgeDeleteRef.current;
  const handleEdgeUpdate = edgeUpdateRef.current;

  // ===== 编辑字段辅助 =====
  const startEdit = useCallback((key: string, value: string) => {
    setEditingField(key);
    setEditDraft(value || "");
  }, []);
  const commitField = useCallback((key: string) => {
    if (!selectedChar || !currentProject) return;
    const updated = { ...selectedChar, [key]: editDraft };
    setSelectedChar(updated);
    setEditingField(null);
    api.saveCharacter(updated as Character);
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const idx = raw.characters?.findIndex((c: any) => c.id === selectedChar.id);
    if (idx >= 0) { raw.characters[idx] = updated; localStorage.setItem(STORAGE_KEY, JSON.stringify(raw)); }
    const store = useAppStore.getState(); store.bumpCharacters();
  }, [selectedChar, currentProject, editDraft]);

  // ===== 加载 =====
  const circleLayout = useCallback((characters: Character[]) => {
    const n = characters.length;
    if (n === 0) return [];
    const cx = 400, cy = 300, r = Math.max(200, n * 40);
    return characters.map((_, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      return { x: cx + r * Math.cos(angle) - 50, y: cy + r * Math.sin(angle) - 50 };
    });
  }, []);

  const load = useCallback(async () => {
    if (!currentProject) return;
    const [loadedChars, rels] = await Promise.all([
      api.listCharacters(currentProject.id),
      api.listRelationshipEdges(currentProject.id),
    ]);
    setChars(loadedChars);
    const hasCustom = loadedChars.some(c => c.layout_x > 0 || c.layout_y > 0);
    let pos: { x: number; y: number }[];
    if (hasCustom) {
      pos = loadedChars.map(c => ({ x: c.layout_x, y: c.layout_y }));
      // 检测堆叠在 (0,0) 的新角色，自动分配位置
      const zeroIdx = loadedChars
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.layout_x === 0 && c.layout_y === 0)
        .map(({ i }) => i);
      if (zeroIdx.length > 0) {
        // 已有位置的角色包围盒
        const positioned = pos.filter((_, i) => !zeroIdx.includes(i));
        let cx = 400, cy = 300, cr = 250;
        if (positioned.length > 0) {
          const xs = positioned.map(p => p.x), ys = positioned.map(p => p.y);
          cx = (Math.min(...xs) + Math.max(...xs)) / 2;
          cy = (Math.min(...ys) + Math.max(...ys)) / 2;
          cr = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 150;
        }
        // 建立 角色ID→位置 映射
        const posMap = new Map(loadedChars.map((c, i) => [c.id, pos[i]]));
        const unplacedIndices: number[] = [];
        for (const idx of zeroIdx) {
          const c = loadedChars[idx];
          // 检查是否有关系连到已定位的角色
          const related = rels.filter(e => e.source_id === c.id || e.target_id === c.id);
          const relatedPositions: { x: number; y: number }[] = [];
          for (const e of related) {
            const otherId = e.source_id === c.id ? e.target_id : e.source_id;
            const p = posMap.get(otherId);
            if (p && (p.x !== 0 || p.y !== 0)) relatedPositions.push(p);
          }
          if (relatedPositions.length > 0) {
            // 出现在关联角色附近（偏移一定角度）
            const avgX = relatedPositions.reduce((s, p) => s + p.x, 0) / relatedPositions.length;
            const avgY = relatedPositions.reduce((s, p) => s + p.y, 0) / relatedPositions.length;
            const angle = Math.random() * 2 * Math.PI;
            const dist = 120 + Math.random() * 40;
            pos[idx] = { x: avgX + dist * Math.cos(angle) - 50, y: avgY + dist * Math.sin(angle) - 50 };
          } else {
            unplacedIndices.push(idx);
          }
        }
        // 无关联的新角色，围绕现有集群圆周分布
        for (let j = 0; j < unplacedIndices.length; j++) {
          const angle = (2 * Math.PI * j) / unplacedIndices.length - Math.PI / 2;
          const dist = cr + 60;
          pos[unplacedIndices[j]] = { x: cx + dist * Math.cos(angle) - 50, y: cy + dist * Math.sin(angle) - 50 };
        }
      }
      // 持久化新分配的位置，防止切换页面后重新随机
      for (const idx of zeroIdx) {
        const c = loadedChars[idx];
        api.saveNodeLayout("character", c.id, pos[idx].x, pos[idx].y).catch(() => { });
      }
    } else {
      pos = circleLayout(loadedChars);
    }

    // 角色节点
    const charNodes: Node[] = loadedChars.map((c, i) => ({
      id: c.id, position: pos[i] ?? { x: 100 + i * 80, y: 100 },
      data: { character: c, onUpdate: handleUpdate, onSelect: handleSelect, onDelete: handleDelete },
      type: "characterNode",
    }));

    // 编组节点（ReactFlow 内置 group type，子节点通过 parentId 挂载）
    const saved = loadGroups(currentProject.id);
    const gNodes: Node[] = [];
    for (const g of saved) {
      for (const cn of charNodes) {
        if (g.childIds.includes(cn.id)) {
          // 子节点转相对坐标
          cn.position = { x: cn.position.x - g.x, y: cn.position.y - g.y };
          cn.parentId = g.id;
          cn.extent = "parent";
          cn.draggable = false;
        }
      }
      // 清理无子项的编组
      if (g.childIds.some(id => loadedChars.some(c => c.id === id))) {
        gNodes.push({
          id: g.id, type: "group", position: { x: g.x, y: g.y }, draggable: !g.locked, selectable: true,
          data: {
            label: g.name, locked: g.locked, childIds: g.childIds,
            borderColor: g.border, bgColor: g.bg,
            onToggleLock: () => toggleLock(g.id),
            onRename: (name: string) => doRenameGroup(g.id, name),
            onDelete: () => doUngroup([g.id]),
          },
          style: { width: g.w, height: g.h, borderRadius: "50%", border: "2px dashed " + g.border, background: g.border + "12" },
        } as any);
      }
    }
    setNodes([...gNodes, ...charNodes]);

    // 关系边
    const edgeMap = new Map<string, { rels: RelationshipEdge[] }>();
    for (const e of rels) {
      const key = `${e.source_id}::${e.target_id}`;
      if (!edgeMap.has(key)) edgeMap.set(key, { rels: [] });
      edgeMap.get(key)!.rels.push(e);
    }
    setEdges([...edgeMap.entries()].map(([key, { rels }]) => {
      const e = rels[0];
      const color = e.is_secret ? "#8b5cf6" : e.relation_type === "敌对" ? "#ef4444" : e.relation_type === "爱慕" ? "#ec4899" : e.relation_type === "师徒" ? "#3b82f6" : "#94a3b8";
      const [src, tgt] = key.split("::");
      const label = rels.map(r => r.relation_type).join("·");
      return {
        id: e.id, source: src, target: tgt,
        type: "customEdge",
        animated: rels.some(r => r.is_secret),
        data: { label, color, rels, onDelete: handleEdgeDelete, onUpdate: handleEdgeUpdate },
        style: { stroke: color, strokeWidth: 1.5, strokeDasharray: rels.some(r => r.is_secret) ? "5,5" : undefined },
      };
    }));
  }, [currentProject, setNodes, setEdges, circleLayout, handleUpdate, handleSelect, handleDelete]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (characterBump > 0) load(); }, [characterBump]);

  // ===== 选中 =====
  const onSel = useCallback(({ nodes: ns }: { nodes: Node[] }) => { setSelIds(ns.map(n => n.id)); }, []);

  // ===== 编组操作 =====
  const toggleLock = useCallback((gid: string) => {
    if (!currentProject) return;
    pushSnapshot();
    const gs = loadGroups(currentProject.id);
    const g = gs.find(x => x.id === gid); if (!g) return;
    g.locked = !g.locked; saveGroups(currentProject.id, gs);
    setNodes(nds => nds.map(n => {
      if (n.id === gid) return { ...n, draggable: !g.locked, data: { ...n.data, locked: g.locked } };
      return n;
    }));
  }, [currentProject, setNodes, pushSnapshot]);

  const doRenameGroup = useCallback((gid: string, newName: string) => {
    if (!currentProject) return;
    pushSnapshot();
    const gs = loadGroups(currentProject.id);
    const g = gs.find(x => x.id === gid); if (!g) return;
    g.name = newName; saveGroups(currentProject.id, gs);
    const store = useAppStore.getState();
    store.bumpCharacters();
  }, [currentProject, pushSnapshot]);

  // Ctrl+G
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "g") {
        const valid = selIds.filter(id => {
          const n = nodes.find(x => x.id === id);
          if (!n) return false;
          if (n.type === "group") return !(n.data as any)?.locked;
          return n.type === "characterNode";
        });
        if (valid.length >= 2) { e.preventDefault(); setPendSel([...valid]); setGName(""); setShowDlg(true); }
      }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [selIds, nodes]);

  // Backspace 删除选中角色
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Backspace" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        const toDelete = selIds.filter(id => nodes.find(n => n.id === id)?.type === "characterNode");
        if (toDelete.length > 0 && window.confirm(`确定删除选中的 ${toDelete.length} 个角色？`)) {
          toDelete.forEach(id => handleDelete(id));
          setSelIds([]);
        }
      }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [selIds, nodes, handleDelete]);

  // 创建编组（支持超级编组 = 编组 + 角色混合选择）
  const doGroup = useCallback(() => {
    if (pendSel.length < 2 || !currentProject) return;
    pushSnapshot();
    const set = new Set(pendSel);
    const sel = nodes.filter(n => set.has(n.id));
    const selectedGroups = sel.filter(n => n.type === "group");
    const selectedChars = sel.filter(n => n.type !== "group");

    // 展平：被选中编组内的角色继承到新编组
    const subChildIds = new Set<string>();
    const oldGroupIds = new Set(selectedGroups.map(g => g.id));
    if (selectedGroups.length > 0) {
      const allSaved = loadGroups(currentProject!.id);
      for (const g of selectedGroups) {
        const sg = allSaved.find(x => x.id === g.id);
        if (sg) { for (const cid of sg.childIds) subChildIds.add(cid); }
      }
    }
    const allChildIds = [...new Set([...selectedChars.map(n => n.id), ...subChildIds])];
    if (allChildIds.length < 2) { setSelIds([]); setShowDlg(false); return; }

    // 包围盒 → 圆形编组需要用对角线算直径，确保所有子节点被包住
    const xs = sel.map(n => n.position.x);
    const ys = sel.map(n => n.position.y);
    const rs = sel.map(n => n.position.x + ((n.style as any)?.width || 100));
    const bs = sel.map(n => n.position.y + ((n.style as any)?.height || 100));
    const bboxW = Math.max(...rs) - Math.min(...xs);
    const bboxH = Math.max(...bs) - Math.min(...ys);
    const pad = 80;
    const diameter = Math.sqrt(bboxW * bboxW + bboxH * bboxH) + pad;
    const gx = Math.min(...xs) - (diameter - bboxW) / 2;
    const gy = Math.min(...ys) - (diameter - bboxH) / 2;
    const gid = "cgroup-" + uuid();
    const name = gName.trim() || "新势力";

    // 选一个颜色
    const ci = Math.round(Math.random() * (GROUP_COLORS.length - 1));
    const bd = GROUP_COLORS[ci];

    setNodes(nds => {
      const surviving = nds.filter(n => n.type === "group" && !oldGroupIds.has(n.id));
      const groupNode: any = {
        id: gid, type: "group", position: { x: gx, y: gy }, draggable: true, selectable: true,
        data: { label: name, locked: false, childIds: allChildIds, borderColor: bd, bgColor: bd, onToggleLock: () => toggleLock(gid), onRename: (n: string) => doRenameGroup(gid, n), onDelete: () => doUngroup([gid]) },
        style: { width: diameter, height: diameter, borderRadius: "50%", border: "2px dashed " + bd, background: bd + "12" },
      };
      const childSet = new Set(allChildIds);
      const updated = nds.filter(n => n.type !== "group").map(n => {
        if (!childSet.has(n.id)) return n;
        return { ...n, parentId: gid, extent: "parent" as any, draggable: false, position: { x: n.position.x - gx, y: n.position.y - gy } };
      });
      return [groupNode, ...surviving, ...updated];
    });

    let gs = loadGroups(currentProject.id).filter(g => !oldGroupIds.has(g.id));
    gs.push({ id: gid, name, locked: false, x: gx, y: gy, w: diameter, h: diameter, bg: bd, border: bd, childIds: allChildIds });
    saveGroups(currentProject.id, gs);
    setSelIds([]); setShowDlg(false);
  }, [pendSel, nodes, gName, currentProject, pushSnapshot, setNodes]);

  // 取消编组
  const doUngroup = useCallback((targetGroupIds?: string[]) => {
    if (!currentProject) return;
    pushSnapshot();
    let targetGids: string[];
    if (targetGroupIds) {
      targetGids = targetGroupIds;
    } else {
      const direct = selIds.filter(id => nodes.some(g => g.id === id && g.type === "group"));
      const byChild = nodes.filter(g => g.type === "group").filter(g => {
        const gd = loadGroups(currentProject.id).find(x => x.id === g.id);
        return gd && gd.childIds.some(cid => selIds.includes(cid));
      }).map(g => g.id);
      targetGids = [...new Set([...direct, ...byChild])];
    }
    if (targetGids.length === 0) return;
    const gs = nodes.filter(g => targetGids.includes(g.id) && g.type === "group");
    const gids = new Set(gs.map(g => g.id));

    setNodes(nds => {
      return nds.map(n => {
        const p = gs.find(g => g.id === n.parentId);
        if (p) {
          api.saveNodeLayout("character", n.id, p.position.x + n.position.x, p.position.y + n.position.y).catch(e => console.error("saveNodeLayout failed:", e));
          return { ...n, parentId: undefined, extent: undefined, draggable: true, position: { x: p.position.x + n.position.x, y: p.position.y + n.position.y } };
        }
        return n;
      }).filter(n => n.type !== "group" || !gids.has(n.id));
    });
    const all = loadGroups(currentProject.id).filter(g => !gids.has(g.id));
    saveGroups(currentProject.id, all);
    setSelIds([]);
  }, [nodes, currentProject, pushSnapshot, setNodes]);

  // 右键菜单
  const onNodeCtx = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    if (node.type === "group") {
      setGroupCtx({ x: e.clientX, y: e.clientY, gid: node.id, name: (node.data as any)?.label || "" });
    } else if (node.type === "characterNode" && node.parentId) {
      const gn = nodes.find(n => n.id === node.parentId && n.type === "group");
      if (gn) setGroupCtx({ x: e.clientX, y: e.clientY, gid: gn.id, name: (gn.data as any)?.label || "" });
    }
  }, [nodes]);

  // ===== 拖拽 =====
  const onDragStop = useCallback(async (_: unknown, node: Node) => {
    if (node.type === "group" && currentProject) {
      const gs = loadGroups(currentProject.id);
      const g = gs.find(x => x.id === node.id);
      if (g) {
        const dx = node.position.x - g.x;
        const dy = node.position.y - g.y;
        g.x = node.position.x; g.y = node.position.y; saveGroups(currentProject.id, gs);
        for (const cid of g.childIds) {
          const c = chars.find(x => x.id === cid);
          if (c) {
            const nx = c.layout_x + dx;
            const ny = c.layout_y + dy;
            api.saveNodeLayout("character", cid, nx, ny).catch(e => console.error("saveNodeLayout failed:", e));
          }
        }
      }
      return;
    }
    if (node.type === "characterNode") {
      await api.saveNodeLayout("character", node.id, node.position.x, node.position.y);
    }
  }, [currentProject, chars]);

  // ===== 连线 =====
  const onConnect = useCallback(async (conn: Connection) => {
    pushSnapshot();
    if (!currentProject || !conn.source || !conn.target) return;
    const edge: RelationshipEdge = {
      id: uuid(), project_id: currentProject.id,
      source_id: conn.source, target_id: conn.target,
      relation_type: "关系", strength: 5, is_secret: false,
    };
    await api.saveRelationshipEdge(edge);
    setEdges(eds => addEdge({
      ...conn, type: "customEdge",
      data: { label: "关系", color: "#94a3b8", rels: [edge], onDelete: handleEdgeDelete, onUpdate: handleEdgeUpdate },
      style: { stroke: "#94a3b8", strokeWidth: 2 },
    }, eds));
  }, [currentProject, setEdges, handleEdgeDelete, handleEdgeUpdate]);

  // 双击线段删除关系
  const onEdgeDbl = useCallback((_: unknown, edge: Edge) => {
    const rels = (edge.data as any)?.rels as RelationshipEdge[] | undefined;
    if (rels) handleEdgeDelete(rels);
  }, [handleEdgeDelete]);

  // ===== 对齐 / 分布 =====
  const resolveEffective = useCallback((ids: string[]) => {
    const groupChildMap = new Map<string, string>();
    for (const n of nodes) { if (n.type === "group") { for (const cn of nodes) { if (cn.parentId === n.id) groupChildMap.set(cn.id, n.id); } } }
    const effective = new Set<string>();
    for (const id of ids) {
      const nd = nodes.find(n => n.id === id);
      if (nd?.type === "group") { effective.add(id); continue; }
      const gid = groupChildMap.get(id);
      if (gid) effective.add(gid); else effective.add(id);
    }
    return effective;
  }, [nodes]);
  const align = useCallback((dir: string) => {
    const eff = resolveEffective(selIds);
    if (eff.size < 2) return;
    pushSnapshot();
    const sel = nodes.filter(n => eff.has(n.id));
    const xs = sel.map(n => n.position.x), ys = sel.map(n => n.position.y);
    setNodes(nds => nds.map(n => {
      if (!eff.has(n.id)) return n;
      let nx = n.position.x, ny = n.position.y;
      if (dir === "left") nx = Math.min(...xs);
      else if (dir === "ch") nx = (Math.min(...xs) + Math.max(...xs)) / 2;
      else if (dir === "right") nx = Math.max(...xs);
      if (dir === "top") ny = Math.min(...ys);
      else if (dir === "cv") ny = (Math.min(...ys) + Math.max(...ys)) / 2;
      else if (dir === "bottom") ny = Math.max(...ys);
      return { ...n, position: { x: nx, y: ny } };
    }));
  }, [selIds, nodes, setNodes, pushSnapshot, resolveEffective]);
  const dist = useCallback((d: "h" | "v") => {
    const eff = resolveEffective(selIds);
    if (eff.size < 3) return;
    pushSnapshot();
    const sel = nodes.filter(n => eff.has(n.id)).sort((a, b) => d === "h" ? a.position.x - b.position.x : a.position.y - b.position.y);
    const f = sel[0].position, l = sel[sel.length - 1].position;
    setNodes(nds => nds.map(n => {
      const i = sel.findIndex(s => s.id === n.id);
      if (i < 0 || i === 0 || i === sel.length - 1) return n;
      const t = i / (sel.length - 1);
      let nx = n.position.x, ny = n.position.y;
      if (d === "h") nx = f.x + t * (l.x - f.x); else ny = f.y + t * (l.y - f.y);
      return { ...n, position: { x: nx, y: ny } };
    }));
  }, [selIds, nodes, setNodes, pushSnapshot, resolveEffective]);

  // ===== nodeTypes =====
  const nts: NodeTypes = useMemo(() => ({ characterNode: CharacterNode as any, group: CharGroupNode as any }), []);
  const ets: EdgeTypes = useMemo(() => ({ customEdge: CustomEdge }), []);

  const btnStyle: React.CSSProperties = {
    width: 28, height: 28,
    display: "flex", alignItems: "center", justifyContent: "center",
    border: "none", background: "none", cursor: "pointer",
    borderRadius: 6, fontSize: 16, color: "#64748b", lineHeight: 1,
  };

  if (!currentProject) return null;

  return (
    <div className="flex h-full w-full flex-col" onClick={() => setGroupCtx(null)}>
      <div className="flex shrink-0 items-center justify-between border-b bg-white px-4 py-2">
        <div>
          <h1 className="text-lg font-bold">人物关系星图</h1>
          <p className="text-xs text-slate-400">双击修改名称 · 拖拽连线建关系 · Ctrl+G 建圆形编组</p>
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

      {/* 命名弹窗 */}
      {showDlg && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => setShowDlg(false)}>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()} style={{ minWidth: 300 }}>
            <h3 className="mb-3 text-sm font-semibold">为 {pendSel.length} 个角色创建圆形编组</h3>
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-400"
              value={gName} onChange={e => setGName(e.target.value)}
              placeholder="编组名称…" autoFocus
              onKeyDown={e => { if (e.key === "Enter" && gName.trim()) doGroup(); if (e.key === "Escape") setShowDlg(false); }} />
            <div className="mt-3 flex justify-end gap-2">
              <button className="rounded-lg border px-4 py-1.5 text-sm hover:bg-slate-50" onClick={() => setShowDlg(false)}>取消</button>
              <button className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm text-white hover:bg-amber-600" onClick={doGroup}>创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 重命名弹窗 */}
      {renameDlg && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => setRenameDlg(null)}>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()} style={{ minWidth: 300 }}>
            <h3 className="mb-3 text-sm font-semibold">重命名编组</h3>
            <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-400"
              value={renameDlg.name} onChange={e => setRenameDlg({ ...renameDlg, name: e.target.value })}
              autoFocus
              onKeyDown={e => { if (e.key === "Enter" && renameDlg.name.trim()) { doRenameGroup(renameDlg.gid, renameDlg.name.trim()); setRenameDlg(null); } if (e.key === "Escape") setRenameDlg(null); }} />
            <div className="mt-3 flex justify-end gap-2">
              <button className="rounded-lg border px-4 py-1.5 text-sm hover:bg-slate-50" onClick={() => setRenameDlg(null)}>取消</button>
              <button className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm text-white hover:bg-amber-600" onClick={() => { if (renameDlg.name.trim()) doRenameGroup(renameDlg.gid, renameDlg.name.trim()); setRenameDlg(null); }}>确定</button>
            </div>
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {groupCtx && (
        <div className="fixed z-50 rounded-lg border bg-white py-1 text-sm shadow-xl" style={{ left: groupCtx.x, top: groupCtx.y }}>
          <button className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => {
            setRenameDlg({ gid: groupCtx.gid, name: groupCtx.name });
            setGroupCtx(null);
          }}>✏️ 重命名</button>
          <button className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50" onClick={() => { doUngroup([groupCtx.gid]); setGroupCtx(null); }}>取消编组</button>
        </div>
      )}

      <div className="relative flex-1">
        {/* 关系颜色图例 */}
        <div style={{
          position: "absolute", top: 10, left: 10, zIndex: 40,
          display: "flex", alignItems: "center", gap: 12,
          borderRadius: 8, background: "rgba(255,255,255,0.85)", border: "1px solid #e2e8f0",
          padding: "4px 10px", fontSize: 11,
        }}>
          {[
            { label: "敌对", color: "#ef4444" },
            { label: "爱慕", color: "#ec4899" },
            { label: "师徒", color: "#3b82f6" },
            { label: "其他", color: "#94a3b8" },
            { label: "秘密", color: "#8b5cf6", dashed: true },
          ].map(item => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {item.dashed ? (
                <div style={{ width: 16, height: 0, borderTop: "2px dashed " + item.color }} />
              ) : (
                <div style={{ width: 16, height: 2, background: item.color, borderRadius: 1 }} />
              )}
              <span style={{ color: "#475569" }}>{item.label}</span>
            </div>
          ))}
        </div>

        <style>{`.char-card::-webkit-scrollbar{display:none}`}</style>
        {/* 左侧人物卡 - 可滚动 */}
        {selectedChar && (
          <div className="char-card" style={{
            position: "absolute", top: 10, bottom: 56, left: 10, zIndex: 40,
            width: 340,
            borderRadius: 12, fontSize: 13,
            background: "#fff",
            boxShadow: "0 8px 32px rgba(99,102,241,0.12)",
            padding: 0,
            overflowY: "auto",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            border: "1px solid #e0dcf0",
          }}>
            {/* 标题行 */}
            <div style={{
              textAlign: "center", padding: "10px 0 8px",
              background: "linear-gradient(90deg, #6366f1, #8b5cf6, #a78bfa)",
              color: "#fff", fontSize: 15, fontWeight: 700, letterSpacing: "0.06em",
            }}>
              ✦ {selectedChar.name} ✦
            </div>

            {/* 基本信息行：左列→姓名/性别/年龄/种族，右列→外在形象 */}
            <div style={{ display: "flex", gap: 16, padding: "12px 14px 10px" }}>
              <div style={{ flex: 1, fontSize: 12 }}>
                {[
                  { label: "姓名", key: "name", value: selectedChar.name },
                  { label: "性别", key: "gender", value: selectedChar.gender },
                  { label: "年龄", key: "age", value: selectedChar.age },
                  { label: "种族", key: "race", value: selectedChar.race },
                ].map(item => (
                  <div key={item.key} style={{ display: "flex", marginBottom: 4 }}>
                    <span style={{ color: "#6366f1", fontWeight: 600, width: 40, flexShrink: 0 }}>{item.label}</span>
                    {editingField === item.key ? (
                      <input autoFocus value={editDraft} onChange={e => setEditDraft(e.target.value)}
                        onBlur={() => { commitField(item.key); }}
                        onKeyDown={e => { if (e.key === "Enter") commitField(item.key); if (e.key === "Escape") setEditingField(null); }}
                        style={{ border: "1px solid #6366f1", borderRadius: 4, padding: "0 4px", fontSize: 12, width: 80, outline: "none" }}
                      />
                    ) : (
                      <span style={{ color: "#374151", cursor: "pointer" }} onClick={() => startEdit(item.key, item.value)}>{item.value || "—"}</span>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#6366f1", fontWeight: 600, fontSize: 12, marginBottom: 3 }}>外在形象</div>
                {editingField === "appearance" ? (
                  <textarea autoFocus value={editDraft} onChange={e => setEditDraft(e.target.value)}
                    onBlur={() => commitField("appearance")}
                    onKeyDown={e => { if (e.key === "Escape") setEditingField(null); }}
                    style={{ border: "1px solid #6366f1", borderRadius: 4, padding: 2, fontSize: 11, width: "100%", minHeight: 50, outline: "none", resize: "vertical" }}
                  />
                ) : (
                  <div style={{ color: "#475569", lineHeight: 1.6, fontSize: 11.5, cursor: "pointer" }} onClick={() => startEdit("appearance", selectedChar.appearance)}>
                    {selectedChar.appearance || "—"}
                  </div>
                )}
              </div>
            </div>

            {/* 内在性格 + 背景经历 双栏 - 带边框 */}
            <div style={{ borderTop: "1px solid #f1edf8", margin: "0 14px" }} />
            <div style={{ display: "flex", gap: 14, padding: "8px 14px" }}>
              {[
                { label: "内在性格", key: "personality", icon: "•" },
                { label: "背景经历", key: "background", icon: "•" },
              ].map(section => (
                <div key={section.key} style={{ flex: 1, border: "1px solid #ede9fe", borderRadius: 8, padding: "6px 8px", cursor: "pointer" }} onClick={() => startEdit(section.key, selectedChar[section.key])}>
                  <div style={{ color: "#6366f1", fontWeight: 700, fontSize: 11.5, marginBottom: 3 }}>【{section.label}】</div>
                  {editingField === section.key ? (
                    <textarea autoFocus value={editDraft} onChange={e => setEditDraft(e.target.value)}
                      onBlur={() => commitField(section.key)}
                      onKeyDown={e => { if (e.key === "Escape") setEditingField(null); }}
                      style={{ border: "1px solid #6366f1", borderRadius: 4, padding: 2, fontSize: 11, width: "100%", minHeight: 60, outline: "none", resize: "vertical" }}
                    />
                  ) : (
                    <div style={{ color: "#475569", fontSize: 11, lineHeight: 1.6 }}>
                      {selectedChar[section.key] ? selectedChar[section.key].split("，").map((item, i) => (
                        <div key={i}>{section.icon} {item}</div>
                      )) : <div style={{ color: "#94a3b8" }}>暂缺</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 能力 + 行事风格 双栏 - 带边框 */}
            <div style={{ borderTop: "1px solid #f1edf8", margin: "0 14px" }} />
            <div style={{ display: "flex", gap: 14, padding: "8px 14px" }}>
              {[
                { label: "能力", key: "ability", icon: "✦" },
                { label: "行事风格", key: "style", icon: "•" },
              ].map(section => (
                <div key={section.key} style={{ flex: 1, border: "1px solid #ede9fe", borderRadius: 8, padding: "6px 8px", cursor: "pointer" }} onClick={() => startEdit(section.key, selectedChar[section.key])}>
                  <div style={{ color: "#6366f1", fontWeight: 700, fontSize: 11.5, marginBottom: 3 }}>【{section.label}】</div>
                  {editingField === section.key ? (
                    <textarea autoFocus value={editDraft} onChange={e => setEditDraft(e.target.value)}
                      onBlur={() => commitField(section.key)}
                      onKeyDown={e => { if (e.key === "Escape") setEditingField(null); }}
                      style={{ border: "1px solid #6366f1", borderRadius: 4, padding: 2, fontSize: 11, width: "100%", minHeight: 60, outline: "none", resize: "vertical" }}
                    />
                  ) : (
                    <div style={{ color: "#475569", fontSize: 11, lineHeight: 1.6 }}>
                      {selectedChar[section.key] ? selectedChar[section.key].split("，").map((item, i) => (
                        <div key={i}>{section.icon} {item}</div>
                      )) : <div style={{ color: "#94a3b8" }}>暂缺</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 兴趣爱好 - 带边框 */}
            <div style={{ borderTop: "1px solid #f1edf8", margin: "0 14px" }} />
            <div style={{ padding: "8px 14px 12px" }}>
              <div style={{ border: "1px solid #ede9fe", borderRadius: 8, padding: "6px 8px", cursor: "pointer" }} onClick={() => startEdit("interests", selectedChar.interests)}>
                <div style={{ color: "#6366f1", fontWeight: 700, fontSize: 11.5, marginBottom: 4, textAlign: "center" }}>【兴趣爱好】</div>
                {editingField === "interests" ? (
                  <textarea autoFocus value={editDraft} onChange={e => setEditDraft(e.target.value)}
                    onBlur={() => commitField("interests")}
                    onKeyDown={e => { if (e.key === "Escape") setEditingField(null); }}
                    style={{ border: "1px solid #6366f1", borderRadius: 4, padding: 2, fontSize: 11, width: "100%", minHeight: 60, outline: "none", resize: "vertical" }}
                  />
                ) : (
                  <div style={{ color: "#475569", fontSize: 11, lineHeight: 1.6 }}>
                    {selectedChar.interests ? selectedChar.interests.split("，").map((item, i) => (
                      <div key={i}>• {item}</div>
                    )) : <div style={{ color: "#94a3b8", textAlign: "center" }}>暂缺</div>}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <ReactFlow
          onInit={(inst: any) => { rfRef.current = inst; }}
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange as any} onEdgesChange={onEdgesChange}
          onNodeDragStop={onDragStop} onConnect={onConnect}
          onEdgeDoubleClick={onEdgeDbl}
          onSelectionChange={onSel}
          onNodeContextMenu={onNodeCtx as any}
          onNodeClick={(_e: any, node: Node) => {
            const c = chars.find(x => x.id === node.id);
            if (c) setSelectedChar(c);
          }}
          onClick={(e) => {
            // 点击空白处关闭人物卡
            if (selectedChar) {
              const target = e.target as HTMLElement;
              if (!target.closest('.react-flow__node')) setSelectedChar(null);
            }
          }}
          nodeTypes={nts} edgeTypes={ets}
          defaultEdgeOptions={{ type: "customEdge", data: { label: "关系", color: "#94a3b8" }, style: { stroke: "#94a3b8", strokeWidth: 2 } }}
          fitView minZoom={0.1} maxZoom={3}
          nodesDraggable elementsSelectable
          panOnDrag={[2]} selectionOnDrag
          selectionMode="partial"
          deleteKeyCode="Delete" multiSelectionKeyCode="Shift"
        >
          <Background color="#e2e8f0" gap={24} size={1} />
          <MiniMap className="!shadow-md !rounded-lg !border"
            nodeColor={(n: any) => {
              if (n.type === "group") return "#a78bfa";
              return n.data?.character?.is_locked ? "#ef4444" : "#3b82f6";
            }}
            maskColor="rgba(0,0,0,0.08)" />
        </ReactFlow>

        {/* 水平画布工具栏 */}
        <div style={{
          position: "absolute", bottom: 16, left: 16, zIndex: 40,
          display: "flex", alignItems: "center", gap: 2,
          borderRadius: 10, border: "1px solid #e2e8f0", background: "white",
          padding: "4px 8px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
        }}>
          <button onClick={() => rfRef.current?.zoomIn()} style={btnStyle} title="放大">＋</button>
          <button onClick={() => rfRef.current?.zoomOut()} style={btnStyle} title="缩小">−</button>
          <span style={{ width: 1, height: 14, background: "#e2e8f0", margin: "0 4px" }} />
          <button onClick={() => rfRef.current?.fitView()} style={btnStyle} title="适应画布">⊡</button>
        </div>

        {/* 选中工具栏 - 水平靠底部 */}
        {selIds.length >= 2 && (
          <div style={{
            position: "absolute", bottom: 16, left: 16, zIndex: 50,
            borderRadius: 12, border: "1px solid #e2e8f0", background: "white", padding: "8px 12px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)", display: "flex", alignItems: "center", gap: 6, fontSize: 12,
          }}>
            <span style={{ color: "#94a3b8", marginRight: 4 }}>{selIds.length} 个</span>
            <span style={{ width: 1, height: 16, background: "#e2e8f0" }} />
            <button className="hover:bg-amber-50 rounded px-1 py-0.5" onClick={() => align("left")} title="左对齐">L</button>
            <button className="hover:bg-amber-50 rounded px-1 py-0.5" onClick={() => align("ch")} title="水平居中">CH</button>
            <button className="hover:bg-amber-50 rounded px-1 py-0.5" onClick={() => align("right")} title="右对齐">R</button>
            <span style={{ width: 1, height: 16, background: "#e2e8f0" }} />
            <button className="hover:bg-amber-50 rounded px-1 py-0.5" onClick={() => align("top")} title="顶对齐">T</button>
            <button className="hover:bg-amber-50 rounded px-1 py-0.5" onClick={() => align("cv")} title="垂直居中">CV</button>
            <button className="hover:bg-amber-50 rounded px-1 py-0.5" onClick={() => align("bottom")} title="底对齐">B</button>
            <span style={{ width: 1, height: 16, background: "#e2e8f0" }} />
            <button className="hover:bg-amber-50 rounded px-2 py-0.5 font-medium" onClick={() => dist("h")} title="水平等距">H=</button>
            <button className="hover:bg-amber-50 rounded px-2 py-0.5 font-medium" onClick={() => dist("v")} title="垂直等距">V=</button>
            <span style={{ width: 1, height: 16, background: "#e2e8f0" }} />
            <button className="hover:bg-violet-50 rounded px-2 py-0.5 text-violet-700" onClick={() => { setPendSel([...selIds]); setGName(""); setShowDlg(true); }}>Ctrl+G</button>
            <button className="hover:bg-violet-50 rounded px-2 py-0.5 text-violet-500" onClick={() => doUngroup()}>解散</button>
            <span style={{ width: 1, height: 16, background: "#e2e8f0" }} />
            <button className="hover:bg-red-50 rounded px-2 py-0.5 text-red-600" onClick={() => { for (const id of selIds) { const n = nodes.find(x => x.id === id); if (n?.type === "characterNode") handleDelete(id); } setSelIds([]); }}>X</button>
          </div>
        )}
      </div>
    </div>
  );
}
