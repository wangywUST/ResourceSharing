/* =========================================================================
 * 50-imaging.js —— 前视声呐扇形成像显示 / 色标系统 / 信号观测绘图
 *   扇形画布：径向 = 距离，角度 = 水平扇角；艏向朝上（−θ 左，+θ 右）
 *   色标：声图色标 ① 琥珀金（前视声呐经典，V1.4 起为默认）② 灰度 ③ Jet
 *         ④ 蓝-绿-黄-红 ⑤ 紫橙 ⑥ 冷蓝
 *         V2.1 另有一套**海底深度色标**（terr:true，见下方 CMAPS）：
 *         ① 水深色标（深蓝→绿→黄→红，默认）② 自然地形色 ③ 分层设色
 *         ④ 热图 Jet ⑤ 水深灰度 ⑥ 单色蓝 —— 只用于三维海床顶点着色，
 *         不出现在声图色标下拉里。
 *   所有显示数据均来自波束形成输出的幅度矩阵（阵元级时域信号处理结果）
 * ========================================================================= */
(function () {
  var U = FLS.U, DEG = U.DEG;

  /* ---------------------------------------------------- 色标 */
  function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }
  function ramp(stops, t) {
    t = clamp01(t) * (stops.length - 1);
    var i = Math.floor(t), f = t - i;
    if (i >= stops.length - 1) return stops[stops.length - 1];
    var a = stops[i], b = stops[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  var CMAPS = {
    /* V1.4：琥珀金（黑底暖黄）—— 与国内外商用前视声呐显示器的标准配色一致。
     * 参考图实测：弱回波为纯黑/暗褐，海床散斑在中段呈"暗金"，目标饱和到亮黄白。
     * 这条色标的低端保持纯黑（水体/声影），中段才有可见亮度，因此声影与目标的
     * 层次比彩虹色标清楚得多（彩虹色标低端是深蓝，与黑色背景反差小）。 */
    amber: { name: '琥珀金（前视声呐经典）', stops: [[0, 0, 0], [10, 7, 2], [34, 24, 8], [72, 50, 14], [118, 84, 22], [168, 126, 36], [214, 170, 60], [248, 216, 110], [255, 246, 190]] },
    gray: { name: '灰度色标', stops: [[0, 0, 0], [90, 90, 90], [190, 190, 190], [255, 255, 255]] },
    jet: { name: '热图 Jet', stops: [[0, 0, 130], [0, 0, 255], [0, 200, 255], [80, 255, 120], [240, 240, 0], [255, 80, 0], [140, 0, 0]] },
    sonar: { name: '蓝-绿-黄-红水声色标', stops: [[8, 16, 60], [10, 60, 150], [0, 140, 160], [40, 190, 90], [220, 220, 40], [250, 140, 20], [220, 30, 20]] },
    purple: { name: '紫橙渐变色标', stops: [[20, 8, 45], [80, 25, 120], [160, 60, 150], [235, 130, 90], [250, 200, 90], [255, 245, 210]] },
    cold: { name: '冷蓝单色系', stops: [[6, 14, 32], [16, 48, 96], [40, 96, 168], [110, 165, 220], [200, 230, 250], [255, 255, 255]] },

    /* ------------------------------------------------------------------
     * V2.1：三维海床「深度着色」专用色标（terr:true），与声图色标完全分开。
     *   两套分开的原因：声图色标映射的是**回波强度 dB**（低端必须是黑/暗色，
     *   才能把声影与水体的"无回波"和弱回波区分开）；海底色标映射的是**水深**，
     *   没有"零值"语义，需要的是等感层次与符合制图习惯的色序。
     *   stops[0] = 最浅（图例顶端），末元素 = 最深。
     * ------------------------------------------------------------------ */
    /* ① 水深色标（深蓝→绿→黄→红）—— 国际海图 / GMT 分层设色的常规做法：
     *    深处深蓝，越浅依次青 → 绿 → 黄 → 橙 → 红。等感度高，读图时"哪边浅、哪边深"
     *    一眼可辨，且不依赖亮度差（灰度/单色系在 3D 光照下最容易丢层次）。 */
    tdepth: {
      name: '水深色标（深蓝→绿→黄→红）', terr: true,
      stops: [[196, 24, 18], [242, 132, 20], [250, 226, 62], [118, 204, 92], [22, 168, 154], [16, 88, 186], [6, 14, 76]]
    },
    /* ① 沙土黄地形色（浅黄沙→深褐）—— V2.2 起作为海底**默认**着色。
     *    真实浅海海底（砂质/粉砂质）的固有色就是浅黄褐—橄榄色，测绘软组织、
     *    多波束底质分类图的"砂"类配色也取这一带色相。这条色标全程不走色相
     *    （不引入绿、蓝、红），只让明度随深度加深，于是：
     *      ① 平坦海床落在中段 → 一片均匀的沙土黄，与实拍海底观感一致；
     *      ② 有起伏时靠明度差读地形，不会出现"海底变绿/变红"这类误导；
     *      ③ 淡蓝发射扇面 + 橙黄接收扇面叠在上面时不会被背景色吃掉。 */
    tsand: {
      name: '沙土黄地形色（浅黄→深褐）', terr: true,
      stops: [[236, 216, 168], [222, 199, 148], [201, 180, 132], [176, 162, 120], [146, 138, 104], [112, 108, 84], [80, 80, 66]]
    },
    /* ② 自然地形色（浅黄沙→深蓝）—— ★ V3.4 起作为三维海底的**默认**着色。
     *    浅端是"湿沙黄"：真实浅海砂质海底在自然光下就是这个色相，
     *    测绘软组织 / 多波束底质分类图里"砂"类也取这一带。
     *    深端逐步过渡到深蓝，于是浅滩黄、陆坡绿、深洼蓝，读地形靠色相 + 明度双通道。
     *    ★ V3.4 整体提亮一档（浅端 226→240、中前段 196→216）：
     *    旧值叠上三维的光照衰减之后，平坦海底落在"发灰的土黄"上，
     *    用户反馈"灰蒙蒙的"。提亮后开机第一眼是明确的亮沙黄，而不是脏黄。 */
    terrain: {
      name: '自然地形色（浅黄沙→深蓝）', terr: true,
      stops: [[240, 219, 160], [216, 196, 132], [176, 190, 112], [104, 170, 140], [52, 124, 172], [22, 56, 108]]
    },
    /* ③ 分层设色（浅滩黄绿→深海蓝紫）—— 陆地/浅滩用黄绿，陆坡转绿蓝，深海转紫 */
    thyps: {
      name: '分层设色（浅滩黄绿→深海蓝紫）', terr: true,
      stops: [[246, 240, 196], [210, 226, 154], [142, 202, 142], [66, 172, 162], [40, 118, 182], [30, 58, 142], [16, 18, 78]]
    },
    /* ④ 热图 Jet（浅红→深蓝）—— 与水声 Jet 同一色序，便于和声图对照 */
    tjet: {
      name: '热图 Jet（浅红→深蓝）', terr: true,
      stops: [[138, 0, 22], [224, 52, 0], [252, 206, 32], [70, 236, 112], [0, 190, 242], [0, 58, 222], [0, 0, 138]]
    },
    /* ⑤ 水深灰度（浅亮→深暗）—— 打印/制图友好，层次靠明度 */
    tgray: {
      name: '水深灰度（浅亮→深暗）', terr: true,
      stops: [[240, 240, 240], [200, 200, 200], [156, 156, 156], [110, 110, 110], [64, 64, 64], [22, 22, 22]]
    },
    /* ⑥ 单色蓝（浅白蓝→深蓝）—— 只表达水深一个量，不引入色相干扰 */
    tblue: {
      name: '单色蓝（浅白蓝→深蓝）', terr: true,
      stops: [[228, 242, 255], [172, 208, 242], [112, 168, 218], [60, 116, 176], [26, 66, 128], [8, 24, 72]]
    }
  };
  FLS.CMAPS = CMAPS;
  /** V2.1：海底深度色标的 id 列表（顺序即下拉里的顺序），声图色标不含这些。 */
  FLS.TERRAIN_CMAP_IDS = ['tsand', 'terrain', 'tdepth', 'thyps', 'tjet', 'tgray', 'tblue'];
  FLS.cmapColor = function (id, t) { var c = CMAPS[id] || CMAPS.gray; return ramp(c.stops, t); };

  /* ---------------------------------------------------- 扇形视图 */
  var S = {
    canvas: null, ctx: null, ov: null, octx: null,
    imgData: null, map: null, W: 0, H: 0, geom: null,
    cursor: { on: false, x: 0, y: 0, r: 0, a: 0, val: 0 },
    freeze: false, frozen: null
  };

  function ensureColorbar() {
    if (document.getElementById('colorbar')) return;
    var host = document.getElementById('hostSonar');
    var d = document.createElement('div');
    d.id = 'colorbar';
    var cl = FLS.Theme ? FLS.Theme.cssVar('--cbLabTxt', '#cfe0f2') : '#cfe0f2';
    var hl = FLS.Theme ? FLS.Theme.cssVar('--hudTxt', '#9fd7ff') : '#9fd7ff';
    d.innerHTML = '<div id="cbHi" style="font-family:monospace;font-size:9px;color:' + cl + '"></div>' +
      '<div id="cbGrad"></div>' +
      '<div id="cbLo" style="font-family:monospace;font-size:9px;color:' + cl + '"></div>' +
      '<div id="cbUnit" style="font-family:monospace;font-size:9px;color:' + hl + ';margin-top:2px"></div>';
    host.appendChild(d);
  }

  /** 计算扇形几何：顶点、半径、角度范围 */
  function geometry(W, H, sectorDeg) {
    var pad = 26, sec = sectorDeg * DEG;
    var ax, ay, R;
    if (sectorDeg >= 180) {
      ax = W / 2; ay = H / 2; R = Math.min(W, H) / 2 - pad;
    } else {
      ax = W / 2; ay = H - pad;
      R = Math.min((W / 2 - pad) / Math.sin(sec / 2), H - 2 * pad);
    }
    return { ax: ax, ay: ay, R: R, sec: sec, secDeg: sectorDeg };
  }

  /** 建立像素 → (波束, 距离单元) 映射表
   *
   * ★ V1.2 修正：改为**浮点坐标 + 双线性插值**。
   *   旧实现用 Math.round() 取最近邻，当 nBin（默认 512）大于扇形半径的像素数时
   *   （1080p、DPR=1 时 R≈365 px，即 1.43 个距离单元挤进 1 个像素），相邻像素会
   *   跳过不同的距离单元，采样到彼此几乎独立的散斑值，于是整幅图出现**棋盘状摩尔纹**——
   *   看上去"像噪声"，实际上是被显示采样毁掉的真数据。方位维同理（181 波束铺在
   *   半径 30 m 处约 458 px 的弧上，最近邻取样表现为横向断续的短划）。
   *   双线性插值同时解决"欠采样混叠"与"过采样块状"两个方向的问题。
   *
   *   返回 { a, b }：两条 Float32Array，存像素对应的浮点 (波束, 距离单元) 坐标，
   *   扇区外为 -1（渲染时据此填背景色）。 */
  function buildMap(W, H, g, nBeam, nBin) {
    var fa = new Float32Array(W * H).fill(-1);
    var fb = new Float32Array(W * H).fill(-1);
    var maxA = nBeam - 1, maxB = nBin - 1;
    for (var y = 0; y < H; y++) {
      var dy = y - g.ay;
      for (var x = 0; x < W; x++) {
        var dx = x - g.ax;
        var r = Math.sqrt(dx * dx + dy * dy);
        if (r > g.R) continue;
        var th = Math.atan2(dx, -dy);                  // 艏向朝上，右为正
        if (Math.abs(th) > g.sec / 2) continue;
        var a = (th + g.sec / 2) / g.sec * maxA;
        var b = (r / g.R) * maxB;
        if (a < 0) a = 0; else if (a > maxA) a = maxA;
        if (b < 0) b = 0; else if (b > maxB) b = maxB;
        var p = y * W + x;
        fa[p] = a; fb[p] = b;
      }
    }
    return { a: fa, b: fb };
  }

  FLS.Imaging = {
    S: S,
    init: function () {
      S.canvas = document.getElementById('sonarCanvas');
      S.ctx = S.canvas.getContext('2d');
      S.ov = document.getElementById('sonarOverlay');
      S.octx = S.ov.getContext('2d');
      ensureColorbar();
      // 鼠标交互（测距光标）
      S.ov.addEventListener('mousemove', function (e) {
        if (!S.cursor.on) return;
        var rect = S.ov.getBoundingClientRect();
        S.cursor.x = e.clientX - rect.left; S.cursor.y = e.clientY - rect.top;
        FLS.Imaging.drawOverlay();
      });
      S.ov.addEventListener('mouseleave', function () { if (S.cursor.on) FLS.Imaging.drawOverlay(); });
    },
    resize: function () {
      /* V2.0：init() 之前也可能被 resizeAll() 调到（ui.init 末尾会切一次视图），
         这里必须自己兜住，否则 S.canvas/S.ov 还是 null 会抛异常。 */
      if (!S.canvas || !S.ov) return;
      var host = document.getElementById('hostSonar');
      var w = Math.max(120, host.clientWidth), h = Math.max(120, host.clientHeight);
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      [S.canvas, S.ov].forEach(function (c) {
        c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
        c.style.width = w + 'px'; c.style.height = h + 'px';
      });
      S.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      S.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      S.W = w; S.H = h;
      S.imgData = S.ctx.createImageData(Math.round(w * dpr), Math.round(h * dpr));
      S.map = null; S.geom = null;
    },
    /** 把线性幅度矩阵转换为显示用 dB 矩阵（按显示模式） */
    toDisplay: function (res, mode) {
      var img = res.img, nf = res.nf, nB = res.diag.nBeam, nR = res.diag.nBin;
      var out = new Float32Array(img.length), i;
      if (mode === 'snr') {
        for (i = 0; i < img.length; i++) {
          var bin = i % nR;
          out[i] = U.pow2db(img[i] * img[i] / Math.max(1e-30, nf[bin]));
        }
      } else {
        for (i = 0; i < img.length; i++) out[i] = U.lin2db(img[i]);
      }
      return out;
    },
    /** 显示域多视平均（V1.2 新增）
     *
     * 物理背景：海床混响是大量独立散射体回波的叠加，单视（single-look）幅度服从
     * Rayleigh 分布——峰值比中位数高 8~10 dB 是常态，起伏标准差约 5.6 dB。
     * 一个比背景高 10 dB 的目标，恰好落在这个起伏范围里，**单视图像上就是看不出来**。
     * 这不是 bug，是斑点噪声（speckle）的固有性质。
     *
     * 真实声呐显示器的做法是**多视平均**（multi-look）：把相邻若干个分辨单元/视数的
     * 功率相干地相加，斑点起伏按 1/√N 下降。这里对**功率**（幅值²）做可分离盒式平均，
     * 再开方还原为幅值，等价于 N=k² 视平均。
     *
     * 注意：这是**纯显示处理**——`res.imgDisp` 原样保留，峰值/信噪比等指标仍按单视数据
     * 统计（`updateMetrics` 用 imgDisp），导出与存档也不受影响。
     *
     * @param {Float32Array} img 幅值（波束形成输出）
     * @param {number} k 窗口边长（1=不平滑）
     */
    mlook: function (img, nBeam, nBin, k) {
      k = k | 0;
      if (k <= 1) return img;
      if (!(k % 2)) k += 1;                 // 强制奇数窗，保证中心对齐
      var rad = (k - 1) >> 1;
      var n = img.length, i, a, b, s;
      var pw = new Float32Array(n), tmp = new Float32Array(n), out = new Float32Array(n);
      for (i = 0; i < n; i++) pw[i] = img[i] * img[i];
      // 沿距离维（行内相邻）
      var win = 1 / k;
      for (a = 0; a < nBeam; a++) {
        var base = a * nBin;
        for (b = 0; b < nBin; b++) {
          s = 0;
          for (var d = -rad; d <= rad; d++) {
            var bb = b + d; if (bb < 0) bb = 0; else if (bb >= nBin) bb = nBin - 1;
            s += pw[base + bb];
          }
          tmp[base + b] = s * win;
        }
      }
      // 沿方位维（跨行）
      for (b = 0; b < nBin; b++) {
        for (a = 0; a < nBeam; a++) {
          s = 0;
          for (var d2 = -rad; d2 <= rad; d2++) {
            var aa = a + d2; if (aa < 0) aa = 0; else if (aa >= nBeam) aa = nBeam - 1;
            s += tmp[aa * nBin + b];
          }
          out[a * nBin + b] = s * win;
        }
      }
      for (i = 0; i < n; i++) out[i] = Math.sqrt(out[i] > 0 ? out[i] : 0);
      return out;
    },
    /** 自动动态范围（分位数锚点 + 可配置跨度）
     *
     *  ★ V1.4.1 定稿口径：**跨度 48 dB、p75 锚在色标 20% 处**。
     *
     *  这三轮标定走过的弯路值得记下来（判据全部来自对参考实拍图的像素统计）：
     *
     *  ① V1.3：跨度硬夹 48 dB、锚点 64%。结果整片海床挤在色标中上部，
     *    对数域标准差 5.6 dB 的散斑只占 12% 色阶，纹理被压平。
     *  ② V1.4 初版：过度收缩到跨度 26 dB、锚点 42%。26 dB 连海床自身沿距离的
     *    亮度差都装不下（实测模板③ 16 m→70 m 相差 28 dB），大片海底被截成纯黑，
     *    图像出现"中间一坨亮、两头全黑"的分层。
     *  ③ V1.4.1：回到 48 dB，但把锚点从 64% 压到 20%。这是逐项对上参考图的解：
     *    参考图（海底鹰实拍，满量程 255）扇区内 p10/p50/p75/p90/p99 =
     *    22/35/51/77/236，即 p75 只占满量程 20%、p99（目标）到 93%。
     *    用 Rayleigh 散斑的理论分位（对数域 p10 = p75−11.2、p50 = p75−3.0、
     *    p90 ≈ p75+6.1 dB）反推：跨度 S 满足 3.0/S = 0.137−0.20+3.0/S…
     *    解得 S ≈ 48 dB，且 p50 落在 0.20−3/48 = 13.8%（参考 13.7%）、
     *    p90 落在 32.7%（参考 30%）——三项同时对上。
     *
     *  所以「跨度大」并不等于「平」：跨度决定海床散斑占多少色阶，锚点决定海床
     *  落在色标的哪一段。要的是"海床压在下三分之一、目标顶到亮黄白"。
     */
    autoRange: function (db, pct) {
      var n = db.length, step = Math.max(1, Math.floor(n / 20000));
      var arr = [];
      for (var i = 0; i < n; i += step) {
        var v = db[i];
        if (isFinite(v) && v > -300) arr.push(v);       // 剔除 -inf / 空单元
      }
      if (!arr.length) return { hi: 0, lo: -40 };
      arr.sort(function (a, b) { return a - b; });
      var q = function (t) { return arr[Math.floor((arr.length - 1) * t)]; };
      var ref = q(0.75);
      if (!isFinite(ref)) ref = q(0.5);
      // 跨度：优先用参数，缺省 48 dB；夹在 [10,80] 防手滑
      var span = FLS.P ? parseFloat(FLS.P['disp.dynSpan']) : 48;
      if (!isFinite(span)) span = 48;
      if (span < 10) span = 10;
      if (span > 80) span = 80;
      // p75 锚在色标 20% 处（V1.4.1 定稿，依据见上方注释）
      var loN = ref - 0.30 * span;
      var hiN = loN + span;
      return { hi: hiN, lo: loN, ref: ref, span: span };
    },
    /**
     * 扇区边缘增益补偿（显示端，V1.4 新增）
     *
     * 物理事实：一维线阵 + 120° 发射扇面的**双向**指向性在扇区边缘必然衰减 ——
     * 发射垂直/水平扇面与接收阵元指向性相乘，实测 ±50° 处比视轴低约 20 dB。
     * 于是扇面呈"中间亮、两翼黑"的楔形，和真实前视声呐图像（整个扇区亮度均匀）
     * 观感差别很大。
     *
     * 商用前视声呐显示器的做法是对**已知的系统指向性**做固定补偿（sector gain /
     * beam-pattern correction），而不是放任这一衰减进入显示动态范围。这里按同一
     * 口径实现：沿方位统计已照亮距离段的上四分位数（p75 跟踪混响电平、不受目标
     * 与声影影响），做宽度约 1/10 扇区的滑动平均得到慢变包络，以包络最大值归零，
     * 补偿量上限 15 dB。
     *
     * 只改显示，不改波束形成输出；可关（disp.fanComp）以便观察真实指向性。
     */
    fanComp: function (db, nBeam, nBin) {
      var i, be, bi, N = nBeam * nBin;
      if (!N) return null;
      // ① 逐单元沿方位的分位数，找出"已照亮"的距离段
      var colMed = new Float32Array(nBin), tmp = [];
      for (bi = 0; bi < nBin; bi++) {
        tmp.length = 0;
        for (be = 0; be < nBeam; be++) { var v = db[be * nBin + bi]; if (isFinite(v) && v > -300) tmp.push(v); }
        if (!tmp.length) { colMed[bi] = -300; continue; }
        tmp.sort(function (a, b) { return a - b; });
        colMed[bi] = tmp[tmp.length >> 1];
      }
      var mMax = -300;
      for (bi = 0; bi < nBin; bi++) if (colMed[bi] > mMax) mMax = colMed[bi];
      if (!isFinite(mMax) || mMax < -200) return null;
      var biLo = 0, biHi = nBin - 1;
      while (biLo < nBin && colMed[biLo] < mMax - 15) biLo++;
      while (biHi > 0 && colMed[biHi] < mMax - 15) biHi--;
      if (biHi - biLo < 4) return null;
      // ② 逐波束 p75（跟踪混响电平）
      var prof = new Float32Array(nBeam);
      for (be = 0; be < nBeam; be++) {
        tmp.length = 0;
        for (bi = biLo; bi <= biHi; bi++) {
          var v2 = db[be * nBin + bi];
          if (isFinite(v2) && v2 > -300) tmp.push(v2);
        }
        if (!tmp.length) { prof[be] = mMax; continue; }
        tmp.sort(function (a, b) { return a - b; });
        prof[be] = tmp[Math.floor((tmp.length - 1) * 0.75)];
      }
      // ③ 滑动平均得到慢变包络（宽度 ≈ 1/10 扇区，两端按边界截断）
      var w = Math.max(5, Math.round(nBeam / 10)), half = w >> 1;
      var sm = new Float32Array(nBeam);
      for (be = 0; be < nBeam; be++) {
        var s = 0, c = 0;
        for (i = Math.max(0, be - half); i <= Math.min(nBeam - 1, be + half); i++) { s += prof[i]; c++; }
        sm[be] = s / c;
      }
      var smMax = -300;
      for (be = 0; be < nBeam; be++) if (sm[be] > smMax) smMax = sm[be];
      // ④ 补偿量：0~15 dB，加回图像
      var gain = new Float32Array(nBeam);
      for (be = 0; be < nBeam; be++) {
        var g = smMax - sm[be];
        if (!(g > 0)) g = 0;
        if (g > 15) g = 15;
        gain[be] = g;
        if (g > 0.05) for (bi = 0; bi < nBin; bi++) {
          var idx = be * nBin + bi, vv = db[idx];
          if (isFinite(vv) && vv > -300) db[idx] = vv + g;
        }
      }
      return gain;
    },
    /** 渲染扇形图像 */
    render: function (db, nBeam, nBin, sectorDeg, lo, hi, cmapId) {
      if (!S.imgData) FLS.Imaging.resize();
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var wPx = S.canvas.width, hPx = S.canvas.height;
      var g = geometry(wPx, hPx, sectorDeg);
      if (!S.geom || S.geom.R !== g.R || S.geom.ax !== g.ax || S.geom.ay !== g.ay || S.geom.sec !== g.sec ||
        !S.map || S.mapBeam !== nBeam || S.mapBin !== nBin) {
        S.map = buildMap(wPx, hPx, g, nBeam, nBin);
        S.mapBeam = nBeam; S.mapBin = nBin; S.geom = g;
      }
      // 防止手动模式下 hi ≤ lo（例如 hi 设得比 lo 小）：反置或压平时整幅会饱和成纯白
      if (!isFinite(lo) || !isFinite(hi) || hi - lo < 0.5) {
        var cen = (isFinite(hi) ? hi : 0);
        hi = cen + 0.5; lo = cen - 39.5;
      }
      var data = S.imgData.data, span = Math.max(1e-6, hi - lo);
      var lut = new Uint8Array(1024 * 3);
      for (var k = 0; k < 1024; k++) {
        var c = FLS.cmapColor(cmapId, k / 1023);
        lut[3 * k] = c[0] | 0; lut[3 * k + 1] = c[1] | 0; lut[3 * k + 2] = c[2] | 0;
      }
      /* ---- V1.4：距离向抗混叠抽取 ----------------------------------------
       * 距离单元宽 = (rmax−rmin)/nBin。默认 60 m/512 ≈ 0.12 m，而扇区半径只有
       * 几百像素 → **一个像素覆盖 2~3 个距离单元**。此时若直接双线性采样，等于
       * 对细于像素的散斑做点抽样：相邻像素落在互相独立的散斑单元上，画面就会出现
       * 沿方位的周期性莫尔波纹（实测截图中可见），既不是真实散斑也不是地形。
       * 真实声呐显示器在"波束输出 → 像素栅格"这一步做的是箱式平均（一个像素
       * 覆盖多少个分辨单元就平均多少个），这里按同一口径实现。
       * 注意：只在欠采样时启用（每像素距离单元数 ≥ 1.6），采样充足的放大视图
       * 保持原始散斑不被抹平。 */
      var pxPerBin = g.R / Math.max(1, nBin);          // 每个距离单元的径向像素数
      var pxPerBeam = g.R * (sectorDeg * Math.PI / 180) / Math.max(1, nBeam);
      /* ★ V1.4.1 距离向配平（display aspect equalization）
       * 前视声呐的分辨单元是**强各向异性**的：方位向 = θ3dB·r（35 m 处约 2 m），
       * 距离向 = 显示单元宽度（默认 0.2 m）。于是散斑在显示上必然是"细长的方位向
       * 条纹"——相邻波束相关系数 0.9，而同一条波束上相邻单元几乎不相关，眼睛看到的
       * 就是一根根从圆心放射出去的亮丝。参考国外/国内实拍图（海底鹰、Gemini）里
       * 海床纹理是各向同性的颗粒，因为它们的显示栅格把距离向也合并了。
       * 这里按同一口径把 k 个相邻距离单元做**功率平均**（不是幅值平均），k 取
       * 「一个波束跨过的像素数 / 一个距离单元占的像素数」，使显示颗粒在两方向上
       * 的像素尺度接近；k 同时满足抗混叠（每像素 ≥1.6 个单元）的下限。
       * 副作用与多视相同：散斑起伏按 √k 下降，等价于 k 视非相干平均。 */
      var kR = Math.round(pxPerBeam / Math.max(1e-6, pxPerBin));
      if (pxPerBin < 0.625) kR = Math.max(kR, Math.min(12, Math.round(1 / pxPerBin)));
      if (!isFinite(kR) || kR < 1) kR = 1;
      if (kR > 8) kR = 8;
      var srcDb = db;
      if (kR > 1) {
        srcDb = new Float32Array(db.length);
        var half = kR >> 1;
        for (var be0 = 0; be0 < nBeam; be0++) {
          var base0 = be0 * nBin, sum0 = 0, loP = 0, hiP = -1, cnt0 = 0;
          for (var b0s = 0; b0s < nBin; b0s++) {
            var hiN = Math.min(nBin - 1, b0s + half), loN = Math.max(0, b0s - half);
            while (hiP < hiN) { var vv = db[base0 + (++hiP)]; sum0 += Math.pow(10, Math.max(-30, (isFinite(vv) ? vv : -300)) * 0.1); cnt0++; }
            while (loP < loN) { var vv2 = db[base0 + (loP++)]; sum0 -= Math.pow(10, Math.max(-30, (isFinite(vv2) ? vv2 : -300)) * 0.1); cnt0--; }
            srcDb[base0 + b0s] = cnt0 > 0 ? 10 * Math.log10(Math.max(1e-30, sum0 / cnt0)) : -300;
          }
        }
      }
      // ---- 双线性重采样（V1.2）：像素 ← 4 个相邻 (波束, 距离单元) 的加权 ----
      var fa = S.map.a, fb = S.map.b, nPx = fa.length, inv = 1 / span;
      var a0 = 0, b0 = 0, a1 = 0, b1 = 0, wa = 0, wb = 0, w00 = 0, w01 = 0, w10 = 0, w11 = 0;
      var i00 = 0, i01 = 0, i10 = 0, i11 = 0, v = 0, t = 0, q = 0;
      for (var p = 0; p < nPx; p++) {
        var av = fa[p];
        var o = p * 4;
        if (av < 0) { data[o] = 12; data[o + 1] = 18; data[o + 2] = 26; data[o + 3] = 255; continue; }
        var bv = fb[p];
        a0 = av | 0; b0 = bv | 0;
        wa = av - a0; wb = bv - b0;
        a1 = (a0 + 1 < nBeam) ? a0 + 1 : a0;
        b1 = (b0 + 1 < nBin) ? b0 + 1 : b0;
        i00 = a0 * nBin + b0; i01 = a0 * nBin + b1;
        i10 = a1 * nBin + b0; i11 = a1 * nBin + b1;
        w00 = (1 - wa) * (1 - wb); w01 = (1 - wa) * wb;
        w10 = wa * (1 - wb); w11 = wa * wb;
        v = srcDb[i00] * w00 + srcDb[i01] * w01 + srcDb[i10] * w10 + srcDb[i11] * w11;
        t = (v - lo) * inv;
        q = (t <= 0 ? 0 : (t >= 1 ? 1023 : (t * 1023) | 0)) * 3;
        data[o] = lut[q]; data[o + 1] = lut[q + 1]; data[o + 2] = lut[q + 2]; data[o + 3] = 255;
      }
      S.ctx.setTransform(1, 0, 0, 1, 0, 0);
      S.ctx.putImageData(S.imgData, 0, 0);
      S.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      S.lastDb = db; S.lastNBeam = nBeam; S.lastNBin = nBin;
      FLS.Imaging.drawOverlay(lo, hi, sectorDeg, cmapId);
    },
    /** 叠加层：距离/角度刻度、网格、色标条、光标读数 */
    drawOverlay: function (lo, hi, sectorDeg, cmapId) {
      var ctx = S.octx, dpr = Math.min(2, window.devicePixelRatio || 1);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, S.canvas.width, S.canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!S.geom) return;
      var g = S.geom, W = S.W, H = S.H;
      // 几何量以设备像素存储，绘制坐标系为 CSS 像素：统一折算
      var ax = g.ax / dpr, ay = g.ay / dpr, RR = g.R / dpr;
      var rmax = FLS.P['alg.rmax'], rmin = FLS.P['alg.rmin'];
      ctx.save();
      ctx.strokeStyle = 'rgba(150,190,230,.45)';
      ctx.fillStyle = 'rgba(190,220,250,.9)';
      ctx.font = '10px monospace';
      ctx.lineWidth = 1;
      // 距离弧
      var step = niceStep(rmax, 6);
      for (var r = Math.ceil(rmin / step) * step; r <= rmax; r += step) {
        var rr = RR * (r - rmin) / Math.max(1e-6, rmax - rmin);
        if (rr <= 0) continue;
        ctx.beginPath();
        ctx.arc(ax, ay, rr, -Math.PI / 2 - g.sec / 2, -Math.PI / 2 + g.sec / 2);
        ctx.stroke();
        ctx.fillText(r.toFixed(0) + 'm', ax + 3, ay - rr - 3);
      }
      // 角度射线
      var astep = g.secDeg > 200 ? 30 : (g.secDeg > 100 ? 15 : 10);
      for (var a = -Math.floor(g.secDeg / 2 / astep) * astep; a <= g.secDeg / 2; a += astep) {
        var ar = a * DEG - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + RR * Math.cos(ar), ay + RR * Math.sin(ar));
        ctx.stroke();
        var lr = RR * 0.94;
        ctx.fillText(a + '°', ax + lr * Math.cos(ar) - 8, ay + lr * Math.sin(ar) + (a >= 0 ? 12 : -4));
      }
      // 外框
      ctx.strokeStyle = 'rgba(180,220,255,.7)';
      ctx.beginPath();
      ctx.arc(ax, ay, RR, -Math.PI / 2 - g.sec / 2, -Math.PI / 2 + g.sec / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + RR * Math.sin(-g.sec / 2), ay - RR * Math.cos(-g.sec / 2));
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + RR * Math.sin(g.sec / 2), ay - RR * Math.cos(g.sec / 2));
      ctx.stroke();
      // 艏向标记
      ctx.fillStyle = '#ffe08a';
      ctx.beginPath();
      ctx.moveTo(ax, ay - RR - 2); ctx.lineTo(ax - 4, ay - RR + 6); ctx.lineTo(ax + 4, ay - RR + 6);
      ctx.closePath(); ctx.fill();
      // 光标（CSS 像素坐标系，与几何折算后的 ax/ay/RR 一致）
      if (S.cursor.on && S.lastDb) {
        var cr = Math.sqrt((S.cursor.x - ax) * (S.cursor.x - ax) + (S.cursor.y - ay) * (S.cursor.y - ay));
        var cth = Math.atan2(S.cursor.x - ax, -(S.cursor.y - ay));
        if (Math.abs(cth) <= g.sec / 2 && cr <= RR) {
          var ai2 = Math.round((cth + g.sec / 2) / g.sec * (S.lastNBeam - 1));
          var bi2 = Math.round((cr / RR) * (S.lastNBin - 1));
          var v = S.lastDb[ai2 * S.lastNBin + bi2];
          var rr2 = rmin + (rmax - rmin) * (cr / RR);
          ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(S.cursor.x, S.cursor.y, 5, 0, 6.283); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(S.cursor.x - 9, S.cursor.y); ctx.lineTo(S.cursor.x + 9, S.cursor.y);
          ctx.moveTo(S.cursor.x, S.cursor.y - 9); ctx.lineTo(S.cursor.x, S.cursor.y + 9); ctx.stroke();
          ctx.fillStyle = '#ffe08a';
          ctx.fillText('R=' + rr2.toFixed(1) + 'm  θ=' + (cth / DEG).toFixed(1) + '°  ' + v.toFixed(1) + 'dB',
            Math.min(W - 190, S.cursor.x + 10), Math.max(12, S.cursor.y - 10));
          S.cursor.r = rr2; S.cursor.a = cth / DEG; S.cursor.val = v;
          S.cursor.ai = ai2; S.cursor.bi = bi2;
        }
      }
      ctx.restore();
      // 色标条
      var cbG = document.getElementById('cbGrad');
      if (cbG && lo !== undefined) {
        var stops = [];
        for (var s = 0; s <= 10; s++) {
          var c2 = FLS.cmapColor(cmapId || FLS.P['disp.cmap'], s / 10);
          stops.push('rgb(' + (c2[0] | 0) + ',' + (c2[1] | 0) + ',' + (c2[2] | 0) + ') ' + (s * 10) + '%');
        }
        cbG.style.background = 'linear-gradient(to top,' + stops.join(',') + ')';
        document.getElementById('cbHi').textContent = hi.toFixed(0);
        document.getElementById('cbLo').textContent = lo.toFixed(0);
        document.getElementById('cbUnit').textContent = (document.getElementById('sonarView').value === 'snr') ? 'dB(SNR)' : 'dB';
      }
    },
    /** 导出当前扇形画布为 PNG（含叠加层） */
    exportPNG: function (filename) {
      var c = document.createElement('canvas');
      c.width = S.canvas.width; c.height = S.canvas.height;
      var cx = c.getContext('2d');
      cx.fillStyle = '#0b1119'; cx.fillRect(0, 0, c.width, c.height);
      cx.drawImage(S.canvas, 0, 0);
      cx.drawImage(S.ov, 0, 0);
      c.toBlob(function (b) { FLS.download(filename || 'FLS_image.png', b, 'image/png'); });
    }
  };
  function niceStep(range, n) {
    var raw = range / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    var f = m < 1.5 ? 1 : (m < 3 ? 2 : (m < 7 ? 5 : 10));
    return f * p;
  }

  /* ---------------------------------------------------- 信号观测绘图
   * ★ V3.7 升级（对应用户的三条要求）：
   *   ① 框选放大：在波形上按住鼠标左右拖出一个框，松手即把横轴缩放到这一段；
   *      纵轴按窗内数据自动适配；双击复位；滚轮就地缩放（以鼠标位置为中心）。
   *   ② 刻度加密：主刻度取 8~10 档，每档再画 4 条次刻度，标签位数按步长自适应
   *      （原先固定 toFixed(1)，跨 1e-4~1e7 的量级不是一堆零就是只剩整数）。
   *   ③ 可滑动游标：一根黄色竖线，鼠标移动即跟随，右上角读数框给出该处横坐标
   *      与各条曲线的值；也可在图上按住拖动。
   *   缩放/游标状态存在 SP 上，换显示量重绘时继承。
   */
  var SP = { canvas: null, ctx: null, W: 0, H: 0, traces: null, opt: {}, view: null, cur: null, rubber: null };
  var PAD = { L: 54, R: 12, T: 16, B: 28 };
  var CURSOR_COL = '#f2c200';                 // 游标：黄（浅色主题下比红更不刺眼，深色主题下也醒目）
  var PICK_FILL = 'rgba(242,194,0,.13)';       // 框选区底色
  var PICK_EDGE = 'rgba(242,194,0,.75)';

  /**
   * 绘图配色：从 CSS 变量取，保证与当前主题（浅色 / 深色）一致。
   * 只在 resize 与主题切换时刷新一次，避免每帧 getComputedStyle 的开销。
   */
  var PC = { bg: '#fbfcfe', border: '#d7dfe9', grid: '#eef2f7', axis: '#5a6879', txt: '#33414f', line: '#1f6feb' };
  function refreshPlotColors() {
    if (!FLS.Theme) return;
    PC.bg = FLS.Theme.cssVar('--plotBg', PC.bg);
    PC.border = FLS.Theme.cssVar('--plotBorder', PC.border);
    PC.grid = FLS.Theme.cssVar('--plotGrid', PC.grid);
    PC.axis = FLS.Theme.cssVar('--plotAxis', PC.axis);
    PC.txt = FLS.Theme.cssVar('--plotTxt', PC.txt);
    PC.line = FLS.Theme.cssVar('--acc', PC.line);
  }
  if (FLS.Theme) FLS.Theme.onChange(refreshPlotColors);

  /** 数据下标 → 横坐标值（采样沿横轴均匀） */
  function sampleToX(i, n, fx0, fx1) {
    return fx0 + (fx1 - fx0) * (n === 1 ? 0 : i / (n - 1));
  }
  /** 按步长决定小数位：步长 0.05 → 2 位；步长 20 → 0 位 */
  function fmtTick(v, step) {
    var dp = 0;
    if (step > 0) dp = Math.max(0, Math.min(4, Math.ceil(-Math.log10(step) + 0.2)));
    if (Math.abs(v) >= 1e5 || (v !== 0 && Math.abs(v) < 1e-3)) return v.toExponential(1);
    return v.toFixed(dp);
  }

  /** 把当前视图窗（SP.view）与数据画出来 */
  function redrawPlot() {
    var ctx = SP.ctx;
    if (!ctx) return;
    var W = SP.W, H = SP.H, L = PAD.L, Rm = PAD.R, T = PAD.T, B = PAD.B;
    var pw = W - L - Rm, ph = H - T - B;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = PC.bg; ctx.fillRect(0, 0, W, H);
    if (pw < 24 || ph < 16) return;

    var traces = SP.traces || [];
    var opt = SP.opt || {};
    var fx0 = (opt.x0 !== undefined) ? parseFloat(opt.x0) : 0;
    var fx1 = (opt.x1 !== undefined) ? parseFloat(opt.x1) : 1;
    if (!(fx1 > fx0)) { fx1 = fx0 + 1; }
    var n = traces.length ? traces[0].y.length : 0;
    var vx0 = SP.view ? SP.view.x0 : fx0;
    var vx1 = SP.view ? SP.view.x1 : fx1;
    if (!(vx1 > vx0)) { vx0 = fx0; vx1 = fx1; }
    // 视图窗夹到全程之内
    vx0 = Math.max(fx0, Math.min(vx0, fx1 - (fx1 - fx0) * 1e-3));
    vx1 = Math.min(fx1, Math.max(vx1, vx0 + (fx1 - fx0) * 1e-3));

    ctx.strokeStyle = PC.border; ctx.lineWidth = 1;
    ctx.strokeRect(L, T, pw, ph);

    /* ------- 纵轴范围：只按**窗内**数据定，放大后能看清细节 ------- */
    var vmin = Infinity, vmax = -Infinity, t, k, v;
    var iA = Math.max(0, Math.floor((vx0 - fx0) / (fx1 - fx0) * (n - 1)));
    var iB = Math.min(n - 1, Math.ceil((vx1 - fx0) / (fx1 - fx0) * (n - 1)));
    if (!(iB >= iA)) { iA = 0; iB = n - 1; }
    for (t = 0; t < traces.length; t++) {
      for (k = iA; k <= iB; k++) { v = traces[t].y[k]; if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
    }
    if (!isFinite(vmin) || !isFinite(vmax)) { vmin = -1; vmax = 1; }
    if (vmax - vmin < 1e-9) { vmax += 1; vmin -= 1; }
    var padv = (vmax - vmin) * 0.08; vmin -= padv; vmax += padv;

    function X(i) {
      var xi = sampleToX(i, n, fx0, fx1);
      return L + pw * (xi - vx0) / Math.max(1e-9, vx1 - vx0);
    }
    function Y(vv) { return T + ph * (1 - (vv - vmin) / (vmax - vmin)); }

    /* ------- 网格：主刻度 8~10 档，每档 4 条次刻度 ------- */
    var spanX = vx1 - vx0, maj = niceStep(spanX, (pw > 520 ? 10 : 7));
    var min0 = maj / 4;
    var first = Math.ceil(vx0 / min0) * min0;
    ctx.lineWidth = 1;
    for (var gx = first; gx <= vx1 + 1e-9; gx += min0) {
      var xpx = L + pw * (gx - vx0) / Math.max(1e-9, spanX);
      var isMaj = Math.abs(gx / maj - Math.round(gx / maj)) < 1e-6;
      ctx.strokeStyle = PC.grid;
      ctx.globalAlpha = isMaj ? 1 : 0.45;      // 次刻度更淡，主刻度才压得住
      ctx.beginPath();
      ctx.moveTo(xpx + 0.5, T + (isMaj ? 0 : ph - 6));
      ctx.lineTo(xpx + 0.5, T + ph);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (var gj = 1; gj < 5; gj++) {
      var y = T + ph * gj / 5;
      ctx.strokeStyle = PC.grid;
      ctx.beginPath(); ctx.moveTo(L, y + .5); ctx.lineTo(W - Rm, y + .5); ctx.stroke();
    }
    /* 刻度标签太密会叠字：按可用像素宽度估算能放下几个标签，放不下就隔一个标一个 */
    var nLab = Math.max(2, Math.floor(spanX / maj) + 1);
    var pxPerLab = pw / nLab;
    var skip = pxPerLab < 42 ? 2 : 1;
    var li = 0;
    for (var gx2 = Math.ceil(vx0 / maj) * maj; gx2 <= vx1 + 1e-9; gx2 += maj) {
      if (li % skip === 0) {
        var xp2 = L + pw * (gx2 - vx0) / Math.max(1e-9, spanX);
        ctx.strokeStyle = PC.axis;
        ctx.beginPath(); ctx.moveTo(xp2 + .5, T + ph); ctx.lineTo(xp2 + .5, T + ph + 4); ctx.stroke();
        ctx.fillStyle = PC.axis; ctx.font = '9.5px monospace'; ctx.textAlign = 'center';
        ctx.fillText(fmtTick(gx2, maj), xp2, H - B + 9);
        ctx.textAlign = 'left';
      }
      li++;
    }

    // 轴标注
    ctx.fillStyle = PC.axis; ctx.font = '10px monospace'; ctx.textAlign = 'left';
    ctx.fillText(fmtAxis(vmax), 3, T + 9);
    ctx.fillText(fmtAxis(vmin), 3, H - B);
    if (opt.xlabel) ctx.fillText(opt.xlabel, L + pw / 2 - 40, H - 5);
    if (opt.ylabel) { ctx.save(); ctx.translate(11, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(opt.ylabel, 0, 0); ctx.restore(); }

    // 曲线（按像素列做 min/max 包络，放大后点数少时直接逐点连）
    if (traces.length && n > 0) {
      for (t = 0; t < traces.length; t++) {
        var tr = traces[t];
        ctx.strokeStyle = tr.color || PC.line;
        ctx.lineWidth = tr.lw || 1.1;
        ctx.beginPath();
        if (n <= pw * 1.5) {
          for (k = iA; k <= iB; k++) {
            var xx = X(k), yy = Y(tr.y[k]);
            if (k === iA) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
          }
        } else {
          for (var c = 0; c < pw; c++) {
            var j0 = Math.floor(iA + c * (iB - iA + 1) / pw);
            var j1 = Math.floor(iA + (c + 1) * (iB - iA + 1) / pw);
            if (j1 <= j0) j1 = j0 + 1;
            if (j0 >= n) break;
            var lo = Infinity, hi2 = -Infinity;
            for (k = j0; k < j1 && k < n; k++) { v = tr.y[k]; if (v < lo) lo = v; if (v > hi2) hi2 = v; }
            var xc = L + c + 0.5;
            ctx.moveTo(xc, Y(hi2)); ctx.lineTo(xc, Y(lo) + 0.7);
          }
        }
        ctx.stroke();
      }
    }

    // 图例
    if (traces.length > 1) {
      ctx.font = '10px sans-serif';
      for (t = traces.length - 1; t >= 0; t--) {
        ctx.fillStyle = traces[t].color || PC.line;
        ctx.fillRect(W - Rm - 92, T + 4 + t * 13, 8, 3);
        ctx.fillStyle = PC.txt;
        ctx.fillText(traces[t].name || '', W - Rm - 80, T + 9 + t * 13);
      }
    }

    /* ------- 框选区（正在拖）与游标 ------- */
    if (SP.rubber) {
      var a = Math.min(SP.rubber.a, SP.rubber.b), b2 = Math.max(SP.rubber.a, SP.rubber.b);
      ctx.fillStyle = PICK_FILL;
      ctx.fillRect(a, T, b2 - a, ph);
      ctx.strokeStyle = PICK_EDGE; ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(a + .5, T); ctx.lineTo(a + .5, T + ph);
      ctx.moveTo(b2 + .5, T); ctx.lineTo(b2 + .5, T + ph); ctx.stroke();
      ctx.setLineDash([]);
    }
    // 操作提示：右下角一行淡色小字，不压曲线
    ctx.font = '9.5px sans-serif'; ctx.textAlign = 'right';
    ctx.fillStyle = SP.view ? CURSOR_COL : PC.axis;
    ctx.globalAlpha = 0.85;
    ctx.fillText(SP.view ? '已放大　双击复位' : '横向拖动 = 框选放大　滚轮 = 就地缩放',
      W - Rm - 5, T + ph - 6);
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
    drawCursor(ctx, L, T, pw, ph, traces);
  }

  /** 游标：黄色竖线 + 读数框（横坐标值 + 各曲线在该处的值） */
  function drawCursor(ctx, L, T, pw, ph, traces) {
    if (SP.cur === null || SP.cur === undefined) return;
    var opt = SP.opt || {};
    var fx0 = (opt.x0 !== undefined) ? parseFloat(opt.x0) : 0;
    var fx1 = (opt.x1 !== undefined) ? parseFloat(opt.x1) : 1;
    var vx0 = SP.view ? SP.view.x0 : fx0, vx1 = SP.view ? SP.view.x1 : fx1;
    var u = opt.xunit || '';
    var xr = (SP.cur - vx0) / Math.max(1e-9, vx1 - vx0);
    if (xr < 0 || xr > 1) return;
    var xp = L + pw * xr;
    ctx.save();
    ctx.strokeStyle = CURSOR_COL; ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(xp + .5, T); ctx.lineTo(xp + .5, T + ph); ctx.stroke();
    ctx.setLineDash([]);
    // 顶部手柄（提示这根线可拖）
    ctx.fillStyle = CURSOR_COL;
    ctx.beginPath();
    ctx.moveTo(xp - 4, T - 3); ctx.lineTo(xp + 4, T - 3);
    ctx.lineTo(xp, T + 4); ctx.closePath(); ctx.fill();

    // 读数框：x 值 + 每条曲线的值
    var lines = [{ s: 'x = ' + fmtTick(SP.cur, Math.max(1e-6, (vx1 - vx0) / 1000)) + u, c: CURSOR_COL }];
    for (var t = 0; t < traces.length; t++) {
      var tr = traces[t], n2 = tr.y.length;
      if (!n2) continue;
      var idx = U.clamp(Math.round((SP.cur - fx0) / Math.max(1e-9, fx1 - fx0) * (n2 - 1)), 0, n2 - 1);
      lines.push({ s: (tr.name || '曲线') + ' = ' + fmtAxis(tr.y[idx]), c: tr.color || PC.line });
    }
    ctx.font = '10px monospace';
    var bw = 0, lh = 13;
    lines.forEach(function (o) { bw = Math.max(bw, ctx.measureText(o.s).width); });
    bw += 12;
    var bh2 = lines.length * lh + 8;
    /* ⚠ 这里的 SP.W 不能写成 W —— W 是 redrawPlot() 的局部变量，
       在 drawCursor() 里不可见（2026-10-31 实测抛 "W is not defined"）。 */
    var bx2 = (xp + bw + 12 > SP.W - PAD.R) ? (xp - bw - 8) : (xp + 8);
    if (bx2 < L + 2) bx2 = L + 2;
    var by2 = T + 4;
    ctx.fillStyle = (PC.bg && PC.bg.charAt(0) === '#') ? 'rgba(255,255,255,.92)' : 'rgba(20,26,34,.92)';
    ctx.strokeStyle = PC.border; ctx.lineWidth = 1;
    ctx.fillRect(bx2, by2, bw, bh2);
    ctx.strokeRect(bx2 + .5, by2 + .5, bw - 1, bh2 - 1);
    lines.forEach(function (o, i) {
      ctx.fillStyle = o.c;
      ctx.fillText(o.s, bx2 + 6, by2 + 4 + (i + 0.5) * lh);
    });
    ctx.restore();
  }

  /** 像素 → 数据横坐标 */
  function pxToData(xpx) {
    var opt = SP.opt || {}, n = (SP.traces && SP.traces.length) ? SP.traces[0].y.length : 1;
    var fx0 = (opt.x0 !== undefined) ? parseFloat(opt.x0) : 0;
    var fx1 = (opt.x1 !== undefined) ? parseFloat(opt.x1) : 1;
    var v = SP.view || { x0: fx0, x1: fx1 };
    var pw = SP.W - PAD.L - PAD.R;
    return v.x0 + (v.x1 - v.x0) * (xpx - PAD.L) / Math.max(1, pw);
  }
  /** 数据横坐标 → 像素 */
  function dataToPx(xd) {
    var opt = SP.opt || {};
    var fx0 = (opt.x0 !== undefined) ? parseFloat(opt.x0) : 0;
    var fx1 = (opt.x1 !== undefined) ? parseFloat(opt.x1) : 1;
    var v = SP.view || { x0: fx0, x1: fx1 };
    var pw = SP.W - PAD.L - PAD.R;
    return PAD.L + pw * (xd - v.x0) / Math.max(1e-9, v.x1 - v.x0);
  }

  /** 鼠标交互绑定：
   *   拖动        → 拉框，松手放大到框内；拖得极短（<6 px）就只当移动游标
   *   移动        → 黄色游标跟随，右上角出读数
   *   滚轮        → 以指针位置为中心就地缩放
   *   双击        → 复位到全量程
   */
  function bindPlotMouse() {
    var cv = SP.canvas;
    if (!cv || cv.__flsSigBound) return;
    cv.__flsSigBound = 1;
    cv.style.cursor = 'crosshair';
    var down = null;

    function local(e) {
      var r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
    }
    function inside(q) {
      return q.x >= PAD.L && q.x <= q.w - PAD.R && q.y >= PAD.T && q.y <= q.h - PAD.B;
    }
    function fullRange() {
      var opt = SP.opt || {};
      var a = (opt.x0 !== undefined) ? parseFloat(opt.x0) : 0;
      var b2 = (opt.x1 !== undefined) ? parseFloat(opt.x1) : 1;
      if (!(b2 > a)) { b2 = a + 1; }
      return { x0: a, x1: b2 };
    }
    function clampView(v) {
      var f = fullRange(), sp = (f.x1 - f.x0) * 2e-4;
      var a = Math.max(f.x0, Math.min(v.x0, f.x1 - sp));
      var b2 = Math.min(f.x1, Math.max(v.x1, a + sp));
      return { x0: a, x1: b2 };
    }

    cv.addEventListener('mousemove', function (e) {
      var q = local(e);
      if (!inside(q)) { if (!down) SP.cur = null; else SP.rubber = null; redrawPlot(); return; }
      SP.cur = pxToData(q.x);
      if (down) SP.rubber = { a: down.x, b: q.x };
      redrawPlot();
    });
    cv.addEventListener('mouseleave', function () {
      if (!down) { SP.cur = null; redrawPlot(); }
    });
    cv.addEventListener('mousedown', function (e) {
      var q = local(e); if (!inside(q)) return;
      down = q; SP.rubber = { a: q.x, b: q.x };
      SP.cur = pxToData(q.x);
      redrawPlot(); e.preventDefault();
    });
    window.addEventListener('mouseup', function (e) {
      if (!down) return;
      var q = local(e);
      var a = Math.min(down.x, q.x), b2 = Math.max(down.x, q.x);
      if (b2 - a >= 6) {
        var xa = pxToData(a), xb = pxToData(b2);
        if (xb > xa) SP.view = clampView({ x0: xa, x1: xb });
      }
      SP.rubber = null; down = null;
      redrawPlot();
    });
    cv.addEventListener('dblclick', function () { FLS.SigPlot.resetZoom(); });
    var rb = document.getElementById('sigZoomReset');
    if (rb) rb.onclick = function () { FLS.SigPlot.resetZoom(); };
    cv.addEventListener('wheel', function (e) {
      var q = local(e); if (!inside(q)) return;
      e.preventDefault();
      var f = fullRange();
      var v = SP.view || f;
      var pw = Math.max(1, SP.W - PAD.L - PAD.R);
      var xc = v.x0 + (v.x1 - v.x0) * (q.x - PAD.L) / pw;
      var k = (e.deltaY > 0) ? 1.25 : 0.8;
      var n0 = xc - (xc - v.x0) * k, n1 = xc + (v.x1 - xc) * k;
      if (n1 - n0 <= (f.x1 - f.x0) * 2.5e-4) return;      // 到底了，别再放大
      if (n1 - n0 >= (f.x1 - f.x0)) { SP.view = null; redrawPlot(); return; }
      SP.view = clampView({ x0: n0, x1: n1 });
      SP.cur = xc;
      redrawPlot();
    }, { passive: false });
  }

  FLS.SigPlot = {
    init: function () {
      SP.canvas = document.getElementById('sigCanvas');
      SP.ctx = SP.canvas ? SP.canvas.getContext('2d') : null;
      refreshPlotColors();
      bindPlotMouse();
    },
    resize: function () {
      if (!SP.canvas || !SP.ctx) return;          // V2.0：init 之前被调用时的兜底
      var host = SP.canvas.parentElement;
      var w = Math.max(80, host.clientWidth), h = Math.max(60, host.clientHeight);
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      SP.canvas.width = Math.round(w * dpr); SP.canvas.height = Math.round(h * dpr);
      SP.canvas.style.width = w + 'px'; SP.canvas.style.height = h + 'px';
      SP.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      SP.W = w; SP.H = h;
      refreshPlotColors();
      redrawPlot();
    },
    clear: function () {
      SP.traces = null; SP.view = null; SP.cur = null; SP.rubber = null;
      if (!SP.ctx) return;
      SP.ctx.clearRect(0, 0, SP.W, SP.H);
    },
    /** 通用曲线绘制 */
    plot: function (traces, opt) {
      /* ★ V3.7：存下数据与坐标范围，供框选放大 / 游标读数复用。
       * 注意只有在"显示量切换"这类需要重置视图时才清 view —— 普通刷新
       * （比如改了通道、改了参数）保留用户已经框选的区间，体验更顺。 */
      SP.traces = traces || [];
      SP.opt = opt || {};
      if (!SP.view) SP.view = { x0: SP.opt.x0, x1: SP.opt.x1 };
      redrawPlot();
    },
    /** 外部把游标放到某个横坐标值上（成像页的光标联动可用） */
    setCursor: function (x) { SP.cur = (x === null || x === undefined) ? null : +x; redrawPlot(); },
    /** 复位横轴到全量程 */
    resetZoom: function () {
      SP.view = (SP.opt && SP.opt.x0 !== undefined) ? { x0: SP.opt.x0, x1: SP.opt.x1 } : null;
      redrawPlot();
    },
    /** 供回归取证读内部状态。
     *  full = 数据全量程。注意：复位后 view 是「等于全量程的区间对象」而不是 null
     *  （redrawPlot 里一律按 view 区间取窗，null 会让整幅空白），
     *  所以判断"是否已复位"要跟 full 比，不能判 view===null。 */
    state: function () {
      return {
        view: SP.view, cur: SP.cur, W: SP.W, H: SP.H,
        full: (SP.opt && SP.opt.x0 !== undefined) ? { x0: SP.opt.x0, x1: SP.opt.x1 } : null,
        nTrace: (SP.traces || []).length,
        n: (SP.traces && SP.traces.length) ? SP.traces[0].y.length : 0,
        xunit: (SP.opt || {}).xunit || '', xlabel: (SP.opt || {}).xlabel || ''
      };
    },
    redraw: redrawPlot
  };

  /** 横轴坐标格式化：量级跨度大（µPa 可到 1e7、噪声可到 1e-4），
   *  固定小数位不是一堆零就是精度全丢，这里按量级切换。 */
  function fmtAxis(v) {
    var a = Math.abs(v);
    if (v === 0) return '0';
    if (a >= 1e4 || a < 1e-2) return v.toExponential(1);
    if (a >= 100) return v.toFixed(0);
    if (a >= 1) return v.toFixed(2);
    return v.toFixed(3);
  }
  function fmtN(v) {
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
    if (Math.abs(v) < 1) return v.toFixed(2);
    return v.toFixed(1);
  }
})();
