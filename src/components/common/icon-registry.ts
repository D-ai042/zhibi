// icon-registry.ts — 显式图标注册表，替代 `import * as LucideIcons` 的全量导入
// 原方案 `import * as LucideIcons from "lucide-react"` + `LucideIcons[name]` 索引访问
// 导致 rollup 无法 tree-shake，lucide 全量 803KB 打入 bundle。
// 改为显式 import + 白名单映射，仅打包注册的图标；未注册图标 fallback 到 FileText。
import type { LucideIcon } from "lucide-react";
import {
  // 已在代码中具名使用的图标
  ChevronDown, ChevronUp, ChevronRight, Menu, Settings, Settings2, Puzzle, LogOut,
  Download, Upload, FileDown, LayoutDashboard, ListTree, Layers, BookMarked, Lightbulb,
  Archive, RefreshCw, Eye, EyeOff, Copy, Edit3, RotateCcw, Trash2, X, Check, CheckCircle,
  CheckCircle2, ClipboardPlus, Eraser, FileText, BookOpen, FolderOpen, Plus, Minus,
  Sparkles, Square, Mic, MicOff, Paperclip, Send, BarChart3, Users, Globe2, Search,
  PenLine, ShieldCheck, Shield, Palette, MessageCircle, Save, AlignLeft, Undo2, Redo2,
  Lock, Unlock, Pencil, History, AlertTriangle, Activity, Bug, Monitor, FileUp, Folder,
  FolderPlus, File, Image, GitBranch, Wand2, Expand, Shrink, ArrowRight,
  // AI 动态配置常见图标补充（navItem.icon / mod.icon）
  Home, Star, Heart, Clock, MapPin, Tag, Calendar, Mail, MessageSquare, Bookmark, Flag,
  Zap, Cloud, Sun, Moon, Music, Video, Camera, Bell, Compass, Map, Navigation, Anchor,
  Rocket, Car, Cpu, Database, Server, Wifi, Battery, Key, Sword, Hammer, Wrench, Cog,
  Award, Gift, Target, Crosshair, TrendingUp, DollarSign, Percent, Smile, User, UserPlus,
  Phone, ThumbsUp, BookX, NotebookPen, Feather, Scroll, BookText, Library, Brain,
} from "lucide-react";

type IconMap = Record<string, LucideIcon>;

/** 已注册图标表：只这些图标名可被动态解析 */
const ICON_REGISTRY: IconMap = {
  ChevronDown, ChevronUp, ChevronRight, Menu, Settings, Settings2, Puzzle, LogOut,
  Download, Upload, FileDown, LayoutDashboard, ListTree, Layers, BookMarked, Lightbulb,
  Archive, RefreshCw, Eye, EyeOff, Copy, Edit3, RotateCcw, Trash2, X, Check, CheckCircle,
  CheckCircle2, ClipboardPlus, Eraser, FileText, BookOpen, FolderOpen, Plus, Minus,
  Sparkles, Square, Mic, MicOff, Paperclip, Send, BarChart3, Users, Globe2, Search,
  PenLine, ShieldCheck, Shield, Palette, MessageCircle, Save, AlignLeft, Undo2, Redo2,
  Lock, Unlock, Pencil, History, AlertTriangle, Activity, Bug, Monitor, FileUp, Folder,
  FolderPlus, File, Image, GitBranch, Wand2, Expand, Shrink, ArrowRight,
  Home, Star, Heart, Clock, MapPin, Tag, Calendar, Mail, MessageSquare, Bookmark, Flag,
  Zap, Cloud, Sun, Moon, Music, Video, Camera, Bell, Compass, Map, Navigation, Anchor,
  Rocket, Car, Cpu, Database, Server, Wifi, Battery, Key, Sword, Hammer, Wrench, Cog,
  Award, Gift, Target, Crosshair, TrendingUp, DollarSign, Percent, Smile, User, UserPlus,
  Phone, ThumbsUp, BookX, NotebookPen, Feather, Scroll, BookText, Library, Brain,
};
const DEFAULT_ICON: LucideIcon = FileText;

/**
 * 按名称解析图标组件，仅限已注册图标。
 * 未注册的名称返回 FileText 作为 fallback（避免 `import * as` 全量打包）。
 */
export function resolveIcon(name: string | undefined | null): LucideIcon | null {
  if (!name) return null;
  return ICON_REGISTRY[name] || DEFAULT_ICON;
}
