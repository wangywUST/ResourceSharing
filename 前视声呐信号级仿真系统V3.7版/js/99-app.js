/* =========================================================================
 * 99-app.js —— 主应用控制器（模块串联 / 仿真主循环 / Worker 并行 / 结果呈现 / 导出）
 * -------------------------------------------------------------------------
 *  核心职责：把「时域发射 → 声场传播 → 面元散射 → 阵元级独立时域采样 →
 *            预处理（滤波/脉压/TVG）→ 波束形成 → 扇形成像」这条链路真正跑起来。
 *
 *  设计要点：
 *   1) 仿真内核（40-engine.js）是自包含的纯函数工厂，既可在主线程运行，
 *      也可通过 Blob 注入到 WebWorker 中后台运行（以函数源码字符串搬运，
 *      因此 file:// 本地离线打开也无需额外请求 JS 文件）。
 *   2) 主线程只负责：场景/参数 → 组装 Job → 提交 → 接收结果 → 显示与交互。
 *      成像永远来自内核输出的幅值矩阵，绝不做图像级直接渲染。
 *   3) ROV 运动仅在「已启动且未暂停」时推进（暂停即冻结，键盘不生效）。
 *   4) 坐标系统一为 ENU（东 E / 北 N / 天 U），海面 U=0，深度 = −U。
 * ========================================================================= */
(function () {
  /* V2.2：此处原本还解构了 `I = FLS.I`（双语字典）。中英切换整体删除后 FLS.I 已不存在，
   * 界面文案直接在调用处写中文常量，所以这里只剩 U / DEG 两个工具。 */
  var U = FLS.U, DEG = U.DEG;
  var app = {};
  FLS.app = app;

  /* ------------------------------------------------------------------ 内部状态 */
  var worker = null;             // 第 0 个后台线程（导出等场合使用；无后台则为 null）
  var workers = [];              // V2.2：后台内核线程池
  var workerBusy = [];           // 与 workers 一一对应的忙标志
  var lastShownId = 0;           // 已显示的最新帧序号（并行回包时用于丢弃迟到帧）
  var jobSeq = 0;                // Job 序号
  var lastFrameT = 0;            // 上一帧时间戳（ms）
  var pingAcc = 0;               // PRP 时间累加器（s）
  var fpsAcc = 0, fpsCnt = 0, fpsVal = 0;
  var cache = {};                // 波形 / 匹配核 / 通道失配 / TVG / FIR 缓存
  /* ★ V3.6：非相干积分改为**滑动窗**，所以这里是环形缓冲而不是单个 acc。
     结构 {ring:[帧功率…], head, cnt, acc, n, method, nBeam, nBin}；
     n 或算法一变就整个重建，避免把旧算法的帧混进新算法的平均里。 */
  var integ = null;
  var pendingExport = null;      // 导出全部阵元时的回调

  function q(id) { return document.getElementById(id); }
  function P(k) { return FLS.P[k]; }

  /* ==================================================================
   * 一、仿真内核通道：WebWorker 优先，失败降级主线程
   * ================================================================== */
  /**
   * 用 Blob 构造 Worker：把内核工厂函数源码直接注入。
   * 这样做的好处是 file:// 打开时不需要额外加载 js 文件（Chrome 对
   * file:// 下的 new Worker('xx.js') 有跨域限制，而 Blob URL 可以绕过）。
   */
  function buildWorker() {
    try {
      var factorySrc = FLS.EngineFactory.toString();
      var code0 = [
        'var FLSX = (' + factorySrc + ')();',
        'self.onmessage = function (e) {',
        '  var d = e.data;',
        '  if (d.cmd === "reset") { FLSX.reset(); self.postMessage({ id: d.id, ok: true }); return; }',
        '  var t0 = (self.performance && performance.now) ? performance.now() : Date.now();',
        '  var r;',
        '  try { r = FLSX.runPing(d.job); }',
        '  catch (ex) { self.postMessage({ id: d.id, error: String(ex && ex.message || ex) }); return; }',
        '  var t1 = (self.performance && performance.now) ? performance.now() : Date.now();',
        '  var tr = [];',
        '  if (r.img) tr.push(r.img.buffer);',
        '  if (r.nf) tr.push(r.nf.buffer);',
        '  if (r.chPre) tr.push(r.chPre.buffer);',
        '  if (r.chPost) tr.push(r.chPost.buffer);',
        '  if (r.beamTS) tr.push(r.beamTS.buffer);',
        '  if (r.allPre) tr.push(r.allPre.buffer);',
        '  if (r.allPost) tr.push(r.allPost.buffer);',
        '  self.postMessage({ id: d.id, res: r, wall: t1 - t0 }, tr);',
        '};'
      ].join('\n');
      /* ★ V2.2：改为**多 worker 池**。
         单帧仿真约 0.8~1.1 s（默认 64 阵元 × 1.8 万面元 × 181×256 波束栅格），
         而 V2.1 只开一个后台线程：它算完之前，主循环按 PRP 提交的后续脉冲
         全部被 "workerBusy → return" 丢弃，多核机器的其余核心一直空转，
         实测吞吐被钉死在 0.3 fps。
         每个脉冲彼此独立（各自携带提交瞬间的位姿与面元快照），天然可并行，
         因此按硬件并发数开 N 个线程轮转提交即可，吞吐近似 ×N。
         上限取 4：再多会因各自持有 3 MB 级工作数组而吃掉过多内存，
         且帧序错乱概率上升（见 onResult 的过期帧丢弃）。 */
      var n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
      for (var wi = 0; wi < n; wi++) {
        var w = makeWorker(code0);
        if (!w) break;
        workers.push(w); workerBusy.push(false);
      }
      if (!workers.length) return null;
      worker = workers[0];              // 兼容既有单线程语义（导出等走第 0 个）
      return worker;
    } catch (ex) {
      FLS.warn('无法创建后台仿真线程（' + ex.message + '），已降级为主线程计算。');
      return null;
    }
  }

  /** 创建一个后台内核线程；idx 用于在回包时释放对应的忙标志 */
  function makeWorker(codeStr) {
    try {
      var blob = new Blob([codeStr], { type: 'application/javascript' });
      var url = URL.createObjectURL(blob);
      var w = new Worker(url);
      var idx = workers.length;         // 闭包捕获：回包时知道该放谁
      w.onmessage = function (e) { onWorkerMessage(e.data, idx); };
      w.onerror = function (ev) {
        FLS.warn('后台仿真线程异常，已降级为主线程计算：' + (ev.message || ''));
        workers.length = 0; workerBusy.length = 0;
        worker = null; FLS.state.workerReady = false;
        q('engineMode').textContent = "内核: " + "主线程";
      };
      return w;
    } catch (ex) { return null; }
  }

  function onWorkerMessage(d, idx) {
    if (idx >= 0 && idx < workerBusy.length) workerBusy[idx] = false;
    if (d && d.error) { FLS.err('仿真内核错误：' + d.error); return; }
    if (!d || !d.res) return;
    if (pendingExport && d.id === pendingExport.id) {
      var cb = pendingExport.cb; pendingExport = null; cb(d.res);
      return;
    }
    /* 并行后回包顺序不再等于提交顺序：后提交的脉冲可能先算完。
       若它的序号早于已显示的最新帧，说明这是一帧"迟到"的旧数据，
       直接丢弃 —— 否则帧号会回退、非相干积分会混入过期回波。 */
    if (d.id < lastShownId) return;
    lastShownId = d.id;
    onResult(d.res, d.wall);
  }

  /** 复位后台内核（BP 后向投影的非相干累加器等）。
      池内**每个**线程都要发：只发一个的话，其余线程里残留的累积帧数会让
      换算法后各帧亮度不一致（表现为图像忽明忽暗）。 */
  function resetEngine() {
    if (workers.length) {
      for (var ri = 0; ri < workers.length; ri++) workers[ri].postMessage({ cmd: 'reset', id: ++jobSeq });
    } else FLS.engineMain.reset();
  }

  /** 提交一次脉冲仿真（retAll 为真时用于导出全部阵元数据） */
  function submit(job, cb) {
    if (!workers.length) {                      // 降级：主线程同步计算
      var t0 = FLS.now();
      var res = FLS.engineMain.runPing(job);
      var t1 = FLS.now();
      if (job.retAll && cb) cb(res); else onResult(res, t1 - t0);
      return;
    }
    if (job.retAll) {                           // 导出：走第 0 个（独占、不参与轮转）
      var id = ++jobSeq;
      pendingExport = { id: id, cb: cb };
      workers[0].postMessage({ id: id, job: job });
      return;
    }
    for (var i = 0; i < workers.length; i++) {
      if (!workerBusy[i]) {
        workerBusy[i] = true;
        job.id = ++jobSeq;
        workers[i].postMessage({ id: job.id, job: job });
        return;
      }
    }
    // 全部后台线程都在忙：丢弃本脉冲（保证三维交互流畅）
  }

  /* ==================================================================
   * 二、声呐几何：阵元世界坐标（ENU）/ 本体三轴
   * ================================================================== */
  /**
   * 一维均匀线阵（ULA）各阵元在 ENU 下的世界坐标（返回 [e,n,u,…]）。
   * V1.1 起本系统定位为「一维水平线阵前视声呐」：阵元沿载体右舷方向（本体 x 轴）
   * 等间隔排列，孔径中心与载体位姿原点重合，只做方位维（水平）波束形成；
   * 垂直维不形成波束，覆盖由 tx.vbeam 与 rx.vOpen 的指向性决定。
   */
  function buildElements(pose, axes) {
    var P = FLS.P;
    var M = Math.max(1, P['rx.nElem'] | 0);
    var d = P['rx.spacing'] / 1000;                 // mm → m
    var arr = new Float64Array(M * 3);
    var r = axes.right;
    for (var i = 0; i < M; i++) {
      var s1 = (i - (M - 1) / 2) * d;               // 沿右舷方向的偏移
      arr[3 * i] = pose.x + r[0] * s1;
      arr[3 * i + 1] = pose.y + r[1] * s1;
      arr[3 * i + 2] = pose.z + r[2] * s1;
    }
    return arr;
  }

  /** 阵元数（一维线阵即 rx.nElem） */
  function elemCount() {
    return Math.max(1, FLS.P['rx.nElem'] | 0);
  }

  /* ==================================================================
   * 三、链路前级：发射波形 / 匹配核 / 通道失配 / TVG / 带通核
   * ================================================================== */
  /** 基带采样率与采样窗：fs_bb ≥ 2.5·B（整数抽取），窗长覆盖 2R/c + T */
  function samplePlan() {
    var fc = P('tx.fc') * 1000, bw = P('tx.bw') * 1000, fs = P('rx.fs') * 1000;
    var prp = P('tx.prp') / 1000, T = P('tx.pulse') / 1000;
    var c = FLS.Env.profileAt(FLS.state.rov.z);
    var K = Math.max(1, Math.floor(fs / (2.5 * bw)));     // 抽取因子
    var fsbb = fs / K;
    var rUnamb = c * prp / 2;                              // 不模糊距离
    var rWin = Math.min(P('alg.rmax'), rUnamb * 0.98);     // 有效成像距离
    var nsamp = Math.ceil((2 * rWin / c + T) * fsbb) + 16;
    nsamp = U.clamp(nsamp, 64, 1 << 18);
    return { fc: fc, bw: bw, fs: fs, fsbb: fsbb, K: K, nsamp: nsamp, c: c, rWin: rWin, rUnamb: rUnamb, T: T };
  }

  /**
   * 发射复基带波形 b(t)。
   * 注意：内核的回波合成是「信道冲激响应 ⊗ 发射波形」，因此这里传入的是
   * 原始波形（长度 = 脉宽×fs_bb，起点即发射时刻 t=0），发射时延通过采样窗
   * 起点 tStart = −delay 体现（等价于把整段回波在采样窗内右移）。
   */
  function buildTx(sp) {
    var key = ['tx', P('tx.type'), P('tx.bw'), P('tx.pulse'), P('tx.win'), P('tx.taylorSll'), sp.fsbb].join('|');
    if (cache.tx && cache.tx.key === key) return cache.tx;
    var tx = FLS.Sig.genTx({
      type: P('tx.type'), bw: sp.bw, T: sp.T, fs: sp.fsbb,
      win: P('tx.win'), sll: P('tx.taylorSll'), fc: sp.fc, seed: 20241022
    });
    cache.tx = { key: key, re: tx.re, im: tx.im, n: tx.n, raw: tx };
    return cache.tx;
  }

  /** 匹配滤波核 h(t)=b*(−t)，能量归一（峰值=回波幅度，噪声功率×1/E 即脉压增益） */
  function buildKernel(tx) {
    var key = ['mf', P('rx.mf'), P('rx.mfWin'), P('tx.taylorSll'), cache.tx && cache.tx.key].join('|');
    if (cache.mf && cache.mf.key === key) return cache.mf;
    var k = FLS.Sig.matchedKernel(tx.raw, P('rx.mfWin'), P('tx.taylorSll'));
    cache.mf = { key: key, re: k.re, im: k.im, n: k.n };
    return cache.mf;
  }

  /** 通道失配（幅度 dB / 相位 °，RMS）+ 失效阵元。硬件特性，帧间保持不变 */
  function buildChan(M) {
    var failList = U.parseNumList(P('rx.fail')).map(function (v) { return Math.round(v); });
    var key = ['ch', M, P('rx.mismatch'), P('rx.ampErr'), P('rx.phaseErr'), failList.join(',')].join('|');
    if (cache.chan && cache.chan.key === key) return cache.chan;
    var amp = new Float32Array(M), ph = new Float32Array(M);
    var rnd = U.rng(987654321);
    var on = !!P('rx.mismatch'), ae = P('rx.ampErr'), pe = P('rx.phaseErr');
    for (var m = 0; m < M; m++) {
      var a = on ? U.db2lin(U.gauss(rnd) * ae) : 1;
      var p = on ? (U.gauss(rnd) * pe) * DEG : 0;
      amp[m] = a; ph[m] = p;
    }
    failList.forEach(function (i) { if (i >= 0 && i < M) amp[i] = 0; });
    cache.chan = { key: key, amp: amp, ph: ph, fail: failList };
    return cache.chan;
  }

  /** TVG 增益曲线（线性域，长度 nsamp）：自动 g(r)=K·lg(r/r0) / 手动插值 / 关闭 */
  function buildTvg(sp) {
    var key = ['tvg', P('rx.tvg'), P('rx.tvgCoef'), P('rx.tvgMax'), P('rx.tvgCurve'), sp.nsamp, sp.fsbb, sp.c].join('|');
    if (cache.tvg && cache.tvg.key === key) return cache.tvg;
    var n = sp.nsamp, g = new Float32Array(n), i, r, gdb;
    var mode = P('rx.tvg');
    var xs = null, ys = null;
    if (mode === 'manual') {
      var pts = [], segs = String(P('rx.tvgCurve')).split(/[;；]/);
      segs.forEach(function (s) {
        var v = s.split(/[,，\s]+/).map(parseFloat).filter(function (x) { return !isNaN(x); });
        if (v.length >= 2) pts.push([v[0], v[1]]);
      });
      pts.sort(function (a, b) { return a[0] - b[0]; });
      xs = pts.map(function (p) { return p[0]; }); ys = pts.map(function (p) { return p[1]; });
    }
    var K = P('rx.tvgCoef'), gmax = P('rx.tvgMax'), r0 = 1;
    for (i = 0; i < n; i++) {
      r = (i / sp.fsbb) * sp.c / 2;                      // 双程时间 → 单程距离
      if (mode === 'auto') gdb = U.clamp(K * Math.log10(Math.max(r0, r) / r0), 0, gmax);
      else if (mode === 'manual' && xs && xs.length) gdb = U.clamp(U.interp1(xs, ys, r), 0, gmax);
      else gdb = 0;
      g[i] = U.db2lin(gdb);
    }
    cache.tvg = { key: key, g: g };
    return cache.tvg;
  }

  /** 接收带通（基带等效低通）FIR 核：截止 = 通带半带宽 */
  /**
   * 接收带通滤波器（★ V3.4 重写：射频通带 → 复基带通带的**真映射**）。
   *
   * 旧实现的错误：它只取 |fHi − fLo| 当带宽、无条件做**零频低通**，
   * 于是通带中心在哪儿完全不起作用 —— 把 180/220 kHz 改成 300/340 kHz
   * （宽度同为 40 kHz）图像一动不动，是典型的空改。更糟的是默认 180/220 kHz
   * 本来就不含 400 kHz 的信号，却因为"宽度巧合"一直看着没问题。
   *
   * 正确的映射：射频 [fLo, fHi] 解调到基带后是 [fLo − fc, fHi − fc]，即
   *     中心 f_m = (fLo + fHi)/2 − fc      带宽 B_p = fHi − fLo
   * 复基带信号在负频率上也有内容（LFM 占 ±B/2），所以这是一个**复带通**，
   * 不能当成零频低通处理。实现为「下变频 → 低通 → 上变频」三步合一：
   *      H[k] = h_lp[k] · e^{ j2π f_m (k − m_h) / f_s,bb }
   * （推导：y[n] = Σ_k h[k]·x[n−k+m_h]·e^{−j2πf_m(n−k+m_h)/f_s}·e^{+j2πf_m n/f_s}）
   * f_m = 0 时 H = h_lp，退回原来的低通 —— 默认工况（fc±B/2）正是这一支。
   *
   * 边界：
   *   · 通带与基带可表示范围 [−f_s,bb/2, +f_s,bb/2] 求交，避免混叠；
   *   · 交集为空 → 返回 null（等效于"全滤掉"，图像只剩噪底），
   *     界面上由 derive 的告警提前说明原因。
   */
  function buildFir(sp) {
    var key = ['fir', P('rx.bpOn'), P('rx.bpAuto'), P('rx.bpLo'), P('rx.bpHi'), sp.fc, sp.bw, sp.fsbb].join('|');
    if (cache.fir && cache.fir.key === key) return cache.fir;
    var h = null, hI = null, info = { on: false };
    if (P('rx.bpOn')) {
      var fLo, fHi;
      if (P('rx.bpAuto')) { fLo = sp.fc - sp.bw / 2; fHi = sp.fc + sp.bw / 2; }
      else { fLo = parseFloat(P('rx.bpLo')) * 1000; fHi = parseFloat(P('rx.bpHi')) * 1000;
             if (!isFinite(fLo)) fLo = sp.fc - sp.bw / 2; if (!isFinite(fHi)) fHi = sp.fc + sp.bw / 2; }
      if (fLo > fHi) { var _t = fLo; fLo = fHi; fHi = _t; }
      // 射频 → 基带
      var b1 = fLo - sp.fc, b2 = fHi - sp.fc;
      var nyq = sp.fsbb / 2;
      // 与基带可表示范围求交（越界部分会混叠，必须切掉）
      b1 = Math.max(b1, -nyq * 0.98); b2 = Math.min(b2, nyq * 0.98);
      if (b2 - b1 > 1) {
        var fm = 0.5 * (b1 + b2);                // 基带通带中心 Hz
        var fcut = 0.5 * (b2 - b1);              // 半带宽 Hz
        fcut = Math.min(fcut, sp.fsbb * 0.45);
        var nt = U.clamp(Math.round(4 * sp.fsbb / Math.max(1, fcut)) | 1, 9, 129) | 1;
        h = FLS.Sig.lowpassKernel(fcut, sp.fsbb, nt);
        if (h && Math.abs(fm) > 1) {
          /* 复系数核：把"下变频 + 上变频"两步折进低通核，引擎只需做一次复卷积 */
          hI = new Float32Array(h.length);
          var mh = (h.length - 1) / 2;
          for (var ki = 0; ki < h.length; ki++) {
            var th = 2 * Math.PI * fm * (ki - mh) / sp.fsbb;
            var crc = Math.cos(th), srs = Math.sin(th);
            hI[ki] = h[ki] * srs; h[ki] = h[ki] * crc;
          }
        }
        info = { on: true, fLo: fLo / 1000, fHi: fHi / 1000, fm: fm / 1000, fcut: fcut / 1000, nt: h ? h.length : 0 };
      } else {
        /* 通带与基带可表示范围**无交集**：说明这一段射频在复基带里根本不存在，
         * 信号一点都过不去。必须返回"全阻"而不是"不滤波" —— 后者会把整段
         * 回波原样放行，比设错通带还离谱（用户看不出自己设错了）。 */
        info = { on: true, mute: true, fLo: fLo / 1000, fHi: fHi / 1000 };
      }
    }
    cache.fir = { key: key, h: h, hI: hI, info: info, mute: !!(info.mute) };
    return cache.fir;
  }

  /** 声速剖面表（用于内核 cAt 插值）：z0=0（海面），dz=−1 m（向下） */
  function buildSsp() {
    /* ★ V3.2：海底深度只有一个出处（terr.base），声速剖面的深度范围由它决定。
     * 再留 40 m 余量：最深的沟壑/台地可能低于基准面几十米，剖面短了会让
     * 深部声速被外插成常数（层析等效声速随之失真）。 */
    var deep = parseFloat(FLS.P['terr.base']) || 200;
    deep = Math.max(deep + 40, Math.abs(FLS.state.rov.z) + 20, 60);
    var n = Math.min(4000, Math.ceil(deep) + 40);
    var c = new Float32Array(n);
    for (var i = 0; i < n; i++) c[i] = FLS.Env.profileAt(-i);
    return { z0: 0, dz: -1, n: n, c: c };
  }

  /** 阵元幅度加权（旁瓣抑制窗） */
  function buildShade(M) {
    if (!P('alg.sll')) { var o = new Float32Array(M); o.fill(1); return o; }
    return FLS.Win(P('alg.shade'), M, 30);
  }

  /* ==================================================================
   * 四、组装一帧的仿真 Job（完整时域链路输入）
   * ================================================================== */
  function buildJob(opt) {
    opt = opt || {};
    var st = FLS.state;
    var pose = st.rov;
    /* ★ V2.2：组装 job 一律用**声呐**本体轴，而不是 ROV 本体轴。
       声呐由基座刚性固定在 ROV 上、带一个常值安装俯仰角 rov.tilt，
       于是它的艏向 / 天向 = ROV 本体 ⊕ 安装角（见 scene3d.sonarAxes）。
       用这套轴之后：
         ① 阵元沿声呐右舷排列（俯仰安装角不改变右舷轴，故阵元位置不变）；
         ② 波束形成的参考平面（job.fwd / up）随安装角一起倾斜，
            成像平面被压向 / 抬离海底 —— 与三维里看到的淡蓝扇面完全一致；
         ③ 散射面元按声呐照亮范围抽取（scatCtx.pose 同步），
            不会再出现"三维里扇面朝下、图像却按水平面算"这种两处打架。 */
    var axes = FLS.scene3d.sonarAxes(pose);
    /* ★ V3.3：另取一套轴（含安装俯仰、**不含**成像俯仰）专供面元布设与波束形成定位。
     *
     * 为什么需要两套轴：本机是**一维水平线阵**，阵元沿右舷排开、间隔 λ/2。
     * 绕右舷轴旋转不改变阵元位置，也不改变来波方向在阵轴上的投影 ——
     * 也就是说这种旋转对接收波束形成没有影响，它只旋转"看向哪里"的权重
     * （发射波束与阵元指向性）。而海底面元躺在真实海底上，不会因为把头低下去
     * 就整体平移。实测把面元也一起转，会让每个面元的"等斜距解"错开约 0.1 m、
     * 与距离门错开 1/3 个单元，图像被散焦压暗 40%（总回波幅度 Σ|A| 反而升 24%）。
     * 因此：指向性用 axes（含俯仰），面元与聚焦用 axesB（不含俯仰）。
     */
    var axesB = FLS.scene3d.sonarAxes(pose, true);
    var sp = samplePlan();
    var tx = buildTx(sp);
    var ker = buildKernel(tx);
    var M = elemCount();
    var elem = buildElements(pose, axes);
    var chan = buildChan(M);
    var tvg = buildTvg(sp);
    var fir = buildFir(sp);
    var ssp = buildSsp();

    // 海底反射系数：取首个地形的底质（V3.0：地形不再有隐藏态，直接取第 0 份）
    var bmat = (st.terrains[0] && st.terrains[0].bmat) || 'sand';
    // 海面粗糙散射参数：k·h_rms（h_rms = 0.5·roughness）
    var lam = sp.c / sp.fc;
    var surfKH = (2 * Math.PI / lam) * (0.5 * P('env.surfRough'));

    // 噪声：环境（Knudsen）+ 自噪声 + 通道电噪声 + 量化噪声 → 复基带每维标准差
    var np = FLS.Env.noisePower(sp.fc, sp.bw, sp.fsbb, P('tx.sl'));
    var noiseSig = Math.sqrt(Math.max(0, np.P) / 2);

    // 吸收：α(dB/km) → 幅度域 Np/m
    var alpha = (P('env.absorb') === 'none') ? 0
      : ((P('env.absorb') === 'manual') ? P('env.alphaManual') : FLS.Env.thorp(sp.fc / 1000));
    var kAbs = alpha * Math.LN10 / 20 / 1000;

    // 散射面元（海底混响 + 目标），需先刷新世界矩阵供面元抽取
    if (FLS.scene3d.scene) FLS.scene3d.scene.updateMatrixWorld(true);
    /* V1.4：海底面元数量不再由「预算」决定，而由几何（被照亮的区间）决定，
     * 质量档改为控制**分辨单元的粗细**（cellStride = 几个波束/距离单元合成一个面元）：
     *   fast  → 4（单元粗、散斑颗粒大、最快）
     *   balanced → 2
     *   high  → 1（每个波束×每个距离单元一个独立散射体，散斑最细，最接近真实图像）
     * 这样改「质量」不会再改变图像亮度 —— 只改变散斑细度与耗时，物理上更干净。 */
    var cellStride = ({ high: 1, balanced: 2, fast: 4 })[st.quality || 'balanced'] || 2;
    var scatCtx = {
      cellStride: cellStride, seed: 1337 + st.pingIndex * 13,
      pose: { pos: [pose.x, pose.y, pose.z], fwd: axesB.fwd, right: axesB.right, up: axesB.up }
    };
    var sc = FLS.Scatter.build(scatCtx);
    if (FLS.state.display.scatter) FLS.scene3d.setScatterers(sc.arr, sc.nAll || sc.arr.length / 11);

    var nBeam = Math.max(2, P('alg.nBeam') | 0), nBin = Math.max(8, P('alg.nBin') | 0);
    var job = {
      M: M, nsamp: sp.nsamp, fsbb: sp.fsbb, fc: sp.fc, bw: sp.bw,
      scat: sc.arr, elem: elem, txPos: [pose.x, pose.y, pose.z],
      fwd: axes.fwd, right: axes.right, up: axes.up,
      fwdB: axesB.fwd,
      tStart: -P('tx.delay') * 1e-6,               // 采样窗起点（负时延 = 发射触发滞后）
      kAbs: kAbs,
      txRe: tx.re, txIm: tx.im, txN: tx.n,
      txH: P('tx.hbeam') * DEG / 2, txV: P('tx.vbeam') * DEG / 2,
      elH: P('rx.hOpen') * DEG / 2, elV: P('rx.vOpen') * DEG / 2,
      surfR0: P('env.surfOn') ? P('env.surfRefl') : 0,
      surfKH: surfKH,
      botR: FLS.Env.bottomRefl(bmat),
      ssp: ssp,
      srcAmp: U.db2lin(P('tx.sl') + P('tx.gain')),   // μPa @1 m
      chanAmp: chan.amp, chanPhase: chan.ph,
      noiseSig: noiseSig,
      seed: 24680, frame: st.pingIndex,
      firH: fir.h, firHI: fir.hI, firMute: !!fir.mute,
      useMF: !!P('rx.mf'),
      kerRe: ker.re, kerIm: ker.im,
      tvg: tvg.g,
      retChan: (opt.retAll || opt.noChan) ? -1 : U.clamp(parseInt(q('chanSel').value, 10) || 0, 0, M - 1),
      retBeam: (opt.retAll || opt.noChan) ? -1 : Math.floor(nBeam / 2),
      retAll: !!opt.retAll,
      beam: {
        method: P('alg.method'), nBeam: nBeam, nBin: nBin,
        rmin: P('alg.rmin'), rmax: Math.min(P('alg.rmax'), sp.rWin),
        sector: P('alg.sector'),
        /* ★ V3.3：alg.tilt 已经并进 sonarAxes（见 60-scene3d）随整机俯仰一起旋转，
           面元抽取与波束参考平面都跟着走。这里若再传一次就是转了两次，
           而且一维水平线阵在俯仰方向本来就没有可操纵的自由度。 */
        tilt: 0,
        shade: buildShade(M),
        dl: P('alg.dl'), smooth: !!P('alg.smooth'),
        subLen: P('alg.subLen'), nulls: U.parseNumList(P('alg.nulls')),
        nsrc: P('alg.nsrc'), gamma: P('alg.gamma'), acwP: P('alg.acwP'),
        /* ★ V3.6：自适应参与阵元上限（0 = 全阵）与 LCMV 辅助约束类型 */
        adapM: P('alg.adapM'), nullMode: P('alg.nullMode')
      },
      meta: { nSurf: sc.nSurf, nTarget: sc.nTarget, plan: sp, lam: lam, np: np }
    };
    return job;
  }

  /* ==================================================================
   * 五、结果处理：非相干积分 → 显示映射 → 扇形渲染 → 指标 / 信号面板
   * ================================================================== */
  function onResult(res, wall) {
    var st = FLS.state;
    st.pingIndex++;
    st.last = res;
    st.lastWall = wall || 0;

    var nBeam = res.diag.nBeam, nBin = res.diag.nBin;
    var nInteg = Math.max(1, P('alg.integ') | 0);

    // —— 非相干积分（多帧功率平均，抑制混响起伏 Speckle）——
    /* ★ V3.6：这里原来是一个**真 bug**。
       旧写法只做"累加"从不做"减去"，同时 cnt 被 min(nInteg, cnt+1) 钳住：
           acc ← acc + p_k（每帧都加，永不减去）
           cnt ← min(nInteg, cnt+1)
           imgDisp = sqrt(acc / cnt)
       于是跑过 N 帧之后 acc 是**全部 N 帧**的功率和，而 cnt 仍停在 nInteg：
           imgDisp = sqrt( Σ_{k≤N} p_k / nInteg ) ∝ sqrt(N/nInteg)
       —— 图像亮度按 √(帧数/nInteg) **无界增长**。实测 integ=4 跑 8 帧，
       整幅均值涨到 1.414 倍（正好 √(8/4)）；跑到 100 帧就是 5 倍。
       显示是自动归一化的，所以肉眼看不出来，但"峰值""信噪比"读数一直在漂，
       手动显示模式下则会一路饱和成纯白。
       现在改成真正的**滑动窗**：环形缓冲存最近 nInteg 帧，逐帧加新减旧。 */
    if (nInteg > 1 && P('alg.method') !== 'bp') {
      var mthNow = P('alg.method');
      if (!integ || integ.nBeam !== nBeam || integ.nBin !== nBin || integ.n !== nInteg ||
        integ.method !== mthNow) {
        integ = {
          ring: [], n: nInteg, cnt: 0, head: 0, method: mthNow,
          acc: new Float32Array(nBeam * nBin), nBeam: nBeam, nBin: nBin
        };
      }
      var N2 = res.img.length;
      if (!integ.ring.length) for (var q0 = 0; q0 < nInteg; q0++) integ.ring.push(new Float32Array(N2));
      var slot = integ.ring[integ.head];
      if (integ.cnt >= nInteg) {                     // 满了：先把最旧那一帧减掉
        for (var i = 0; i < N2; i++) integ.acc[i] -= slot[i] * slot[i];
      } else {
        integ.cnt++;
      }
      for (i = 0; i < N2; i++) { slot[i] = res.img[i]; integ.acc[i] += slot[i] * slot[i]; }
      integ.head = (integ.head + 1) % nInteg;
      var sc = 1 / Math.max(1, integ.cnt);
      res.imgDisp = new Float32Array(N2);
      for (i = 0; i < N2; i++) res.imgDisp[i] = Math.sqrt(integ.acc[i] > 0 ? integ.acc[i] * sc : 0);
    } else {
      /* 关掉积分 / 切到 BP 时把缓冲清掉：下次再开必须从头积累，
         否则会把若干帧之前、甚至别的算法留下的旧数据混进来。 */
      integ = null;
      res.imgDisp = res.img;
    }

    // —— 显示域多视平均（V1.2）：抑制斑点噪声，仅在渲染路径生效 ——
    //    res.imgDisp 保持单视原样，updateMetrics 的峰值/信噪比仍按单视统计。
    var mk = P('disp.mlook') | 0;
    res.imgView = (mk > 1) ? FLS.Imaging.mlook(res.imgDisp, nBeam, nBin, mk) : res.imgDisp;
    /* ★ V3.3：先判定"本帧受什么限制"，再渲染（结果写进 res.limit / st.lastLimit）。 */
    res.limit = computeLimit(res);

    // —— 显示量映射 ——
    var mode = q('sonarView') ? q('sonarView').value : 'amp';
    var db = toDisplay(res, mode);
    res.db = db;

    // —— 动态范围 ——
    var lo, hi;
    if (P('disp.auto')) {
      var rg = FLS.Imaging.autoRange(db, P('disp.autoHi'));
      lo = rg.lo; hi = rg.hi;
    } else { lo = P('disp.dynLo'); hi = P('disp.dynHi'); }
    res.lo = lo; res.hi = hi;

    if (!st.freeze) {
      FLS.Imaging.render(db, nBeam, nBin, P('alg.sector'), lo, hi, P('disp.cmap'));
      var ftg = "帧" + ' ' + st.pingIndex;
      var st1 = q('sonarFrameTag'); if (st1) st1.textContent = ftg;
      var st2 = q('frameTag'); if (st2) st2.textContent = ftg;
    }
    updateMetrics(res, wall);
    drawSignal(res);
    updateHud(res);
  }

  /* ==================================================================
   * ★ V3.3：本帧"受什么限制" —— 混响 / 噪声 / 量化
   * ------------------------------------------------------------------
   * 为什么需要这个：V3.3 之前的接收页上，改「灵敏度」「前置增益」「采样位数」
   * 图像几乎不动，用户会认为这些是空改。真相是：默认工况（SL=210 dB、
   * 30 kHz 带宽、60 m 量程）下海床混响比接收机噪底高 20 dB 以上，
   * 于是**噪底怎么动都淹在混响里**。这是物理，不是软件偷懒。
   * 与其在帮助里写一段话，不如把判据算出来当场显示：
   *   取扇面中部 60% 波束 × 40%~90% 距离上的 (幅值² / 噪声功率) 中位数，
   *   ≥20 dB 判"混响受限"，6~20 dB 过渡，<6 dB 判"噪声受限"；
   *   量化噪声占接收噪底 >30% 时直接判"量化受限"。
   * 这样用户把 SL 降到 170 dB（或把量程推到 80 m）之后，
   * 指示器会自己翻成"噪声受限"，此后灵敏度/增益/位数就是主控参数了。
   * ================================================================== */
  var limScr = new Float32Array(0);
  function computeLimit(res) {
    var d = res.diag, nB = d.nBeam, nBin = d.nBin, img = res.imgDisp || res.img, nf = res.nf;
    if (!nf || !nf.length || !img) return null;
    var b0 = Math.floor(nB * 0.2), b1 = Math.ceil(nB * 0.8);
    var r0 = Math.floor(nBin * 0.4), r1 = Math.ceil(nBin * 0.9);
    var n = 0, b, r, i;
    var need = (b1 - b0) * (r1 - r0);
    if (limScr.length < need) limScr = new Float32Array(need + 1024);
    for (b = b0; b < b1; b++) {
      for (r = r0; r < r1; r++) {
        var v = img[b * nBin + r], p = nf[r];
        if (!(p > 0) || !(v > 0)) continue;
        limScr[n++] = v * v / p;
      }
    }
    if (!n) return null;
    var arr = limScr.subarray(0, n);
    var sorted = Array.prototype.slice.call(arr).sort(function (a, b2) { return a - b2; });
    var med = sorted[n >> 1];
    var snrMed = 10 * Math.log10(Math.max(1e-30, med));
    var np = res.meta && res.meta.np;
    var qShare = (np && np.frac) ? np.frac.quant : 0;
    var tag = (qShare > 0.3) ? 'quant' : (snrMed >= 20 ? 'reverb' : (snrMed >= 6 ? 'mix' : 'noise'));
    return { snrMed: snrMed, tag: tag, quantShare: qShare, chanShare: (np && np.frac) ? np.frac.chan : 0 };
  }

  /** 显示量：amp（TVG 后幅值 dB）/ snr（相对噪声）/ ei（回波级，去除 TVG 后 dB re 1μPa） */  function toDisplay(res, mode) {
    var img = res.imgView || res.imgDisp || res.img;
    var nBin = res.diag.nBin, out = new Float32Array(img.length), i, bin;
    if (mode === 'snr') {
      for (i = 0; i < img.length; i++) {
        bin = i % nBin;
        out[i] = U.pow2db(img[i] * img[i] / Math.max(1e-30, res.nf[bin]));
      }
    } else if (mode === 'ei') {
      // 回波级 EL = 20lg(幅值) − TVG 增益(dB)，恢复为传播后的真实声压级
      var tg = FLS.app._tvgDb || null;
      var tvgG = (cache.tvg && cache.tvg.g) ? cache.tvg.g : null;
      for (i = 0; i < img.length; i++) {
        bin = i % nBin;
        var gdb = 0;
        if (tvgG) {
          var idx = tvIndexForBin(res, bin);
          gdb = U.lin2db(tvgG[U.clamp(idx | 0, 0, tvgG.length - 1)]);
        }
        out[i] = U.lin2db(img[i]) - gdb;
      }
    } else {
      for (i = 0; i < img.length; i++) out[i] = U.lin2db(img[i]);
    }
    /* V1.4：扇区边缘增益补偿（显示端）。波束形成输出保持原样（导出/统计仍用真实
     * 指向性），只把已知的系统指向性衰减从显示动态范围里去掉，使扇面亮度均匀 ——
     * 这是商用前视声呐显示器的通行动作，详见 FLS.Imaging.fanComp 的说明。 */
    if (P('disp.fanComp') && res.diag && res.diag.nBeam && res.diag.nBin) {
      FLS.Imaging.fanComp(out, res.diag.nBeam, res.diag.nBin);
    }
    return out;
  }

  /** 距离单元 → 采样索引（与内核一致：t = 2r/c，n = t·fs_bb） */
  function tvIndexForBin(res, bin) {
    var rmin = P('alg.rmin'), rmax = Math.min(P('alg.rmax'), (res.meta && res.meta.plan) ? res.meta.plan.rWin : P('alg.rmax'));
    var r = rmin + (rmax - rmin) * (bin + 0.5) / res.diag.nBin;
    return Math.round((2 * r / res.diag.cRef) * res.fsbb);
  }

  /** 控制台实时指标 */
  function updateMetrics(res, wall) {
    var st = FLS.state, d = res.diag;
    var img = res.imgDisp || res.img;
    var maxv = 0, idx = 0, i;
    for (i = 0; i < img.length; i++) if (img[i] > maxv) { maxv = img[i]; idx = i; }
    var bin = idx % d.nBin;
    var snr = U.pow2db(maxv * maxv / Math.max(1e-30, res.nf[bin]));
    var c = FLS.Env.profileAt(st.rov.z);
    var lam = c / (P('tx.fc') * 1000);
    var nScat = d.nScat;
    st.lastDiag = d;                                    // 供调试与报告导出使用
    st.lastLimit = res.limit || null;                   // ★ V3.3：混响/噪声/量化受限判据
    st.lastNoise = res.meta && res.meta.np || null;
    FLS.ui.updateMetrics({
      ping: st.pingIndex, t: st.simTime, fps: fpsVal,
      cost: (wall !== undefined ? wall : (d.tTotal || 0)),
      x: st.rov.x, y: st.rov.y, depth: -st.rov.z,
      h: st.rov.heading, p: st.rov.pitch, r: st.rov.roll,
      nScat: nScat, echoDb: U.lin2db(Math.max(1e-12, d.maxEchoAmp || maxv)),
      snr: snr, nBeam: d.nBeam, nBin: d.nBin,
      fsbb: res.fsbb, c: c, lam: lam
    });
    var ft = q('fpsTag'); if (ft) ft.textContent = fpsVal.toFixed(1) + ' FPS';
  }

  /** 视口角标信息 */
  function updateHud(res) {
    var st = FLS.state;
    var h3 = q('hud3d');
    if (h3) {
      h3.innerHTML = 'ENU: E ' + st.rov.x.toFixed(1) + ' / N ' + st.rov.y.toFixed(1) + ' / U ' + st.rov.z.toFixed(1) + ' m　' +
        '深度 ' + (-st.rov.z).toFixed(1) + ' m<br>' +
        '姿态 ' + st.rov.heading.toFixed(0) + '° / ' + st.rov.pitch.toFixed(0) + '° / ' + st.rov.roll.toFixed(0) + '°　' +
        '声速 ' + FLS.Env.profileAt(st.rov.z).toFixed(1) + ' m/s';
    }
    var hs = q('hudSonar');
    if (hs) {
      var names = { cbf: 'CBF/DAS', mvdr: 'MVDR', lcmv: 'LCMV', esb: 'ESB', bp: 'BP', pci: 'PCI', acw: 'ACW', music: 'MUSIC' };
      var lim = res.limit, limTxt = '';
      if (lim) {
        var lm = {
          reverb: ['混响受限', '#7dd3a0', '海床混响比接收机噪底高 20 dB 以上：此时改灵敏度 / 前置增益 / 采样位数，图像几乎不动——这是物理，不是空改。把源级降到 170 dB、或把量程推到 80 m，就会转成噪声受限。'],
          mix: ['混响/噪声过渡', '#ffd166', '混响与噪底只差几 dB：接收链参数开始明显影响图像。'],
          noise: ['噪声受限', '#ff9f43', '接收机噪底高于混响：灵敏度、前置增益、采样位数、通道噪声开关此时是主控参数。'],
          quant: ['量化受限', '#ff6b6b', 'ADC 量化噪声已占接收噪底 30% 以上：提高采样位数或前置增益会直接把噪底压下去。']
        }[lim.tag];
        limTxt = '　<b style="color:' + lm[1] + '" title="' + lm[2] + '">' + lm[0] +
          '（混响/噪声 ' + lim.snrMed.toFixed(0) + ' dB）</b>';
      }
      /* ★ V3.6：把波束形成"实际用了多少阵元 / 什么口径"摆到声图角标上。
         这些都是以前只能读代码才知道的量，而它们恰恰决定"改某个参数有没有用"。 */
      var d2 = res.diag, audit = '', mth = P('alg.method');
      if (d2.useM && d2.useM < d2.M && (mth === 'mvdr' || mth === 'lcmv' || mth === 'acw')) {
        audit += '　<b style="color:#ff9f43" title="自适应求解开销 ∝ 阵元数²，因此参与阵元数被「自适应参与阵元上限」封顶。等效孔径只有 ' +
          (d2.useM * FLS.dv.d * 1000).toFixed(1) + ' mm（全阵 ' + (d2.M * FLS.dv.d * 1000).toFixed(1) +
          ' mm）。想让加阵元数真正生效就把该上限提到 ' + d2.M + '。">参与 ' + d2.useM + '/' + d2.M + ' 元</b>';
      } else if (mth === 'esb' || mth === 'music') {
        audit += '　<span title="特征类算法按子阵长度取子阵，信源数 ' + d2.nsrc +
          '，子阵长度 ' + d2.subLen + '">子阵 ' + d2.useM + ' 元 / 信源 ' + d2.nsrc + '</span>';
      }
      if (mth === 'music') {
        audit += '　<b style="color:#7dd3a0" title="MUSIC 的输出是空间谱值（无量纲），不是回波幅度：亮的是「这个方向上有没有点源」，不能和 CBF 的幅度直接比 dB，SNR 读数对它也没有意义。">空间谱（无量纲）</b>';
      }
      if (d2.ksnapShort) {
        audit += '　<b style="color:#ffd166" title="快拍数 ' + d2.ksnap + ' < 2×参与阵元数 ' +
          (2 * d2.useM) + '：受距离分辨限制拉不长，R 的秩不足。提高对角加载电平或减小参与阵元数。">快拍 ' + d2.ksnap + ' &lt; 2M</b>';
      }
      if (P('alg.sll') && (mth === 'mvdr' || mth === 'lcmv' || mth === 'acw' || mth === 'esb' || mth === 'music')) {
        audit += '　<span title="自适应 / 特征类算法的权重由协方差矩阵（R⁻¹ 或特征向量）决定，不经过阵元加权窗 —— 所以「旁瓣抑制 / 加权窗」对当前算法不起作用，这是算法性质，不是空改。">（加权窗不参与）</span>';
      }
      hs.innerHTML = '算法 ' + (names[mth] || mth) +
        '　' + res.diag.nBeam + '×' + res.diag.nBin +
        '　' + P('alg.rmax') + ' m / ' + P('alg.sector') + '°' +
        '　色标 ' + FLS.CMAPS[P('disp.cmap')].name +
        limTxt + audit +
        (st.freeze ? '　<b style="color:#ffb703">已冻结</b>' : '');
    }
  }

  /* ==================================================================
   * 六、信号观测面板（阵元级时域溯源）
   * ================================================================== */

  /* ★ V3.4：模拟前端观测点（probe）
   * ------------------------------------------------------------------
   * 由来：用户反馈"调接收灵敏度 / 前置放大增益，阵元级信号没有明显变化"。
   * 这不是 bug，是**观测点选错了**：内核的时域信号单位是 μPa，即"折合到
   * 水听器输入端"的声压。在这个口径下，灵敏度（V/μPa）与前置增益（V/V）
   * 同时缩放信号与全部声学噪声，**不改变声学信噪比** —— 这是"灵敏度 ≠ 噪声
   * 系数"的常识，物理上它们只改变噪底的通道项与量化项（见 20-env.js）。
   *
   * 但真实示波器不会把探头接在水听器上，而是接在前置放大器**之后**。
   * 所以这里把整条模拟前端摆出来，让用户选在哪一点上看波形：
   *
   *   水听器  p(t)  [μPa]  ── 灵敏度 S [V/μPa] ──▶ v(t) [V]
   *                        ── 前置增益 G [V/V]  ──▶ V(t) [V]
   *                        ── ADC（满量程 ±0.316 V，N bit）──▶ 码值 [LSB]
   *
   *   hydro  : k = 1                      单位 μPa（灵敏度、增益不影响）
   *   preamp : k = 10^(S/20)·10^(G/20)·1000   单位 mV（动 1 dB 抬 1 dB）
   *   adc    : k = (10^(S/20)·10^(G/20)) / (FS_V/2^(N−1))  单位 LSB
   *            并且在声压域先做**真量化**（LSB 步长 = FS_V/2^(N−1) / (kS·kG)），
   *            于是 8 bit 时能看见台阶、16 bit 时看不见 —— 位数不再是"只改噪底"。
   *
   * 满量程电压 FS_V 取 −10 dBV（= 0.316 V，与 20-env.js 的 ADC0 同一常数），
   * 于是"打满 ADC 所需的输入端声压" p_FS = −10 − S − G [dB re 1 μPa]，
   * 与 Env.adcFullScale() 完全自洽。 */
  var FS_VOLT = Math.pow(10, -10 / 20);          // 0.3162 V（ADC 满量程峰值）
  function probeChain() {
    var sens = parseFloat(P('rx.sens')); if (!isFinite(sens)) sens = -180;
    var pre = parseFloat(P('rx.preGain')); if (!isFinite(pre)) pre = 20;
    var bits = parseFloat(P('rx.bits')) || 16;
    var kS = Math.pow(10, sens / 20);            // V/μPa
    var kG = Math.pow(10, pre / 20);             // V/V
    var vPerPa = kS * kG;                        // V per μPa（前置输出）
    var lsbV = FS_VOLT / Math.pow(2, bits - 1);  // V per LSB
    var pb = q('sigProbe') ? q('sigProbe').value : 'preamp';
    var k = 1, unit = 'μPa', qPa = 0, dbOff = 0, name = '水听器输出';
    if (pb === 'preamp') { k = vPerPa * 1000; unit = 'mV'; name = '前置放大输出'; }
    else if (pb === 'adc') { k = vPerPa / lsbV; unit = 'LSB'; qPa = lsbV / vPerPa; name = 'ADC 码值'; }
    else { k = 1; unit = 'μPa'; name = '水听器输出'; }
    dbOff = 20 * Math.log10(Math.max(1e-30, k));
    return { k: k, unit: unit, qPa: qPa, dbOff: dbOff, name: name,
             sens: sens, pre: pre, bits: bits, vPerPa: vPerPa, lsbV: lsbV,
             fsDb: FLS.Env.adcFullScale ? FLS.Env.adcFullScale() : (-10 - sens - pre) };
  }
  /** ADC 观测点：对基带 I/Q 就地做真量化（声压域，等效于 ADC 端量化） */
  function quantizeIQ(sig, n, qPa) {
    if (!(qPa > 0)) return;
    for (var i = 0; i < 2 * n; i++) sig[i] = Math.round(sig[i] / qPa) * qPa;
  }
  /** 线性数组按观测点换算（就地） */
  function scaleLin(a, k) {
    if (k === 1) return a;
    for (var i = 0; i < a.length; i++) a[i] *= k;
    return a;
  }
  /** dB 数组按观测点平移（就地） */
  function scaleDb(a, off) {
    if (Math.abs(off) < 1e-6) return a;
    for (var i = 0; i < a.length; i++) a[i] += off;
    return a;
  }

  /** 观测点说明：把"当前看的是哪一点、峰值离满量程多远"写进信息行 */
  function probeInfo(PR, arr) {
    var pk = 0;
    for (var i = 0; i < arr.length; i++) { var a = Math.abs(arr[i]); if (a > pk) pk = a; }
    var s = '　【观测点】' + PR.name + '（' + PR.unit + '）' +
      '：灵敏度 ' + PR.sens + ' dB re 1V/μPa × 前置增益 ' + PR.pre + ' dB';
    if (PR.qPa > 0) {
      var full = Math.pow(2, PR.bits - 1);
      s += '，峰值 ' + pk.toFixed(0) + ' LSB（满量程 ±' + full + '，占 ' +
        (pk / full * 100).toFixed(1) + '%）';
      if (pk >= full * 0.98) s += ' <b style="color:#c2410c">已削波</b>';
    } else if (PR.unit === 'mV') {
      s += '，峰值 ' + pk.toFixed(1) + ' mV（ADC 满量程 ' + (FS_VOLT * 1000).toFixed(0) +
        ' mV，占 ' + (pk / (FS_VOLT * 1000) * 100).toFixed(2) + '%）';
    } else {
      s += '，峰值 ' + U.lin2db(Math.max(1e-12, pk)).toFixed(1) + ' dB re 1 μPa' +
        '（灵敏度与前置增益不改变这一口径，它们只改噪底的通道项与量化项）';
    }
    return s;
  }

  function drawSignal(res) {
    if (!res) { FLS.SigPlot.clear(); return; }
    var st = FLS.state;
    var M = res.diag.M, nsamp = res.nsamp, fsbb = res.fsbb;
    if (!FLS.ui._sigReady) return;
    var pre = res.chPre, post = res.chPost;
    var usePost = q('sigPrePost') ? q('sigPrePost').checked : false;
    var sig = (usePost && post) ? post : (pre || post);
    if (!sig) { FLS.SigPlot.clear(); return; }
    var type = q('sigType').value;
    var PR = probeChain();
    /* ADC 观测点：先量化再画。量化必须在**原始基带采样**上做（不能在上采样之后，
       否则台阶宽度对应插值后的采样率，不是真实 ADC 的台阶）。 */
    if (PR.qPa > 0) { sig = sig.slice(0, 2 * nsamp); quantizeIQ(sig, nsamp, PR.qPa); }
    var chIdx = U.clamp(parseInt(q('chanSel').value, 10) || 0, 0, M - 1);
    var sp = (res.meta && res.meta.plan) ? res.meta.plan : null;
    var cRef = res.diag.cRef || 1500;
    var info = '';

    if (type === 'rf') {
      // 重建带通波形：基带插值到 ≥4fc 的采样率后调制（控制总点数 ≤ ~12 万）
      var fcHz = P('tx.fc') * 1000;
      var K = U.clamp(Math.ceil(4 * fcHz / Math.max(1, fsbb)), 1, 64);
      var showN = Math.min(nsamp, Math.max(128, Math.floor(120000 / K)));
      var sub = sig.slice(0, 2 * showN);
      var up = FLS.Sig.upsample(sub, showN, K);
      var fsNew = fsbb * K;                     // up.n 恒等于 showN*K，采样率即 K*fsbb
      var rf = FLS.Sig.toRF(up.arr, up.n, fcHz, fsNew);
      scaleLin(rf, PR.k);
      FLS.SigPlot.plot([{ y: rf, color: '#1f6feb', name: 'x(t)' }],
        { x0: 0, x1: showN / fsbb * 1000, xlabel: '时间 ms（双程）', ylabel: '幅度 ' + PR.unit });
      info = 'CH' + chIdx + ' 重建带通波形（基带 ' + (fsbb / 1000).toFixed(1) + ' kHz 插值 ' + K + '× → ' +
        (fsNew / 1000).toFixed(0) + ' kHz，载波 ' + P('tx.fc') + ' kHz）；' + (usePost ? '预处理后' : '预处理前（含噪声）') +
        '；共 ' + nsamp + ' 基带样本，显示前 ' + showN + ' 个（' + (showN / fsbb * 1000).toFixed(1) +
        ' ms）；满量程 ' + (nsamp / fsbb * 1000).toFixed(1) + ' ms ⇔ ' + (cRef * nsamp / fsbb / 2).toFixed(0) + ' m。' +
        probeInfo(PR, rf);
    } else if (type === 'env') {
      var n2 = Math.min(nsamp, 4000);
      var env = new Float32Array(n2), Iq = new Float32Array(n2), Qq = new Float32Array(n2);
      for (var i = 0; i < n2; i++) {
        var re = sig[2 * i], im = sig[2 * i + 1];
        env[i] = Math.sqrt(re * re + im * im); Iq[i] = re; Qq[i] = im;
      }
      scaleLin(env, PR.k); scaleLin(Iq, PR.k); scaleLin(Qq, PR.k);
      FLS.SigPlot.plot([
        { y: env, color: '#c2410c', name: '|b| 包络' },
        { y: Iq, color: '#1f6feb', name: 'I' },
        { y: Qq, color: '#0f9d58', name: 'Q' }
      ], { x0: 0, x1: n2 / fsbb * 1000, xlabel: '时间 ms（双程）', ylabel: '复包络 ' + PR.unit });
      info = 'CH' + chIdx + ' 复基带包络与 I/Q：横轴为双程时间，对应距离 R = c·t/2 ≈ ' +
        (cRef * (n2 / fsbb) / 2).toFixed(0) + ' m 满量程。' + probeInfo(PR, env);
    } else if (type === 'spec') {
      var sp2 = FLS.Sig.spectrum(sig, nsamp, 1024);
      scaleDb(sp2, PR.dbOff);
      FLS.SigPlot.plot([{ y: sp2, color: '#6f42c1', name: 'PSD' }],
        { x0: 0, x1: fsbb / 2000, xlabel: '基带频率 kHz（射频 = fc + f）', ylabel: 'dB re ' + PR.unit });
      info = 'CH' + chIdx + ' 功率谱（Welch，Hann 窗）；基带频率 0 对应射频中心频率 ' +
        (P('tx.fc')) + ' kHz。' + (usePost ? '（预处理后，已带通/脉压/TVG）' : '（预处理前，含带外噪声）') +
        ' 纵轴按观测点平移 ' + PR.dbOff.toFixed(1) + ' dB。';
    } else if (type === 'beam') {
      var bts = res.beamTS;
      if (!bts) { FLS.SigPlot.clear(); info = '当前未返回波束时域数据。'; }
      else {
        var nb = bts.length / 2, mag = new Float32Array(nb);
        for (i = 0; i < nb; i++) mag[i] = Math.sqrt(bts[2 * i] * bts[2 * i] + bts[2 * i + 1] * bts[2 * i + 1]);
        scaleLin(mag, PR.k);
        FLS.SigPlot.plot([{ y: mag, color: '#0b7285', name: '|y|' }],
          { x0: P('alg.rmin'), x1: Math.min(P('alg.rmax'), (sp ? sp.rWin : P('alg.rmax'))), xlabel: '距离 m', ylabel: '波束输出 ' + PR.unit });
        info = '中心波束（#' + Math.floor(res.diag.nBeam / 2) + '）输出时域，' + nb + ' 个距离单元。' +
          probeInfo(PR, mag);
      }
    } else {
      // bfan：波束方向图（取光标或中心距离所在行）
      var db = res.db, nB = res.diag.nBeam, nR = res.diag.nBin;
      if (!db) { FLS.SigPlot.clear(); }
      else {
        var bi = (FLS.Imaging.S.cursor && FLS.Imaging.S.cursor.on && FLS.Imaging.S.cursor.bi !== undefined)
          ? U.clamp(FLS.Imaging.S.cursor.bi, 0, nR - 1) : Math.floor(nR / 2);
        var cut = new Float32Array(nB);
        for (i = 0; i < nB; i++) cut[i] = db[i * nR + bi];
        var rr = P('alg.rmin') + (Math.min(P('alg.rmax'), (sp ? sp.rWin : P('alg.rmax'))) - P('alg.rmin')) * (bi + 0.5) / nR;
        FLS.SigPlot.plot([{ y: cut, color: '#b8860b', name: '方向图' }],
          { x0: -P('alg.sector') / 2, x1: P('alg.sector') / 2, xlabel: '方位角 °', ylabel: 'dB' });
        info = '距离 ' + rr.toFixed(1) + ' m 处的波束方向图（当前算法 ' + P('alg.method').toUpperCase() + ' 的输出切面）。';
      }
    }
    var si = q('sigInfo'); if (si) si.innerHTML = info;
  }

  /* ==================================================================
   * 七、仿真控制：启动 / 暂停 / 单步 / 重置
   * ================================================================== */
  app.start = function () {
    var st = FLS.state;
    if (st.running && !st.paused) { FLS.log('仿真已在运行中。'); return; }
    if (st.running && st.paused) { st.paused = false; FLS.ok('仿真继续运行。'); }
    else {
      st.running = true; st.paused = false;
      FLS.ok('仿真已启动：' + (st.simMode === 'step' ? '单步模式（点击「单步」推进一个脉冲）' : '连续实时模式'));
      FLS.log('链路：发射 ' + String(P('tx.type')).toUpperCase() + ' → 传播/吸收/多途 → 面元散射 → ' +
        elemCount() + ' 路阵元采样 → 滤波/脉压/TVG → ' + String(P('alg.method')).toUpperCase() + ' → 扇形成像。');
    }
    syncBtns();
  };

  app.pause = function () {
    var st = FLS.state;
    if (!st.running) { FLS.warn('仿真尚未启动，无需暂停。'); return; }
    st.paused = !st.paused;
    FLS.log(st.paused ? '仿真已暂停：载体静止，键盘控制不生效，成像保持当前帧。' : '仿真已继续。');
    syncBtns();
  };

  /* ★ V3.3：把作业组装函数挂到 app 上。
   * 原来 buildJob 是模块私有，导致"参数到底进了内核没有"只能靠旁观图像猜。
   * 挂出来以后，回归脚本可以 **同步** 跑一帧（不经过 Worker 池）：
   *     FLS.engineMain.runPing(FLS.app.buildJob())
   * 于是"改参数 → 同一组面元随机相位 → 成像指标差多少"变成可量化的 A/B，
   * 不再受后台线程回包时序干扰。导出全部阵元信号也复用它。 */
  app.buildJob = buildJob;
  /* 同步跑一帧并走完整条后处理（非相干积分 → 显示映射 → 受限判据 → 渲染）。
     回归脚本需要它才能看到 imgView（积分后的显示域）与 res.limit，
     只看 runPing 的原始 img 会把"只作用于显示域"的参数误判成空改。 */
  app.runOnce = function (frame) {
    var st = FLS.state;
    if (frame !== undefined) st.pingIndex = frame;
    var res = FLS.engineMain.runPing(buildJob());
    if (res) onResult(res, 0);
    return res;
  };

  app.step = function () {
    var st = FLS.state;
    if (!st.running) { st.running = true; st.paused = false; }
    st.paused = true;                      // 单步：推进一帧后立即冻结
    requestPing(true);
    FLS.log('单步执行：第 ' + (st.pingIndex + 1) + ' 个脉冲（PRP=' + P('tx.prp') + ' ms）。');
    syncBtns();
  };

  app.reset = function () {
    var st = FLS.state;
    st.running = false; st.paused = false; st.pingIndex = 0; st.simTime = 0;
    pingAcc = 0; integ = null;
    ['rov.x', 'rov.y', 'rov.z', 'rov.heading', 'rov.pitch', 'rov.roll'].forEach(function (k) {
      FLS.P[k] = FLS.DEFAULTS[k];
    });
    FLS.Rov.reset();
    FLS.Rov.parseTrack();
    FLS.scene3d.setTrack([]);
    resetEngine();
    FLS.Imaging.S.lastDb = null;
    var cv = document.getElementById('sonarCanvas');
    if (cv && FLS.Imaging.S.ctx) {
      FLS.Imaging.S.ctx.setTransform(1, 0, 0, 1, 0, 0);
      FLS.Imaging.S.ctx.fillStyle = '#0b1119';
      FLS.Imaging.S.ctx.fillRect(0, 0, cv.width, cv.height);
      FLS.Imaging.S.ctx.setTransform(Math.min(2, window.devicePixelRatio || 1), 0, 0, Math.min(2, window.devicePixelRatio || 1), 0, 0);
    }
    FLS.Imaging.drawOverlay(-40, 0, P('alg.sector'), P('disp.cmap'));
    FLS.SigPlot.clear();
    st.last = null;
    var ftz0 = "帧" + ' --';
    var ftz = q('sonarFrameTag'); if (ftz) ftz.textContent = ftz0;
    var ftz2 = q('frameTag'); if (ftz2) ftz2.textContent = ftz0;
    FLS.ok('仿真已重置：脉冲计数、轨迹与积分缓存清空，ROV 回到初始位姿。');
    syncBtns();
    updateHud({ diag: { nBeam: P('alg.nBeam'), nBin: P('alg.nBin'), M: elemCount(), cRef: FLS.Env.profileAt(st.rov.z) }, db: null });
  };

  function syncBtns() {
    /* V2.2：运行时按钮文案（启动/暂停/状态）原来走 I.t 双语词条，现在直接写中文常量。 */
    var st = FLS.state;
    var b = q('btnStart'); if (b) b.textContent = (st.running && !st.paused) ? "运行中…" : "启动仿真";
    var p = q('btnPause'); if (p) p.textContent = st.paused ? "继续" : "暂停";
    var cs = q('consoleState');
    if (cs) {
      var txt = !st.running ? "待启动" : (st.paused ? "已暂停" : "运行中…");
      cs.textContent = txt;
      cs.style.color = !st.running ? '' : (st.paused ? 'var(--warn)' : 'var(--ok)');
    }
  }
  app.syncBtns = syncBtns;

  /** 请求一次脉冲仿真（force=true 时即使后台忙也排队到主线程） */
  function requestPing(force) {
    var st = FLS.state;
    var job = buildJob();
    st.sampWin = { nsamp: job.nsamp, fsbb: job.fsbb };
    if (force && worker && workerBusy) {
      // 单步时后台忙：主线程同步补算，保证单步必然出帧
      var t0 = FLS.now();
      try { onResult(FLS.engineMain.runPing(job), FLS.now() - t0); }
      catch (e) { FLS.err('单步仿真失败：' + e.message); }
      return;
    }
    submit(job);
  }

  /* ==================================================================
   * 八、主循环：ROV 运动 + 脉冲调度 + 三维渲染 + 帧率统计
   * ================================================================== */
  function loop(ts) {
    requestAnimationFrame(loop);
    var st = FLS.state;
    var dt = lastFrameT ? Math.min(0.12, (ts - lastFrameT) / 1000) : 0;
    lastFrameT = ts;
    if (dt > 0) { fpsAcc += dt; fpsCnt++; if (fpsAcc >= 0.5) { fpsVal = fpsCnt / fpsAcc; fpsAcc = 0; fpsCnt = 0; } }

    if (st.running && !st.paused) {
      var scale = st.timeScale || 1;
      FLS.Rov.update(dt * scale);
      // 位姿回写参数面板（保持显示一致）
      FLS.P['rov.x'] = st.rov.x; FLS.P['rov.y'] = st.rov.y; FLS.P['rov.z'] = st.rov.z;
      FLS.P['rov.heading'] = st.rov.heading; FLS.P['rov.pitch'] = st.rov.pitch; FLS.P['rov.roll'] = st.rov.roll;
      if (st.simMode === 'continuous') {
        pingAcc += dt * scale;
        var prpSec = Math.max(0.002, P('tx.prp') / 1000);
        if (pingAcc >= prpSec) { pingAcc = 0; requestPing(); }
      }
    }

    // 三维视图：位姿 / 视锥 / 阵元标记 / 渲染
    // V1.3：载体驶出网格中心一定距离后，把海床/海面网格挪过去（阈值触发，非每帧）
    if (FLS.scene3d.maybeRecenter) FLS.scene3d.maybeRecenter(st.rov.x, st.rov.y);
    var axes = FLS.scene3d.sonarAxes(st.rov);
    var elem = buildElements(st.rov, axes);
    /* V2.0：只更新/渲染**当前可见**的那个三维视口 —— 隐藏的视口画了也没人
       看，白白吃掉一半以上的帧预算。切到「原理演示」时三维完全不参与。 */
    var view = (FLS.ui && FLS.ui.getView) ? FLS.ui.getView() : 'scene';
    if (view === 'scene') { FLS.scene3d.updateRov(st.rov, elem); FLS.scene3d.render(); }
    else if (view === 'image') {
      // mini 视口是主视口画面的拷贝，所以主视口照样要渲染一次
      FLS.scene3d.updateRov(st.rov, elem);
      FLS.scene3d.render();
      FLS.scene3d.renderMini();
      /* ★ V3.5：虚拟摄像头视口。必须在主视口渲染**之后** ——
         它复用同一个 scene，且自己会临时隐藏辅助显示物并在渲染后还原，
         插在主视口之前会让主视口那一帧缺东西（表现为扇面/网格闪烁）。 */
      if (FLS.camview && FLS.camview.render) FLS.camview.render();
      updateCamFovTag();
    }
    /* V3.0：驾控台挂在成像栏，只在成像视图下刷新（内部自带节流与"值未变不画"）。
     * 放在三维渲染之后 —— 这样表盘读到的是这一帧最终的 ROV 姿态。 */
    if (FLS.Cockpit) FLS.Cockpit.draw();
  }

  /* ==================================================================
   * 九、参数变更响应（含工程合理性校验）
   * ================================================================== */
  /**
   * V2.2：发射 / 接收阵元间距按当前中心频率自动取 λ/2。
   * 以前改了频率、间距不动，栅瓣校验立刻在日志里刷告警，用户还得自己反算
   * λ/2 填回来 —— 一个物理量变了要令另一个跟着重算，这本该是软件的活。
   * @param silent true 时只在值发生变化后才说话（启动、载入工程用）
   */
  function syncSpacing(silent) {
    /* ★ V3.3：只剩接收阵有"阵元间距"这个自由度。发射换能器改为垂直叠阵后，
       层间距固定取 λ/2（由 tx.nElem 折算垂直开角），没有可调的间距了。 */
    if (!FLS.P['rx.autoSp']) return;
    var c = FLS.Env.profileAt(FLS.state.rov.z);
    var f = parseFloat(FLS.P['tx.fc']) * 1000;
    if (!(f > 0)) return;
    var half = c / (2 * f) * 1000;               // λ/2，mm
    /* ★ 向下取整到 0.01 mm，**不能四舍五入**。
       默认 400 kHz、c=1494.1 m/s 时 λ/2 = 1.8677 mm：四舍五入得 1.87 mm，
       比 λ/2 多出 0.0023 mm（0.12%），而 onParamChange 里的栅瓣校验是严格
       比较 `d > λ/2`，于是刚打开软件、什么都没改就刷出
       "⚠ 阵元间距 1.87 mm > λ/2 (1.87 mm)，将出现栅瓣" 这种自相矛盾的告警。
       取整方向朝下，写回去的间距**恒不超过 λ/2**，告警只在用户手动填大时才出现。 */
    var d = Math.floor(half * 100) / 100;
    var old = FLS.P['rx.spacing'];
    if (Math.abs(old - d) < 5e-3) return;
    FLS.setP('rx.spacing', d, true);
    if (!silent) {
      FLS.log('接收阵元间距已按 λ/2 自动调整为 ' + d.toFixed(2) + ' mm（f₀=' +
        FLS.P['tx.fc'] + ' kHz，c=' + c.toFixed(1) + ' m/s）。');
    }
  }
  app.syncSpacing = syncSpacing;

  /* ==================================================================
   * ★ V3.5：虚拟摄像头视口的两个配套动作
   * ================================================================== */
  /** 按 cam.on 收放视口 DOM。关掉时整块移出流，纵向空间还给三维视口。 */
  function applyCamOn() {
    var host = q('hostCam');
    if (!host) return;
    var on = FLS.P['cam.on'] !== false;
    host.classList.toggle('off', !on);
    /* 标题行也要一起收 —— 否则留下一条孤零零的 "虚拟摄像头视口" 空标题。 */
    var cap = host.previousElementSibling;
    if (cap && cap.classList.contains('cam-cap')) cap.style.display = on ? '' : 'none';
  }

  /** 标题条右侧的实时视场读数。文字没变就不碰 DOM（每帧写 textContent 会抖）。 */
  var camTagLast = '';
  function updateCamFovTag() {
    var el = q('camFovTag');
    if (!el || !FLS.camview || !FLS.camview.info) return;
    var s = FLS.camview.info();
    if (s !== camTagLast) { camTagLast = s; el.textContent = s; }
  }

  app.onParamChange = function (k) {
    var st = FLS.state;
    /* V2.2：中心频率一变，两个自动跟随的阵元间距立刻重算。
       放在最前面 —— 后面的栅瓣校验要用新间距说话。 */
    if (k === 'tx.fc' || k === '*') syncSpacing(k === '*');
    /* ★ V3.5：摄像头视口的开关 / 浑浊度 / 叠加层。
       'cam.on' 要真的收放 DOM：关掉时把那 140 px 纵向空间整块还给三维视口，
       而不是留一块黑屏。收放之后必须 resizeAll ——
       ① 三维视口（flex:1）要按新高度重设相机 aspect 与画布尺寸；
       ② 摄像头自己也要重设（重新出现时宽高是真实值了）。 */
    if (k === 'cam.on' || k === '*') applyCamOn();
    /* ★ V3.2：参数联动 —— 在**任何**改动之后、任何校验之前，先把派生量算出来。
     * 顺序很重要：syncSpacing 会改写阵元间距（它本身是 λ/2 的派生量），
     * 而 derive 要用最终的间距算孔径与波束宽度，所以必须先 sync 再 derive。
     * derive 只写 P['rx.vOpen'] / P['alg.nBeam'] 两个量，不回调本函数。 */
    if (FLS.derive) FLS.derive();
    if (FLS.ui) {
      if (FLS.ui.syncParamControls) FLS.ui.syncParamControls();
      if (FLS.ui.refreshLinkPanel) FLS.ui.refreshLinkPanel();
    }
    /* V2.0：改过的参数所属页签打个"未看过"小点（左栏七页，312 px 塞七个页签，
       靠这个小点提醒"这一页被我动过"）。'*'（换模板/载入工程）不打点。 */
    if (k && k !== '*' && FLS.ui && FLS.ui.markDirty) FLS.ui.markDirty(String(k).split('.')[0]);
    var c = FLS.Env.profileAt(st.rov.z);
    var fcHz = P('tx.fc') * 1000;
    var lam = c / fcHz;

    /* ★ V1.3 修复：位姿参数必须回写 state.rov，且 '*' 也要回写。
     * 原实现用逐一精确匹配，传入 '*'（换模板 / 载入工程 / 恢复默认时走这条路径）
     * 时位姿不会同步到 state.rov —— 面板上的航向角改了、三维与声呐却仍用旧姿态。 */
    if (/^rov\.(x|y|z|heading|pitch|roll)$/.test(k) || k === '*') {
      var p = st.rov;
      p.x = P('rov.x'); p.y = P('rov.y'); p.z = P('rov.z');
      p.heading = P('rov.heading'); p.pitch = P('rov.pitch'); p.roll = P('rov.roll');
    }
    /* ★ V1.3 修复：航点文本 / 运动模式改动后必须重新解析航点序列。
     * 原实现只在 st.track 为空时才解析，导致用户在参数面板改了航点字符串
     * 或切换运动模式后，巡航仍沿旧航点走。 */
    if (k === 'rov.track' || k === 'rov.mode' || k === '*') FLS.Rov.parseTrack();

    // —— 栅瓣校验：d ≤ λ/2 ——
    /* ★ V3.3：发射端不再有"阵元间距"（垂直叠阵的层距固定取 λ/2，由 tx.nElem 折算），
       所以这里只校正接收阵。发射侧的相关约束已并入 FLS.derive() 的一致性检查。 */
    if (k === 'rx.spacing' || k === 'rx.nElem' || k === '*') {
      var dRx = P('rx.spacing');
      if (dRx > lam * 1000 / 2 + 1e-6)
        FLS.warn('接收阵元间距 ' + dRx + ' mm > λ/2 (' + (lam * 500).toFixed(2) + ' mm)，将出现栅瓣。');
    }
    // —— 采样率 / 带宽一致性 ——
    if (k === 'rx.fs' || k === 'tx.bw' || k === '*') {
      if (P('rx.fs') * 1000 < 2.5 * P('tx.bw') * 1000)
        FLS.warn('采样率 ' + P('rx.fs') + ' kHz < 2.5×带宽，基带等效将欠采样，成像可能失真。');
    }
    // —— 不模糊距离 ——
    if (k === 'tx.prp' || k === 'alg.rmax' || k === '*') {
      var rUn = c * (P('tx.prp') / 1000) / 2;
      if (P('alg.rmax') > rUn)
        FLS.warn('最大探测距离 ' + P('alg.rmax') + ' m 超过不模糊距离 c·PRP/2 = ' + rUn.toFixed(1) +
          ' m，远距离回波将混叠到近距（已自动截断到 ' + (rUn * 0.98).toFixed(1) + ' m）。');
    }
    // —— 自适应算法参数 ——
    if (k === 'alg.method' || k === '*') {
      var m = P('alg.method');
      if ((m === 'esb' || m === 'music') && !P('alg.smooth'))
        FLS.warn('ESB / MUSIC 建议开启「空间平滑」以解相干，否则强相关多途会导致子空间估计失败。');
      if (m === 'bp') FLS.log('BP 后向投影：沿航迹非相干累积，帧数越多方位分辨率越高（控制台显示累积帧数）。');
      integ = null;
      resetEngine();
    }
    /* ★ V2.2：非相干积分次数改了必须丢弃累加器。
       此前只有换算法（alg.method）才清 integ，改积分帧数不清 ——
       于是把 1 帧积分改成 8 帧后，累加器里还压着旧帧，要再跑满 8 帧
       才逐渐被"冲淡"，中间那段时间的图像亮度是新旧帧数混在一起的，
       看着像"改了参数没生效"。 */
    if (k === 'alg.integ' || k === 'alg.method' || k === '*') integ = null;
    if (k === 'alg.subLen' || k === 'rx.nElem' || k === 'alg.nsrc') {
      var M = elemCount();
      if (P('alg.subLen') > M - 1) FLS.warn('子阵长度 ' + P('alg.subLen') + ' 应 ≤ 阵元数−1 (' + (M - 1) + ')，已自动钳位。');
      if (P('alg.nsrc') > M - 1) FLS.warn('信源数 ' + P('alg.nsrc') + ' 应 ≤ 阵元数−1 (' + (M - 1) + ')。');
    }
    // —— 影响链路量纲的参数：清缓存 ——
    /* ★ V1.3 修复：alg.sector（成像扇角）直接决定三维扫描扇区的水平张角，
     * 原先不在触发列表里 —— 改扇角后声呐图变了、三维里的扇形楔体却纹丝不动。
     * （hDeg = min(tx.hbeam, alg.sector)，两者都必须触发重建。） */
    if (/^tx\.|^rx\.|^alg\.|^env\.|^\*/.test(k)) {
      cache = {};
      integ = null;
      FLS.scene3d.updateCone();
      FLS.scene3d.updateRxCone();     // V2.2：接收覆盖范围（橙黄楔体）同批发重建
    }
    /* V2.2：声呐安装俯仰角变了，两个扇面的朝向在下一次渲染时自动跟着走
       （updateRov 每帧按 sonarAxes 重设四元数），这里只需把 UI 面板同步一遍。 */
    if (k === 'rov.tilt') {
      FLS.log('声呐安装俯仰角设为 ' + FLS.P['rov.tilt'] + '°（' +
        (FLS.P['rov.tilt'] > 0 ? '艏部下压，扇面照向海底' :
          (FLS.P['rov.tilt'] < 0 ? '艏部上仰，扇面照向海面/上方' : '与 ROV 轴线平行')) +
        '）：三维扇面与内核成像平面同步倾斜，并与 ROV 俯仰角叠加。');
    }
    if (k === 'alg.nElem' || k === 'rx.nElem' || k === '*') {
      FLS.ui.fillChannels(elemCount());
    }
    // —— 显示类：无需重算，仅重绘 ——
    if (k === 'disp.cmap' || k === 'disp.auto' || k === 'disp.dynHi' || k === 'disp.dynLo' ||
      k === 'disp.autoHi' || k === 'disp.mlook' || k === 'disp.dynSpan' || k === 'disp.bias' ||
      k === 'sig' || k === '*') {
      redraw();
    }
    // —— 三维垂直放大：纯显示量，只需重建海床网格 ——
    if (k === 'disp.zexag' || k === '*') {
      FLS.scene3d.rebuildTerrain();
      var zx = parseFloat(P('disp.zexag')) || 1;
      if (zx > 1.001) FLS.log('三维视口垂直放大 ×' + zx.toFixed(1) + ' 已启用（仅影响显示）：' +
        '海底起伏被放大显示，贴底目标在视口中可能与海床面有可见间隙；' +
        '面元真实深度、散射法向、传播时延与成像结果均按真实地形计算。');
    }
    // —— V1.1 三维海底：深度着色 / 色标 / 网格间距，纯显示量 ——
    if (k === 'disp.heightColor' || k === 'disp.heightCmap' || k === 'disp.gridStep' ||
        k === 'disp.surfGridStep' || k === '*') {
      /* ★ V3.4：网格间距（海底 / 海面）改动要重建三维海床与海面网格线；
         其余只重着色。海面网格由 rebuildTerrain → rebuildSurface 连带更新。 */
      if (k === 'disp.gridStep' || k === 'disp.surfGridStep') FLS.scene3d.rebuildTerrain();
      else FLS.scene3d.recolorSeafloor();
      FLS.scene3d.updateDepthLegend();
    }
    // —— 界面主题 ——
    if (k === 'disp.theme') FLS.Theme.apply(P('disp.theme'), true);
    if (k === 'chan' || k === 'sig') { if (st.last) drawSignal(st.last); }
    // 显示开关可能在菜单路径之外被改动（载入工程 / 快捷键 / 自动化），
    // 统一在这里把菜单勾选与三维对象可见性刷新一遍，避免两处失同步。
    if (/^disp\.|^\*/.test(k)) {
      app.refreshDisplayChecks();
      // V2.1：色标可能在左栏参数表 / 算例模板 / 载入工程里被改，两个视图栏下拉要跟着走
      if (FLS.ui && FLS.ui.syncCmapSelects) FLS.ui.syncCmapSelects();
      if (FLS.scene3d.applyDisplay) FLS.scene3d.applyDisplay();
    }
    /* ★ V3.2：海底平均深度只影响 compose 里的加法项，栅格（存起伏）完全不用重算，
     * 所以这里只重画三维与色标图例 —— 改一次深度是"零代价"的。
     * 载体 / 目标 / 航迹的平移在 ui.setBaseDepth 里已经做过（那里知道 delta）。 */
    if (k === 'terr.base') {
      FLS.scene3d.rebuildTerrain(st.rov.x, st.rov.y);
      FLS.scene3d.updateDepthLegend();
      if (FLS.ui && FLS.ui.updateBaseStat) FLS.ui.updateBaseStat();
    }
    /* ★ V3.4：海底长 / 宽 —— 改完必须**重烘焙散射栅格**再重铺三维海床。
     * 顺序很重要：先 bake（换一张新尺寸的栅格表），再 rebuildTerrain
     * （它内部会调 ensureBake；若先 rebuild 而栅格尺寸还没变，
     *  ensureBake 会认为"尺寸一致"而复用旧表，海床就还是老范围）。 */
    if (k === 'terr.lenX' || k === 'terr.lenY') {
      FLS.Terrain.bake(st.rov.x, st.rov.y);
      FLS.scene3d.rebuildTerrain(st.rov.x, st.rov.y);
      FLS.scene3d.updateDepthLegend();
      if (FLS.ui && FLS.ui.updateBaseStat) FLS.ui.updateBaseStat();
      FLS.log('海底范围改为 ' + P('terr.lenX') + ' × ' + P('terr.lenY') +
        ' m：散射栅格已按新尺寸重烘焙，三维海床已重铺。');
    }
    if (k === 'quality') { integ = null; FLS.log('散射面元精度档已按「' + st.quality + '」档更新（cellStride 变化，面元数与耗时随之改变）。'); }
    /* V2.2：最后一次统一回写视图栏（量程 / 垂直放大 / 动态范围 / 窗偏移）。
       放在最后、无条件执行 —— 无论这次改动来自参数表、模板、工程载入还是
       快捷键，视图栏都不会再与真实参数脱节。 */
    if (FLS.ui && FLS.ui.syncViewBar) FLS.ui.syncViewBar();
  };

  /** 用最近一帧结果重绘扇形与信号（不重算） */
  function redraw() {
    var res = FLS.state.last;
    if (!res) return;
    var mk = P('disp.mlook') | 0;
    res.imgView = (mk > 1)
      ? FLS.Imaging.mlook(res.imgDisp || res.img, res.diag.nBeam, res.diag.nBin, mk)
      : (res.imgDisp || res.img);
    var mode = q('sonarView') ? q('sonarView').value : 'amp';
    var db = toDisplay(res, mode);
    res.db = db;
    var lo, hi;
    if (P('disp.auto')) { var rg = FLS.Imaging.autoRange(db, P('disp.autoHi')); lo = rg.lo; hi = rg.hi; }
    else { lo = P('disp.dynLo'); hi = P('disp.dynHi'); }
    // V2.0 窗偏移：在自动/手动窗口之上整体平移（相当于显示器的"亮度/增益"旋钮）
    var bias = parseFloat(P('disp.bias'));
    if (isFinite(bias) && bias !== 0) { lo += bias; hi += bias; }
    res.lo = lo; res.hi = hi;
    FLS.Imaging.render(db, res.diag.nBeam, res.diag.nBin, P('alg.sector'), lo, hi, P('disp.cmap'));
    drawSignal(res);
  }
  app.redraw = redraw;

  /* ==================================================================
   * 十、导出：全部阵元时域信号 CSV
   * ================================================================== */
  app.exportAllChannels = function () {
    var st = FLS.state;
    var M = elemCount();
    var job = buildJob({ retAll: true });
    var nsamp = job.nsamp;
    FLS.log('正在重算当前帧以导出全部 ' + M + ' 路阵元时域信号（' + nsamp + ' 样本/路）…');
    submit(job, function (res) {
      try {
        var maxRows = 200000;
        var step = Math.max(1, Math.ceil(nsamp / maxRows));
        var lines = [];
        var head = ['样本', '时间_ms', '距离_m'];
        for (var m = 0; m < M; m++) head.push('CH' + m + '_I', 'CH' + m + '_Q');
        lines.push('# 前视声呐时域信号级仿真系统 —— 阵元级时域信号导出');
        lines.push('# 帧序号=' + st.pingIndex + '  阵元数=' + M + '  基带采样率=' + (res.fsbb / 1000).toFixed(3) +
          ' kHz  中心频率=' + P('tx.fc') + ' kHz  样本数=' + nsamp);
        lines.push('# 说明：I/Q 为复基带（射频 x(t)=Re{b(t)e^{j2πfc t}}）；pre=预处理前（含噪声），post=预处理后（滤波/脉压/TVG）');
        lines.push(head.join(','));
        var cRef = res.diag.cRef || 1500;
        for (var i = 0; i < nsamp; i += step) {
          var row = [i, (i / res.fsbb * 1000).toFixed(4), (cRef * (i / res.fsbb) / 2).toFixed(3)];
          for (m = 0; m < M; m++) {
            var b1 = 2 * (m * nsamp + i);
            row.push((res.allPre ? res.allPre[b1] : 0).toExponential(4),
              (res.allPre ? res.allPre[b1 + 1] : 0).toExponential(4));
          }
          for (m = 0; m < M; m++) {
            var b2 = 2 * (m * nsamp + i);
            row.push((res.allPost ? res.allPost[b2] : 0).toExponential(4),
              (res.allPost ? res.allPost[b2 + 1] : 0).toExponential(4));
          }
          lines.push(row.join(','));
        }
        // 重新生成表头（含 post 列）
        var head2 = ['样本', '时间_ms', '距离_m'];
        for (m = 0; m < M; m++) head2.push('CH' + m + '_preI', 'CH' + m + '_preQ');
        for (m = 0; m < M; m++) head2.push('CH' + m + '_postI', 'CH' + m + '_postQ');
        lines[3] = head2.join(',');
        var csv = '\ufeff' + lines.join('\n');
        var d = new Date();
        var nm = 'FLS阵元信号_帧' + st.pingIndex + '_' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) +
          ('0' + d.getDate()).slice(-2) + '_' + ('0' + d.getHours()).slice(-2) + ('0' + d.getMinutes()).slice(-2) + '.csv';
        FLS.download(nm, csv, 'text/csv;charset=utf-8');
        FLS.ok('阵元时域信号 CSV 已导出：' + M + ' 路 × ' + Math.ceil(nsamp / step) + ' 样本（I/Q + 预处理前后）。');
      } catch (e) { FLS.err('导出失败：' + e.message); }
    });
  };

  /* ==================================================================
   * 十一、尺寸 / 显示开关 / 初始化
   * ================================================================== */
  app.resizeAll = function () {
    /* V2.0：只 resize **当前可见视图**的画布。
       ① 隐藏视图的画布量不到真实尺寸（量到也没意义），切过去时自然会补一次；
       ② 每次最多动 3 块画布的后备存储，避免一次改 5 块带来的重排抖动。 */
    var view = (FLS.ui && FLS.ui.getView) ? FLS.ui.getView() : 'scene';
    if (view === 'scene') {
      FLS.scene3d.resize();
    } else if (view === 'image') {
      FLS.scene3d.resizeMini();        // 成像栏左上的 mini 三维视口
      /* ★ V3.5：虚拟摄像头视口。注意 resize 内部自己判「宽高 < 8 就不动」，
         所以 cam.on=false（DOM 被隐藏）时不会把相机 aspect 设成 0。 */
      if (FLS.camview && FLS.camview.resize) FLS.camview.resize();
      FLS.Imaging.resize();
      FLS.SigPlot.resize();
      // V3.2：表盘按 CSS 宽度重设后备存储（放大后不糊），必须在可见时量
      if (FLS.Cockpit && FLS.Cockpit.resize) FLS.Cockpit.resize();
    } else if (view === 'demo') {
      if (FLS.Demo && FLS.Demo.resize) FLS.Demo.resize();
    }
    if (FLS.state.last) redraw(); else FLS.SigPlot.clear();
  };

  /** 同步「视图设置」菜单中的勾选状态 */
  app.refreshDisplayChecks = function () {
    var st = FLS.state;
    document.querySelectorAll('.menu-item[data-act^="d-"]').forEach(function (it) {
      var key = it.dataset.act.slice(2);
      it.classList.toggle('on', !!st.display[key]);
    });
    /* V3.0：控制台从右栏移到底部，开关项随之由 'tog-right'（#rightPanels）
     * 改为统一的 'tog-console'（#bottomConsole）。 */
    ['tog-signal:sigCell', 'tog-left:leftPanels', 'tog-console:bottomConsole'].forEach(function (s) {
      var a = s.split(':');
      var it2 = document.querySelector('.menu-item[data-act="' + a[0] + '"]');
      var elx = document.getElementById(a[1]);
      if (it2 && elx) it2.classList.toggle('on', elx.style.display !== 'none');
    });
    /* V2.0：三视图是互斥的，菜单里只给当前视图打勾 */
    var curV = (FLS.ui && FLS.ui.getView) ? FLS.ui.getView() : 'scene';
    document.querySelectorAll('.menu-item[data-act^="view-"]').forEach(function (it) {
      it.classList.toggle('on', it.dataset.act === 'view-' + curV);
    });
  };

  function bindExtra() {
    var sv = q('sonarView');
    if (sv) sv.onchange = function () { app.onParamChange('sig'); FLS.log('扇形显示量切换为：' + sv.selectedOptions[0].textContent); };
    window.addEventListener('resize', function () { app.resizeAll(); });
    window.addEventListener('keydown', function (e) {
      if (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); app.pause(); }
      else if (e.code === 'KeyR' && e.shiftKey) { app.reset(); }
      /* V2.0：1 / 2 / 3 切换中栏三视图（三维场景设置 / 原理演示 / 前视声呐成像）。
         在原理演示视图里，[ / ] 再给「上一幕 / 下一幕」。 */
      else if (e.code === 'Digit1' || e.code === 'Numpad1') { if (FLS.ui.setView) FLS.ui.setView('scene'); }
      else if (e.code === 'Digit2' || e.code === 'Numpad2') { if (FLS.ui.setView) FLS.ui.setView('demo'); }
      else if (e.code === 'Digit3' || e.code === 'Numpad3') { if (FLS.ui.setView) FLS.ui.setView('image'); }
      else if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        if (FLS.ui.getView && FLS.ui.getView() === 'demo' && FLS.Demo) {
          if (e.code === 'BracketLeft') FLS.Demo.prev(); else FLS.Demo.next();
        }
      }
      // V1.2：B 切换海底地形笔刷（与三维视口工具栏「笔刷」按钮等价）
      else if (e.code === 'KeyB' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        if (FLS.scene3d && FLS.scene3d.setBrush) {
          FLS.scene3d.setBrush(!FLS.scene3d.brush.on);
          if (FLS.scene3d.brush.on && FLS.ui.setView) FLS.ui.setView('scene');
          FLS.ui.refreshBrushBtn();
          FLS.log(FLS.scene3d.brush.on
            ? '海底地形笔刷已开启：三维视口左键抬高 / 右键压低，Esc 退出。'
            : '海底地形笔刷已关闭。');
        }
      }
    });
  }

  /* ------------------------------------------------------------------ 启动 */
  function boot() {
    // 0) 主题必须在任何画布初始化之前落地：三维视口、信号绘图、声呐视口
    //    都要在初始化时读一次主题色，否则首帧会用错配色。
    FLS.Theme.boot();
    FLS.log('============================================');
    FLS.log('前视声呐时域信号级仿真系统 FLS-TDSIM V3.7 启动');
    FLS.log('============================================');
    FLS.log('阵列体制：一维水平均匀线阵（ULA），仅方位维波束形成；' +
      '垂直维覆盖由发射垂直开角与阵元垂直指向性决定。');

    /* 1) 三维场景（主视口 + 成像栏左上的 mini 跟随视口）
      2) 成像 / 信号 / 演示三块画布
      3) 界面
      ⚠ V2.0 顺序有讲究：ui.init() 末尾会 ui.setView('scene') → app.resizeAll()，
        而 resizeAll 要量各画布的尺寸。画布必须在 ui.init() 之前就 init 好，
        否则 resize 时拿到 null（实测报 "Cannot set properties of null (setting width)"）。 */
    FLS.scene3d.init(q('host3d'));
    FLS.scene3d.initMini(q('host3dMini'));
    /* ★ V3.5：虚拟摄像头视口（成像栏三维视口下方）。
       必须在 scene3d.init 之后 —— 它共享主视口的同一个 scene；
       也必须在 ui.init()（→ resizeAll）之前建好，否则 resize 拿到 null。 */
    if (FLS.camview && FLS.camview.init) FLS.camview.init(q('hostCam'));
    /* cam.on 的初始态（默认开）也要落一次，保证 DOM 与参数一致 ——
       载入工程 / 恢复默认走的是 setP('*') 路径，那时才会再同步一次。 */
    applyCamOn();
    FLS.Imaging.init();
    FLS.SigPlot.init();
    if (FLS.Demo && FLS.Demo.init) FLS.Demo.init();
    FLS.ui.init();
    FLS.ui._sigReady = true;
    /* V3.0：驾控台（姿态仪 / 航向罗盘 / 按键说明）与日志便签。
     * 两者都是纯 DOM/canvas 组件，不依赖画布尺寸，但依赖 state.rov 已就绪，
     * 所以放在 ui.init() 之后、loadTemplate 之前 —— 这样 loadTemplate 里
     * 重置 ROV 姿态后，驾控台能立刻读到新值。 */
    if (FLS.Cockpit && FLS.Cockpit.init) FLS.Cockpit.init();
    if (FLS.LogNote && FLS.LogNote.init) FLS.LogNote.init();
    FLS.Rov.init();
    // 4) 后台内核
    worker = buildWorker();
    FLS.state.workerReady = workers.length > 0;
    FLS.state.workerCount = workers.length;
    var em = q('engineMode');
    if (em) em.textContent = "内核: " + (workers.length
      ? "WebWorker ×{n}（并行）".replace('{n}', workers.length)
      : "主线程");
    /* 5) 初始场景
     * ★ V3.1：默认改为「平坦均质海底」（★ V3.4 起 100 m），不再自动载入算例模板。
     * 原因：① 用户要的默认值就是平坦均值海底；② 算例模板 1 原来还会自动补
     * 4 份随机地形（V3.0 的规则），每次打开海底都不一样，做算法对比时无法复现；
     * ③ 想要有起伏的海底，在「海底地形设置」页点一次「🎲 随机生成 5 种地形」即可。
     * 算例模板仍保留在「文件 → 算例模板」里，是三套自成体系的演示场景。 */
    FLS.ui.loadDefault();
    FLS.Rov.parseTrack();
    FLS.scene3d.syncTargets();
    FLS.scene3d.rebuildTerrain(FLS.state.rov.x, FLS.state.rov.y);
    FLS.scene3d.setCamera('iso');
    FLS.ui.fillChannels(elemCount());
    bindExtra();
    app.refreshDisplayChecks();
    app.resizeAll();
    // 主题变更时重绘画布类组件（三维背景/雾、信号绘图、声呐叠加层）
    FLS.Theme.onChange(function () {
      FLS.scene3d.applyTheme();
      if (FLS.camview && FLS.camview.applyTheme) FLS.camview.applyTheme();
      FLS.scene3d.rebuildTerrain();
      FLS.scene3d.updateDepthLegend();
      FLS.Imaging.resize();
      if (FLS.state.last) redraw();
      else { FLS.SigPlot.resize(); FLS.SigPlot.clear(); }
    });
    FLS.scene3d.updateDepthLegend();

    var c = FLS.Env.profileAt(FLS.state.rov.z);
    FLS.log('初始化完成：声速 ' + c.toFixed(1) + ' m/s，λ = ' + (c / (P('tx.fc') * 1000) * 1000).toFixed(2) +
      ' mm，阵元 ' + elemCount() + ' 路。');
    FLS.log('提示：点击「启动仿真」后用 W/S 前后、A/D 转向、↑/↓ 抬头低头、←/→ 升降高度驾驶 ROV；或先点「单步」观察一次脉冲的完整链路。');
    FLS.log('版面：左栏七页参数（地形→目标→环境→载体→发射→阵列→成像处理）；' +
      '中栏三视图（三维场景设置 / 原理演示 / 前视声呐成像），下接一长条仿真控制台。' +
      'V3.1：默认场景为平坦均质海底（★ V3.4 起 100 m，并自带 5 个随机目标，布在声呐周围 100 m 内）；从地形库新加的地形先调属性（三维实时预览），' +
      '点「✔ 确认并栅格化」后与已有地形融合成一张按量程自适应格数的海底深度图，' +
      '此后引擎按栅格查表，加再多地形也不会越跑越卡；海底默认色标为水深色标（深蓝→绿→黄→红），' +
      '三维场景去雾、降环境光、提定向光，起伏层次更清楚。');

    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
