/* ==========================================================================
 * js/61-camview.js —— ★ V3.5：虚拟水下摄像头视口
 * --------------------------------------------------------------------------
 * 需求由来（用户原话）：
 *   "在前视声呐成像这个板块里，在三维场景视口下再增加一个水下摄像头视口，
 *    这个视口模拟有一个虚拟摄像头装在前视声呐相同位置，而且安装的俯仰角都
 *    和前视声呐一样，用摄像头看水下的场景，视角的大小不能低于前视声呐的
 *    探测视角……它不干涉前视声呐成像，我只是想从声呐的视角看水下的景象，
 *    这样就能和前视声呐成像图有个比照，当然摄像头的视角是矩形的，不是扇形的。"
 *
 * 四件事必须做对，否则这个视口就是个花架子：
 *
 * ① 装在哪里、朝哪里 —— 必须**与声呐同一套轴**，不能另算一套。
 *    位置取 ROV 位姿 p（三维里淡蓝扇面的原点就是它，见 scene3d.updateRov）；
 *    朝向取 scene3d.sonarAxes(pose)，它已经串起了三层旋转：
 *        ROV 艏向 heading → ⊕ 横滚 roll / 俯仰 pitch → ⊕ 声呐安装角 rov.tilt
 *        → ⊕ 成像平面俯仰 alg.tilt
 *    于是"摄像头俯仰角与前视声呐一样"不是一句口号：
 *    改 rov.tilt / alg.tilt / rov.pitch 任意一项，三维扇面与摄像头画面同步转。
 *
 * ② 矩形视场怎么定 —— 声呐是扇形（水平 H × 垂直 V），摄像头是矩形，
 *    矩形要**罩住**扇形，两个方向都不能小：
 *        H = min(tx.hbeam, alg.sector)          （与 updateCone 同一口径）
 *        V = tx.vbeam
 *        aspect = 视口宽高比
 *        fovV = max( V, 2·atan( tan(H/2) / aspect ) )     ← 垂直 FOV
 *        fovH = 2·atan( tan(fovV/2) · aspect )            ← 水平 FOV
 *    第二项的含义：要让水平视场不小于 H，垂直 FOV 至少要这么大；
 *    再与 V 取大者，于是水平、垂直都 ≥ 声呐。默认 120°×20° 的声呐、
 *    宽高比 4:1 的视口 → 矩形视场 120.0°×55.5°：水平刚好齐平，垂直富余 35.5°。
 *    垂直富余不是浪费，是"用矩形罩扇形"的必然代价 —— 见算法文档 §10.3。
 *
 * ③ 不干涉成像 —— 本模块**只读**场景、**只渲染**，不改任何 FLS.P、
 *    不碰 job、不进内核。唯一要注意的是渲染前后必须把临时改动还原干净
 *    （下面 render() 里的 hide/restore 成对出现）。
 *
 * ④ 为什么这次破例建第二个 WebGLRenderer
 *    —— mini 视口（scene3d.renderMini）的注释里明确写着"刻意不建第二个
 *    WebGLRenderer，用 drawImage 拷贝主画面"。那条原则对 mini 成立，是因为
 *    mini 与主视口**同一视角**，拷贝就够了；而摄像头是**另一套视角**（装在
 *    声呐上往前看），拷贝不到，必须真渲染一次。
 *    代价：多一个 WebGL 上下文（本项目总共 2 个，浏览器上限 8~16，安全）、
 *    多一份 GPU 显存（海床 256×256 顶点两份）、每帧多一次场景渲染 ——
 *    所以渲染节流到 CAM_MS（默认 55 ms ≈ 18 fps），且只在成像页可见时跑。
 * ========================================================================== */
(function (global) {
  'use strict';
  var FLS = global.FLS;
  var C = {};
  FLS.camview = C;

  var DEG = Math.PI / 180, RAD = 180 / Math.PI;

  /* ------------------------------------------------ 状态 */
  C.host = null;          // 视口容器
  C.renderer = null;      // 第二个 WebGLRenderer
  C.camera = null;        // 虚拟摄像头（PerspectiveCamera，矩形视场）
  C.hud = null;           // 2D 叠加层（视场框 / 目标标注）
  C.hudCtx = null;
  C.W = 0; C.H = 0;       // CSS 像素尺寸
  C.ready = false;
  /* 实测视场角（°），供 UI 与回归脚本读取 */
  C.fovH = 0; C.fovV = 0;
  C.lastT = 0; C.fps = 0; C.frames = 0; C.fpsT = 0;
  /* 渲染节流 40 ms（25 fps）。实测（headless，1680×950 窗口）：
     · 主视口渲染 1.35 ms/次（1348×685）
     · 摄像头渲染 0.32 ms/次（505×141，像素只有主视口的 1/13）
     均摊到每帧只有 0.13 ms —— 相对仿真单帧 2.9 s 完全可忽略。
     之所以还要节流而不是每帧都画：真机 GPU 上第二上下文有额外的资源同步开销，
     且"边开 ROV 边看"25 fps 已经完全跟得上。 */
  var CAM_MS = 40;

  /* ------------------------------------------------ 视场推导（核心公式） */
  /**
   * 由声呐视场与视口宽高比推出摄像头的矩形视场。
   * @param aspect 视口宽/高
   * @returns {h, v, hSonar, vSonar}  单位 °
   */
  C.solveFov = function (aspect) {
    /* 声呐有效视场：与 scene3d.updateCone() 完全同一口径 ——
       水平取 min(发射水平开角, 成像扇角)，垂直取发射垂直开角。
       口径不一致会出现"摄像头说看到了 130°，声呐只照到 120°"的自相矛盾。 */
    var hS = Math.min(+FLS.P['tx.hbeam'] || 120, +FLS.P['alg.sector'] || 120);
    var vS = +FLS.P['tx.vbeam'] || 20;
    // 限幅：H→170°、V→120° 是透视投影的数值稳定上限，再大画面会拉伸成一片糊
    hS = Math.max(1, Math.min(170, hS));
    vS = Math.max(1, Math.min(120, vS));
    if (!(aspect > 0.05) || !isFinite(aspect)) aspect = 4;

    /* 让水平视场 ≥ H 所需的垂直 FOV：
         tan(fovV/2)·aspect = tan(H/2)  ⟹  fovV = 2·atan( tan(H/2)/aspect ) */
    var need = 2 * Math.atan(Math.tan(hS * DEG / 2) / aspect) * RAD;
    var v = Math.max(vS, need);
    v = Math.max(1, Math.min(150, v));                 // 上限 150°：再大投影畸变不可读
    var h = 2 * Math.atan(Math.tan(v * DEG / 2) * aspect) * RAD;
    h = Math.min(h, 175);
    return { h: h, v: v, hSonar: hS, vSonar: vS };
  };

  /* ------------------------------------------------ 初始化 */
  C.init = function (host) {
    if (!host || !global.THREE) return;
    C.host = host;
    var w = host.clientWidth || 480, h = host.clientHeight || 140;

    /* ★ 第二个 WebGLRenderer：与主视口**共享同一个 scene**。
       共享的好处是地形/目标/ROV 的任何更新都自动同步，不必再维护一份镜像；
       three 允许一个 scene 被多个 renderer 渲染（各自上下文各传一份 GPU 资源）。 */
    C.renderer = new THREE.WebGLRenderer({ antialias: true });
    C.renderer.setPixelRatio(Math.min(2, global.devicePixelRatio || 1));
    C.renderer.setSize(w, h);
    C.renderer.setClearColor(bgHex(), 1);
    C.renderer.domElement.style.position = 'absolute';
    C.renderer.domElement.style.left = '0';
    C.renderer.domElement.style.top = '0';
    C.renderer.domElement.style.display = 'block';
    host.appendChild(C.renderer.domElement);

    /* 虚拟摄像头：装在声呐处、朝声呐艏向、矩形视场。
       near = 0.1 m：相机就在 ROV 几何中心，太近的东西（自己的壳体）本就该被裁掉，
       再小只会白白吃掉深度缓冲精度；far = 2500 m 覆盖 4000 m 海底的大半，
       配合雾也看不见更远，取再大只是浪费深度精度。 */
    C.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 2500);
    var f = C.solveFov(w / h);
    C.camera.fov = f.v; C.camera.updateProjectionMatrix();

    /* 2D 叠加层：声呐视场框 + 目标标注。
       用独立 canvas 而不是往 WebGL 里塞 Line，是因为这些是"屏幕空间"的标注
       （不随透视缩放），画在 2D 上才不会跟着场景一起被雾/光照吃掉。 */
    C.hud = document.createElement('canvas');
    C.hud.className = 'cam-hud';
    host.appendChild(C.hud);
    C.hudCtx = C.hud.getContext('2d');

    C.W = w; C.H = h;
    C.ready = true;
    C.resize();
  };

  function bgHex() {
    var dark = FLS.Theme && FLS.Theme.isDark && FLS.Theme.isDark();
    return dark ? 0x08111b : 0xc4d4e4;
  }

  /* ------------------------------------------------ 尺寸 */
  C.resize = function () {
    if (!C.host || !C.renderer) return;
    var w = C.host.clientWidth, h = C.host.clientHeight;
    /* 与 scene3d.resize 同理：隐藏（宽度 0）时**不要**改渲染器尺寸，
       否则相机 aspect 变成 0/NaN，切回来第一帧画出一张废图。 */
    if (w < 8 || h < 8) return;
    C.W = w; C.H = h;
    C.renderer.setSize(w, h);
    var f = C.solveFov(w / h);
    C.camera.aspect = w / h;
    C.camera.fov = f.v;
    C.camera.updateProjectionMatrix();
    C.fovH = f.h; C.fovV = f.v;

    var r = Math.min(2, global.devicePixelRatio || 1);
    C.hud.width = Math.round(w * r); C.hud.height = Math.round(h * r);
    C.hud.style.width = w + 'px'; C.hud.style.height = h + 'px';
    C.hudCtx.setTransform(r, 0, 0, r, 0, 0);
  };

  C.applyTheme = function () {
    if (!C.renderer) return;
    C.renderer.setClearColor(bgHex(), 1);
  };

  /* ------------------------------------------------ 位姿与朝向 */
  /** ENU 向量 → three 世界向量（与 scene3d 的 v3() 同一约定） */
  function wv(a) { return new THREE.Vector3(a[0], a[2], -a[1]); }

  /**
   * 把虚拟摄像头摆到声呐上。
   * 相机默认朝 −z 看，所以 lookAt(pos + fwd) 正好让 −z 对齐艏向；
   * camera.up 给声呐的天向轴，于是横滚也跟着（画面会随 ROV 侧倾而倾斜）。
   */
  C.place = function (pose, ax) {
    if (!C.camera) return;
    var p = new THREE.Vector3(pose.x, pose.z, -pose.y);
    C.camera.position.copy(p);
    C.camera.up.copy(wv(ax.up));
    C.camera.lookAt(p.clone().add(wv(ax.fwd)));
    C.camera.updateMatrixWorld(true);
  };

  /* ------------------------------------------------ 渲染前的场景"净场" */
  /**
   * 摄像头**看不见**的东西：三维里那些仿真辅助显示物。
   * 真实水下摄像头拍不到"淡蓝发射扇面""橙黄接收扇面""坐标轴""标尺数字"
   * "海底网格线""散射点""包围盒""选中圈""航迹线"——它们不是物理实体。
   * 而且半透明扇面正好罩在视线上，不清掉整个画面会被糊住。
   *
   * 实现用**白名单 + 记录还原**，而不是"隐藏一串黑名单"：
   *   ① 白名单只留真实存在的物体（海床、海面、目标）与三盏灯；
   *   ② 以后再往场景里加辅助物，自动一并清掉，不用回来补黑名单；
   *   ③ 灯的 visible 必须保留 —— three 里 light.visible=false 会真的关灯，
   *      画面会变全黑，这是最容易踩的一坑。
   * 每条都记录原值，渲染完逐条还原，绝不把主视口的显示开关改坏。
   */
  function hideHelpers(S) {
    var keep = [];
    function keepIf(o) { if (o) keep.push(o); }
    keepIf(S.seafloor); keepIf(S.surface);
    keepIf(S.ambLight); keepIf(S.dirLight); keepIf(S.dirLight2);
    if (S.targetObjs) Object.keys(S.targetObjs).forEach(function (id) { keepIf(S.targetObjs[id]); });

    var saved = [];
    S.scene.children.forEach(function (o) {
      if (keep.indexOf(o) >= 0) return;
      saved.push([o, o.visible]);
      if (o.visible) o.visible = false;
    });
    return saved;
  }
  function restoreHelpers(saved) {
    for (var i = 0; i < saved.length; i++) saved[i][0].visible = saved[i][1];
  }

  /**
   * 水体浑浊度（光学可见度）。
   * 声学在 400 kHz 的海水吸收约 0.1 dB/m（100 m 来回 20 dB，还能成像）；
   * 光学在清澈海水里的衰减系数就到 0.03~0.1 /m、近岸浑浊水体 0.3~1 /m ——
   * 这就是为什么"前视声呐看 100 m、摄像头只看得见十几米"。
   *
   * 用 FogExp2 的密度反推：雾因子 f = 1 − exp(−(d·ρ)²)，
   * 定义"能见度 V"为对比度衰减到 2%（f = 0.98）的距离：
   *     exp(−(V·ρ)²) = 0.02  ⟹  ρ = √(−ln0.02) / V ≈ 1.978 / V
   * haze = 0 时不额外加雾（与主视口一致，看得到远处的地形起伏）。
   */
  function hazeDensity(vis) {
    if (!(vis > 0)) return -1;
    return 1.978 / vis;
  }

  /* ------------------------------------------------ HUD 叠加层 */
  /** 方位角 θ / 俯仰角 φ → 画面像素（透视投影的逆用） */
  function angToPx(thDeg, phDeg) {
    var th = thDeg * DEG, ph = phDeg * DEG;
    var tv = Math.tan(C.fovV * DEG / 2), th_ = Math.tan(C.fovH * DEG / 2);
    var nx = Math.tan(th) / th_, ny = Math.tan(ph) / tv;
    return { x: C.W / 2 * (1 + nx), y: C.H / 2 * (1 - ny) };
  }

  C.drawHud = function (fov) {
    var x = C.hudCtx;
    if (!x) return;
    var W = C.W, H = C.H;
    x.clearRect(0, 0, W, H);
    if (!FLS.P['cam.ovl']) return;

    /* ① 声呐视场框：把扇形的水平 ±H/2、垂直 ±V/2 投成画面上的一个矩形。
       它是"比照"的关键 —— 框里才是声呐真正探测的范围，框外摄像头能看到、
       声呐看不到（框外两侧是发射没照到，框外上下是垂直开角之外）。 */
    var a = angToPx(-fov.hSonar / 2, fov.vSonar / 2);
    var b = angToPx(fov.hSonar / 2, -fov.vSonar / 2);
    x.save();
    x.lineWidth = 1.5;
    x.setLineDash([6, 4]);
    x.strokeStyle = 'rgba(120,220,255,.95)';           // 青：与三维里的淡蓝扇面同族
    x.strokeRect(a.x, a.y, Math.max(2, b.x - a.x), Math.max(2, b.y - a.y));
    x.setLineDash([]);
    /* 框内的四个角标，避免与画面内容混淆时看不出这是个框 */
    x.fillStyle = 'rgba(120,220,255,.95)';
    x.font = '10px ui-monospace,Menlo,Consolas,monospace';
    x.textAlign = 'left'; x.textBaseline = 'top';
    x.fillText('声呐视场 ' + fov.hSonar.toFixed(0) + '°×' + fov.vSonar.toFixed(0) + '°',
      a.x + 3, Math.max(1, a.y - 13));

    /* ② 光轴十字 */
    x.strokeStyle = 'rgba(255,210,63,.85)';
    x.beginPath();
    x.moveTo(W / 2 - 9, H / 2); x.lineTo(W / 2 + 9, H / 2);
    x.moveTo(W / 2, H / 2 - 9); x.lineTo(W / 2, H / 2 + 9);
    x.stroke();

    /* ③ 目标标注：把每个目标投影到画面上画框 + 名称。
       这才是"比照"最有用的一步 —— 声呐图上的某个亮点对应画面里的哪个东西，
       一眼对上；同时也能看出"摄像头看得见但声呐看不见"（框外的目标）。 */
    var tgs = (FLS.state && FLS.state.targets) || [];
    for (var i = 0; i < tgs.length; i++) {
      var t = tgs[i];
      if (t.visible === false) continue;
      var v = new THREE.Vector3(t.pos.e, t.pos.u, -t.pos.n);
      var wv2 = v.clone(); wv2.project(C.camera);
      if (wv2.z < -1 || wv2.z > 1) continue;            // 在相机后方或远裁剪面之外
      var px = (wv2.x * 0.5 + 0.5) * W, py = (-wv2.y * 0.5 + 0.5) * H;
      if (px < -40 || px > W + 40 || py < -40 || py > H + 40) continue;
      var inFov = Math.abs(wv2.x) <= 1 && Math.abs(wv2.y) <= 1;
      x.strokeStyle = inFov ? 'rgba(255,120,90,.95)' : 'rgba(150,150,150,.75)';
      x.lineWidth = 1.2;
      var s = 11;
      x.strokeRect(px - s / 2, py - s / 2, s, s);
      x.beginPath(); x.moveTo(px - s, py); x.lineTo(px - s / 2 - 2, py);
      x.moveTo(px + s / 2 + 2, py); x.lineTo(px + s, py); x.stroke();
      if (inFov) {
        x.fillStyle = 'rgba(255,190,170,.98)';
        x.textAlign = 'left'; x.textBaseline = 'bottom';
        var nm = t.name || t.type;
        if (nm.length > 8) nm = nm.slice(0, 8);
        x.fillText(nm, px + s / 2 + 3, py - s / 2 + 2);
      }
    }
    x.restore();
  };

  /* ------------------------------------------------ 渲染 */
  /**
   * 渲染一帧。force=true 用于视图切入 / 尺寸变化后必须立即出画的场合。
   * 全程只读场景 + 成对还原临时改动，不触碰任何仿真参数与内核状态。
   */
  C.render = function (force) {
    if (!C.ready || !C.renderer) return;
    if (FLS.P['cam.on'] === false) return;
    /* 视口还没量到真实尺寸（首次布局 / 当前被隐藏）时不要渲染：
       此时 W/H 可能是 0，solveFov 虽然兜了底，但画出来也是一张没意义的图。 */
    if (!(C.W >= 8) || !(C.H >= 8)) return;
    var S = FLS.scene3d;
    if (!S || !S.scene || !S.rovPose) return;

    var now = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
    if (!force && now - C.lastT < CAM_MS) return;
    C.lastT = now;

    var fov = C.solveFov(C.W / Math.max(1, C.H));
    C.fovH = fov.h; C.fovV = fov.v;
    if (Math.abs(C.camera.fov - fov.v) > 1e-4) {
      C.camera.fov = fov.v; C.camera.updateProjectionMatrix();
    }

    C.place(S.rovPose, S.sonarAxes(S.rovPose));

    /* —— 净场：暂时藏掉一切非物理的辅助显示物 —— */
    var saved = hideHelpers(S);

    /* —— 水体浑浊度：临时加浓雾，渲染完必须还原 —— */
    var vis = parseFloat(FLS.P['cam.haze']) || 0;
    var rho = hazeDensity(vis);
    var oldRho = S.scene.fog ? S.scene.fog.density : null;
    if (rho > 0 && S.scene.fog) S.scene.fog.density = rho;

    C.renderer.render(S.scene, C.camera);

    /* —— 还原：顺序与改动相反，且必须在任何可能 return 的路径上执行 —— */
    if (rho > 0 && S.scene.fog && oldRho !== null) S.scene.fog.density = oldRho;
    restoreHelpers(saved);

    C.drawHud(fov);

    C.frames++;
    if (!C.fpsT) C.fpsT = now;
    if (now - C.fpsT > 1000) {
      C.fps = C.frames * 1000 / (now - C.fpsT);
      C.frames = 0; C.fpsT = now;
    }
  };

  /** 供 UI 状态栏显示的一行说明（实测视场 + 与声呐的比对） */
  C.info = function () {
    var f = C.solveFov(C.W / Math.max(1, C.H));
    return '矩形视场 ' + f.h.toFixed(1) + '°×' + f.v.toFixed(1) +
      '°　≥　声呐 ' + f.hSonar.toFixed(0) + '°×' + f.vSonar.toFixed(0) + '°';
  };

})(window);
