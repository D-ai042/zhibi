/**
 * 世界观编组位置诊断脚本
 * 
 * 使用方法：
 * 1. 在应用中打开浏览器开发者工具 (F12)
 * 2. 在控制台中粘贴此脚本并运行
 * 3. 查看诊断结果
 */

(function diagnoseWorldviewGroups() {
  console.log('🔍 开始诊断世界观编组位置问题...\n');

  // 获取当前项目ID
  const projectMatch = document.cookie.match(/currentProjectId=([^;]+)/);
  let projectId = projectMatch ? projectMatch[1] : null;
  
  // 尝试从localStorage获取
  if (!projectId) {
    const appState = localStorage.getItem('app-store');
    if (appState) {
      try {
        const parsed = JSON.parse(appState);
        projectId = parsed?.state?.currentProject?.id;
      } catch (e) {}
    }
  }

  if (!projectId) {
    console.error('❌ 未找到当前项目ID，请确保已打开一个项目');
    return;
  }

  console.log(`📁 当前项目ID: ${projectId}\n`);

  // 1. 检查编组数据
  const groupsKey = `worldview-groups-${projectId}`;
  const groupsData = localStorage.getItem(groupsKey);
  let groups = [];
  
  if (groupsData) {
    try {
      groups = JSON.parse(groupsData);
      console.log(`✅ 找到 ${groups.length} 个编组:`);
      groups.forEach((g, i) => {
        console.log(`   编组 ${i + 1}: "${g.name}" (id: ${g.id})`);
        console.log(`      位置: (${g.x}, ${g.y})`);
        console.log(`      大小: ${g.w} x ${g.h}`);
        console.log(`      子节点: ${g.childIds?.length || 0} 个`);
        if (g.childIds?.length > 0) {
          console.log(`      子节点ID: ${g.childIds.join(', ')}`);
        }
      });
    } catch (e) {
      console.error('❌ 编组数据解析失败:', e);
    }
  } else {
    console.log('⚠️ 未找到编组数据');
  }

  console.log('\n---\n');

  // 2. 检查词条数据（从SQLite mock或localStorage）
  const mockKey = 'novel-workbench-mock';
  const mockData = localStorage.getItem(mockKey);
  let terms = [];
  
  if (mockData) {
    try {
      const parsed = JSON.parse(mockData);
      terms = parsed?.worldTerms || [];
      console.log(`✅ 找到 ${terms.length} 个词条`);
    } catch (e) {
      console.error('❌ 词条数据解析失败:', e);
    }
  }

  // 3. 检查坐标一致性
  if (groups.length > 0 && terms.length > 0) {
    console.log('\n📊 坐标一致性检查:');
    
    let hasIssue = false;
    
    groups.forEach(group => {
      console.log(`\n检查编组 "${group.name}":`);
      
      group.childIds?.forEach(childId => {
        const term = terms.find(t => t.id === childId);
        if (!term) {
          console.warn(`   ⚠️ 子节点 ${childId} 在词条列表中不存在`);
          return;
        }

        const termAbsX = term.layout_x;
        const termAbsY = term.layout_y;
        
        // 计算期望的相对坐标
        const expectedRelX = termAbsX - group.x;
        const expectedRelY = termAbsY - group.y;
        
        console.log(`   词条 "${term.title}":`);
        console.log(`      数据库绝对坐标: (${termAbsX}, ${termAbsY})`);
        console.log(`      编组位置: (${group.x}, ${group.y})`);
        console.log(`      计算的相对坐标: (${expectedRelX}, ${expectedRelY})`);
        
        // 检查是否有异常值
        if (isNaN(termAbsX) || isNaN(termAbsY) || isNaN(group.x) || isNaN(group.y)) {
          console.error(`      ❌ 发现 NaN 坐标！`);
          hasIssue = true;
        }
        
        if (termAbsX === 0 && termAbsY === 0) {
          console.warn(`      ⚠️ 词条坐标为 (0,0)，可能是未初始化`);
          hasIssue = true;
        }
      });
    });

    if (hasIssue) {
      console.log('\n❌ 发现坐标问题，建议修复');
    } else {
      console.log('\n✅ 坐标数据看起来正常');
    }
  }

  // 4. 检查localStorage和SQLite缓存一致性
  console.log('\n---\n');
  console.log('🗄️ 存储层检查:');
  
  const sqliteCacheKey = groupsKey;
  const sqliteCache = localStorage.getItem(sqliteCacheKey);
  
  if (sqliteCache === groupsData) {
    console.log('✅ localStorage 和缓存数据一致');
  } else {
    console.warn('⚠️ localStorage 和缓存数据可能不一致');
  }

  // 5. 提供修复建议
  console.log('\n---\n');
  console.log('💡 常见问题和解决方案:');
  console.log('1. 如果编组位置重置，可能是 doGroup 保存了相对坐标而非绝对坐标');
  console.log('2. 如果切换页面后位置混乱，可能是 onNodesChange 没有正确保存');
  console.log('3. 如果对齐/等距后位置丢失，可能是 align/dist 函数没有持久化');
  console.log('\n建议操作:');
  console.log('- 备份当前数据后，尝试重新编组');
  console.log('- 检查是否有重复的编组ID');
  console.log('- 清除 localStorage 中的 worldview-groups 数据后重新创建编组');

  // 6. 导出诊断数据
  console.log('\n---\n');
  console.log('📋 诊断数据摘要:');
  const diagnosticData = {
    projectId,
    groupsCount: groups.length,
    termsCount: terms.length,
    groups: groups.map(g => ({
      id: g.id,
      name: g.name,
      position: { x: g.x, y: g.y },
      childCount: g.childIds?.length || 0
    })),
    timestamp: new Date().toISOString()
  };
  console.log(JSON.stringify(diagnosticData, null, 2));
  
  return diagnosticData;
})();
