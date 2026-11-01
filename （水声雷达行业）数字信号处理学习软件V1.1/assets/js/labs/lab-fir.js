/* =============================================================
   lab-fir.js —— 实验台⑧：FIR 滤波器设计与滤波对比
   路由：#/lab/fir

   教学主线：窗函数法设计 FIR 只有三件事要同时盯住
     ① 过渡带宽度  ≈ 窗主瓣宽(bin) × fs/N     —— 由阶数 N 与窗型共同决定
     ② 阻带衰减    ≈ 窗的旁瓣电平             —— 几乎只由窗型决定
     ③ 群延迟      = (N−1)/2 样点             —— 线性相位 FIR 改不掉的固有延迟
   本台把这三个量都做成"可实测"的：过渡带与阻带衰减直接从幅频响应曲线上量，
   延迟直接从滤波前后的波形上看，再给出 filtfilt 零相位方案的代价。
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const C = DSP.core;
  const U = DSP.util;
  const UI = DSP.ui;
  const h = U.h;

  const FS = 8000;            // 采样率 Hz
  const NS = 1024;            // 处理长度（样点），时长 128 ms
  const NFREQ = 512;          // freqz 频点数（兼顾精度与拖动流畅度）
  const WS = { rect: '矩形窗', bartlett: '三角窗', hann: '汉宁窗', hamming: '汉明窗', blackman: '布莱克曼窗', blackmanharris: '布莱克曼-哈里斯窗' };

  /* 窗指标实测较贵，按窗型缓存 */
  const WM = {};
  function wm(t) {
    if (!WM[t]) WM[t] = C.windowMetrics(t);
    return WM[t];
  }

  /* 设计结果缓存：只在设计参数变化时重算 freqz */
  let dsgCache = { key: '', h: null, H: null };
  function design(st) {
    const lo = st.fc;
    const hi = Math.max(lo + 0.04, st.fc2);
    const key = [st.type, st.order, lo.toFixed(4), hi.toFixed(4), st.win].join('|');
    if (dsgCache.key === key) return dsgCache;
    const hh = C.firWin({ order: st.order, type: st.type, fc: lo, fc2: hi, win: st.win });
    const H = C.freqz(hh, [1], NFREQ, FS);
    dsgCache = { key: key, h: hh, H: H };
    return dsgCache;
  }

  /**
   * 通带 / 阻带的归一化区间（各取一段，保证非退化）
   * g 为保护带宽度（归一化频率），取窗主瓣宽/N，把过渡带从"阻带"里剔除，
   * 否则实测阻带衰减会被过渡带斜坡主导，量出来的不是窗的真实旁瓣电平。
   */
  function regions(type, lo, hi, g) {
    g = Math.min(Math.max(g, 0.012), 0.12);
    let pass, stop;
    if (type === 'low') {
      pass = [0.004, Math.max(0.012, lo * 0.7)];
      stop = [Math.min(0.49, lo + g), 0.49];
      if (stop[1] - stop[0] < 0.006) stop = [0.492, 0.498];
    } else if (type === 'high') {
      pass = [Math.min(0.48, lo + g), 0.49];
      stop = [0.004, Math.max(0.012, lo * 0.7)];
      if (pass[1] - pass[0] < 0.006) pass = [0.492, 0.498];
    } else if (type === 'band') {
      pass = [(2 * lo + hi) / 3, (lo + 2 * hi) / 3];
      stop = [Math.min(0.49, hi + g), 0.49];
      if (stop[1] - stop[0] < 0.006) stop = [0.004, Math.max(0.012, lo * 0.7)];
    } else {
      pass = [Math.min(0.48, hi + g), 0.49];
      stop = [(2 * lo + hi) / 3, (lo + 2 * hi) / 3];
      if (pass[1] - pass[0] < 0.006) pass = [0.004, Math.max(0.012, lo * 0.7)];
    }
    if (pass[1] <= pass[0]) pass = [0.02, 0.04];
    if (stop[1] <= stop[0]) stop = [0.42, 0.47];
    return {
      pass: pass, stop: stop,
      fPass: (pass[0] + pass[1]) / 2,
      fStop: (stop[0] + stop[1]) / 2
    };
  }

  /** 加汉宁窗、补零到 NF 点的 dB 谱（归一化到各自最大值） */
  function specDb(v, NF) {
    const w = C.window('hann', v.length);
    const xw = new Float64Array(v.length);
    for (let i = 0; i < v.length; i++) xw[i] = v[i] * w[i];
    const S = C.fft(xw, NF);
    const half = Math.floor(NF / 2) + 1;
    const out = new Float64Array(half);
    let mx = 1e-12;
    for (let i = 0; i < half; i++) {
      const m = Math.sqrt(S.re[i] * S.re[i] + S.im[i] * S.im[i]);
      if (m > mx) mx = m;
      out[i] = m;
    }
    for (let i = 0; i < half; i++) out[i] = 20 * Math.log10(Math.max(out[i], 1e-12) / mx);
    return out;
  }

  /**
   * lab-kit 的 ui.explain 只写入 data-tex 占位符，KaTeX 渲染只在整页渲染时做一次；
   * 调参重写解读区后公式会变回空占位 —— 这里补一次渲染。
   */
  function renderExplainMath() {
    const cos = document.querySelectorAll('.callout.note');
    for (let i = 0; i < cos.length; i++) {
      if (cos[i].textContent.indexOf('画面解读') >= 0) { UI.renderMathIn(cos[i]); return; }
    }
  }

  /* ------------------------- 更新 ------------------------- */
  // 预热：windowMetrics 内部要做 65536 点 FFT（约 40 ms），放在空闲时段先算好，
  // 避免用户第一次切窗时卡顿。
  setTimeout(function () {
    ['rect', 'bartlett', 'hann', 'hamming', 'blackman', 'blackmanharris'].forEach(function (t) { try { wm(t); } catch (e) {} });
  }, 60);

  function update(st, P, ui) {
    const order = Math.round(st.order);
    const Nt = order + 1;                       // 抽头数
    const lo = st.fc;
    const hi = Math.max(lo + 0.04, st.fc2);
    const twoBand = st.type === 'band' || st.type === 'stop';

    const D = design(st);
    const hh = D.h, H = D.H;
    const M = wm(st.win);
    const transHz = M.mainLobe * FS / Nt;       // 过渡带宽度估计（先算，作区域保护带用）
    const R = regions(st.type, lo, hi, M.mainLobe / Nt);

    const gdTheo = C.firGroupDelay(order);      // (N−1)/2 样点
    const gdMs = gdTheo / FS * 1000;

    /* ---- 实测阻带衰减 / 通带波纹 ---- */
    const half = Math.floor(NFREQ / 2) + 1;
    let attStop = -Infinity, rippleMax = -Infinity, rippleMin = Infinity;
    for (let i = 0; i < half; i++) {
      const fn = H.f[i] / FS;                   // 归一化频率（0…0.5）
      const db = H.magDb[i];
      if (fn >= R.stop[0] && fn <= R.stop[1]) { if (db > attStop) attStop = db; }
      if (fn >= R.pass[0] && fn <= R.pass[1]) { if (db > rippleMax) rippleMax = db; if (db < rippleMin) rippleMin = db; }
    }
    if (!isFinite(attStop)) attStop = 0;
    const ripple = isFinite(rippleMax) && isFinite(rippleMin) ? (rippleMax - rippleMin) : 0;

    /* ---- 群延迟实测 ---- */
    const gd = new Float64Array(half);
    for (let i = 1; i < half - 1; i++) {
      gd[i] = -(H.phase[i + 1] - H.phase[i - 1]) / (H.w[i + 1] - H.w[i - 1]);
    }
    if (half > 2) { gd[0] = gd[1]; gd[half - 1] = gd[half - 2]; }

    /* ---- 被测信号 ---- */
    const t = C.timeAxis(NS, FS);
    const fPass = (R.fPass || 0.1) * FS;
    const fStop = (R.fStop || 0.4) * FS;
    const clean = new Float64Array(NS);
    const extra = new Float64Array(NS);         // 期望被滤掉的成分
    if (st.sig === 'dual') {
      for (let i = 0; i < NS; i++) {
        clean[i] = Math.sin(2 * Math.PI * fPass * t[i]);
        extra[i] = 0.8 * Math.sin(2 * Math.PI * fStop * t[i]);
      }
    } else if (st.sig === 'chirp') {
      const ch = C.chirp(NS, FS, 20, 3600);
      let mx = 0;
      for (let i = 0; i < NS; i++) mx = Math.max(mx, Math.abs(ch[i]));
      for (let i = 0; i < NS; i++) clean[i] = mx > 0 ? ch[i] / mx : 0;
    } else {
      for (let i = 0; i < NS; i++) clean[i] = Math.sin(2 * Math.PI * fPass * t[i]);
    }
    const base = new Float64Array(NS);
    for (let i = 0; i < NS; i++) base[i] = clean[i] + extra[i];
    let pb = 0;
    for (let i = 0; i < NS; i++) pb += base[i] * base[i];
    pb /= NS;
    const sigma = Math.sqrt(pb / Math.pow(10, st.snr / 10));
    const ng = U.randn(NS, 20240921);
    const x = new Float64Array(NS);
    for (let i = 0; i < NS; i++) x[i] = base[i] + sigma * ng[i];

    /* ---- 滤波 ---- */
    const zero = !!st.zero;
    const filt = (b, a, v) => zero ? C.filtfilt(b, a, v) : C.filter(b, a, v);
    const y = filt(hh, [1], x);
    const yRef = filt(hh, [1], clean);

    const snrIn = C.measSNR(x, clean);
    const snrOut = C.measSNR(y, yRef);
    const snrGain = snrOut - snrIn;

    /* ---- 阻带抑制实测 ---- */
    const NFS = 2048;
    const Sx = specDb(x, NFS), Sy = specDb(y, NFS);
    const fS = C.fftFreqHalf(NFS, FS);
    let pin = 0, pout = 0, cnt = 0;
    for (let i = 0; i < fS.length; i++) {
      const fn = fS[i] / FS;
      if (fn < R.stop[0] || fn > R.stop[1]) continue;
      pin += Math.pow(10, Sx[i] / 10);
      pout += Math.pow(10, Sy[i] / 10);
      cnt++;
    }
    const suppDb = cnt ? 10 * Math.log10(Math.max(pin, 1e-30) / Math.max(pout, 1e-30)) : 0;

    /* ---- 对称性 / 线性相位判定 ---- */
    let symErr = 0;
    for (let i = 0; i < Nt; i++) symErr = Math.max(symErr, Math.abs(hh[i] - hh[Nt - 1 - i]));
    const linearPhase = symErr < 1e-10;
    const typeII = (Nt % 2 === 0);              // 抽头数为偶 → II 型（z=−1 处强制零点）

    /* ================= ① 系数 ================= */
    const p1 = P.hn.plot;
    p1.clear()
      .add({ x: C.arange(Nt), y: hh, type: 'stem', color: 0, width: 1.8, label: 'h[n]' })
      .draw();

    /* ================= ② 幅频响应 ================= */
    const fkHz = new Float64Array(half);
    const mgDb = new Float64Array(half);
    for (let i = 0; i < half; i++) { fkHz[i] = H.f[i]; mgDb[i] = H.magDb[i]; }
    const p2 = P.mag.plot;
    p2.opts.xlim = [0, FS / 2];
    p2.opts.ylim = [-110, 6];
    p2.clear()
      .add({ x: fkHz, y: mgDb, type: 'line', color: 0, width: 1.6, label: '|H| / dB' })
      .hline(attStop, { label: '实测阻带衰减 ' + U.fmt(attStop, 1) + ' dB' });
    p2.band(R.stop[0] * FS, R.stop[1] * FS, { color: U.themeColor('--danger') || '#b91c1c', alpha: 0.09 });
    p2.draw();

    /* ================= ③ 群延迟 ================= */
    const gdv = new Float64Array(half);
    const loY = gdTheo - 26, hiY = gdTheo + 26;
    for (let i = 0; i < half; i++) gdv[i] = Math.max(loY, Math.min(hiY, gd[i]));
    const p3 = P.gd.plot;
    p3.opts.xlim = [0, FS / 2];
    p3.opts.ylim = [loY, hiY];
    p3.clear()
      .add({ x: fkHz, y: gdv, type: 'line', color: 2, width: 1.5, label: '实测群延迟（纵轴已限幅）' })
      .hline(gdTheo, { label: '理论 (N−1)/2 = ' + U.fmt(gdTheo, 1) + ' 样点' });
    p3.band(R.pass[0] * FS, R.pass[1] * FS, { color: U.themeColor('--plot-c1') || '#1b5aa4', alpha: 0.10 });
    p3.draw();

    /* ================= ④ 时域对比 ================= */
    const gdI = Math.round(gdTheo);
    const yAl = new Float64Array(NS);
    for (let i = 0; i < NS; i++) yAl[i] = (i + gdI < NS) ? y[i + gdI] : 0;
    const p4 = P.td.plot;
    p4.clear()
      .add({ x: t, y: x, type: 'line', color: 3, width: 1, alpha: 0.75, label: '滤波前（含干扰+噪声）' })
      .add({ x: t, y: y, type: 'line', color: 0, width: 1.6, label: '滤波后（含固有延迟）' })
      .add({ x: t, y: yAl, type: 'line', color: 2, width: 1.4, dash: [5, 3], label: '滤波后（左移补偿群延迟）' })
      .draw();

    /* ================= ⑤ 频谱对比 ================= */
    const p5 = P.sp.plot;
    p5.opts.xlim = [0, FS / 2];
    p5.opts.ylim = [-95, 6];
    p5.clear()
      .add({ x: fS, y: Sx, type: 'line', color: 3, width: 1, alpha: 0.8, label: '滤波前' })
      .add({ x: fS, y: Sy, type: 'line', color: 0, width: 1.5, label: '滤波后' })
      .vline(fStop, { label: '阻带探针 ' + U.fmt(fStop, 0) + ' Hz' })
      .vline(fPass, { label: '通带探针 ' + U.fmt(fPass, 0) + ' Hz' })
      .draw();

    /* ================= 解读 ================= */
    const sigName = st.sig === 'dual' ? '双音（一个通带内 + 一个阻带内）'
      : (st.sig === 'chirp' ? '啁啾扫频 20→3600 Hz' : '单音 + 宽带噪声');

    let zeroTxt = '';
    if (zero) {
      zeroTxt = '**零相位模式已开启**：输出用 $filtfilt$ 前后各滤一次，相位延迟被完全抵消（上图中绿色虚线与蓝色实线重合），' +
        '代价是——① 必须拿到整段数据才能开工，**不能实时**；② 幅频响应变成 $|H|^2$，阻带衰减看起来翻倍（实际是滤了两遍）；' +
        '③ 首尾各约 $N/2 = ' + Math.round(Nt / 2) + '$ 点存在边缘瞬变（本图两端能看到轻微翘起）。';
    } else {
      zeroTxt = '**延迟是固有的**：输出整体比输入晚 $' + U.fmt(gdTheo, 1) + '$ 样点 = **' + U.fmt(gdMs, 2) +
        ' ms**。这不是设计得不好，而是因果 FIR 拿到线性相位必须付的代价 —— ' +
        '图中蓝色实线整体右移，绿色虚线是人为左移补偿后的样子，二者波形完全重合，说明这个延迟是**纯时移、零波形失真**。' +
        '想去掉它只能走零相位（勾上"零相位滤波"）或改用最小相位 IIR，但前者不可实时、后者会带来相位失真。';
    }

    let typeTxt = '系数严格对称 → **相位严格线性**（对称性误差 ' + symErr.toExponential(1) + '）。';
    if (typeII) {
      typeTxt = '抽头数 $N = ' + Nt + '$ 为偶数，属 **II 型线性相位 FIR**：$z=-1$（$\\omega=\\pi$）处必有强制零点，' +
        '因此**不能用来做理想高通**——把类型切到高通并把 $f_c$ 推到 0.45 以上，你会看到幅频响应在 4000 Hz 附近被硬拉到 0。' +
        '阶数为偶数（$N$ 为奇数，I 型）时没有这个限制。';
    }

    ui.explain(
      '**当前设计**：' + (st.type === 'low' ? '低通' : st.type === 'high' ? '高通' : st.type === 'band' ? '带通' : '带阻') +
      '，阶数 ' + order + '（抽头 $N = ' + Nt + '$），' + (WS[st.win] || st.win) + '，$f_c = ' + U.fmt(lo, 2) +
      '\\times f_s = ' + U.fmt(lo * FS, 0) + ' Hz' + (twoBand ? '，第二截止 ' + U.fmt(hi * FS, 0) + ' Hz$' : '$') + '。\n\n' +

      '**三个硬指标（都从曲线上实测）**：\n' +
      '· 过渡带宽 ≈ 窗主瓣 ' + U.fmt(M.mainLobe, 2) + ' bin × $f_s/N$ = **' + U.fmt(transHz, 1) + ' Hz**' +
      '（"截止频率"其实是一条宽 ' + U.fmt(transHz, 1) + ' Hz 的斜坡，阶数翻倍它就减半）；\n' +
      '· 阻带衰减 = **' + U.fmt(attStop, 1) + ' dB**（在阻带区取到的最大值，几乎只由窗型决定：矩形窗 -21 dB、汉明窗约 -53 dB、布莱克曼-哈里斯可到 -90 dB 以上）；\n' +
      '· 通带波纹 = **' + U.fmt(ripple, 2) + ' dB**（通带内幅度响应的起伏，来自理想响应的吉布斯振荡被窗压平后的残留）。\n\n' +

      '**群延迟 = (N−1)/2 = ' + U.fmt(gdTheo, 1) + ' 样点 = ' + U.fmt(gdMs, 2) + ' ms**（$f_s = 8000$ Hz）。' +
      typeTxt + '\n\n' + zeroTxt + '\n\n' +

      '**实测滤波效果**（被测信号：' + sigName + '，输入 SNR = ' + U.fmt(st.snr, 0) + ' dB）：\n' +
      '· 阻带频段（约 ' + U.fmt(fStop, 0) + ' Hz 附近）的谱电平被压低 **' + U.fmt(suppDb, 1) + ' dB**；\n' +
      '· 输出 SNR 由 ' + U.fmt(snrIn, 1) + ' dB 提升到 ' + U.fmt(snrOut, 1) + ' dB，**改善 ' + U.fmt(snrGain, 1) +
      ' dB**（口径：保留成分功率 / 残留干扰功率，残留 = 输出 − 同样经过该滤波器的理想带内信号）。\n\n' +

      '**画面怎么看**：左上 $h[n]$ 是对称的（所以相位是直线）；右上幅频响应的红色阴影区是阻带，虚线标出实测阻带衰减；' +
      '右下频谱图上两条竖虚线是通带 / 阻带探针，滤波后蓝色曲线在探针处的落差就是上面那个 ' + U.fmt(suppDb, 1) + ' dB。' +
      (st.sig === 'chirp' ? '啁啾信号的阻带段被整体切掉，频谱上能看到一条清晰的"断崖"，而通带段完好保留 —— 这正是扫频法测滤波器响应的原理。'
        : '注意通带内的信号幅度基本不变（线性相位 FIR 只延迟不失真），变的只是阻带里的东西。')
    );
    renderExplainMath();

    ui.metrics([
      { label: '阶数 N−1 / 抽头', value: order + ' / ' + Nt, unit: '' },
      { label: '阻带衰减', value: U.fmt(attStop, 1), unit: 'dB' },
      { label: '过渡带宽', value: U.fmt(transHz, 1), unit: 'Hz' },
      { label: '群延迟', value: U.fmt(gdTheo, 1), unit: '样点' },
      { label: '群延迟', value: U.fmt(gdMs, 2), unit: 'ms' },
      { label: 'SNR 改善', value: U.fmt(snrGain, 1), unit: 'dB' },
      { label: '阻带抑制', value: U.fmt(suppDb, 1), unit: 'dB' },
      { label: '通带波纹', value: U.fmt(ripple, 2), unit: 'dB' }
    ]);
  }

  /* ------------------------- 注册 ------------------------- */
  DSP.lab.create({
    path: 'lab/fir',
    title: 'FIR 滤波器设计与滤波对比',
    lede: '窗函数法三件事：过渡带有多宽、阻带衰减有多少、群延迟有多长。这里三个量都能从曲线上直接量出来，并且能立刻看到滤波前后到底压掉了几个 dB。',
    tags: ['FIR', '窗函数法', '线性相位', '群延迟', '交互实验台'],
    params: [
      {
        k: 'type', type: 'seg', label: '滤波器类型', value: 'low',
        options: [
          { value: 'low', label: '低通' },
          { value: 'high', label: '高通' },
          { value: 'band', label: '带通' },
          { value: 'stop', label: '带阻' }
        ],
        hint: '带通 / 带阻时第二截止由 fc2 决定'
      },
      {
        k: 'order', type: 'slider', label: '阶数（抽头数减一）', min: 8, max: 200, step: 2, value: 64,
        fmt: v => String(Math.round(v)),
        hint: '阶数每翻一倍，过渡带宽度减半，但群延迟也翻倍'
      },
      {
        k: 'fc', type: 'slider', label: '截止频率 fc（归一化）', min: 0.02, max: 0.48, step: 0.01, value: 0.15,
        fmt: v => U.fmt(v, 2) + '（' + U.fmt(v * FS, 0) + ' Hz）',
        hint: '归一化到采样率：0.5 对应 fs/2 = 4000 Hz'
      },
      {
        k: 'fc2', type: 'slider', label: '第二截止 fc2（带通/带阻）', min: 0.05, max: 0.49, step: 0.01, value: 0.35,
        fmt: v => U.fmt(v, 2) + '（' + U.fmt(v * FS, 0) + ' Hz）',
        hint: '仅在带通 / 带阻时生效；内部保证 fc2 ≥ fc + 0.04'
      },
      {
        k: 'win', type: 'select', label: '窗函数', value: 'hamming',
        options: [
          { value: 'rect', label: '矩形窗（过渡带最窄，阻带仅 -21 dB）' },
          { value: 'bartlett', label: '三角窗（巴特利特）' },
          { value: 'hann', label: '汉宁窗' },
          { value: 'hamming', label: '汉明窗（通用首选）' },
          { value: 'blackman', label: '布莱克曼窗' },
          { value: 'blackmanharris', label: '布莱克曼-哈里斯窗（阻带最深）' }
        ],
        hint: '窗型决定阻带衰减，阶数决定过渡带宽，二者互不相干'
      },
      {
        k: 'sig', type: 'seg', label: '被测信号', value: 'dual',
        options: [
          { value: 'dual', label: '双音' },
          { value: 'chirp', label: '啁啾扫频' },
          { value: 'tone', label: '单音+噪声' }
        ],
        hint: '双音的一个音落在通带内、另一个落在阻带内，抑制效果最直观'
      },
      {
        k: 'snr', type: 'slider', label: '输入信噪比', min: -10, max: 30, step: 1, value: 10, unit: 'dB',
        hint: '只改变叠加的宽带噪声，不改变滤波器本身'
      },
      {
        k: 'zero', type: 'toggle', label: '零相位滤波（filtfilt）：延迟消失，但不可实时', value: false
      }
    ],
    plots: [
      { key: 'hn', title: '① 滤波器系数 h[n]（对称 → 线性相位）', height: 220, opts: { xlabel: 'n', ylabel: 'h[n]' } },
      { key: 'mag', title: '② 幅频响应（红色阴影 = 阻带，虚线 = 实测衰减）', height: 240, opts: { xlabel: 'f / Hz', ylabel: '|H| / dB', legend: true } },
      { key: 'gd', title: '③ 群延迟（蓝色阴影 = 通带；常数 = 线性相位）', height: 240, opts: { xlabel: 'f / Hz', ylabel: '群延迟 / 样点', legend: true } },
      { key: 'td', title: '④ 滤波前后时域对比', height: 240, opts: { xlabel: 't / s', ylabel: '幅度', legend: true } },
      { key: 'sp', title: '⑤ 滤波前后频谱对比（竖虚线 = 通带 / 阻带探针）', height: 260, opts: { xlabel: 'f / Hz', ylabel: '幅度 / dB', legend: true } }
    ],
    cols: 2,
    update: update,
    advice: '先把类型固定在低通、窗选汉明窗，把阶数从 8 拉到 200：过渡带肉眼可见地变窄，同时看指标里的群延迟从 4 样点涨到 100 样点（12.5 ms）——这就是"性能越好、延迟越大"的直接证据。然后固定阶数 64，把窗从矩形逐个切到布莱克曼-哈里斯：过渡带会变宽约 3 倍，但阻带衰减从 -21 dB 一路压到 -90 dB 以下。想看"II 型 FIR 不能做高通"，把阶数调成奇数（如 65）、类型选高通、fc 推到 0.46，幅频响应会在 4000 Hz 处被硬拉到零。最后勾上零相位，对比绿色虚线与蓝色实线是否重合。',
    eng: '教科书上说"N 越大越好"，但实时系统里 N 直接决定群延迟：本台 200 阶、8 kHz 采样下延迟 100 样点 = 12.5 ms；水声链路里 12.5 ms 乘以声速 1500 m/s 再除以 2（往返）就是约 9.4 m 的斜距偏差，做测距与成像时必须先把这项从时序预算里扣掉，或改用零相位离线处理。窗型的选择则相反：它几乎只影响阻带衰减而与阶数无关，强干扰背景下（比如被动声呐里有强线谱）应优先选高旁瓣抑制的窗，别为了窄过渡带去用矩形窗——矩形窗 -21 dB 的阻带会让强干扰漏进来，后面的检测器直接饱和。另外，设计完务必用实测的 min(N) 抽头数跑一遍目标硬件的乘加预算：N 抽头 × 采样率 = 每秒乘加次数，200 阶 × 48 kHz 就是 960 万次/秒。',
    wrong: '典型错误一：把"阶数 = 抽头数"搞混，导致群延迟算错一半——线性相位 FIR 的群延迟是 (N−1)/2，其中 N 是抽头数，不是阶数。典型错误二：为了压窄过渡带把阶数一路加高，忘了延迟预算；在闭环控制或实时测距里，几十毫秒的滤波延迟足以让系统失稳或产生米级测距偏差。典型错误三：用 II 型（偶数抽头）FIR 去做高通，结果 Nyquist 附近被强制置零，高端频段整个塌掉，还以为是设计参数没调好。典型错误四：把 filtfilt 的阻带衰减当成滤波器的真实阻带——那是滤了两遍的结果（数值上翻倍），实时系统里根本拿不到这个性能。',
    see: [
      { path: 'theory/filter/win-design', title: '窗函数法设计 FIR' },
      { path: 'theory/filter/linear-phase', title: '线性相位 FIR 与吉布斯现象' }
    ]
  });
})(window);
