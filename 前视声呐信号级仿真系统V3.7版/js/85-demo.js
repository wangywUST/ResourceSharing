/* =========================================================================
 * 85-demo.js —— 原理演示模块
 * -------------------------------------------------------------------------
 *  ★ V3.7 全面改版
 *
 *  旧版的问题（用户反馈）：
 *    · 一幕占满整个中间板块，幕与幕之间只能来回切，看不出彼此的联系；
 *    · 面向的就应是"前视声呐最本质的原理与算法"，旧版偏散、偏科普；
 *    · 全程只能播放/暂停，没有可动手调的地方。
 *
 *  新版：**宫格式演示台**
 *    · 一版同时摆 4 幅（可切 2×2 / 2×3 / 全览 12 幅），一屏看到一条完整线索；
 *    · 12 幕分三版，串成三条递进的线：
 *        第 1 版「声波怎么走」：几何 → 发射/脉压 → 距离分辨 → 方位分辨
 *        第 2 版「阵列怎么看」：波束形成 → 相控扫描 → 扇形栅格 → 距离混叠
 *        第 3 版「图像为何这样」：散斑 → 声影 → TVG → 声呐方程
 *    · 每幅自带画布、自己的动画相位、自己的**参数滑块 / 画布拖动**；
 *      一动滑块这幅立刻切成"手动"，左上角 MODE 显示 MANU，点 ⟨⟳⟩ 恢复自动；
 *    · 点卡片标题选中它，右侧讲解栏给出完整文字 + 公式；
 *      标题最右的 ⟨⤢⟩ 把这一幅临时放大到整版。
 *
 *  实现约定：
 *   1) 只用示意图 + 真值标注。凡是标了数值的地方都用当前 FLS.P 算出来，
 *      拖动只改**本幕的演示变量**，不改仿真参数（避免演示与仿真互相打架）。
 *   2) 各幕绘制函数沿用模块级的 ctx / W / H / t 四个"当前上下文"变量：
 *      画哪幅就把它们切到哪幅。这样九幕旧代码一行坐标都不用改就自动适配任意卡片尺寸。
 *   3) 定时器用 setTimeout 递归自调度，~16 fps —— 演示不需要 60 fps，
 *      也不去和 WebGL 主视口抢帧。 ⚠ 驱动函数叫 tickDemo，**绝不能叫 frame**：
 *      下面第 89 行有个绘图辅助函数 frame(x,y,w,h,title)，同名会被覆盖成死递归。
 *   4) 配色全部走 CSS 变量，深浅主题自动跟随。
 * ========================================================================= */
(function () {
  var D = {};
  FLS.Demo = D;

  /* ---- 绘图上下文：画哪幅就切到哪幅 ---- */
  var ctx = null, W = 600, H = 400, dpr = 1, t = 0;
  var CUR = null;                 // 当前正在绘制的卡片对象
  var COL = {};

  /* ---- 播放状态 ---- */
  var playing = false, speed = 1, lastTs = 0, timer = 0;
  var cards = [], GROUPS = [], gIdx = 0, perPage = 4, focus = -1, sideOn = true;

  /* ---------------------------------------------------------- 配色（随主题刷新） */
  function refreshColors() {
    function g(k, fb) { return FLS.Theme ? FLS.Theme.cssVar(k, fb) : fb; }
    COL = {
      bg: g('--plotBg', '#fbfcfe'),
      border: g('--plotBorder', '#d7dfe9'),
      grid: g('--plotGrid', '#eef2f7'),
      axis: g('--plotAxis', '#5a6879'),
      txt: g('--plotTxt', '#33414f'),
      txt2: g('--txt2', '#5a6879'),
      acc: g('--acc', '#1f6feb'),
      warn: g('--warn', '#c2410c'),
      ok: g('--ok', '#0f7b3f'),
      sea: g('--accSoft', '#eaf2ff'),
      warm: '#ffb020',
      dim: g('--txt3', '#8794a4')
    };
  }

  /* ---------------------------------------------------------- 通用绘图小工具 */
  function line(x1, y1, x2, y2, color, w, dash) {
    ctx.save();
    if (dash) ctx.setLineDash(dash);
    ctx.strokeStyle = color; ctx.lineWidth = w || 1;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }
  function rect(x, y, w, h, fill, stroke) {
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1); }
  }
  function dot(x, y, r, fill) {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }
  function label(x, y, s, color, size, align) {
    ctx.fillStyle = color || COL.txt;
    ctx.font = (size || 11) + 'px "Microsoft YaHei","PingFang SC",sans-serif';
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  }
  function mono(x, y, s, color, size, align) {
    ctx.fillStyle = color || COL.txt2;
    ctx.font = (size || 10) + 'px Consolas,Menlo,monospace';
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  }
  /** 带箭头的线段 */
  function arrow(x1, y1, x2, y2, color, w) {
    line(x1, y1, x2, y2, color, w || 1.4);
    var a = Math.atan2(y2 - y1, x2 - x1), L = 7;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - L * Math.cos(a - 0.38), y2 - L * Math.sin(a - 0.38));
    ctx.lineTo(x2 - L * Math.cos(a + 0.38), y2 - L * Math.sin(a + 0.38));
    ctx.closePath(); ctx.fill();
  }
  /** 画一个带边框的图框与标题 */
  function frame(x, y, w, h, title) {
    if (w < 30 || h < 24) return;
    rect(x, y, w, h, COL.bg, COL.border);
    if (title) label(x + 8, y + 12, title, COL.txt, 11.5);
  }
  function bg() { ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H); }
  /** 底部一行说明（自动躲开画布边界） */
  function foot(s) { mono(14, Math.max(12, H - 10), s, COL.txt2, 10.5); }
  /** 余弦半功率高斯窗，用于画平滑的主瓣（q = θ/θ₃dB） */
  function gauss(q) { return Math.exp(-Math.LN2 * q * q); }
  /** 均匀线阵阵列因子的 dB 值（偶极 picture 用），-40 dB 封底 */
  function afDb(thRad, steerRad, M, dLam) {
    var psi = 2 * Math.PI * dLam * (Math.sin(thRad) - Math.sin(steerRad));
    var v;
    if (Math.abs(psi) < 1e-9) v = 1;
    else {
      var sn = Math.sin(psi / 2);
      v = Math.abs(Math.sin(M * psi / 2) / (M * sn));
    }
    return Math.max(-40, 20 * Math.log10(Math.max(1e-4, v)));
  }

  /* ----------------------------------------------------------
   * 交互参数：自动 ⇄ 手动
   *   CUR.auto 为真时，参数由动画相位 t 现算（并回填进 CUR.p，
   *   这样用户一动滑块就正好从当前值接上，不会跳变）；
   *   手动时直接用 CUR.p 里的值。 */
  function pv(key, fnAnim) {
    if (!CUR) return fnAnim();
    if (CUR.auto) { CUR.p[key] = fnAnim(); return CUR.p[key]; }
    if (CUR.p[key] === undefined) CUR.p[key] = fnAnim();
    return CUR.p[key];
  }
  /** 0→1→0 的往复（余弦） */
  function osc() { return 0.5 - 0.5 * Math.cos(t * 6.2832); }
  /** 0→1 的单向推进 */
  function ramp() { return Math.min(1, Math.max(0.02, t)); }

  /* ================================================================
   * 幕 ①：前视声呐几何 —— 斜距 / 地距 / 掠射角 / 盲区 / 俯仰
   * ================================================================ */
  function drawGeom() {
    var hTrue = Math.abs(FLS.P['rov.z']) - FLS.Terrain.depth(FLS.state.rov.x, FLS.state.rov.y);
    if (!isFinite(hTrue) || hTrue < 1) hTrue = 6;
    var rmax = FLS.P['alg.rmax'];
    var vb = FLS.P['tx.vbeam'] * Math.PI / 180;
    /* 俯仰：正 = 抬头。
       向下为正的俯角范围是 α ∈ [-(pitch+vb/2), -(pitch-vb/2)] */
    var pitchDeg = pv('pitch', function () { return 20 * Math.sin(t * 6.2832); });
    var pitch = pitchDeg * Math.PI / 180;
    var h = pv('h', function () { return hTrue; });

    var aLo = -(pitch + vb / 2);         // 上边缘（俯角最小，负 = 朝上）
    var aHi = -(pitch - vb / 2);         // 下边缘（俯角最大）
    var litOK = aHi > 0.004;             // 下边缘还没抬起到水平线以上
    var gLim = Math.sqrt(Math.max(1, rmax * rmax - h * h));   // 量程对应的地距上限

    /* —— 左：纵剖面 —— */
    var x0 = 14, y0 = 46, w1 = W * 0.60 - 20, h1 = H - y0 - 30;
    frame(x0, y0, w1, h1, '纵剖面：垂直扇面如何照亮海底');
    var px = x0 + 46, py = y0 + 34;
    var floorY = y0 + h1 - 20;
    var scale = (w1 - 66) / rmax;        // 水平：m → px
    rect(x0 + 1, floorY, w1 - 2, y0 + h1 - floorY - 1, '#8a7f66');
    line(x0 + 1, floorY, x0 + w1 - 1, floorY, COL.axis, 1);

    // 垂直扇面（带俯仰的两条边）
    ctx.save();
    ctx.beginPath(); ctx.moveTo(px, py);
    ctx.lineTo(px + w1 * Math.cos(aLo), py + w1 * Math.sin(aLo));
    ctx.lineTo(px + w1 * Math.cos(aHi), py + w1 * Math.sin(aHi));
    ctx.closePath();
    ctx.fillStyle = 'rgba(31,111,235,.16)'; ctx.fill();
    ctx.restore();
    line(px, py, px + w1 * Math.cos(aLo), py + w1 * Math.sin(aLo), COL.acc, 1);
    line(px, py, px + w1 * Math.cos(aHi), py + w1 * Math.sin(aHi), COL.acc, 1);

    rect(px - 8, py - 5, 16, 10, COL.acc, COL.txt);
    label(px, py - 14, 'ROV', COL.acc, 10, 'center');
    line(px, py + 5, px, floorY, COL.warn, 1, [3, 3]);
    label(px + 4, (py + floorY) / 2, 'h=' + h.toFixed(1) + 'm', COL.warn, 10);

    if (litOK) {
      var gNear = h / Math.tan(aHi);                       // 最近被照到的地距
      var aStart = Math.max(aLo, 0.012);                   // 有效的最掠射线
      var gFar = h / Math.tan(aStart);
      gNear = Math.min(gNear, gLim); gFar = Math.min(gFar, gLim);
      if (gFar > gNear) {
        rect(px + gNear * scale, floorY - 4, (gFar - gNear) * scale, 4, COL.warn);
        label(px + (gNear + gFar) / 2 * scale, floorY - 13, '照亮带', COL.warn, 10, 'center');
      }
      if (gNear > 0.5) {
        rect(px, floorY - 3, Math.min(gNear, gLim) * scale, 3, 'rgba(0,0,0,.35)');
        label(px + Math.min(gNear, gLim) * scale / 2, floorY - 12, '盲区', COL.txt2, 10, 'center');
      }
      mono(px + 6, py + 22, 'r_near = ' + Math.min(gNear, gLim).toFixed(1) +
        ' m　r_far = ' + gFar.toFixed(1) + ' m', COL.warn, 10);
      // 扫描射线
      var frac = osc();
      var al = aStart + (aHi - aStart) * frac;
      var Rhit = h / Math.sin(al);
      if (Rhit <= rmax) {
        var hx = px + Rhit * scale * Math.cos(al), hy = py + Rhit * scale * Math.sin(al);
        if (hy > floorY) { hy = floorY; hx = px + (h / Math.tan(al)) * scale; }
        arrow(px, py, hx, hy, COL.acc, 1.5);
        dot(hx, hy, 3.5, COL.warm);
        mono(hx + 5, hy - 9, 'R=' + Rhit.toFixed(1) + 'm', COL.txt, 9.5);
        mono(hx + 5, hy + 3, 'θg=' + (al * 180 / Math.PI).toFixed(1) + '°', COL.txt2, 9.5);
      }
    } else {
      label(px + w1 * 0.42, py + 26, '⚠ 扇面已抬离海底（照不到海床）', COL.warn, 11);
      mono(px + 6, py + 42, '把俯仰调回负值（低头）即可重新照亮', COL.txt2, 10);
    }
    if (W > 430) {
      mono(x0 + 8, y0 + 30, '垂直开角 ' + FLS.P['tx.vbeam'].toFixed(1) + '°　俯仰 ' +
        pitchDeg.toFixed(0) + '°', COL.txt, 10.5);
      mono(x0 + 8, y0 + 46, '斜距 R ／ 地距 g=√(R²−h²) ／ 掠射角 θg=arcsin(h/R)', COL.txt2, 9.5);
    }

    /* —— 右：俯视扇面 —— */
    var x2 = W * 0.60 + 6, w2 = W - x2 - 14;
    if (w2 > 70) {
      frame(x2, y0, w2, h1, '俯视 ' + FLS.P['alg.sector'] + '°');
      var cx = x2 + w2 / 2, cy = y0 + h1 - 22, rr = Math.min(w2 / 2 - 12, h1 - 52);
      var sec = FLS.P['alg.sector'] * Math.PI / 180;
      ctx.save();
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, rr, -Math.PI / 2 - sec / 2, -Math.PI / 2 + sec / 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(31,111,235,.14)'; ctx.fill();
      ctx.strokeStyle = COL.acc; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
      var thb = -sec / 2 + sec * osc();
      arrow(cx, cy, cx + rr * Math.sin(thb), cy - rr * Math.cos(thb), COL.warm, 1.5);
      dot(cx, cy, 3.5, COL.acc);
      ctx.strokeStyle = COL.grid; ctx.setLineDash([3, 3]);
      for (var k = 1; k <= 3; k++) {
        ctx.beginPath(); ctx.arc(cx, cy, rr * k / 3, -Math.PI / 2 - sec / 2, -Math.PI / 2 + sec / 2); ctx.stroke();
        mono(cx + 3, cy - rr * k / 3, (rmax * k / 3).toFixed(0) + 'm', COL.dim, 9);
      }
      ctx.setLineDash([]);
      mono(cx, cy - rr - 8, 'θ=' + (thb * 180 / Math.PI).toFixed(0) + '°', COL.txt, 9.5, 'center');
    }
    if (H > 250) foot('抬头后整个照亮带向外推、最终离开海床 —— 这正是 V3.7 重做面元布设与垂直指向性要修的那件事。');
  }

  /* ================================================================
   * 幕 ②：发射信号 —— LFM 时宽 τ / 带宽 B / 脉压增益
   * ================================================================ */
  function drawTx() {
    var tau = FLS.P['tx.pulse'] * 1e-3;
    var B = FLS.P['tx.bw'] * 1000;
    var fc = FLS.P['tx.fc'] * 1000;
    var TBL = tau * B;
    var lim = ramp();

    var x0 = 14, y0 = 40, w = W - 28, h1 = (H - y0 - 44) * 0.52;
    frame(x0, y0, w, h1, '发射波形：线性调频 LFM（复基带实部）');
    var n = 600, mid = y0 + 18 + h1 / 2, amp = h1 / 2 - 18;
    line(x0 + 34, mid, x0 + w - 12, mid, COL.grid, 1);
    // 包络
    ctx.strokeStyle = COL.dim; ctx.setLineDash([4, 3]);
    for (var sgn = -1; sgn <= 1; sgn += 2) {
      ctx.beginPath();
      for (var i = 0; i <= n; i++) {
        var u = i / n, env = 0.5 - 0.5 * Math.cos(6.2832 * u);
        var xx = x0 + 34 + (w - 46) * u, yy = mid - sgn * amp * env;
        if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // 波形
    ctx.strokeStyle = COL.acc; ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (var i3 = 0; i3 <= n; i3++) {
      var u3 = i3 / n;
      if (u3 > lim) break;
      var env3 = 0.5 - 0.5 * Math.cos(6.2832 * u3);
      var ph = 6.2832 * (0.5 * TBL * u3 * u3 - 0.5 * TBL * u3) * 6;
      var xx3 = x0 + 34 + (w - 46) * u3, yy3 = mid - amp * env3 * Math.cos(ph);
      if (i3 === 0) ctx.moveTo(xx3, yy3); else ctx.lineTo(xx3, yy3);
    }
    ctx.stroke();
    var cx0 = x0 + 34 + (w - 46) * lim;
    line(cx0, y0 + 16, cx0, y0 + h1 - 5, COL.warm, 1, [3, 3]);
    mono(x0 + 6, mid, 'τ=' + (tau * 1e3).toFixed(1) + 'ms', COL.txt, 10);
    mono(x0 + w - 8, y0 + 26, (fc / 1000).toFixed(0) + '±' + (B / 2000).toFixed(0) + ' kHz',
      COL.txt2, 10, 'right');

    var y2 = y0 + h1 + 10, h2 = H - y2 - 30;
    frame(x0, y2, w, h2, '幅度谱与脉压');
    var bx = x0 + 34, bw = w - 46, by = y2 + h2 - 18, bh = h2 - 40;
    line(bx, by, bx + bw, by, COL.grid, 1);
    var f0 = bx + bw * 0.20, f1 = bx + bw * 0.80;
    ctx.fillStyle = 'rgba(31,111,235,.22)';
    ctx.fillRect(f0, by - bh * lim, f1 - f0, bh * lim);
    ctx.strokeStyle = COL.acc; ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(bx, by); ctx.lineTo(f0, by); ctx.lineTo(f0, by - bh * lim);
    ctx.lineTo(f1, by - bh * lim); ctx.lineTo(f1, by); ctx.lineTo(bx + bw, by);
    ctx.stroke();
    mono(bx + 2, by + 10, 'B=' + (B / 1000).toFixed(0) + 'kHz', COL.txt, 10);
    mono(bx + bw, by - bh - 6, 'τB=' + TBL.toFixed(0), COL.warn, 10, 'right');
    mono(bx + bw, by + 10, '脉压增益 10lg(τB)=' + (10 * Math.log10(Math.max(1, TBL))).toFixed(1) + 'dB',
      COL.ok, 10, 'right');
    if (H > 250) foot('分辨率只由带宽决定：ΔR = c/2B = ' + (1500 / (2 * B) * 100).toFixed(1) + ' cm，与 τ 无关。');
  }

  /* ================================================================
   * 幕 ③：距离分辨率 —— ΔR = c/2B，瑞利判据
   * ================================================================ */
  function drawResR() {
    var c = FLS.Env.profileAt(FLS.state.rov.z) || 1500;
    var B = FLS.P['tx.bw'] * 1000;
    var dR = c / (2 * B);
    var kf = pv('sep', function () { return 0.25 + 2.75 * osc(); });   // 单位：ΔR
    var sep = kf * dR;

    var x0 = 14, y0 = 40, w = W - 28, h = H - y0 - 40;
    frame(x0, y0, w, h, '两个等强点目标：回波包络随间距变化');
    var bx = x0 + 40, bw = w - 56, by = y0 + h - 22, bh = h - 50;
    line(bx, by, bx + bw, by, COL.axis, 1);
    line(bx, by, bx, by - bh, COL.axis, 1);
    function envAt(m) { var s = dR / 1.6; return Math.exp(-(m * m) / (2 * s * s)); }
    var span = 6 * dR;
    function sx(m) { return bx + bw * (m / span); }
    var m1 = span * 0.24, m2 = m1 + sep;
    ctx.fillStyle = 'rgba(31,111,235,.16)';
    ctx.beginPath(); ctx.moveTo(sx(m1 - 3 * dR), by);
    for (var i = 0; i <= 200; i++) {
      var mm = -3 * dR + 6 * dR * i / 200;
      ctx.lineTo(sx(m1 + mm), by - bh * envAt(mm));
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = COL.acc; ctx.lineWidth = 1.7;
    ctx.beginPath();
    for (var i2 = 0; i2 <= 400; i2++) {
      var m = m1 - 1.2 * dR + (sep + 2.4 * dR) * i2 / 400;
      var v = Math.min(1, envAt(m - m1) + envAt(m - m2));
      var xx = sx(m), yy = by - bh * v;
      if (i2 === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    line(sx(m1), by, sx(m1), by - bh - 3, COL.dim, 1, [3, 3]);
    line(sx(m2), by, sx(m2), by - bh - 3, COL.dim, 1, [3, 3]);
    dot(sx(m1), by + 7, 3, COL.warn); dot(sx(m2), by + 7, 3, COL.warn);
    var yy2 = by + 18;
    arrow(sx(m1), yy2, sx(m2), yy2, COL.warn, 1.1);
    arrow(sx(m2), yy2, sx(m1), yy2, COL.warn, 1.1);
    mono((sx(m1) + sx(m2)) / 2, yy2 + 11, 'Δr = ' + kf.toFixed(2) + ' ΔR', COL.warn, 10, 'center');

    var dipv = 2 * envAt(sep / 2) / Math.max(1e-6, Math.max(envAt(0) + envAt(sep), envAt(sep) + envAt(0)));
    var res = kf >= 1 ? '可分辨（≥ ΔR）' : '不可分辨（合成单峰）';
    mono(bx + 4, y0 + 22, '中点/峰值 = ' + dipv.toFixed(3) + ' → ' + res,
      dipv <= 0.75 ? COL.ok : COL.warn, 10.5);
    mono(bx + 4, y0 + 38, 'ΔR = c/2B = ' + (dR * 100).toFixed(2) + ' cm', COL.txt, 10.5);
    if (H > 250) foot('注意区分：真实分辨率是 c/2B；显示栅格 nBin 只决定画图颗粒。');
  }

  /* ================================================================
   * 幕 ④：方位分辨率 —— 孔径 / 栅瓣
   * ================================================================ */
  function drawResA() {
    var c = FLS.Env.profileAt(FLS.state.rov.z) || 1500;
    var lam = c / (FLS.P['tx.fc'] * 1000);
    var Mtrue = FLS.P['rx.nElem'];
    var M = Math.round(pv('M', function () { return 8 + (Mtrue - 8) * osc(); }));
    if (M < 2) M = 2;
    var dRel = pv('dRel', function () { return 0.5; });        // d / λ
    var d = dRel * lam;

    var x0 = 14, y0 = 40, w = W - 28, h = H - y0 - 40;
    var hPat = h * 0.66;
    frame(x0, y0, w, hPat, '水平方向图 20lg|AF(θ)|　M = ' + M + '，d = ' + dRel.toFixed(2) + 'λ');
    var bx = x0 + 38, bw = w - 56, by = y0 + hPat - 20, bh = hPat - 44;
    var thMax = 70 * Math.PI / 180;
    line(bx, by - bh, bx, by, COL.axis, 1);
    line(bx, by, bx + bw, by, COL.axis, 1);
    for (var db = -10; db >= -40; db -= 10) {
      var gy = by - bh * (1 + db / 40);
      line(bx, gy, bx + bw, gy, COL.grid, 1, [3, 3]);
      mono(bx - 4, gy, db + '', COL.dim, 9, 'right');
    }
    ctx.strokeStyle = COL.acc; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (var i = 0; i <= 500; i++) {
      var th = -thMax + 2 * thMax * i / 500;
      var dbv = afDb(th, 0, M, dRel);
      var xx = bx + bw * (i / 500), yy = by - bh * (1 + dbv / 40);
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    var th3 = 0.886 / (M * dRel);
    if (th3 < thMax) {
      var x3 = bx + bw * (0.5 + th3 / (2 * thMax));
      line(x3, by - bh, x3, by, COL.warn, 1, [4, 3]);
      mono(x3 + 3, by - bh + 9, 'θ₃=' + (th3 * 180 / Math.PI).toFixed(2) + '°', COL.warn, 9.5);
    }
    mono(bx + 4, y0 + 20, 'θ₃ ≈ 0.886λ/(Md)', COL.txt, 10);
    mono(bx + bw, y0 + 20, '孔径 D=' + ((M - 1) * d * 1000).toFixed(0) + 'mm', COL.txt2, 10, 'right');
    mono(bx + bw, y0 + 36, dRel > 0.5 ? '⚠ d > λ/2 → 栅瓣' : 'd ≤ λ/2 → 无栅瓣',
      dRel > 0.5 ? COL.warn : COL.ok, 10, 'right');

    // 阵列示意
    var y2 = y0 + hPat + 8, h2 = H - 26 - y2;
    if (h2 > 34) {
      frame(x0, y2, w, h2, '阵列口径示意');
      var cy = y2 + h2 / 2 + 4, av = w - 44;
      var step = av / Math.max(1, Mtrue - 1);
      for (var m = 0; m < Mtrue; m++) {
        var ex = x0 + 22 + m * step, on = m < M;
        ctx.fillStyle = on ? COL.acc : 'rgba(128,140,155,.26)';
        ctx.fillRect(ex - Math.min(2.5, step * .3), cy - 6, Math.max(2, Math.min(5, step * .6)), 12);
      }
      mono(x0 + 22 + (M - 1) * step / 2, cy + 18, '有效 ' + M + ' 元', COL.warn, 10, 'center');
    }
    if (H > 250) foot('孔径决定波束：M 翻倍 → θ₃ 减半。但 d > λ/2 会以栅瓣的形式付回去。');
  }

  /* ================================================================
   * 幕 ⑤：波束形成 —— 先对齐相位，再相加
   * ================================================================ */
  function drawBF() {
    var c = FLS.Env.profileAt(FLS.state.rov.z) || 1500;
    var lam = c / (FLS.P['tx.fc'] * 1000);
    var dRel = FLS.P['rx.spacing'] / 1000 / lam;
    var M = 8;
    var th = pv('theta', function () { return -50 + 100 * osc(); }) * Math.PI / 180;

    var x0 = 14, y0 = 40, w1 = W * 0.46 - 18, h = H - y0 - 36;
    var hasRight = W > 420;
    frame(x0, y0, w1, h, 'θ = ' + (th * 180 / Math.PI).toFixed(0) + '° 入射　M = ' + M);
    var cy = y0 + h / 2 + 8, ax = x0 + w1 / 2;
    var gap = Math.min(16, (h - 54) / M);
    for (var m = 0; m < M; m++) {
      var ey = cy - (M - 1) / 2 * gap + m * gap;
      dot(ax, ey, 3.4, COL.acc);
    }
    var L = Math.min(w1, h) * 0.44;
    var dirx = Math.sin(th), diry = -Math.cos(th);
    var perx = Math.cos(th), pery = Math.sin(th);
    var ph = (t * 2) % 1;
    for (var k = 0; k < 4; k++) {
      var off = (ph + k / 4) % 1;
      var ccx = ax - dirx * L * (off - 0.5), ccy = cy - diry * L * (off - 0.5);
      line(ccx - perx * L * 0.5, ccy - pery * L * 0.5, ccx + perx * L * 0.5, ccy + pery * L * 0.5,
        'rgba(31,111,235,' + (0.7 - 0.15 * k) + ')', 1.5);
    }
    var dx = dRel * lam * Math.sin(th);
    mono(x0 + 6, y0 + 22, '程差 Δ = d·sinθ = ' + (dx * 1000).toFixed(2) + ' mm', COL.txt, 10);
    mono(x0 + 6, y0 + 38, '时延 τ = Δ/c = ' + (dx / c * 1e6).toFixed(3) + ' μs', COL.txt, 10);
    mono(x0 + 6, y0 + 54, '相位差 φ = 2πΔ/λ = ' + (360 * dx / lam).toFixed(0) + '°', COL.warn, 10);

    if (!hasRight) { if (H > 250) foot('相位对齐时 M 路同相叠加 → 幅度 ×M；失配则互相抵消。'); return; }
    var x2 = W * 0.46 + 2, w2 = W - x2 - 14;
    frame(x2, y0, w2, h, '相量求和：对齐前 vs 对齐后');
    var rr = Math.min(w2 * 0.34, h * 0.24);
    var cx1 = x2 + 12 + rr + 4, cy1 = y0 + 60 + rr;
    var cx2 = x2 + 12 + 3 * rr + 14, cy2 = cy1;
    [[cx1, cy1], [cx2, cy2]].forEach(function (cc) {
      ctx.strokeStyle = COL.grid; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(cc[0], cc[1], rr, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]);
    });
    var phi = 2 * Math.PI * dRel * Math.sin(th);
    var sumR = 0, sumI = 0;
    for (var m2 = 0; m2 < M; m2++) {
      var a = m2 * phi;
      sumR += Math.cos(a); sumI += Math.sin(a);
      line(cx1, cy1, cx1 + rr * Math.cos(a - Math.PI / 2), cy1 + rr * Math.sin(a - Math.PI / 2),
        m2 === 0 ? COL.warn : COL.acc, 1.3);
      line(cx2, cy2, cx2, cy2 - rr, 'rgba(15,123,63,.7)', 1.3);
    }
    var mag1 = Math.sqrt(sumR * sumR + sumI * sumI) / M;
    var ang1 = Math.atan2(sumI, sumR);
    arrow(cx1, cy1, cx1 + rr * mag1 * Math.cos(ang1 - Math.PI / 2),
      cy1 + rr * mag1 * Math.sin(ang1 - Math.PI / 2), COL.warn, 2.2);
    arrow(cx2, cy2, cx2, cy2 - rr, COL.ok, 2.2);
    mono(cx1, cy1 + rr + 12, '对齐前 ' + mag1.toFixed(2), COL.warn, 10, 'center');
    mono(cx2, cy2 + rr + 12, '对齐后 1.00', COL.ok, 10, 'center');
    mono(x2 + 6, cy2 + rr + 32, 'w_m = exp[−j2πf_c(r−R_m)/c] / M', COL.txt, 9.5);
    mono(x2 + 6, cy2 + rr + 47, 'y(r,θ) = Σ w_m·b_m((r+R_m)/c)', COL.txt, 9.5);
    if (H > 250) foot('波束形成就一句话：把各阵元相位转到同一方向再相加。');
  }

  /* ================================================================
   * 幕 ⑥（新增）：相控扫描 —— 一次 ping 同时形成几十个波束
   * ================================================================ */
  function drawScan() {
    var c = FLS.Env.profileAt(FLS.state.rov.z) || 1500;
    var lam = c / (FLS.P['tx.fc'] * 1000);
    var dRel = FLS.P['rx.spacing'] / 1000 / lam;
    var Mtrue = FLS.P['rx.nElem'];
    var sec = FLS.P['alg.sector'] * Math.PI / 180;
    var th3 = 0.886 / (Mtrue * dRel);
    var nb = Math.round(pv('nb', function () {
      return Math.max(4, Math.min(256, Math.pow(2, 3 + Math.round(3 * osc()))));
    }));
    var dTh = sec / nb;

    var x0 = 14, y0 = 40, w = W - 28, h = H - y0 - 38;
    var lp = W > 460 ? 0.34 : 0;
    var w1 = lp ? (w - 8) * lp : w;
    if (lp) {
      frame(x0, y0, w1, h, '一次快拍');
      var ax = x0 + 16, cyc = y0 + h / 2;
      var Mshow = 12;
      var gap = Math.min(14, (h - 40) / Mshow);
      for (var m = 0; m < Mshow; m++) {
        var ey = cyc - (Mshow - 1) / 2 * gap + m * gap;
        dot(ax, ey, 3, (m < Math.min(Mshow, 1 + Math.round(ramp() * Mshow))) ? COL.acc : COL.dim);
      }
      mono(ax + 10, cyc - (Mshow - 1) / 2 * gap - 10, 'x = [x₀ … x_{M−1}]', COL.txt, 9.5);
      mono(ax + 4, cyc + (Mshow - 1) / 2 * gap + 16, 'M = ' + Mtrue + ' 通道同时采样', COL.txt2, 9.5);
      mono(ax + 4, cyc + (Mshow - 1) / 2 * gap + 32, '同一份数据，反复用', COL.warn, 9.5);
    }
    var x2 = lp ? x0 + w1 + 8 : x0, w2 = lp ? w - w1 - 8 : w;
    frame(x2, y0, w2, h, '一次 ping → ' + nb + ' 个波束');
    var cx = x2 + w2 / 2, cy = y0 + h - 22;
    var rr = Math.min(w2 / 2 - 14, h - 52);
    // 网格
    ctx.strokeStyle = COL.grid; ctx.setLineDash([3, 3]);
    for (var q = 1; q <= 3; q++) {
      ctx.beginPath(); ctx.arc(cx, cy, rr * q / 3, -Math.PI / 2 - sec / 2, -Math.PI / 2 + sec / 2); ctx.stroke();
    }
    ctx.setLineDash([]);
    // 逐个波束画方向图
    var NP = 120;
    for (var b = 0; b < nb; b++) {
      var ste = -sec / 2 + dTh * (b + 0.5);
      ctx.strokeStyle = 'rgba(31,111,235,.42)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (var i = 0; i <= NP; i++) {
        var tt = ste - 1.6 * dTh + 3.2 * dTh * i / NP;
        var dbv = afDb(tt, ste, Mtrue, dRel);
        var r2 = rr * (1 + dbv / 40);
        var xx = cx + r2 * Math.sin(tt), yy = cy - r2 * Math.cos(tt);
        if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
    // 当前高亮波束
    var kb = Math.min(nb - 1, Math.floor(ramp() * nb));
    var ste2 = -sec / 2 + dTh * (kb + 0.5);
    ctx.strokeStyle = COL.warn; ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (var i2 = 0; i2 <= 240; i2++) {
      var tt2 = ste2 - 2.2 * dTh + 4.4 * dTh * i2 / 240;
      var db2 = afDb(tt2, ste2, Mtrue, dRel);
      var r3 = rr * (1 + db2 / 40);
      var xx2 = cx + r3 * Math.sin(tt2), yy2 = cy - r3 * Math.cos(tt2);
      if (i2 === 0) ctx.moveTo(xx2, yy2); else ctx.lineTo(xx2, yy2);
    }
    ctx.stroke();
    arrow(cx, cy, cx + rr * 1.02 * Math.sin(ste2), cy - rr * 1.02 * Math.cos(ste2), COL.warn, 1.6);
    dot(cx, cy, 3.5, COL.acc);
    mono(cx + 4, cy - rr - 8, '第 ' + (kb + 1) + ' / ' + nb + ' 束：θ=' +
      (ste2 * 180 / Math.PI).toFixed(1) + '°', COL.warn, 9.5);
    mono(x2 + 6, y0 + 20, 'θ₃ = ' + (th3 * 180 / Math.PI).toFixed(2) + '°　Δθ = ' +
      (dTh * 180 / Math.PI).toFixed(2) + '°', COL.txt, 10);
    mono(x2 + 6, y0 + 36, 'Δθ/θ₃ = ' + (dTh / th3).toFixed(2) +
      (dTh / th3 < 0.5 ? '（过密：相邻冗余）' : (dTh / th3 > 1.2 ? '（过疏：会漏目标）' : '（合适）')),
      dTh / th3 < 0.5 || dTh / th3 > 1.2 ? COL.warn : COL.ok, 10);
    if (H > 250) foot('y(θ) = w(θ)ᴴ x —— 换的是导向矢量 w，数据 x 还是同一份。');
  }

  /* ================================================================
   * 幕 ⑦（新增）：从回波到扇形图 —— 距离-方位栅格是怎么填出来的
   * ================================================================ */
  var gridSeed = null;
  function drawGrid() {
    var c = FLS.Env.profileAt(FLS.state.rov.z) || 1500;
    var rmax = Math.min(FLS.P['alg.rmax'], 0.98 * c * FLS.P['tx.prp'] * 1e-3 / 2);
    var sec = FLS.P['alg.sector'] * Math.PI / 180;
    var NB = FLS.P['alg.nBeam'], NI = FLS.P['alg.nBin'];
    if (!gridSeed) gridSeed = Math.random() * 1e6 | 0;
    var pickB = Math.round(pv('gb', function () { return Math.floor((0.15 + 0.7 * osc()) * NB); }));
    var pickI = Math.round(pv('gi', function () { return Math.floor((0.12 + 0.7 * (1 - osc())) * NI); }));
    pickB = Math.max(0, Math.min(NB - 1, pickB));
    pickI = Math.max(0, Math.min(NI - 1, pickI));

    var x0 = 14, y0 = 40, w = W - 28, h = H - y0 - 52;
    var lp = W > 470;
    var w1 = lp ? (w - 8) * 0.44 : w, w2 = lp ? w - w1 - 8 : 0;
    frame(x0, y0, w1, h, '扇形图像（距离-方位栅格）');
    // 扇形原点在下中
    var cx = x0 + w1 / 2, cy = y0 + h - 18, rr = Math.min(w1 / 2 - 12, h - 44);
    // 用伪随机填充每一格（一次性静态图，代表一帧散斑）
    var NBD = Math.min(NB, 48), NID = Math.min(NI, 40);
    for (var b = 0; b < NBD; b++) {
      for (var i = 0; i < NID; i++) {
        var s = Math.sin((b * 127.1 + i * 311.7 + gridSeed) * 12.9898) * 43758.5453;
        s = s - Math.floor(s);
        var amp = -Math.log(1 - 0.999 * s) / 4.5;      // Rayleigh 近似 → 0..1
        var g = Math.round(255 * Math.min(1, Math.max(0.05, amp)));
        var t0 = -sec / 2 + sec * (b / NBD), t1 = -sec / 2 + sec * ((b + 1) / NBD);
        var r0 = rr * (i / NID), r1 = rr * ((i + 1) / NID);
        ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')';
        ctx.beginPath();
        ctx.moveTo(cx + r0 * Math.sin(t0), cy - r0 * Math.cos(t0));
        ctx.lineTo(cx + r1 * Math.sin(t0), cy - r1 * Math.cos(t0));
        ctx.lineTo(cx + r1 * Math.sin(t1), cy - r1 * Math.cos(t1));
        ctx.lineTo(cx + r0 * Math.sin(t1), cy - r0 * Math.cos(t1));
        ctx.closePath(); ctx.fill();
      }
    }
    // 随时间推进的填充前沿（回波按 2R/c 到达）
    var fr = ramp();
    var rEdge = rr * fr;
    line(cx + rEdge * Math.sin(-sec / 2), cy - rEdge * Math.cos(-sec / 2),
      cx + rEdge * Math.sin(sec / 2), cy - rEdge * Math.cos(sec / 2), COL.warn, 1.4);
    mono(cx, cy - rr - 8, '回波前沿 r = ' + (rmax * fr).toFixed(1) + ' m　t = ' +
      (2 * rmax * fr / c * 1e3).toFixed(2) + ' ms', COL.warn, 9.5, 'center');
    // 选中单元
    var pb = Math.round(pickB / (NB - 1) * (NBD - 1)), pi = Math.round(pickI / (NI - 1) * (NID - 1));
    var ta = -sec / 2 + sec * (pb / NBD), tb2 = -sec / 2 + sec * ((pb + 1) / NBD);
    var ra = rr * (pi / NID), rb2 = rr * ((pi + 1) / NID);
    ctx.strokeStyle = COL.warn; ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(cx + ra * Math.sin(ta), cy - ra * Math.cos(ta));
    ctx.lineTo(cx + rb2 * Math.sin(ta), cy - rb2 * Math.cos(ta));
    ctx.lineTo(cx + rb2 * Math.sin(tb2), cy - rb2 * Math.cos(tb2));
    ctx.lineTo(cx + ra * Math.sin(tb2), cy - ra * Math.cos(tb2));
    ctx.closePath(); ctx.stroke();

    if (lp) {
      var x2 = x0 + w1 + 8;
      frame(x2, y0, w2, h, '这一格是怎么算出来的');
      var rb = pickI / NI * rmax;
      var thb = -sec / 2 + sec * (pickB + 0.5) / NB;
      mono(x2 + 6, y0 + 24, '第 ' + (pickB + 1) + ' 束 / 共 ' + NB, COL.warn, 10.5);
      mono(x2 + 6, y0 + 40, '第 ' + (pickI + 1) + ' 距离单元 / 共 ' + NI, COL.warn, 10.5);
      mono(x2 + 6, y0 + 60, 'r = ' + rb.toFixed(2) + ' m', COL.txt, 10.5);
      mono(x2 + 6, y0 + 76, 'θ = ' + (thb * 180 / Math.PI).toFixed(2) + '°', COL.txt, 10.5);
      mono(x2 + 6, y0 + 96, '取样时刻 tₘ = (r + Rₘ)/c', COL.txt, 10.5);
      mono(x2 + 6, y0 + 112, '加权 exp[−j2πf_c(r − Rₘ)/c]', COL.txt, 10.5);
      mono(x2 + 6, y0 + 132, 'y = (1/M)Σ wₘ·bₘ(tₘ)', COL.acc, 11);
      mono(x2 + 6, y0 + 156, '每个像素都是一次独立的', COL.txt2, 10);
      mono(x2 + 6, y0 + 172, '延时求和 —— 这就是全部的', COL.txt2, 10);
      mono(x2 + 6, y0 + 188, '"成像算法"骨架。', COL.txt2, 10);
    }
    if (H > 250) foot('在图上拖动鼠标可以直接挑任意一格看它的算法清单。');
  }

  /* ================================================================
   * 幕 ⑧：脉冲重复周期与不模糊距离
   * ================================================================ */
  function drawPrp() {
    var c = FLS.Env.profileAt(FLS.state.rov.z) || 1500;
    var PRP = FLS.P['tx.prp'] * 1e-3;
    var Run = c * PRP / 2;
    var rel = pv('rt', function () { return 1.6 * t; });      // R / R_un
    var Rt = Run * rel;

    var x0 = 14, y0 = 40, w = W - 28, h = H - y0 - 40;
    frame(x0, y0, w, h, '发射–回波时序：超过 c·PRP/2 的回波会折返成假目标');
    var bx = x0 + 40, bw = w - 56, by = y0 + 46, bh = h - 92;
    var nPrp = 3, prpW = bw / nPrp;
    for (var k = 0; k < nPrp; k++) {
      var tx0 = bx + k * prpW;
      rect(tx0, by, 4, 14, COL.acc);
      mono(tx0, by - 9, 'T' + (k + 1), COL.acc, 9.5);
      line(tx0, by, tx0, by + bh, COL.grid, 1, [3, 3]);
    }
    var delay = 2 * Rt / c / PRP * prpW;
    var fold = Math.floor(delay / prpW);
    var inX = bx + (delay - fold * prpW);
    var cy = by + 40;
    rect(inX, cy - 7, 4, 14, Rt > Run ? COL.warn : COL.ok);
    mono(inX, cy - 20, '回波', Rt > Run ? COL.warn : COL.ok, 9.5);
    label(Math.min(inX + 8, bx + bw - 130), cy, Rt > Run ? '⚠ 折返→假目标' : '✔ 落在第 1 周期内',
      Rt > Run ? COL.warn : COL.ok, 10);
    mono(bx + 4, by + bh + 16, '真实 R = ' + Rt.toFixed(1) + ' m　2R/c = ' + (2 * Rt / c * 1e3).toFixed(1) + ' ms',
      COL.txt, 10.5);
    mono(bx + 4, by + bh + 32, 'PRP = ' + (PRP * 1e3).toFixed(1) + ' ms → R_un = ' + Run.toFixed(1) + ' m', COL.txt, 10.5);
    mono(bx + 4, by + bh + 48, 'rmax = ' + FLS.P['alg.rmax'] + ' m' +
      (FLS.P['alg.rmax'] > Run ? '　⚠ 已自动截断' : '　✔ 在不模糊距离内'),
      FLS.P['alg.rmax'] > Run ? COL.warn : COL.ok, 10.5);
    if (H > 250) foot('PRP 太短 → 远距回波混叠成近距假目标；太长 → 帧率下降、运动拼接断裂。');
  }

  /* ================================================================
   * 幕 ⑨：混响与散斑 —— Rayleigh 分布与多视
   * ================================================================ */
  var speckleHist = null;
  function drawSpeckle() {
    var looks = pv('L', function () { return [1, 2, 4, 8, 16][Math.min(4, Math.floor(t * 5))]; });
    var x0 = 14, y0 = 40, w = W - 28, h = H - y0 - 38;
    var w1 = w * 0.42;
    frame(x0, y0, w1, h, '随机相位面元的相量游走');
    var cx0 = x0 + w1 / 2, cy0 = y0 + h / 2 + 4;
    var N = 200;
    var grow = Math.max(2, Math.floor(N * Math.min(1, CUR && CUR.auto ? t * 1.2 : 1)));
    var L = Math.max(2.5, Math.min(w1, h) * 0.42 / Math.sqrt(N));
    var pxx = cx0, pyy = cy0, sx = 0, sy = 0;
    ctx.strokeStyle = 'rgba(31,111,235,.55)'; ctx.lineWidth = 1.05;
    ctx.beginPath(); ctx.moveTo(pxx, pyy);
    for (var i = 0; i < grow; i++) {
      var a = Math.sin(i * 12.9898) * 43758.5453;
      a = (a - Math.floor(a)) * 6.2832;
      sx += L * Math.cos(a); sy += L * Math.sin(a);
      ctx.lineTo(cx0 + sx, cy0 + sy);
    }
    ctx.stroke();
    arrow(cx0, cy0, cx0 + sx, cy0 + sy, COL.warn, 2);
    dot(cx0, cy0, 2.5, COL.txt);
    mono(x0 + 6, y0 + 22, '面元数 N = ' + grow, COL.txt, 10);
    mono(x0 + 6, y0 + 38, '实部/虚部 → 高斯', COL.txt2, 10);
    mono(x0 + 6, y0 + 54, '幅度 → Rayleigh', COL.txt2, 10);

    var x2 = x0 + w1 + 10, w2 = W - 14 - x2;
    frame(x2, y0, w2, h, '幅度分布：单视 vs ' + looks + ' 视');
    var bx = x2 + 34, bw = w2 - 50, by = y0 + h - 20, bh = h - 52;
    line(bx, by, bx + bw, by, COL.axis, 1);
    line(bx, by, bx, by - bh, COL.axis, 1);
    function rayl(a, s) { return (a / (s * s)) * Math.exp(-a * a / (2 * s * s)); }
    var amax = 3.4;
    var s = 1 / Math.sqrt(looks), norm = rayl(s, s);
    ctx.strokeStyle = COL.dim; ctx.lineWidth = 1.1; ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (var q = 0; q <= 120; q++) {
      var aq = amax * q / 120;
      var xx0 = bx + bw * (aq / amax), yy0 = by - bh * Math.min(1.02, rayl(aq, 1) / rayl(1, 1));
      if (q === 0) ctx.moveTo(xx0, yy0); else ctx.lineTo(xx0, yy0);
    }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = COL.acc; ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (var q2 = 0; q2 <= 160; q2++) {
      var a2 = amax * q2 / 160;
      var xx2 = bx + bw * (a2 / amax), yy2 = by - bh * Math.min(1.02, rayl(a2, s) / norm);
      if (q2 === 0) ctx.moveTo(xx2, yy2); else ctx.lineTo(xx2, yy2);
    }
    ctx.stroke();
    if (!speckleHist) speckleHist = [];
    if (t < 0.02) speckleHist.length = 0;
    var NBv = 30;
    while (speckleHist.length < 3000 * Math.min(1, (CUR && CUR.auto ? t : 1) * 1.4)) {
      var u1 = Math.random() || 1e-9;
      var rv = Math.sqrt(-2 * Math.log(u1)) * (1 / Math.sqrt(looks));
      speckleHist.push(rv);
    }
    var bins = new Array(NBv).fill(0);
    for (var qi = 0; qi < speckleHist.length; qi++) {
      var b = Math.floor(speckleHist[qi] / amax * NBv);
      if (b >= 0 && b < NBv) bins[b]++;
    }
    var mx = Math.max.apply(null, bins) || 1;
    for (var b2 = 0; b2 < NBv; b2++) {
      var hb = bh * bins[b2] / mx;
      rect(bx + bw * (b2 / NBv) + 1, by - hb, bw / NBv - 1.5, hb, 'rgba(31,111,235,.34)');
    }
    mono(bx + 4, y0 + 20, '虚线=单视　实线=' + looks + ' 视', COL.txt2, 9.5);
    mono(bx + bw, y0 + 20, '起伏 sd ≈ ' + (5.6 / Math.sqrt(looks)).toFixed(1) + ' dB', COL.warn, 10, 'right');
    if (H > 250) foot('多视按 1/√N 压起伏，代价是分辨率同步下降 —— 本系统默认单视。');
  }

  /* ================================================================
   * 幕 ⑩：目标回波与声影
   * ================================================================ */
  function drawShadow() {
    var x0 = 14, y0 = 40, w = W - 28, h = H - y0 - 38;
    frame(x0, y0, w, h, '目标回波与声影（纵剖面）');
    var px = x0 + 50, py = y0 + 40;
    var floorY = y0 + h - 26;
    var rmax = FLS.P['alg.rmax'];
    var scale = (w - 88) / rmax;
    rect(x0 + 1, floorY, w - 2, y0 + h - floorY - 1, '#8a7f66');
    rect(px - 8, py - 5, 16, 10, COL.acc, COL.txt);
    label(px, py - 14, 'ROV', COL.acc, 10, 'center');
    var hRov = (floorY - py) / scale;
    var relH = pv('hrel', function () { return 0.20 + 0.30 * osc(); });
    var Rrel = pv('rrel', function () { return 0.34 + 0.16 * (1 - osc()); });
    var Rt = rmax * Rrel, Ht = hRov * relH;
    var tx = px + Rt * scale, tyTop = floorY - Ht * scale;
    rect(tx - 5, tyTop, 11, floorY - tyTop, COL.warm, COL.txt);
    label(tx, tyTop - 9, '目标 H=' + Ht.toFixed(1) + 'm', COL.warn, 10, 'center');
    var Ls = Rt * Ht / Math.max(0.2, hRov - Ht);
    var shX = Math.min(px + rmax * scale, tx + Ls * scale);
    rect(tx + 6, floorY - 2, Math.max(2, shX - tx), 7, 'rgba(0,0,0,.72)');
    if (shX > tx + 18) {
      label((tx + shX) / 2, floorY - 11, '声影', COL.txt2, 10, 'center');
      arrow(tx + 16, floorY - 24, shX, floorY - 24, COL.dim, 1.1);
      arrow(shX, floorY - 24, tx + 16, floorY - 24, COL.dim, 1.1);
      mono((tx + shX) / 2, floorY - 37, 'L = ' + Ls.toFixed(1) + ' m', COL.txt, 10, 'center');
    }
    line(px, py, tx, tyTop, COL.acc, 1.3);
    line(px, py, shX + 8, floorY, 'rgba(31,111,235,.42)', 1.1, [4, 3]);
    dot(tx, tyTop, 3.5, COL.warm);
    mono(px + 6, py + 20, 'h = ' + hRov.toFixed(1) + ' m', COL.txt2, 10);
    mono(px + 6, py + 36, 'R_t = ' + Rt.toFixed(1) + ' m', COL.txt2, 10);
    mono(x0 + 6, y0 + 22, 'L = R_t·H / (h − H)', COL.warn, 10.5);
    mono(x0 + 6, y0 + 38, Ht >= hRov * 0.98 ? '⚠ H ≥ h：影子无限长' : '',
      Ht >= hRov * 0.98 ? COL.warn : COL.txt2, 10);
    if (H > 250) foot('判读要点：黑楔子往往比亮回波更好认 —— 它不随目标姿态闪烁。');
  }

  /* ================================================================
   * 幕 ⑪：TVG —— 为什么是 40lg r
   * ================================================================ */
  function drawTvg() {
    var K = pv('K', function () { return (t < 0.5) ? 30 : 40; });
    var x0 = 14, y0 = 40, w = W - 28, h = H - y0 - 38;
    var h2ok = H > 300;
    frame(x0, y0, w, h, '传播损失、混响与 TVG（K = ' + K + '）');
    var bx = x0 + 40, bw = w - 58, by = y0 + h - (h2ok ? 20 : 26), bh = h - (h2ok ? 52 : 60);
    var rmin = 2, rmax = FLS.P['alg.rmax'];
    var lim = CUR && CUR.auto ? ramp() : 1;
    function X(r) { return bx + bw * (Math.log10(r / rmin) / Math.log10(rmax / rmin)); }
    function Y(db) { return by - bh * (db + 80) / 100; }
    for (var r = 2; r <= rmax; r *= 2) {
      if (r > rmax) break;
      line(X(r), by - bh, X(r), by, COL.grid, 1);
      mono(X(r), by + 10, r + (r === 2 ? 'm' : ''), COL.dim, 9, 'center');
    }
    for (var dbv = -80; dbv <= 20; dbv += 20) {
      line(bx, Y(dbv), bx + bw, Y(dbv), COL.grid, 1, [3, 3]);
      mono(bx - 4, Y(dbv), dbv + '', COL.dim, 9, 'right');
    }
    line(bx, by, bx + bw, by, COL.axis, 1);
    line(bx, by - bh, bx, by, COL.axis, 1);
    function curve(fn, color, lw) {
      ctx.strokeStyle = color; ctx.lineWidth = lw || 1.6;
      ctx.beginPath(); var first = true;
      for (var i = 0; i <= 240; i++) {
        var u = i / 240; if (u > lim) break;
        var r2 = rmin * Math.pow(rmax / rmin, u);
        var xx = X(r2), yy = Y(fn(r2));
        if (first) { ctx.moveTo(xx, yy); first = false; } else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
    curve(function (r) { return -40 * Math.log10(r); }, COL.acc, 1.8);      // 点目标
    curve(function (r) { return -30 * Math.log10(r) + 10; }, COL.warn, 1.8); // 混响
    curve(function (r) { return K * Math.log10(r) - 60; }, COL.dim, 1.3);    // TVG
    var lg = [{ c: COL.acc, s: '点目标 ∝ −40lg r' }, { c: COL.warn, s: '海底混响 ∝ −30lg r' },
    { c: COL.dim, s: 'TVG = +' + K + 'lg r' }];
    lg.forEach(function (it, i) {
      var ly = y0 + 20 + i * 14, lx = Math.max(bx + 6, bx + bw - 190);
      line(lx, ly, lx + 16, ly, it.c, 2);
      mono(lx + 20, ly, it.s, COL.txt, 10);
    });
    // 补偿结果
    var y2 = by + (h2ok ? 26 : 16), hh2 = H - 16 - y2;
    if (hh2 > 40) {
      frame(x0, y2, w, hh2, 'TVG 补偿后');
      var by2 = y2 + hh2 - 6, bh2 = hh2 - 26;
      function Y2(db) { return by2 - bh2 * (db + 20) / 60; }
      line(bx, by2, bx + bw, by2, COL.axis, 1);
      ctx.strokeStyle = COL.acc; ctx.lineWidth = 1.7; ctx.beginPath();
      var f1 = true;
      for (var i2 = 0; i2 <= 240; i2++) {
        var u2 = i2 / 240; if (u2 > lim) break;
        var r3 = rmin * Math.pow(rmax / rmin, u2);
        var xx2 = X(r3), yy2 = Y2((K - 40) * Math.log10(r3));
        if (f1) { ctx.moveTo(xx2, yy2); f1 = false; } else ctx.lineTo(xx2, yy2);
      }
      ctx.stroke();
      ctx.strokeStyle = COL.warn; ctx.lineWidth = 1.7; ctx.beginPath();
      var f2 = true;
      for (var i3 = 0; i3 <= 240; i3++) {
        var u3 = i3 / 240; if (u3 > lim) break;
        var r4 = rmin * Math.pow(rmax / rmin, u3);
        var xx3 = X(r4), yy3 = Y2((K - 30) * Math.log10(r4) + 10);
        if (f2) { ctx.moveTo(xx3, yy3); f2 = false; } else ctx.lineTo(xx3, yy3);
      }
      ctx.stroke();
      mono(bx + 4, y2 + 14, '点目标', COL.acc, 10);
      mono(bx + 90, y2 + 14, K === 40 ? '（平）' : '（' + (K - 40) + ' lg r）', COL.acc, 10);
      mono(bx + 150, y2 + 14, '混响（+' + (K - 30) + ' lg r）', COL.warn, 10);
    }
    if (H > 320) foot('K=40：点目标补偿后与距离无关；混响被过补偿 +10lg r，十倍程差 10 dB，可接受。');
  }

  /* ================================================================
   * 幕 ⑫（新增）：声呐方程 —— 能不能看见，最后是一道加减法
   * ================================================================ */
  function drawSonarEq() {
    var c = FLS.Env.profileAt(FLS.state.rov.z) || 1500;
    var fcK = FLS.P['tx.fc'];
    var SL = (parseFloat(FLS.P['tx.sl']) || 210) + (parseFloat(FLS.P['tx.gain']) || 0);
    var TS = pv('TS', function () { return -30 + 25 * osc(); });
    var M = FLS.P['rx.nElem'];
    var DI = 10 * Math.log10(Math.max(1, M));
    // 噪声：Knudsen 谱在带宽内积分 + 自噪声 + 通道电噪声
    var NLk = parseFloat(FLS.P['env.nl1k']) || 60;
    var B = FLS.P['tx.bw'] * 1000;
    var NL = NLk - 17 * Math.log10(fcK) + 10 * Math.log10(Math.max(1, B)) + 6;
    var DTg = 12;
    var alphaDbM = (parseFloat(FLS.P['env.alphaManual']) || 60) / 1000;   // dB/m（单程）
    var TH = NL - DI + DTg;

    function EL(r) { return SL - 40 * Math.log10(r) - 2 * alphaDbM * r + TS; }

    var x0 = 14, y0 = 40, w = W - 28, h = H - y0 - 38;
    frame(x0, y0, w, h, '声呐方程：SL − 2TL + TS ≥ NL − DI + DT');
    var bx = x0 + 40, bw = w - 58, by = y0 + h - 26, bh = h - 56;
    var rmin = 2, rmax = Math.max(10, FLS.P['alg.rmax']);
    function X(r) { return bx + bw * (Math.log10(r / rmin) / Math.log10(rmax / rmin)); }
    var lo = 1e9, hi = -1e9;
    for (var i0 = 0; i0 <= 100; i0++) { var v0 = EL(rmin * Math.pow(rmax / rmin, i0 / 100)); if (v0 < lo) lo = v0; if (v0 > hi) hi = v0; }
    lo = Math.min(lo, TH); hi = Math.max(hi, TH);
    var pad = 8; lo -= pad; hi += pad;
    function Y(db) { return by - bh * (db - lo) / Math.max(1e-6, hi - lo); }
    for (var r = 2; r <= rmax; r *= 2) {
      if (r > rmax) break;
      line(X(r), by - bh, X(r), by, COL.grid, 1);
      mono(X(r), by + 10, r + '', COL.dim, 9, 'center');
    }
    line(bx, by, bx + bw, by, COL.axis, 1);
    line(bx, by - bh, bx, by, COL.axis, 1);
    // 回波级曲线
    ctx.strokeStyle = COL.acc; ctx.lineWidth = 1.8; ctx.beginPath();
    for (var i = 0; i <= 240; i++) {
      var r2 = rmin * Math.pow(rmax / rmin, i / 240);
      var xx = X(r2), yy = Y(EL(r2));
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    // 检测阈
    line(bx, Y(TH), bx + bw, Y(TH), COL.warn, 1.6, [6, 4]);
    mono(bx + 4, Y(TH) - 10, '检测阈 NL − DI + DT = ' + TH.toFixed(0) + ' dB', COL.warn, 10);
    // 交点
    var rDet = NaN;
    for (var i2 = 240; i2 >= 1; i2--) {
      var rA = rmin * Math.pow(rmax / rmin, (i2 - 1) / 240);
      var rB = rmin * Math.pow(rmax / rmin, i2 / 240);
      if (EL(rA) >= TH && EL(rB) < TH) { rDet = rB; break; }
    }
    if (isFinite(rDet)) {
      line(X(rDet), by - bh, X(rDet), by, COL.ok, 1.2);
      dot(X(rDet), Y(TH), 4, COL.ok);
      mono(Math.min(X(rDet) + 6, bx + bw - 96), Y(TH) + 14, 'R_max ≈ ' + rDet.toFixed(1) + ' m', COL.ok, 10.5);
    } else if (EL(rmax) >= TH) {
      mono(bx + 6, by - bh + 14, '全量程可探测', COL.ok, 10.5);
    } else {
      mono(bx + 6, by - bh + 14, '⚠ 全量程都探不到：降低 DT / 提高 TS / 增大 SL', COL.warn, 10.5);
    }
    mono(bx + 4, y0 + 20, 'SL=' + SL.toFixed(0) + '  TS=' + TS.toFixed(0) + ' dB', COL.txt, 10);
    mono(bx + bw, y0 + 20, 'NL=' + NL.toFixed(0) + '  DI=10lg' + M + '=' + DI.toFixed(0) + ' dB',
      COL.txt2, 10, 'right');
    if (H > 250) foot('2TL = 40lg r + 2αr —— 高频的好处（高 DI、细分辨）最终会被吸收 2αr 收回去。');
  }

  /* ================================================================
   * 幕定义：12 幕 / 3 版
   *   每幕字段：
   *     id,name,period,draw,brief（卡片下一句提要）,text（右侧完整讲解）,formula
   *     ctrls：[{k,l,min,max,step,unit,fmt}]  可手动调节的演示变量
   *     dragX：true 表示在画布上左右拖动即调第 1 个 ctrls
   * ================================================================ */
  var ONE = function (v) { return v.toFixed(1); };
  var TWO = function (v) { return v.toFixed(2); };
  var INT = function (v) { return v.toFixed(0); };

  var SCENES = [
    /* ---------------- 第 1 版：声波怎么走 ---------------- */
    {
      id: 'geom', period: 8, draw: drawGeom, dragX: true,
      name: '① 几何：斜距 / 地距 / 掠射角 / 盲区',
      brief: '垂直扇面只照亮"一段环"，正下方永远是盲区；抬头会把照亮带推出去。',
      ctrls: [
        { k: 'pitch', l: '声呐俯仰', min: -30, max: 30, step: 1, unit: '°', fmt: INT },
        { k: 'h', l: '离底高度', min: 2, max: 40, step: 0.5, unit: 'm', fmt: ONE }
      ],
      text: '前视声呐把一束<b>水平宽（~120°）、垂直窄（20°~40°）</b>的扇形波束打向正前方。' +
        '垂直开角决定海床被照亮的区间：正下方俯角趋近 0°，永远照不到，形成<b>盲区</b>；' +
        '最近被照到的地距是 <b>r_near = h / tan(θ_v/2)</b>（h 离底高度、θ_v 垂直开角）。' +
        '<br><br><b>拖一拖俯仰滑块</b>：负值是低头，照亮带向近端收；正值是抬头，照亮带向远端推；' +
        '抬到 θ_v/2 以上两条边缘都不再指向海床，<b>整幅图变黑</b> —— ' +
        '这正是 V3.7 里扇面上出现假环纹的场景，根因就在"声呐朝哪看"这件事没进面元布设的判据。' +
        '<br><br>右边俯视图里那条来回扫的黄线就是一帧图像的<b>方位轴</b>。',
      formula: '斜距 R：回波走过的单程距离，图像径向坐标\n' +
        '地距 g = √(R² − h²)：海床平面上的投影\n' +
        '掠射角 θg = arcsin(h / R)　前视声呐典型 5°~30°\n' +
        '盲区近端 r_near = h / tan(θ_v/2)'
    },
    {
      id: 'tx', period: 7, draw: drawTx,
      name: '② 发射：LFM 与脉冲压缩',
      brief: '距离分辨率只由带宽决定；τ 只负责装能量，脉压再把它压缩回来。',
      ctrls: [],
      text: '默认发射<b>线性调频（LFM）</b>脉冲：载频 f_c 上叠一条线性扫频，时宽 τ、带宽 B。' +
        '<b>距离分辨率 ΔR = c/2B 只由带宽决定，与脉冲宽度无关</b> —— ' +
        'τ 的作用是装能量：τ 越长总能量越大，匹配滤波把它压缩回 ΔR 里，' +
        '白拿 <b>10lg(τB)</b> 的处理增益（时宽带宽积）。这就是声呐都用长脉冲 + 大带宽的原因。' +
        '<br><br>下半幅的矩形谱是幅度谱，橙色虚线是<b>瞬时频率</b>：它从 f_c−B/2 线性扫到 f_c+B/2。' +
        '扫频斜率做匹配滤波，输出主瓣宽度就是 1/B。',
      formula: 's(t) = w(t)·exp[j2π(f_c t + B t² / 2τ)]\n' +
        '匹配滤波输出 ≈ sinc(Bt)　→　−6 dB 宽 ΔR = c / 2B\n' +
        '处理增益 G = 10lg(τB)'
    },
    {
      id: 'resr', period: 8, draw: drawResR, dragX: true,
      name: '③ 距离分辨率 ΔR = c/2B',
      brief: '两个点目标靠到多近还能分开？拖滑块看单峰变双峰的那一刻。',
      ctrls: [
        { k: 'sep', l: '间距', min: 0.1, max: 3, step: 0.02, unit: 'ΔR', fmt: TWO }
      ],
      text: '动画里间距从 0.25ΔR 拉到 3ΔR：间距小于 ΔR 时合成<b>单峰</b>，看不出是两个；' +
        '达到 ΔR 后中间出现明显凹陷（<b>瑞利判据</b>：中点不超过峰值的 0.75 才算分辨开）。' +
        '<br><br><b>在画布上左右拖动</b>即可连续调间距，找一找"刚好分得开"的那个位置。' +
        '<br><br>注意区分两件事：<b>系统真实分辨率是 c/2B（厘米级）</b>，' +
        '<b>显示栅格单元数 nBin 只决定画图颗粒</b> —— 一个显示像素对应一个统计栅格才不会出莫尔纹。',
      formula: 'ΔR = c / 2B　（B=30 kHz → ΔR = 2.5 cm）\n' +
        '瑞利判据：中点凹陷 ≤ 峰值的 0.75 才算分辨开'
    },
    {
      id: 'resa', period: 8, draw: drawResA, dragX: true,
      name: '④ 方位分辨率：孔径与栅瓣',
      brief: '孔径决定波束宽度；但阵元间距超过 λ/2，会以栅瓣的形式付回去。',
      ctrls: [
        { k: 'M', l: '阵元数', min: 2, max: 128, step: 1, unit: '', fmt: INT },
        { k: 'dRel', l: '间距 d/λ', min: 0.1, max: 1.2, step: 0.01, unit: '', fmt: TWO }
      ],
      text: '一维水平线阵的方位分辨率由<b>孔径</b>决定：D = (M−1)·d，主瓣半功率宽 ' +
        'θ₃ ≈ 0.886λ/(Md)。<b>阵元数翻倍，波束减半。</b>' +
        '<br><br>把 <b>d/λ 拖过 0.5</b>：方向图上立刻长出与主瓣等高的<b>栅瓣</b> —— ' +
        '那是一个方向不明的"假目标"，而且它跟真目标一样亮，判读时极难分辨。' +
        '这就是<b>空间采样定理</b>（奈奎斯特）在阵列上的形式：阵元是对孔径的空间采样。' +
        '<br><br>斜视时有效孔径按 cosθ 缩短，所以<b>扇区边缘总是比法向模糊</b>。',
      formula: 'θ₃ ≈ 0.886 · λ / (M d cosθ)\n' +
        '孔径 D = (M−1)·d\n' +
        '栅瓣条件：d ≤ λ / 2'
    },

    /* ---------------- 第 2 版：阵列怎么"看" ---------------- */
    {
      id: 'bf', period: 8, draw: drawBF, dragX: true,
      name: '⑤ 波束形成：延时求和',
      brief: '一句话：把各阵元相位转到同一方向再相加。拖动改入射角。',
      ctrls: [
        { k: 'theta', l: '入射角 θ', min: -60, max: 60, step: 1, unit: '°', fmt: INT }
      ],
      text: '全部内容就一句话：<b>把各阵元的相位转到同一个方向再相加</b>。' +
        '平面波以 θ 入射时，相邻阵元程差 d·sinθ，对应时延 τ = d·sinθ/c、相位差 φ = 2πd·sinθ/λ。' +
        '<br><br>左图是入射波前，右图是相量图：<b>补偿前</b>各相量沿一段圆弧散开、求和后互相抵消' +
        '（|Σ|/M 远小于 1）；<b>补偿后</b>沿同一方向排成一列、M 路同相叠加得 M 倍幅度。' +
        '<br><br><b>拖动滑块或直接在画布上左右拖</b>，盯着右边橙色的合成矢量：' +
        'θ 越大相位散布越宽、合成矢量越短 —— 这就是"波束"的来处。' +
        '<br><br>系统里这一步是<b>逐像素</b>做的：对每个 (r, θ) 取各阵元在 tₘ=(r+Rₘ)/c 处的样本，' +
        '乘聚焦相位再求和。',
      formula: 'y(r,θ) = (1/M) Σₘ wₘ · bₘ( (r + Rₘ)/c ) · exp[−j2πf_c (r − Rₘ)/c]\n' +
        '程差 Δ = d·sinθ　→　φ = 2πΔ/λ'
    },
    {
      id: 'scan', period: 8, draw: drawScan, dragX: true,
      name: '⑥ 相控扫描：一次 ping 出几十个波束',
      brief: '换的是导向矢量 w(θ)，数据 x 还是同一份 —— 并行不是在时间里，是在权重里。',
      ctrls: [
        { k: 'nb', l: '波束数 N', min: 4, max: 256, step: 1, unit: '', fmt: INT }
      ],
      text: '常见误解：以为 N 个波束要发 N 次脉冲。<b>不是。</b>' +
        '一次 ping、每个阵元采一段时序 <b>x = [x₀ … x_{M−1}]</b>，' +
        '然后对 N 个不同角度各做一次延时求和：' +
        '<br><br><b>y(θ_k) = w(θ_k)ᴴ x</b>' +
        '<br><br>换的是<b>导向矢量</b> w，数据还是同一份。所以"同时形成几十个波束"是权重维度的并行。' +
        '<br><br>把 <b>N 拖大</b>：相邻波束重叠越来越多，图像更平滑但计算量线性上升，' +
        '且相邻像素不再独立（多出来的都是同一份数据的线性组合）。' +
        '把 <b>N 拖到很小</b>（Δθ 与 θ₃ 可比或更大）：波束之间出现空隙，' +
        '正好落在缝里的目标会被漏掉 —— 橙色标注会给出 Δθ/θ₃ 的提示。',
      formula: 'x = [x₀, x₁, …, x_{M−1}]ᵀ　　一次快拍\n' +
        'w(θ) = [1, e^{jφ}, …, e^{j(M−1)φ}]ᵀ / √M　　φ = 2πd·sinθ/λ\n' +
        'y(θ) = w(θ)ᴴ x　　N 个 θ 各算一次，共用同一份 x'
    },
    {
      id: 'grid', period: 9, draw: drawGrid, dragX: true, drag2: true,
      name: '⑦ 从回波到扇形图',
      brief: '每个像素都是一次独立的延时求和；回波按 2R/c 到达，图像从内向外长出来。',
      ctrls: [
        { k: 'gb', l: '选定波束', min: 0, max: 200, step: 1, unit: '', fmt: INT },
        { k: 'gi', l: '选定距离单元', min: 0, max: 400, step: 1, unit: '', fmt: INT }
      ],
      text: '扇形图像的每一个像素，都对应一次独立的延时求和 —— 这就是前视声呐成像算法的<b>全部骨架</b>。' +
        '<br><br>左侧是"形"：图像是一个<b>距离–方位栅格</b>，纵轴 R ∈ [r_min, r_max]，横轴 θ ∈ [−扇角/2, +扇角/2]。' +
        '橙色横线是<b>回波前沿</b>：t = 2R/c，所以图像是<b>从内向外一层一层长出来</b>的，' +
        '不是整幅一起出现。' +
        '<br><br><b>在画布上拖动鼠标挑一格</b>，右侧立刻给出：' +
        '这一格的斜距 r、方位 θ、每个阵元该取哪个时刻的样本 tₘ=(r+Rₘ)/c、' +
        '以及该乘的聚焦相位。看懂右侧这几行，前视声呐的算法就通了。' +
        '<br><br>注意图里的颗粒感是<b>散斑</b>（见第 ⑨ 幕），不是噪声也不是 bug。',
      formula: '像素 (beam = i, bin = j)：\n' +
        '  θ_i = −Θ/2 + Θ·(i+½)/N_beam\n' +
        '  r_j = r_min + (r_max−r_min)·j/N_bin\n' +
        '  tₘ  = (r_j + Rₘ)/c　　　Rₘ = 第 m 元到参考点的距离\n' +
        '  y(i,j) = (1/M) Σₘ wₘ · bₘ(tₘ) · exp[−j2πf_c(r_j − Rₘ)/c]'
    },
    {
      id: 'prp', period: 8, draw: drawPrp, dragX: true,
      name: '⑧ 距离混叠：PRP 与不模糊距离',
      brief: '回波落在下一个发射周期里，就被当成近距回波 —— 假目标。',
      ctrls: [
        { k: 'rt', l: '目标距离', min: 0.05, max: 2.2, step: 0.01, unit: 'R_un', fmt: TWO }
      ],
      text: '每隔 PRP 发一个脉冲，回波在 2R/c 后返回。<b>若 2R/c > PRP</b>，' +
        '这个回波会落到<b>下一个</b>发射周期里，被当成近距回波 —— 就是<b>距离混叠</b>（假目标）。' +
        '不模糊距离 <b>R_un = c·PRP/2</b>。' +
        '<br><br><b>拖动把目标推过 1.0 R_un</b>：橙色回波条会突然折回到第 1 个周期的前面，' +
        '图上它看起来很近，而真实距离标签还在往后走 —— 这就是假目标。' +
        '<br><br>PRP 也不能一味加长：PRP 越长<b>帧率越低</b>，载体运动时相邻扇面之间会出现裂缝。' +
        '本系统在 r_max 超过 R_un 时自动按 0.98 R_un 截断并告警。',
      formula: 'R_un = c · PRP / 2\n' +
        '（PRP = 100 ms, c = 1500 m/s → R_un = 75 m）\n' +
        '帧率 = 1 / PRP'
    },

    /* ---------------- 第 3 版：图像为什么长这样 ---------------- */
    {
      id: 'speckle', period: 9, draw: drawSpeckle, dragX: true,
      name: '⑨ 混响与散斑：Rayleigh 分布',
      brief: '分辨单元里一堆随机相位的面元，和出来必然是 Rayleigh —— 不是噪声、不是 bug。',
      ctrls: [
        { k: 'L', l: '多视数 N', min: 1, max: 16, step: 1, unit: '', fmt: INT }
      ],
      text: '一个分辨单元里有大量独立散射体，每个贡献一个<b>随机相位</b>的复回波。' +
        '随机相位相量相加就是一次<b>随机游走</b>（左图）：实部、虚部各自趋于高斯，' +
        '幅度因此趋于 <b>Rayleigh 分布</b>。' +
        '<br><br>这不是噪声也不是 bug：<b>单视幅度起伏标准差约 5.6 dB</b>、' +
        '峰值比中位数高 8~10 dB 是常态。一个比背景高 10 dB 的目标，单视时是真的可能看不见。' +
        '<br><br><b>拖多视数 N</b>：相邻单元功率平均，起伏按 1/√N 下降，' +
        '代价是<b>分辨率同步下降</b> —— 天下没有免费的散斑抑制。本系统默认单视，与实拍图一致。',
      formula: 'p(a) = (a/σ²)·exp(−a²/2σ²)　（Rayleigh）\n' +
        '单视：sd ≈ 5.6 dB\n' +
        'N 视：sd ≈ 5.6/√N dB，代价是分辨单元放大 √N'
    },
    {
      id: 'shadow', period: 8, draw: drawShadow, dragX: true,
      name: '⑩ 目标回波与声影',
      brief: '黑楔子往往比亮回波更好认 —— 它不随目标姿态闪烁。',
      ctrls: [
        { k: 'hrel', l: '目标高 H/h', min: 0.05, max: 0.95, step: 0.01, unit: '', fmt: TWO },
        { k: 'rrel', l: '距离 R/r_max', min: 0.1, max: 0.9, step: 0.01, unit: '', fmt: TWO }
      ],
      text: '立在海底的目标既产生<b>强回波</b>（亮），又在身后投下<b>声影</b>（黑）。' +
        '声影长度由相似三角形给出：<b>L = R_t·H/(h−H)</b>。' +
        '<br><br><b>判读经验：黑楔子往往比亮回波更好认。</b>' +
        '亮回波随目标姿态闪烁（正对时强、斜一点可能弱十几 dB），声影不闪 —— ' +
        '它在几何上由目标轮廓决定，是稳定的形状特征。' +
        '<br><br><b>把 H/h 拖到接近 1</b>：影子长度发散（分母 h−H → 0），' +
        '这时目标几乎顶到 ROV 的高度，整条后面的声路都被挡住。' +
        '<br><br>本系统对目标做线段—包围盒相交测试，被挡住的海底面元<b>不产生回波</b>，' +
        '所以声影是算出来的，不是画上去的。',
      formula: '声影长度 L = R_t · H / (h − H)\n' +
        '（R_t：目标斜距　H：目标高度　h：ROV 离底高度）'
    },
    {
      id: 'tvg', period: 10, draw: drawTvg, dragX: true,
      name: '⑪ TVG：为什么是 40lg r',
      brief: '点目标 −40lg r、混响 −30lg r，两者差的那 10 dB 就是足迹变宽补偿回来的。',
      ctrls: [
        { k: 'K', l: 'TVG 系数', min: 20, max: 60, step: 1, unit: 'dB/dec', fmt: INT }
      ],
      text: '<b>点目标</b>回波按 −40lg r 衰减（双程球面扩散），' +
        '<b>海底混响</b>却只按 −30lg r 衰减 —— 因为距离越远，掠射足迹在海床上铺得越宽（∝ 1/sinθ_g），' +
        '被照亮的散射体多了 +10lg r，两者相抵。' +
        '<br><br>TVG 取 <b>40lg r</b>：点目标补偿后与距离无关（平），' +
        '混响被过补偿 +10lg r（十倍程差 10 dB，可接受）。' +
        '取 30lg r 则反过来：混响平、点目标远端变暗 10 dB/十倍程。' +
        '<b>前视声呐以探目标为第一目标，所以选 40。</b>' +
        '<br><br><b>拖 K 从 20 到 60</b>，看下面"补偿后"那两条线怎么从下倾变成上翘 —— ' +
        'K=40 时蓝线刚好水平。' +
        '<br><br>⚠ 另一个坑：<b>TVG 增益上限</b>。上限 60 dB 时 60 m 处本需 71 dB，增益被截断，' +
        '远端比近端暗 13 dB；上限提到 90 dB 后起伏降到 1.5 dB。',
      formula: '点目标：EL = SL − 40lg r + TS\n' +
        '混响：RL = SL − 30lg r + 10lg σ₀ + 10lg A_footprint\n' +
        'TVG = K·lg(r/r₀)，K = 40，上限 90 dB'
    },
    {
      id: 'eq', period: 8, draw: drawSonarEq, dragX: true,
      name: '⑫ 声呐方程全景',
      brief: '前面十一幕最终汇总成一道加减法：SL − 2TL + TS ≥ NL − DI + DT。',
      ctrls: [
        { k: 'TS', l: '目标强度 TS', min: -40, max: 0, step: 1, unit: 'dB', fmt: INT }
      ],
      text: '前面十一幕讲的每一件事，最后都要落到这道<b>加减法</b>上：' +
        '<br><br><b>SL − 2TL + TS ≥ NL − DI + DT</b>' +
        '<br><br>· <b>SL</b> 发射声源级：第 ② 幕里那个 τ 装进去的能量<br>' +
        '· <b>2TL</b> 双程传播损失：40lg r 来自第 ⑪ 幕，2αr 来自海水吸收<br>' +
        '· <b>TS</b> 目标强度：第 ⑩ 幕里那个"亮回波"有多亮<br>' +
        '· <b>NL</b> 噪声级：环境噪声 + 自噪声 + 通道电噪声 + 量化噪声<br>' +
        '· <b>DI</b> 接收指向性指数：第 ④ 幕那个孔径带来的 <b>10lgM</b><br>' +
        '· <b>DT</b> 检测阈：要在噪声背景上"看得出来"所需的信噪比' +
        '<br><br><b>拖 TS 滑块</b>看作用距离怎么变。' +
        '再把注意力放回第 ② 幕：提高中心频率能拿到更窄的波束（高 DI）和更细的分辨率，' +
        '但 α ∝ f² 的吸收会让 2αr 迅速吃掉好处 —— <b>高频是拿来换近距的分辨率的</b>。',
      formula: 'SL − 2TL + TS ≥ NL − DI + DT\n' +
        '2TL = 40 lg r + 2αr　　α ∝ f²（dB/m）\n' +
        'DI = 10 lg M　（M 个阵元的阵增益）\n' +
        'NL 含：环境噪声 + 自噪声 + 通道电噪声 + 量化噪声'
    }
  ];

  GROUPS = [
    { name: '第 1 版 · 声波怎么走（几何与信号）', ofs: 0, n: 4 },
    { name: '第 2 版 · 阵列怎么看（波束形成与成像）', ofs: 4, n: 4 },
    { name: '第 3 版 · 图像为何这样（混响 / 声影 / 方程）', ofs: 8, n: 4 }
  ];

  /* ================================================================
   * 卡片构建 / 布局
   * ================================================================ */
  function gridEl() { return document.getElementById('demoGrid'); }
  function curList() {
    /* 选「全览」时跨版一次性摆出全部 12 幕；否则只摆当前版里的前 n 幕。
       （原先写成 slice(g.ofs, g.ofs + Math.min(g.n, perPage))，
        即便 perPage=12 也被每版的 n=4 卡住，全览按钮形同虚设。） */
    if (perPage >= SCENES.length) return SCENES.slice();
    var g = GROUPS[gIdx];
    return SCENES.slice(g.ofs, g.ofs + Math.min(g.n, perPage));
  }
  function colsRows(n) {
    if (n >= 8) return [4, 3];
    if (n >= 6) return [3, 2];
    return [2, 2];
  }

  function buildCards() {
    var grid = gridEl();
    if (!grid) return;
    /* grid 本身不会被重建（只清子节点），切版时必须把"放大单幅"状态一并清掉，
       否则换版后整版只剩一张 1×1 的格子，其余幕全被 CSS 藏起来了。 */
    grid.classList.remove('one-max');
    grid.innerHTML = '';
    cards = [];
    var list = curList();
    var cr = colsRows(list.length);
    grid.style.setProperty('--dcols', cr[0]);
    grid.style.setProperty('--drows', cr[1]);
    grid.style.overflowY = (list.length > 6) ? 'auto' : 'hidden';

    list.forEach(function (sc, i) {
      var local0 = GROUPS[gIdx].ofs + i;      // 在 SCENES 中的全局序号
      var cd = {
        sc: sc, gi: local0, auto: true, p: {}, tt: (local0 * 0.13) % 1,
        el: null, cv: null, ctx2: null, w: 0, hh: 0, ctlEls: []
      };
      var box = document.createElement('div');
      box.className = 'demo-card';
      if (local0 === focus) box.classList.add('sel');

      /* 标题条 */
      var hd = document.createElement('div'); hd.className = 'demo-chd';
      var no = document.createElement('span'); no.className = 'cd-no'; no.textContent = local0 + 1;
      var ttl = document.createElement('span'); ttl.className = 'cd-tt'; ttl.textContent = sc.name;
      var mode = document.createElement('span'); mode.className = 'cd-mode'; mode.textContent = 'AUTO';
      var bAuto = document.createElement('button'); bAuto.className = 'cd-btn'; bAuto.textContent = '⟳';
      bAuto.title = '恢复自动演示';
      bAuto.onclick = function (e) {
        e.stopPropagation();
        cd.auto = true; mode.textContent = 'AUTO'; syncCtrlValues(cd); drawCard(cd);
      };
      var bMax = document.createElement('button'); bMax.className = 'cd-btn'; bMax.textContent = '⤢';
      bMax.title = '放大到整版 / 还原';
      bMax.onclick = function (e) {
        e.stopPropagation();
        var on = !box.classList.contains('max');
        cards.forEach(function (o) { o.el.classList.remove('max'); });
        box.classList.toggle('max', on);
        gridEl().classList.toggle('one-max', on);
        bMax.textContent = on ? '⤡' : '⤢';
        requestAnimationFrame(function () { D.resize(); });
      };
      hd.appendChild(no); hd.appendChild(ttl); hd.appendChild(mode);
      hd.appendChild(bAuto); hd.appendChild(bMax);
      hd.onclick = function () { setFocus(local0); };
      box.appendChild(hd);

      /* 画布 */
      var stage = document.createElement('div'); stage.className = 'demo-cstage';
      var cv = document.createElement('canvas');
      stage.appendChild(cv);
      box.appendChild(stage);
      cd.el = box; cd.cv = cv; cd.ctx2 = cv.getContext('2d'); cd.modeEl = mode;

      /* 控制条 */
      if (sc.ctrls && sc.ctrls.length) {
        var row = document.createElement('div'); row.className = 'demo-ctrls';
        sc.ctrls.forEach(function (cc) {
          var wrap = document.createElement('div'); wrap.className = 'ct';
          var lb = document.createElement('span'); lb.textContent = cc.l + ':';
          var rg = document.createElement('input');
          rg.type = 'range'; rg.min = cc.min; rg.max = cc.max; rg.step = cc.step;
          var val = document.createElement('span'); val.className = 'ctv';
          rg.oninput = function () {
            cd.p[cc.k] = parseFloat(rg.value);
            cd.auto = false; cd.modeEl.textContent = 'MANU';
            drawCard(cd);
          };
          wrap.appendChild(lb); wrap.appendChild(rg); wrap.appendChild(val);
          row.appendChild(wrap);
          cd.ctlEls.push({ c: cc, rg: rg, val: val });
        });
        box.appendChild(row);
      }

      /* 提要 */
      if (sc.brief) {
        var cap = document.createElement('div'); cap.className = 'demo-ccap';
        cap.textContent = sc.brief;
        box.appendChild(cap);
      }

      /* 画布交互：左右拖 = 第 1 个参数；drag2 = 再加纵向第 2 个参数 */
      if (sc.dragX && sc.ctrls && sc.ctrls.length) {
        var dragging = false;
        function posEv(e) {
          var r = cv.getBoundingClientRect();
          return { fx: (e.clientX - r.left) / Math.max(1, r.width), fy: (e.clientY - r.top) / Math.max(1, r.height) };
        }
        function apply(e) {
          var q = posEv(e), cc0 = sc.ctrls[0], v = cc0.min + (cc0.max - cc0.min) * Math.max(0, Math.min(1, q.fx));
          cd.p[cc0.k] = Math.round(v / cc0.step) * cc0.step;
          if (sc.drag2 && sc.ctrls[1]) {
            var cc1 = sc.ctrls[1];
            var v2 = cc1.min + (cc1.max - cc1.min) * Math.max(0, Math.min(1, 1 - q.fy));
            cd.p[cc1.k] = Math.round(v2 / cc1.step) * cc1.step;
          }
          cd.auto = false; cd.modeEl.textContent = 'MANU';
          syncCtrlValues(cd); drawCard(cd);
        }
        cv.addEventListener('mousedown', function (e) { dragging = true; apply(e); e.preventDefault(); });
        window.addEventListener('mouseup', function () { dragging = false; });
        cv.addEventListener('mousemove', function (e) { if (dragging) apply(e); });
      }

      grid.appendChild(box);
      cards.push(cd);
    });
    measureAll();
    syncCtrls();
    applyFocus();
  }

  function syncCtrlValues(cd) {
    cd.ctlEls.forEach(function (o) {
      var v = cd.p[o.c.k];
      if (v === undefined) return;
      o.rg.value = v;
      o.val.textContent = (o.c.fmt ? o.c.fmt(v) : v) + (o.c.unit || '');
    });
  }
  function syncCtrls() { cards.forEach(syncCtrlValues); }

  function measureAll() {
    cards.forEach(function (cd) {
      var host = cd.cv.parentElement;
      var w = Math.max(60, host.clientWidth), h = Math.max(40, host.clientHeight);
      if (cd.w === w && cd.hh === h) return;
      cd.w = w; cd.hh = h;
      var dp = Math.min(2, window.devicePixelRatio || 1);
      cd.cv.width = Math.round(w * dp); cd.cv.height = Math.round(h * dp);
      cd.cv.style.width = w + 'px'; cd.cv.style.height = h + 'px';
      cd.dp = dp;
    });
  }

  /** 画单幅：把模块级上下文切到它 */
  function drawCard(cd) {
    if (!cd.ctx2) return;
    ctx = cd.ctx2; W = cd.w; H = cd.hh; dpr = cd.dp || 1; t = cd.tt; CUR = cd;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    bg();
    try { cd.sc.draw(); }
    catch (e) { label(10, 18, '绘制异常：' + e.message, COL.warn, 11); }
    CUR = null;
  }
  function drawAll() { cards.forEach(drawCard); }

  function setFocus(i) {
    focus = i;
    cards.forEach(function (cd) { cd.el.classList.toggle('sel', cd.gi === i); });
    applyFocus();
  }
  function applyFocus() {
    var sc = SCENES[focus] || SCENES[0];
    if (!sc) return;
    var t1 = document.getElementById('demoTitle');
    var t2 = document.getElementById('demoText');
    var t3 = document.getElementById('demoFormula');
    if (t1) t1.textContent = sc.name;
    if (t2) t2.innerHTML = sc.text;
    if (t3) t3.textContent = sc.formula;
  }

  /* ================================================================
   * 模块接口
   * ================================================================ */
  D.init = function () {
    if (!gridEl()) return;
    refreshColors();
    if (FLS.Theme && FLS.Theme.onChange) {
      FLS.Theme.onChange(function () { refreshColors(); drawAll(); });
    }
    buildCards();
    buildGroupSel();
    setFocus(GROUPS[gIdx].ofs);
    D.play();
  };

  function buildGroupSel() {
    var s = document.getElementById('demoGroup');
    if (!s) return;
    s.innerHTML = '';
    GROUPS.forEach(function (g, i) {
      var o = document.createElement('option');
      o.value = i; o.textContent = g.name;
      s.appendChild(o);
    });
    s.value = gIdx;
    s.onchange = function () {
      gIdx = parseInt(s.value) || 0;
      focus = GROUPS[gIdx].ofs;
      buildCards(); setFocus(focus); updProg();
    };
  }
  function updProg() {
    var pr = document.getElementById('demoProgress');
    if (pr) pr.textContent = '第 ' + (gIdx + 1) + ' 版 / 共 ' + GROUPS.length +
      ' 版　本版 ' + cards.length + ' 幕';
  }

  D.resize = function () {
    if (!gridEl()) return;
    measureAll();
    drawAll();
  };

  D.render = drawAll;

  /** 定时推进所有卡片的相位并重绘 */
  function tickDemo() {
    if (!playing) return;
    var dt = lastTs ? Math.min(0.25, (Date.now() - lastTs) / 1000) : 0;
    lastTs = Date.now();
    cards.forEach(function (cd) {
      cd.tt += dt * speed / (cd.sc.period || 6);
      if (cd.tt > 1) cd.tt -= 1;
    });
    drawAll();
    syncCtrls();
    timer = setTimeout(tickDemo, FRAME_MS);
  }
  var FRAME_MS = 60;

  D.play = function () {
    if (playing) return;
    playing = true; lastTs = 0;
    if (timer) clearTimeout(timer);
    timer = setTimeout(tickDemo, FRAME_MS);
    syncPlayBtn();
  };
  D.pause = function () {
    playing = false;
    if (timer) clearTimeout(timer);
    timer = 0;
    syncPlayBtn();
  };
  D.isPlaying = function () { return playing; };
  /** 单步：所有卡片推进固定相位后停住 */
  D.step = function () {
    D.pause();
    cards.forEach(function (cd) { cd.tt += 0.05; if (cd.tt > 1) cd.tt -= 1; });
    drawAll(); syncCtrls();
  };
  D.next = function () {
    var i = focus + 1; if (i >= SCENES.length) i = 0;
    if (!SCENES.slice(GROUPS[gIdx].ofs, GROUPS[gIdx].ofs + 4).some(function (s) { return s === SCENES[i]; })) {
      gIdx = (gIdx + 1) % GROUPS.length;
      var se = document.getElementById('demoGroup'); if (se) se.value = gIdx;
      buildCards(); updProg();
    }
    setFocus(i);
  };
  D.prev = function () {
    var i = focus - 1; if (i < 0) i = SCENES.length - 1;
    if (!SCENES.slice(GROUPS[gIdx].ofs, GROUPS[gIdx].ofs + 4).some(function (s) { return s === SCENES[i]; })) {
      gIdx = (gIdx + GROUPS.length - 1) % GROUPS.length;
      var se = document.getElementById('demoGroup'); if (se) se.value = gIdx;
      buildCards(); updProg();
    }
    setFocus(i);
  };
  D.goto = D.next;
  D.scenes = SCENES;
  D.current = function () { return focus; };

  /** 自诊断：把全部幕在若干相位、若干画布尺寸下各画一遍，返回异常清单。
   *  卡片里 drawCard 会 try/catch 兜住异常（画面上只留一行红字），
   *  没有这个接口的话，某一幕画崩了在界面上是静悄悄的。回归时用：
   *      FLS.Demo.diagnose()   →  [{name,size,phase,msg}…]，空数组＝全通过 */
  D.diagnose = function () {
    var bad = [];
    var sizes = [[300, 200], [577, 317], [900, 520]];
    var phases = [0.01, 0.27, 0.5, 0.73, 0.99];
    var saveCtx = ctx, saveW = W, saveH = H, saveT = t, saveCUR = CUR;
    var cvs = document.createElement('canvas');
    var cx2 = cvs.getContext('2d');
    SCENES.forEach(function (sc) {
      var fake = { sc: sc, auto: true, p: {}, tt: 0, modeEl: null };
      sizes.forEach(function (sz) {
        cvs.width = sz[0]; cvs.height = sz[1];
        phases.forEach(function (ph) {
          fake.tt = ph;
          ctx = cx2; W = sz[0]; H = sz[1]; dpr = 1; t = ph; CUR = fake;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, W, H);
          try { bg(); sc.draw(); }
          catch (e) { bad.push({ name: sc.name, size: sz[0] + 'x' + sz[1], phase: ph, msg: String(e && e.message || e) }); }
        });
      });
      // 手动模式（参数取滑块极值）也要能画
      if (sc.ctrls && sc.ctrls.length) {
        fake.auto = false;
        sizes.forEach(function (sz) {
          cvs.width = sz[0]; cvs.height = sz[1];
          sc.ctrls.forEach(function (cc) {
            [cc.min, (cc.min + cc.max) / 2, cc.max].forEach(function (v) {
              fake.p[cc.k] = v;
              ctx = cx2; W = sz[0]; H = sz[1]; dpr = 1; t = 0.5; CUR = fake;
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              ctx.clearRect(0, 0, W, H);
              try { bg(); sc.draw(); }
              catch (e) { bad.push({ name: sc.name, size: sz[0] + 'x' + sz[1], phase: 'manu ' + cc.k + '=' + v, msg: String(e && e.message || e) }); }
            });
          });
        });
      }
    });
    ctx = saveCtx; W = saveW; H = saveH; t = saveT; CUR = saveCUR;
    return bad;
  };

  function syncPlayBtn() {
    var b = document.getElementById('dbPlay');
    if (b) b.textContent = playing ? '⏸ 暂停' : '▶ 播放';
  }

  /** 绑定演示工具条（由 80-ui.js 的 buildToolbars 调用一次） */
  D.bindBar = function () {
    var yb = q2('dbPlay'), sb = q2('dbStep');
    if (yb) yb.onclick = function () { playing ? D.pause() : D.play(); };
    if (sb) sb.onclick = function () { D.step(); };
    var sp = q2('dbSpeed'), spv = q2('dbSpeedVal');
    if (sp) {
      sp.oninput = function () {
        speed = parseFloat(sp.value) || 1;
        if (spv) spv.textContent = speed.toFixed(1) + '×';
      };
    }
    var cs = q2('demoCols');
    if (cs) {
      cs.onchange = function () {
        perPage = parseInt(cs.value) || 4;
        buildCards(); updProg();
      };
    }
    var ba = q2('dbAllAuto');
    if (ba) ba.onclick = function () {
      cards.forEach(function (cd) {
        cd.auto = true; cd.modeEl.textContent = 'AUTO'; cd.p = {};
      });
      syncCtrls(); drawAll();
    };
    var bs = q2('dbSide');
    if (bs) bs.onclick = function () {
      sideOn = !sideOn;
      var row = document.querySelector('.demo-row');
      var side = q2('demoSide');
      if (row) row.classList.toggle('no-side', !sideOn);
      /* 隐藏的是视觉栏，但无障碍树里也要同步标出来，别让读屏软件读到看不见的内容。 */
      if (side) side.setAttribute('aria-hidden', sideOn ? 'false' : 'true');
      bs.classList.toggle('on', sideOn);
      requestAnimationFrame(function () { D.resize(); });
    };
    syncPlayBtn();
    updProg();
  };
  function q2(id) { return document.getElementById(id); }
})();
