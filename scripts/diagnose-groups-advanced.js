/**
 * 世界观编组位置诊断脚本 (Tauri EXE 模式专用)
 * 
 * 使用方法：
 * 1. 在 EXE 应用中打开开发者工具 (F12 或 Ctrl+Shift+I)
 * 2. 在控制台中粘贴此脚本并运行
 * 3. 查看诊断结果
 * 
 * 此脚本会通过 Tauri invoke 直接读取 SQLite 数据库
 */

(async function diagnoseWorldviewGroupsAdvanced() {
  console.log('🔍 开始深度诊断世界观编组位置问题...\n');

  // 检查是否在 Tauri 环境
  const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
  console.log(`环境: ${isTauri ? 'Tauri EXE' : '浏览器'}\n`);

  // 获取项目ID
  let projectId = null;
  
  // 方法1: 从 Zustand store 获取
  try {
    const storeState = (window as any).__ZUSTAND_STORE__?.getState?.();
    projectId = storeState?.currentProject?.id;
  } catch (e) {}
  
  // 方法2: 从 localStorage 获取
  if (!projectId) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.includes('app-store')) {
        try {
          const data = JSON.parse(localStorage.getItem(key)!);
          projectId = data?.state?.currentProject?.id;
          if (projectId) break;
        } catch (e) {}
      }
    }
  }

  if (!projectId) {
    console.error('❌ 未找到当前项目ID');
    console.log('请确保:');
    console.log('1. 已打开一个项目');
    console.log('2. 在项目页面运行此脚本');
    return;
  }

  console.log(`📁 项目ID: ${projectId}\n`);

  // 读取编组数据
  const groupsKey = `worldview-groups-${projectId}`;
  let groups = [];
  try {
    groups = JSON.parse(localStorage.getItem(groupsKey) || '[]');
  } catch (e) {
    console.error('❌ 编组数据读取失败:', e);
  }

  console.log(`📦 编组数量: ${groups.length}\n`);

  // 读取词条数据
  let terms = [];
  
  if (isTauri) {
    // Tauri 模式：通过 invoke 读取
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      terms = await invoke('list_world_terms', { projectId });
      console.log(`📝 从数据库读取 ${terms.length} 个词条`);
    } catch (e) {
      console.error('❌ 读取词条失败:', e);
    }
  } else {
    // 浏览器模式：从 localStorage 读取
    try {
      const mockData = JSON.parse(localStorage.getItem('novel-workbench-mock') || '{}');
      terms = mockData?.worldTerms || [];
      console.log(`📝 从 localStorage 读取 ${terms.length} 个词条`);
    } catch (e) {
      console.error('❌ 读取词条失败:', e);
    }
  }

  // 诊断结果
  const issues = [];
  const warnings = [];

  // 检查1: 编组数据完整性
  console.log('\n--- 检查1: 编组数据完整性 ---');
  groups.forEach((group, i) => {
    if (!group.id) issues.push(`编组 ${i + 1}: 缺少 ID`);
    if (!group.name) warnings.push(`编组 ${i + 1}: 缺少名称`);
    if (typeof group.x !== 'number' || isNaN(group.x)) issues.push(`编组 "${group.name || i + 1}": x 坐标无效 (${group.x})`);
    if (typeof group.y !== 'number' || isNaN(group.y)) issues.push(`编组 "${group.name || i + 1}": y 坐标无效 (${group.y})`);
    if (!Array.isArray(group.childIds)) issues.push(`编组 "${group.name || i + 1}": childIds 不是数组`);
  });

  if (issues.length === 0) {
    console.log('✅ 编组数据结构完整');
  }

  // 检查2: 子节点存在性
  console.log('\n--- 检查2: 子节点存在性 ---');
  const termIds = new Set(terms.map((t: any) => t.id));
  
  groups.forEach(group => {
    const missingChildren = group.childIds?.filter((id: string) => !termIds.has(id)) || [];
    if (missingChildren.length > 0) {
      issues.push(`编组 "${group.name}": ${missingChildren.length} 个子节点在数据库中不存在`);
      console.warn(`⚠️ 编组 "${group.name}" 有 ${missingChildren.length} 个孤立子节点`);
    } else {
      console.log(`✅ 编组 "${group.name}": 所有子节点都存在`);
    }
  });

  // 检查3: 坐标一致性
  console.log('\n--- 检查3: 坐标一致性 ---');
  groups.forEach(group => {
    console.log(`\n编组 "${group.name}" (位置: ${group.x}, ${group.y}):`);
    
    group.childIds?.forEach((childId: string) => {
      const term = terms.find((t: any) => t.id === childId);
      if (!term) return;

      const termX = term.layout_x;
      const termY = term.layout_y;
      
      // 计算相对坐标
      const relX = termX - group.x;
      const relY = termY - group.y;
      
      // 检查是否在编组范围内
      const inBounds = relX >= 0 && relX <= (group.w || 400) && 
                       relY >= 0 && relY <= (group.h || 300);
      
      console.log(`   ${term.title}:`);
      console.log(`      绝对坐标: (${termX}, ${termY})`);
      console.log(`      相对坐标: (${relX}, ${relY})`);
      console.log(`      在编组范围内: ${inBounds ? '✅' : '⚠️ 否'}`);
      
      if (!inBounds) {
        warnings.push(`编组 "${group.name}" 中的词条 "${term.title}" 超出编组范围`);
      }
    });
  });

  // 检查4: 重复编组
  console.log('\n--- 检查4: 重复编组检查 ---');
  const groupChildMap = new Map<string, string[]>();
  groups.forEach(group => {
    group.childIds?.forEach((childId: string) => {
      if (!groupChildMap.has(childId)) {
        groupChildMap.set(childId, []);
      }
      groupChildMap.get(childId)!.push(group.name);
    });
  });

  groupChildMap.forEach((groupNames, childId) => {
    if (groupNames.length > 1) {
      const term = terms.find((t: any) => t.id === childId);
      issues.push(`词条 "${term?.title || childId}" 同时属于 ${groupNames.length} 个编组: ${groupNames.join(', ')}`);
    }
  });

  if (issues.length === 0) {
    console.log('✅ 没有重复编组');
  }

  // 输出诊断结果
  console.log('\n\n' + '='.repeat(50));
  console.log('📊 诊断结果汇总');
  console.log('='.repeat(50));

  if (issues.length > 0) {
    console.log('\n❌ 发现问题:');
    issues.forEach((issue, i) => console.log(`   ${i + 1}. ${issue}`));
  } else {
    console.log('\n✅ 未发现严重问题');
  }

  if (warnings.length > 0) {
    console.log('\n⚠️ 警告:');
    warnings.forEach((warning, i) => console.log(`   ${i + 1}. ${warning}`));
  }

  // 生成修复建议
  console.log('\n\n💡 修复建议:');
  
  if (issues.some(i => i.includes('子节点在数据库中不存在'))) {
    console.log('1. 清理孤立的子节点引用');
    console.log('   运行: cleanOrphanChildren()');
  }
  
  if (issues.some(i => i.includes('同时属于'))) {
    console.log('2. 修复重复编组问题');
    console.log('   运行: fixDuplicateGroups()');
  }
  
  if (warnings.some(w => w.includes('超出编组范围'))) {
    console.log('3. 调整编组大小或重新排列子节点');
  }

  // 导出完整诊断数据
  console.log('\n\n📋 完整诊断数据 (可复制用于反馈):');
  const diagnosticReport = {
    timestamp: new Date().toISOString(),
    environment: isTauri ? 'Tauri EXE' : 'Browser',
    projectId,
    groups: groups.map((g: any) => ({
      id: g.id,
      name: g.name,
      position: { x: g.x, y: g.y },
      size: { w: g.w, h: g.h },
      childCount: g.childIds?.length || 0,
      children: g.childIds?.map((id: string) => {
        const term = terms.find((t: any) => t.id === id);
        return {
          id,
          title: term?.title || 'Unknown',
          absolutePosition: { x: term?.layout_x, y: term?.layout_y }
        };
      }) || []
    })),
    issues,
    warnings
  };
  console.log(JSON.stringify(diagnosticReport, null, 2));

  // 提供全局修复函数
  (window as any).cleanOrphanChildren = function() {
    console.log('🧹 清理孤立子节点...');
    let cleaned = 0;
    groups.forEach(group => {
      const validChildren = group.childIds?.filter((id: string) => termIds.has(id)) || [];
      if (validChildren.length !== group.childIds?.length) {
        cleaned += (group.childIds?.length || 0) - validChildren.length;
        group.childIds = validChildren;
      }
    });
    localStorage.setItem(groupsKey, JSON.stringify(groups));
    console.log(`✅ 已清理 ${cleaned} 个孤立子节点引用`);
    console.log('请刷新页面查看效果');
  };

  (window as any).fixDuplicateGroups = function() {
    console.log('🔧 修复重复编组...');
    const childToGroups = new Map<string, string[]>();
    groups.forEach(group => {
      group.childIds?.forEach((childId: string) => {
        if (!childToGroups.has(childId)) {
          childToGroups.set(childId, []);
        }
        childToGroups.get(childId)!.push(group.id);
      });
    });

    let fixed = 0;
    childToGroups.forEach((groupIds, childId) => {
      if (groupIds.length > 1) {
        // 保留第一个编组，从其他编组中移除
        for (let i = 1; i < groupIds.length; i++) {
          const group = groups.find((g: any) => g.id === groupIds[i]);
          if (group) {
            group.childIds = group.childIds.filter((id: string) => id !== childId);
            fixed++;
          }
        }
      }
    });

    // 移除空编组
    const nonEmptyGroups = groups.filter((g: any) => g.childIds && g.childIds.length > 0);
    localStorage.setItem(groupsKey, JSON.stringify(nonEmptyGroups));
    console.log(`✅ 已修复 ${fixed} 个重复编组问题`);
    console.log('请刷新页面查看效果');
  };

  (window as any).resetGroups = function() {
    if (confirm('确定要重置所有编组吗？这将删除所有编组数据。')) {
      localStorage.removeItem(groupsKey);
      console.log('✅ 已重置所有编组数据');
      console.log('请刷新页面并重新创建编组');
    }
  };

  console.log('\n\n🛠️ 可用的修复函数:');
  console.log('   cleanOrphanChildren() - 清理孤立的子节点引用');
  console.log('   fixDuplicateGroups() - 修复重复编组问题');
  console.log('   resetGroups() - 重置所有编组数据');

  return diagnosticReport;
})();
