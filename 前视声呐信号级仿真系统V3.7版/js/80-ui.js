/* =========================================================================
 * 80-ui.js —— 界面构建：菜单 / 左栏七页参数 / 中央三视图 / 右侧控制台 / 导出 / 算例
 * -------------------------------------------------------------------------
 *   V2.0 版面：
 *     左栏  #leftPanels   七页：海底地形 / 待测目标 / 海洋环境 / ROV载体 /
 *                              发射系统 / 接收阵列 / 成像处理
 *     中栏  #center       三视图：三维场景设置 / 原理演示 / 前视声呐成像
 *     右栏  #rightPanels  仿真控制台（运行控制 + 实时指标 + 仿真日志）
 *   「仿真参数总控面板」这一栏自 V2.0 起取消，内容拆进左栏后五页。
 *
 *   V2.1 版面调整（本文件相应改动）：
 *     ① 顶栏「色标选择」菜单撤除：声图色标归「前视声呐成像」视图栏，
 *        海底深度色标归「三维场景设置」视图栏（#selTerrainCmap），两套独立。
 *     ② 成像栏改上下两排：上排 三维视口 + 扇图（等高），下排整幅宽的阵元信号；
 *        信号窗口自己的标题条拿回「阵元 / 曲线 / 预处理后」三个选择。
 *
 *   V2.2 版面调整：
 *     ① 三维场景设置栏命令条下方那条「场景面板（实例/地形编辑/航路/属性）」
 *        横带**整条删除**：四个板块与左栏页签一一重复，既吃掉视口一整条高度，
 *        又让人分不清该看哪一处。唯一不重复的「闭环巡航」开关上移到航路按钮组。
 *     ② 中英双语整体撤除（详解见 01-core.js 顶部说明）。
 *     ③ 选中目标后可在三维里直接拖动（红 E / 绿 N / 蓝 U 三轴手柄 + 本体水平拖），
 *        位置数字与左栏属性面板双向同步。
 * ========================================================================= */
(function () {
  var U = FLS.U;

  var ui = {};
  FLS.ui = ui;
  /* V2.0：左侧七个页签（原「场景资源库」与「仿真参数总控面板」合并后的统一入口）。
     默认落在第一页「海底地形设置」——布一个场景总是先铺海底。 */
  var curTab = 'terrain';
  /* 中央三视图：scene=三维场景设置 / demo=原理演示 / image=前视声呐成像 */
  var curView = 'scene';

  /* ---------------------------------------------------------- 通用小工具 */
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function q(id) { return document.getElementById(id); }

  /* ---------------------------------------------------------- 初始化 */
  ui.init = function () {
    buildMenus();
    buildCollapse();
    buildLeftTabs();          // V2.0：左侧七页参数栏（取代原资源库 + 参数总控两块）
    buildViewSwitch();        // V2.0：中央三视图切换
    buildToolbars();          // V2.0：三条工具条上的控件绑定
    buildParamPanel();
    buildConsole();
    buildSignalPanel();
    // V1.3 航路规划：闭环开关（改后立刻重画连线，末段是否连回首点会变）
    var rlc = q('routeLoopChk');
    if (rlc) rlc.onchange = function () {
      FLS.state.routeLoop = rlc.checked;
      FLS.scene3d.updateRoute();
      FLS.log('航路闭环巡航：' + (rlc.checked ? '开（末点回到首点）' : '关（末点为终点）') + '。');
    };
    ui.refreshInstList();
    ui.onSelect();
    ui.setView('scene');
  };

  /* ================================================================
   * V2.0 中央三视图切换
   *   三个视图面板（#paneScene / #paneDemo / #paneImage）在 #stage 里
   *   绝对定位叠放，切换时只改 .hide；工具条与视图栏上的专属控件同步显隐。
   *   ⚠ 切换后必须 resizeAll()：隐藏的面板 clientWidth/Height 为 0，
   *     THREE 与 2D 画布都在显示时才量得到正确尺寸。
   * ================================================================ */
  ui.setView = function (v) {
    if (!/^(scene|demo|image)$/.test(v)) v = 'scene';
    curView = v;
    document.querySelectorAll('#viewModeGroup .vbtn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.view === v);
    });
    ['scene', 'demo', 'image'].forEach(function (k) {
      var pn = q('pane' + k.charAt(0).toUpperCase() + k.slice(1));
      var br = q('bar' + k.charAt(0).toUpperCase() + k.slice(1));
      /* 三维场景设置面板（paneScene）**永不隐藏**：它承载主 WebGL 视口，
         始终留在最底层参与布局（这样切回时尺寸不用从 0 恢复），
         被上层不透明面板盖住即可。 */
      if (pn && k !== 'scene') pn.classList.toggle('off', k !== v);
      if (br) br.classList.toggle('hide', k !== v);
    });
    var vs = q('vbScene'); if (vs) vs.classList.toggle('hide', v !== 'scene');
    var vi = q('vbImage'); if (vi) vi.classList.toggle('hide', v !== 'image');
    /* 原理演示：只在自己这一幕可见时推进动画，切走即暂停（省 CPU）。
       顺序：先 resizeAll 把画布尺寸定好，再 play —— 免得第一帧画在旧尺寸上。 */
    if (FLS.app && FLS.app.resizeAll) FLS.app.resizeAll();
    /* V2.2：mini 视口的拷贝是节流的（见 60-scene3d.renderMini），
       刚切进成像视图时必须强制拷一次，否则那一格要空到下一次节流窗口。 */
    if (v === 'image' && FLS.scene3d && FLS.scene3d.renderMini) FLS.scene3d.renderMini(true);
    /* ★ V3.5：虚拟摄像头视口同样是节流的（CAM_MS=55 ms），切进来要强制出一帧，
       否则刚切到成像页时会看到一块空白的黑框。 */
    if (v === 'image' && FLS.camview && FLS.camview.render) FLS.camview.render(true);
    if (FLS.Demo) { if (v === 'demo') FLS.Demo.play(); else FLS.Demo.pause(); }
    if (FLS.app && FLS.app.refreshDisplayChecks) FLS.app.refreshDisplayChecks();  // 菜单里三个视图项的勾选态
  };
  ui.getView = function () { return curView; };

  /** V2.0：某个参数页被改过后，页签右上角点一个小圆点（去那一页就清掉） */
  ui.markDirty = function (grp) {
    if (!/^(terrain|target|env|rov|tx|rx|alg)$/.test(grp)) return;
    var b = document.querySelector('#paramTabs .ptab[data-ptab="' + grp + '"]');
    if (b && !b.classList.contains('on')) b.classList.add('dirty');
  };

  function buildViewSwitch() {
    document.querySelectorAll('#viewModeGroup .vbtn').forEach(function (b) {
      b.onclick = function () { ui.setView(b.dataset.view); };
    });
  }

  /* ================================================================
   * V2.0 三条工具条 / 视图栏上的控件绑定
   *   这些控件都是"显示量"或"全局参数"，改动后只重画、不重算。
   * ================================================================ */
  function buildToolbars() {
    /* —— 视图栏：量程（alg.rmax，三维扇面与成像共用） —— */
    var sr = q('selRmax');
    if (sr) {
      sr.value = String(FLS.P['alg.rmax']);
      sr.onchange = function () {
        FLS.setP('alg.rmax', sr.value);
        FLS.app.onParamChange('alg.rmax');
        ui.renderParams();
        FLS.log('成像量程改为 ' + FLS.P['alg.rmax'] + ' m（不模糊距离 c·PRP/2 处会自动截断）。');
      };
    }
    /* —— 视图栏：三维垂直放大（纯显示量） —— */
    var zx = q('rngZexag'), zv = q('valZexag');
    if (zx) {
      zx.value = FLS.P['disp.zexag'];
      if (zv) zv.textContent = (+FLS.P['disp.zexag']).toFixed(1) + '×';
      zx.oninput = function () {
        var v = parseFloat(zx.value);
        if (zv) zv.textContent = v.toFixed(1) + '×';
      };
      zx.onchange = function () {
        FLS.setP('disp.zexag', zx.value);
        FLS.app.onParamChange('disp.zexag');
        FLS.scene3d.updateDepthLegend();
      };
    }
    /* —— 色标 ——
       V2.1 起两套分开、各归各栏：
         disp.cmap       声图色标  → 「前视声呐成像」视图栏 #selCmapTop
         disp.heightCmap 海底色标  → 「三维场景设置」视图栏 #selTerrainCmap
       顶栏不再有「色标选择」菜单。 */
    fillCmapSelects();
    fillTerrainCmapSelect();
    /* —— 成像栏：动态范围（色标跨度，dB） —— */
    var dy = q('rngDyn'), dyv = q('valDyn');
    if (dy) {
      dy.value = FLS.P['disp.dynSpan'];
      if (dyv) dyv.textContent = FLS.P['disp.dynSpan'] + ' dB';
      dy.oninput = function () { if (dyv) dyv.textContent = dy.value + ' dB'; };
      dy.onchange = function () {
        FLS.setP('disp.dynSpan', dy.value);
        FLS.app.onParamChange('disp.dynSpan');
        FLS.log('显示动态范围跨度改为 ' + FLS.P['disp.dynSpan'] + ' dB。');
      };
    }
    /* —— 成像栏：窗偏移（在自动窗口上整体平移，dB） —— */
    var br = q('rngBri'), brv = q('valBri');
    if (br) {
      br.value = FLS.P['disp.bias'] || 0;
      if (brv) brv.textContent = (FLS.P['disp.bias'] >= 0 ? '+' : '') + (FLS.P['disp.bias'] || 0) + ' dB';
      br.oninput = function () {
        var v = parseFloat(br.value);
        if (brv) brv.textContent = (v >= 0 ? '+' : '') + v + ' dB';
      };
      br.onchange = function () {
        FLS.setP('disp.bias', br.value);
        FLS.app.onParamChange('disp.bias');
      };
    }
    /* —— 原理演示控制条 —— */
    if (FLS.Demo && FLS.Demo.bindBar) FLS.Demo.bindBar();
  }

  /** 填充声图色标下拉，并同步当前 disp.cmap。
      只列**非 terr** 的色标 —— 海底深度色标是另一套，见 fillTerrainCmapSelect()。
      （V2.2：成像工具条上那个重复的 sonorCmap 早在 V2.0 就并入视图栏了，
        数组里留着它只会让人以为还有两处。） */
  function fillCmapSelects() {
    ['selCmapTop'].forEach(function (id) {
      var s = q(id);
      if (!s) return;
      s.innerHTML = '';
      Object.keys(FLS.CMAPS).forEach(function (k) {
        if (FLS.CMAPS[k].terr) return;               // V2.1：海底色标不进声图下拉
        var o = document.createElement('option');
        o.value = k; o.textContent = FLS.CMAPS[k].name;
        s.appendChild(o);
      });
      s.value = FLS.P['disp.cmap'];
      s.onchange = function () {
        FLS.setP('disp.cmap', s.value);
        ui.syncCmapSelects();
        FLS.app.onParamChange('disp.cmap');
        FLS.log('成像色标切换为：' + FLS.CMAPS[s.value].name);
      };
    });
  }
  ui.syncCmapSelects = function () {
    ['selCmapTop'].forEach(function (id) {
      var s = q(id); if (s && s.value !== FLS.P['disp.cmap']) s.value = FLS.P['disp.cmap'];
    });
    var t = q('selTerrainCmap');
    if (t && t.value !== FLS.P['disp.heightCmap']) t.value = FLS.P['disp.heightCmap'];
  };
  /* V2.2：量程下拉只有 30/50/60/80/120 五个固定档，而参数面板允许填 5~500 的任意值。
     直接 `sel.value = 75` 在 HTML 里是无效赋值（没有对应 option），下拉会显示成空白 ——
     用户会以为量程丢了。这里对非档位值插入一个临时 option（标记为 data-tmp），
     下次回到固定档位时把它移除，保证下拉里显示的一定是真实量程。 */
  function syncRmaxSelect(sel, v) {
    var s = String(v);
    var has = Array.prototype.some.call(sel.options, function (o) { return o.value === s; });
    var tmp = sel.querySelector('option[data-tmp]');
    if (!has) {
      if (tmp) { tmp.value = s; tmp.textContent = s + ' m'; }
      else {
        var op = document.createElement('option');
        op.value = s; op.textContent = s + ' m'; op.dataset.tmp = '1';
        sel.appendChild(op);
      }
    } else if (tmp) { tmp.remove(); }
    sel.value = s;
  }

  /** V2.2：把参数值回写到视图栏控件。
   *   量程 / 垂直放大 / 动态范围 / 窗偏移这四个量在**两处**可改：
   *   视图栏控件本身，以及左栏参数表（还有算例模板、载入工程、预设）。
   *   此前只有"视图栏 → 参数"一个方向，反向没有回写，于是在参数面板把量程
   *   改成 120 m 后，视图栏下拉仍显示 60 m —— 同屏出现两个互相矛盾的量程。
   *   本函数在每次参数变更结束时无条件调用：值一致时不动，开销可忽略。 */
  ui.syncViewBar = function () {
    var sr = q('selRmax');
    if (sr && String(sr.value) !== String(FLS.P['alg.rmax'])) syncRmaxSelect(sr, FLS.P['alg.rmax']);
    var zx = q('rngZexag'), zv = q('valZexag');
    if (zx && parseFloat(zx.value) !== parseFloat(FLS.P['disp.zexag'])) zx.value = FLS.P['disp.zexag'];
    if (zv) zv.textContent = (+FLS.P['disp.zexag']).toFixed(1) + '×';
    var dy = q('rngDyn'), dv = q('valDyn');
    if (dy && parseFloat(dy.value) !== parseFloat(FLS.P['disp.dynSpan'])) dy.value = FLS.P['disp.dynSpan'];
    if (dv) dv.textContent = FLS.P['disp.dynSpan'] + ' dB';
    var bs = parseFloat(FLS.P['disp.bias']) || 0;
    var br = q('rngBri'), bv = q('valBri');
    if (br && parseFloat(br.value) !== bs) br.value = bs;
    if (bv) bv.textContent = (bs >= 0 ? '+' : '') + bs + ' dB';
  };

  /** V2.1：「三维场景设置」视图栏上的海底深度色标下拉（与声图色标互不干涉） */
  function fillTerrainCmapSelect() {
    var s = q('selTerrainCmap');
    if (!s) return;
    s.innerHTML = '';
    (FLS.TERRAIN_CMAP_IDS || Object.keys(FLS.CMAPS).filter(function (k) { return FLS.CMAPS[k].terr; }))
      .forEach(function (k) {
        if (!FLS.CMAPS[k]) return;
        var o = document.createElement('option');
        o.value = k; o.textContent = FLS.CMAPS[k].name;
        s.appendChild(o);
      });
    s.value = FLS.P['disp.heightCmap'] || 'tsand';
    s.onchange = function () {
      FLS.setP('disp.heightCmap', s.value);
      ui.syncCmapSelects();
      FLS.app.onParamChange('disp.heightCmap');
      FLS.log('海底深度色标切换为：' + FLS.CMAPS[s.value].name + '（仅影响三维海床着色，与声图色标独立）。');
    };
  }

  /* —— 地形高程场导出 / 导入（三维场景设置工具条） ——
     导出的是"地形定义 + 手工编辑"两部分：定义可复现程序化高程场，
     编辑是叠加在其上的笔刷增量。二者分开存，便于只换地形或只换编辑。 */
  function saveTerrainJson() {
    /* ★ V3.1：导出的是**地形层**（每层的类型 + 参数，几十字节一份），
     * 不是那张栅格图 —— 栅格是这堆层算出来的副本，写进文件既没信息量又
     * 会让文件涨到上兆。载入时照着层重新烘焙一遍即可，结果与导出前一致。
     * version 2 → 3：新增 pending 字段（待确认层不入栅格）。 */
    var d = {
      app: 'FLS-TDSIM', kind: 'terrain', version: 3, time: new Date().toISOString(),
      terrains: FLS.state.terrains, terrainEdits: FLS.state.terrainEdits
    };
    FLS.download('FLS地形_' + stamp() + '.json', JSON.stringify(d, null, 1), 'application/json');
    FLS.ok('已导出海底地形（' + FLS.state.terrains.length + ' 份地形 + ' +
      FLS.state.terrainEdits.length + ' 笔手工编辑；栅格图由这些地形重算，不写入文件）。');
  }
  function loadTerrainJson() {
    var f = q('fileInput');
    f.accept = '.json';
    f.onchange = function () {
      var file = f.files[0]; if (!file) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var d = JSON.parse(rd.result);
          if (!d || (!d.terrains && !d.terrainEdits)) { FLS.warn('不是有效的地形文件。'); return; }
          FLS.state.terrains = d.terrains || [];
          FLS.state.terrainEdits = d.terrainEdits || [];
          /* V3.1：V3.0 及更早的文件里没有 pending 字段，视为已融入（那些版本
           * 压根没有"待确认"这个概念）；有字段的按文件原样恢复。 */
          FLS.state.terrains.forEach(function (t) { t.pending = !!t.pending; });
          ui.rebake('载入地形文件');
          FLS.scene3d.rebuildTerrain(FLS.state.rov.x, FLS.state.rov.y);
          ui.refreshInstList(); ui.onSelect();
          FLS.app.onParamChange('*');
          FLS.ok('地形加载完成：' + FLS.state.terrains.length + ' 份地形、' +
            FLS.state.terrainEdits.length + ' 笔编辑，已重新栅格化。');
        } catch (e) { FLS.err('地形文件解析失败：' + e.message); }
      };
      rd.readAsText(file);
      f.value = '';
    };
    f.click();
  }

  function buildMenus() {
    document.querySelectorAll('.menu-root').forEach(function (root) {
      var t = root.querySelector('.menu-title');
      t.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = root.classList.contains('open');
        document.querySelectorAll('.menu-root').forEach(function (r) { r.classList.remove('open'); });
        if (!open) root.classList.add('open');
      });
      root.addEventListener('mouseenter', function () {
        if (document.querySelector('.menu-root.open')) {
          document.querySelectorAll('.menu-root').forEach(function (r) { r.classList.remove('open'); });
          root.classList.add('open');
        }
      });
    });
    document.addEventListener('click', function () {
      document.querySelectorAll('.menu-root').forEach(function (r) { r.classList.remove('open'); });
    });
    /* V1.2 修复：原来只给 .menu-item 绑了点击，而三维 / 扇形视口工具栏、控制台
     * 「清屏」等按钮用的是 <button class="btn-mini" data-act="...">，从来没有被绑定 ——
     * 用户点了完全没反应（俯/侧/前/跟随/测距/适配/冻结/存帧/光标/清屏 全部是死按钮）。
     * 这里统一按 [data-act] 委托，菜单与工具栏走同一条分发路径。 */
    document.querySelectorAll('[data-act]').forEach(function (it) {
      if (it.dataset.__actBound) return;
      it.dataset.__actBound = '1';
      it.addEventListener('click', function () { handleAction(it.dataset.act, it); });
    });
    q('themeBtn').addEventListener('click', function () {
      FLS.Theme.toggle();
      ui.refreshThemeBtn();
    });
  }

  function handleAction(act, item) {
    switch (act) {
      case 'proj-save': ui.saveProject(); break;
      case 'proj-load': ui.loadProject(); break;
      case 'exp-csv-sig': ui.exportCsvSignal(); break;
      case 'exp-csv-img': ui.exportCsvImage(); break;
      case 'exp-png': FLS.Imaging.exportPNG('FLS_扇形成像_帧' + FLS.state.pingIndex + '.png'); FLS.ok('已导出声呐图像 PNG。'); break;
      case 'exp-report': ui.exportReport(); break;
      case 'tpl': ui.showTemplates(); break;
      /* V2.0：菜单切换中栏三视图（与顶部按钮、快捷键 1/2/3 等价） */
      case 'view-scene': ui.setView('scene'); break;
      case 'view-demo': ui.setView('demo'); break;
      case 'view-image': ui.setView('image'); break;
      /* V2.0：信号观测不再是独立的底部面板，而是「前视声呐成像」栏左列下格 */
      case 'tog-signal': toggleChk(item, 'sigCell'); break;
      case 'tog-left': toggleChk(item, 'leftPanels'); break;
      /* V3.0：原「右侧控制台」（#rightPanels）整个撤除，控制台移到页面底部
       * 成为一长条 #bottomConsole。这里只保留一个开关项（tog-console），
       * 菜单文案也同步改成「底部控制台」。 */
      case 'tog-console': toggleChk(item, 'bottomConsole'); break;
      case 'd-axes': toggleChk(item, null, 'axes'); break;
      case 'd-scale': toggleChk(item, null, 'scale'); break;
      case 'd-grid': toggleChk(item, null, 'grid'); break;
      case 'd-bbox': toggleChk(item, null, 'bbox'); break;
      case 'd-cone': toggleChk(item, null, 'cone'); break;
      case 'd-track': toggleChk(item, null, 'track'); break;
      case 'd-scatter': toggleChk(item, null, 'scatter'); break;
      case 'd-normal': toggleChk(item, null, 'normal'); break;
      case 'd-heightColor': toggleChk(item, null, 'heightColor'); break;
      case 'theme': FLS.Theme.toggle(); ui.refreshThemeBtn(); item.classList.toggle('on', FLS.Theme.isDark()); break;
      case 'cam-top': case 'cam-side': case 'cam-front': case 'cam-follow':
        FLS.scene3d.setCamera(act.slice(4)); break;
      case 'fit': FLS.scene3d.fit(); break;
      case 'measure': FLS.scene3d.startMeasure(); break;
      /* —— V2.0 三维场景设置工具条 —— */
      case 'sc-view':
        FLS.scene3d.setBrush(false); FLS.scene3d.setRoutePick(false);
        ui.refreshBrushBtn(); ui.syncRouteBtns(); ui.syncModeBtns();
        FLS.log('三维场景：观察/拖动模式（左键旋转、右键平移、滚轮缩放）。');
        break;
      case 'sc-save-terrain': saveTerrainJson(); break;
      case 'sc-load-terrain': loadTerrainJson(); break;
      /* —— V1.2 海底地形编辑 —— */
      case 'brush':
        FLS.scene3d.setBrush(!FLS.scene3d.brush.on);
        // V2.0：编辑记录与笔刷参数在三维场景栏的抽屉里，顺带切过去
        if (FLS.scene3d.brush.on) { FLS.scene3d.setRoutePick(false); ui.setView('scene'); }
        ui.refreshBrushBtn(); ui.syncRouteBtns(); ui.syncModeBtns();
        break;
      case 'ed-atrov': {
        // 在载体正下方各来一笔：先压低、再抬高，便于对比混响变化
        var rv = FLS.state.rov;
        var d0 = FLS.Terrain.depth(rv.x, rv.y);
        FLS.Terrain.addEdit(rv.x, rv.y, -Math.abs(FLS.scene3d.brush.amp),
          FLS.scene3d.brush.r, FLS.scene3d.brush.shape);
        FLS.scene3d.rebuildTerrain();
        FLS.log('地形编辑：载体正下方压低 ' + Math.abs(FLS.scene3d.brush.amp).toFixed(2) +
          ' m（深度 ' + d0.toFixed(2) + ' → ' + FLS.Terrain.depth(rv.x, rv.y).toFixed(2) + ' m）。');
            break;
      }
      case 'ed-undo': {
        var u = FLS.Terrain.undoEdit();
        FLS.scene3d.rebuildTerrain();
        FLS.log(u ? ('已撤销 1 笔地形编辑（剩余 ' + FLS.state.terrainEdits.length + ' 笔）。') : '没有可撤销的地形编辑。');
        break;
      }
      case 'ed-clear': {
        var n0 = FLS.Terrain.clearEdits();
        FLS.scene3d.rebuildTerrain();
            FLS.log(n0 ? ('已清空 ' + n0 + ' 笔地形编辑，海底恢复为程序化地形。') : '本来就没有手工编辑。');
        break;
      }
      /* —— V1.3 航路规划 —— */
      case 'route': {
        var on = FLS.scene3d.setRoutePick(!FLS.scene3d.route.on);
        if (on) { FLS.scene3d.setBrush(false); ui.setView('scene'); }
        ui.refreshBrushBtn(); ui.syncRouteBtns(); ui.syncModeBtns();
        break;
      }
      case 'r-reverse':
        FLS.scene3d.reverseRoute();
        FLS.log('航路已反向（共 ' + FLS.state.route.length + ' 个航点）。');
        break;
      case 'r-clear':
        FLS.scene3d.clearRoute();
        FLS.log('航路已清空。');
        break;
      case 'r-run': {
        if (!FLS.state.route.length) { FLS.warn('航路为空，无法巡航。'); break; }
        FLS.P['rov.mode'] = 'route';
        FLS.state.routeIdx = 0;
        FLS.app.onParamChange('rov.mode');
        ui.renderParams();
        FLS.ok('已切换到「航路规划自动巡航」（' + FLS.state.route.length + ' 个航点）。启动仿真即按航路行驶。');
        break;
      }
      case 'help-doc': ui.showHelp('doc'); break;
      case 'help-alg': ui.showHelp('alg'); break;
      case 'help-key': ui.showHelp('key'); break;
      case 'about': ui.showAbout(); break;
      case 'freeze': ui.toggleFreeze(item); break;
      case 'saveframe': FLS.Imaging.exportPNG('FLS_单帧_' + FLS.state.pingIndex + '.png'); break;
      case 'cursor': ui.toggleCursor(item); break;
      case 'clearlog': q('logWin').innerHTML = ''; break;
    }
  }
  ui.handleAction = handleAction;                    // 供菜单之外的调用（快捷键 / 自动化测试）
  function toggleChk(item, panelId, dispKey) {
    if (panelId) {
      var p = q(panelId);
      var now = p.style.display !== 'none';
      p.style.display = now ? 'none' : '';
      item.classList.toggle('on', !now);
    } else if (dispKey) {
      // st.display 是 FLS.P['disp.*'] 的代理（见 01-core.js），一处赋值即同步两处
      var nv = !FLS.state.display[dispKey];
      FLS.state.display[dispKey] = nv;
      item.classList.toggle('on', nv);
    }
    FLS.app && FLS.app.refreshDisplayChecks && FLS.app.refreshDisplayChecks();
  }

  function buildCollapse() {
    document.querySelectorAll('.panel-hd[data-collapse]').forEach(function (hd) {
      hd.addEventListener('click', function (e) {
        if (e.target.closest('.hd-right')) return;
        var bd = q(hd.dataset.collapse);
        if (!bd) return;
        var col = bd.classList.toggle('collapsed');
        hd.classList.toggle('collapsed', col);
        /* V3.0：底部控制台不再可折叠（它只有 96 px 高，折叠省不了多少，
         * 反而把"启动/暂停"藏起来让人找不到）。原来针对 #conBody 的那段
         * 特判随之一并删除。 */
        if (hd.dataset.collapse === 'sigBody') FLS.app && FLS.app.resizeAll();
        window.dispatchEvent(new Event('resize'));
      });
    });
  }
  /* V2.0：三维与扇形成像不再并排，改为两个视图页签各自全屏 —— 中缝拖拽条随之撤除。
     保留一个空实现，避免旧调用点（自动化测试 / 旧工程脚本）报 undefined。 */
  /* ---------------------------------------------------------- 场景资源库 */
  var THUMB = {
    flat: '<rect x="2" y="24" width="40" height="6" fill="#8a7f66"/>',
    slope: '<path d="M2 26 L42 16 L42 30 L2 30 Z" fill="#8a7f66"/>',
    ridge: '<path d="M2 28 Q22 8 42 28 L42 30 L2 30 Z" fill="#8a7f66"/>',
    trench: '<path d="M2 18 Q22 30 42 18 L42 30 L2 30 Z" fill="#8a7f66"/>',
    dunes: '<path d="M2 26 q5 -6 10 0 t10 0 t10 0 t10 0 L42 30 L2 30 Z" fill="#8a7f66"/>',
    gravel: '<path d="M2 26 l4 -3 l3 4 l4 -5 l4 4 l5 -4 l4 3 l5 -3 l4 4 l3 -2 L42 30 L2 30 Z" fill="#8a7f66"/>',
    mud: '<path d="M2 27 q10 -2 20 0 t20 0 L42 30 L2 30 Z" fill="#7d7358"/>',
    reef: '<path d="M2 28 l6 -8 l4 8 l6 -12 l5 12 l7 -6 l6 6 l6 -2 L42 30 L2 30 Z" fill="#8a7f66"/>',
    terrace: '<path d="M2 24 h10 v3 h10 v3 h10 v3 h10 L42 30 L2 30 Z" fill="#8a7f66"/>',
    fractal: '<path d="M2 24 l5 -4 l4 5 l6 -8 l5 7 l7 -5 l5 6 l8 -4 L42 30 L2 30 Z" fill="#8a7f66"/>'
  };
  var TTHUMB = {
    wreck: '<path d="M4 22 q14 -8 34 0 l-3 5 q-14 -5 -28 0 Z" fill="#8c5a3c"/><rect x="16" y="14" width="8" height="6" fill="#5a636e"/>',
    uuv: '<rect x="8" y="14" width="26" height="5" rx="2.5" fill="#d8b23a"/><path d="M34 14 l6 2.5 l-6 2.5 Z" fill="#d8b23a"/>',
    rov: '<rect x="10" y="12" width="22" height="12" rx="2" fill="#d8b23a"/><circle cx="6" cy="14" r="2.5" fill="#3a4048"/><circle cx="36" cy="14" r="2.5" fill="#3a4048"/>',
    mine: '<circle cx="21" cy="18" r="8" fill="#5a636e"/><path d="M21 10 l0 -5 M13 12 l-3 -4 M29 12 l3 -4" stroke="#8a94a0" stroke-width="1.5"/>',
    box: '<rect x="10" y="12" width="22" height="12" fill="#8a94a0"/>',
    sphere: '<circle cx="21" cy="18" r="9" fill="#8a94a0"/>',
    plane: '<rect x="8" y="16" width="26" height="4" fill="#9aa3ad"/><path d="M14 16 h14 v-4 h-14 Z" fill="#9aa3ad"/><path d="M2 18 h36" stroke="#9aa3ad" stroke-width="2"/>',
    pipeline: '<rect x="2" y="16" width="40" height="5" rx="2.5" fill="#5a636e"/>',
    caisson: '<rect x="10" y="10" width="22" height="14" fill="none" stroke="#b9b3a6" stroke-width="3"/>',
    chain: '<g fill="none" stroke="#8a94a0" stroke-width="2"><ellipse cx="8" cy="18" rx="3" ry="5"/><ellipse cx="16" cy="18" rx="5" ry="3"/><ellipse cx="24" cy="18" rx="3" ry="5"/><ellipse cx="32" cy="18" rx="5" ry="3"/></g>',
    elbow: '<path d="M8 26 L8 16 q0 -8 8 -8 h12" fill="none" stroke="#b87333" stroke-width="5"/>',
    reefblock: '<rect x="10" y="10" width="22" height="14" fill="none" stroke="#8d8579" stroke-width="2"/><path d="M10 17 h22 M21 10 v14" stroke="#8d8579" stroke-width="2"/>',
    /* ★ V3.4 新增六类目标的缩略图（44×32）。画法原则与原有条目一致：
       用 2~4 个图元把目标**最具辨识度的轮廓**勾出来（平台 = 四条腿 + 井架，
       蛙人 = 侧泳人形 + 气瓶，轮胎 = 环 + 轮辋，沉车 = 三厢侧影，
       珊瑚 = 分叉枝，鲸鱼 = 纺锤体 + 尾鳍），不追求细节。 */
    rig: '<path d="M9 28 L13 14 M35 28 L31 14 M13 14 h18" stroke="#6b7280" stroke-width="2" fill="none"/><rect x="10" y="11" width="24" height="3" fill="#5a636e"/><path d="M17 11 L20 3 h4 l3 8" fill="none" stroke="#d8b23a" stroke-width="2"/><path d="M13 18 L31 22 M13 22 L31 18" stroke="#8a94a0" stroke-width="1"/>',
    diver: '<circle cx="26" cy="11" r="3" fill="#1b2430"/><path d="M26 14 q-3 3 -1 7 l-8 5" stroke="#1b2430" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M25 15 q4 2 5 6" stroke="#1b2430" stroke-width="3.5" fill="none" stroke-linecap="round"/><rect x="16" y="13" width="4" height="9" rx="2" fill="#d8b23a"/><path d="M13 26 l-6 3" stroke="#101820" stroke-width="4" stroke-linecap="round"/>',
    tire: '<circle cx="21" cy="17" r="10" fill="none" stroke="#22242a" stroke-width="5"/><circle cx="21" cy="17" r="5" fill="none" stroke="#8a94a0" stroke-width="2"/><circle cx="21" cy="17" r="1.6" fill="#8a94a0"/>',
    car: '<path d="M5 22 L8 16 h12 l4 6 Z" fill="#2f4f6f"/><rect x="9" y="11" width="11" height="5" fill="#2f4f6f"/><path d="M10 12 h4 v4 h-4 Z M15 12 h4 v4 h-4 Z" fill="#9fc4d8"/><circle cx="10" cy="23" r="2.6" fill="#22242a"/><circle cx="27" cy="23" r="2.6" fill="#22242a"/><rect x="4" y="20" width="29" height="2.4" rx="1.2" fill="#2f4f6f"/>',
    coral: '<path d="M21 29 v-8 M21 21 l-5 -5 M21 21 l5 -5 M16 16 l-4 -4 M16 16 l1 -6 M26 16 l4 -4 M26 16 l-1 -6" stroke="#e0736a" stroke-width="2.4" fill="none" stroke-linecap="round"/><ellipse cx="21" cy="29" rx="8" ry="2.4" fill="#b9a48c"/>',
    whale: '<path d="M4 18 q9 -8 22 -3 q6 2 10 -3 q-2 5 1 7 q-5 6 -14 5 q-12 -1 -19 -6 Z" fill="#4a5560"/><path d="M36 12 l6 -4 v11 Z" fill="#4a5560"/><path d="M16 20 q4 3 8 1" stroke="#a8b2b8" stroke-width="1.6" fill="none"/><circle cx="10" cy="17" r="0.9" fill="#3a4048"/>'
  };
  /** 填充「海底地形库」缩略图网格 */
  function fillTerrainLib(grid) {
    grid.innerHTML = '';
    FLS.Terrain.LIST.forEach(function (t) {
      var d = el('div', 'lib-item');
      d.innerHTML = '<svg viewBox="0 0 44 32">' + (THUMB[t.id] || '') + '</svg><div class="lib-cap">' + t.name + '</div>';
      d.title = '点击添加：' + t.name;
      d.onclick = function () { addTerrain(t.id); };
      grid.appendChild(d);
    });
  }
  /** 填充「水下目标库」缩略图网格 */
  function fillTargetLib(grid) {
    grid.innerHTML = '';
    Object.keys(FLS.Models.TYPES).forEach(function (k) {
      var t = FLS.Models.TYPES[k];
      var d = el('div', 'lib-item');
      d.innerHTML = '<svg viewBox="0 0 44 32">' + (TTHUMB[k] || '') + '</svg><div class="lib-cap">' + t.name + '</div>';
      d.title = '点击添加：' + t.name;
      d.onclick = function () { addTarget(k); };
      grid.appendChild(d);
    });
  }

  /* ================================================================
   * V2.0 左侧七页参数栏
   *   页签顺序即"布一个场景的先后顺序"：
   *   海底地形 → 待测目标 → 海洋环境 → ROV 载体 → 发射系统 → 接收阵列 → 成像处理。
   *   前两页是「场景装配页」（库 + 已加入实例 + 选中对象属性），
   *   后五页直接渲染 SCHEMA 参数表（原「仿真参数总控面板」的内容）。
   * ================================================================ */
  function buildLeftTabs() {
    document.querySelectorAll('#paramTabs .ptab').forEach(function (b) {
      b.onclick = function () {
        document.querySelectorAll('#paramTabs .ptab').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        curTab = b.dataset.ptab;
        renderLeft();
      };
    });
    // V1.2 地形笔刷参数：控件已移到三维场景设置工具条上，元素仍在全局 DOM
    var ea = q('edAmp'), er = q('edR'), es = q('edShape');
    if (ea) {
      ea.value = FLS.scene3d.brush.amp; er.value = FLS.scene3d.brush.r; es.value = FLS.scene3d.brush.shape;
      ea.onchange = function () {
        FLS.scene3d.brush.amp = Math.max(0.05, Math.min(50, parseFloat(ea.value) || 1));
        ea.value = FLS.scene3d.brush.amp;
      };
      er.onchange = function () {
        FLS.scene3d.brush.r = Math.max(1, Math.min(200, parseFloat(er.value) || 15));
        er.value = FLS.scene3d.brush.r;
      };
      es.onchange = function () { FLS.scene3d.brush.shape = es.value; };
    }
    renderLeft();
  }
  ui.buildLeftTabs = buildLeftTabs;

  /** 按当前页签渲染左栏内容 */
  function renderLeft() {
    var box = q('paramScroll');
    if (!box) return;
    box.innerHTML = '';
    /* 打开这一页就把"未看过"小点清掉 */
    var tb = document.querySelector('#paramTabs .ptab[data-ptab="' + curTab + '"]');
    if (tb) tb.classList.remove('dirty');
    if (curTab === 'terrain') renderTerrainPage(box);
    else if (curTab === 'target') renderTargetPage(box);
    else renderParams();
    FLS.bindTips(box);
  }
  ui.renderLeft = renderLeft;

  /** 页①：海底地形设置 —— 地形库 + 已加入地形 + 选中地形属性
   *
   *  ★ V3.0：原先这里还有一栏「布尔运算（并集 / 交集 / 差集）」下拉，整个撤除，
   *    所有地形一律**叠加隆起**（取较浅，即旧口径的 union）。理由有三条：
   *    ① 前视声呐的作业对象是"海底长什么样"，而交集/差集在高程域上的物理含义很绕
   *       （"取较深"等价于凭空挖出一个与另一份地形完全无关的坑），用户解释不清；
   *    ② 三类运算让 depth() 每次要对全部地形做分支判断，是地形网格重建的热点；
   *    ③ 实测下来没人用——三个算例模板、工程文件里 op 全是 'union'。
   *    去掉分支后 buildTerrain 每点少一次 switch，地形重建更快，代码也更短。 */
  function renderTerrainPage(box) {
    /* ★ V3.2：地形页第一块改成「海底基准面」—— 全海底只有**一个**深度参数。
     * 由来：V3.1 及以前每种地形各带一个"基准深度"，10 种地形就有 10 个可独立
     * 设置的深度，叠在一起靠"取最浅"合成，于是每加一层海床都往上抬一点，
     * 平均水深与用户设定的值越走越远。现在深度只在这里给，地形层只描述形状。 */
    var g0 = el('div', 'pgroup');
    g0.appendChild(el('div', 'pgroup-hd', "海底基准面"));
    var in0 = el('div');
    in0.style.padding = '6px 6px 4px';
    in0.appendChild(propRow('海底平均深度', 'm', function (c) {
      var inp = numCtl(c, FLS.P['terr.base'], 2, 6000, 1, function (v) { ui.setBaseDepth(v, '输入'); });
      inp.dataset.pb = '1';
      inp.style.width = '72px';
    }, '整片海床的平均水深（默认 200 m）。这是全海底唯一的深度参数：' +
      '地形库里的 10 种地形只描述"相对这个基准面的起伏"，不再各自带一个深度。' +
      '改这个值 = 整片海床整体下沉/上浮，形状一点不变，也不需要重新栅格化。' +
      '载体与已布目标会同步平移，保持离底高度不变。'));
    /* ★ V3.4：海底平面尺寸（长 × 宽）—— 与「平均深度」同一组，
     * 因为三者共同决定"这片海到底多大、多深"。 */
    in0.appendChild(propRow('海底长度（东向）', 'm', function (c) {
      var inp = numCtl(c, FLS.P['terr.lenX'], 20, 4000, 10, function (v) { FLS.setP('terr.lenX', v); });
      inp.dataset.pb = '1';
      inp.style.width = '72px';
    }, 'ENU 东向的海底范围（默认 300 m）。改完立刻重烘焙散射栅格并重铺三维海床 —— ' +
      '海底跟着一起变大/变小，地形起伏的空间频率不变（地形函数本身不含尺度）。'));
    in0.appendChild(propRow('海底宽度（北向）', 'm', function (c) {
      var inp = numCtl(c, FLS.P['terr.lenY'], 20, 4000, 10, function (v) { FLS.setP('terr.lenY', v); });
      inp.dataset.pb = '1';
      inp.style.width = '72px';
    }, 'ENU 北向的海底范围（默认 300 m）。与长度独立可调，可设成狭长作业区 ' +
      '（如 600 × 150 m 的管道巡检走廊）。'));

    var srow = el('div', 'prow');
    srow.appendChild(el('div', 'plab', '深度快捷'));
    var sc = el('div', 'pctl');
    var rng = document.createElement('input');
    rng.type = 'range'; rng.min = 5; rng.max = 1000; rng.step = 1;
    rng.value = Math.min(1000, Math.max(5, FLS.P['terr.base']));
    rng.style.width = '100%';
    rng.oninput = function () { ui.setBaseDepth(parseFloat(rng.value), '滑块', true); };
    rng.onchange = function () { ui.setBaseDepth(parseFloat(rng.value), '滑块'); };
    sc.appendChild(rng);
    srow.appendChild(sc);
    srow.appendChild(el('div', 'punit', '5~1000'));
    in0.appendChild(srow);
    var mx = el('div', 'hint'); mx.id = 'baseStat';
    in0.appendChild(mx);
    g0.appendChild(in0);
    box.appendChild(g0);

    var g = el('div', 'pgroup');
    g.appendChild(el('div', 'pgroup-hd', "海底地形库"));
    var inner = el('div');
    inner.style.padding = '6px';
    /* ★ V3.1：加入地形改成"两步走"——先调属性（三维实时跟着变），再点「确认」
     * 把这一层栅格化融进海底。库里的基准深度默认 200 m。 */
    inner.appendChild(el('div', 'hint',
      "点击地形加入海底：新加入的先调属性（三维实时预览），调好后在下方点「✔ 确认并栅格化」，" +
      "它才会与已有的地形融成一张海底栅格图。" +
      "各层都是相对上面那个平均深度算起的起伏，叠多少层都不会把平均水深叠走。"));
    var grid = el('div', 'lib-grid'); grid.id = 'terrainLib';
    inner.appendChild(grid);
    /* V3.1：随机地形按钮。★ V3.4：默认场景是 100 m 平坦海底 + 5 个随机目标，
     * 想要有起伏的海底点这里，
     * 一次给出「基底 + 4 份随机起伏」并直接栅格化（不必一份份确认）。 */
    var rrow = el('div', 'boolrow');
    var rb = el('button', 'btn-mini', '🎲 随机生成 5 种地形');
    rb.title = '以当前平均水深为基准面，再叠 4 份随机起伏地形，并直接栅格化融入海底';
    rb.onclick = function () { ui.rerollTerrains(); };
    rrow.appendChild(rb);
    rrow.appendChild(el('span', 'hint', "（保留基底，重掷其余 4 份并直接融入）"));
    inner.appendChild(rrow);
    g.appendChild(inner);
    box.appendChild(g);
    fillTerrainLib(grid);

    var g2 = el('div', 'pgroup');
    g2.appendChild(el('div', 'pgroup-hd', "已加入的海底地形（点击选中编辑）"));
    var l2 = el('div');
    l2.style.padding = '5px';
    var lst = el('div', 'inst-list'); lst.id = 'libListT';
    l2.appendChild(lst);
    g2.appendChild(l2);
    /* V3.1：栅格状态行。让用户看得见"现在的海底是一张多大的图、融了几份地形"，
     * 也顺带说明为什么加地形不会越用越卡。 */
    var bs = el('div', 'hint'); bs.id = 'bakeStat';
    l2.appendChild(bs);
    g2.appendChild(l2);
    box.appendChild(g2);

    var g3 = el('div', 'pgroup');
    g3.appendChild(el('div', 'pgroup-hd', "选中地形属性"));
    var pb = el('div'); pb.id = 'propBoxT';
    g3.appendChild(pb);
    box.appendChild(g3);
    ui.refreshInstList();
    ui.onSelect();
  }

  /** 页②：待测目标设置 —— 目标库 + 已加入目标 + 选中目标属性 */
  function renderTargetPage(box) {
    var g = el('div', 'pgroup');
    g.appendChild(el('div', 'pgroup-hd', "水下目标库"));
    var inner = el('div');
    inner.style.padding = '6px';
    inner.appendChild(el('div', 'hint', "点击目标图标添加一个实例到场景（自动置于声呐前方 25 m）："));
    var grid = el('div', 'lib-grid'); grid.id = 'targetLib';
    inner.appendChild(grid);
    /* ★ V3.4：「🎲 随机布置 5 个目标」按钮。
       默认场景已经用**固定种子**布了 5 个（保证每次打开是同一张可复现的场景），
       这个按钮走真随机 —— 想换一批布点、或想看看不同布点下算法的表现时点它。 */
    var rrow = el('div', 'boolrow');
    var rb = el('button', 'btn-mini', '🎲 随机布置 5 个目标');
    rb.title = '清空现有目标，在声呐周围半径 = 量程（默认 100 m）内重新随机布置 5 个目标';
    rb.onclick = function () { ui.rerollTargets(5); };
    rrow.appendChild(rb);
    rrow.appendChild(el('span', 'hint', "（替换现有目标；默认场景是固定种子，可复现）"));
    inner.appendChild(rrow);
    g.appendChild(inner);
    box.appendChild(g);
    fillTargetLib(grid);

    var g2 = el('div', 'pgroup');
    g2.appendChild(el('div', 'pgroup-hd', "已加入的水下目标（点击选中编辑）"));
    var l2 = el('div');
    l2.style.padding = '5px';
    var lst = el('div', 'inst-list'); lst.id = 'libListO';
    l2.appendChild(lst);
    g2.appendChild(l2);
    box.appendChild(g2);

    var g3 = el('div', 'pgroup');
    g3.appendChild(el('div', 'pgroup-hd', "选中目标属性"));
    var pb = el('div'); pb.id = 'propBoxO';
    g3.appendChild(pb);
    box.appendChild(g3);
    ui.refreshInstList();
    ui.onSelect();
  }

  /** V2.2：三维场景的三个模式按钮（观察/拖动 · 笔刷编辑 · 航路打点）互斥。
   *   它们是"当前处于哪种鼠标模式"的单选指示器，任意时刻只能亮一个。
   *   此前只有笔刷按钮有人管、航路按钮靠打点状态顺带亮、观察按钮自始至终
   *   都没被取消过 —— 于是点「笔刷」后「观察/拖动」还亮着，点「航路」后
   *   三个全亮，用户根本看不出自己现在处于哪种模式。 */
  ui.syncModeBtns = function () {
    var S = FLS.scene3d; if (!S) return;
    var act = S.route && S.route.on ? 'route' : (S.brush && S.brush.on ? 'brush' : 'sc-view');
    var g = q('sceneModeGroup');
    if (!g) return;
    g.querySelectorAll('.tbtn').forEach(function (x) { x.classList.toggle('on', x.dataset.act === act); });
  };

  /** V2.2：航路相关按钮的高亮态统一同步。
      原来这份活由「航路面板列表」捎带做（refreshRouteList 里改按钮文案与 .on），
      横条删掉后必须独立出来，否则打点状态下按钮不亮、用户以为没生效。 */
  ui.syncRouteBtns = function () {
    var on = !!(FLS.scene3d && FLS.scene3d.route && FLS.scene3d.route.on);
    document.querySelectorAll('[data-act="route"]').forEach(function (x) { x.classList.toggle('on', on); });
    var lc = q('routeLoopChk'); if (lc) lc.checked = !!FLS.state.routeLoop;
  };

  /** 同步笔刷按钮文案（面板按钮 + 三维视口按钮） */
  ui.refreshBrushBtn = function () {
    var on = FLS.scene3d && FLS.scene3d.brush.on;
    /* V2.2：原先用 q('brushBtn') 找按钮，但 HTML 里从来没有这个 id（笔刷按钮是
       [data-act="brush"]），那段分支永远不执行 —— 删掉，统一走下面的属性选择器。 */
    document.querySelectorAll('[data-act="brush"]').forEach(function (x) { x.classList.toggle('on', !!on); });
  };
  var uid = 1;
  /**
   * V3.1：重新烘焙地形栅格。
   * 凡是**已融入**的地形层发生变化（确认新层 / 删除 / 改参数 / 换种子 / 载入工程）
   * 都要走这里 —— 栅格是那些层的唯一加速副本，不重算就会一直用旧海底。
   * 烘焙中心取当前 ROV 位置：栅格只有 600 m 见方，跟着载体走才覆盖得住声呐。
   */
  ui.rebake = function (reason) {
    var r = FLS.state.rov;
    var t0 = performance.now();
    /* ★ V3.2：先按当前地形组合重算「面积平均起伏」，再烘焙。
     * 两者顺序不能反：烘焙只存起伏，平均起伏由组合决定，而 compose 又要在
     * 烘焙结果上减掉它。 */
    FLS.Terrain.updateDc();
    var b = FLS.Terrain.bake(r.x, r.y);
    var ms = Math.round(performance.now() - t0);
    if (b) {
      FLS.log((reason ? reason + '：' : '') + '海底已重新栅格化 —— ' + (b.n + 1) + '×' + (b.n + 1) +
        ' 格、融入 ' + b.nSrc + ' 份地形，耗时 ' + ms + ' ms。');
    } else {
      FLS.log((reason ? reason + '：' : '') + '当前没有已确认的地形层，海底按默认 ' + FLS.P['terr.base'] + ' m 平坦砂底处理。');
    }
    return b;
  };
  /**
   * V3.1：确认一份待确认地形 —— 把它并入海底栅格图。
   * 之前它只在三维里实时预览（逐点解析求值），确认后才真正成为海底的一部分。
   */
  ui.confirmTerrain = function (t) {
    if (!t || !t.pending) return;
    t.pending = false;
    ui.rebake('地形「' + t.name + '」已确认');
    FLS.scene3d.rebuildTerrain();
    ui.refreshInstList(); ui.onSelect();
    FLS.ok('「' + t.name + '」已融入海底栅格图。');
  };
  /** 放弃一份待确认地形（不进栅格，直接丢弃） */
  ui.discardTerrain = function (t) {
    if (!t) return;
    var i = FLS.state.terrains.indexOf(t);
    if (i >= 0) FLS.state.terrains.splice(i, 1);
    if (FLS.state.sel && FLS.state.sel.id === t.id) FLS.state.sel = null;
    FLS.scene3d.rebuildTerrain();
    ui.refreshInstList(); ui.onSelect();
    FLS.log('已放弃待确认地形「' + t.name + '」（未融入海底）。');
  };
  function addTerrain(type) {
    /* ★ V3.0：布尔运算撤除，所有地形一律叠加隆起。
     * 原来第一份地形强制 union 作为"基底"、之后才按下拉框取值的那段逻辑随之作废
     * ——现在不需要判断是不是第一份，也不需要读 #boolOp（那个下拉已从 DOM 移除）。
     * 保留 `op: 'union'` 字段是为了兼容旧工程文件：loadProject 读进来的老数据
     * 可能带 intersect / diff，那边统一按 union 处理，见 99-app.js 的工程载入段。
     *
     * ★ V3.1：新加入的层一律 pending=true（待确认）。它立刻参与三维预览，
     * 但**不进栅格** —— 这样调参数时不用每改一次就重烘焙整张图，
     * 等用户点「确认」才栅格化一次。基准深度默认 200 m（地形库的 def）。 */
    var t = {
      id: 'T' + (uid++), type: type, name: FLS.Terrain.TYPES[type].name,
      params: FLS.Terrain.defaultParams(type), op: 'union', pending: true,
      bmat: 'sand', smodel: 0, rough: 0.12, seed: (Math.random() * 100000) | 0
    };
    FLS.state.terrains.push(t);
    /* ★ V3.2：新层虽然是 pending（不进栅格），但它已经参与 compose 的实时预览，
     *   所以"面积平均起伏"必须立刻重算 —— 否则预览里这一层会整体把海床抬高
     *   （min 合成是偏的），用户看到的就是"加一层就浅一点"。 */
    if (FLS.Terrain.updateDc) FLS.Terrain.updateDc();
    FLS.log('添加海底地形：' + t.name + '（待确认 · 相对 ' + FLS.P['terr.base'] +
      ' m 基准面叠加起伏 · 层偏移 ' + (t.params.bias || 0) + ' m）');
    FLS.scene3d.needTerrain = true;
    FLS.scene3d.rebuildTerrain(FLS.state.rov.x, FLS.state.rov.y);
    ui.refreshInstList();
    FLS.state.sel = { kind: 'terrain', id: t.id };
    ui.onSelect();
    /* V3.1：地形页从上到下是「库（10 个格子）+ 已加入列表 + 属性面板」三段，
     * 加一份地形后属性面板经常被顶到可视区之外，用户会以为"加了个没反应"。
     * 这里把它滚进来 —— pending 层的「确认」键就在属性面板底部，必须看得见。 */
    var pb = q('propBoxT');
    if (pb && pb.scrollIntoView) pb.scrollIntoView({ block: 'nearest' });
  }
  function addTarget(type) {
    var r = FLS.state.rov, ax = FLS.scene3d.bodyAxes(r);
    var ahead = 25;
    var e = r.x + ax.fwd[0] * ahead, n = r.y + ax.fwd[1] * ahead;
    var d = FLS.Terrain.depth(e, n);
    var T = FLS.Models.TYPES[type];
    var t = {
      id: 'O' + (uid++), type: type, name: T.name,
      pos: { e: e, n: n, u: -d + Math.max(1, (T.size || 1) * 1.5) },
      att: { yaw: (r.heading + 90) % 360, pitch: 0, roll: 0 },
      scale: 1, mat: 'steel', ts: T.ts, fres: 'mid', opts: {}
    };
    FLS.state.targets.push(t);
    FLS.log('添加目标实例：' + t.name + '（ENU: E' + t.pos.e.toFixed(1) + ' N' + t.pos.n.toFixed(1) + ' U' + t.pos.u.toFixed(1) + '，TS=' + t.ts + ' dB）');
    FLS.scene3d.syncTargets();
    ui.refreshInstList();
    FLS.state.sel = { kind: 'target', id: t.id };
    ui.onSelect();
  }
  ui.addTarget = addTarget; ui.addTerrain = addTerrain;

  /* V2.0：实例列表有三处宿主 ——
     ① #libListT      左栏「海底地形设置」页（只列地形）
     ② #libListO      左栏「待测目标设置」页（只列目标）
     三者共用同一行构造，存在的才刷新。 */
  ui.refreshInstList = function () {
    fillInst(q('libListT'), 'terrain');
    fillInst(q('libListO'), 'target');
    updateBakeStat();
    updateBaseStat();
  };
  /** V3.1：把地形栅格的现状写进「已加入的海底地形」底下。
   *  说明里给出格数与体积 —— 用户要的就是"加地形不会让数据越来越大"这个确定性。 */
  function updateBakeStat() {
    var box = q('bakeStat'); if (!box) return;
    var b = FLS.state.terrainBake;
    var np = FLS.state.terrains.filter(function (t) { return t.pending; }).length;
    if (!b) {
      box.textContent = '海底栅格：未生成（当前没有任何已确认地形，海底按默认 ' +
        (FLS.Terrain && FLS.Terrain.compose ? FLS.Terrain.compose(0, 0).d.toFixed(0) : 200) +
        ' m 平坦处理）。';
      box.className = 'hint warn-hint';
      return;
    }
    // V3.2：栅格存的是"起伏"dev（不是绝对深度 d），改平均水深不必重烘焙
    var arr = b.dev || b.d || [];
    var kb = Math.round((arr.length * 4 + b.mi.length) / 1024);
    /* ★ V3.4：栅格是矩形的（长宽独立），不再是 (n+1)² 的正方形。 */
    var wN = (b.w || (b.nx + 1)), hN = (b.h || (b.ny + 1));
    box.textContent = '海底栅格：' + wN + '×' + hN + ' 格（格距 ' +
      b.cell.toFixed(2) + ' m，覆盖 ' + (b.lenX || b.span) + '×' + (b.lenY || b.span) + ' m）· 约 ' + kb +
      ' KB · 已融入 ' + b.nSrc + ' 份地形' + (np ? ' · 另有 ' + np + ' 份待确认' : '') + '。';
    box.className = 'hint';
  }
  /** V3.2：把「设定平均水深 / 实测平均水深 / 起伏范围」写进基准面那一块。
   *  这个读数就是"平均水深守恒"当场可验的证据 —— 加几层地形之后
   *  实测均值仍应停在设定值上（残差 ≤ 数厘米，来自 25×25 采样）。 */
  function updateBaseStat() {
    var box = q('baseStat'); if (!box) return;
    if (!FLS.Terrain || !FLS.Terrain.measure) return;
    var m = FLS.Terrain.measure();
    if (!isFinite(m.min)) { box.textContent = '—'; return; }
    var dv = m.mean - m.base;
    box.innerHTML = '设定 <b>' + m.base.toFixed(1) + ' m</b> · 实测平均 <b>' + m.mean.toFixed(2) +
      ' m</b>（偏差 ' + (dv >= 0 ? '+' : '') + dv.toFixed(2) + ' m）· 起伏 ' +
      m.min.toFixed(1) + '~' + m.max.toFixed(1) + ' m（落差 ' + (m.max - m.min).toFixed(1) + ' m）' +
      /* ★ V3.4：顺带把海底范围标在这里 —— 长宽与深度是同一组"场景尺寸" */
      ' · 范围 ' + (FLS.P['terr.lenX'] | 0) + '×' + (FLS.P['terr.lenY'] | 0) + ' m';
    box.className = 'hint' + (Math.abs(dv) > 0.5 ? ' warn-hint' : '');
  }
  ui.updateBaseStat = updateBaseStat;
  /** V3.2：改变海底平均深度。
   *  ★ 这是"整片海床整体平移"，所以：不重烘焙、不改形状、不重算平均起伏 ——
   *    只把 compose 里那个加法项换掉，然后重画三维、把载体与目标一起平移。
   *    载体与目标必须跟着沉/浮，否则改完深度 ROV 会悬在半水里、目标会悬空
   *    （或埋进海床），用户还得一个个手动调回去。 */
  ui.setBaseDepth = function (v, how, live) {
    v = parseFloat(v);
    if (!isFinite(v)) return;
    if (v < 2) v = 2; else if (v > 6000) v = 6000;
    var old = parseFloat(FLS.P['terr.base']) || 200;
    var dz = v - old;
    FLS.P['terr.base'] = v;
    if (Math.abs(dz) > 1e-9) {
      /* 载体与目标按同一 delta 平移：保持离底高度 / 目标悬空高度不变 */
      FLS.P['rov.z'] = (parseFloat(FLS.P['rov.z']) || 0) - dz;
      FLS.state.rov.z -= dz;
      (FLS.state.targets || []).forEach(function (o) { if (o.pos) o.pos.u -= dz; });
      /* 预设航迹（rov.track）里的绝对高度也一起平移 */
      FLS.P['rov.track'] = String(FLS.P['rov.track'] || '').split(/[;；]/).map(function (seg) {
        var a = seg.split(/[,，\s]+/).map(parseFloat).filter(function (x) { return !isNaN(x); });
        if (a.length >= 3) a[2] = a[2] - dz;
        else if (a.length === 2) a.push(FLS.state.rov.z);
        return a.join(',');
      }).join('; ');
    }
    /* 输入框 / 滑块互相同步（滑块量程 5~1000，超出时只动数字框） */
    var pb = document.querySelector('input[data-pb]');
    if (pb && +pb.value !== v) pb.value = v;
    var rg = document.querySelector('#paramScroll input[type=range]');
    if (rg && Math.abs(+rg.value - v) < 1000) rg.value = v;
    FLS.scene3d.rebuildTerrain(FLS.state.rov.x, FLS.state.rov.y);
    FLS.scene3d.syncTargets();
    updateBaseStat();
    if (!live) {
      FLS.log('海底平均深度 = ' + v + ' m（整片海床平移 ' + (dz >= 0 ? '+' : '') + dz.toFixed(1) +
        ' m，形状不变、无需重新栅格化）；载体与目标同步平移以保持离底高度。');
      if (FLS.app && FLS.app.onParamChange) FLS.app.onParamChange('terr.base');
    }
  };
  function fillInst(box, kind) {
    if (!box) return;
    box.innerHTML = '';
    var n = 0;
    if (kind !== 'target') {
      FLS.state.terrains.forEach(function (t) { box.appendChild(instRow('terrain', t)); n++; });
    }
    if (kind !== 'terrain') {
      FLS.state.targets.forEach(function (t) { box.appendChild(instRow('target', t)); n++; });
    }
    if (!n) {
      box.appendChild(el('div', 'empty-hint',
        kind === 'terrain' ? '（空）请从上方「海底地形库」点击添加。'
          : (kind === 'target' ? '（空）请从上方「水下目标库」点击添加。'
            : '（空）请从左侧「海底地形设置 / 待测目标设置」添加对象。')));
    }
  }
  /* ★ V3.0：每一行只保留「删除」一个按钮。
   * 原先还有「显示/隐藏 👁」「锁定/解锁 🔒」「复制 ⧉」三个，全部撤除，理由：
   *   ① 显示/隐藏 —— 隐藏一个已加入的地形/目标，效果等同于删掉它，却还要在
   *      depth()、facets()、syncTargets() 里到处加 `visible !== false` 过滤；
   *      真想暂时看不见，删掉再从库里点回来更直白（库就在同一页上方，一步到位）。
   *   ② 锁定/解锁 —— 只有"防止误拖"一个用途，而本系统拖动前必须**先选中**，
   *      选中的目标本来就是用户有意操作的那个，锁反而挡住了正常操作。
   *   ③ 复制 —— 复制地形会连带复制随机种子与全部参数，得到一份"看起来一样
   *      其实参数要重新调"的副本；复制目标则简单地在 E+5/N+5 处落一个，
   *      而"在别处再放一个"从库里点一下就行，还能顺带挑不同的型号。
   * 三个按钮各自的 onclick 与数据结构里的 visible / locked 字段一并删除，
   * 相关过滤条件（30-scatter.js 的地形列表、60-scene3d.js 的手柄判定）同步去掉。 */
  function instRow(kind, t) {
    var row = el('div', 'inst-row');
    if (FLS.state.sel && FLS.state.sel.id === t.id) row.classList.add('sel');
    var icon = kind === 'terrain' ? '▤' : '◈';
    /* ★ V3.1：地形行尾加一枚状态徽标 —— 「待确认」= 只预览未入栅格，
     * 「已融入」= 已经烘进那张海底栅格图。没有这枚徽标，用户分不清
     * 自己刚加的地形到底有没有生效（三维里两种状态都看得见起伏）。 */
    var badge = '';
    if (kind === 'terrain') {
      badge = t.pending
        ? '<span class="tg-badge pend">待确认</span>'
        : '<span class="tg-badge merged">已融入</span>';
    }
    row.innerHTML = '<span style="width:14px;text-align:center;color:#7b8a9c">' + icon + '</span><span class="nm">' + t.name + '</span>' + badge;
    var dl = el('button', 'mini', '✕');
    dl.title = '删除';
    dl.onclick = function (e) {
      e.stopPropagation();
      var arr = kind === 'terrain' ? FLS.state.terrains : FLS.state.targets;
      var i = arr.indexOf(t); if (i >= 0) arr.splice(i, 1);
      if (kind === 'terrain') {
        /* 删掉的是已融入的层 → 栅格里还留着它的痕迹，必须重烘焙；
         * 删掉待确认层则不用（它本来就没进栅格），但"面积平均起伏"要重算——
         * 少了这一层，min 合成的偏置也变了。 */
        if (!t.pending) ui.rebake('删除地形「' + t.name + '」');
        else if (FLS.Terrain.updateDc) FLS.Terrain.updateDc();
        FLS.scene3d.rebuildTerrain();
      } else FLS.scene3d.syncTargets();
      if (FLS.state.sel && FLS.state.sel.id === t.id) FLS.state.sel = null;
      ui.refreshInstList(); ui.onSelect();
    };
    row.appendChild(dl);
    row.onclick = function () { FLS.state.sel = { kind: kind, id: t.id }; ui.onSelect(); ui.refreshInstList(); };
    return row;
  }

  /* ---------------------------------------------------------- 属性编辑面板
     V2.2：原先「属性」还有一处宿主（三维场景栏的横条 #propBody），那一栏已整条
          删除（与左栏重复），现在只保留左栏的两处。两处渲染同一份内容（同一份 DOM
          结构、各自独立绑定），任何一处改动都会即时体现在另一处下次刷新时。 */
  ui.onSelect = function () {
    var sel = FLS.state.sel;
    var hosts = [q('propBoxT'), q('propBoxO')].filter(Boolean);
    hosts.forEach(function (box) {
      box.innerHTML = '';
      if (!sel) { box.appendChild(el('div', 'empty-hint', "未选中对象。请在三维视图或「实例列表」中点选海底图层 / 水下目标，之后在此编辑其属性。")); return; }
      if (sel.kind === 'terrain') {
        var t = FLS.state.terrains.filter(function (x) { return x.id === sel.id; })[0];
        if (!t) { box.appendChild(el('div', 'empty-hint', "未选中对象。请在三维视图或「实例列表」中点选海底图层 / 水下目标，之后在此编辑其属性。")); return; }
        buildTerrainProps(box, t);
      } else {
        var o = FLS.state.targets.filter(function (x) { return x.id === sel.id; })[0];
        if (!o) { box.appendChild(el('div', 'empty-hint', "未选中对象。请在三维视图或「实例列表」中点选海底图层 / 水下目标，之后在此编辑其属性。")); return; }
        buildTargetProps(box, o);
      }
      FLS.bindTips(box);
    });
    /* V2.2：选中态一变就立刻刷新三维里的选中包围盒与平移手柄。
     * 渲染循环里本来有一道 lastSelId 兜底（下一帧生效），但那样选中后手柄会晚一帧
     * 才出现；实例列表里点选、目标库里新增、工程载入后恢复选中，走的都是这条路径，
     * 在这里补一次，三条入口行为一致，也不依赖渲染循环的兜底。 */
    if (FLS.scene3d && FLS.scene3d.updateSelection) FLS.scene3d.updateSelection();
  };
  /**
   * V2.2：三维拖动目标时，把新坐标实时回写到属性面板的三个数字框。
   * 只改 value、不重建面板 —— 重建会把用户正在编辑的输入框连同焦点一起丢掉，
   * 而且拖动时每帧都重建一次整个面板，光是 DOM 开销就跟不上鼠标。
   */
  ui.syncTargetPos = function (tg) {
    if (!tg) return;
    ['propBoxO', 'propBoxT'].forEach(function (id) {
      var box = q(id); if (!box) return;
      box.querySelectorAll('input[data-tp]').forEach(function (i) {
        var v = tg.pos[i.dataset.tp];
        if (v === undefined) return;
        if (document.activeElement === i) return;      // 用户正在这个框里打字，别抢
        var s = (+v).toFixed(2);
        if (i.value !== s) i.value = s;
      });
    });
  };

  function propRow(label, unit, ctlFn, help) {
    var r = el('div', 'prow');
    r.appendChild(el('div', 'plab', label));
    var c = el('div', 'pctl');
    ctlFn(c);
    r.appendChild(c);
    r.appendChild(el('div', 'punit', unit || ''));
    if (help) {
      var hq = el('div', 'helpq', '?');
      hq.dataset.tip = help;
      r.appendChild(hq);
    }
    return r;
  }
  function numCtl(c, v, min, max, step, onch) {
    var i = document.createElement('input');
    i.type = 'number'; i.value = v; i.step = step; i.min = min; i.max = max;
    i.onchange = function () {
      var nv = parseFloat(i.value);
      if (isNaN(nv)) { FLS.warn('输入非法：已恢复原值'); i.value = v; return; }
      if (min !== undefined && nv < min) { FLS.warn('超出下限 ' + min + '，已钳位'); nv = min; }
      if (max !== undefined && nv > max) { FLS.warn('超出上限 ' + max + '，已钳位'); nv = max; }
      i.value = nv; onch(nv);
    };
    c.appendChild(i);
    return i;
  }
  function selCtl(c, opts, val, onch) {
    var s = document.createElement('select');
    opts.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o.v; op.textContent = o.l; s.appendChild(op);
    });
    s.value = val;
    s.onchange = function () { onch(s.value); };
    c.appendChild(s);
    return s;
  }
  function buildTerrainProps(box, t) {
    var g = el('div', 'pgroup');
    g.appendChild(el('div', 'pgroup-hd', '海底地形：' + t.name));
    /* ★ V3.1：属性一改，三维场景要立刻跟着变 —— 这是"边填边看"的关键。
     * 已融入的层改参数还要**顺带重烘焙**（它已经是栅格的一部分了），
     * 待确认的层只重画即可（它本来就没进栅格，逐点解析求值天然是实时的）。 */
    function applyChange(why) {
      if (t.pending) {
        /* 待确认层不进栅格，但它参与"面积平均起伏"的统计 —— 平均水深守恒
         * 必须把预览中的层也算进去，否则一确认整片海床会跳一下。 */
        FLS.Terrain.updateDc();
        FLS.scene3d.rebuildTerrain();
        updateBaseStat();
        return;
      }
      ui.rebake(why);
      FLS.scene3d.rebuildTerrain();
    }
    /** 键盘/微调按钮每敲一次就来一次 input 事件，地形重建不能每次都做。
     *  150 ms 防抖：连续输入时只在停手后重建一次，肉眼仍是"跟着变"。 */
    function liveNum(c, v, min, max, step, setv, tip) {
      var inp = numCtl(c, v, min, max, step, function (nv) { setv(nv); applyChange(tip); });
      var tm = null;
      inp.addEventListener('input', function () {
        clearTimeout(tm);
        tm = setTimeout(function () {
          var nv = parseFloat(inp.value);
          if (isNaN(nv)) return;
          if (min !== undefined && nv < min) nv = min;
          if (max !== undefined && nv > max) nv = max;
          setv(nv); applyChange(tip);
        }, 150);
      });
      return inp;
    }
    var T = FLS.Terrain.TYPES[t.type];
    T.params.forEach(function (p) {
      g.appendChild(propRow(p.l, p.u, function (c) {
        liveNum(c, t.params[p.k], p.min, p.max, p.step || 0.1, function (v) {
          t.params[p.k] = v;
        }, '修改「' + t.name + '」的' + p.l);
      }, '地形参数：' + p.l + '（范围 ' + p.min + '~' + p.max + ' ' + (p.u || '') +
        '）。改动即时反映到三维场景；已融入的地形会同步重新栅格化。'));
    });
    /* ★ V3.0：原「布尔运算」下拉撤除（见 renderTerrainPage 处的说明）。
     * 所有地形一律叠加隆起（取较浅），属性面板里不再提供这一项。 */
    g.appendChild(propRow('底质类型', '', function (c) {
      selCtl(c, FLS.Models.BOTTOM_MATS.map(function (m) { return { v: m.id, l: m.name }; }), t.bmat, function (v) {
        t.bmat = v;
        /* 底质是随地形一起栅格化的（每个格点记一份底质），改它必须重烘焙 */
        if (!t.pending) ui.rebake('修改「' + t.name + '」的底质');
      });
    }, '决定朗伯散射系数 μ：泥 −30 dB、砂 −25 dB、砾石 −20 dB、岩石 −18 dB、珊瑚 −16 dB。底质会随地形一起烘进栅格图。'));
    g.appendChild(propRow('散射模型', '', function (c) {
      selCtl(c, FLS.Models.SCAT_MODELS.map(function (m) { return { v: m.id, l: m.name }; }), t.smodel, function (v) {
        t.smodel = parseInt(v);
        if (!t.pending) ui.rebake('修改「' + t.name + '」的散射模型');
      });
    }, '① 朗伯散射模型（Lambert）：σ₀=μ·cos²θᵢ；② 基尔霍夫粗糙界面模型（Biot/Kirchhoff）：含均方根坡度 s 的镜向散射；③ 经验海底散射公式：含掠射角增强项；④ 掠射指数律：σ₀=μ·sinθ_g（θ_g 为掠射角）。前视声呐作业掠射角只有 5°~30°，朗伯的 sin² 在这里衰减过陡，故算例模板默认用④。'));
    g.appendChild(propRow('粗糙度（均方根坡度）', '', function (c) {
      liveNum(c, t.rough, 0.005, 1, 0.005, function (v) { t.rough = v; },
        '修改「' + t.name + '」的粗糙度');
    }, '粗糙界面模型的均方根坡度 s，典型 0.05~0.3（平坦泥质取小值，碎石/岩礁取大值）。'));
    g.appendChild(propRow('随机种子', '', function (c) {
      liveNum(c, t.seed, 0, 999999, 1, function (v) { t.seed = v | 0; },
        '修改「' + t.name + '」的随机种子');
    }, '随机地形（碎石 / 岩礁 / 分形）的随机种子，改变种子可生成不同地形样本。'));

    /* ---- V3.1：确认 / 放弃，或已融入状态 ---- */
    var act = el('div', 'tg-confirm');
    if (t.pending) {
      act.classList.add('pending');
      /* 这里的格数/体积一律现算 —— 栅格尺寸随量程自适应（见 Terrain.bakeGeom），
         写死数字必然与现实脱节。 */
      var gm = FLS.Terrain.bakeGeom ? FLS.Terrain.bakeGeom() : { n: 217, cell: 1.2 };
      var kb = Math.round(((gm.n + 1) * (gm.n + 1) * 5) / 1024);
      var hint = el('div', 'hint',
        '这份地形还在<b>预览</b>状态：三维里看得见，但尚未成为海底的一部分。' +
        '调好后点「确认」，它与已有的地形合并栅格化成一张海底深度图（' + (gm.n + 1) + '×' +
        (gm.n + 1) + ' 格、格距 ' + gm.cell.toFixed(2) + ' m、约 ' + kb + ' KB，' +
        '此后引擎按栅格查表，加再多地形也不会越跑越卡）。');
      hint.style.marginBottom = '6px';
      act.appendChild(hint);
      var bOk = el('button', 'btn-ok', '✔ 确认并栅格化');
      bOk.title = '把这份地形融入海底栅格图';
      bOk.onclick = function () { ui.confirmTerrain(t); };
      var bNo = el('button', 'btn-mini', '✕ 放弃');
      bNo.title = '丢弃这份待确认地形';
      bNo.onclick = function () { ui.discardTerrain(t); };
      var row2 = el('div', 'tg-crow');
      row2.appendChild(bOk); row2.appendChild(bNo);
      act.appendChild(row2);
    } else {
      var b = FLS.state.terrainBake;
      act.appendChild(el('div', 'hint',
        '已融入海底栅格图' + (b ? '（当前共 ' + b.nSrc + ' 份，' + (b.n + 1) + '×' + (b.n + 1) + ' 格）' : '') +
        '。改动属性会自动重新栅格化。'));
      var bRb = el('button', 'btn-mini', '⟳ 重新栅格化');
      bRb.title = '按当前全部已确认地形重算一遍栅格';
      bRb.onclick = function () { ui.rebake('手动重新栅格化'); FLS.scene3d.rebuildTerrain(); ui.refreshInstList(); };
      act.appendChild(bRb);
    }
    g.appendChild(act);
    box.appendChild(g);
  }
  function buildTargetProps(box, o) {
    var g = el('div', 'pgroup');
    g.appendChild(el('div', 'pgroup-hd', '水下目标：' + o.name));
    /* ★ V2.2：位置三个输入框打上 data-tp，供三维拖动时实时回写。
       以前三维里挪目标只能靠改这三个数字（改完还得靠想象猜它落在哪），
       现在拖手柄会反过来刷新这三个框，两套操作互为镜像。 */
    [['e', '东向 E', 'm'], ['n', '北向 N', 'm'], ['u', '天向 U', 'm']].forEach(function (f) {
      g.appendChild(propRow(f[1], f[2], function (c) {
        var ctl = numCtl(c, o.pos[f[0]], -2000, 2000, 0.5, function (v) {
          o.pos[f[0]] = v; FLS.scene3d.syncTargets();
        });
        ctl.dataset.tp = f[0];
      }, 'ENU 坐标，海面 U=0，水下为负（深度 = −U）。选中目标后也可在三维视口里'
        + '直接拖动：红轴=E、绿轴=N、蓝轴=U，拖目标本体为水平面内平移。'));
    });
    [['yaw', '航向角', '°'], ['pitch', '俯仰角', '°'], ['roll', '横滚角', '°']].forEach(function (f) {
      g.appendChild(propRow(f[1], f[2], function (c) {
        numCtl(c, o.att[f[0]], -180, 360, 1, function (v) { o.att[f[0]] = v; FLS.scene3d.syncTargets(); });
      }, '目标姿态角，影响面元朝向与目标回波闪烁特性。'));
    });
    g.appendChild(propRow('尺寸缩放', '×', function (c) {
      numCtl(c, o.scale, 0.05, 20, 0.05, function (v) { o.scale = v; FLS.scene3d.syncTargets(); });
    }, '整体缩放；目标强度按 TS = TS设置 + 20lg(缩放) 变化。'));
    g.appendChild(propRow('目标材料', '', function (c) {
      selCtl(c, FLS.Models.MATERIALS.map(function (m) { return { v: m.id, l: m.name }; }), o.mat, function (v) {
        o.mat = v; o.ts = FLS.Models.tsOf(v); ui.onSelect();
      });
    }, '材料决定默认目标强度 TS（钢 −15 dB、铝 −17、玻璃钢 −23、橡胶 −29、空腔充水 −21、空腔充气 −8）。'));
    g.appendChild(propRow('目标强度 TS', 'dB', function (c) {
      numCtl(c, o.ts, -60, 30, 1, function (v) { o.ts = v; });
    }, '目标强度 TS = 10lg(σ/1m²)，即后向散射截面（dB re 1 m²）。'));
    g.appendChild(propRow('面元划分精度', '', function (c) {
      selCtl(c, [{ v: 'low', l: '低（≈120 面元）' }, { v: 'mid', l: '中（≈400 面元）' }, { v: 'high', l: '高（≈1400 面元）' }], o.fres, function (v) { o.fres = v; });
    }, '目标表面散射面元数量，面元越多闪烁与几何细节越真实、计算量越大。'));
    var btns = el('div', 'prow');
    var bc = el('div', 'pctl');
    var b1 = el('button', 'btn-mini', '置于声呐前方 25 m');
    b1.onclick = function () {
      var r = FLS.state.rov, ax = FLS.scene3d.bodyAxes(r);
      o.pos.e = r.x + ax.fwd[0] * 25; o.pos.n = r.y + ax.fwd[1] * 25;
      o.pos.u = -FLS.Terrain.depth(o.pos.e, o.pos.n) + 2;
      FLS.scene3d.syncTargets(); ui.onSelect();
    };
    var b2 = el('button', 'btn-mini', '贴合海底');
    b2.onclick = function () {
      o.pos.u = -FLS.Terrain.depth(o.pos.e, o.pos.n) + 1;
      FLS.scene3d.syncTargets(); ui.onSelect();
    };
    bc.appendChild(b1); bc.appendChild(b2);
    btns.appendChild(el('div', 'plab', '快捷'));
    btns.appendChild(bc);
    g.appendChild(btns);
    box.appendChild(g);
  }

  /* ---------------------------------------------------------- 参数面板
     V2.0：页签绑定统一由 buildLeftTabs() 完成（页签元素 class 由 .subtab 改为 .ptab）。
     这里只保留一个入口，供语言切换后整体重建。 */
  function buildParamPanel() { buildLeftTabs(); }
  ui.buildParamPanel = buildParamPanel;
  /**
   * 把已渲染的参数控件值同步回 FLS.P（不触发 onchange，避免回调递归）。
   * 场景：主题按钮、菜单开关等路径直接改了 FLS.P，
   * 参数面板上的下拉框还停在旧值，看上去像「改了没生效」。
   */
  ui.syncParamControls = function () {
    var box = q('paramScroll');
    if (!box) return;
    box.querySelectorAll('[data-calc]').forEach(function (e) {
      var t = FLS.dvText ? FLS.dvText(e.dataset.calc) : '';
      if (e.value !== t) e.value = t;
    });
    box.querySelectorAll('[data-pk]').forEach(function (e) {
      var k = e.dataset.pk, v = FLS.P[k];
      if (v === undefined) return;
      if (e.type === 'checkbox') { e.checked = !!v; return; }
      var meta = FLS.PMETA[k];
      var sv = (meta && meta.dp !== undefined && isFinite(v)) ? (+v).toFixed(meta.dp) : String(v);
      if (e.value !== sv) e.value = sv;
    });
  };

  /**
   * ★ V3.2：参数联动关系面板。
   * 三页（发射 / 接收 / 成像）共用一块，内容全部来自 FLS.dv（见 01-core.js 的 derive）。
   * 上面是"中间量 → 结论"的推导链，下面是自动查出的一致性矛盾。
   * 这样设计的原因：前视声呐的分辨率、波束数、覆盖范围之间的关系不是一句话能说清的，
   * 与其在帮助里写三段说明，不如把中间量当场摆出来 —— 用户改一个数，
   * 下面整条链一起动，改错了一眼就看得出是哪一环断了。
   */
  ui.refreshLinkPanel = function () {
    var box = q('linkPanel'); if (!box) return;
    var v = FLS.dv || {};
    if (!v.n) { box.textContent = '（尚未初始化）'; return; }
    /* 三列宽度写死在 CSS（34/28/38%）并全部 nowrap：
     * 面板只有约 290 px 宽，早先把"由什么决定"写成整句，第一列被挤成 3 行、
     * 表格高得像一根面条。现在第一列只用短名 + 符号，第三列只留公式本体，
     * 具体数字（如 M·d = 64×1.85 mm）挪到 title 提示里。 */
    function row(a, b, c, tip) {
      return '<tr title="' + (tip || '').replace(/"/g, '') + '"><td class="lk-n">' + a +
        '</td><td class="lk-v">' + b + '</td><td class="lk-d">' + c + '</td></tr>';
    }
    var h = '<table class="link-tb"><tr><th>量</th><th>值</th><th>由什么定</th></tr>';
    h += row('波长 λ', v.lamMm.toFixed(3) + ' mm', 'c/f₀',
      'c = ' + v.c.toFixed(0) + ' m/s（当前深度的声速）');
    h += row('孔径 D', v.Dmm.toFixed(1) + ' mm', 'M·d',
      v.M + ' 元 × ' + v.dmm.toFixed(2) + ' mm 间距 = ' + v.Dmm.toFixed(1) + ' mm');
    h += row('阵列开角 θ₃', v.th3.toFixed(2) + '°', '0.886λ/D', '法向、均匀加权');
    h += row('系数 k', v.k.toFixed(2), '手动 0.5~0.7', '波束角取 −3dB 开角的几分之一');
    h += row('设计波束角 Δθ', v.dth.toFixed(3) + '°', 'k·θ₃', 'Δθ = ' + v.k.toFixed(2) + ' × ' + v.th3.toFixed(3) + '°');
    h += row('波束数 N', '<b>' + v.n + '</b>', '2^⌈log₂(扇角/Δθ)⌉',
      '扇角 ' + v.sector + '° ÷ ' + v.dth.toFixed(3) + '° = ' + v.nRaw.toFixed(1) + ' → 向上取到 2 的幂 = ' + v.n);
    h += row('实际波束角', v.dthAct.toFixed(3) + '°', '扇角/N',
      v.sector + '° / ' + v.n + ' = ' + v.dthAct.toFixed(3) + '°（≤ 设计值，故不过采样）');
    h += row('实际系数', v.kAct.toFixed(2), '实际/θ₃', '应落在 0.5~0.7 之间');
    h += row('阵元垂直长 L_v', v.Lv.toFixed(1) + ' mm', '手动', '单个接收阵元沿垂直方向的长度');
    h += row('阵元垂直角 θ_v', '<b>' + v.vOpen.toFixed(1) + '°</b>', '2·arcsin(0.443λ/L_v)',
      '长度 → 开角，一一对应，不可反向独立设置');
    /* ★ V3.3：发射侧改成"层数 → 垂直开角"的正向派生，并把它的物理后果（近场盲区）
       一起摆出来 —— 否则用户只知道开角变了，不知道图像上哪一段会黑掉。 */
    h += row('发射叠层 N_t', v.Mt + ' 层', '手动', '垂直方向串联的换能器层数，层距固定 λ/2');
    h += row('发射垂直角', '<b>' + v.vTx.toFixed(1) + '°</b>', '2·arcsin(0.886/N_t)',
      '只由层数决定，与频率无关：5 层 20.4°、8 层 12.7°、3 层 34.3°');
    h += row('近场盲区', v.blind.toFixed(1) + ' m', '离底/tan(θ_v/2)',
      '离底 ' + v.alt.toFixed(1) + ' m；这个距离以内扇面还没照到海底');
    h += row('距离分辨率', (v.dR * 100).toFixed(2) + ' cm', 'c/(2B)', 'B = 发射带宽');
    h += row('脉压增益', v.gainPC.toFixed(1) + ' dB', '10lg(B·T)',
      'BT = ' + v.BT.toFixed(1) + '（带宽 × 脉宽）；仅开启匹配滤波时兑现');
    h += row('基带采样 fs/K', (v.fsbb / 1000).toFixed(1) + ' kHz', 'K=⌊fs/2.5B⌋',
      '标称 fs = ' + (v.fs / 1000).toFixed(0) + ' kHz，抽取因子 K = ' + v.Kdec +
      '；它落在 [2.5B, 5B) 内，所以再提高 fs 不会改变图像');
    h += row('不模糊距离', v.rUn.toFixed(1) + ' m', 'c·PRP/2',
      '当前量程 ' + (FLS.P['alg.rmax'] | 0) + ' m（量程不得超过它）');
    h += row('俯仰建议', '±' + v.tiltMax.toFixed(1) + '°', '±θ_v/2',
      'θ_v/2 是发射指向性的半宽：俯仰超过它，扇面下沿就转出了照亮的锥体，远端开始熄灭');
    h += row('每单元采样点', v.sampPerBin.toFixed(1), '(Δr·2/c)·fsbb',
      v.nBin + ' 个距离单元；≥1 即可，越大表示径向网格还能再细');
    h += '</table>';
    /* 波束数那一行是这次改动的核心，把"除 → 取整"的算式单独摆一行 */
    var ex = Math.log(Math.max(1.0001, v.nRaw)) / Math.LN2;
    h += '<div class="link-eq">N = 2<sup>⌈log₂(扇角/Δθ)⌉</sup> = 2<sup>⌈' +
      ex.toFixed(2) + '⌉</sup> = <b>' + v.n + '</b></div>';
    /* ★ V3.3：接收噪底的构成。接收页的「灵敏度 / 前置增益 / 采样位数 / 通道噪声」
       四个参数改的正是这四项的相对比例 —— 图像上看不出来时，看这一行。 */
    if (v.nfrac) {
      var pc = function (x) { return (x * 100).toFixed(x < 0.01 ? 2 : 0) + '%'; };
      h += '<div class="link-eq" title="接收噪底 = 环境 + 自噪声 + 通道电噪声 + 量化。' +
        'ADC 满量程折到声学端 ' + (v.fsDb || 0).toFixed(0) + ' dB（由灵敏度与前置增益决定）">' +
        '噪底 ' + (v.noiseDb ? v.noiseDb.total.toFixed(1) : '—') + ' dB：' +
        '环境 ' + pc(v.nfrac.amb) + ' / 自噪声 ' + pc(v.nfrac.self) +
        ' / 通道 ' + pc(v.nfrac.chan) + ' / 量化 ' + pc(v.nfrac.quant) + '</div>';
    }
    if (v.warns && v.warns.length) {
      h += '<div class="link-warn"><b>⚠ 一致性检查</b><ul style="margin:4px 0 0 16px;padding:0">';
      v.warns.forEach(function (w) { h += '<li>' + w + '</li>'; });
      h += '</ul></div>';
    } else {
      h += '<div class="link-ok">✓ 未发现参数矛盾</div>';
    }
    box.innerHTML = h;
  };

  /** 主题按钮文案与菜单勾选的即时同步 */
  ui.refreshThemeBtn = function () {
    var b = q('themeBtn');
    if (b) b.textContent = FLS.Theme.isDark() ? "浅色" : "深色";
    var mi = document.querySelector('.menu-item[data-act="theme"]');
    if (mi) mi.classList.toggle('on', FLS.Theme.isDark());
    ui.syncParamControls();
  };

  function renderParams() {
    // V2.0：前两页是场景装配页，走 renderLeft() 分支，不渲染 SCHEMA
    if (curTab === 'terrain' || curTab === 'target') { renderLeft(); return; }
    var box = q('paramScroll');
    box.innerHTML = '';
    (FLS.SCHEMA[curTab] || []).forEach(function (grp) {
      var g = el('div', 'pgroup');
      g.appendChild(el('div', 'pgroup-hd', grp.t));
      grp.rows.forEach(function (r) {
        if (!r.k && r.k !== 0) return;
        var row = el('div', 'prow');
        row.dataset.k = r.k;
        row.appendChild(el('div', 'plab', r.l));
        var c = el('div', 'pctl');
        var v = FLS.P[r.k];
        if (r.t === 'num') {
          var inp = document.createElement('input');
          inp.type = 'number';
          // 按声明的 dp 格式化：ROV 位置这类会被运动积分写成一长串小数，
          // 直接塞进 132 px 宽的输入框会被截断，看上去像乱码。
          var fmt = function (x) { return (r.dp !== undefined && isFinite(x)) ? (+x).toFixed(r.dp) : x; };
          inp.value = fmt(v);
          inp.step = r.step || 1;
          if (r.min !== undefined) inp.min = r.min;
          if (r.max !== undefined) inp.max = r.max;
          inp.onchange = function () {
            /* V2.2：钳位规则统一收敛到 FLS.setP（此前这里与核心各写一份，
               两处规则不同步时会出现「手改被钳位、载入工程没被钳位」）。 */
            var raw = parseFloat(inp.value);
            var nv = FLS.setP(r.k, inp.value, true);
            if (nv === null) { FLS.warn('参数「' + r.l + '」输入非法，已恢复原值。'); inp.value = fmt(v); return; }
            if (nv !== raw) {
              FLS.warn('参数「' + r.l + '」超出允许范围' +
                (r.min !== undefined ? ' [' + r.min + ', ' + r.max + ']' : '') + r.u + '，已钳位为 ' + nv + r.u + '。');
            }
            inp.value = fmt(nv);
            FLS.app.onParamChange(r.k);
          };
          inp.dataset.pk = r.k;
          c.appendChild(inp);
        } else if (r.t === 'calc') {
          /* ★ V3.2：派生量（由别的参数算出来的）用只读框显示。
           *  不给可编辑控件是刻意的：这个量没有自己的自由度，
           *  能改它就等于允许"长度 20 mm 却开角 120°"这种自相矛盾的配置。 */
          var co = document.createElement('input');
          co.type = 'text'; co.readOnly = true; co.className = 'pcalc';
          co.value = FLS.dvText ? FLS.dvText(r.k) : '—';
          co.dataset.calc = r.k;
          co.title = '自动计算，不可直接修改（见右侧 ? 说明）';
          c.appendChild(co);
        } else if (r.t === 'sel') {
          var s = document.createElement('select');
          r.o.forEach(function (o) { var op = document.createElement('option'); op.value = o.v; op.textContent = o.l; s.appendChild(op); });
          s.value = v;
          s.onchange = function () { FLS.setP(r.k, s.value); FLS.app.onParamChange(r.k); };
          s.dataset.pk = r.k;
          c.appendChild(s);
        } else if (r.t === 'chk') {
          var cb = document.createElement('input');
          cb.type = 'checkbox'; cb.checked = !!v;
          cb.onchange = function () { FLS.setP(r.k, cb.checked); FLS.app.onParamChange(r.k); };
          cb.dataset.pk = r.k;
          c.appendChild(cb);
        } else if (r.t === 'txt') {
          var ti = document.createElement('input');
          ti.type = 'text'; ti.value = v === undefined ? '' : v;
          ti.onchange = function () { FLS.setP(r.k, ti.value); FLS.app.onParamChange(r.k); };
          ti.dataset.pk = r.k;
          c.appendChild(ti);
        } else if (r.t === 'btn') {
          var b = document.createElement('button');
          b.className = 'btn-mini'; b.textContent = r.btn;
          b.onclick = function () { if (r.k === 'rov.keys') FLS.Rov.editKeys(); };
          c.appendChild(b);
        }
        row.appendChild(c);
        row.appendChild(el('div', 'punit', r.u || ''));
        if (r.h) {
          var hq = el('div', 'helpq', '?');
          hq.dataset.tip = r.h;
          row.appendChild(hq);
        }
        g.appendChild(row);
      });
      box.appendChild(g);
    });
    /* ★ V3.2：发射 / 接收 / 成像三页底部统一挂一块「参数联动关系」——
     * 把 λ、孔径、θ₃dB、波束角、波束数这些中间量摊开给人看，
     * 并把互相矛盾的地方直接列出来。此前这些量只存在于各人脑子里，
     * 面板上只能看到"输入 181 个波束"，看不出它对不对。 */
    if (curTab === 'tx' || curTab === 'rx' || curTab === 'alg') {
      var lp = el('div', 'pgroup');
      lp.appendChild(el('div', 'pgroup-hd', "参数联动关系（自动推导）"));
      var lb = el('div'); lb.id = 'linkPanel';
      lb.style.cssText = 'padding:6px 8px;font-size:11px;line-height:1.7;';
      lp.appendChild(lb);
      box.appendChild(lp);
      ui.refreshLinkPanel();
    }
    // 算法说明
    if (curTab === 'alg') {
      var info = el('div', 'pgroup');
      info.appendChild(el('div', 'pgroup-hd', "算法说明"));
      var d = el('div');
      d.style.cssText = 'padding:6px 8px;font-size:11px;line-height:1.7;color:#33414f';
      d.innerHTML = ALG_DESC[FLS.P['alg.method']] || '';
      info.appendChild(d);
      box.appendChild(info);
    }
    FLS.bindTips(box);
  }
  ui.renderParams = renderParams;

  var ALG_DESC = {
    cbf: '<b>常规波束形成 CBF（Delay-and-Sum）</b><br>对每个像素（距离 r、方位 θ）按真实双程时延 τ<sub>m</sub>=(r+R<sub>m</sub>)/c 取各阵元样本，补偿聚焦相位 e<sup>−j2πf<sub>c</sub>(r−R<sub>m</sub>)/c</sup> 后求和：y=(1/M)Σw<sub>m</sub>b<sub>m</sub>(τ<sub>m</sub>)e<sup>−j2πf<sub>c</sub>T<sub>m</sub></sup>。<br>优点：稳健、无需协方差估计；缺点：分辨率受孔径限制（θ<sub>3dB</sub>≈0.886λ/(Md cosθ)），旁瓣由加权窗决定。',
    mvdr: '<b>MVDR（最小方差无畸变响应，Capon）</b><br>w = R<sup>−1</sup>a /(a<sup>H</sup>R<sup>−1</sup>a)，在保持观察方向单位增益的约束下最小化输出功率。<br>优点：窄主瓣、自适应置零干扰；缺点：对失配与有限快拍敏感，需对角加载。协方差由距离窗内 K≈1.5M 个快拍 + 空间平滑估计，对角加载基准取该距离处的阵元复噪声功率 ε=10<sup>dl/10</sup>σ<sub>n</sub><sup>2</sup>·TVG<sup>2</sup>（不以协方差迹为基准，否则强目标下加载会淹没信号子空间）。',
    lcmv: '<b>LCMV（线性约束最小方差，Frost）</b><br>w = R<sup>−1</sup>C(C<sup>H</sup>R<sup>−1</sup>C)<sup>−1</sup>f，可同时施加多个线性约束（观察方向无畸变 + 辅助方向单位增益/置零）。<br>用途：宽波束保形、指定方位干扰置零、多方向响应控制。',
    esb: '<b>ESB（特征空间波束形成，Feldman–Griffiths 投影法）</b><br>把导向矢量投影到信号子空间：w = U<sub>s</sub>U<sub>s</sub><sup>H</sup>a = Σ<sub>k&lt;K</sub>v<sub>k</sub>(v<sub>k</sub><sup>H</sup>a)，剔除噪声子空间分量后加权求和。<br>优点：低信噪比与导向矢量失配（阵元误差、声速误差、近场模型偏差）下比 MVDR 稳健；需信源数 K（本系统采用空间平滑 + Jacobi 特征分解，每个距离段只分解一次）。<br>注意：不做 1/λ<sub>k</sub> 加权、不按 ‖w‖ 归一化——前者会抬高无回波区噪声，后者会使投影系数被约掉、输出与角度无关。',
    bp: '<b>BP（后向投影，合成孔径类）</b><br>逐像素按精确双程时延把阵元时域信号投影到成像网格，并沿载体航迹做非相干孔径累积。<br>优点：无远场近似、沿航迹方位分辨率不断提升；缺点：需多帧累积（本系统显示累积帧数）。',
    pci: '<b>PCI（相位相干成像）</b><br>把阵列分成 4 个子孔径，用子孔径波束的相干度 CF=|Σb<sub>k</sub>|/Σ|b<sub>k</sub>| 对 CBF 结果加权：I = |y<sub>CBF</sub>|·CF<sup>γ</sup>。<br>优点：显著抑制混响旁瓣与栅瓣泄漏，突出点目标与边缘。',
    acw: '<b>ACW（自适应相干加权）</b><br>MVDR 自适应输出 × 相干因子 CF<sup>p</sup> 的联合加权，兼顾自适应旁瓣抑制与相位相干性筛选。',
    music: '<b>MUSIC（多信号分类，超分辨）</b><br>P(θ)=1/‖E<sub>n</sub><sup>H</sup>a(θ)‖²=1/Σ<sub>k≥K</sub>|v<sub>k</sub><sup>H</sup>a(θ)|<sup>2</sup>，利用噪声子空间与导向矢量正交性实现超分辨测向。<br>要求：信源数 K 正确、空间平滑去相干；输出为空间谱（dB 相对显示），不作绝对电平解释。<br>实现要点：特征类算法的协方差快拍窗按「复用跨度 × 每单元样本数 + 回波展宽」自适应加宽，保证同一段内各距离单元使用的 R 都含有该处回波——窗过窄会让多数单元的信号子空间被噪声占据，方位谱完全发散。'
  };

  /* ---------------------------------------------------------- 控制台 */
  function buildConsole() {
    q('btnStart').onclick = function () { FLS.app.start(); };
    q('btnPause').onclick = function () { FLS.app.pause(); };
    q('btnStep').onclick = function () { FLS.app.step(); };
    q('btnReset').onclick = function () { FLS.app.reset(); };
    q('simMode').onchange = function () { FLS.state.simMode = q('simMode').value; };
    q('quality').onchange = function () {
      FLS.state.quality = q('quality').value;
      FLS.app.onParamChange('quality');
      FLS.log('仿真精度档切换为：' + q('quality').selectedOptions[0].textContent);
    };
    q('prfScale').onchange = function () { FLS.state.timeScale = parseFloat(q('prfScale').value); };
    FLS.state.simMode = 'continuous'; FLS.state.timeScale = 1;
    paintMetrics([]);                                  // 未出帧前先铺占位骨架
  }
  /* 指标标签固定 14 项：未出帧时也要把骨架画出来，否则底栏中段是一大片空白。
     标签控制在 6 个汉字以内 —— 底栏一格约 120 px，长标签（如「波束数 / 距离单元」）
     会连同数值一起被 ellipsis 截断，反而看不出是哪一项。 */
  /* V2.2：指标标签改为双语对象（原先是纯中文字符串数组，切 EN 后底栏 14 个标签
     仍是中文，与右侧英文数值混在一起）。顺序必须与 updateMetrics 的值数组一致。 */
  var METRIC_LABELS = [
    '脉冲序号', '仿真时间',
    '帧率', '单帧耗时',
    '位置', '深度',
    '姿态角', '散射面元',
    '最大回波', '阵元信噪比',
    '成像网格', '采样率',
    '声速', '波长'
  ];
  function paintMetrics(vals) {
    var box = q('metrics');
    // 每项包一层 .mi（标签 + 数值），CSS 端用 auto-fill 网格自适应多列排布
    var h = '';
    for (var i = 0; i < METRIC_LABELS.length; i++) {
      h += '<div class="mi"><span class="k">' + METRIC_LABELS[i] + '</span>' +
        '<span class="v">' + (vals[i] === undefined ? '--' : vals[i]) + '</span></div>';
    }
    box.innerHTML = h;
  }
  ui.updateMetrics = function (m) {
    paintMetrics([
      m.ping, m.t.toFixed(1) + ' s',
      m.fps.toFixed(1) + ' fps', m.cost.toFixed(0) + ' ms',
      'E' + m.x.toFixed(1) + ' N' + m.y.toFixed(1),
      m.depth.toFixed(1) + ' m',
      m.h.toFixed(0) + '°/' + m.p.toFixed(0) + '°/' + m.r.toFixed(0) + '°',
      m.nScat,
      m.echoDb.toFixed(1) + ' dB',
      m.snr.toFixed(1) + ' dB',
      m.nBeam + ' / ' + m.nBin,
      (m.fsbb / 1000).toFixed(1) + ' kHz',
      m.c.toFixed(1) + ' m/s', (m.lam * 1000).toFixed(2) + ' mm'
    ]);
  };

  /* ---------------------------------------------------------- 信号观测面板 */
  function buildSignalPanel() {
    var sel = q('chanSel');
    sel.onchange = function () { FLS.app.onParamChange('chan'); };
    q('sigType').onchange = function () { FLS.app.onParamChange('sig'); };
    q('sigPrePost').onchange = function () { FLS.app.onParamChange('sig'); };
    /* ★ V3.4：观测点切换只改"纵坐标怎么读"，不需要重算，走与曲线类型同一条路 */
    var pb = q('sigProbe');
    if (pb) pb.onchange = function () { FLS.app.onParamChange('sig'); };
    FLS.SigPlot.init();
  }
  ui.fillChannels = function (M) {
    var sel = q('chanSel');
    var cur = sel.value;
    sel.innerHTML = '';
    for (var i = 0; i < M; i++) {
      var o = document.createElement('option');
      o.value = i; o.textContent = 'CH' + i;
      sel.appendChild(o);
    }
    if (cur !== '' && cur < M) sel.value = cur;
  };

  /* ---------------------------------------------------------- 色标
     V2.1：顶栏「色标选择」菜单已撤除。声图色标在「前视声呐成像」视图栏，
     海底深度色标在「三维场景设置」视图栏，两套独立、就近修改。 */
  ui.toggleFreeze = function (item) {
    FLS.state.freeze = !FLS.state.freeze;
    item.classList.toggle('on', FLS.state.freeze);
    FLS.log(FLS.state.freeze ? '成像视图已冻结当前帧。' : '成像视图恢复实时刷新。');
  };
  ui.toggleCursor = function (item) {
    FLS.Imaging.S.cursor.on = !FLS.Imaging.S.cursor.on;
    item.classList.toggle('on', FLS.Imaging.S.cursor.on);
    var ov = q('sonarOverlay');
    ov.classList.toggle('on', FLS.Imaging.S.cursor.on);
    FLS.Imaging.drawOverlay();
  };

  /* ---------------------------------------------------------- 导出 */
  ui.saveProject = function () {
    var data = {
      app: '前视声呐时域信号级仿真系统', version: 1, time: new Date().toISOString(),
      params: FLS.P, terrains: FLS.state.terrains, targets: FLS.state.targets,
      terrainEdits: FLS.state.terrainEdits,          // V1.2 手工地形编辑（抬高 / 压低）
      // V1.3 航路规划：航点（含离底高度与本段速度）与闭环开关
      route: FLS.state.route, routeLoop: FLS.state.routeLoop,
      rov: FLS.state.rov, trails: FLS.state.trails.slice(-2000), keyMap: FLS.state.keyMap
    };
    FLS.download('FLS工程_' + stamp() + '.json', JSON.stringify(data, null, 1), 'application/json');
    FLS.ok('工程文件已导出（含场景、地形、地形编辑、目标、全部参数）。');
  };
  ui.loadProject = function () {
    var f = q('fileInput');
    f.accept = '.json';
    f.onchange = function () {
      var file = f.files[0]; if (!file) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var d = JSON.parse(rd.result);
          // 整体替换而非 Object.assign 叠加：否则工程文件里缺失的参数会保留
          // 上一场景的残留值，同一份工程在不同操作顺序下会跑出不同结果。
          // 显示偏好（色标/三维开关/垂直放大）不属于工程内容，沿用当前设置。
          var prefs = FLS.savePrefs();
          FLS.P = Object.assign({}, FLS.DEFAULTS, d.params || {});
          // 工程内含显示偏好时以工程为准（覆盖当前设置）
          FLS.PREF_KEYS.forEach(function (kk) {
            if (d.params && d.params[kk] !== undefined) FLS.P[kk] = d.params[kk];
          });
          FLS.applyPrefs(prefs);
          FLS.state.terrains = d.terrains || [];
          FLS.state.targets = d.targets || [];
          FLS.state.terrainEdits = d.terrainEdits || [];   // V1.2 手工地形编辑
          /* V3.1：工程文件里的地形层照旧是"来源数据"，栅格由它们重算。
           * 老工程没有 pending 字段 → 一律当作已融入（老版本没有待确认态）。 */
          FLS.state.terrains.forEach(function (t) { t.pending = !!t.pending; });
          FLS.state.route = d.route || [];                 // V1.3 航路规划
          FLS.state.routeLoop = d.routeLoop !== undefined ? !!d.routeLoop : true;
          FLS.state.routeIdx = 0;
          if (d.keyMap) FLS.state.keyMap = d.keyMap;
          FLS.state.trails = [];
          FLS.state.sel = null;
          uid = Math.max(uid, (FLS.state.terrains.length + FLS.state.targets.length) * 10 + 10);
          ui.rebake('载入工程文件');
          FLS.scene3d.rebuildTerrain(FLS.state.rov.x, FLS.state.rov.y);
          FLS.scene3d.syncTargets();
          FLS.Rov.reset();
          FLS.scene3d.updateRoute();                       // V1.3 航路标记
          ui.refreshInstList(); ui.renderParams(); ui.onSelect();
          FLS.app.onParamChange('*');
          FLS.ok('工程加载完成：' + file.name);
        } catch (e) { FLS.err('工程文件解析失败：' + e.message); }
      };
      rd.readAsText(file);
      f.value = '';
    };
    f.click();
  };
  ui.exportCsvImage = function () {
    var r = FLS.state.last; if (!r) { FLS.warn('尚无成像结果可导出。'); return; }
    var nB = r.diag.nBeam, nR = r.diag.nBin;
    var db = FLS.Imaging.toDisplay(r, 'amp');
    var s = '前视声呐成像幅值矩阵 (dB re 1uPa), 行=波束(方位), 列=距离单元\n';
    s += '波束序号,方位角(deg),' + Array.from({ length: nR }, function (_, i) {
      return (FLS.P['alg.rmin'] + (FLS.P['alg.rmax'] - FLS.P['alg.rmin']) * (i + 0.5) / nR).toFixed(2) + 'm';
    }).join(',') + '\n';
    for (var b = 0; b < nB; b++) {
      var ang = -FLS.P['alg.sector'] / 2 + FLS.P['alg.sector'] * (nB === 1 ? 0.5 : b / (nB - 1));
      var row = [b, ang.toFixed(2)];
      for (var i = 0; i < nR; i++) row.push(db[b * nR + i].toFixed(2));
      s += row.join(',') + '\n';
    }
    FLS.download('FLS成像矩阵_帧' + FLS.state.pingIndex + '_' + stamp() + '.csv', s, 'text/csv;charset=utf-8');
    FLS.ok('成像幅值矩阵 CSV 已导出（' + nB + '×' + nR + '）。');
  };
  ui.exportCsvSignal = function () { FLS.app.exportAllChannels(); };
  ui.exportReport = function () {
    var s = [];
    s.push('============================================');
    s.push(' 前视声呐时域信号级仿真系统 —— 仿真日志报告');
    s.push(' 生成时间：' + new Date().toLocaleString());
    s.push('============================================\n');
    s.push('【一、仿真参数】');
    Object.keys(FLS.SCHEMA).forEach(function (tab) {
      FLS.SCHEMA[tab].forEach(function (g) {
        g.rows.forEach(function (r) {
          if (r.t === 'btn') return;
          s.push('  ' + r.l + ' = ' + FLS.P[r.k] + ' ' + (r.u || ''));
        });
      });
    });
    s.push('\n【二、场景构成】');
    s.push('  海底地形（' + FLS.state.terrains.length + '）：');
    FLS.state.terrains.forEach(function (t) {
      s.push('   - ' + t.name + ' [' + t.type + '] 组合=叠加隆起 底质=' + t.bmat +
        ' 散射模型=' + t.smodel + ' 参数=' + JSON.stringify(t.params));
    });
    if (FLS.state.terrainEdits.length) {                 // V1.2 手工地形编辑
      s.push('  手工地形编辑（' + FLS.state.terrainEdits.length + ' 笔，正=抬高/变浅）：');
      FLS.state.terrainEdits.forEach(function (ed) {
        s.push('   - ' + (ed.amp >= 0 ? '抬高' : '压低') + ' ' + Math.abs(ed.amp).toFixed(2) +
          ' m，半径 ' + ed.r.toFixed(1) + ' m，中心 E' + ed.e.toFixed(1) + ' N' + ed.n.toFixed(1));
      });
    }
    if (FLS.state.route.length) {                          // V1.3 航路规划
      s.push('  规划航路（' + FLS.state.route.length + ' 个航点，' +
        (FLS.state.routeLoop ? '闭环' : '开链') + '）：');
      FLS.state.route.forEach(function (w, i) {
        s.push('   - #' + (i + 1) + ' E' + w.e.toFixed(1) + ' N' + w.n.toFixed(1) +
          ' 离底 ' + (+w.alt).toFixed(1) + ' m（水深 ' + FLS.Terrain.depth(w.e, w.n).toFixed(1) +
          ' m） 本段速度 ' + (+w.spd).toFixed(2) + ' m/s');
      });
    }
    s.push('  水下目标（' + FLS.state.targets.length + '）：');
    FLS.state.targets.forEach(function (o) {
      s.push('   - ' + o.name + ' [' + o.type + '] E=' + o.pos.e.toFixed(2) + ' N=' + o.pos.n.toFixed(2) +
        ' U=' + o.pos.u.toFixed(2) + ' 姿态=' + o.att.yaw + '/' + o.att.pitch + '/' + o.att.roll +
        ' 材料=' + o.mat + ' TS=' + o.ts + 'dB 缩放=' + o.scale);
    });
    s.push('\n【三、载体轨迹】（E,N,U / 采样点 ' + FLS.state.trails.length + '）');
    FLS.state.trails.filter(function (_, i) { return i % Math.max(1, Math.floor(FLS.state.trails.length / 200)) === 0; })
      .forEach(function (p) { s.push('  ' + p[0].toFixed(2) + ', ' + p[1].toFixed(2) + ', ' + p[2].toFixed(2)); });
    s.push('\n【四、仿真日志】（末尾 400 行）');
    FLS.logLines.slice(-400).forEach(function (l) { s.push('  ' + l); });
    FLS.download('FLS仿真报告_' + stamp() + '.txt', s.join('\n'), 'text/plain;charset=utf-8');
    FLS.ok('仿真日志报告已导出。');
  };
  function stamp() {
    var d = new Date();
    return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '_' +
      ('0' + d.getHours()).slice(-2) + ('0' + d.getMinutes()).slice(-2);
  }

  /* ---------------------------------------------------------- 算例模板 */
  ui.showTemplates = function () {
    var html = '<div style="line-height:1.9">' +
      '<div><b>① 平坦海底 + 静态 ROV</b>：平坦砂底 + 长方体靶 / 球体 / 沉箱三个标定目标，验证基础链路（发射→传播→面元散射→阵元采样→CBF 成像），可对照包络峰值读数校验测距测角。</div>' +
      '<div><b>② 海底沙波 + 管线目标</b>：周期沙纹海底（波高 1.5 m / 波长 15 m）+ 长圆柱管线 + 弯头，考察混响背景中的线状目标检测与 TVG 效果；三维视口默认开启 6× 垂直放大以便观察沙波起伏。</div>' +
      '<div><b>③ 沉船目标扫描</b>：泥质海底 + 破损沉船，ROV 按预设航迹自动巡航扫描，观察目标强度、阴影与多帧累积。</div>' +
      '</div>';
    FLS.modal('内置算例模板', html, [
      { t: '① 平坦海底 + 静态 ROV', fn: function () { loadTemplate(1); } },
      { t: '② 沙波 + 管线', fn: function () { loadTemplate(2); } },
      { t: '③ 沉船扫描', fn: function () { loadTemplate(3); } }
    ]);
  };
  function loadTemplate(n) {
    // 恢复默认参数（但保留用户的显示偏好：色标、三维显示开关、垂直放大）
    var prefs = FLS.savePrefs();
    FLS.P = Object.assign({}, FLS.DEFAULTS);
    FLS.applyPrefs(prefs);
    FLS.state.terrains = []; FLS.state.targets = [];
    FLS.state.terrainEdits = [];          // V1.2 换模板时清空手工地形编辑
    FLS.state.route = [];                 // V1.3 换模板时清空规划航路
    FLS.state.routeIdx = 0;
    var r = { x: 0, y: 0, z: -20, heading: 0, pitch: 0, roll: 0 };
    if (n === 1) {
      /* ★ V1.4：离底高度改成 6 m。
       * 旧值 −20（离底 12 m）配 25° 垂直波束时，海底照射区近端在 12/tan(12.5°)≈54 m，
       * 已超出 rmax=50 —— 主瓣根本照不到海底，画面里那层"亮雾"全是垂束旁瓣的弱混响，
       * 海床既没有弧带也没有声影。真实前视声呐的作业离底高度是 3~8 m。 */
      /* V1.4.1：俯仰改为 0（水平安装）。实测：俯仰 −5°~−8° 时，垂直波束主轴
       * 落到 70 m 以外，近场 20~30 m 落进第一旁瓣、远场却仍被截断，亮度沿距离
       * 出现 30~40 dB 的"碗形"起伏，图像上就是近场一条亮带、中段整片发黑。
       * 俯仰 0° 时 30°~40° 垂直开角覆盖 0~15°/0~20° 俯角，6 m 离底高度照亮
       * 16~22 m 以远，实测 20~70 m 剖面只有 ±4 dB 起伏（中心波束 149~160 dB）。
       * V2.2：本模板原来垂直开角另取 40°，使近场黑区从 22 m 缩到 16.5 m ——
       * 该覆盖已撤除，现沿用默认 20°，改用「降低离底高度」这同一件事来保构图
       * （见下方赋值处的说明）。真实前视声呐也常水平安装、靠 20°~35° 垂直开角
       * 配 3~6 m 离底高度覆盖海底。 */
      /* ★ V2.2：垂直开角不再单独覆盖，直接沿用默认值 20°（用户指定的发射系统默认）。
       * 原模板刻意取 40°，是为了把海床起始照射距离从 22 m 压到 16.5 m。
       * 现在开角只有 20°（半角 10°），要保住同样的构图只能改几何而不是改参数：
       *     海床进入垂直波束的距离 = 离底高度 / tan(半角)
       *   离底 6 m、半角 10° → 34.0 m；离底 4 m、半角 10° → 22.7 m。
       * 所以把离底高度从 6 m 降到 4 m（海底 32 m → ROV 深度 −28，仍在真实作业
       * 的 3~8 m 区间内），量程从 50 m 放到 60 m，近场黑区占比 ≈ 38%，
       * 与原模板的 33% 基本一致，三个目标（斜距 34.0 / 37.6 / 42.2 m）全部落在
       * 照射区内。 */
      FLS.P['terr.base'] = 32;                          // V3.2：海底深度只有一个出处
      FLS.P['rov.z'] = -28; FLS.P['rov.pitch'] = 0;
      FLS.P['alg.rmax'] = 60; FLS.P['rov.mode'] = 'manual';
      FLS.P['rov.track'] = '0,0,-28; 20,10,-28; 40,30,-28; 10,60,-28';
      FLS.state.terrains.push(mkTerrain('flat', { bias: 0 }, 'sand', 3, 0.08));
      // 平坦海底本身没有混响结构可看，因此布置 3 个标准目标作为回波来源：
      // 长方体靶（强镜反射，可验证测距测角）、球体（TS 与姿态无关的参照）、
      // 沉箱（大平面，观察多途与声影）。
      var dA = FLS.Terrain.depth(16, 30);
      FLS.state.targets.push(mkTarget('box', { e: 16, n: 30, u: -dA + 1.0 }, { yaw: 20, pitch: 0, roll: 0 }, 1, 'steel'));
      // V1.4：球体原在 (−9, 20) 即斜距 21.9 m —— 落在近场未照射区（本模板海底
      // 从约 32 m 才进入垂直波束），图像里根本看不到。移到 (−16, 34) 斜距 37.6 m。
      var dB = FLS.Terrain.depth(-16, 34);
      FLS.state.targets.push(mkTarget('sphere', { e: -16, n: 34, u: -dB + 1.0 }, { yaw: 0, pitch: 0, roll: 0 }, 1, 'steel'));
      var dC = FLS.Terrain.depth(4, 42);
      FLS.state.targets.push(mkTarget('caisson', { e: 4, n: 42, u: -dC + 1.2 }, { yaw: 70, pitch: 0, roll: 0 }, 1, 'air'));
    } else if (n === 2) {
      /* V2.2：离底高度 5 m → 3 m（海底 26 m → ROV 深度 −23）。
       * 垂直开角沿用默认 20° 后，海床进入波束的距离 = 离底/tan(10°)：
       *   5 m → 28.4 m（弯管斜距仅 22.8 m，会整个落进近场黑区看不见）；
       *   3 m → 17.0 m（管线 33.3 m、弯管 22.8 m 都在照射区内）。
       * 管线巡检 ROV 本就贴着 2~5 m 飞，3 m 属常规作业高度。
       * 中心频率仍按本场景另取 300 kHz（比默认 400 kHz 吸收小、量程够长），
       * 这是模板层面的场景参数，不是默认值 —— 阵元间距会按 300 kHz 自动取 λ/2。 */
      FLS.P['rov.z'] = -23; FLS.P['rov.pitch'] = 0; FLS.P['alg.rmax'] = 60;
      FLS.P['tx.fc'] = 300; FLS.P['tx.bw'] = 40; FLS.P['rov.mode'] = 'manual';
      // 沙波取 H/λ ≈ 0.10（波长 18 m、波高 0.9 m→坡度约 18°），比旧值（1.5 m/15 m，
      // 坡度 32°）缓一半：旧参数下脊间全被自遮挡吃掉，扇面呈现"华夫格"般的硬黑格，
      // 与真实前视声呐里沙波那种明暗相间的柔和弧带完全不像。走向 90° 使沙脊沿东西
      // 方向延伸，ROV 正北照射时横穿沙脊，扇面上呈同心弧带。
      // 三维视口另开 6× 垂直放大（disp.zexag，纯显示量）以突出起伏。
      FLS.P['terr.base'] = 26;                          // V3.2
      FLS.state.terrains.push(mkTerrain('dunes', { bias: 0, amp: 0.9, wavelen: 18, dir: 90 }, 'sand', 3, 0.12));
      FLS.P['disp.zexag'] = 6;                          // 本模板的显示预设：6× 垂直放大
      var d1 = FLS.Terrain.depth(18, 28);
      FLS.state.targets.push(mkTarget('pipeline', { e: 18, n: 28, u: -d1 + 0.4 }, { yaw: 90, pitch: 0, roll: 0 }, 1, 'steel'));
      var d2 = FLS.Terrain.depth(-6, 22);
      FLS.state.targets.push(mkTarget('elbow', { e: -6, n: 22, u: -d2 + 0.6 }, { yaw: 20, pitch: 0, roll: 0 }, 1, 'steel'));
    } else {
      /* V1.4：离底 6 m（旧值 −22 = 离底 12 m），使海床出现在约 30% 量程处，
       * 与真实前视声呐图像的构图一致（近场留黑、中远场为海床散斑）；
       * V2.2 再把离底收至 4 m，见下方说明。 */
      /* V2.2：垂直开角沿用默认 20°（原为 30°），离底高度 6 m → 4 m 补偿构图。
       *   半角 10°：离底 6 m → 海床自 34.0 m 起亮（水雷斜距 31.6 m 会看不见）；
       *            离底 4 m → 海床自 22.7 m 起亮（水雷 31.6 m、沉船 44.7 m 均在内）。
       * 近场黑区占量程 70 m 的 32%，与 V1.4 记录的构图一致。 */
      FLS.P['rov.z'] = -30; FLS.P['rov.pitch'] = 0; FLS.P['alg.rmax'] = 70;
      FLS.P['rov.mode'] = 'track'; FLS.P['rov.trackSpeed'] = 1.2;
      FLS.P['rov.track'] = '0,0,-30; 25,12,-30; 55,26,-30; 30,58,-30; -5,70,-30';
      FLS.P['terr.base'] = 34;                          // V3.2
      FLS.state.terrains.push(mkTerrain('mud', { bias: 0, rms: 0.15, corr: 40 }, 'mud', 3, 0.06));
      var d3 = FLS.Terrain.depth(20, 40);
      FLS.state.targets.push(mkTarget('wreck', { e: 20, n: 40, u: -d3 + 4 }, { yaw: 125, pitch: 4, roll: 12 }, 1, 'steel'));
      var d4 = FLS.Terrain.depth(-10, 30);
      FLS.state.targets.push(mkTarget('mine', { e: -10, n: 30, u: -d4 + 1.2 }, { yaw: 0, pitch: 0, roll: 0 }, 1, 'steel'));
    }
    ['rov.x', 'rov.y', 'rov.z', 'rov.heading', 'rov.pitch', 'rov.roll'].forEach(function (k) {
      FLS.P[k] = ({ 'rov.x': r.x, 'rov.y': r.y, 'rov.z': FLS.P['rov.z'], 'rov.heading': 0, 'rov.pitch': FLS.P['rov.pitch'], 'rov.roll': 0 })[k];
    });
    FLS.Rov.reset();
    FLS.Rov.parseTrack();
    /* ★ V3.1：模板自带的地形全部是「已融入」态，加载完直接栅格化一次。
     * （V3.0 曾在这里 ensureTerrainCount(5) 自动补 4 份随机地形 —— 那条规则
     *   已被"打开系统默认为平坦均值海底"取代：默认场景要干净、可预期，
     *   想要有起伏的海底改由「🎲 随机生成 5 种地形」按钮按需生成。）
     * 烘焙必须放在 rebuildTerrain 之前 —— 否则这一轮网格还是解析求值，
     * 看不到栅格带来的加速，而且下一帧才生效会让首帧慢半拍。 */
    ui.rebake('载入算例模板 ' + n);
    FLS.scene3d.rebuildTerrain(FLS.state.rov.x, FLS.state.rov.y);
    FLS.scene3d.syncTargets();
    FLS.scene3d.setCamera('iso');
    FLS.scene3d.updateRoute();                       // V1.3 航路标记
    ui.refreshInstList(); ui.renderParams(); ui.onSelect();
    FLS.app.onParamChange('*');
    FLS.ok('算例模板 ' + n + ' 已加载：' + (n === 1 ? '平坦海底 + 静态 ROV' : (n === 2 ? '海底沙波 + 管线目标' : '沉船目标扫描')));
    FLS.log('算例加载完成：' + FLS.state.terrains.length + ' 份地形已栅格化融入海底。' +
      '想再加起伏，可在「海底地形设置」页从地形库点选（调好属性后点「确认并栅格化」），' +
      '或点「🎲 随机生成 5 种地形」一次成图。');
    FLS.log('建议点击「启动仿真」开始，或先「单步」观察一次脉冲的完整链路。');
  }

  /**
   * V3.1：默认场景 —— 平坦均质海底（★ V3.4：深度 200 → 100 m、范围 300×300 m）。
   * 打开软件就是这一张：海底平坦、砂底；★ V3.4 起另有 5 个随机目标布在声呐
   * 周围半径 alg.rmax（默认 100 m）内，见 mkRandomTargets。
   * 之所以不再自动铺 5 份随机地形：① 用户要的默认值就是"平坦均值海底"；
   * ② 随机地形每次打开都不一样，做算法对比时没法复现；③ 想看起伏点一次按钮即可。
   *
   * ★ V3.4：深度与载体高度**不再在这里覆盖** —— 直接沿用 DEFAULTS 的
   *   terr.base = 100 m / rov.z = −90 m（离底 10 m）。
   *   旧版在这里另写 200 / −196，于是"改 DEFAULTS 改不动开机状态"，
   *   两处必须同步改、漏一处就对不上 —— 这正是"默认值有两个真相源"的代价。
   *   现在只有 DEFAULTS 一处。
   */
  ui.loadDefault = function () {
    FLS.P = Object.assign({}, FLS.DEFAULTS);
    FLS.applyPrefs(FLS.savePrefs());
    FLS.state.terrains = [];
    FLS.state.targets = [];
    FLS.state.terrainEdits = [];
    FLS.state.route = []; FLS.state.routeIdx = 0;
    FLS.state.trails = []; FLS.state.sel = null;
    FLS.state.terrains.push(mkTerrain('flat', { bias: 0 }, 'sand', 3, 0.10));
    FLS.P['rov.x'] = 0; FLS.P['rov.y'] = 0; FLS.P['rov.z'] = FLS.DEFAULTS['rov.z'];
    FLS.P['rov.heading'] = 0; FLS.P['rov.pitch'] = 0; FLS.P['rov.roll'] = 0;
    FLS.Rov.reset();
    FLS.Rov.parseTrack();
    ui.rebake('默认场景');
    /* ★ V3.4：默认在声呐周围半径 = alg.rmax（100 m）内随机布 5 个目标。
       必须在 rebake 之后 —— 布点要查 Terrain.depth 才知道海床在哪。 */
    FLS.state.targets = mkRandomTargets(5, DEFAULT_TARGET_SEED);
    FLS.scene3d.rebuildTerrain(FLS.state.rov.x, FLS.state.rov.y);
    FLS.scene3d.syncTargets();
    FLS.scene3d.setCamera('iso');
    FLS.scene3d.updateRoute();
    ui.refreshInstList(); ui.renderParams(); ui.onSelect();
    if (FLS.app && FLS.app.onParamChange) FLS.app.onParamChange('*');
  };
  function mkTerrain(type, params, bmat, smodel, rough) {
    return {
      id: 'T' + (uid++), type: type, name: FLS.Terrain.TYPES[type].name,
      params: Object.assign(FLS.Terrain.defaultParams(type), params),
      op: 'union', bmat: bmat, smodel: smodel, rough: rough, seed: (Math.random() * 1e5) | 0,
      /* V3.1：由模板 / 随机生成 / 工程文件直接落地的地形一律是**已融入**态 ——
       * 它们是"成图"的一部分，不需要用户再点一次确认。只有从地形库里手动
       * 点进来的才是 pending（先调后确认）。 */
      pending: false
    };
  }
  function mkTarget(type, pos, att, scale, mat) {
    var T = FLS.Models.TYPES[type];
    return {
      id: 'O' + (uid++), type: type, name: T.name, pos: pos, att: att,
      scale: scale, mat: mat, ts: T.ts, fres: 'mid', opts: { len: 90 }
    };
  }

  /* ====================================================================
   * ★ V3.4：默认在声呐周围半径 100 m 内随机布 5 个目标
   * --------------------------------------------------------------------
   * 为什么必须"默认就有"：V3.4 新增的六类模型（钻井平台 / 蛙人 / 轮胎 /
   * 沉车 / 珊瑚丛 / 鲸鱼）如果只是进了模型库，打开软件三维场景里一个都
   * 看不见，那"新增模型"对使用者等于没发生 —— 他得先知道去哪一页、点哪
   * 个格子才会出现。所以从这六类里随机取 5 类、每类布一个，开机即见。
   *
   * 半径为什么绑 alg.rmax：量程就是"声呐能看见的距离"。目标布在量程之外，
   * 成像图上根本不会有回波，三维里看得见、声呐图里看不见，反而会被当成
   * bug。所以直接取 alg.rmax（默认 100 m）作为布点半径。
   *
   * 半径内为什么还要分最近距离：贴着声呐布一个 46 m 高的导管架，会把整个
   * 视口填满，看不到别的东西。rig 因此单独给 minR = 45 m。
   *
   * 复现性：这里用 Math.random（与「随机生成 5 种地形」一致）—— 目标只是
   * 布景，每次打开换个位置更能说明模型库是通用的。要做可复现的参数扫描，
   * 用「保存工程 / 载入工程」，坐标会随工程文件一起存下来。
   * ==================================================================== */
  var NEW6 = [
    /* t 类型 / mat 材质 / onBottom 坐底 / lift 坐底时中心抬到几倍模型尺寸 /
       uOff 悬于水体时离底高度区间 / minR 最近布点距离 */
    { t: 'rig',   mat: 'steel',  onBottom: true,  lift: 0.50, minR: 45 },
    { t: 'coral', mat: 'grp',    onBottom: true,  lift: 0.50, minR: 15 },
    { t: 'car',   mat: 'steel',  onBottom: true,  lift: 0.50, minR: 20 },
    { t: 'tire',  mat: 'rubber', onBottom: true,  lift: 0.50, minR: 12 },
    { t: 'diver', mat: 'rubber', onBottom: false, uOff: [4, 30],  minR: 10 },
    { t: 'whale', mat: 'water',  onBottom: false, uOff: [12, 55], minR: 18 }
  ];
  /**
   * 随机布 n 个目标（互不重复的类型）。
   * @param {number} n 目标个数
   * @param {number} [seed] 给定时用**固定种子**的线性同余发生器代替 Math.random。
   *   默认场景（loadDefault）必须传种子 —— 否则每次打开软件目标位置都不一样，
   *   而本系统从头到尾都在强调"打开软件是同一张可复现的场景"（这才是
   *   "改一个参数做 A/B"能成立的前提）。想换一批目标，点目标页的
   *   「🎲 随机布置 5 个目标」按钮（那个走真 Math.random）。
   * @returns {object[]} 目标实例数组
   */
  function mkRandomTargets(n, seed) {
    var rnd = Math.random;
    if (seed !== undefined && seed !== null) {
      var st = (seed >>> 0) || 1;
      rnd = function () { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
    }
    var pool = NEW6.slice();
    /* Fisher–Yates 洗牌后取前 n 个 —— 保证类型不重复 */
    for (var i = pool.length - 1; i > 0; i--) {
      var j = (rnd() * (i + 1)) | 0, tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    var R = Math.max(20, parseFloat(FLS.P['alg.rmax']) || 100);
    var cx = FLS.state.rov.x, cy = FLS.state.rov.y;
    var baseD = parseFloat(FLS.P['terr.base']) || 100;
    var out = [];
    for (var k = 0; k < Math.min(n, pool.length); k++) {
      var sp = pool[k], T = FLS.Models.TYPES[sp.t];
      var rMin = Math.min(sp.minR, R * 0.9), rMax = R;
      /* r = rMin + (rMax−rMin)·√u：面积均匀。
         若直接写 r = rMin + (rMax−rMin)·u，目标会挤在圆心附近（圆环面积 ∝ r）。 */
      var rr = rMin + (rMax - rMin) * Math.sqrt(rnd());
      var th = rnd() * 2 * Math.PI;
      var e = cx + rr * Math.cos(th), nn = cy + rr * Math.sin(th);
      var dp = FLS.Terrain.depth(e, nn);
      if (!isFinite(dp) || dp <= 0) dp = baseD;
      var u;
      if (sp.onBottom) u = -dp + (T.size || 1) * sp.lift + 0.2;
      else u = -dp + sp.uOff[0] + rnd() * (sp.uOff[1] - sp.uOff[0]);
      /* 两道夹取：不许穿出水面，也不许沉到海床以下 */
      if (u > -1.5) u = -1.5;
      if (u < -dp + 0.3) u = -dp + 0.3;
      out.push(mkTarget(sp.t,
        { e: Math.round(e * 10) / 10, n: Math.round(nn * 10) / 10, u: Math.round(u * 10) / 10 },
        { yaw: Math.round(rnd() * 360), pitch: 0, roll: 0 }, 1, sp.mat));
    }
    return out;
  }
  ui.mkRandomTargets = mkRandomTargets;
  /** 默认场景用的固定种子（保证"打开软件是同一张可复现的场景"） */
  var DEFAULT_TARGET_SEED = 20261030;
  /** 「🎲 随机布置 5 个目标」按钮：走真 Math.random，每次都不一样 */
  ui.rerollTargets = function (n) {
    var cnt = n || 5;
    FLS.state.targets = mkRandomTargets(cnt);
    FLS.scene3d.syncTargets();
    ui.refreshInstList();
    FLS.state.sel = null; ui.onSelect();
    FLS.log('已在声呐周围 ' + (Math.max(20, parseFloat(FLS.P['alg.rmax']) || 100)) +
      ' m 内随机布置 ' + FLS.state.targets.length + ' 个目标：' +
      FLS.state.targets.map(function (t) {
        return t.name + '（E' + t.pos.e.toFixed(0) + ' N' + t.pos.n.toFixed(0) + ' U' + t.pos.u.toFixed(0) + '）';
      }).join('、'));
    FLS.ok('随机目标已更新。默认场景用的是固定种子（可复现），这里是真随机 —— 每次点都不一样。');
  };

  /* ====================================================================
   * 随机地形（五种一套）
   *   V3.0 曾把「默认给五种」写进启动流程：打开软件海床就有沙波 / 礁石 / 沟壑。
   *   V3.1 收回这条规则，默认场景改为**单一平坦均质海底**（V3.1 是 200 m、
   *   ★ V3.4 起 100 m，见 ui.loadDefault），
   *   理由有三：
   *     ① 用户要的默认值就是"平坦均值海底"；
   *     ② 随机地形每次打开都不一样，做算法对比、参数扫描时无法复现；
   *     ③ 想要有起伏的海底，点一次「🎲 随机生成 5 种地形」即可，成本一样。
   *   所以下面这套生成器只服务于那个按钮，不再自动调用。
   *
   *   随机源用 Math.random 而不用 U.rng：U.rng 是给仿真用的确定性种子
   *   （同一种子必须复现同一帧结果），地形只是布景，每次打开不一样反而
   *   更能说明"地形库是通用的、不挑场景"。
   * ==================================================================== */
  /** 区间内均匀随机，并量化到 step 的整数倍（免得属性面板里出现 3.1415926 这种值） */
  function rq(a, b, step) {
    var v = a + Math.random() * (b - a);
    return step ? Math.round(v / step) * step : v;
  }
  /** 每种地形的随机参数区间。区间取的是**真实浅海**的常见值，不是参数表的全量程
   *  （比如 reef 的礁体高度上限是 60 m，但真实大陆架礁体多在 1~4 m，随机到 60 会
   *   直接捅穿海面）。d = 基底水深，所有起伏都围绕它上下几米。 */
  var RAND_TP = {
    /* ★ V3.2：随机地形不再各带一个 depth —— 深度只有一个出处（terr.base）。
     *  这里只给形状参数，bias 统一 0（贴在基准面上）。
     *  区间仍是"真实浅海常见值"而不是参数表全量程：礁体高度上限 60 m，
     *  但大陆架礁体多在 1~4 m，随机到 60 直接捅穿海面。 */
    flat: function () { return { bias: 0 }; },
    slope: function () { return { bias: 0, grade: rq(1, 7, 0.1), dir: rq(-180, 180, 1) }; },
    ridge: function () { return { bias: 0, height: rq(2, 9, 0.5), width: rq(8, 24, 0.5), dir: rq(-180, 180, 1) }; },
    trench: function () { return { bias: 0, deep: rq(2, 8, 0.5), width: rq(8, 20, 0.5), dir: rq(-180, 180, 1) }; },
    dunes: function () { return { bias: 0, amp: rq(0.4, 1.8, 0.05), wavelen: rq(8, 20, 0.5), dir: rq(0, 180, 1) }; },
    gravel: function () { return { bias: 0, rms: rq(0.2, 0.9, 0.01), corr: rq(3, 10, 0.5) }; },
    mud: function () { return { bias: 0, rms: rq(0.02, 0.15, 0.01), corr: rq(25, 60, 1) }; },
    reef: function () { return { bias: 0, height: rq(1, 3.5, 0.1), size: rq(2, 5, 0.1), density: rq(1, 3, 0.1) }; },
    terrace: function () { return { bias: 0, stepH: rq(1.5, 4, 0.1), stepW: rq(10, 25, 0.5), dir: rq(-180, 180, 1) }; },
    fractal: function () { return { bias: 0, rms: rq(0.8, 3, 0.05), fdim: rq(2.2, 2.7, 0.01), corr: rq(20, 50, 1) }; }
  };
  /** 地形类型 → 底质。按地质常识配：沟/泥质平原是泥，沙波是砂，礁与台地是岩。
   *  底质直接决定朗伯散射系数 μ（泥 −30 dB → 珊瑚 −16 dB），随机配错会让
   *  "珊瑚礁比泥滩还暗"这种反直觉结果出现在混响图里。 */
  var RAND_TMAT = {
    flat: 'sand', slope: 'mud', ridge: 'rock', trench: 'mud', dunes: 'sand',
    gravel: 'gravel', mud: 'mud', reef: 'coral', terrace: 'rock', fractal: 'sand'
  };
  /** 底质 → 粗糙界面模型的均方根坡度 s（典型值，文献常见区间取中） */
  var RAND_TROUGH = { mud: 0.05, sand: 0.10, gravel: 0.16, rock: 0.22, coral: 0.20 };

  /**
   * 生成一份随机地形。
   * @param {string[]} exclude 已用过的地形类型（不重复）
   * @param {number} baseDepth 基底水深（m），起伏围绕它展开
   * @returns {object|null} 九种都用完了就返回 null
   */
  function mkRandomTerrain(exclude) {
    var pool = Object.keys(RAND_TP).filter(function (k) { return exclude.indexOf(k) < 0; });
    if (!pool.length) return null;
    var type = pool[(Math.random() * pool.length) | 0];
    var bmat = RAND_TMAT[type] || 'sand';
    return mkTerrain(type, RAND_TP[type](), bmat, 3, RAND_TROUGH[bmat]);
  }

  /**
   * 把「已加入的海底地形」补齐到 n 份：第 1 份（基底）保留，其余随机补。
   * 基底的水深从它自己的 params.depth 取 —— 起伏地形（如 reef）的 depth
   * 也是基准深度，语义一致，所以不必区分模板用的是哪种地形。
   */
  /**
   * V3.1：ensureTerrainCount 只在「随机生成」这一条路径上用 ——
   * 默认场景不再自动铺地形（见 ui.loadDefault 的说明）。
   */
  function ensureTerrainCount(n) {
    var used = FLS.state.terrains.map(function (t) { return t.type; });
    while (FLS.state.terrains.length < n) {
      var t = mkRandomTerrain(used);
      if (!t) break;                       // 库里 10 种全用完了（n > 10 时才会发生）
      used.push(t.type);
      FLS.state.terrains.push(t);
    }
  }

  /** 「🎲 随机生成 5 种地形」按钮：以当前基底水深为准，一次给出 5 份并直接栅格化。
   *  基底留着是为了不让工作水深跟着一起跳 —— 水深一变，ROV 离底高度、
   *  量程覆盖、声影位置全都要重新调，用户点一下按钮不该有这种副作用。
   *  地形层全部标成「已融入」并立即烘焙：这些是按钮一次性生成的成品，
   *  再让用户一份份点确认没有意义。 */
  ui.rerollTerrains = function () {
    var base = FLS.state.terrains.filter(function (t) { return !t.pending; })[0];
    if (!base) {
      // 一份已确认地形都没有（连默认平坦海底都被删了）→ 先铺一张平坦基底
      base = mkTerrain('flat', { bias: 0 }, 'sand', 3, 0.10);
      FLS.state.terrains.push(base);
    }
    base.pending = false;
    var d = parseFloat(FLS.P['terr.base']) || 200;
    FLS.state.terrains = [base];
    ensureTerrainCount(5);
    ui.rebake('随机生成海底地形');
    FLS.scene3d.rebuildTerrain(FLS.state.rov.x, FLS.state.rov.y);
    ui.refreshInstList(); ui.onSelect();
    FLS.ok('已随机生成 ' + FLS.state.terrains.length + ' 份海底地形并栅格化（基准面 ' +
      d + ' m，各层都是围绕它的起伏，平均水深不变）。');
  };
  ui.loadTemplate = loadTemplate;

  /* ---------------------------------------------------------- 帮助 */
  ui.showHelp = function (kind) {
    if (kind === 'key') {
      FLS.modal('键盘控制说明', '<div style="line-height:1.9">' +
        '<b>前置条件</b>：只有仿真「已启动且未暂停」时键盘控制才生效；暂停时载体静止（这是刻意设计，便于冻结观察）。<br><br>' +
        '<table><tr><th>按键</th><th>动作</th><th>按键</th><th>动作</th></tr>' +
        '<tr><td>W</td><td>前进（沿艏向）</td><td>←</td><td>左转（航向）</td></tr>' +
        '<tr><td>S</td><td>后退</td><td>→</td><td>右转（航向）</td></tr>' +
        '<tr><td>A</td><td>左平移</td><td>↑</td><td>抬头（俯仰+）</td></tr>' +
        '<tr><td>D</td><td>右平移</td><td>↓</td><td>低头（俯仰−）</td></tr>' +
        '<tr><td>Q</td><td>上浮</td><td>Z</td><td>左横滚</td></tr>' +
        '<tr><td>E</td><td>下潜</td><td>C</td><td>右横滚</td></tr>' +
        '</table><br>可在「ROV 载体 → 快捷键设置」中自定义映射。三维视图中左键旋转、右键平移、滚轮缩放。</div>');
    } else if (kind === 'alg') {
      FLS.modal('算法与模型说明', '<div style="line-height:1.8;font-size:12px">' +
        '<h4>1. 时域仿真链路</h4>发射波形（复基带）→ 传播（几何扩散 1/R、Thorp 吸收、声速剖面时延、海面/海底一阶镜像多途）→ 面元散射（海底朗伯 Lambert / 基尔霍夫 Kirchhoff / 经验散射模型；目标按 TS 归一化）→ 阵元级独立叠加 → 噪声（环境 Knudsen + 自噪声 + 通道电噪声 + 量化）→ 带通滤波 → 匹配滤波（脉冲压缩）→ TVG → 波束形成 → 扇形图像。<br>' +
        '<b>复基带等价</b>：x(t)=Re{b(t)e<sup>j2πf<sub>c</sub>t</sup>}，内核以 f<sub>s,bb</sub>≈2.5B 采样，与射频带通严格等价且计算量降低数倍；阵元回波含 e<sup>−j2πf<sub>c</sub>τ</sup> 精细相位项。<br>' +
        '<h4>2. 传播与吸收</h4>TL(R)=20lgR+αR/1000（dB，R 米，α 为 dB/km）；Thorp：α=0.11f²/(1+f²)+44f²/(4100+f²)+2.75×10⁻⁴f²+0.003（f 单位 kHz）。声速用 Mackenzie(1981) 公式，路径取两端点平均（简化：线性温跃层 0.02 °C/m）。<br>' +
        '<h4>3. 散射模型</h4>① 朗伯散射模型（Lambert）：σ₀=μcos²θ<sub>i</sub>；② 基尔霍夫粗糙界面模型（Kirchhoff/Biot）：σ₀=μ/(8πs²)·sec⁴θ<sub>i</sub>·exp(−tan²θ<sub>i</sub>/(2s²))；③ 经验公式：σ₀=μ(cos²θ+0.1·e<sup>−θg/8°</sup>)；④ 掠射指数律：σ₀=μ·sinθ<sub>g</sub>（前视声呐推荐，模板默认）。目标：面元按入射余弦² 加权分配 TS 总截面（阴影面剔除）。<br>' +
        '<h4>4. 噪声</h4>Knudsen 谱 NL(f)=NL<sub>1kHz</sub>−17lg(f/1kHz)+10lg(1+(v/5)²)；自噪声与通道电噪声（受前置增益折算）独立可控；ADC 量化噪声按 −6.02N dB。<br>' +
        '<h4>5. 波束形成</h4>统一采用聚焦近场模型：y(r,θ)=(1/M)Σw<sub>m</sub>b<sub>m</sub>((r+R<sub>m</sub>)/c)e<sup>−j2πf<sub>c</sub>(r−R<sub>m</sub>)/c</sup>。自适应算法用距离窗快拍估计协方差 + 对角加载 + 空间平滑。<br>' +
        '<h4>6. 简化假设</h4>（a）声线弯曲未建模，用深度平均声速；（b）海底多途按局部切平面镜像；（c）目标面元按 TS 归一化，未考虑多次散射与遮挡；（d）BP 采用非相干孔径累积。</div>',
        [{ t: '关闭', primary: true }]);
    } else {
      FLS.modal('使用手册说明', '<div style="line-height:1.85;font-size:12px">' +
        '<h4>软件定位</h4>本系统是<b>时域信号级</b>前视声呐仿真平台：所有成像结果均由完整物理时域链路生成（发射波形→传播→面元散射→阵元级采样→滤波/脉压/TVG→波束形成），不存在图像级直接渲染。三维视图仅用于场景观测与编辑，与扇形成像视图相互独立。<br>' +
        '<h4>版面</h4><b>左栏</b>七页参数：海底地形 → 待测目标 → 海洋环境 → ROV 载体 → 发射系统 → 接收阵列 → 成像处理（页签顺序 = 布一个场景的先后顺序）。<br>' +
        '<b>中栏</b>三视图：三维场景设置（地形编辑 / 目标放置 / 航路规划）、原理演示（九幕动画讲清物理链条）、前视声呐成像（上排 扇形成像主图 + 左侧三维跟随视口，下排整幅宽的阵元信号观测）。<br>' +
        '<b>色标</b>：顶栏不再设色标菜单 —— 三维视口的海底深度色标在「三维场景设置」视图栏（量程 / 垂直放大旁边），声呐图像的色标在「前视声呐成像」视图栏（动态范围 / 窗偏移旁边），两套独立。<br>' +
        '<b>右栏</b>仿真控制台：运行控制、实时指标、仿真日志。<br>' +
        '<h4>快速上手</h4>1) 左栏「海底地形设置」点地形库加入海底（可叠加并做布尔运算）；2) 「待测目标设置」点目标库放置目标，属性块可改位置/姿态/材料/TS；3) 依次定海洋环境、ROV 载体、发射、接收阵、成像处理；4) 右栏控制台点「启动仿真」，用 W/S 前后、A/D 转向、↑/↓ 抬头低头、←/→ 升降高度驾驶 ROV；5) 成像栏左下角可溯源任意阵元的时域波形与频谱。<br>' +
        '<h4>常用操作</h4>· 单步模式：一脉冲一帧，便于逐帧观察；· 精度档：快速预览适合交互调试，高精度加密散射元并开启多途；· 时间加速：降低仿真推进速度以便观察；· 冻结/存帧：冻结当前扇形帧并导出 PNG；· 光标：在扇形图上点选读取目标距离与方位；· 动态范围/窗偏移：成像视图栏上可直接调色标跨度与整体亮度。<br>' +
        '<h4>原理演示</h4>中栏「原理演示」用九幕动画把物理链条拆开讲：几何（斜距/地距/掠射角）、发射信号、距离分辨率、方位分辨率、波束形成、混响与散斑、目标声影、TVG、不模糊距离。每幕的数值都取自当前参数，与仿真结果对得上。<br>' +
        '<h4>数据与复现</h4>可导出工程 JSON（场景+参数）、阵元时域信号 CSV、成像幅值矩阵 CSV、声呐图像 PNG、仿真报告 TXT，便于科研复现与二次分析。<br>' +
        '<h4>坐标系</h4>ENU（东 E / 北 N / 天 U），海面 U=0，水下 U&lt;0，深度 = −U；航向角自正北顺时针。</div>',
        [{ t: '关闭', primary: true }]);
    }
  };
  ui.showAbout = function () {
    FLS.modal('关于', '<div style="line-height:1.9">' +
      '<b>前视声呐时域信号级仿真系统 FLS-TDSIM V3.7</b><br>' +
      '面向水声 / 声呐工程师、硕博研究生、水下装备研发人员的时域信号级前视声呐仿真平台。<br>' +
      '阵列体制：一维水平均匀线阵（ULA），方位维波束形成；垂直维覆盖由发射垂直开角与阵元指向性决定。<br>' +
      '特性：10 种典型海底地形（基准深度默认 200 m；新加的地形先调属性、三维实时预览，点「确认」后栅格化融入一张 401×401 的海底深度图）、12 种水下目标（V3.0 全部重建为回转体 / NACA 翼型挤出 / 导管螺旋桨的高精度几何，共约 4.9 万三角面）、' +
      '完整时域链路、8 种波束形成与成像算法、' +
      'ROV 键盘实时控制与航迹巡航、阵元级信号溯源、三维海面 / 海底深度着色与网格、深浅双主题、工程与数据导出。<br>' +
      'V3.0 版面：左栏七页参数、中栏三视图（三维场景设置 / 原理演示 / 前视声呐成像）、底部一整条仿真控制台（原右栏 342 px 的宽度全部还给中栏）；' +
      '仿真日记改为底部控制台右端的按钮，点击弹出可拖动的便签纸，不再常驻占版面；' +
      '成像栏左上角新增驾控台（ADI 姿态仪 + HSI 航向罗盘 + ROV 按键说明），新用户一眼就知道 ROV 可以用 WASD 等键操控；' +
      '成像栏上排为「三维跟随视口 + 扇形成像主图」（等高），下排为整幅宽的阵元信号观测；' +
      '三维场景设置视口只保留一条顶部工具条。<br>' +
      'V3.1：默认场景改为平坦均质海底（★ V3.4 起 100 m，并自带 5 个随机目标；算例模板仍在「文件」菜单里）；海底地形支持「调属性 → 确认 → 栅格化融图」，' +
      '融图之后引擎按栅格查表，不再逐层解析求值，加再多地形也不卡；海底网格边数 110 → 220（格距减半）；' +
      '海底默认色标改为水深色标（深蓝→绿→黄→红），三维场景同步去雾、降环境光、提定向光以消除灰蒙感。<br>' +
      'V3.2：海底改为「一个平均深度 + 若干零均值起伏层」——加地形不再改变平均水深，改深度 0 ms 生效、不重烘焙；' +
      '三维坐标轴收回海面以内、刻度只到 ±半跨；成像栏左列三层重排（三维跟随视口 / ADI+HSI 双表盘 / 键盘说明）；' +
      '阵元垂直长度→垂直开角、扇角→波束角→波束数 全部锁成推导关系，不再允许自相矛盾的组合。<br>' +
      'V3.3：对发射 / 接收 / 成像三页的 70 项参数逐条查"到底有没有进内核计算链"（静态消费者计数 + 同步 A/B 图像实测）——' +
      '删掉发射端两个改不动的假旋钮（垂直开角改由垂直叠层数派生）、按真实电路分工拆开灵敏度与前置增益、' +
      '补上基带采样率 / 抽取因子 / 不模糊距离三个隐形派生量，并在 HUD 上常驻「受限判据」标签，' +
      '把"某个参数改了图像看不出变化"变成一句能读的话（混响受限 / 过渡区 / 噪声受限 / 量化受限）。<br>' +
      '<span style="color:#c2410c">时域信号级仿真平台，仅供科研仿真。</span></div>');
  };

  /* ★ V2.2：applyI18n / rebuildI18n（含 FLS.I 的 langBtn 回调）整体删除。
   *   界面文案现在只有一份中文真相，没有「切换语言」这个概念，
   *   也就不需要遍历 [data-i18n] 重刷、不需要重建色标下拉 / 参数表 / 指标条。
   *   静态文案直接写在 HTML 与 JS 里，动态文案由各面板自己的渲染函数负责。 */
})();
