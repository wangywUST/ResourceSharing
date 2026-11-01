/* =============================================================
   lab-stft.js —— 实验台⑤：STFT 时频分辨率权衡
   路由：#/lab/stft

   教学主线：短时傅里叶变换只有「一个自由度」——窗长 N_win。
     · 窗越长 → 频率分辨率越好（Δf = fs/N_win 越小），时间分辨率越差；
     · 窗越短 → 时间定位越准，谱线越粗、旁瓣拖影越重。
   本台用 5 类典型信号（啁啾 / 分时段双音 / 瞬态脉冲 / 频率跳变 / 调幅）
   把「热图上那条脊线为什么变粗 / 变淡 / 出现假频率」讲成可量化的账。
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const C = DSP.core;
  const U = DSP.util;
  const UI = DSP.ui;
  const h = U.h;

  const FS = 2000;          // 采样率 Hz（固定）
  const N = 2048;           // 信号长度（样点），时长 1.024 s
  const DUR = N / FS;

  /* 窗指标实测较贵（内部做 65536 点 FFT），按窗型缓存一次即可 */
  const WM_CACHE = {};
  function wm(type) {
    if (!WM_CACHE[type]) WM_CACHE[type] = C.windowMetrics(type);
    return WM_CACHE[type];
  }

  const WIN_NAME = {
    rect: '矩形窗', hann: '汉宁窗', hamming: '汉明窗', blackman: '布莱克曼窗'
  };

  /* ------------------------- 信号合成 ------------------------- */
  const SIG_CACHE = {};

  function buildSignal(kind) {
    if (SIG_CACHE[kind]) return SIG_CACHE[kind];
    let x = new Float64Array(N);
    if (kind === 'chirp') {
      // 100 → 700 Hz 线性调频，斜率约 586 Hz/s
      x = C.chirp(N, FS, 100, 700);
    } else if (kind === 'dual') {
      // 100 Hz（0~0.45 s）与 130 Hz（0.45~1.024 s）严格分时段
      for (let i = 0; i < N; i++) {
        const t = i / FS;
        x[i] = t < 0.45 ? Math.sin(2 * Math.PI * 100 * t) : Math.sin(2 * Math.PI * 130 * t + 0.6);
      }
    } else if (kind === 'pulse') {
      // 两个 500 Hz 高斯包络脉冲：中心 0.18 s 与 0.62 s，半幅宽约 18 ms
      const p1 = C.gaussPulse(N, FS, 500, 30, 0.18);
      const p2 = C.gaussPulse(N, FS, 500, 30, 0.62);
      for (let i = 0; i < N; i++) x[i] = p1[i] + p2[i];
    } else if (kind === 'jump') {
      // 前段 100 Hz，后段 400 Hz，跳变发生在第 1024 点（0.512 s）
      for (let i = 0; i < N; i++) {
        const t = i / FS;
        x[i] = i < 1024 ? Math.sin(2 * Math.PI * 100 * t) : Math.sin(2 * Math.PI * 400 * t);
      }
    } else {
      // 调幅：载波 500 Hz，调制 20 Hz，调制度 0.8 → 边带 480 / 520 Hz
      x = C.am(N, FS, 500, 20, 0.8);
    }
    let mx = 0;
    for (let i = 0; i < N; i++) if (Math.abs(x[i]) > mx) mx = Math.abs(x[i]);
    if (mx > 0) for (let i = 0; i < N; i++) x[i] /= mx;
    SIG_CACHE[kind] = x;
    return x;
  }

  /** 取以 center 为中心、长度 L 的一段，加窗后补零到 NF 点，返回 dB 谱 */
  function frameSpectrumDb(x, center, L, winType, NF) {
    let s = Math.round(center - L / 2);
    s = Math.max(0, Math.min(N - L, s));
    const w = C.window(winType, L);
    const seg = new Float64Array(L);
    let e = 0;
    for (let i = 0; i < L; i++) { seg[i] = x[s + i] * w[i]; e += w[i] * w[i]; }
    const F = C.fft(seg, NF);
    const half = Math.floor(NF / 2) + 1;
    const out = new Float64Array(half);
    let mx = 0;
    for (let i = 0; i < half; i++) {
      const m = Math.sqrt(F.re[i] * F.re[i] + F.im[i] * F.im[i]);
      if (m > mx) mx = m;
      out[i] = m;
    }
    for (let i = 0; i < half; i++) out[i] = 20 * Math.log10(Math.max(out[i], 1e-12) / Math.max(mx, 1e-12));
    return out;
  }

  /**
   * lab-kit 的 ui.explain 只写入 data-tex 占位符，KaTeX 渲染只在整页渲染时做一次；
   * 参数一动、解读区被重写，公式就会变回空占位 —— 这里补一次渲染。
   */
  function renderExplainMath() {
    const cos = document.querySelectorAll('.callout.note');
    for (let i = 0; i < cos.length; i++) {
      if (cos[i].textContent.indexOf('画面解读') >= 0) { UI.renderMathIn(cos[i]); return; }
    }
  }

  /* ------------------------- 更新函数 ------------------------- */
  // 预热：windowMetrics 内部要做 65536 点 FFT（约 40 ms），放在空闲时段先算好，
  // 避免用户第一次切窗时卡顿。
  setTimeout(function () {
    ['rect', 'hann', 'hamming', 'blackman'].forEach(function (t) { try { wm(t); } catch (e) {} });
  }, 60);

  function update(st, P, ui) {
    const winLen = 1 << (Math.round(st.winExp) | 0);          // 32 / 64 / 128 / 256 / 512
    const ovPct = st.overlap;
    const ov = ovPct / 100;
    const hop = Math.max(1, Math.round(winLen * (1 - ov)));
    const zpf = Number(st.zpf) || 1;
    const nfft = winLen * zpf;
    const winType = st.win;
    const M = wm(winType);

    const x = buildSignal(st.sig);
    const ST = C.stft(x, { winLen: winLen, hop: hop, win: winType, nfft: nfft, fs: FS });

    /* ---- 分辨率账 ---- */
    const df = FS / winLen;                       // Δf = fs / N_win
    const dtMs = winLen / FS * 1000;              // Δt = N_win / fs
    const dfGrid = FS / nfft;                     // 补零后的谱线间隔（插值，不是真分辨率）
    const resHz = M.mainLobe * FS / winLen;       // 主瓣宽换算的可分辨最小间隔
    const needN30 = Math.ceil(M.mainLobe * FS / 30);
    const can30 = resHz <= 30;

    /* ================= ① 时域波形 ================= */
    const tAxis = C.timeAxis(N, FS);
    const pt = P.time.plot;
    pt.clear()
      .band(0, winLen / FS, { color: U.themeColor('--plot-c1') || '#1b5aa4', alpha: 0.16 })
      .band(hop / FS, (hop + winLen) / FS, { color: U.themeColor('--plot-c2') || '#c2410c', alpha: 0.14 })
      .add({ x: tAxis, y: x, type: 'line', width: 1.1, color: 0, label: 'x[n]' })
      .vline(winLen / FS, { label: '第 1 帧窗 [' + (winLen / FS * 1000).toFixed(0) + ' ms]', dash: [4, 3] })
      .vline((hop + winLen) / FS, { label: '第 2 帧窗尾', dash: [2, 3] })
      .draw();

    /* ================= ② 时频热图 ================= */
    let vmax = -Infinity;
    for (let i = 0; i < ST.S.length; i++) if (ST.S[i] > vmax) vmax = ST.S[i];
    const vmin = vmax - 60;

    // 像素预算：热图逐像素上色，格点太多会拖慢拖动响应；
    // 超预算时均匀抽稀（热图本来就是放大插值显示，视觉上无差别），并只在帧方向抽
    let dc = 1, dr = 1;
    const BUDGET = 20000;
    while (Math.ceil(ST.frames / dc) * Math.ceil(ST.bins / dr) > BUDGET) {
      if (ST.frames / dc >= ST.bins / dr) dc++; else dr++;
    }
    const nC = Math.ceil(ST.frames / dc), nR = Math.ceil(ST.bins / dr);
    let hmData = ST.S, hmCols = ST.frames;
    let xLabel = '帧序号 m（hop = ' + hop + ' 点，共 ' + ST.frames + ' 帧）';
    if (dc > 1 || dr > 1) {
      hmData = new Float32Array(nC * nR);
      for (let m = 0; m < nC; m++) {
        const src = (m * dc) * ST.bins;
        for (let k = 0; k < nR; k++) hmData[m * nR + k] = ST.S[src + k * dr];
      }
      hmCols = nC;
      xLabel += '，显示抽稀 ' + (dc > 1 ? '帧×' + dc : '') + (dr > 1 ? (dc > 1 ? ' / ' : '') + '频点÷' + dr : '');
    }
    DSP.plot.heatmap(P.tf.canvas, {
      data: hmData, cols: hmCols, rows: nR,
      xlim: [0, hmCols - 1], ylim: [0, FS / 2],
      xlabel: xLabel,
      ylabel: '频率 / Hz', title: '',
      vmin: vmin, vmax: vmax, height: 320, flipY: true
    });

    /* ================= ③ 单帧频谱对比 ================= */
    const cmpLen = winLen >= 128 ? Math.max(32, winLen / 4) : Math.min(512, winLen * 4);
    const NF = 1024;                              // 两条曲线用同一频率网格，只让主瓣宽不同
    const fGrid = C.fftFreqHalf(NF, FS);
    const spA = frameSpectrumDb(x, N / 2, winLen, winType, NF);
    const spB = frameSpectrumDb(x, N / 2, cmpLen, winType, NF);
    const pf = P.frm.plot;
    pf.opts.xlim = [0, Math.min(760, FS / 2)];
    pf.opts.ylim = [-85, 5];
    pf.clear()
      .add({ x: fGrid, y: spA, type: 'line', width: 1.5, color: 0, label: '当前窗 N=' + winLen + '（主瓣 ' + (M.mainLobe * FS / winLen).toFixed(1) + ' Hz）' })
      .add({ x: fGrid, y: spB, type: 'line', width: 1.5, dash: [5, 3], color: 1, label: '对比窗 N=' + cmpLen + '（主瓣 ' + (M.mainLobe * FS / cmpLen).toFixed(1) + ' Hz）' })
      .draw();

    /* ================= 逐信号的看点 ================= */
    let focus = '';
    if (st.sig === 'chirp') {
      const sweep = 586 * dtMs / 1000;            // 一个窗内频率扫过的范围 Hz
      focus = '**啁啾**：调频斜率约 586 Hz/s，一个窗内频率要扫过 **' + U.fmt(sweep, 1) +
        ' Hz**。这个值一旦超过当前 Δf（' + U.fmt(df, 1) + ' Hz），脊线就不再是一条细线，而被抹成一条宽约 ' +
        U.fmt(sweep, 1) + ' Hz 的"斜带" —— 长窗让脊线更连续（好追踪），短窗让脊线更贴近真实瞬时频率（位置准）。';
    } else if (st.sig === 'dual') {
      focus = '**分时段双音**：100 Hz 与 130 Hz 相差仅 30 Hz。当前主瓣宽 ' + U.fmt(resHz, 1) + ' Hz，' +
        (can30 ? '**能**把两者分成两条横线；' : '**不能**分开，热图上它们会糊成一条横线；') +
        '时间上，两段的分界在 0.45 s，窗长 ' + U.fmt(dtMs, 1) + ' ms 意味着分界前后各有约 ' +
        U.fmt(dtMs / 2, 1) + ' ms 的过渡模糊区。';
    } else if (st.sig === 'pulse') {
      const okLoc = dtMs <= 20;
      focus = '**瞬态脉冲**：两个 500 Hz 高斯脉冲宽约 18 ms，间隔 440 ms。当前窗 ' + U.fmt(dtMs, 1) +
        ' ms —— ' + (okLoc ? '**能**较准确定位脉冲起止（窗比脉冲还短），热图上是一条细竖条。'
          : '**不能**定位起止：窗比脉冲长得多，能量被摊进 ' + U.fmt(dtMs, 1) + ' ms 的方块里，竖条被拉宽、峰值被稀释。') +
        '而两个脉冲间隔 440 ms 远大于任何窗长，所以"分得开两个脉冲"始终成立 —— 真正退化的是起止时刻的读数精度（约 ±' +
        U.fmt(dtMs / 2, 1) + ' ms）。';
    } else if (st.sig === 'jump') {
      // 统计跨在跳变点（第 1024 点）上的帧数
      const lo = Math.max(0, Math.ceil((1024 - winLen + 1) / hop));
      const hiM = Math.floor((1024 - 1) / hop);
      const straddle = Math.max(0, hiM - lo + 1);
      focus = '**频率跳变**：真值只有 100 Hz 与 400 Hz 两个频率，中间什么都没有。但有 **' + straddle +
        ' 帧**的窗同时压住了跳变点两侧，这些帧里 100 Hz 与 400 Hz 同时出现，热图上就在两条横线之间"长出"一段过渡区——这就是**假频率**。' +
        '这段假过渡的时间宽度恰好等于一个窗长（' + U.fmt(dtMs, 1) + ' ms，跨窗帧数 ≈ $N_{win}/hop = ' +
        U.fmt(winLen / hop, 1) + '$）；所以**提高重叠率只会让假过渡里的帧更密，并不会把它压窄**，想压窄只能缩短窗长。';
    } else {
      const canSb = resHz <= 20;
      focus = '**调幅**：载波 500 Hz，调制 20 Hz → 真实谱是 480 / 500 / 520 Hz 三条线，边带间隔 20 Hz。' +
        (canSb ? '当前主瓣宽 ' + U.fmt(resHz, 1) + ' Hz，已窄于 20 Hz，**能**在热图上看到三条分开的横线；代价是窗长 ' +
          U.fmt(dtMs, 1) + ' ms 已经超过调制周期 50 ms，包络起伏被平均掉，看不出"调幅"。'
          : '当前主瓣宽 ' + U.fmt(resHz, 1) + ' Hz 大于 20 Hz，**分辨不出边带**，只看到 500 Hz 一条横线；' +
          '但窗只有 ' + U.fmt(dtMs, 1) + ' ms，短于调制周期 50 ms，热图上载波亮度会以 50 ms 周期明暗起伏 —— 这正是"看得到包络、看不到边带"的典型取舍。');
    }

    /* ================= 解读 ================= */
    const bias = dtMs <= 20 ? '时间分辨率优先'
      : (resHz <= 30 ? '频率分辨率优先' : '折中（两边都不占优，这正是 STFT 的常态）');

    ui.explain(
      '**当前设置**：窗长 $N_{win}=' + winLen + '$ 点（' + U.fmt(dtMs, 1) + ' ms），' + (WIN_NAME[winType] || winType) +
      '，重叠 ' + ovPct + '%（hop = ' + hop + ' 点），FFT 点数 ' + nfft + '（补零 ' + zpf + ' 倍），采样率 ' + FS + ' Hz。\n\n' +

      '**分辨率账本**：$\\Delta f = f_s/N_{win} = ' + U.fmt(df, 1) + '$ Hz；$\\Delta t = N_{win}/f_s = ' +
      U.fmt(dtMs, 1) + '$ ms。补零后谱线间隔只有 ' + U.fmt(dfGrid, 2) + ' Hz，但那只是插值，**真分辨率由主瓣宽决定**：' +
      '当前窗主瓣 ' + U.fmt(M.mainLobe, 2) + ' bin → 可分辨的最小频率间隔约 **' + U.fmt(resHz, 1) + ' Hz**，' +
      '旁瓣 ' + U.fmt(M.sll, 1) + ' dB。全场共 **' + ST.frames + ' 帧**（' + ST.bins + ' 个频点）。\n\n' +

      '**当前偏向**：' + bias + '。\n' +
      '· 分辨 100 Hz 与 130 Hz（间隔 30 Hz）：**' + (can30 ? '能' : '不能') + '** —— 需要主瓣宽 ≤ 30 Hz，' +
      '即 $N_{win} \\geq ' + needN30 + '$ 点，或换主瓣更窄的窗（矩形窗只要 ' + Math.ceil(2 * FS / 30) + ' 点，代价是旁瓣升到 -13 dB）。\n' +
      '· 定位瞬态起止：**' + (dtMs <= 20 ? '能' : '不能') + '** —— 时间不确定度约 ±' + U.fmt(dtMs / 2, 1) +
      ' ms；本台的脉冲宽 18 ms，因此 $N_{win}\\leq 40$ 点才谈得上"定位"。\n\n' +

      focus + '\n\n' +

      '**热图的形状怎么读**：横轴是帧（时间）、纵轴是频率，亮 = 能量强。**竖条**代表时间上的突变（瞬态在某一瞬间铺满所有频率），' +
      '**横条**代表稳态频率。当前窗把每帧能量摊在 ' + winLen + ' 个样点上：' +
      '（1）时间方向的拖尾 —— 任何快于 ' + U.fmt(dtMs, 1) + ' ms 的变化都会被抹平，所以瞬态的竖条被拉成宽 ' +
      U.fmt(dtMs, 1) + ' ms 的方块；' +
      '（2）频率方向的模糊 —— 主瓣 ' + U.fmt(M.mainLobe, 2) + ' bin 把每条横条加粗到 ' + U.fmt(resHz, 1) +
      ' Hz，旁瓣 ' + U.fmt(M.sll, 1) + ' dB 又给强分量套了一层上下对称的灰影（矩形窗最明显，换布莱克曼窗可把拖影压下去，但主瓣会变宽到约 6 bin）。\n\n' +

      '**一句话**：$N_{win}$ 只能二选一。想知道"是什么频率"就加长窗，想知道"什么时候发生"就缩短窗；' +
      '补零、加密 hop 都只让图更好看，不会突破 $\\Delta f\\cdot\\Delta t \\approx 1$（此处 $\\Delta f\\cdot\\Delta t = ' +
      U.fmt(df * winLen / FS, 2) + '$）这条硬约束。'
    );
    renderExplainMath();

    ui.metrics([
      { label: 'Δf = fs/N_win', value: U.fmt(df, 1), unit: 'Hz' },
      { label: 'Δt = N_win/fs', value: U.fmt(dtMs, 1), unit: 'ms' },
      { label: '帧数', value: ST.frames, unit: '帧' },
      { label: '窗主瓣', value: U.fmt(M.mainLobe, 2), unit: 'bin' },
      { label: '实际频率分辨率', value: U.fmt(resHz, 1), unit: 'Hz' },
      { label: '旁瓣电平', value: U.fmt(M.sll, 1), unit: 'dB' },
      { label: 'hop / 重叠', value: hop + ' 点 / ' + ovPct, unit: '%' }
    ]);
  }

  /* ------------------------- 注册 ------------------------- */
  DSP.lab.create({
    path: 'lab/stft',
    title: 'STFT 时频分辨率权衡',
    lede: '同一段信号，只改窗长：看热图上的脊线如何从"时间清楚"滑向"频率清楚"，并读出其中的假频率、时间拖尾与旁瓣拖影。',
    tags: ['时频分析', 'STFT', '窗函数', '交互实验台'],
    params: [
      {
        k: 'sig', type: 'seg', label: '信号类型', value: 'chirp',
        options: [
          { value: 'chirp', label: '线性调频' },
          { value: 'dual', label: '双音' },
          { value: 'pulse', label: '瞬态脉冲' },
          { value: 'jump', label: '频率跳变' },
          { value: 'am', label: '调幅 AM' }
        ],
        hint: '五类典型信号分别暴露时频分析的一类典型失真'
      },
      {
        k: 'winExp', type: 'slider', label: '窗长 N_win', min: 5, max: 9, step: 1, value: 7,
        fmt: v => (1 << Math.round(v)) + ' 点',
        hint: '可选 32 / 64 / 128 / 256 / 512 点；这是本台唯一的"自由度"'
      },
      {
        k: 'overlap', type: 'slider', label: '帧重叠率', min: 0, max: 87.5, step: 12.5, value: 50, unit: '%',
        hint: '重叠只增加帧数（时间轴更密），不改变任何一帧的分辨率'
      },
      {
        k: 'win', type: 'select', label: '窗函数', value: 'hann',
        options: [
          { value: 'rect', label: '矩形窗（主瓣最窄，旁瓣最高）' },
          { value: 'hann', label: '汉宁窗（通用首选）' },
          { value: 'hamming', label: '汉明窗（旁瓣略低）' },
          { value: 'blackman', label: '布莱克曼窗（旁瓣最低，主瓣最宽）' }
        ],
        hint: '窗型在主瓣宽与旁瓣高之间做交换，不改变 Δf·Δt'
      },
      {
        k: 'zpf', type: 'seg', label: 'FFT 补零倍数', value: 1,
        options: [
          { value: 1, label: '= 窗长' },
          { value: 2, label: '2 倍' },
          { value: 4, label: '4 倍' }
        ],
        hint: '补零让热图更平滑、谱线更密，但绝不提高真分辨率'
      }
    ],
    plots: [
      {
        key: 'time', title: '① 时域波形与第一、第二帧的窗位置', height: 200,
        opts: { xlabel: 't / s', ylabel: '幅度 x[n]', legend: false }
      },
      {
        key: 'tf', title: '② STFT 时频热图（横轴帧序号 / 纵轴频率，低频在下）', type: 'raw', height: 320
      },
      {
        key: 'frm', title: '③ 同一时刻的单帧频谱对比（长窗 vs 短窗，同一频率网格）', height: 260,
        opts: { xlabel: 'f / Hz', ylabel: '幅度 / dB', legend: true, legendPos: 'tr' }
      }
    ],
    update: update,
    advice: '先固定"双音"，把窗长从 32 拉到 512：你会看到 100 Hz 与 130 Hz 从一条糊掉的横线里分裂成两条——这就是频率分辨率被买回来的瞬间，代价是 0.45 s 处的分界从"刀切"变成"渐隐"。再切到"瞬态脉冲"往回拉：512 点时两个脉冲变成两坨横向拉长的方块，起止时刻读不出来；32 点时才是两条干净的竖线。看"频率跳变"时把重叠率拉到 87.5%，跨窗帧变多，100 Hz 与 400 Hz 之间的假过渡会明显变宽——那是窗造出来的，不是信号里的。',
    eng: '工程上选窗长不要从图好不好看出发，而要从目标的最小可分辨尺度倒推：要分开两条相距 δf (Hz) 的谱线，N_win 至少取 fs/δf，再乘上窗的主瓣 bin 数（汉宁窗 4 bin，矩形窗 2 bin）；要定位一个持续 τ 秒的瞬态，N_win 不能大于 fs·τ。实时系统里 hop 决定运算量：帧率 = fs/hop，hop 减半则 FFT 次数翻倍，做在线谱监测时通常先用 50% 重叠把算力留给后面的检测算法。补零是廉价的显示优化，但别把"谱线间隔变密"当成"分辨率提高"写进报告——评审一眼就能看出来。',
    wrong: '最常见的错误是把"补零 4 倍"当成提高分辨率：谱线密了 4 倍，主瓣宽度一点没变，两条真正的谱线照样糊在一起，只是糊得更光滑。第二个错误是只报 Δf = fs/N_win 就宣称能分辨，忽略了窗的主瓣——汉宁窗下真实可分辨间隔是 4·fs/N_win，差了 4 倍。第三个错误是在频率跳变或脉冲处把热图上的过渡区当成"信号真的扫频了"：那只是窗跨住了两个不同频率的片段，是分析工具造的假象，不是物理事实。',
    see: [
      { path: 'theory/transform/stft', title: 'STFT 短时傅里叶变换' },
      { path: 'lab/window', title: '窗函数横向对比实验台' }
    ]
  });
})(window);
