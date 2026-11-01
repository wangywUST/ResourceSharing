/* =========================================================================
 * 60-scene3d.js —— 三维场景视口（Three.js）
 *   · ENU 坐标系（东 E / 北 N / 天 U），映射：three.x=E, three.y=U, three.z=−N
 *   · 海底地形网格（组合高程场，可布尔叠加）、水下目标实例、ROV 载体与声呐视锥
 *   · 坐标系 / 刻度标尺 / 海底网格 / 包围盒 / 轨迹线 / 散射元 / 法向量显示开关
 *   · 交互：左键旋转、右键平移、滚轮缩放、点击拾取、两点测距
 *   注意：三维视图仅用于「场景观测与编辑」，与右侧扇形成像视口完全独立。
 * ========================================================================= */
(function () {
  var U = FLS.U, DEG = U.DEG;
  var S = {
    renderer: null, scene: null, camera: null, host: null,
    seafloor: null, seafloorGrid: null, normals: null, surface: null,
    rovGroup: null, cone: null, axes: null, ruler: null, track: null, scat: null,
    targetObjs: {}, boxes: {}, selBox: null,
    /* V3.1：相机初始注视点跟着默认载体深度走。
       ★ V3.4：默认海底 100 m、载体 −90 m（离底 10 m）。
     * 旧值 ty:−20 是配 32 m 浅海场景的，配上 200 m 海底开局就是一片空水，
     * 海床在画面下方 180 m 外，第一眼看着像"什么都没加载"。 */
    cam: { tx: 0, ty: -196, tz: 0, dist: 90, theta: Math.PI * 0.25, phi: 0.55, follow: false },
    drag: null, measure: { on: false, pts: [], line: null, labelEl: null },
    // V1.2 海底地形笔刷：amp 幅度（m，正=抬高），r 半径（m），shape 权函数形状
    brush: { on: false, amp: 1, r: 15, shape: 'cos', ring: null, cross: null },
    // V1.3 航路规划：pickOn = 打点模式（左键在三维视口落航点），sel = 当前选中航点索引
    route: { on: false, sel: -1 },
    center: [0, 0], needTerrain: true, trail: [], lastTrail: null
  };
  FLS.scene3d = S;

  function v3(e, n, u) { return new THREE.Vector3(e, u, -n); }          // ENU → Three
  function enu(v) { return { e: v.x, n: -v.z, u: v.y }; }

  /* ---------------------------------------------------------- 主题配色表
   * 三维视口的背景/雾/光照/海面/网格/海底底色随界面主题切换。
   * 注意：海底「按深度着色」用的是色标本身的颜色，不受主题影响——
   * 它表示的是水深物理量，必须与图例一致。
   */
  var TH = {
    light: {
      /* ★ V3.1「灰蒙蒙 → 通透」：三个量一起调，缺一个都回不去。
       *  ① 雾密度 0.0016 → 0.00055。FogExp2 是 1−exp(−(d·ρ)²)，旧的 ρ 下
       *     250 m 处已经混进 15% 的背景灰蓝，海床远处整片发灰、读不出起伏；
       *     新值在同一距离只有 1.9%，远处仍是地形本色。
       *  ② 环境光 0.82 → 0.52、且颜色由蓝灰 0xbcd0e4 换成近白 0xe6eef7。
       *     环境光是**乘**在顶点色上的：蓝灰环境光会把色标整体拉向灰蓝，
       *     这正是"灰蒙蒙"的主因（换哪条色标都像蒙了层纱）。
       *  ③ 主平行光 0.58 → 0.86。压环境光必须补定向光，否则海床变暗；
       *     而且定向光带 N·L，起伏的明暗层次来自它 —— 这一升一降，
       *     同样是 1.2 的总照度，坡度对比从 0.53:0.61 变成 0.78:0.47，
       *     沙波脊线的立体感明显出来。
       *  背景色同步压深一档（0xc4d4e4 → 0xa9c8e2），让海床与水体分清。 */
      bg: 0xa9c8e2, fog: 0xa9c8e2, fogD: 0.00055,
      amb: 0xe6eef7, ambI: 0.52, dirI: 0.86, dir2I: 0.30,
      floorBase: 0x9a8f74, grid: 0x3f5a74, gridOp: 0.6,
      surf: 0x3d86c4, surfOp: 0.12, surfGrid: 0x27608f, surfGridOp: 0.5,
      axesLabel: '#33414f', ruler: 0x52708c, rulerLabel: '#48596e',
      /* V3.2：刻度数字描一圈反色光晕。
       * 数字既会压在海面的浅灰网格上，也会压在深蓝海床上；单一颜色不可能
       * 两头都够对比（浅色主题的深蓝灰压在深蓝海床上几乎看不见）。
       * 浅色主题描白边、深色主题描黑边，等于给字加了一层"自动底色"。 */
      rulerLabelHalo: 'rgba(255,255,255,.92)',
      /* 淡蓝 = 发射扇面（tx.hbeam / tx.vbeam）；橙黄 = 接收阵列覆盖（rx.hOpen / rx.vOpen）。
         两组颜色在色相环上分开 180° 左右，叠加成第三色时仍能一眼分清谁是谁。 */
      cone: 0x1f6feb, coneWire: 0x1553b8, coneOp: 0.09,
      /* V2.2：接收楔体的线色刻意取得比"橙黄"更深一档（0xd2691e 深橙）。
         原因是第二批改动把海底默认色标换成了沙土黄（浅黄→深褐），
         而橙黄线框压在浅黄海床上属于"暖色叠暖色"，对比度不够；
         深橙在浅黄底与深褐底上都还能分辨。深色主题下背景本就暗，
         仍用较亮的 0xffb445，不必加深。 */
      rxCone: 0xff9d17, rxConeWire: 0xd2691e, rxConeOp: 0.07,
      gizX: 0xd8342f, gizY: 0x2f9e44, gizZ: 0x2f6fd8,
      /* V3.0：选中目标的「小圈」取深青（比蓝更深一档）。
       * 它要同时压在三种背景上：浅蓝发射扇面、橙黄接收扇面、沙土黄海床。
       * 青色与蓝同相但更暗（与淡蓝扇面能分开），与橙是互补色（与接收扇面对比最强），
       * 与沙土黄的暖色也是冷暖对撞 —— 三种底上都看得清。 */
      selRing: 0x0e7c9b,
      floorDim: 1.0
    },
    dark: {
      /* 深色主题同样做「去雾 + 降环境光 + 提定向光」：雾密度砍到约 1/3，
       * 环境光 0.55 → 0.34、主光 0.45 → 0.72。总照度仍在 0.95~1.0
       * （浅色主题约 1.3，刻意留一档差：水下场景本就该比水上暗），
       * 但坡度对比从 0.41:0.40 提到 0.65:0.27，暗背景下的起伏也读得出来。 */
      bg: 0x08111b, fog: 0x08111b, fogD: 0.0011,
      // 深色主题的总光照刻意压到 ≈1.0（浅色约 1.4）：地形色标本就是亮色调，
      // 再叠 1.4 倍光照会把海床照成一片亮绿色，看上去不像水下。
      amb: 0xc4d8ec, ambI: 0.34, dirI: 0.72, dir2I: 0.22,
      floorBase: 0x6b6250, grid: 0x9fb8cc, gridOp: 0.5,
      surf: 0x2a6fa8, surfOp: 0.12, surfGrid: 0x7fd0ff, surfGridOp: 0.42,
      axesLabel: '#dbe6f2', ruler: 0x4a6a8a, rulerLabel: '#8fb6d8',
      rulerLabelHalo: 'rgba(0,0,0,.78)',
      cone: 0x49d0ff, coneWire: 0x7fe3ff, coneOp: 0.07,
      rxCone: 0xffb445, rxConeWire: 0xffd98a, rxConeOp: 0.055,
      gizX: 0xff6b5e, gizY: 0x63d471, gizZ: 0x6aa6ff,
      // 深色主题下选中圈改用亮青，暗背景上比深青醒目得多
      selRing: 0x49d0ff,
      // 深色主题下把海床整体压暗：地形色标本就是为浅底调的亮色调，
      // 直接铺在暗背景上会变成一片"沙漠"，失去水下场景的观感。
      // V3.1：0.74 → 0.86 —— 环境光已经降下来了，再压 0.26 会让海床糊成一团黑绿。
      floorDim: 0.86
    }
  };
  function T() { return (FLS.Theme && FLS.Theme.isDark()) ? TH.dark : TH.light; }

  /* ---------------------------------------------------------- 初始化 */
  S.init = function (host) {
    S.host = host;
    var w = host.clientWidth || 600, h = host.clientHeight || 400;
    var t = T();
    S.renderer = new THREE.WebGLRenderer({ antialias: true });
    S.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    S.renderer.setSize(w, h);
    S.renderer.setClearColor(t.bg, 1);
    host.appendChild(S.renderer.domElement);

    S.scene = new THREE.Scene();
    S.scene.fog = new THREE.FogExp2(t.fog, t.fogD);
    S.camera = new THREE.PerspectiveCamera(50, w / h, 0.2, 5000);
    S.ambLight = new THREE.AmbientLight(t.amb, t.ambI); S.scene.add(S.ambLight);
    var dl = new THREE.DirectionalLight(0xffffff, t.dirI);
    dl.position.set(0.4, 1, 0.3); S.scene.add(dl); S.dirLight = dl;
    var dl2 = new THREE.DirectionalLight(0x88aacc, t.dir2I);
    dl2.position.set(-0.5, 0.2, -0.6); S.scene.add(dl2); S.dirLight2 = dl2;

    buildAxes();
    buildSeafloor();
    buildSurface();
    buildCone();
    buildRov();
    buildTrack();
    buildScatterers();
    buildMeasure();
    buildGizmo();
    /* V2.2：两个扇面（发射淡蓝 / 接收橙黄）一建好就把几何算出来。
       以前只建 Mesh 不填几何，全指望后续参数变更路径走到 updateCone()——
       万一顺序变了，三维里就留两个空的 Mesh，还查不出为什么。 */
    S.updateCone();
    S.updateRxCone();

    S.renderer.domElement.addEventListener('mousedown', onDown);
    S.renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    S.renderer.domElement.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('resize', function () { S.resize(); });
    S.resize();
  };

  S.resize = function () {
    if (!S.host) return;
    var w = S.host.clientWidth, h = S.host.clientHeight;
    /* V2.0：视图切换后本视口可能是隐藏的（量不到真实尺寸，或只有几像素）。
       此时**不要**去改渲染器尺寸：一旦把相机 aspect 设成 0/NaN，切回来第一帧
       就会画出一张废图。隐藏期间保持上次尺寸，切回来可见时自然会按真实尺寸
       重设（见 app.resizeAll：按当前视图只 resize 可见画布）。 */
    if (w < 8 || h < 8) return;
    S.renderer.setSize(w, h);
    S.camera.aspect = w / h; S.camera.updateProjectionMatrix();
  };

  /* ---------------------------------------------------------- 坐标系 / 标尺 */
  /**
   * 文字标签（Sprite）。
   * 关键点：
   *  ① canvas 必须 clearRect 而不是 fillRect('rgba(0,0,0,0)')——后者在部分浏览器
   *     会留下 alpha=0 但 RGB=0 的像素，经 mipmap 混叠后透明区变成灰黑方块；
   *  ② CanvasTexture 须显式设置 generateMipmaps=false、minFilter=LinearFilter，
   *     否则缩小显示时 mipmap 把四周透明像素与文字混合，标签背后出现暗色矩形；
   *  ③ depthTest=false 保证标签总在物体之前，但要配合 depthWrite=false，
   *     否则标签矩形会写深度、挡住其后的海底（表现为画面里一块纯黑区域）。
   */
  var LABELS = [];        // 所有文字精灵，主题切换时按 tintable 决定是否重绘
  function paintLabel(c, text, color, halo) {
    var x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.font = 'bold 72px sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    /* 先描边、后填字：1024 宽的字面缩到屏幕上只有二三十像素，
     * 光晕会把笔画之间的空隙填掉，所以线宽取 9（约字高的 12%）。 */
    if (halo) {
      x.lineJoin = 'round'; x.lineWidth = 9; x.strokeStyle = halo;
      x.strokeText(text, 128, 64);
    }
    x.fillStyle = color;
    x.fillText(text, 128, 64);
  }
  function mkLabel(text, color, tintable, halo) {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    paintLabel(c, text, color, halo);
    var tex = new THREE.CanvasTexture(c);
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    var spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false, alphaTest: 0.02
    }));
    spr.scale.set(10, 5, 1);
    spr.renderOrder = 999;
    spr.userData = { canvas: c, text: text, tex: tex, tintable: !!tintable, baseColor: color };
    LABELS.push(spr);
    return spr;
  }
  function arrow(dir, color, len) {
    var g = new THREE.Group();
    var line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), dir.clone().multiplyScalar(len)]),
      new THREE.LineBasicMaterial({ color: color }));
    g.add(line);
    var cone = new THREE.Mesh(new THREE.ConeGeometry(len * 0.025, len * 0.07, 10),
      new THREE.MeshBasicMaterial({ color: color }));
    cone.position.copy(dir.clone().multiplyScalar(len));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    g.add(cone);
    return g;
  }
  /* ★ V3.2：坐标轴与标尺的量程改为"跟着 AOI 走"，绝不超过海面 / 海底的跨度。
   *
   * V3.1 及以前写死了两组数：箭头长 40 m、刻度从 −200 到 +200 m（步长 10 m、
   * 每 50 m 一个数字）。而海底与海面的跨度只有 300 m（±150 m）——
   * 于是刻度与数字一路画到海面网格之外，读图时很容易误判"作业区比海面还大"，
   * 也把视口撑得空荡荡（相机为了框住坐标轴，把海床压到画面一角）。
   *
   * 现在全部从海底跨度 SEA_SPANX / SEA_SPANY 推：
   *   · 刻度范围 ±span/2，正好与海面/海底边界重合；
   *   · 步长按"每边 5 个数字"自动从 1/2/5/10/20/25/50… 里挑；
   *   · 箭头取半跨的 0.5 倍（只做方向指示，不需要顶到边界）。
   * 跨度随量程变化 → S.rebuildAxes() 整组重建（见 rebuildTerrain 里对 span 的比较）。 */
  function niceStep(x) {
    var p = Math.pow(10, Math.floor(Math.log(x) / Math.LN10));
    var m = x / p;
    var mult = (m <= 1.2) ? 1 : (m <= 2.2) ? 2 : (m <= 3.5) ? 2.5 : (m <= 5.5) ? 5 : 10;
    return mult * p;
  }
  function buildAxes() {
    S.axes = new THREE.Group();
    S.ruler = new THREE.Group();
    S.axes.add(S.ruler);
    S.scene.add(S.axes);
    S.rebuildAxes();
  }
  /** 按当前海底跨度重建箭头 / 刻度 / 数字（跨度变了才需要重来） */
  S.rebuildAxes = function () {
    if (!S.axes) return;
    /* SEA_SPANX/Y 的 var 声明在文件靠后（函数声明会提升、赋值不会），
     * init() 里首次调 buildAxes 时它们还是 undefined —— 这里兜底成默认 300 m，
     * 等 rebuildTerrain 第一次跑到时会用真实跨度再重建一次。
     * ★ V3.4：刻度是正方形的，故按长宽的**较大者**取（长宽不等时，
     *   短边方向刻度会伸到海床之外，这是可接受的 —— 坐标轴的作用是给尺度参照）。 */
    var spX = (isFinite(SEA_SPANX) && SEA_SPANX > 0) ? SEA_SPANX : 300;
    var spY = (isFinite(SEA_SPANY) && SEA_SPANY > 0) ? SEA_SPANY : 300;
    var span = Math.max(spX, spY);
    var half = span / 2;
    if (S.axesSpan === span) return;                  // 跨度没变，不必重建
    S.axesSpan = span;
    // 清空除 ruler 之外的所有子对象（箭头 / 文字都是每次新建的）
    for (var i = S.axes.children.length - 1; i >= 0; i--) {
      var ch = S.axes.children[i];
      if (ch === S.ruler) continue;
      S.axes.remove(ch);
      if (ch.geometry) ch.geometry.dispose();
      if (ch.material && ch.material.map) ch.material.map.dispose();
      if (ch.material) ch.material.dispose();
    }
    while (S.ruler.children.length) {
      var rc0 = S.ruler.children.pop();
      if (rc0.geometry) rc0.geometry.dispose();
      if (rc0.material && rc0.material.map) rc0.material.map.dispose();
      if (rc0.material) rc0.material.dispose();
    }
    var L = Math.min(half * 0.5, 60);                 // 箭头长度（东西、南北）
    var LU = Math.min(L * 0.6, 24);                   // 天向箭头短一些
    var t = T();
    S.axes.add(arrow(v3(1, 0, 0), 0xff6b6b, L));      // 东 E
    S.axes.add(arrow(v3(0, 1, 0), 0x6bd97a, L));      // 北 N
    S.axes.add(arrow(v3(0, 0, 1), 0x6bb6ff, LU));     // 天 U
    var hc = T().rulerLabelHalo;
    var l1 = mkLabel('E 东', '#ff9a9a', false, hc); l1.position.copy(v3(L + 6, 0, 0)); S.axes.add(l1);
    var l2 = mkLabel('N 北', '#9aefa4', false, hc); l2.position.copy(v3(0, L + 6, 0)); S.axes.add(l2);
    var l3 = mkLabel('U 天', '#9ecbff', false, hc); l3.position.copy(v3(0, 0, LU + 6)); S.axes.add(l3);
    /* ★ V3.2：轴名也登记进"每帧按相机距离定尺寸"的表里。
     * 轴名原来写死 10×5 m —— 俯视全场景时刚好，一放大到 78 m 取景就变成
     * 满屏字的色块。登记后与刻度数字一起做屏幕恒定尺寸。
     *
     * ★★ V3.7 修复：「E 东」标错位置。
     *   这里的 ax 是**同类标签的分路编号**，刻度数字已经占了 0（东西轴）与 1
     *   （南北轴，见下方 S.axisLabels.push({ax:0/1})），轴名却接着写成 1/2/3 ——
     *   于是「E 东」的 ax=1 与"南北轴刻度数字"撞号，落进了 tickLabelSize 里
     *   `o.ax === 1` 那个分支，被摆到 (-0.95hh, 0, -mm)，即**挂在北箭头尖端、
     *   还往西偏** —— 画面上就是"E 东标在了北轴的头上"。
     *   现在轴名统一改用 2/3/4，与刻度数字的 0/1 彻底错开：
     *     ax 0 = 东西轴刻度数字   ax 1 = 南北轴刻度数字
     *     ax 2 = 「E 东」         ax 3 = 「N 北」       ax 4 = 「U 天」
     *   同时「U 天」的 m 记的是真实箭头长 LU（原来记 L，而箭头只有 min(L·0.6,24)，
     *   L=60 时两者差 12 m，字会飘在箭头尖上方十几米处）。 */
    S.axisLabels = [
      { s: l1, ax: 2, m: L }, { s: l2, ax: 3, m: L }, { s: l3, ax: 4, m: LU }
    ];

    /* 刻度：只画到 ±half（= 海面 / 海底边界），不再越界。
     * ★ 起点必须"对齐到步长的整数倍"：先前是从 −half 起按步长加，half = 130、
     *   lab = 50 时标注就成了 −130 / −80 / −30 / 20 / 70 / 120 这种读不出意义的数；
     *   改成从第一个 ≥ −half 的整倍数起算，得到 −100 / −50 / 50 / 100。 */
    var step = niceStep(half / 5);
    var lab = niceStep(half / 2.4);                    // 数字间隔比刻度稀一档
    var pts = [];
    for (var k = Math.ceil(-half / step) * step; k <= half + 1e-6; k += step) {
      pts.push(v3(k, 0, 0), v3(k, -2, 0));             // 东西轴上的短竖线
      pts.push(v3(0, k, 0), v3(-2, k, 0));             // 南北轴上的短横线
    }
    // 边框：把 AOI 的四条边也描出来，读数时一眼看到范围
    pts.push(v3(-half, -half, 0), v3(half, -half, 0));
    pts.push(v3(half, -half, 0), v3(half, half, 0));
    pts.push(v3(half, half, 0), v3(-half, half, 0));
    pts.push(v3(-half, half, 0), v3(-half, -half, 0));
    var g = new THREE.BufferGeometry().setFromPoints(pts);
    var rc = T().ruler;
    S.rulerLine = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: rc }));
    S.ruler.add(S.rulerLine);

    var rlc = T().rulerLabel;
    for (var m = Math.ceil(-half / lab) * lab; m <= half + 1e-6; m += lab) {
      if (Math.abs(m) < 1e-6) continue;                 // 跳过原点：两条轴的 0 会叠在一起
      var lb = mkLabel(m + 'm', rlc, true, hc);
      S.ruler.add(lb);
      S.axisLabels.push({ s: lb, ax: 0, m: m });        // 0 = 东西轴数字，1 = 南北轴数字，2/3/4 留给轴名（见 tickLabelSize）
      var lb2 = mkLabel(m + 'm', rlc, true, hc);
      S.ruler.add(lb2);
      S.axisLabels.push({ s: lb2, ax: 1, m: m });
    }
  };

  /* ★ V3.2：刻度数字改成"屏幕恒定尺寸"。
   * 原来数字的世界尺寸写成 span/26（260 m 跨度下 10 m 高 → 15×9 m 的精灵）。
   * 俯视全场景（相机 400 m 外）读起来正合适；可一旦缩到 78 m 取景，
   * 同一个精灵在屏幕上就变成 190 px 宽的巨大色块 —— 实测截图里
   * 「−50m / 50m」直接糊成了两个「−30m / 20m」的方块，把海底全挡住了。
   * 这里每帧按相机到视点的距离反算高度，使数字在屏幕上恒定约 24 px 高；
   * 位置也跟着一起收，永远贴在轴线外侧一点点。 */
  S.tickLabelSize = function () {
    if (!S.axisLabels || !S.axisLabels.length) return;
    var cp = S.camera.position;
    var hPx = (S.renderer && S.renderer.domElement) ? S.renderer.domElement.clientHeight : 700;
    /* 让字在屏幕上恒定 ≈ 26 px 高：
     *   屏幕像素高 = 世界字高 hh / 距离 d × (H / (2·tan(fov/2)))
     * 反解得 hh = 26 · d · 2·tan(fov/2) / H —— 每个字用自己的距离算，
     * 不能用"相机到视点"的统一距离：俯视时近端与远端的字会差一倍大小。 */
    var k = 26 * 2 * Math.tan(S.camera.fov * DEG / 2) / Math.max(200, hPx);
    for (var i = 0; i < S.axisLabels.length; i++) {
      var o = S.axisLabels[i], s = o.s, mm = o.m;
      /* ★ 这里直接写的是 Three 的世界坐标 (x=E, y=天, z=−北)，不是 v3(e,n,u)。
       *   V3.2 初版误把"北"当成了世界 y，于是北轴的刻度数字全部沉到海底以下
       *   （y = ±100 ≈ 水下 100 m），「N 北」飘到 60 m 高空，「U 天」却贴在
       *   海床上 —— 看上去就是"坐标标注时有时无"。这里按 v3 的映射换算：
       *   N = mm → z = −mm。
       * ★ V3.7：五个分支全部显式列出（原来 ax=2「N 北」漏算 px/pz，
       *   距离是按原点算的，字的大小会跟着相机整体远近漂）。 */
      var px = 0, py = 0, pz = 0;
      if (o.ax === 0) px = mm;                          // 东西轴刻度数字
      else if (o.ax === 1) pz = -mm;                    // 南北轴刻度数字
      else if (o.ax === 2) px = mm;                     // 「E 东」：落在东箭头尖端
      else if (o.ax === 3) pz = -mm;                    // 「N 北」：落在北箭头尖端
      else if (o.ax === 4) py = mm;                     // 「U 天」：落在天箭头尖端
      var dx = cp.x - px, dy = cp.y - py, dz = cp.z - pz;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!isFinite(d) || d <= 0) d = S.cam.dist || 200;
      var hh = Math.max(0.35, Math.min(30, d * k));
      if (o.ax === 1) {                                  // 南北轴上的数字：往西侧让开
        s.scale.set(hh * 1.67, hh, 1);
        s.position.set(-hh * 0.95, 0, -mm);
      } else if (o.ax === 2) {                           // 「E 东」：沿东向再往东一点
        s.scale.set(hh * 2.0, hh, 1);
        s.position.set(mm + hh * 0.6, hh * 0.9, 0);
      } else if (o.ax === 3) {                           // 「N 北」：沿北向再往北一点
        s.scale.set(hh * 2.0, hh, 1);
        s.position.set(0, hh * 0.9, -(mm + hh * 0.6));
      } else if (o.ax === 4) {                           // 「U 天」：沿天向抬起（mm 已是真实箭头长）
        s.scale.set(hh * 2.0, hh, 1);
        s.position.set(0, mm + hh * 0.9, 0);
      } else {                                           // 东西轴上的数字（ax 0）：往南侧让开
        s.scale.set(hh * 1.67, hh, 1);
        s.position.set(mm, -hh * 0.75, hh * 0.6);
      }
    }
  };

  /* ---------------------------------------------------------- 海底地形 */
  // 海底网格范围：取不模糊距离的 2.6 倍并夹在 [260, 900] m，
  // 使最远量程下视锥边缘也不会「悬空」在黑色背景上。
  /* ★ V3.1：网格细化 —— 边数 110 → 220（格距减半）。
   * 260 m 视口下格距 2.36 m → 1.18 m，顶点 12 321 → 48 841、三角面 24 200 → 96 800。
   * 细化的收益有三处看得见：① 沙波 / 礁石这类几米尺度的起伏不再是"折线多边形"；
   * ② 逐顶点深度着色过渡连续，平坦海底不会一块一块跳色；③ 网格线贴合地形更紧。
   * 代价是重建一次要多算 4 倍顶点 —— 这正是 V3.1 同时引入「地形栅格化烘焙」的原因：
   * 有了栅格，48 841 个顶点各自只做一次双线性查表，重建耗时反而比细化前更低。
   * 顶点数超过 65 536，索引自动改用 Uint32（见下方 setIndex 处的说明）。 */
  /* ★ V3.4：海底网格的**尺寸**由 terr.lenX / terr.lenY（海底长 × 宽）给出，
   *   不再由量程推导。边数按目标格距 1.35 m 算（默认 300 m → 222 边
   *   → 223×223 = 49 729 顶点，恰好压在 Uint16 索引的 65 536 上限之内）。
   *   长宽可以不等（狭长作业区），两个方向的边数各自取整。 */
  var SEA_NX = 222, SEA_NY = 222, SEA_SPANX = 300, SEA_SPANY = 300, SEA_CELL = 1.35;
  /** 按当前长宽重算边数（顶点数封顶 65 536，保证能用 Uint16 索引） */
  function seaGridN() {
    var lx = Math.max(20, Math.min(4000, parseFloat(FLS.P['terr.lenX']) || 300));
    var ly = Math.max(20, Math.min(4000, parseFloat(FLS.P['terr.lenY']) || 300));
    var nx = Math.max(40, Math.min(420, Math.ceil(lx / SEA_CELL)));
    var ny = Math.max(40, Math.min(420, Math.ceil(ly / SEA_CELL)));
    // 顶点数 (nx+1)(ny+1) ≤ 65 536 时索引可用 Uint16；越界则等比缩小到 255×255
    while ((nx + 1) * (ny + 1) > 65536 && (nx > 40 || ny > 40)) {
      if (nx >= ny) nx = Math.max(40, Math.round(nx * 0.9)); else ny = Math.max(40, Math.round(ny * 0.9));
    }
    return { nx: nx, ny: ny, lx: lx, ly: ly };
  }
  function buildSeafloor() {
    var gg = seaGridN();
    var nx = SEA_NX = gg.nx, ny = SEA_NY = gg.ny;
    SEA_SPANX = gg.lx; SEA_SPANY = gg.ly;
    var g = new THREE.BufferGeometry();
    var verts = new Float32Array((nx + 1) * (ny + 1) * 3);
    // 逐顶点颜色（按深度着色）：属性一直存在，关闭着色时整片写成同一个底色，
    // 这样不必切换 material.vertexColors（切换会触发着色器重编译、导致闪一下）。
    var vcount = (nx + 1) * (ny + 1);
    var cols = new Float32Array(vcount * 3);
    S.depthArr = new Float32Array(vcount);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    // 逐格生成两个三角形。
    // 注意循环边界必须是 j < ny、i < nx：若写到 j = ny，则 (j+1)*(nx+1)+i 会越过
    // 顶点数组末尾（越界索引被 GPU 当作未定义顶点），表现为地形边缘缺一块
    // 三角形、露出黑色背景。
    // 索引类型按顶点数自动选择：顶点数 ≤ 65536 用 Uint16（无需 OES_element_index_uint
    // 扩展，兼容性最好），否则退化到 Uint32。
    var idx = (vcount <= 65536) ? new Uint16Array(nx * ny * 6) : new Uint32Array(nx * ny * 6), w = 0;
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var v00 = j * (nx + 1) + i, v10 = v00 + 1;
      var v01 = (j + 1) * (nx + 1) + i, v11 = v01 + 1;
      idx[w++] = v00; idx[w++] = v01; idx[w++] = v10;
      idx[w++] = v10; idx[w++] = v01; idx[w++] = v11;
    }
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    // three.js r128 的 setIndex 只接受 BufferAttribute（或普通 Array/数字数组），
    // 直接传 TypedArray 不会包装成 BufferAttribute，会在渲染时崩溃
    // （报 e.onUploadCallback is not a function）。必须显式包一层。
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    var mat = new THREE.MeshLambertMaterial({
      color: 0xffffff, vertexColors: true, side: THREE.DoubleSide
    });
    S.seafloor = new THREE.Mesh(g, mat);
    S.scene.add(S.seafloor);
    // 网格线（间距由 disp.gridStep 决定，按世界坐标对齐，见 rebuildTerrain）
    S.seafloorGrid = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: T().grid, transparent: true, opacity: T().gridOp }));
    S.scene.add(S.seafloorGrid);
    S.normals = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffc36b }));
    S.scene.add(S.normals);
  }

  /* ---- 深度 → 色标位置 t 的映射（V1.4 起随色标换过三代，这里记全账） ----
   * V1.x：t = (d − dmin)/(dmax − dmin)。平坦海底 dmin ≡ dmax → 所有顶点 t = 0，
   *         整片海床被涂成色标最浅端（换成水深色标就是饱和红），错得离谱。
   * V2.1：改成以「视口深度中值」为中心、半宽 = max(落差/2, 4 m) 的对称归一化。
   *         平坦海底落在 t = 0.5 的中段 —— 配当时的「沙土黄」色标（中段是沙色）
   *         恰好正确，问题被掩盖了。
   * V3.1：色标默认换回「水深色标（深蓝→绿→黄→红）」，中段是**绿色**，
   *         于是 200 m 平坦海底被涂成明亮的草绿，在水下场景里完全不像海床。
   *         ★ V3.4：默认色标换成自然地形色、锚点挪到最浅端，平坦海底是亮沙黄。
   *         锚点因此从"中值"挪到"最深点"，详见下段。
   */
  /* ★ V3.1：锚点由「视口深度中值」改为「视口最深点」，理由见下。
   *
   * 换成「水深色标（深蓝→绿→黄→红）」之后，中值锚定会出问题：色标中段是绿色，
   * 于是一片 200 m 的平坦海底被涂成**明亮的草绿**——在水下场景里读起来完全不像海床。
   * 根因是"平坦"把 t 固定在了 0.5，而 0.5 恰好是色标里最不像水的那个位置。
   *
   * 现在改为：视口内**最浅点**对齐色标的浅端（t = 0.06），越深 t 越大，
   * 最深点落到 t = 0.86（深蓝）。与 V3.1 的式子只差一个方向：
   *     V3.1：t = 0.88 − 0.80·(b−d)/span   → 平坦（d≡b）时 t = 0.88（深端）
   *     V3.4：t = 0.06 + 0.80·(d−a)/span   → 平坦（d≡a）时 t = 0.06（浅端）
   *   · 平坦海底：全片 t = 0.06 → 色标浅端，开机即是一片亮沙黄（★ V3.4 需求）；
   *   · 有起伏：浅处偏黄、深处偏蓝，与色标"浅=黄沙、深=蓝"的约定一致；
   *   · 起伏幅度只决定色标被用掉多少，锚点永远落在浅端。
   *
   * 为什么必须换方向：V3.1 选深端锚定，是因为当时的默认色标是「水深色标」
   * （浅=红），深端是深蓝，一片 200 m 平坦海底涂成深蓝"像深水"。
   *         ★ V3.4 反转：锚点挪到最浅端，平坦海底落在亮沙黄。
   * V3.4 把默认换回「自然地形色（浅黄沙→深蓝）」后，深端就变成了**深蓝**，
   * 而用户开机看到的第一眼应该是沙子 —— 深蓝既不像沙子也不像浅海。
   * 参考跨度 8 m 是下限：小于 8 m 的落差仍按 8 m 拉伸，否则 0.3 m 的沙波
   * 也会染满整条色标，看上去像一道深沟。 */
  S.DEPTH_REF_SPAN = 8;
  function depthT(d) {
    var a = S.depthMin, b = S.depthMax;
    if (!isFinite(a) || !isFinite(b)) return 0.06;
    var span = Math.max(b - a, S.DEPTH_REF_SPAN);
    var s = (d - a) / span;              // s = 0 最浅，s = 1 最深
    if (s < 0) s = 0; else if (s > 1) s = 1;
    return 0.06 + 0.80 * s;
  }
  S.depthT = depthT;

  /**
   * 按深度给海床网格逐顶点着色。
   * 真实深度（不受垂直放大影响）经 depthT 映射到色标；关闭着色时整片写主题底色。
   */
  S.recolorSeafloor = function () {
    if (!S.seafloor || !S.depthArr) return;
    var g = S.seafloor.geometry;
    var col = g.attributes.color;
    if (!col) return;
    var arr = col.array, dep = S.depthArr, N = dep.length;
    var on = !!FLS.P['disp.heightColor'];
    var cid = FLS.P['disp.heightCmap'] || 'tdepth';
    if (!on) {
      var base = new THREE.Color(T().floorBase);
      for (var q = 0; q < N; q++) {
        arr[3 * q] = base.r; arr[3 * q + 1] = base.g; arr[3 * q + 2] = base.b;
      }
    } else {
      var dim = T().floorDim || 1;
      for (var i = 0; i < N; i++) {
        var c = FLS.cmapColor(cid, depthT(dep[i]));
        arr[3 * i] = c[0] / 255 * dim;
        arr[3 * i + 1] = c[1] / 255 * dim;
        arr[3 * i + 2] = c[2] / 255 * dim;
      }
    }
    col.needsUpdate = true;
  };

  /** 更新三维视口右下角的深度色标图例 */
  S.updateDepthLegend = function () {
    var box = document.getElementById('depthLegend');
    if (!box) return;
    var bar = document.getElementById('dlBar');
    var top = document.getElementById('dlTop');
    var bot = document.getElementById('dlBot');
    var on = !!FLS.P['disp.heightColor'];
    box.style.display = on ? '' : 'none';
    if (!on) return;
    var cid = FLS.P['disp.heightCmap'] || 'tdepth';
    var dim = T().floorDim || 1;      // 与海床顶点着色保持同一压暗系数
    var a = S.depthMin, b = S.depthMax;
    if (!isFinite(a) || !isFinite(b)) { a = 0; b = 0; }
    /* 图例只画「实际用到的那一段色标」：从 depthT(最浅) 到 depthT(最深) 取样。
       平坦海底时这一段极窄 → 图例显示为一条近纯色，与海床颜色一致，不会骗人。 */
    var t0 = depthT(a), t1 = depthT(b), N = 14, parts = [];
    for (var i = 0; i < N; i++) {
      var t = t0 + (t1 - t0) * (i / (N - 1));
      var c = FLS.cmapColor(cid, t);
      parts.push('rgb(' + Math.round(c[0] * dim) + ',' + Math.round(c[1] * dim) + ',' +
        Math.round(c[2] * dim) + ') ' + Math.round(i / (N - 1) * 100) + '%');
    }
    bar.style.background = 'linear-gradient(to bottom,' + parts.join(',') + ')';
    top.textContent = a.toFixed(1);
    bot.textContent = b.toFixed(1);
    // 色标是按「视口内实际深度区间」归一化的（与声呐显示动态范围自动归一化同理），
    // 因此必须把真实落差 Δ 标出来——否则 0.2 m 的起伏也会染满整条色标，
    // 看上去像一道深沟。
    var dl = document.getElementById('dlDelta');
    if (dl) dl.textContent = 'Δ' + (b - a).toFixed(2);
  };
  S.rebuildTerrain = function (cx, cy) {
    if (cx !== undefined) { S.center[0] = cx; S.center[1] = cy; }
    /* ★ V3.4：网格尺寸由「海底长 × 宽」给出；尺寸变了要**整块重建几何**
     * （顶点数变了，旧的 position/color/index 三者长度都不匹配，不能就地改）。
     * 旧版由 rmax 推导跨度，于是"改量程"会连带改海底大小 —— 那是把两个
     * 独立自由度捆在一起。现在只认长宽。 */
    var gg = seaGridN();
    var spanX = gg.lx, spanY = gg.ly, nx = gg.nx, ny = gg.ny;
    var geomChanged = (nx !== SEA_NX || ny !== SEA_NY || spanX !== SEA_SPANX || spanY !== SEA_SPANY);
    if (geomChanged) {
      SEA_NX = nx; SEA_NY = ny; SEA_SPANX = spanX; SEA_SPANY = spanY;
      var vcount = (nx + 1) * (ny + 1);
      var g = S.seafloor.geometry;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
      var idx = (vcount <= 65536) ? new Uint16Array(nx * ny * 6) : new Uint32Array(nx * ny * 6), w = 0;
      for (var j0 = 0; j0 < ny; j0++) for (var i0 = 0; i0 < nx; i0++) {
        var v00 = j0 * (nx + 1) + i0, v10 = v00 + 1;
        var v01 = (j0 + 1) * (nx + 1) + i0, v11 = v01 + 1;
        idx[w++] = v00; idx[w++] = v01; idx[w++] = v10;
        idx[w++] = v10; idx[w++] = v01; idx[w++] = v11;
      }
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      S.depthArr = new Float32Array(vcount);
    }
    var span = Math.max(spanX, spanY);          // 坐标轴 / 刻度仍按最大跨度取（刻度是正方形的）
    /* V3.2：跨度变了则整组重建坐标轴 / 刻度（量程 120 m 时旧刻度会伸到海面之外） */
    if (S.rebuildAxes) S.rebuildAxes();
    var c0 = S.center[0], c1 = S.center[1];
    /* ★ V3.1：重建前先保证地形栅格就位（缺栅格 / 中心漂出余量 → 就地重烘焙）。
     * 必须放在取深度**之前**：否则这一轮几万个顶点全走解析分支，
     * 而栅格其实只需要重算一次就够了。烘焙只涉及「已融入」的层，
     * 正在调属性的「待确认」层不进栅格，照旧逐顶点解析求值（要的就是实时）。 */
    if (FLS.Terrain && FLS.Terrain.ensureBake) FLS.Terrain.ensureBake(c0, c1);
    var pos = S.seafloor.geometry.attributes.position.array;
    var hsx = spanX / nx, hsy = spanY / ny;
    // 垂直放大：仅用于三维视口显示。海底起伏（沙波波高常仅 0.3~2 m）相对
    // 水平尺度（波长十几米、视口跨度数百米）极小，在等轴测视角下几乎看不出来。
    // 这里以视口中心真实深度为不动点，把「偏离中心的起伏量」放大 zex 倍，
    // 既保证起伏可见，又不会让整片海床整体上浮/下沉。
    // 注意：Terrain.depth() 及其派生的面元深度、散射法向、传播时延、成像
    // 全部使用真实深度，不受此参数影响。
    var zex = Math.max(1, parseFloat(FLS.P['disp.zexag']) || 1);
    var dRef = FLS.Terrain.depth(c0, c1);
    function zDisp(x, y) { return -(dRef + (FLS.Terrain.depth(x, y) - dRef) * zex); }
    S.zDisp = zDisp;                     // V1.3：航路标记等也需按同一放大规则显示
    // 真实深度单独留存一份：着色与图例必须用真实值，不能用被 zexag 拉伸过的显示值
    var dmin = Infinity, dmax = -Infinity;
    for (var j = 0; j <= ny; j++) {
      for (var i = 0; i <= nx; i++) {
        var x = c0 - spanX / 2 + i * hsx, y = c1 - spanY / 2 + j * hsy;
        var dep = FLS.Terrain.depth(x, y);
        S.depthArr[j * (nx + 1) + i] = dep;
        if (dep < dmin) dmin = dep;
        if (dep > dmax) dmax = dep;
        var z = zDisp(x, y);
        var k = (j * (nx + 1) + i) * 3;
        pos[k] = x; pos[k + 1] = z; pos[k + 2] = -y;      // three: x=E, y=U, z=−N
      }
    }
    // 深度区间做一点收边，避免个别尖峰把整片颜色压成同一档
    S.depthMin = isFinite(dmin) ? dmin : 0;
    S.depthMax = isFinite(dmax) ? dmax : 1;
    // 平坦海底（dmin≈dmax）不强行拉区间：图例上下限相同即「整片同深」，
    // 若人为撑开成 32.0~32.5 反而像是地形有 0.5 m 起伏，属于误导。
    S.seafloor.geometry.attributes.position.needsUpdate = true;
    S.seafloor.geometry.computeVertexNormals();
    S.seafloor.geometry.computeBoundingSphere();
    S.recolorSeafloor();
    // V1.3：海床高度变了（地形编辑 / 改垂直放大 / 移视口中心），航路标记要跟着重挂
    if (S.routeGroup) S.updateRoute();

    /* ---- 海底网格线：按世界坐标间距（disp.gridStep，单位 m）对齐 ----
       旧的写法是「每 5 个网格单元画一条」，间距随网格边数变化，
       改变量程后网格疏密会跟着变，读不出真实尺度。这里改成按 ENU 整米对齐，
       网格线本身沿海床起伏采样，贴着地形走。
       ★ V3.4：间距下限放到 1 m（旧版选项是 5/10/20/50）。 */
    var gstep = parseFloat(FLS.P['disp.gridStep']) || 2;
    if (gstep < 1) gstep = 2;
    var x0 = c0 - spanX / 2, x1 = c0 + spanX / 2, y0 = c1 - spanY / 2, y1 = c1 + spanY / 2;
    // 采样步长取单元尺寸的 2 倍：既能贴合起伏，又不至于顶点数爆炸
    var ds = Math.max(gstep / 6, Math.max(hsx, hsy) * 2);
    var gp = [];
    var sx, sy, px, py;
    for (sx = Math.ceil(x0 / gstep) * gstep; sx <= x1 + 1e-6; sx += gstep) {
      for (sy = y0; sy < y1 - 1e-9; sy += ds) {
        py = Math.min(y1, sy + ds);
        gp.push([sx, sy], [sx, py]);
      }
    }
    for (sy = Math.ceil(y0 / gstep) * gstep; sy <= y1 + 1e-6; sy += gstep) {
      for (sx = x0; sx < x1 - 1e-9; sx += ds) {
        px = Math.min(x1, sx + ds);
        gp.push([sx, sy], [px, sy]);
      }
    }
    var arr = new Float32Array(gp.length * 3);
    for (var q = 0; q < gp.length; q++) {
      var x2 = gp[q][0], y2 = gp[q][1];
      // 抬 0.28 m：垂直放大后起伏被拉高，抬得太少会让网格线钻进海床面被深度剔除
      arr[3 * q] = x2; arr[3 * q + 1] = zDisp(x2, y2) + 0.28; arr[3 * q + 2] = -y2;
    }
    S.seafloorGrid.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    S.seafloorGrid.geometry.computeBoundingSphere();
    S.gridCount = gp.length / 2;
    // 法向量：与「被画出来的那张面」保持一致 —— 垂直放大后，显示的法向也要按
    // 同样倍率缩放水平分量，否则箭头会明显不垂直于可见海床面。
    // 需要强调的是：散射计算用的仍是 FLS.Terrain.normalAt() 的真实法向，
    // 这里的箭头在 zexag≠1 时只代表放大后曲面的朝向，不代表物理法向。
    var np = [];
    for (var a2 = 6; a2 <= nx; a2 += 12) {
      for (var b2 = 6; b2 <= ny; b2 += 12) {
        var x3 = c0 - spanX / 2 + a2 * hsx, y3 = c1 - spanY / 2 + b2 * hsy;
        var z3 = zDisp(x3, y3);
        var nn = FLS.Terrain.normalAt(x3, y3, 0.6);
        // 由真实法向 n=(nx,ny,nz) 反推水平梯度，再按 zex 放大竖直梯度的影响
        var gx = zex * (nn.x / Math.max(1e-6, nn.z));
        var gy = zex * (nn.y / Math.max(1e-6, nn.z));
        var nl = Math.sqrt(gx * gx + gy * gy + 1);
        np.push(v3(x3, y3, z3), v3(x3 + gx / nl * 3, y3 + gy / nl * 3, z3 + 3 / nl));
      }
    }
    var narr = new Float32Array(np.length * 3);
    for (var q2 = 0; q2 < np.length; q2++) { narr[3 * q2] = np[q2].x; narr[3 * q2 + 1] = np[q2].z; narr[3 * q2 + 2] = -np[q2].y; }
    S.normals.geometry.setAttribute('position', new THREE.BufferAttribute(narr, 3));
    S.normals.geometry.computeBoundingSphere();
    S.rebuildSurface();
    S.updateDepthLegend();
    S.needTerrain = false;
  };
  /**
   * 海面：半透明蓝色面 + 网格线（V1.1）。
   * 设计取舍：既要「看得见海面」，又不能把水下场景糊住，因此
   *   ① 面本身双面可见、低不透明度、关闭深度写入（永远不遮挡海底与声呐扇面）；
   *   ② 另画一层网格线给出明确的海面位置与尺度感——即使相机在水下，
   *      抬头也能看到海面网格，深度一目了然。
   * 注意 PlaneGeometry 默认法线朝 +Z，绕 x 轴转 +90° 后朝 −Y（向下）；
   * 用 DoubleSide 时朝向下不影响可见性，只影响光照（Basic 材质不受影响）。
   */
  function buildSurface() {
    var t = T();
    var g = new THREE.PlaneGeometry(1, 1, 1, 1);
    var m = new THREE.MeshBasicMaterial({
      color: t.surf, transparent: true, opacity: t.surfOp,
      side: THREE.DoubleSide, depthWrite: false
    });
    S.surface = new THREE.Mesh(g, m);
    S.surface.rotation.x = Math.PI / 2;
    S.surface.position.y = 0;
    S.surface.renderOrder = -1;
    S.scene.add(S.surface);
    S.surfaceGrid = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: t.surfGrid, transparent: true, opacity: t.surfGridOp }));
    S.surfaceGrid.renderOrder = 0;
    S.scene.add(S.surfaceGrid);
  }

  /** 海面范围与网格随海底跨度一起更新 */
  S.rebuildSurface = function () {
    if (!S.surface) return;
    /* ★ V2.2：海面与海底取**同一跨度**。
       原来海面多取 15%（跨度×1.15），本意是让边缘更"兜得住"，实际后果是：
       在贴边视角下能看到海面比海底多出一圈悬空的边框，读图时会误以为水面
       的无风区比海床分布更广（还容易把海面外侧那圈当成边界突变的假地形）。
       俯视图里尤其明显——两张面的轮廓不重合，比例感全错。
       现在两面对齐同一 AOI（area of interest），网格线也用同一间距，
       水下场景才是"夹在海面与海底之间的一整块水体"。 */
    var spanX = SEA_SPANX || 300, spanY = SEA_SPANY || 300;
    var c0 = S.center[0], c1 = S.center[1];
    S.surface.scale.set(spanX, spanY, 1);
    S.surface.position.set(c0, 0, -c1);
    /* ★ V3.4：海面网格间距用**自己的**参数 disp.surfGridStep（默认 5 m）。
       旧版与海底共用 disp.gridStep 又被 max(5,·) 钳住，于是海底设 2 m 时
       海面仍是 5 m —— 用户改了海底网格、海面纹丝不动，看着像没生效。 */
    var stp = Math.max(1, parseFloat(FLS.P['disp.surfGridStep']) || 5);
    var x0 = c0 - spanX / 2, x1 = c0 + spanX / 2, y0 = c1 - spanY / 2, y1 = c1 + spanY / 2;
    var pts = [], sx, sy;
    for (sx = Math.ceil(x0 / stp) * stp; sx <= x1 + 1e-6; sx += stp) pts.push(v3(sx, y0, 0), v3(sx, y1, 0));
    for (sy = Math.ceil(y0 / stp) * stp; sy <= y1 + 1e-6; sy += stp) pts.push(v3(x0, sy, 0), v3(x1, sy, 0));
    var arr = new Float32Array(pts.length * 3);
    for (var i = 0; i < pts.length; i++) { arr[3 * i] = pts[i].x; arr[3 * i + 1] = pts[i].y; arr[3 * i + 2] = pts[i].z; }
    S.surfaceGrid.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    S.surfaceGrid.geometry.computeBoundingSphere();
  };

  /* ---------------------------------------------------------- 声呐扫描扇面
   * V1.1：本系统定位为「一维水平线阵前视声呐」，扫描范围不是绕轴旋转对称的
   * 圆锥，而是：
   *   水平维 = 发射水平开角（tx.hbeam，由一维线阵方位维波束形成细分）
   *   垂直维 = 发射垂直开角（tx.vbeam，一维线阵不形成俯仰波束，只有这一层）
   * 因此三维示意画成一块「扇形楔体」——水平铺开、垂直很薄，
   * 并叠加方位波束分割线与等距离弧，直观对应右侧的方位-距离扇形图。
   */
  function buildWedge(ck, cwk, op, wireOp) {
    var t = T();
    // 实体透明度保持很低：它体积大、又贴着相机，
    // 透明度稍高就会把海底和目标的立体感整体「洗白」。
    var mesh = new THREE.Mesh(new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: t[ck], transparent: true, opacity: t[op], side: THREE.DoubleSide, depthWrite: false }));
    /* V2.2：线框透明度单独给 —— 用户要的是"框图"（靠轮廓认范围），所以线框才是
       主要可读元素，实体的角色只是把那一块空间轻微染个色。接收楔体比发射楔体
       多一层垂直张开（rx.vOpen 通常 40°~60° > tx.vbeam 20°），线条更稀，
       透明度低一档就会看不清，故单独给 0.62。 */
    var wire = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: t[cwk], transparent: true, opacity: wireOp || 0.5 }));
    S.scene.add(mesh); S.scene.add(wire);
    return { mesh: mesh, wire: wire };
  }
  function buildCone() {
    var w = buildWedge('cone', 'coneWire', 'coneOp', 0.5);
    S.cone = w.mesh; S.coneWire = w.wire;
    /* V2.2：接收阵列覆盖范围（橙黄楔体）。发射扇面是"我能照多宽"，接收覆盖是
       "单个阵元 / 整个接收阵能听多宽" —— 两者互不相等，叠加后的交叠区才是
       真正的有效探测区。以前只画了发射那一层，接收端（面板里明明有
       rx.hOpen / rx.vOpen 两个参数）在三维里却没有任何对应图形。 */
    var w2 = buildWedge('rxCone', 'rxConeWire', 'rxConeOp', 0.62);
    S.rxCone = w2.mesh; S.rxConeWire = w2.wire;
  }
  /**
   * 生成一块扇形楔体的几何（局部坐标 x=右、y=上、z=前）。
   * @param hH 水平半开角(rad)  @param vH 垂直半开角(rad)  @param R 半径(m)
   * @param opt { NA:水平细分数, beams:方位波束分割线角度数组(可空), arcs:等距离弧比例数组 }
   */
  function wedgeGeom(hH, vH, R, opt) {
    opt = opt || {};
    var NA = opt.NA || 48, verts = [], wire = [];
    function pt(a, e, r) {
      r = (r === undefined) ? R : r;
      return new THREE.Vector3(r * Math.cos(e) * Math.sin(a), r * Math.sin(e), r * Math.cos(e) * Math.cos(a));
    }
    function tri(a, b, c) { verts.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); }
    function seg(a, b) { wire.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    var O = new THREE.Vector3(0, 0, 0);
    var i, a0, a1;
    for (i = 0; i < NA; i++) {
      a0 = -hH + 2 * hH * i / NA; a1 = -hH + 2 * hH * (i + 1) / NA;
      tri(O, pt(a0, vH), pt(a1, vH));          // 上扇面
      tri(O, pt(a1, -vH), pt(a0, -vH));        // 下扇面
      var p00 = pt(a0, -vH), p01 = pt(a0, vH), p10 = pt(a1, -vH), p11 = pt(a1, vH);
      tri(p00, p11, p10); tri(p00, p01, p11);  // 远端面
      seg(p00, p10); seg(p01, p11);            // 远端上下缘弧
    }
    var L1 = pt(-hH, -vH), L2 = pt(-hH, vH), R1 = pt(hH, -vH), R2 = pt(hH, vH);
    seg(O, L1); seg(O, L2); seg(O, R1); seg(O, R2);
    seg(L1, L2); seg(R1, R2);
    seg(O, pt(0, 0));                          // 中心艏向线
    (opt.beams || []).forEach(function (th) {
      if (Math.abs(th) > hH - 1e-6) return;
      seg(O, pt(th, 0));
    });
    (opt.arcs || []).forEach(function (f) {
      for (var k = 0; k < NA; k++) {
        var b0 = -hH + 2 * hH * k / NA, b1 = -hH + 2 * hH * (k + 1) / NA;
        seg(pt(b0, 0, R * f), pt(b1, 0, R * f));
      }
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    g.computeVertexNormals();
    var gw = new THREE.BufferGeometry();
    gw.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wire), 3));
    return { solid: g, wire: gw };
  }
  function applyWedge(mesh, wire, geo) {
    mesh.geometry.dispose(); mesh.geometry = geo.solid;
    wire.geometry.dispose(); wire.geometry = geo.wire;
  }
  S.updateCone = function () {
    var R = FLS.P['alg.rmax'];
    // 水平：发射开角与成像扇角取小者作为「有效扫描扇面」
    var hDeg = Math.min(FLS.P['tx.hbeam'], FLS.P['alg.sector']);
    var hH = hDeg * DEG / 2, vH = FLS.P['tx.vbeam'] * DEG / 2;
    // 方位波束分割线（对应一维线阵形成的方位波束，最多 16 条以免过密）
    var sec = FLS.P['alg.sector'] * DEG / 2;
    var nB = Math.max(2, FLS.P['alg.nBeam'] | 0);
    var every = Math.max(1, Math.ceil(nB / 16));
    var beams = [];
    for (var i = 0; i < nB; i += every) beams.push(-sec + 2 * sec * i / (nB - 1));
    applyWedge(S.cone, S.coneWire, wedgeGeom(hH, vH, R, {
      NA: 48, beams: beams, arcs: [0.25, 0.5, 0.75, 1.0]
    }));
  };
  /**
   * V2.2：接收阵列覆盖范围。三个量怎么取，说清楚以免误读：
   *   水平 —— min(阵元水平指向性开角 rx.hOpen, 成像扇角 alg.sector)。
   *           一维线阵本身是全向 atravess（仅在方位维做波束形成），真正限制
   *           它能听多宽的是**单个阵元自身的水平指向性**；而波束形成只在
   *           alg.sector 内扫描，超出扇区的方位即便有回波也不会被成像。
   *   垂直 —— 阵元垂直指向性开角 rx.vOpen。完全不做俯仰维波束形成，
   *           垂直覆盖由这一项单独决定（这也是前视声呐垂直维分辨率差的原因）。
   *   半径 —— 最大探测距离 alg.rmax，与发射扇面同长，便于直接比对两张扇面。
   */
  S.updateRxCone = function () {
    var R = FLS.P['alg.rmax'];
    var hH = Math.min(FLS.P['rx.hOpen'], FLS.P['alg.sector']) * DEG / 2;
    var vH = FLS.P['rx.vOpen'] * DEG / 2;
    /* V2.2：等距离弧由 2 条加到 3 条（1/3、2/3、1）。
       接收楔体没有方位波束分割线（阵元指向性是一条平滑包络，不存在"波束分割"），
       线比发射楔体稀一半，压在沙土黄海床上容易只剩一条轮廓。补一条弧既补齐了
       距离刻度感，也让"橙黄框图"真正读得出是一块**范围**而不是一条线。 */
    applyWedge(S.rxCone, S.rxConeWire, wedgeGeom(hH, vH, R, { NA: 40, arcs: [1 / 3, 2 / 3, 1.0] }));
  };

  /* ---------------------------------------------------------- ROV 与声呐阵 */
  function buildRov() {
    S.rovGroup = new THREE.Group();
    var parts = FLS.Models.TYPES.rov.build();
    parts.forEach(function (p) {
      var m = new THREE.Mesh(p.geom, new THREE.MeshLambertMaterial({ color: p.color }));
      S.rovGroup.add(m);
    });
    // 艏向箭头
    var ag = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 4)]);
    S.rovArrow = new THREE.Line(ag, new THREE.LineBasicMaterial({ color: 0xffe08a }));
    S.rovGroup.add(S.rovArrow);
    S.scene.add(S.rovGroup);
    // 阵元标记
    var eg = new THREE.BufferGeometry();
    S.elemPts = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0x8fe0ff, size: 0.35 }));
    S.scene.add(S.elemPts);
  }

  /** 依据 ENU 位姿计算本体三轴（艏向/右舷/天向） */
  S.bodyAxes = function (pose) {
    var psi = pose.heading * DEG, th = pose.pitch * DEG, ph = pose.roll * DEG;
    var cp = Math.cos(psi), sp = Math.sin(psi), ct = Math.cos(th), st = Math.sin(th);
    var f = [sp * ct, cp * ct, st];                       // 艏向 (E,N,U)
    var r0 = [cp, -sp, 0];                                 // 右舷（水平）
    var u0 = [r0[1] * f[2] - r0[2] * f[1], r0[2] * f[0] - r0[0] * f[2], r0[0] * f[1] - r0[1] * f[0]];
    var cr = Math.cos(ph), sr = Math.sin(ph);
    var r = [cr * r0[0] - sr * u0[0], cr * r0[1] - sr * u0[1], cr * r0[2] - sr * u0[2]];
    var up = [sr * r0[0] + cr * u0[0], sr * r0[1] + cr * u0[1], sr * r0[2] + cr * u0[2]];
    return { fwd: f, right: r, up: up };
  };

  /* ==================================================================
   * V2.2：声呐本体轴 = ROV 本体轴 ⊕ 固定安装俯仰角 rov.tilt
   * ==================================================================
   * 前视声呐由基座刚性固定在 ROV 艏部，两者之间有一个**常值**俯仰安装角
   * （正值 = 声呐艏向下压）。它不是一个随仿真漂移的量：安装角一旦设定，
   * 声呐指向就唯一由「ROV 当前姿态 ⊕ 这个常值」决定。
   *
   * 几何推导：绕右舷轴 right 把艏向旋 t 度。
   *     fwd_s  =  cos(t)·fwd − sin(t)·up      （t>0 → 艏向下压，扇面照向海底）
   *     up_s   =  sin(t)·fwd + cos(t)·up
   *     right_s = right                        （绕 right 轴旋转，右舷轴不变）
   * 三者保持正交归一，手性不变（right × up_s = −fwd_s），可直接喂给 makeBasis。
   *
   * 由此得到的效果：
   *   ① 三维里淡蓝发射扇面 / 橙黄接收扇面跟着一起俯仰 —— 所见即所得；
   *   ② 99-app 组装 job 时也取这套轴（job.fwd/right/up 与阵元排列轴），
   *      所以内核的成像平面同样被压向 / 抬离海底，两者不会各说各话；
   *   ③ rov.pitch 变化时两者叠加：实际俯视角 = rov.pitch − rov.tilt。
   */
  S.sonarAxes = function (pose, noAlgTilt) {
    var ax = S.bodyAxes(pose);
    /* ★ V3.3：把「成像平面俯仰」（alg.tilt）并入安装角一起旋转。
       它旋转的是**声呐看向哪里**：发射/阵元的指向性、以及三维里那个淡蓝扇面。
       为什么不旋面元、也不旋聚焦点（noAlgTilt=true 的那一份）：
       本机是一维水平线阵，绕右舷轴旋转既不改变阵元位置、也不改变来波在阵轴上的
       投影，接收波束形成对它是**免疫**的；而海底面元本来就躺在真实海底上，
       不会因为把头低下去就整体挪位置（照到哪里是权重问题，不是几何问题）。
       实测把两者也一起转，会让每个面元的等斜距解发生 0.1 m 量级的错位，
       与距离门错开 1/3 个单元，图像被"散焦"压暗 40%（幅度和 Σ|A| 反而上升 24%）。
       所以这里给出可选参数：三维/指向性用含俯仰的轴，面元与聚焦用不含俯仰的轴。 */
    var t = ((parseFloat(FLS.P['rov.tilt']) || 0) +
      (noAlgTilt ? 0 : (parseFloat(FLS.P['alg.tilt']) || 0))) * DEG;
    if (!t) return ax;
    var ct = Math.cos(t), st = Math.sin(t), i;
    var f = [], u = [];
    for (i = 0; i < 3; i++) {
      f[i] = ct * ax.fwd[i] - st * ax.up[i];
      u[i] = st * ax.fwd[i] + ct * ax.up[i];
    }
    return { fwd: f, right: ax.right, up: u };
  };
  /** 由 ENU 本体三轴构造 three 的右手基（模型 +z = 艏向，见 updateRov 里的说明） */
  function basisMatrix(ax) {
    return new THREE.Matrix4().makeBasis(
      new THREE.Vector3(-ax.right[0], -ax.right[2], ax.right[1]),  // 模型 x → 左舷
      new THREE.Vector3(ax.up[0], ax.up[2], -ax.up[1]),            // 模型 y → 天向
      new THREE.Vector3(ax.fwd[0], ax.fwd[2], -ax.fwd[1])          // 模型 z → 艏向
    );
  }

  /** 更新 ROV 位姿 / 视锥 / 阵元标记 */
  S.updateRov = function (pose, elemWorld) {
    var ax = S.bodyAxes(pose);
    var p = v3(pose.x, pose.y, pose.z);
    S.rovGroup.position.copy(p);
    /* ★ V1.3 修复：本体基必须构成右手系，否则姿态整体丢失。
     *
     * 本系统所有模型（ROV、UUV、沉船、飞机…）一律按「+z 为艏向、+y 为天向」建模，
     * 于是模型局部 z 必须映射到艏向 fwd。但 ENU 下 (right, up, fwd) 是**左手基**：
     *     right × up = −fwd   （行列式 = −1）
     * 而 THREE.Matrix4.makeBasis() 要求右手基，three 的 Quaternion.setFromRotationMatrix()
     * 无法表示反射，会退化成一个模长 0.707 的非单位四元数 —— 表现为
     * ROV 模型与声呐扫描扇区被整体缩放 0.5、旋转完全丢失：
     * 无论航向角、横滚角怎么调，三维里的扫描扇区都纹丝不动（这正是 V1.3 报告的现象）。
     *
     * 取 (−right, up, fwd) 即为右手基（(−right) × up = fwd，行列式 = +1），
     * 且模型局部 z 仍对应艏向。代价是模型局部 +x 指向左舷而非右舷；
     * 本系统所有模型左右对称，视觉上完全等价。 */
    S.rovGroup.quaternion.setFromRotationMatrix(basisMatrix(ax));
    // 两个扇面跟着「本体 + 安装俯仰角」走，ROV 模型本身不带安装角
    var sq = new THREE.Quaternion().setFromRotationMatrix(basisMatrix(S.sonarAxes(pose)));
    [S.cone, S.coneWire, S.rxCone, S.rxConeWire].forEach(function (o) {
      if (!o) return;
      o.position.copy(p);
      o.quaternion.copy(sq);
    });
    if (elemWorld) {
      var arr = new Float32Array(elemWorld.length);
      for (var i = 0; i < elemWorld.length / 3; i++) {
        arr[3 * i] = elemWorld[3 * i];
        arr[3 * i + 1] = elemWorld[3 * i + 2];
        arr[3 * i + 2] = -elemWorld[3 * i + 1];
      }
      S.elemPts.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      S.elemPts.geometry.computeBoundingSphere();
    }
    S.rovPose = pose; S.rovAxes = ax;
  };

  /* ---------------------------------------------------------- 目标实例 */
  S.syncTargets = function () {
    var seen = {};
    FLS.state.targets.forEach(function (tg) {
      seen[tg.id] = 1;
      var obj = S.targetObjs[tg.id];
      if (!obj) {
        var g = new THREE.Group();
        var parts = FLS.Models.TYPES[tg.type].build(tg.opts || {});
        parts.forEach(function (p) {
          var m = new THREE.Mesh(p.geom, new THREE.MeshLambertMaterial({ color: p.color }));
          g.add(m);
        });
        g.userData.parts = parts;
        g.userData.tid = tg.id;
        S.scene.add(g);
        S.targetObjs[tg.id] = g;
      }
      var o = S.targetObjs[tg.id];
      o.position.set(tg.pos.e, tg.pos.u, -tg.pos.n);
      o.rotation.set(0, 0, 0);
      /* ★ V1.3 修复：与 ROV 采用同一套基（−right, up, fwd），右手系。
       * 原基把模型局部 z 映射到 −fwd，而所有目标模型都按「+z 为艏向」建模，
       * 于是沉船艏段、UUV 半球头、飞机机鼻在三维里一律**朝后**；
       * 且原基的 x 轴在 yaw≠0 时落在左舷，等于把航向旋转方向也弄反了。
       * 新基：x→左舷、y→天向、z→艏向（模型 +z 前，与建模约定一致）。 */
      var cy = Math.cos(tg.att.yaw * DEG), sy = Math.sin(tg.att.yaw * DEG);
      o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
        new THREE.Vector3(-cy, 0, -sy),   // 模型 x 轴 → 左舷（右手基要求）
        new THREE.Vector3(0, 1, 0),       // 模型 y 轴 → 天向
        new THREE.Vector3(sy, 0, -cy)     // 模型 z 轴 → 艏向
      ));
      // 叠加俯仰/横滚（绕本体轴）。抬头 = 艏向朝天向偏 → 绕局部 x 转 −pitch；
      // 右滚 = 右舷下沉（天向朝右舷倾，即朝 −x_local 偏）→ 绕局部 z 转 +roll。
      o.rotateX(-tg.att.pitch * DEG);
      o.rotateZ(tg.att.roll * DEG);
      var sc = tg.scale || 1;
      o.scale.set(sc, sc, sc);
      // V3.0：目标不再有「隐藏 / 显示」态（该功能整体删除），恒可见
      o.visible = true;
      if (!S.boxes[tg.id]) {
        var bb = new THREE.BoxHelper(o, 0xffc36b);
        S.scene.add(bb); S.boxes[tg.id] = bb;
      }
      S.boxes[tg.id].visible = !!FLS.state.display.bbox;
      S.boxes[tg.id].update();
    });
    Object.keys(S.targetObjs).forEach(function (id) {
      if (!seen[id]) {
        S.scene.remove(S.targetObjs[id]);
        if (S.boxes[id]) { S.scene.remove(S.boxes[id]); delete S.boxes[id]; }
        delete S.targetObjs[id];
      }
    });
    S.updateSelection();
  };
  S.updateSelection = function () {
    if (S.selBox) { S.scene.remove(S.selBox); S.selBox = null; }
    var sel = FLS.state.sel;
    if (sel && sel.kind === 'target' && S.targetObjs[sel.id]) {
      S.selBox = new THREE.BoxHelper(S.targetObjs[sel.id], 0x49d0ff);
      S.scene.add(S.selBox);
    }
    /* V3.0：选中目标的「小圈」与它旁边的三维坐标标签。
     * 两者都在 updateSelOverlay()（每帧）里刷新位置，这里只保证宿主已建好
     * 并把半径缓存作废 —— 换选中的目标后必须重算半径。 */
    if (!S.selRing) buildSelRing();
    if (!S.selLabel) buildSelLabel();
    S.selRingKey = null;                 // 作废半径缓存，下一帧按新目标重算
    S.updateSelOverlay();
    S.updateGizmo();
  };

  /* ==================================================================
   * V3.0：选中目标的「小圈 + 三维坐标」
   * ------------------------------------------------------------------
   * 原先选中一个目标，三维里只多出一个青色包围盒（BoxHelper）。问题是：
   * 包围盒是个方盒子，而目标往往只有几十个像素大，盒子套在它外面几乎
   * 看不出"套住的是谁"；更关键的是**没法读数** —— 要知道目标在哪，只能
   * 回头去左栏属性里看 E/N/U 三个数，摆位全靠猜。
   *
   * 现在两样都给：
   *   ① 小圈 —— 双层圆环（外环实、内环淡），始终正对相机（billboard），
   *      半径 = 目标包围球半径 × 1.25（下限 1.5 m，免得小鱼雷的圈小到看不见）。
   *      因为正对相机，它读起来是"一个套住目标的圈"而不是"一个斜插在空间里的环"。
   *   ② 坐标标签 —— 贴在主视口上的 HTML 标签，显示 E / N / U 三个数，
   *      位置 = 目标中心投影到屏幕的位置。
   *
   * 两者都每帧刷新，所以**拖动目标时圈跟着走、数字跟着跳**，
   * 可以直接照着数字把目标摆到指定的 ENU 坐标上，不用在三维和左栏之间来回对。
   *
   * ★ 为什么要 depthTest:false —— 圈是用来"标记"的，不是场景里的实物。
   *   若参与深度测试，目标一被地形或另一个目标挡住，圈就断成一截一截，
   *   反而看不出选中了什么。关掉深度测试 + renderOrder 提到最高，
   *   保证任何视角下都是一个完整的圈。
   * ================================================================== */
  function buildSelRing() {
    var t = T(), col = t.selRing || 0x49d0ff;
    var g = new THREE.Group();
    var mkMat = function (op) {
      return new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: op, side: THREE.DoubleSide,
        depthTest: false, depthWrite: false
      });
    };
    /* 外环做成**四段带缺口的弧**（每段 78°、间隔 12°），读起来像瞄准环/取景框，
     * 比一个完整的圆更容易和场景里本来就有的圆形（扇面、等距弧）区分开。
     * 内环保持完整一圈但更淡更细，提供"套住"的整体感。 */
    var SEG = 4, gap = 12 * DEG, span = (2 * Math.PI / SEG) - gap;
    for (var i = 0; i < SEG; i++) {
      var a0 = i * 2 * Math.PI / SEG + gap / 2;
      g.add(new THREE.Mesh(new THREE.RingGeometry(0.945, 1.0, 18, 1, a0, span), mkMat(0.95)));
    }
    g.add(new THREE.Mesh(new THREE.RingGeometry(0.845, 0.868, 64), mkMat(0.40)));
    // 中心一个小点，便于在目标本身看不清时也能确定"选中点在哪"
    g.add(new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), mkMat(0.85)));
    g.renderOrder = 999;
    g.visible = false;
    S.scene.add(g);
    S.selRing = g;
  }

  /** 坐标标签的宿主是主视口 #view3d（mini 视口是主画面的像素拷贝，贴不上去，
   *  也不需要 —— 驾驶时看主视口就够了）。 */
  function buildSelLabel() {
    var host = document.getElementById('view3d');
    if (!host) return;
    var d = document.createElement('div');
    d.className = 'sel3d-tag';
    host.appendChild(d);
    S.selLabel = d;
  }

  /**
   * 每帧刷新：圈的朝向（billboard）、位置、半径，以及标签的屏幕位置与数值。
   * 半径只在「目标变了 / 缩放变了」时重算 —— Box3.setFromObject 要遍历
   * 模型全部顶点（现在的模型有五千个三角面），每帧算白白浪费。
   */
  S.updateSelOverlay = function () {
    var sel = FLS.state.sel;
    var tg = (sel && sel.kind === 'target')
      ? FLS.state.targets.filter(function (x) { return x.id === sel.id; })[0] : null;
    var obj = tg ? S.targetObjs[tg.id] : null;
    if (!S.selRing || !tg || !obj) {
      if (S.selRing) S.selRing.visible = false;
      if (S.selLabel) S.selLabel.style.display = 'none';
      return;
    }
    /* ---- ① 小圈 ----
     * 半径分两步算：
     *   (a) 世界尺寸（包围球半径 ×1.25，下限 1.5 m）—— 只在换目标/改缩放时重算，
     *       因为 Box3.setFromObject 要遍历模型全部顶点（现在的模型五千个三角面）；
     *   (b) 屏幕下限 —— 每帧按相机距离反算。
     *
     * 为什么必须有 (b)：默认 iso 视角的相机距离是 90 m，视口高约 700 px、fov 50°，
     * 即每米约 7.7 px。一个 2.4 m 的目标，圈的世界半径才 2 m，屏幕上直径只有 31 px
     * —— 混在海床纹理和地面网格里几乎找不到，"标示选中"的作用就没了。
     * 这里给一个屏幕直径下限 54 px：近处按目标真实尺寸（不遮挡），远处保底可见。
     * 两者取大，随缩放平滑过渡。 */
    var key = tg.id + '|' + (tg.scale || 1);
    if (S.selRingKey !== key) {
      S.selRingKey = key;
      var box = new THREE.Box3().setFromObject(obj);
      S.selRingBaseR = Math.max(1.5, box.getSize(new THREE.Vector3()).length() / 2 * 1.25);
    }
    var wpos0 = new THREE.Vector3(tg.pos.e, tg.pos.u, -tg.pos.n);
    var dist = S.camera.position.distanceTo(wpos0);
    var hPx = S.renderer ? S.renderer.domElement.clientHeight : 700;
    var MIN_PX = 54;                                          // 圈的屏幕直径下限
    var minR = (MIN_PX / hPx) * dist * Math.tan(S.camera.fov * DEG / 2);
    var R = Math.max(S.selRingBaseR, minR);
    S.selRing.scale.set(R, R, R);
    S.selRing.position.copy(wpos0);
    S.selRing.quaternion.copy(S.camera.quaternion);            // billboard：正对相机
    S.selRing.visible = true;

    /* ---- ② 坐标标签 ---- */
    var lb = S.selLabel;
    if (!lb) return;
    var host = S.renderer && S.renderer.domElement;
    if (!host) return;
    /* ★ 判断"目标是否在相机背后"必须用**相机空间**的 z，不能看 NDC 的 z。
     *   透视投影把 z 压缩成 z_ndc = (f+n)/(f−n) − 2fn/((f−n)|z_eye|)，
     *   近裁剪 0.2 / 远裁剪 5000 时，哪怕目标就在 90 m 处，z_ndc 也算到 0.9956，
     *   几乎贴着 1 —— 用 `z > 1` 判断等于永远不成立，于是目标转到相机背后时
     *   标签不会隐藏，而是跑到屏幕另一侧乱跳。相机空间里相机朝 −z 看，
     *   z ≥ 0 才是真的在背后（这里留 0.1 m 余量避开近平面附近的投影爆点）。 */
    var pc = wpos0.clone().applyMatrix4(S.camera.matrixWorldInverse);
    if (pc.z > -0.1) { lb.style.display = 'none'; return; }
    var v = wpos0.clone().project(S.camera);
    var w = host.clientWidth, h = host.clientHeight;
    lb.style.display = 'block';
    lb.style.left = ((v.x * 0.5 + 0.5) * w).toFixed(1) + 'px';
    lb.style.top = ((-v.y * 0.5 + 0.5) * h).toFixed(1) + 'px';
    /* 标签的横向偏移要跟着圈的屏幕半径走，否则相机一拉近，圈变大、
     * 标签就压在圈上（圈本是用来"套住目标"的，被压掉一半就没意义了）。
     * 做法：把"目标中心 + 相机右方向 × 圈半径"再投影一次，两者屏幕 x 之差
     * 就是圈在屏幕上的半径像素数。 */
    var camRight = new THREE.Vector3().setFromMatrixColumn(S.camera.matrixWorld, 0);
    var pr = wpos0.clone().add(camRight.multiplyScalar(R)).project(S.camera);
    var pxR = Math.abs(pr.x - v.x) * 0.5 * w;
    lb.style.transform = 'translate(' + (pxR + 10).toFixed(0) + 'px,-50%)';
    lb.innerHTML =
      '<span class="st-nm">' + tg.name + '</span>' +
      '<span class="st-en"><b>E</b>' + tg.pos.e.toFixed(2) + ' m</span>' +
      '<span class="st-en"><b>N</b>' + tg.pos.n.toFixed(2) + ' m</span>' +
      '<span class="st-en"><b>U</b>' + tg.pos.u.toFixed(2) + ' m</span>' +
      '<span class="st-hint">拖箭头改单轴 / 拖本体平移</span>';
  };

  /* ==================================================================
   * V2.2：选中目标的平移手柄（三色轴向箭头）
   * ==================================================================
   * 以前要挪一个目标只能去左栏「待测目标设置 → 选中目标属性」里改三个数字：
   * 改完还得靠想象力猜这个坐标落在场景的什么位置，摆一个"目标在声呐前方
   * 侧后方 20°"的场景往往要来回调好几轮。
   *
   * 现在选中目标后直接在三维里给三根轴：
   *     红 = 东 E（东 / 西）   绿 = 北 N（北 / 南）   蓝 = 天 U（上 / 下）
   * 拖箭头 = 沿该轴平移；直接拖目标本体 = 在水平面内自由平移。
   * 拖动过程中每一个中间位置都会写回 target.pos 并同步刷新左栏属性面板的
   * 数值输入框（见 syncTargetPos），所以三维与数字永远是一致的。
   *
   * 为什么用**世界 ENU 轴**而不是目标本体系 / ROV 本体系？
   *   ① 位置参数本身就是 ENU 坐标（面板上写的就是 E / N / U），用同一套轴
   *      拖动，鼠标位移与数字变化的对应关系一目了然；
   *   ② 「前后左右」这种说法在目标自身有航向角时是歧义的（目标的"前"不等于
   *      场景的"前"），而 ENU 世界轴没有歧义；
   *   ③ 目标是静态物，本体系对它没有工程意义（不像 ROV 有航行方向）。
   */
  var GIZ = [
    { k: 'e', t3: new THREE.Vector3(1, 0, 0), c: 'gizX', label: '东 E' },
    { k: 'n', t3: new THREE.Vector3(0, 0, -1), c: 'gizY', label: '北 N' },
    { k: 'u', t3: new THREE.Vector3(0, 1, 0), c: 'gizZ', label: '天 U' }
  ];
  S.gizmo = { group: null, handles: [], targetId: null };

  function buildGizmo() {
    var t = T();
    var g = new THREE.Group();
    var handles = [];
    // 箭头本体（细长圆柱）+ 锥形箭头 + 一个粗一些但透明的抓取套，
    // 后者纯粹为了手感：细圆柱只有几个像素宽，鼠标很难精准点中。
    GIZ.forEach(function (a) {
      var col = t[a.c];
      var shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 1, 8),
        new THREE.MeshBasicMaterial({ color: col }));
      shaft.userData.giz = a.k;
      var tip = new THREE.Mesh(
        new THREE.ConeGeometry(0.45, 1.3, 10),
        new THREE.MeshBasicMaterial({ color: col }));
      tip.userData.giz = a.k;
      var grab = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 1, 8),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.001, depthWrite: false }));
      grab.userData.giz = a.k;
      g.add(shaft); g.add(tip); g.add(grab);
      handles.push({ k: a.k, dir: a.t3, shaft: shaft, tip: tip, grab: grab, color: col });
    });
    g.visible = false;
    S.scene.add(g);
    S.gizmo.group = g;
    S.gizmo.handles = handles;
  }
  /** 取手柄：拖箭头击中 AxesHelper 就返回轴名 'e' / 'n' / 'u'，否则 null */
  function pickGizmo(ev) {
    if (!S.gizmo.group || !S.gizmo.group.visible) return null;
    var r = S.renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, S.camera);
    var objs = [];
    S.gizmo.handles.forEach(function (h) { objs.push(h.grab, h.shaft, h.tip); });
    var hits = ray.intersectObjects(objs, false);
    return hits.length ? hits[0].object.userData.giz : null;
  }
  /**
   * 把手柄摆到目标上：位置 = 目标中心，长度 = 目标外包尺寸的 1.3 倍（下限 5 m，
   * 免得小鱼雷那种小目标的手柄短到没法点）。
   *
   * ★ V3.0：原「锁定的目标不给手柄」判定撤除（锁定功能整体删除）。
   *   现在只要是被选中的目标就一定给手柄 —— 拖动前必须先选中，
   *   选中的那个本来就是用户有意要挪的，不存在"误拖需要防"的场景。
   */
  S.updateGizmo = function () {
    var sel = FLS.state.sel;
    var tg = (sel && sel.kind === 'target')
      ? FLS.state.targets.filter(function (x) { return x.id === sel.id; })[0] : null;
    var obj = tg ? S.targetObjs[tg.id] : null;
    if (!obj) {
      if (S.gizmo.group) S.gizmo.group.visible = false;
      S.gizmo.targetId = null;
      return;
    }
    if (!S.gizmo.group) buildGizmo();
    var t = T();
    var box = new THREE.Box3().setFromObject(obj);
    var sz = box.getSize(new THREE.Vector3());
    var L = Math.max(5, Math.max(sz.x, sz.y, sz.z) * 1.3);
    S.gizmo.group.visible = true;
    S.gizmo.group.position.set(tg.pos.e, tg.pos.u, -tg.pos.n);
    S.gizmo.targetId = tg.id;
    S.gizmo.handles.forEach(function (h) {
      h.shaft.material.color.setHex(t[h.k === 'e' ? 'gizX' : (h.k === 'n' ? 'gizY' : 'gizZ')]);
      var shaftLen = L, mid = h.dir.clone().multiplyScalar(shaftLen / 2);
      h.shaft.scale.set(1, shaftLen, 1);
      h.shaft.position.copy(mid);
      // 圆柱默认沿 +Y：把它的 +Y 转到目标轴向
      h.shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), h.dir);
      h.tip.position.copy(h.dir.clone().multiplyScalar(shaftLen + 0.65));
      h.tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), h.dir);
      h.grab.scale.set(1, shaftLen + 1.3, 1);
      h.grab.position.copy(h.dir.clone().multiplyScalar((shaftLen + 1.3) / 2));
      h.grab.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), h.dir);
    });
  };

  /** 射线与「轴线」的最近点参数 s（用于沿轴拖动） */
  function axisParam(start, dir, ev) {
    var r = S.renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, S.camera);
    var o = ray.ray.origin, d = ray.ray.direction;      // 相机射线
    var w0 = start.clone().sub(o);
    var a = d.dot(d), b = d.dot(dir), c = dir.dot(dir);
    var dd = d.dot(w0), ee = dir.dot(w0);
    var den = a * c - b * b;
    if (Math.abs(den) < 1e-9) return 0;
    /* ★ V3.7 修复：这里原来是 (a*ee − b*dd)/den，符号整体差一个负号。
     *
     *   推导（线 1：相机射线 o + t·d；线 2：轴线 start + s·dir，w0 = start − o）：
     *     ∂/∂t :  t·a − s·b − dd = 0
     *     ∂/∂s :  t·b − s·c − ee = 0
     *   消元解得 s = (b·dd − a·ee)/(a·c − b²)。
     *
     *   旧式给的是 −s，于是**拖轴向箭头时目标朝鼠标的反方向跑**：
     *   实测在 iso 视角往屏幕右拖 64 px，目标沿 −E 退 5.04 m（屏幕倒退 117 px）；
     *   top 视角同样反向。拖目标本体（水平面求交）那一路没这个问题，
     *   所以表现是"有的拖法对、有的拖法反"，非常容易误判成自己的手感问题。 */
    return (b * dd - a * ee) / den;                      // 轴上的位移（相对 start）
  }
  /** 射线与水平面 u = u0 的交点（用于拖本体时的水平面自由移动） */
  function planeHit(u0, ev) {
    var r = S.renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, S.camera);
    var pt = new THREE.Vector3();
    var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -u0);
    return ray.ray.intersectPlane(plane, pt) ? pt : null;
  }
  /** 找到当前选中目标对应的 state.targets 记录 */
  function selTarget() {
    var sel = FLS.state.sel;
    if (!sel || sel.kind !== 'target') return null;
    return FLS.state.targets.filter(function (x) { return x.id === sel.id; })[0] || null;
  }
  /** 拖动过程中把新位置写回目标，并同步左栏属性面板的数字 */
  S.moveTarget = function (tg, e, n, u) {
    if (!tg) return;
    tg.pos.e = e; tg.pos.n = n; tg.pos.u = u;
    // 夹到水里：不许穿出水面，也不许掉到海底以下 6 m（半埋目标允许一点点下沉）
    var d = FLS.Terrain.depth(e, n);
    if (tg.pos.u > -0.2) tg.pos.u = -0.2;
    if (tg.pos.u < -d - 6) tg.pos.u = -d - 6;
    var o = S.targetObjs[tg.id];
    if (o) o.position.set(tg.pos.e, tg.pos.u, -tg.pos.n);
    /* 拖动时**不**走 syncTargets()：它会重建 BoxHelper 并把整个目标列表重跑
       一遍（每次 mousemove 都 new 一个 BoxHelper，几帧就堆出一堆垃圾对象）。
       这里只把已经存在的两个包围盒刷新一下即可 */
    if (S.selBox) S.selBox.update();
    if (S.boxes[tg.id]) S.boxes[tg.id].update();
    S.updateGizmo();
    if (FLS.ui && FLS.ui.syncTargetPos) FLS.ui.syncTargetPos(tg);
  };

  /* ---------------------------------------------------------- 轨迹 / 散射元 */
  function buildTrack() {
    S.track = new THREE.Line(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x7ef0a0 }));
    S.scene.add(S.track);
  }
  S.setTrack = function (pts) {
    var arr = new Float32Array(pts.length * 3);
    for (var i = 0; i < pts.length; i++) {
      arr[3 * i] = pts[i][0]; arr[3 * i + 1] = pts[i][2]; arr[3 * i + 2] = -pts[i][1];
    }
    S.track.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    S.track.geometry.computeBoundingSphere();
  };
  function buildScatterers() {
    S.scat = new THREE.Points(new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: 0xff9f43, size: 0.3 }));
    S.scene.add(S.scat);
  }
  S.setScatterers = function (arr, n) {
    var show = FLS.state.display.scatter;
    S.scat.visible = !!show;
    if (!show) return;
    var step = Math.max(1, Math.floor(n / 4000));
    var m = Math.floor(n / step);
    var out = new Float32Array(m * 3);
    for (var i = 0; i < m; i++) {
      var o = (i * step) * 11;                       // stride=11（V1.4 起含随机相位）
      out[3 * i] = arr[o]; out[3 * i + 1] = arr[o + 2]; out[3 * i + 2] = -arr[o + 1];
    }
    S.scat.geometry.setAttribute('position', new THREE.BufferAttribute(out, 3));
    S.scat.geometry.computeBoundingSphere();
  };

  /* ---------------------------------------------------------- 测距工具 */
  function buildMeasure() {
    S.measure.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0xff6b6b, dashSize: 2, gapSize: 1 }));
    S.scene.add(S.measure.line);
  }
  S.startMeasure = function () {
    S.measure.on = true; S.measure.pts = [];
    S.measure.line.visible = false;
    FLS.log('测距工具：在三维视图中依次点击两点（点击空白海面亦可），Esc 退出。');
  };
  S.stopMeasure = function () { S.measure.on = false; S.measure.line.visible = false; };

  /* ---------------------------------------------- V1.2 海底地形笔刷（抬高 / 压低） */
  function buildBrush() {
    // 环形光标：贴着海床显示的圆环，直观给出"这一笔影响多大范围"
    var pts = [], N = 96;
    for (var i = 0; i <= N; i++) {
      var a = i / N * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    S.brush.ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.95 }));
    S.brush.ring.visible = false;
    S.brush.ring.renderOrder = 3;
    S.scene.add(S.brush.ring);
    // 中心十字，便于对准
    var cp = [new THREE.Vector3(-0.12, 0, 0), new THREE.Vector3(0.12, 0, 0),
      new THREE.Vector3(0, 0, -0.12), new THREE.Vector3(0, 0, 0.12)];
    S.brush.cross = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cp),
      new THREE.LineBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.9 }));
    S.brush.cross.visible = false;
    S.scene.add(S.brush.cross);
  }
  /** 更新环形光标的位置与半径（贴着当前海床高度） */
  function updateBrushRing(hitPoint) {
    if (!S.brush.ring) return;
    if (!hitPoint) { S.brush.ring.visible = false; S.brush.cross.visible = false; return; }
    var p = enu(hitPoint);
    var z = FLS.Terrain.zAt(p.e, p.n) + 0.25;          // 抬 0.25 m 避免被海床面遮挡
    var r = Math.max(0.5, S.brush.r);
    S.brush.ring.position.set(p.e, z, -p.n);
    S.brush.ring.scale.set(r, 1, r);
    S.brush.ring.visible = true;
    S.brush.cross.position.set(p.e, z, -p.n);
    S.brush.cross.visible = true;
  }
  /** 施加一笔：sign=+1 抬高，−1 压低；返回编辑记录 */
  S.applyBrush = function (e, n, sign) {
    var amp = Math.abs(S.brush.amp) * (sign >= 0 ? 1 : -1);
    var ed = FLS.Terrain.addEdit(e, n, amp, Math.max(0.5, S.brush.r), S.brush.shape);
    S.rebuildTerrain();
    var d0 = FLS.Terrain.depth(e, n);
    FLS.log('地形编辑：' + (amp >= 0 ? '抬高' : '压低') + ' ' + Math.abs(amp).toFixed(2) +
      ' m ＠ E' + e.toFixed(1) + ' N' + n.toFixed(1) + '（笔刷半径 ' + S.brush.r.toFixed(1) +
      ' m）→ 该点深度 ' + d0.toFixed(2) + ' m');
    return ed;
  };
  /** V1.3：载体驶远时把海床 / 海面网格的中心挪过去。
   * 网格跨度有限（★ V3.4：20~4000 m，默认 300×300），原先只在换模板、
   * 改网格间距等时刻才重建，载体按航路连续航行几十秒后会直接开出网格边界
   * —— 三维里表现为「ROV 悬在海床外、身后没有海底」。这里在主循环里做阈值
   * 触发的重建。★ V3.4：阈值按**较短的那一边**算，否则狭长作业区会在短边
   * 方向先跑出去。 */
  S.maybeRecenter = function (e, n) {
    var thr = Math.max(30, Math.min(SEA_SPANX || 300, SEA_SPANY || 300) * 0.28);
    if (Math.abs(e - S.center[0]) > thr || Math.abs(n - S.center[1]) > thr) {
      S.rebuildTerrain(e, n);
      return true;
    }
    return false;
  };

  /* ========================================================== V1.3 航路规划
   * 在三维视口里直接打点：左键落在海床上即生成一个航点，航点的绝对高度由
   * 「离水底高度」决定（U = −depth(e,n) + alt），因此地形起伏或被手工编辑后
   * 航路会自动贴合。每个航点自带「本段速度」= 从它驶向下一航点的速度。
   */
  var ROUTE_ALT0 = 5, ROUTE_SPD0 = 1.0;
  S.routeDefaults = { alt: ROUTE_ALT0, spd: ROUTE_SPD0 };

  /** 航点的真实天向 U（不受三维垂直放大影响） */
  /** 航点在三维视口里的显示高度（与海床网格用同一套 zexag 放大，避免航点陷进海床） */
  S.routeZ = function (w) { return (S.zDisp ? S.zDisp(w.e, w.n) : -FLS.Terrain.depth(w.e, w.n)) + (w.alt || 0); };

  function buildRouteGroup() {
    S.routeGroup = new THREE.Group();
    S.scene.add(S.routeGroup);
    S.routeLine = new THREE.Line(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xff9f43, transparent: true, opacity: 0.95 }));
    S.routeGroup.add(S.routeLine);
    S.routePoles = new THREE.LineSegments(new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.6 }));
    S.routeGroup.add(S.routePoles);
    S.routeMarks = [];
  }

  /** 依据 state.route 重建航点标记 / 连线 / 离底高度杆 */
  S.updateRoute = function () {
    if (!S.routeGroup) buildRouteGroup();
    var rt = FLS.state.route || [];
    // 复用已有标记，数量变化时增删
    while (S.routeMarks.length > rt.length) {
      var m = S.routeMarks.pop(); S.routeGroup.remove(m); m.geometry.dispose(); m.material.dispose();
    }
    while (S.routeMarks.length < rt.length) {
      var mk = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 10),
        new THREE.MeshBasicMaterial({ color: 0xff9f43 }));
      mk.renderOrder = 4;
      S.routeGroup.add(mk); S.routeMarks.push(mk);
    }
    var pts = [], poles = [], i, w;
    for (i = 0; i < rt.length; i++) {
      w = rt[i];
      var u = S.routeZ(w);
      var sel = (i === S.route.sel);
      S.routeMarks[i].position.set(w.e, u, -w.n);
      S.routeMarks[i].scale.setScalar(sel ? 1.6 : 1);
      // 首点用绿色、选中用青色、其余橙色
      S.routeMarks[i].material.color.setHex(sel ? 0x49d0ff : (i === 0 ? 0x7ef0a0 : 0xff9f43));
      S.routeMarks[i].userData.idx = i;
      pts.push(new THREE.Vector3(w.e, u, -w.n));
      // 离底高度杆：从海床面画到航点
      poles.push(new THREE.Vector3(w.e, S.zDisp ? S.zDisp(w.e, w.n) : -FLS.Terrain.depth(w.e, w.n), -w.n));
      poles.push(new THREE.Vector3(w.e, u, -w.n));
    }
    // 闭环时把末点连回首点
    if (rt.length > 2 && FLS.state.routeLoop) pts.push(pts[0].clone());
    S.routeLine.geometry.setFromPoints(rt.length ? pts : [new THREE.Vector3(), new THREE.Vector3()]);
    S.routeLine.visible = rt.length > 1;
    S.routePoles.geometry.setFromPoints(poles.length ? poles : [new THREE.Vector3(), new THREE.Vector3()]);
    S.routePoles.visible = poles.length > 0;
  };

  /** 新增航点（继承上一个航点的离底高度与速度，减少重复调整） */
  S.addRoutePoint = function (e, n) {
    var rt = FLS.state.route;
    var last = rt.length ? rt[rt.length - 1] : null;
    var w = {
      id: 'W' + (Date.now() % 1e7) + '_' + rt.length,
      e: +e.toFixed(2), n: +n.toFixed(2),
      alt: last ? last.alt : ROUTE_ALT0,
      spd: last ? last.spd : ROUTE_SPD0
    };
    rt.push(w);
    S.route.sel = rt.length - 1;
    S.updateRoute();
    FLS.log('航路点 #' + rt.length + '：E' + w.e.toFixed(1) + ' N' + w.n.toFixed(1) +
      '，离底 ' + w.alt.toFixed(1) + ' m（该处水深 ' + FLS.Terrain.depth(w.e, w.n).toFixed(1) + ' m）');
    if (FLS.ui && FLS.ui.syncRouteBtns) FLS.ui.syncRouteBtns();
    return w;
  };
  S.delRoutePoint = function (i) {
    var rt = FLS.state.route;
    if (i < 0 || i >= rt.length) return;
    rt.splice(i, 1);
    S.route.sel = Math.min(S.route.sel, rt.length - 1);
    S.updateRoute();
    if (FLS.ui && FLS.ui.syncRouteBtns) FLS.ui.syncRouteBtns();
  };
  S.clearRoute = function () {
    FLS.state.route = []; FLS.state.routeIdx = 0; S.route.sel = -1;
    S.updateRoute();
    if (FLS.ui && FLS.ui.syncRouteBtns) FLS.ui.syncRouteBtns();
  };
  S.reverseRoute = function () {
    FLS.state.route.reverse(); FLS.state.routeIdx = 0; S.route.sel = -1;
    S.updateRoute();
    if (FLS.ui && FLS.ui.syncRouteBtns) FLS.ui.syncRouteBtns();
  };
  S.selectRoute = function (i) {
    S.route.sel = i;
    S.updateRoute();
    if (FLS.ui && FLS.ui.syncRouteBtns) FLS.ui.syncRouteBtns();
  };
  /** 屏幕射线命中的航点索引，−1 表示未命中 */
  function pickRouteIndex(ev) {
    if (!S.routeMarks || !S.routeMarks.length) return -1;
    var r = S.renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, S.camera);
    var hits = ray.intersectObjects(S.routeMarks, false);
    return hits.length ? hits[0].object.userData.idx : -1;
  }
  S.setRoutePick = function (on) {
    S.route.on = !!on;
    if (S.route.on) { S.stopMeasure(); if (S.brush.on) S.setBrush(false); }
    if (S.route.on && !S.routeGroup) buildRouteGroup();
    // 复用笔刷的环形光标作落点指示（半径固定小圈，避免与笔刷的编辑范围混淆）
    if (S.route.on && !S.brush.ring) buildBrush();
    if (!S.route.on && S.brush.ring && !S.brush.on) { S.brush.ring.visible = false; S.brush.cross.visible = false; }
    S.updateRoute();
    if (S.route.on) FLS.log('航路打点已启用：在三维视口中点击海床依次添加航点，再次点击「打点」或按 Esc 结束。');
    return S.route.on;
  };

  S.setBrush = function (on) {
    S.brush.on = !!on;
    if (S.brush.on) { S.stopMeasure(); if (S.route.on) S.setRoutePick(false); }
    if (!S.brush.ring) buildBrush();
    if (!S.brush.on) { S.brush.ring.visible = false; S.brush.cross.visible = false; }
    if (S.brush.on) FLS.log('地形笔刷已启用：左键抬高、右键压低、中键平移；幅度 ' +
      S.brush.amp.toFixed(2) + ' m，半径 ' + S.brush.r.toFixed(1) + ' m（Esc 退出）。');
    return S.brush.on;
  };

  /* ---------------------------------------------------------- 交互 */
  var ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  function pick(ev) {
    var r = S.renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, S.camera);
    var hits = ray.intersectObjects(S.scene.children, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      while (o && o.parent) {
        if (o.userData && o.userData.tid !== undefined) return { kind: 'target', id: o.userData.tid, point: hits[i].point };
        if (o === S.seafloor) return { kind: 'terrain', point: hits[i].point };
        o = o.parent;
      }
    }
    return { kind: 'none', point: hits.length ? hits[0].point : null };
  }
  function onDown(e) {
    // V1.3 航路打点：左键在海床上落一个航点（右键/中键仍留给平移）
    if (S.route.on && e.button === 0) {
      var hr = pick(e);
      if (hr.point) { var pr = enu(hr.point); S.addRoutePoint(pr.e, pr.n); }
      S.drag = null;
      return;
    }
    // V1.2 地形笔刷：左键抬高 / 右键压低（中键留给平移）
    if (S.brush.on && (e.button === 0 || e.button === 2)) {
      var hb = pick(e);
      if (hb.point) {
        var pb = enu(hb.point);
        S.applyBrush(pb.e, pb.n, e.button === 0 ? 1 : -1);
      }
      S.drag = null;
      return;
    }
    if (e.button === 0 && S.measure.on) {
      var h = pick(e);
      if (h.point) {
        S.measure.pts.push(h.point.clone());
        if (S.measure.pts.length === 2) {
          var d = S.measure.pts[0].distanceTo(S.measure.pts[1]);
          S.measure.line.geometry.setFromPoints(S.measure.pts);
          S.measure.line.computeLineDistances();
          S.measure.line.visible = true;
          var a = enu(S.measure.pts[0]), b = enu(S.measure.pts[1]);
          FLS.log('测距结果：空间距离 ' + d.toFixed(2) + ' m ｜ 起点 E' + a.e.toFixed(1) + ' N' + a.n.toFixed(1) + ' U' + a.u.toFixed(1) +
            ' ｜ 终点 E' + b.e.toFixed(1) + ' N' + b.n.toFixed(1) + ' U' + b.u.toFixed(1));
          S.measure.pts = [];
        }
      }
      return;
    }
    /* ★ V2.2：目标平移手柄优先于相机旋转。
       判定顺序很关键：手柄体积不大但就在目标身上，若先判若无 pick('target')
       再把手柄交出去，用户点箭头时会先把整个目标拖走（相机视角也随之旋转），
       手感完全不对。所以这里第一步先问「是否点中了三根轴之一」。 */
    if (e.button === 0 && !S.route.on && !S.brush.on && !S.measure.on) {
      var tg0 = selTarget();
      /* —— ① 三根轴向手柄：沿 E / N / U 单轴平移 —— */
      var ax0 = tg0 ? pickGizmo(e) : null;
      if (tg0 && ax0) {
        var hd = null;
        S.gizmo.handles.forEach(function (h) { if (h.k === ax0) hd = h; });
        if (hd) {
          var st0 = new THREE.Vector3(tg0.pos.e, tg0.pos.u, -tg0.pos.n);
          S.drag = {
            kind: 'axis', axis: ax0, id: tg0.id, x: e.clientX, y: e.clientY, btn: 0, moved: 0,
            start: st0, dir: hd.dir.clone(),
            s0: axisParam(st0, hd.dir.clone(), e),
            pos0: { e: tg0.pos.e, n: tg0.pos.n, u: tg0.pos.u }
          };
          return;
        }
      }
      /* —— ② 拖目标本体：在目标所在深度的水平面内自由平移 —— */
      var h0 = pick(e);
      if (h0.kind === 'target') {
        var tb = FLS.state.targets.filter(function (x) { return x.id === h0.id; })[0];
        if (tb) {                                        // V3.0：去掉 !tb.locked 判定
          if (!(FLS.state.sel && FLS.state.sel.id === tb.id)) {
            FLS.state.sel = { kind: 'target', id: tb.id };
            FLS.ui && FLS.ui.onSelect();
          }
          // 记住"鼠标落点相对目标中心的偏移"，否则一按下目标就会跳到鼠标正下方
          var ph = planeHit(tb.pos.u, e);
          S.drag = {
            kind: 'plane', id: tb.id, x: e.clientX, y: e.clientY, btn: 0, moved: 0,
            u0: tb.pos.u,
            off: ph ? { e: tb.pos.e - ph.x, n: tb.pos.n - (-ph.z) } : { e: 0, n: 0 },
            pos0: { e: tb.pos.e, n: tb.pos.n, u: tb.pos.u }
          };
          return;
        }
      }
    }
    S.drag = { x: e.clientX, y: e.clientY, btn: e.button, moved: 0 };
  }
  function onMove(e) {
    if (S.drag && S.drag.kind === 'axis') { dragTargetAxis(e); return; }
    if (S.drag && S.drag.kind === 'plane') { dragTargetPlane(e); return; }
    if (!S.drag) {
      // 笔刷模式下光标跟随：把射线与海床的交点换算成 ENU，驱动环形光标
      if (S.brush.on && S.brush.ring) {
        var hm = pick(e);
        updateBrushRing(hm.kind === 'terrain' ? hm.point : (hm.point || null));
      } else if (S.route.on && S.brush.ring) {
        // 航路打点：同一个环形光标当作「落点」指示，半径固定取小值
        var hr2 = pick(e);
        var rSave = S.brush.r; S.brush.r = 1.6;
        updateBrushRing(hr2.point || null);
        S.brush.r = rSave;
      }
      return;
    }
    var dx = e.clientX - S.drag.x, dy = e.clientY - S.drag.y;
    S.drag.moved += Math.abs(dx) + Math.abs(dy);
    S.drag.x = e.clientX; S.drag.y = e.clientY;
    if (S.drag.btn === 0) {
      S.cam.theta -= dx * 0.006;
      S.cam.phi = Math.max(-1.45, Math.min(1.45, S.cam.phi + dy * 0.005));
    } else if (S.drag.btn === 2 || S.drag.btn === 1) {
      var sp = S.cam.dist * 0.0016;
      var right = new THREE.Vector3(Math.cos(S.cam.theta), 0, -Math.sin(S.cam.theta));
      var fwd = new THREE.Vector3(Math.sin(S.cam.theta), 0, Math.cos(S.cam.theta));
      S.cam.tx -= (right.x * dx - fwd.x * dy) * sp;
      S.cam.tz -= (right.z * dx - fwd.z * dy) * sp;
      S.cam.ty += dy * sp * 0.9;
    }
  }
  function onUp(e) {
    /* V2.2：拖完目标给一条带最终坐标的日志 —— 面板上的数字是实时跟着变的，
       但没有"这一步到底把它挪到哪了"的留痕，不好回溯。
       只在真的拖动过（moved ≥ 5）时报，单纯点选不刷屏。 */
    if (S.drag && (S.drag.kind === 'axis' || S.drag.kind === 'plane') && S.drag.moved >= 5) {
      var tu = FLS.state.targets.filter(function (x) { return x.id === S.drag.id; })[0];
      if (tu) FLS.log('目标「' + tu.name + '」已移动至 E' + tu.pos.e.toFixed(2) +
        ' N' + tu.pos.n.toFixed(2) + ' U' + tu.pos.u.toFixed(2) +
        '（离底 ' + (tu.pos.u + FLS.Terrain.depth(tu.pos.e, tu.pos.n)).toFixed(2) + ' m）');
      S.drag = null;
      return;
    }
    // 航点优先：非打点/非笔刷/非测距状态下，单击航点球即选中（供面板编辑与删除）
    if (S.drag && S.drag.btn === 0 && S.drag.moved < 5 && !S.measure.on && !S.route.on && !S.brush.on) {
      var ri = pickRouteIndex(e);
      if (ri >= 0) { S.selectRoute(ri); S.drag = null; return; }
    }
    if (S.drag && S.drag.btn === 0 && S.drag.moved < 5 && !S.measure.on) {
      var h = pick(e);
      if (h.kind === 'target') {
        FLS.state.sel = { kind: 'target', id: h.id };
        FLS.ui && FLS.ui.onSelect();
      } else if (h.kind === 'terrain') {
        FLS.state.sel = { kind: 'terrain', id: null };
        FLS.ui && FLS.ui.onSelect();
      }
    }
    S.drag = null;
  }
  /** 沿单轴拖动：相机射线与轴线的最近点位移量，叠加到按下瞬间的初始坐标 */
  function dragTargetAxis(e) {
    var d = S.drag;
    var tg = FLS.state.targets.filter(function (x) { return x.id === d.id; })[0];
    if (!tg) { S.drag = null; return; }
    var s = axisParam(d.start, d.dir, e) - d.s0;
    var de = d.axis === 'e' ? s : 0, dn = d.axis === 'n' ? s : 0, du = d.axis === 'u' ? s : 0;
    S.moveTarget(tg, d.pos0.e + de, d.pos0.n + dn, d.pos0.u + du);
  }
  /** 水平面自由拖动：射线与「目标所在深度的水平面」求交 */
  function dragTargetPlane(e) {
    var d = S.drag;
    var tg = FLS.state.targets.filter(function (x) { return x.id === d.id; })[0];
    if (!tg) { S.drag = null; return; }
    var p = planeHit(d.u0, e);
    if (!p) return;
    S.moveTarget(tg, p.x + d.off.e, -p.z + d.off.n, d.u0);
  }
  function onWheel(e) {
    e.preventDefault();
    S.cam.dist = Math.max(3, Math.min(1200, S.cam.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      S.stopMeasure();
      if (S.brush.on) S.setBrush(false);
      if (S.route.on) S.setRoutePick(false);
    }
  });

  S.setCamera = function (preset) {
    var p = FLS.state.rov;
    if (preset === 'follow') { S.cam.follow = true; return; }
    S.cam.follow = false;
    S.cam.tx = p.x; S.cam.tz = -p.y; S.cam.ty = p.z;
    if (preset === 'top') { S.cam.phi = 1.45; S.cam.theta = 0; S.cam.dist = 90; }
    else if (preset === 'side') { S.cam.phi = 0.05; S.cam.theta = -Math.PI / 2 - p.heading * DEG; S.cam.dist = 70; }
    else if (preset === 'front') { S.cam.phi = 0.15; S.cam.theta = -p.heading * DEG; S.cam.dist = 70; }
    else if (preset === 'iso') { S.cam.phi = 0.55; S.cam.theta = Math.PI * 0.25 - p.heading * DEG; S.cam.dist = 90; }
  };
  S.fit = function () {
    var p = FLS.state.rov;
    S.cam.tx = p.x; S.cam.tz = -p.y; S.cam.ty = p.z;
    S.cam.dist = Math.max(40, Math.min(400, FLS.P['alg.rmax'] * 1.6));
    S.cam.phi = 0.5; S.cam.follow = false;
  };

  /* ---------------------------------------------------------- 渲染 */
  /** 按 FLS.state.display（即 FLS.P['disp.*']）统一刷新三维对象可见性 */
  S.applyDisplay = function () {
    var d = FLS.state.display;
    if (S.axes) S.axes.visible = !!d.axes;
    if (S.ruler) S.ruler.visible = !!d.scale;
    if (S.seafloorGrid) S.seafloorGrid.visible = !!d.grid;
    if (S.normals) S.normals.visible = !!d.normal;
    if (S.cone) { S.cone.visible = !!d.cone; S.coneWire.visible = !!d.cone; }
    if (S.rxCone) { S.rxCone.visible = !!d.rxCone; S.rxConeWire.visible = !!d.rxCone; }
    if (S.track) S.track.visible = !!d.track;
    Object.keys(S.boxes).forEach(function (id) {
      S.boxes[id].visible = !!d.bbox && !!S.targetObjs[id] && S.targetObjs[id].visible;
      S.boxes[id].update();
    });
    if (S.scat) S.scat.visible = !!d.scatter;
  };

  /**
   * 主题切换：重设三维视口的背景 / 雾 / 光照 / 海面 / 网格 / 扫描扇面配色。
   * 海底「按深度着色」的色标不随主题变（它是物理量），只换单色模式的底色。
   */
  S.applyTheme = function () {
    var t = T();
    if (!S.renderer) return;
    S.renderer.setClearColor(t.bg, 1);
    if (S.scene.fog) { S.scene.fog.color.setHex(t.fog); S.scene.fog.density = t.fogD; }
    if (S.ambLight) { S.ambLight.color.setHex(t.amb); S.ambLight.intensity = t.ambI; }
    if (S.dirLight) S.dirLight.intensity = t.dirI;
    if (S.dirLight2) S.dirLight2.intensity = t.dir2I;
    if (S.surface) { S.surface.material.color.setHex(t.surf); S.surface.material.opacity = t.surfOp; }
    if (S.surfaceGrid) {
      S.surfaceGrid.material.color.setHex(t.surfGrid);
      S.surfaceGrid.material.opacity = t.surfGridOp;
    }
    if (S.seafloorGrid) {
      S.seafloorGrid.material.color.setHex(t.grid);
      S.seafloorGrid.material.opacity = t.gridOp;
    }
    if (S.rulerLine) S.rulerLine.material.color.setHex(t.ruler);
    if (S.cone) { S.cone.material.color.setHex(t.cone); S.cone.material.opacity = t.coneOp; }
    if (S.coneWire) S.coneWire.material.color.setHex(t.coneWire);
    if (S.rxCone) { S.rxCone.material.color.setHex(t.rxCone); S.rxCone.material.opacity = t.rxConeOp; }
    if (S.rxConeWire) S.rxConeWire.material.color.setHex(t.rxConeWire);
    // 标尺数字这类「会被主题影响的文字」重绘一次
    LABELS.forEach(function (spr) {
      if (!spr.userData) return;
      var col = spr.userData.tintable ? t.rulerLabel : spr.userData.baseColor;
      paintLabel(spr.userData.canvas, spr.userData.text, col, t.rulerLabelHalo);
      spr.userData.tex.needsUpdate = true;
    });
    S.recolorSeafloor();
  };

  S.render = function () {
    var c = S.cam;
    if (c.follow && S.rovPose) {
      var pose = S.rovPose, ax = S.rovAxes;
      var back = 6, upv = 2.5;
      var pos = [pose.x - ax.fwd[0] * back + ax.up[0] * upv,
      pose.y - ax.fwd[1] * back + ax.up[1] * upv,
      pose.z - ax.fwd[2] * back + ax.up[2] * upv];
      S.camera.position.set(pos[0], pos[2], -pos[1]);
      var look = [pose.x + ax.fwd[0] * 20, pose.y + ax.fwd[1] * 20, pose.z + ax.fwd[2] * 20];
      S.camera.up.set(ax.up[0], ax.up[2], -ax.up[1]);
      S.camera.lookAt(look[0], look[2], -look[1]);
    } else {
      var ct = Math.cos(c.phi), st = Math.sin(c.phi);
      S.camera.up.set(0, 1, 0);
      S.camera.position.set(
        c.tx + c.dist * ct * Math.sin(c.theta),
        c.ty + c.dist * st,
        c.tz + c.dist * ct * Math.cos(c.theta));
      S.camera.lookAt(c.tx, c.ty, c.tz);
    }
    // 刻度数字 / 轴名按当前相机距离重算尺寸（屏幕恒定，放大不糊、缩小不丢）
    S.tickLabelSize();
    // 显示开关（抽成独立函数，便于菜单之外的路径调用）
    S.applyDisplay();
    var surfOn = !!FLS.P['env.surfOn'];
    S.surface.visible = surfOn;
    if (S.surfaceGrid) S.surfaceGrid.visible = surfOn;
    if (S.lastSelId !== (FLS.state.sel && FLS.state.sel.id)) {
      S.lastSelId = FLS.state.sel && FLS.state.sel.id;
      S.updateSelection();
    }
    /* V3.0：选中圈与坐标标签必须在相机摆好之后、真正出图之前刷新 ——
     * 圈要 billboard 到相机、标签要用投影后的屏幕坐标，两者都依赖这一帧
     * 最终的相机矩阵。放在 render 之前正好；放早了会滞后一帧，
     * 拖动目标时能明显看出圈"跟不上"。 */
    S.updateSelOverlay();
    S.renderer.render(S.scene, S.camera);
  };

  /* ================================================================
   * V2.0：成像栏左上角的 mini 三维视口
   *   目的：驾驶 ROV 时，成像栏里也能同时看到"载体在哪、朝哪、前方是什么"。
   *
   *   实现上**刻意不建第二个 WebGLRenderer**，而是把主视口渲染好的画面
   *   drawImage 拷到一块 2D canvas 上：
   *     ① 只有一个 WebGL 上下文，省显存，也避开多上下文之间的资源竞争；
   *     ② 拷贝成本极低（一次 drawImage），比再跑一遍场景渲染便宜得多；
   *     ③ 画面与主视口完全一致 —— 用户在「三维场景设置」里把视角调好
   *       （比如点"跟随"），切到成像栏看到的就是同一视角，不存在两套视角
   *       各说各话的问题。
   * ================================================================ */
  S.initMini = function (host) {
    if (!host) return;
    S.miniHost = host;
    S.miniCanvas = document.createElement('canvas');
    S.miniCanvas.style.position = 'absolute';
    S.miniCanvas.style.left = '0'; S.miniCanvas.style.top = '0';
    S.miniCanvas.style.display = 'block';
    host.appendChild(S.miniCanvas);
    S.miniCtx = S.miniCanvas.getContext('2d');
  };

  S.resizeMini = function () {
    if (!S.miniCanvas || !S.miniHost) return;
    var w = S.miniHost.clientWidth, h = S.miniHost.clientHeight;
    if (w < 8 || h < 8) return;
    var r = Math.min(2, window.devicePixelRatio || 1);
    S.miniCanvas.width = Math.round(w * r); S.miniCanvas.height = Math.round(h * r);
    S.miniCanvas.style.width = w + 'px'; S.miniCanvas.style.height = h + 'px';
    S.miniW = w; S.miniH = h;
  };

  /** 把主视口刚渲染出的画面拷进 mini 画布（必须在 S.render() 之后调用） */
  /* ★ V2.2：mini 视口的拷贝必须节流。
     drawImage(主 WebGL 画布) 会强制一次 GPU→CPU 回读，实测 1000×715 的源
     每帧拷贝要 46 ms —— 单这一项就把成像栏的帧率钉在 20 fps 上下（真机有
     GPU 时便宜些，但仍是每帧最贵的一步）。
     mini 的用途只是"驾驶 ROV 时顺带看一眼场景"，15 fps 足够，
     节流到 70 ms 后均摊成本降到约 5 ms/帧。
     force=true 用于视图切入/尺寸变化等必须立即刷新一次的场合。 */
  var MINI_MS = 70, miniLastT = 0;
  S.renderMini = function (force) {
    if (!S.miniCtx || !S.renderer) return;
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (!force && now - miniLastT < MINI_MS) return;
    miniLastT = now;
    var src = S.renderer.domElement;
    if (!src.width || !src.height) return;
    var cw = S.miniCanvas.width, ch = S.miniCanvas.height;
    // 等比缩放并居中：主视口与 mini 画布的宽高比不同，直接拉伸会把场景压扁
    var sc = Math.min(cw / src.width, ch / src.height);
    var dw = Math.round(src.width * sc), dh = Math.round(src.height * sc);
    S.miniCtx.clearRect(0, 0, cw, ch);
    S.miniCtx.fillStyle = (FLS.Theme && FLS.Theme.isDark()) ? '#0a1017' : '#c4d4e4';
    S.miniCtx.fillRect(0, 0, cw, ch);
    S.miniCtx.drawImage(src, 0, 0, src.width, src.height,
      Math.round((cw - dw) / 2), Math.round((ch - dh) / 2), dw, dh);
  };
})();
