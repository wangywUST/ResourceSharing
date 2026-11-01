/* =============================================================
   cases/radar.js —— 工程案例库 · 雷达 DSP 专区（4 页）
   路由：cases/radar/pulse-compression | mti-mtd | cfar | fmcw

   写法：结构化 block（见 doc.js 头部注释），与 cases/sonar.js 同一套渲染器、同一规格。
   每一页统一按「工程背景 → 信号模型 → 算法原理回顾 → 完整处理链路 →
   交互仿真 → 工程局限」六段式展开，交互仿真使用 DSP.ui 控件 + DSP.plot 绘图。

   约定：电磁波速 c = 3.0×10^8 m/s（全书统一取值）。
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const doc = DSP.doc;
  const C = DSP.core;
  const U = DSP.util;
  const UI = DSP.ui;
  const P = DSP.plot;
  const h = U.h;

  const C0 = 3.0e8;            // 光速 m/s（全书统一取值）

  /* ============================================================
     通用小工具（四页共用）
     ============================================================= */

  /** 空复数数组 {re, im} */
  function cpx(n) {
    return { re: new Float64Array(n), im: new Float64Array(n) };
  }

  /** 单位方差复高斯噪声（可复现，实部虚部各 1/2 方差） */
  function cnoise(n, seed) {
    const a = U.randn(n, seed), b = U.randn(n, (seed || 1) + 5777);
    const o = cpx(n), k = Math.SQRT1_2;
    for (let i = 0; i < n; i++) { o.re[i] = a[i] * k; o.im[i] = b[i] * k; }
    return o;
  }

  /** 复数取模 */
  function magc(X) {
    const n = X.re.length, o = new Float64Array(n);
    for (let i = 0; i < n; i++) o[i] = Math.sqrt(X.re[i] * X.re[i] + X.im[i] * X.im[i]);
    return o;
  }

  /** 补零到 L 点的正变换 */
  function cfft(a, L) {
    return C.fftC(a, L);
  }

  /** 逆变换（借共轭技巧：IFFT{X} = conj(FFT(conj(X)))/N） */
  function icfft(A) {
    const N = A.re.length;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) { re[i] = A.re[i]; im[i] = -A.im[i]; }
    const Z = C.fftC({ re: re, im: im }, N);
    const o = cpx(N);
    for (let i = 0; i < N; i++) { o.re[i] = Z.re[i] / N; o.im[i] = -Z.im[i] / N; }
    return o;
  }

  /** 频域快速卷积：y = x * h（线性卷积，长度 ≥ Nx+Nh-1 自动补零到 2 的幂） */
  function fftConv(x, hh) {
    const L = C.nextPow2(x.re.length + hh.re.length - 1);
    const X = cfft(x, L), H = cfft(hh, L);
    const Y = cpx(L);
    for (let i = 0; i < L; i++) {
      Y.re[i] = X.re[i] * H.re[i] - X.im[i] * H.im[i];
      Y.im[i] = X.re[i] * H.im[i] + X.im[i] * H.re[i];
    }
    return icfft(Y);
  }

  /** 频域快速相关（匹配滤波）：y[n] = Σ_k x[n+k]·conj(h[k]) */
  function fftCorr(x, hh) {
    const L = C.nextPow2(x.re.length + hh.re.length - 1);
    const X = cfft(x, L), H = cfft(hh, L);
    const Y = cpx(L);
    for (let i = 0; i < L; i++) {
      // X · conj(H)
      Y.re[i] = X.re[i] * H.re[i] + X.im[i] * H.im[i];
      Y.im[i] = X.im[i] * H.re[i] - X.re[i] * H.im[i];
    }
    return icfft(Y);
  }

  /** 给 pulseMetrics 用的包装：补上 length 属性 */
  function withLen(y) { y.length = y.re.length; return y; }

  /** 相对峰值归一化的 dB 序列（带下限保护） */
  function dbNorm(mag, floorDb) {
    const n = mag.length;
    let mx = 0;
    for (let i = 0; i < n; i++) if (mag[i] > mx) mx = mag[i];
    if (mx <= 0) mx = 1;
    const out = new Float64Array(n);
    const fl = floorDb === undefined ? -90 : floorDb;
    for (let i = 0; i < n; i++) {
      const v = 20 * Math.log10(Math.max(mag[i], 1e-12) / mx);
      out[i] = v < fl ? fl : v;
    }
    return { db: out, peak: mx };
  }

  /** 归一化到 0 dB 的功率 dB 序列（用于 CFAR 剖面） */
  function dbP(arr, refDb) {
    const n = arr.length, out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = 10 * Math.log10(Math.max(arr[i], 1e-30)) - (refDb || 0);
    }
    return out;
  }

  /** 指标卡批量填充 */
  function fillMetrics(box, list) {
    U.clear(box);
    list.forEach(m => box.appendChild(h('div.metric', {}, [
      h('div.m-l', { text: m[0] }),
      h('div.m-v', { text: m[1] }),
      m[2] ? h('div', {}, h('span.m-u', { text: m[2] })) : null
    ])));
  }

  /** 窗的中文名 */
  const WIN_NAME = {
    rect: '矩形（不加窗）', hann: '汉宁', hamming: '汉明',
    blackman: '布莱克曼', kaiser: '凯泽 β=6'
  };

  /** 生成长度 N 的窗（含矩形） */
  function mkWin(type, N) {
    if (type === 'rect') {
      const w = new Float64Array(N);
      for (let i = 0; i < N; i++) w[i] = 1;
      return w;
    }
    return C.window(type, N, type === 'kaiser' ? 6 : undefined);
  }

  /** 加权带来的信噪比损失：L = 10lg[(Σw)²/(N·Σw²)]（取正值 dB） */
  function winLossDb(w) {
    let s1 = 0, s2 = 0;
    for (let i = 0; i < w.length; i++) { s1 += w[i]; s2 += w[i] * w[i]; }
    if (s2 <= 0) return 0;
    const r = (s1 * s1) / (w.length * s2);
    return -10 * Math.log10(Math.max(r, 1e-9));
  }

  /** 数组 → 普通数组（供 plot 使用） */
  function arr(a) { return Array.prototype.slice.call(a); }

  /** 供四页共用的参考书目 */
  const REFS = [
    'M. A. Richards, 《Fundamentals of Radar Signal Processing》, 2nd ed., McGraw-Hill, 2014.（中译本：雷达信号处理基础）',
    'M. I. Skolnik, 《Radar Handbook》, 3rd ed., McGraw-Hill, 2008.',
    'M. I. Skolnik, 《Introduction to Radar Systems》, 3rd ed., McGraw-Hill, 2001.（中译本：雷达系统导论）',
    'B. R. Mahafza, 《Radar Systems Analysis and Design Using MATLAB》, 3rd ed., CRC Press, 2013.',
    'H. Rohling, “Radar CFAR Thresholding in Clutter and Multiple Target Situations,” IEEE Trans. AES-19, 1983.',
    'G. W. Stimson, 《Introduction to Airborne Radar》, 2nd ed., SciTech Publishing, 1998.',
    'F. E. Nathanson, 《Radar Design Principles》, 2nd ed., SciTech Publishing, 1999.',
    '丁鹭飞、耿富录, 《雷达原理》, 5 版, 电子工业出版社, 2014.',
    '吴顺君、梅晓春, 《雷达信号处理和数据处理技术》, 电子工业出版社, 2008.'
  ];

  /* ============================================================
     案例一：雷达 LFM 脉冲压缩
     ============================================================= */

  /** 交互仿真：X 波段 LFM 脉冲压缩 */
  function simPulseCompression(el) {
    const F0 = 10e9;                 // X 波段中心频率 10 GHz
    const RMAX = 6000;               // 显示距离窗 0～6 km
    const R1 = 1200;                 // 强目标真实距离 m
    const st = { snr: 6, B: 50, T: 20, sep: 10, wdb: -28, v: 300, win: 'hamming', cl: false };

    const boxA = UI.plotBox({ title: '脉压输出：距离剖面（dB，相对峰值）' });
    const boxB = UI.plotBox({ title: '主瓣与旁瓣结构：强目标附近 ±60 m 放大' });
    const pA = P.new(boxA.canvas, { height: 250, xlabel: '距离 / m', ylabel: '幅度 / dB', legend: true, legendPos: 'tl' });
    const pB = P.new(boxB.canvas, { height: 240, xlabel: '相对强目标的距离 / m', ylabel: '幅度 / dB', legend: true, legendPos: 'tl' });
    const mBox = h('div.metrics');
    const note = h('div.prose');

    /** 生成复基带 LFM 发射样本（未加权） */
    function mku(M, fs, kslope, w) {
      const u = cpx(M);
      for (let m = 0; m < M; m++) {
        const t = m / fs;
        const ph = Math.PI * kslope * t * t;
        const a = w ? w[m] : 1;
        u.re[m] = a * Math.cos(ph);
        u.im[m] = a * Math.sin(ph);
      }
      return u;
    }

    /** 生成回波：targets = [{r, a}] */
    function buildEcho(N, fs, M, kslope, fd, targets) {
      const x = cpx(N);
      for (let q = 0; q < targets.length; q++) {
        const tg = targets[q];
        const n0 = Math.round(2 * tg.r / C0 * fs);
        for (let m = 0; m < M; m++) {
          const idx = n0 + m;
          if (idx < 0 || idx >= N) continue;
          const t = m / fs;
          const ph = Math.PI * kslope * t * t + 2 * Math.PI * fd * (idx / fs);
          x.re[idx] += tg.a * Math.cos(ph);
          x.im[idx] += tg.a * Math.sin(ph);
        }
      }
      return x;
    }

    const recalc = U.rafThrottle(function () {
      const fs = st.B * 1e6;                 // 复基带采样率 = 带宽
      const T = st.T * 1e-6;                 // 脉宽 s
      const M = Math.max(8, Math.round(T * fs));
      const k = (st.B * 1e6) / T;            // 调频斜率 Hz/s
      const bin = C0 / (2 * fs);             // 一个距离单元 = c/2B
      const N = Math.max(256, Math.min(4096, Math.round(RMAX / bin)));
      const NB = N + M;                      // 缓冲：保证脉压输出全程都有噪声（避免补零区抬高信噪比）
      const fd = 2 * st.v * F0 / C0;         // 多普勒（v>0 表示接近）

      const w = mkWin(st.win, M);
      const uRaw = mku(M, fs, k, null);
      const uW = mku(M, fs, k, w);

      const A2 = Math.pow(10, st.wdb / 20);  // 弱目标幅度
      const tgs = [{ r: R1, a: 1 }, { r: R1 + st.sep, a: A2 }];

      // 纯净回波（只含强目标）：测旁瓣 / 分辨率 / 距离徙动
      const clean = buildEcho(NB, fs, M, k, fd, [{ r: R1, a: 1 }]);
      const sig = buildEcho(NB, fs, M, k, fd, tgs);

      // 噪声
      const sigN = Math.pow(10, -st.snr / 20);
      const nz = cnoise(NB, 4241);
      const x = cpx(NB);
      for (let n = 0; n < NB; n++) {
        x.re[n] = sig.re[n] + sigN * nz.re[n];
        x.im[n] = sig.im[n] + sigN * nz.im[n];
      }

      // 近距地物杂波（与发射波形相关，同样会被压缩）：强度随距离衰减
      let clDb = null;
      if (st.cl) {
        const g = cnoise(NB);
        for (let n = 0; n < NB; n++) {
          const env = Math.exp(-n * bin / 400);
          g.re[n] *= env; g.im[n] *= env;
        }
        const cv = fftConv(g, uRaw);
        let pc = 0;
        for (let n = 0; n < NB; n++) pc += cv.re[n] * cv.re[n] + cv.im[n] * cv.im[n];
        pc = Math.max(pc / NB, 1e-30);
        // 设定近距杂波比噪声高 45 dB（折算到窗内平均功率）
        const sCl = Math.sqrt(Math.pow(10, 4.5) * sigN * sigN / pc);
        for (let n = 0; n < NB; n++) {
          x.re[n] += sCl * cv.re[n];
          x.im[n] += sCl * cv.im[n];
        }
        clDb = 10 * Math.log10(sCl * sCl * pc / (sigN * sigN));
      }

      // 脉压：频域快速相关
      const yW = fftCorr(x, uW);
      const yR = fftCorr(x, uRaw);
      const yC = fftCorr(clean, uW);

      const mW = magc(yW), mR = magc(yR), mC = magc(yC);
      const dW = dbNorm(mW), dC = dbNorm(mC);

      // 噪声底：取 4.5～5.5 km 的无目标区间
      let i0 = Math.round(4500 / bin), i1 = Math.min(mW.length - 1, Math.round(5500 / bin));
      if (i1 <= i0) { i0 = Math.round(N * 0.8); i1 = Math.round(N * 0.9); }
      let nf = 0, cnt = 0;
      for (let i = i0; i <= i1; i++) { nf += mW[i] * mW[i]; cnt++; }
      nf = Math.max(nf / Math.max(cnt, 1), 1e-30);
      let pk = 0, pkIdx = 0;
      for (let i = 0; i < Math.min(mW.length, N); i++) if (mW[i] > pk) { pk = mW[i]; pkIdx = i; }
      const snrOut = 10 * Math.log10(pk * pk / nf);
      let pkR = 0;
      for (let i = 0; i < Math.min(mR.length, N); i++) if (mR[i] > pkR) pkR = mR[i];

      // 主瓣指标（纯净回波）；距离徙动用抛物线插值获得亚采样精度
      const pm = C.pulseMetrics(withLen(yC));
      const pmR = C.pulseMetrics(withLen(fftCorr(clean, uRaw)));
      const resM = pm.width3dB * bin;
      const resR = pmR.width3dB * bin;
      const broad = resM / Math.max(resR, 1e-9);
      let drift = 0;
      (function () {
        const ii = pm.peakIdx;
        const ym = ii > 0 ? mC[ii - 1] : mC[ii];
        const y0 = mC[ii];
        const yp = ii < mC.length - 1 ? mC[ii + 1] : mC[ii];
        const den = ym - 2 * y0 + yp;
        const frac = Math.abs(den) > 1e-12 ? 0.5 * (ym - yp) / den : 0;
        drift = (ii + frac - Math.round(2 * R1 / C0 * fs)) * bin;
      })();
      const driftTh = -(C0 / 2) * (fd / k);
      const loss = winLossDb(w);

      // 弱目标是否被旁瓣遮蔽（主瓣区内视为不可分辨）
      const iWk = Math.round(2 * (R1 + st.sep) / C0 * fs);
      const iSt = pkIdx;
      let wk = -999;
      for (let i = Math.max(0, iWk - 2); i <= Math.min(mW.length - 1, iWk + 2); i++) {
        if (Math.abs(i - iSt) <= 2) continue;
        if (dW.db[i] > wk) wk = dW.db[i];
      }
      const lobOv = Math.abs(iWk - iSt) <= 2;   // 间距小于主瓣宽度，两目标落在彼此主瓣内
      let sllAll = -999;
      for (let i = 0; i < Math.min(mW.length, N); i++) {
        if (Math.abs(i - iSt) < 30 || Math.abs(i - iWk) < 30) continue;
        if (dW.db[i] > sllAll) sllAll = dW.db[i];
      }
      const masked = lobOv || wk < sllAll + 3;

      /* ---------- 绘图 ---------- */
      const rAx = [];
      for (let i = 0; i < Math.min(mW.length, N); i++) rAx.push(i * bin);
      const thDb = 10 * Math.log10(nf / (pk * pk)) + 10;
      pA.clear()
        .add({ x: rAx, y: arr(dW.db.subarray(0, rAx.length)), type: 'line', color: 0, width: 1.4, label: '脉压输出（' + WIN_NAME[st.win] + '）' })
        .hline(thDb, { label: '噪声底 + 10 dB 检测门限', color: '#b45309' })
        .vline(R1, { label: '强目标 1200 m' })
        .vline(R1 + st.sep, { label: '弱目标 ' + (R1 + st.sep).toFixed(0) + ' m', color: '#0f766e' })
        .draw();

      const rel = [], d1 = [], d2 = [];
      const half = Math.round(60 / bin);
      for (let i = Math.max(0, pkIdx - half); i <= Math.min(Math.min(mW.length, N) - 1, pkIdx + half); i++) {
        rel.push((i - pkIdx) * bin);
        d1.push(dW.db[i]);
        d2.push(dC.db[i]);
      }
      pB.clear()
        .add({ x: rel, y: d1, type: 'line', color: 0, width: 1.5, label: '含噪声' + (st.cl ? '与地物杂波' : '') })
        .add({ x: rel, y: d2, type: 'line', color: 2, width: 1.2, dash: [4, 3], label: '纯净回波（旁瓣基线）' })
        .hline(-3, { label: '−3 dB（分辨率判据）', color: '#b45309' })
        .hline(sllAll, { label: '旁瓣背景 ' + sllAll.toFixed(1) + ' dB', color: '#7c3aed' })
        .vline(st.sep, { label: '弱目标 +' + st.sep.toFixed(1) + ' m', color: '#0f766e' })
        .draw();

      /* ---------- 指标 ---------- */
      const bt = st.B * 1e6 * T;
      fillMetrics(mBox, [
        ['时宽带宽积 BT', bt.toFixed(0), ''],
        ['处理增益 10lg(BT)', (10 * Math.log10(Math.max(bt, 1e-9))).toFixed(1), 'dB'],
        ['实测输出信噪比', snrOut.toFixed(1), 'dB'],
        ['−3 dB 距离分辨率', resM.toFixed(2), 'm'],
        ['峰值旁瓣 PSL', pm.psl.toFixed(1), 'dB'],
        ['积分旁瓣 ISLR', pm.islr.toFixed(1), 'dB'],
        ['主瓣展宽系数', broad.toFixed(2), '×'],
        ['距离徙动（测 / 理论）', drift.toFixed(2) + ' / ' + driftTh.toFixed(2), 'm'],
        ['加权信噪比损失', loss.toFixed(2), 'dB']
      ]);

      /* ---------- 动态解读 ---------- */
      const gTh = 10 * Math.log10(Math.max(bt, 1e-9));
      note.innerHTML = U.md(
        '**当前状态解读：** 带宽 ' + st.B.toFixed(0) + ' MHz、脉宽 ' + st.T.toFixed(0) + ' µs → 时宽带宽积 $BT=' + bt.toFixed(0) +
        '$，理论处理增益 $10\\lg(BT)=' + gTh.toFixed(1) + '\\,\\text{dB}$（这就是"用 ' + st.T.toFixed(0) +
        ' µs 的长脉冲堆能量、再压成 ' + (1e6 / st.B).toFixed(0) + ' ns 的窄脉冲"换来的收益）。理论距离分辨率 $\\Delta R=c/2B=' +
        (C0 / (2 * st.B * 1e6)).toFixed(2) + '\\,\\text{m}$，仿真实测 −3 dB 主瓣宽度 ' + resM.toFixed(2) + ' m' +
        (st.win === 'rect' ? '（不加权时 ' + resR.toFixed(2) + ' m）' : '，相对不加权展宽 ' + broad.toFixed(2) + ' 倍') + '。' +
        '输入信噪比 ' + st.snr.toFixed(0) + ' dB 经脉压提升到 ' + snrOut.toFixed(1) + ' dB，实测提升 ' + (snrOut - st.snr).toFixed(1) +
        ' dB，与"理论增益 ' + gTh.toFixed(1) + ' dB − 加权损失 ' + loss.toFixed(2) + ' dB"基本吻合（差值来自噪声底的随机起伏与杂波）。' +
        (st.win === 'rect'
          ? ' **当前未加权**：最高旁瓣只有 ' + pm.psl.toFixed(1) + ' dB，每隔约 ' + (C0 / (2 * st.B * 1e6)).toFixed(1) +
            ' m 就有一串 −13 dB 的"假目标"，弱目标很容易被邻居的旁瓣盖住。'
          : ' **当前加' + WIN_NAME[st.win] + '窗**：最高旁瓣压到 ' + pm.psl.toFixed(1) + ' dB，代价是主瓣展宽 ' + broad.toFixed(2) +
            ' 倍并损失 ' + loss.toFixed(2) + ' dB 信噪比 —— 这就是雷达界常说的"压旁瓣要付 1～2.5 dB"。把窗切到"矩形"对比一下，差别最直观。') +
        ' 两目标间距 ' + st.sep.toFixed(1) + ' m（约 ' + (st.sep / resM).toFixed(1) + ' 个分辨率单元），弱目标比强目标低 ' + (-st.wdb) +
        ' dB：' + (lobOv
          ? '**两目标落在彼此的主瓣宽度内**（间距小于展宽后的 −3 dB 主瓣），本来就分不开——只能提高带宽、减小 $c/2B$，或接受"点迹凝聚成一个目标"。'
          : '弱目标位置的输出电平为 ' + wk.toFixed(1) + ' dB，而强目标旁瓣背景约 ' + sllAll.toFixed(1) + ' dB，故弱目标**' +
            (masked ? '已被旁瓣或噪声淹没 —— 注意此时加大发射功率毫无用处，因为旁瓣与目标同步变强，只能靠压旁瓣或提高分辨率救' : '仍可检测出来') + '**。') +
        ' 径向速度 ' + st.v.toFixed(0) + ' m/s 在 X 波段对应 $f_d=2vf_0/c=' + (fd / 1000).toFixed(1) +
        '\\,\\text{kHz}$，主峰相对真值平移 ' + drift.toFixed(2) + ' m（理论 $\\Delta R=-\\tfrac{c}{2}\\cdot f_d/k=' + driftTh.toFixed(2) +
        '\\,\\text{m}$），' + (Math.abs(drift) > resM
          ? '**平移已超过一个分辨率单元**：做脉冲串积累时能量会跨距离门分散，必须做距离徙动补偿或改用正负交替调频斜率。'
          : '平移小于一个分辨率单元，可直接按固定距离门积累。') +
        (st.cl ? ' 已打开**近距地物杂波**（比噪声高约 ' + clDb.toFixed(0) + ' dB）：注意 0～1 km 段被抬高成一片"亮带"，' +
          '这一段的检测门限必须跟着抬高，否则整段全是虚警——这正是机载下视雷达最难的一档。' : '')
      );
      UI.renderMathIn(note);
    });

    const sSnr = UI.slider({ label: '输入信噪比（脉压前）', min: -15, max: 30, step: 1, value: st.snr, unit: 'dB', hint: '单个距离单元上回波功率与噪声功率之比', onInput: v => { st.snr = v; recalc(); } });
    const sB = UI.slider({ label: '带宽 B', min: 10, max: 100, step: 5, value: st.B, unit: 'MHz', hint: '决定距离分辨率 c/2B，同时决定基带采样率', onInput: v => { st.B = v; recalc(); } });
    const sT = UI.slider({ label: '脉宽 T', min: 5, max: 40, step: 1, value: st.T, unit: 'µs', hint: '决定脉冲能量与处理增益，同时决定近距盲区', onInput: v => { st.T = v; recalc(); } });
    const sSep = UI.slider({ label: '两目标间距', min: 2, max: 40, step: 1, value: st.sep, unit: 'm', hint: '弱目标在强目标之后的距离间隔', onInput: v => { st.sep = v; recalc(); } });
    const sWk = UI.slider({ label: '弱目标强度', min: -50, max: -5, step: 1, value: st.wdb, unit: 'dB', hint: '相对强目标的回波幅度（负值）', onInput: v => { st.wdb = v; recalc(); } });
    const sV = UI.slider({ label: '目标径向速度', min: -400, max: 400, step: 10, value: st.v, unit: 'm/s', hint: '正值表示接近（上扫频时视在距离偏近）', onInput: v => { st.v = v; recalc(); } });
    const selW = UI.select({
      label: '接收端加权窗', value: st.win, hint: '压旁瓣必付信噪比损失与主瓣展宽',
      options: [
        { value: 'rect', label: '矩形（不加窗，PSL −13.3 dB）' },
        { value: 'hann', label: '汉宁（PSL ≈ −31 dB）' },
        { value: 'hamming', label: '汉明（PSL ≈ −41 dB，损失 1.34 dB）' },
        { value: 'blackman', label: '布莱克曼（PSL ≈ −58 dB）' },
        { value: 'kaiser', label: '凯泽 β=6（PSL ≈ −55 dB）' }
      ],
      onChange: v => { st.win = v; recalc(); }
    });
    const tgCl = UI.toggle({ label: '叠加近距强地物杂波（比噪声高 45 dB）', value: st.cl, onChange: v => { st.cl = v; recalc(); } });

    el.appendChild(UI.ctrlPanel('仿真参数（拖动即实时重算，采用频域快速相关实现脉压）',
      [sSnr, sB, sT, sSep, sWk, sV, selW, tgCl]));
    el.appendChild(h('div.grid.g2', {}, [boxA.el, boxB.el]));
    el.appendChild(mBox);
    el.appendChild(h('div.plot-cap', { html: U.md('左图：6 km 距离窗内的脉压剖面与检测门限；右图：强目标附近 ±60 m 的细节，实线含噪声（与杂波），虚线为纯净回波的旁瓣基线。横轴一个采样间隔即一个距离单元 $c/2B$。') }));
    el.appendChild(note);
    recalc();
  }

  doc.register('cases/radar/pulse-compression', {
    title: '案例一：雷达 LFM 脉冲压缩',
    lede: 'X 波段 10 GHz、带宽 50 MHz、脉宽 20 µs —— 这组典型火控/搜索雷达参数给出 30 dB 处理增益与 3 m 距离分辨率。本节按真实接收机链路走一遍，并把"压旁瓣要付 1.34 dB""距离-多普勒耦合"这两笔账算清楚。',
    tags: ['雷达', '脉冲压缩', '匹配滤波', '线性调频'],
    labs: [{ path: 'lab/matched', title: '匹配滤波与脉冲压缩实验台', desc: '拖动脉宽/带宽/窗函数，实测处理增益、峰值旁瓣与主瓣宽度' }],
    toc: true,
    sections: [
      {
        id: 'bg', num: '1', title: '工程背景：这个任务在装备里是什么',
        blocks: [
          { t: 'md', md: '现代雷达几乎清一色采用"发射大时宽带宽积信号 + 接收端匹配滤波"的体制，也就是脉冲压缩。原因与声呐同源但更尖锐：**作用距离要能量，距离分辨率要带宽，而发射机峰值功率受功率器件与馈线耐压限制，不能无限加**。线性调频（LFM）用一个宽脉冲把能量堆够，再在接收端把它压缩成一个窄脉冲把带宽找回，是工程上唯一能同时满足两者的成熟方案。' },
          { t: 'md', md: '以一型 X 波段（10 GHz）地面防空/舰载火控雷达的中程搜索模式为例，典型参数与指标压力如下。注意其中的张力：每一项指标彼此打架，不存在"全都要最优"的波形。' },
          { t: 'table', cols: ['项目', '典型取值', '为什么是这个数'], rows: [
            ['工作频段', 'X 波段，$f_0=10\\,\\text{GHz}$（$\\lambda=3\\,\\text{cm}$）', '天线口径相同时波束更窄、角分辨率更好；但大气与雨衰减比 S 波段大，远程预警多用 S/C 波段'],
            ['信号带宽 $B$', '10～200 MHz（本例 50 MHz）', '直接决定距离分辨率 $\\Delta R=c/2B$；受发射机瞬时带宽与频率源线性度限制'],
            ['脉宽 $T$', '1～100 µs（本例 20 µs）', '决定单脉冲能量与处理增益；同时决定近距盲区 $R_{\\min}=cT/2$（本例 3 km！）'],
            ['时宽带宽积 $BT$', '100～5000（本例 1000）', '处理增益 $=10\\lg(BT)$，本例 30 dB'],
            ['峰值功率', '1～100 kW（行波管/固态）', '固态发射机单管峰值受限，常用"多模块合成 + 长脉冲"换能量'],
            ['脉冲重复频率', '中重频 2～20 kHz', '兼顾最大不模糊距离 $c/2f_r$ 与最大不模糊速度 $\\lambda f_r/4$，两者互斥'],
            ['相参处理间隔脉冲数', '8～128（本例 32）', '决定多普勒分辨率 $1/(NT_r)$ 与相参积累增益 $10\\lg N$'],
            ['噪声系数', '2～4 dB（含馈线损耗）', '直接乘进雷达方程，1 dB 噪声系数约等于 1 dB 灵敏度'],
            ['作用距离', '对 1 m² 目标 30～80 km', '由雷达方程决定，与 $BT$、天线增益、积累脉冲数均有关'],
            ['距离分辨率', '$\\Delta R=c/2B=3\\,\\text{m}$', '要分辨 3 m，必须有 50 MHz 带宽，没有第二条路']
          ] },
          { t: 'metrics', list: [
            { label: '处理增益', value: '30.0', unit: 'dB（BT=1000）' },
            { label: '距离分辨率', value: '3.00', unit: 'm（c/2B）' },
            { label: '近距盲区', value: '3000', unit: 'm（cT/2）' },
            { label: '主瓣宽度', value: '20', unit: 'ns（1/B）' }
          ] },
          { t: 'callout', kind: 'eng', title: '工程师视角：先算清"压缩前后"的三级信噪比', md: '雷达链路预算要分清三档信噪比，混淆它们是初学者最常见的错误：\n\n① **单个采样点（距离单元）上的输入信噪比**：回波刚进 ADC 时，一个距离单元里信号功率与噪声功率之比，通常很低（−10～+10 dB）；\n② **脉压后的输出信噪比**：输入信噪比加上处理增益 $10\\lg(BT)$ 再减去加权损失，本例约 30 dB 的改善；\n③ **相参积累后的信噪比**：再做 $N$ 个脉冲的慢时间相参积累，又加 $10\\lg N$（32 个脉冲约 15 dB），但慢速目标会落进杂波凹口，实际拿不到。\n\n雷达方程里用的是①，检测曲线（$P_d$–$P_{fa}$–信噪比）用的是③。把②当③输入检测曲线，会把作用距离高估一大截。' },
          { t: 'callout', kind: 'note', title: '为什么偏偏是线性调频', md: '可做大时宽带宽积的波形不止一种：非线性调频（NLFM，用驻留相位法设计频谱形状，不加权就有低旁瓣）、相位编码（巴克码、多相码，抗截获但多普勒敏感）、步进频（用窄带瞬时带宽合成大带宽，对 ADC 友好但数据率低）、噪声波形（真正的低截获）。**LFM 胜出的原因只有两个字：好做。** 它对多普勒失配极其宽容（只产生可预测的距离平移，不像相位编码那样直接损失增益），产生与处理都只要一个扫频源加一次 FFT，且在任意 BT 下性能可解析预测。工程选择从来不是"理论最优"，而是"在约束下最可控"。' }
        ]
      },
      {
        id: 'model', num: '2', title: '信号模型：发射波形、信道与接收信号',
        blocks: [
          { t: 'md', md: '发射的实信号是载频 $f_0$ 上的线性调频脉冲，在一个脉宽内瞬时频率从 $f_0-B/2$ 线性扫到 $f_0+B/2$（上扫频）：' },
          { t: 'math', tex: 's_p(t) = a(t)\\,\\cos\\!\\left[2\\pi f_0 t + \\pi k t^{2}\\right],\\quad a(t)=\\mathrm{rect}\\!\\left(\\frac{t-T/2}{T}\\right),\\quad k=\\frac{B}{T}\\ \\text{(Hz/s)}', tag: '(1)' },
          { t: 'md', md: '瞬时频率为 $f_i(t)=f_0+kt$，在 $[-T/2,T/2]$ 上扫过 $B=kT$。工程处理一律使用**复包络（基带）**表示，把载频搬掉，只在 $|f|\\le B/2$ 内工作：采样率从 $2(f_0+B/2)$ 降到 $B$ 量级，本例从 20 GHz 降到 50 MHz，整整 400 倍——这是数字雷达能成立的前提。' },
          { t: 'math', tex: 'u(t) = \\exp\\!\\left(j\\pi k t^{2}\\right),\\quad |t|\\le T/2;\\qquad s_p(t)=\\Re\\!\\left\\{u(t)\\,e^{j2\\pi f_0 t}\\right\\}', tag: '(2)' },
          { t: 'md', md: '接收端要算四笔账：**传播衰减**（雷达方程的 $1/R^4$ 功率律，双程）、**目标起伏**（雷达截面积随姿态随机变化，Swerling 模型）、**多普勒**（径向速度 $v$ 造成载频偏移 $f_d=2v/\\lambda=2vf_0/c$）、**杂波与噪声**（地物/海面/气象散射 + 接收机热噪声）。于是**复基带接收信号的标准模型**为：' },
          { t: 'math', tex: 's_r(t) = \\sum_i A_i\\,s\\!\\left(t-\\tau_i\\right)e^{j2\\pi f_{d,i}t} \\;+\\; \\underbrace{\\sum_m \\rho_m\\, s(t-\\tau_m)e^{j2\\pi f_{c,m}t}}_{\\text{杂波（面分布散射体叠加）}} \\;+\\; n(t),\\quad \\tau_i=\\frac{2R_i}{c}', tag: '(3)' },
          { t: 'kv', title: '变量说明', pairs: [
            ['$A_i$', '第 $i$ 个目标的复回波幅度，含雷达截面积、天线双程增益、传播衰减与相位'],
            ['$\\tau_i = 2R_i/c$', '双程时延；距离与时延的换算系数是 $c/2$，不是 $c$（新手最常写错的一处）'],
            ['$f_{d,i} = 2v_i/\\lambda = 2v_if_0/c$', '多普勒频移。X 波段、300 m/s 时为 20 kHz'],
            ['$\\rho_m$', '第 $m$ 个杂波散射单元的复散射系数，地物杂波通常比目标强 40～70 dB'],
            ['$f_{c,m}$', '杂波内部运动频率（风吹植被、海浪、雨滴），决定杂波谱宽度；静止地物为 0'],
            ['$n(t)$', '接收机热噪声 + 天线噪声 + 外部干扰，通常建模为带限高斯白噪声']
          ] },
          { t: 'md', md: '**雷达截面积起伏（Swerling 模型）**必须进模型，因为它直接决定检测概率与所需信噪比：' },
          { t: 'table', cols: ['模型', '物理含义', '幅度（功率）分布', '典型场景'], rows: [
            ['Swerling 0 / V', '截面积恒定（不起伏）', '确定值', '标定球、角反射器、部分导弹弹体'],
            ['Swerling I', '慢起伏：一次扫描内脉冲间完全相关，扫描间独立', '功率服从指数分布（瑞利幅度）', '由许多独立散射体组成、姿态缓慢变化的飞机'],
            ['Swerling II', '快起伏：脉冲间独立', '功率服从指数分布', '姿态快速变化、喷气发动机调制明显的目标'],
            ['Swerling III', '慢起伏，含一个主散射体 + 若干小散射体', '功率为 4 自由度卡方', '带强镜面反射的机型'],
            ['Swerling IV', '快起伏，含一个主散射体', '功率为 4 自由度卡方', '同上但脉冲间去相关']
          ] },
          { t: 'callout', kind: 'pit', title: '坑：把杂波当成"大一点的噪声"', md: '式 (3) 第二项（杂波）与第三项（噪声）性质完全不同：噪声是加性的、与发射信号无关，加大发射功率就能压下去；**地物杂波是发射信号本身的回波，会被匹配滤波同样地压缩，加大功率毫无用处**。区分办法一句话：杂波有距离（集中在某个距离段）、有固定的多普勒中心（静止地物在零频）、且随天线指向剧烈变化；噪声则在全距离段均匀、全多普勒均匀。判断错了就会在错误的方向上做无用功——这是雷达信号处理最贵的一次误判。' },
          { t: 'fold', summary: '展开：雷达方程与单脉冲信噪比（把 $\\Delta R$ 也带出来）', deriv: true, blocks: [
            { t: 'md', md: '由雷达方程，接收单个脉冲的信噪比（功率比）为' },
            { t: 'math', tex: '\\mathrm{SNR}_1 = \\frac{P_t G^2 \\lambda^2 \\sigma}{(4\\pi)^3 k T_0 B_n F\\, R^4\\, L_s}' },
            { t: 'md', md: '分子里发射功率 $P_t$、天线增益 $G$ 的平方（双程）、波长平方、目标截面积 $\\sigma$；分母里玻尔兹曼常数 $k$、噪声温度 $T_0$、噪声带宽 $B_n$、噪声系数 $F$、距离的四次方 $L_s$ 为系统损耗。' },
            { t: 'md', md: '关键点：**噪声功率 $kT_0B_nF$ 与带宽成正比**，所以"加带宽提高分辨率"是要付信噪比代价的（距离分辨率每提高一倍，单脉冲信噪比掉 3 dB）。正是因为噪声带宽已经由 $B$ 定死，脉压才必须用"长脉冲 + 大带宽"把能量补回来：脉冲能量 $E=P_tT$，而压缩后的有效噪声带宽仍是 $B$，于是' },
            { t: 'math', tex: '\\mathrm{SNR}_{\\text{out}} = \\frac{E}{kT_0F}\\cdot\\frac{1}{1}\\;=\\;\\mathrm{SNR}_1\\cdot BT\\quad\\Rightarrow\\quad G_p = 10\\lg(BT)\\;\\text{dB}' },
            { t: 'md', md: '即：**处理增益恰好等于时宽带宽积**，与波形细节无关（前提是匹配且无多普勒失配）。本例 $BT=1000$ → 30 dB。' }
          ] }
        ]
      },
      {
        id: 'algo', num: '3', title: '算法原理回顾：匹配滤波、加权与距离-多普勒耦合',
        blocks: [
          { t: 'md', md: '匹配滤波器的冲激响应是"共轭翻转"的复制信号，输出是接收信号与参考波形的相关函数，等价于在距离维做卷积；实现上走频域更快：' },
          { t: 'math', tex: 'y(\\tau)=\\int s_r(t)\\,u^{*}(t-\\tau)\\,dt \\;=\\; \\mathcal{F}^{-1}\\!\\left\\{S_r(f)\\,U^{*}(f)\\right\\}', tag: '(4)' },
          { t: 'md', md: '三条必须记住的结论（推导见下方折叠）：' },
          { t: 'md', md: '① **白噪声下输出信噪比最大**，改善量 $=10\\lg(BT)$，本例 30 dB；\n② **输出是模糊函数在 $(\\tau,f_d)$ 处的一个切片**：无多普勒失配时是 LFM 的自相关，主瓣宽约 $1/B$（20 ns），旁瓣按 $\\mathrm{sinc}$ 衰减，第一旁瓣只有 −13.3 dB；\n③ **多普勒失配会让主瓣整体平移**：这就是距离-多普勒耦合，是 LFM 唯一的"硬伤"。' },
          { t: 'math', tex: '\\Delta R = \\frac{c}{2}\\cdot\\frac{f_d}{k} = \\frac{c}{2}\\cdot\\frac{f_d\\,T}{B},\\qquad f_d=\\frac{2v f_0}{c},\\qquad k=\\frac{B}{T}', tag: '(5)' },
          { t: 'md', md: '**代一组真数**：$f_0=10\\,\\text{GHz}$、$B=50\\,\\text{MHz}$、$T=20\\,\\mu\\text{s}$ → $k=2.5\\times10^{12}\\,\\text{Hz/s}$。目标径向速度 $v=300\\,\\text{m/s}$（约 0.9 马赫）→ $f_d=2\\times300\\times10^{10}/3\\times10^8=20\\,\\text{kHz}$ →' },
          { t: 'math', tex: '\\Delta R = \\frac{3\\times10^8}{2}\\cdot\\frac{2\\times10^4}{2.5\\times10^{12}} = 1.2\\ \\text{m}' },
          { t: 'md', md: '即：**300 m/s 的高速目标，测距会偏 1.2 m**（上扫频时偏向近端），相当于 0.4 个分辨率单元。这个量看起来不大，但对"距离门对齐 + 慢时间相参积累"是致命的：脉冲串处理时如果目标跨了距离门，积累增益会从 $10\\lg N$ 掉到远低于此。工程对策有三条：**按预测速度做距离徙动补偿**、**交替发射正负斜率 chirp 取平均抵消耦合**、或**加大 $B/T$ 比值让耦合变小**（但会损失能量）。' },
          { t: 'fold', summary: '展开：LFM 匹配滤波输出的主瓣、旁瓣与耦合项是怎么算出来的', deriv: true, blocks: [
            { t: 'md', md: '把基带 LFM $u(t)=e^{j\\pi k t^{2}}\\mathrm{rect}(t/T)$ 与自身相关。忽略边缘项，用驻定相位原理或直接积分：' },
            { t: 'math', tex: 'y(\\tau)=\\int_{-T/2}^{T/2} e^{j\\pi k t^{2}} e^{-j\\pi k (t-\\tau)^{2}} dt = e^{j\\pi k\\tau^{2}}\\int_{-T/2}^{T/2} e^{j2\\pi k\\tau t}\\,dt' },
            { t: 'md', md: '第二个因子是一个矩形函数的傅里叶变换（$\\mathrm{sinc}$ 形），第一个因子是残余的"去斜"相位。取模得' },
            { t: 'math', tex: '|y(\\tau)| \\approx T\\left|\\frac{\\sin(\\pi B\\tau)}{\\pi B\\tau}\\right| = T\\,\\big|\\mathrm{sinc}(B\\tau)\\big|' },
            { t: 'md', md: '于是：第一个零点在 $\\tau=1/B$（本例 20 ns），−3 dB 宽度约 $0.886/B$，对应距离 $0.886\\,c/(2B)$，工程上直接写 $\\Delta R\\approx c/2B$。**峰值幅度为 $T$（即 $\\sqrt{BT}$ 量级的电压增益），功率增益即 $BT$。**' },
            { t: 'md', md: '旁瓣只按 $1/(\\pi B\\tau)$ 衰减，**第一旁瓣 −13.26 dB，且与 $BT$ 无关**——这是 LFM 的固有缺陷，加大时宽带宽积并不能改善旁瓣。要压旁瓣只能加权（频域加窗），代价见下表。' },
            { t: 'md', md: '**耦合项的来历**：回波含 $e^{j2\\pi f_d t}$ 时，积分变为' },
            { t: 'math', tex: 'y(\\tau)=e^{j\\pi k\\tau^{2}}\\int_{-T/2}^{T/2} e^{j2\\pi(k\\tau+f_d)t}dt \\;\\Rightarrow\\; \\text{峰值在 } k\\tau+f_d=0,\\; \\tau=-\\frac{f_d}{k}' },
            { t: 'md', md: '即峰值位置从 $\\tau=0$ 移到 $\\tau=-f_d/k$，换算成距离 $\\Delta R=\\tfrac{c}{2}\\tau=-\\tfrac{c}{2}f_d/k$。符号说明一切：**上扫频（$k>0$）+ 接近目标（$f_d>0$）→ 视在距离偏小**。若改用下扫频，偏向反号——正因如此，"上下扫频交替"能把这个偏差平均掉。' }
          ] },
          { t: 'table', cols: ['加权窗', '最高旁瓣 PSL', '信噪比损失', '主瓣展宽', '适用场景'], rows: [
            ['矩形（不加窗）', '−13.3 dB', '0 dB', '1.00×', '单目标测距、旁瓣无害'],
            ['汉宁（余弦平方）', '≈ −31 dB', '≈ 1.78 dB', '≈ 1.63×', '通用首选，弱目标检测'],
            ['汉明', '≈ −41 dB', '≈ 1.34 dB', '≈ 1.47×', '性价比最高，火控雷达常用'],
            ['布莱克曼', '≈ −58 dB', '≈ 2.37 dB', '≈ 1.90×', '强目标附近存在弱目标'],
            ['凯泽 β=6', '≈ −55 dB', '≈ 2.0 dB', '≈ 1.70×', '可按 β 连续调节旁瓣与损失']
          ] },
          { t: 'callout', kind: 'eng', title: '加权加在哪一侧？三种做法的差别', md: '加权可以在三个位置做，效果几乎等价但工程代价不同：\n\n① **只加权复制信号（接收端）**：最常用。发满功率的矩形包络（发射机效率最高），只在匹配滤波器的参考函数上加窗，损失 1.34 dB，主瓣展宽 1.47 倍；\n② **只加权发射波形**：发射包络不再恒定，发射机功放被迫回退线性区，平均功率下降，且波形失真引入额外旁瓣，一般不这么做；\n③ **收发各加一半（根号窗）**：发射加 $\\sqrt{w}$、接收加 $\\sqrt{w}$，总加权仍为 $w$，好处是发射包络起伏更平缓，常用于固态发射机。\n\n注意**加权必然同时带来三件事**：旁瓣下降、信噪比损失、主瓣展宽。主瓣展宽意味着**两个等强目标的可分辨间距变大**，所以"压旁瓣"和"分辨邻近目标"是一对矛盾。' },
          { t: 'callout', kind: 'tip', title: '与知识库的对应关系', md: '匹配滤波的最优性证明与输出信噪比公式见「匹配滤波」一节；窗函数的旁瓣、等效噪声带宽与主瓣展宽数据见「窗函数基础」与「窗函数法设计 FIR」两节；循环卷积与补零条件见「线性卷积与循环卷积」一节，本节的频域脉压就是它的直接应用。本节不重复推导，只给出工程结论与数值。' }
        ]
      },
      {
        id: 'chain', num: '4', title: '完整处理链路：从天线到点迹',
        blocks: [
          { t: 'md', md: '下面是一台真实脉冲压缩雷达接收机的纵向链路。每一级都标了输入、输出与关键参数——**外场排查问题时，九成能把故障定位到其中某一级**。' },
          { t: 'flow', v: true, items: [
            { t: '① 天线与馈线（机械扫描 / 相控阵）', d: '输入：空间电磁波；输出：微瓦级射频信号。关键：增益 30～40 dB、波束宽度 $1°\\sim3°$、副瓣电平 ≤ −25 dB（副瓣是干扰与杂波的入口）' },
            { t: '② 限幅器 + 低噪声放大器', d: '输入：−90～−30 dBm 回波；输出：放大后射频。关键：**噪声系数 2～4 dB（决定接收灵敏度）**、限幅器防烧毁、增益 20～30 dB、线性度（1 dB 压缩点）' },
            { t: '③ 混频与中频放大', d: '输入：射频 10 GHz；输出：中频（如 60 MHz 或 1 GHz）。关键：本振**相位噪声**（直接决定脉压近区旁瓣底）、镜像抑制、中频滤波器带宽 ≥ $B$、自动增益控制起始电平' },
            { t: '④ 抗混叠滤波 + 模数转换', d: '输入：中频/直接射频采样；输出：数字流。关键：采样率 ≥ $B$（复基带）或按带通采样定理取值；**位数 12～16 bit（动态范围 72～96 dB）**；孔径抖动（10 GHz 直接采样时是致命指标）' },
            { t: '⑤ 数字下变频（正交解调）', d: '输入：数字中频；输出：复基带 $I/Q$。关键：数控振荡器 + 混频 + 低通 + 抽取；**$I/Q$ 幅度不平衡与相位正交误差要校准到 −40 dBc 镜像以下**，否则强目标的镜像会变成假目标' },
            { t: '⑥ 脉冲压缩（频域快速相关）', d: '输入：复基带距离序列；输出：压缩后的距离剖面。关键：补零长度 $L\\ge N+M-1$（$N$ 为距离窗样点数、$M$ 为脉冲样点数）；加权窗；定点运算时的位宽与溢出保护' },
            { t: '⑦ 动目标显示 / 动目标检测（慢时间处理）', d: '输入：$N$ 个脉冲同一距离门的序列；输出：距离-多普勒二维矩阵。关键：脉冲重复频率选择（距离/速度模糊的取舍）、对消器阶数、多普勒窗、零频抑制深度' },
            { t: '⑧ 恒虚警检测', d: '输入：距离-多普勒幅度；输出：过门限的检测点。关键：参考窗与保护单元长度、门限系数 $\\alpha$、检测器类型（单元平均 / 有序统计 / 两侧选大等）' },
            { t: '⑨ 点迹凝聚、测角与航迹处理', d: '输入：检测点；输出：目标报告。关键：距离/方位凝聚（避免一个目标报多个点）、单脉冲测角或单脉冲和差比幅、航迹起始与关联、虚警剔除' }
          ] },
          { t: 'callout', kind: 'eng', title: '链路调试的定位口诀', md: '**噪声底整体抬高** → 查②（噪声系数）或④（位数/增益）；**近区旁瓣一片毛刺** → 查③（本振相位噪声）或⑥（定点位宽）；**出现对称的假目标** → 查⑤（$I/Q$ 失配镜像）；**远距离回波消失但近距离正常** → 查④（自动增益控制恢复时间）或①（波束指向）；**固定距离上出现周期性虚警** → 查⑦（多普勒盲速）或⑧（参考窗取到了杂波边缘）。' }
        ]
      },
      {
        id: 'sim', num: '5', title: '交互仿真：拖参数看脉压剖面、旁瓣与距离徙动',
        blocks: [
          { t: 'md', md: '下面这台仿真器完全按式 (3) 生成复基带回波：强目标固定在 1200 m（幅度 1），弱目标在其后 `间距` 米处（幅度可调），再叠加复高斯噪声（可选近距地物杂波）。基带采样率取 $f_s=B$，于是**一个采样点就是一个距离单元 $c/2B$**；脉压用频域快速相关实现（补零到 $L\\ge N+M-1$，与实机一致）。请务必做四组对照实验：' },
          { t: 'md', md: '① **把窗从"汉明"切到"矩形"**：看最高旁瓣从 −41 dB 掉回 −13 dB，弱目标是怎样被强目标旁瓣吞掉的；\n② **把带宽从 50 MHz 拉到 10 MHz 再拉到 100 MHz**：看 −3 dB 主瓣宽度（距离分辨率）如何成反比变化，以及处理增益随 $BT$ 变化；\n③ **把径向速度从 0 拉到 ±400 m/s**：看主峰整体平移多少米，与理论值 $\\Delta R=-\\tfrac{c}{2}f_d/k$ 对账；\n④ **打开近距地物杂波**：看 0～1 km 段被抬高成亮带，说明为什么杂波区的检测门限必须自适应（这就是下一节恒虚警处理的动机）。' },
          { t: 'widget', render: function (el) { simPulseCompression(el); } },
          { t: 'callout', kind: 'note', title: '为什么实测处理增益常常达不到 30 dB', md: '仿真里"输出信噪比 = 输入信噪比 + 30 dB − 加权损失"只在**噪声是白的、无杂波、无多普勒失配、无相位噪声**时才成立。实际装备至少还有五处扣分项：加权损失 1.3～2.4 dB、多普勒失配损失（耦合超过半个距离单元时开始）、相位噪声抬起的近区旁瓣底、发射机非线性产生的频谱展宽、以及自动增益控制瞬态造成的幅度扰动。把这些扣完，30 dB 的理论增益能有 25 dB 就不错了——**做链路预算时至少要留 4～6 dB 的工程余量**。' }
        ]
      },
      {
        id: 'impl', num: '6', title: '数字实现：频域快速卷积、补零与去斜处理',
        blocks: [
          { t: 'md', md: '**频域脉压**的标准做法是"补零—正变换—共轭相乘—反变换"：设距离窗 $N$ 点、复制信号 $M$ 点，取 $L$ 为不小于 $N+M-1$ 的 2 的幂，则' },
          { t: 'math', tex: 'y = \\mathrm{IFFT}\\left\\{\\mathrm{FFT}_L\\{x\\}\\cdot \\mathrm{conj}\\big(\\mathrm{FFT}_L\\{u\\}\\big)\\right\\},\\quad L \\ge N+M-1', tag: '(6)' },
          { t: 'md', md: '补零条件 $L\\ge N+M-1$ 是硬性要求，否则循环卷积会把脉冲尾部的能量绕回距离窗开头，形成**距离模糊的"鬼影"**（表现为近距离出现莫名其妙的弱峰）。若距离窗远长于脉冲（$N\\gg M$），直接做一次大 FFT 不划算，改用**重叠相加法或重叠保留法**分段处理：每段取 $L$ 点、保留 $L-M+1$ 点有效输出、相邻段重叠 $M-1$ 点相加。实时处理机里这两种分段法是标准配置。' },
          { t: 'code', lang: 'python', title: '频域脉冲压缩（补零 + 重叠相加，可直接跑）', src:
`import numpy as np

def lfm(T, B, fs):
    """复基带 LFM：u(t)=exp(j*pi*k*t^2), |t|<=T/2"""
    M = int(round(T * fs))
    t = np.arange(M) / fs
    return np.exp(1j * np.pi * (B / T) * t ** 2)

def pulse_compress(x, u, win=True, overlap=True):
    """x: 距离窗复基带序列；u: 发射复制信号（未加权）"""
    M = len(u)
    N = len(x)
    if win:                       # 汉明加权：PSL -41 dB，损失 1.34 dB
        w = np.hamming(M)
        w = w / np.sqrt(np.mean(w ** 2))   # 保持噪声增益不变，便于比较
    else:
        w = np.ones(M)
    h = u * w
    # 匹配滤波器频响 = conj(FFT(u·w))
    L = 1 << int(np.ceil(np.log2(N + M - 1)))
    H = np.conj(np.fft.fft(h, L))
    if not overlap or N <= 4 * L:
        Y = np.fft.fft(x, L) * H
        return np.fft.ifft(Y)[:N]

    # 重叠相加：每段 L 点，有效输出 L-M+1 点
    step = L - M + 1
    y = np.zeros(N + M - 1, dtype=complex)
    for start in range(0, N, step):
        blk = x[start:start + step]
        if len(blk) == 0:
            break
        Y = np.fft.fft(blk, L) * H
        seg = np.fft.ifft(Y)
        y[start:start + len(seg)] += seg
    return y[:N]` },
          { t: 'md', md: '**去斜处理（拉伸处理，stretch / dechirp）**用于极大带宽（几百 MHz 到数 GHz）的场合：此时按奈奎斯特采样的 ADC 成本与数据率高到不可接受。做法是**用同一段 LFM 的延时副本作为本振，与回波混频**，把宽带信号"压"成窄带单频：' },
          { t: 'math', tex: 's_r(t)\\,u^{*}(t-\\tau_{\\mathrm{ref}}) \\;=\\; \\sum_i A_i\\,\\exp\\!\\left[j2\\pi k(\\tau_{\\mathrm{ref}}-\\tau_i)t\\right]\\exp\\!\\left[j\\pi k(\\tau_i^2-\\tau_{\\mathrm{ref}}^2)\\right]', tag: '(7)' },
          { t: 'md', md: '去斜后每个目标变成一个**频率正比于其距离偏差 $(\\tau_{\\mathrm{ref}}-\\tau_i)$ 的单频**，做一次 FFT 就得到距离剖面；所需采样率只与实际观测的距离窗口宽度 $\\Delta R_{\\text{win}}$ 成正比，而不是与全量程成正比：' },
          { t: 'math', tex: 'f_s^{\\text{dechirp}} = \\frac{2k\\,\\Delta R_{\\text{win}}}{c}\\;\\ll\\; B\\quad(\\text{当 }\\Delta R_{\\text{win}}\\ll R_{\\max})' },
          { t: 'md', md: '代价是**距离窗被限死**：超出窗口的目标会折叠进来，且窗口边缘的响应线性下降（需要加窗补偿）。因此去斜常见于**合成孔径雷达、毫米波近距成像、精密测距引信**这类"已知目标大致距离、要看细节"的场合，而非全程搜索雷达。' },
          { t: 'fold', summary: '展开：去斜处理为什么要求"参考延时精确"，以及它的距离窗怎么定', deriv: true, blocks: [
            { t: 'md', md: '去斜的输出是单频 $f_i=k(\\tau_{\\mathrm{ref}}-\\tau_i)$，FFT 的频率分辨率为 $1/T$（$T$ 为脉宽），于是距离分辨率' },
            { t: 'math', tex: '\\Delta R = \\frac{c}{2k}\\cdot\\frac{1}{T} = \\frac{c}{2B}' },
            { t: 'md', md: '与匹配滤波完全一致——**去斜不损失分辨率，只损失量程**。去斜后的最高频率为 $|f|_{\\max}=k\\,\\Delta\\tau_{\\max}$，对应距离窗宽度 $\\Delta R_{\\text{win}}=c\\Delta\\tau_{\\max}/2$，故采样率需满足 $f_s\\ge 2k\\Delta\\tau_{\\max}=2k\\cdot 2\\Delta R_{\\text{win}}/c$。' },
            { t: 'md', md: '若参考延时 $\\tau_{\\mathrm{ref}}$ 有误差 $\\delta$，则所有目标的频率整体偏移 $k\\delta$，距离剖面整体平移——所以去斜系统必须有**距离跟踪环路**把参考延时对准目标群。这也是为什么去斜只能看一个"距离窗口"，看全量程要多次重调参考延时。' }
          ] },
          { t: 'callout', kind: 'warn', title: '定点实现的位宽账', md: '脉压输出的动态范围 = 处理增益 + 输入动态范围。本例 30 dB 处理增益，若输入 ADC 为 14 bit（84 dB），中间累加器的字长必须能容纳 $84+30=114$ dB 以上的瞬时动态范围，否则**强目标会溢出截断，产生遍布全距离段的杂散**。工程做法：乘法器输出 24～32 bit 累加，块浮点或逐级右移保护，最后取 16 bit 输出并做归一化。现场出现的"莫名其妙的全屏杂散"，八成是这里没留够位宽。' }
        ]
      },
      {
        id: 'limit', num: '7', title: '工程局限与实际难题',
        blocks: [
          { t: 'md', md: '脉冲压缩是教科书里最干净的一节，却是外场最脏的一节。以下是实践中必然遇到的九个难题。' },
          { t: 'callout', kind: 'danger', title: '① 发射机非线性：波形失真直接变旁瓣', md: '功放工作在饱和区时会产生**调幅-调幅与调幅-调相转换**：LFM 本来是恒包络的，一旦包络起伏，压缩后的旁瓣会从 −41 dB 恶化到 −25 dB 甚至更差。对策：功放回退 1～3 dB 到线性区（牺牲效率与功率）、数字预失真校正、或改用恒包络的相位编码。固态发射机模块间幅相不一致同样会抬高旁瓣，**通道间一致性要求通常写死在 ±0.5 dB / ±5° 以内**。' },
          { t: 'callout', kind: 'danger', title: '② 相位噪声：近区旁瓣底的最终瓶颈', md: '本振相位噪声在脉压输出中表现为**距离近区（主瓣附近几百米内）的旁瓣底整体抬高**，因为它不能用加权消除（加权只压波形固有的旁瓣）。经验公式：相位噪声功率谱密度 $\\mathcal{L}(f)$ 在 $f=1/T$ 处的值直接决定近区旁瓣底。X 波段、$T=20\\,\\mu\\text{s}$ 时要达到 −45 dB 的近区旁瓣，本振在 50 kHz 偏移处的单边带相位噪声必须优于 −100 dBc/Hz——**这往往比波形设计本身更花钱**（要选低相噪的介质振荡器或做锁相环优化）。' },
          { t: 'callout', kind: 'warn', title: '③ 模数转换位数不足与动态范围', md: 'ADC 位数决定**远距弱目标与近距强回波能否共存**。地物回波可比噪声高 60～70 dB，若 ADC 只有 10 bit（60 dB），近距回波会直接饱和并产生谐波杂散，把整个距离段污染。对策：高位数 ADC（14～16 bit）、**灵敏度时间控制（按 $R^{-4}$ 或 $R^{-3}$ 编程衰减近距回波）**、或分段增益。注意自动增益控制的**恢复时间**：强地物回波过后若增益恢复太慢，紧跟其后的弱目标会被"压死"，这在机载下视雷达里是要命的。' },
          { t: 'callout', kind: 'warn', title: '④ 距离模糊与速度模糊的互斥', md: '脉冲重复频率 $f_r$ 定了两件事：最大不模糊距离 $R_u=c/2f_r$、最大不模糊速度 $v_u=\\lambda f_r/4$。两者乘积 $R_uv_u=c\\lambda/8$ 是常数（本例 $=0.1125\\,\\text{m}^2/\\text{s}$ 量级），**不可能同时要大**。高重频测速清晰但测距模糊，低重频测距清晰但测速模糊。工程解法是**多重频（参差重频）+ 中国余数定理解模糊**，代价是驻留时间与数据处理量成倍增加。' },
          { t: 'callout', kind: 'warn', title: '⑤ 距离旁瓣伪装成假目标', md: '一个 60 dB 的强目标（大型建筑、山体、海面镜面反射）其 −13 dB 旁瓣仍比噪声高 47 dB，会在其两侧各产生一串"假目标"。对策分三层：**加权**（压到 −41 dB 以下）、**旁瓣对消/掩蔽技术**（在强目标位置构造一个副本减掉，可再压 20 dB）、以及**检测阶段的凝聚与剔除**（把与强目标距离差恰为整数倍分辨率单元的检测点判为旁瓣）。' },
          { t: 'callout', kind: 'pit', title: '⑥ 常见误区：把"主瓣宽度"当成"分辨能力"', md: '−3 dB 主瓣宽度（本例 2.66 m）常被当作分辨两个目标的最小间距，这是不对的。两个**等强**目标要能分辨，间距需约等于 −3 dB 宽度；但两个**强度差 30 dB** 的目标，即使相距 20 个分辨率单元，弱目标仍可能埋在强目标的旁瓣里。**"能否分辨"取决于旁瓣电平与强度差，而不是主瓣宽度**——这就是为什么高动态场景（强地物中的弱目标）必须死磕旁瓣而不是死磕带宽。' },
          { t: 'callout', kind: 'pit', title: '⑦ 常见误区：认为处理增益可以无限提高', md: '加大 $BT$ 的确提高处理增益，但三条限制马上到来：**多普勒容忍度变差**（耦合 $\\Delta R=\\tfrac{c}{2}f_dT/B$ 随 $T/B$ 增大）、**近距盲区变大**（$R_{\\min}=cT/2$，本例 20 µs 就有 3 km 盲区！）、**相位噪声要求变苛刻**。本例若要 $BT=5000$，在 $B=50\\,\\text{MHz}$ 下需要 $T=100\\,\\mu\\text{s}$，盲区直接到 15 km，只能改用双波形（远程长脉冲 + 近程短脉冲补盲）。' },
          { t: 'md', md: '⑧ **慢速目标落入零频**：脉压后若无慢时间处理，慢速目标与静止杂波在距离维完全无法区分，必须交给下一节的动目标显示/动目标检测去解决。\n\n⑨ **通道失配**：多通道（和差三通道、数字阵列）的幅相不一致会让脉压输出在通道间的相对关系失真，直接影响单脉冲测角精度。要求通常写死为幅度 ≤ 0.3 dB、相位 ≤ 3°，且需在全温范围内做校准表。' },
          { t: 'md', md: '记住这本账：**处理增益 $=10\\lg(BT)$**（30 dB，能量的账）；**距离分辨率 $=c/2B$**（3 m，带宽的账）；**压旁瓣付 1.34 dB 且展宽 1.47 倍**（旁瓣的账）；**距离徙动 $=\\tfrac{c}{2}f_dT/B$**（1.2 m @ 300 m/s，多普勒的账）。四笔账相互独立又互相牵制，所谓波形设计就是按任务在这四笔账之间做取舍。' },
          { t: 'lab', item: { path: 'lab/matched', title: '匹配滤波与脉冲压缩实验台', desc: '在不同波形与窗函数下实测处理增益、峰值旁瓣、积分旁瓣与主瓣宽度' } },
          { t: 'chips', list: ['线性调频', '脉冲压缩', '匹配滤波', '距离-多普勒耦合', '旁瓣加权', '去斜处理', '相位噪声', '灵敏度时间控制'], cls: 'teal' }
        ]
      }
    ],
    refs: REFS
  });

  /* ============================================================
     案例二：MTI 动目标显示与 MTD 相参积累
     ============================================================= */

  /** 交互仿真：MTI 对消 + MTD 多普勒滤波器组（距离-多普勒二维） */
  function simMTD(el) {
    const LAM = 0.1;                 // S 波段 λ = 0.1 m（f0 = 3 GHz）
    const NR = 96;                   // 距离单元数
    const CB = 40;                   // 地物杂波占据 0～39 号距离单元
    const RT = 48;                   // 目标所在距离单元
    const st = { cnr: 40, v: 40, prf: 2000, np: 32, canc: 'c2', win: 'hann', sw: 8 };

    const boxA = UI.plotBox({ title: 'MTD 输出：距离-多普勒二维图（dB，相对最大值）' });
    const boxB = UI.plotBox({ title: '目标距离单元的多普勒剖面（有无 MTI 对照）' });
    const boxC = UI.plotBox({ title: '对消器凹口频响与目标多普勒位置' });
    const mB = P.new(boxB.canvas, { height: 240, xlabel: '速度 / m/s', ylabel: '幅度 / dB', legend: true, legendPos: 'tl' });
    const mC = P.new(boxC.canvas, { height: 240, xlabel: '速度 / m/s', ylabel: '对消器响应 / dB', legend: true, legendPos: 'tl' });
    const mBox = h('div.metrics');
    const note = h('div.prose');

    const CANCEL = {
      none: { w: [1], name: '无 MTI（直通）' },
      c1: { w: [1, -1], name: '单脉冲对消 H(z)=1−z⁻¹' },
      c2: { w: [1, -2, 1], name: '双脉冲对消 H(z)=(1−z⁻¹)²' },
      c3: { w: [1, -3, 3, -1], name: '三脉冲对消 H(z)=(1−z⁻¹)³' }
    };

    const recalc = U.rafThrottle(function () {
      const Tr = 1 / st.prf;
      const np = st.np;
      const M = CANCEL[st.canc].w.length - 1;          // 对消器延迟级数
      const Mp = np - M;                                // 对消后剩余脉冲数
      const Nf = C.nextPow2(Math.max(64, Mp));          // 多普勒 FFT 长度
      const fd = 2 * st.v / LAM;                        // 真实多普勒 Hz
      const vPeriod = LAM * st.prf / 2;                 // 速度模糊周期 λ·fr/2
      const vu = LAM * st.prf / 4;                      // 最大不模糊速度
      // 视在（折叠）速度：映射到 [−vu, vu)
      let vApp = ((st.v + vu) % vPeriod + vPeriod) % vPeriod - vu;
      const fdApp = 2 * vApp / LAM;
      const blind = Math.abs(vApp) < vu * 0.04;         // 落在凹口内 ≈ 盲速

      /* ---------- 生成数据立方（脉冲 × 距离单元） ---------- */
      const nR = U.randn(np * NR, 7001), nI = U.randn(np * NR, 7002);
      const cTexR = U.randn(NR, 7103), cTexI = U.randn(NR, 7104);
      const cF = U.randn(NR, 7105);                     // 每个杂波单元的内部运动多普勒
      const cAmp = Math.sqrt(Math.pow(10, st.cnr / 10)); // 杂波幅度（相对噪声功率 1）
      const tAmp = 1;                                   // 目标幅度（单脉冲信噪比 0 dB）

      const xr = new Float64Array(np * NR), xi = new Float64Array(np * NR);
      for (let m = 0; m < np; m++) {
        const phT = 2 * Math.PI * fdApp * m * Tr;
        const ct = Math.cos(phT), stt = Math.sin(phT);
        for (let r = 0; r < NR; r++) {
          const idx = m * NR + r;
          // 噪声（单位功率）
          let rr = nR[idx] * Math.SQRT1_2, ii = nI[idx] * Math.SQRT1_2;
          // 杂波：幅度纹理 × 缓慢旋转的相位（内部运动）
          if (r < CB) {
            const phC = 2 * Math.PI * (cF[r] * st.sw / 10) * m * Tr + Math.atan2(cTexI[r], cTexR[r]);
            const a = cAmp * Math.sqrt(cTexR[r] * cTexR[r] + cTexI[r] * cTexI[r]) / 1.4;
            rr += a * Math.cos(phC); ii += a * Math.sin(phC);
          }
          // 目标
          if (r === RT) { rr += tAmp * ct; ii += tAmp * stt; }
          xr[idx] = rr; xi[idx] = ii;
        }
      }

      /* ---------- 慢时间 MTI 对消 ---------- */
      const w = CANCEL[st.canc].w;
      const yr = new Float64Array(Mp * NR), yi = new Float64Array(Mp * NR);
      for (let m = 0; m < Mp; m++) {
        for (let r = 0; r < NR; r++) {
          let sr = 0, si = 0;
          for (let k = 0; k < w.length; k++) {
            const idx = (m + k) * NR + r;
            sr += w[k] * xr[idx]; si += w[k] * xi[idx];
          }
          const o = m * NR + r;
          yr[o] = sr; yi[o] = si;
        }
      }

      /* ---------- 加窗 + 多普勒 FFT（逐距离单元） ---------- */
      const win = mkWin(st.win, Mp);
      let wGain = 0;
      for (let i = 0; i < Mp; i++) wGain += win[i];

      // 对消前杂波功率（输入参考）
      let pcIn = 0, nIn = 0;
      for (let m = 0; m < np; m++) for (let r = 0; r < CB; r++) {
        pcIn += xr[m * NR + r] * xr[m * NR + r] + xi[m * NR + r] * xi[m * NR + r]; nIn++;
      }
      pcIn = Math.max(pcIn / nIn, 1e-30);
      // 对消后杂波功率
      let pcOut = 0, nOut = 0;
      for (let m = 0; m < Mp; m++) for (let r = 0; r < CB; r++) {
        pcOut += yr[m * NR + r] * yr[m * NR + r] + yi[m * NR + r] * yi[m * NR + r]; nOut++;
      }
      pcOut = Math.max(pcOut / nOut, 1e-30);
      const caDb = 10 * Math.log10(pcIn / pcOut);

      const mapR = new Float64Array(NR * Nf), mapI = new Float64Array(NR * Nf);
      const profMti = new Float64Array(Nf), profRaw = new Float64Array(Nf);
      let mx = 0;
      for (let r = 0; r < NR; r++) {
        const br = new Float64Array(Mp), bi = new Float64Array(Mp);
        for (let m = 0; m < Mp; m++) { br[m] = yr[m * NR + r] * win[m]; bi[m] = yi[m * NR + r] * win[m]; }
        const F = C.fftC({ re: br, im: bi }, Nf);
        for (let s = 0; s < Nf; s++) {
          const k = (s + Nf / 2) % Nf;                  // fftshift：s=0 ↔ 最低频率
          const v = F.re[k] * F.re[k] + F.im[k] * F.im[k];
          mapR[r * Nf + s] = v;                          // 热图布局：列=距离，行=多普勒
          if (v > mx) mx = v;
        }
        // 无 MTI 对照剖面
        for (let m = 0; m < np; m++) { br[m] = xr[m * NR + r] * win[m]; bi[m] = xi[m * NR + r] * win[m]; }
        const F2 = C.fftC({ re: br, im: bi }, Nf);
        for (let s = 0; s < Nf; s++) {
          const k = (s + Nf / 2) % Nf;
          profRaw[s] = Math.max(profRaw[s], F2.re[k] * F2.re[k] + F2.im[k] * F2.im[k]);
        }
      }
      for (let s = 0; s < Nf; s++) {
        const k = (s + Nf / 2) % Nf;
        profMti[s] = mapR[RT * Nf + s];
      }

      /* ---------- 杂波衰减后的输出底（用于剖面纵轴） ---------- */
      const vmax = st.prf * LAM / 4;
      const dbMax = 10 * Math.log10(Math.max(mx, 1e-30));
      const mapDb = new Float64Array(mapR.length);
      for (let i = 0; i < mapR.length; i++) mapDb[i] = 10 * Math.log10(Math.max(mapR[i], 1e-30));
      P.heatmap(boxA.canvas, {
        data: mapDb, cols: NR, rows: Nf,
        xlim: [0, NR - 1], ylim: [-vmax, vmax], flipY: true,
        xlabel: '距离单元（1 单元 = 250 m）', ylabel: '视在速度 / m/s',
        vmin: dbMax - 45, vmax: dbMax, height: 300,
        title: '距离-多普勒图：零速亮带（无 MTI 时）= 地物杂波，游动亮点 = 目标'
      });

      // 目标距离单元剖面（dB，相对该剖面最大值）
      const pMti = dbP(profMti), pRaw = dbP(profRaw);
      let pmx = 0;
      for (let s = 0; s < Nf; s++) if (pMti[s] > pmx) pmx = pMti[s];
      for (let s = 0; s < Nf; s++) if (pRaw[s] > pmx) pmx = pRaw[s];
      const vAx = [], dM = [], dR = [];
      for (let s = 0; s < Nf; s++) {
        vAx.push(-vmax + (s + 0.5) / Nf * 2 * vmax);
        dM.push(pMti[s] - pmx);
        dR.push(pRaw[s] - pmx);
      }
      const floorM = 10 * Math.log10(Math.max(pcOut * wGain * wGain * NR, 1e-30)) - pmx + 30;
      mB.clear()
        .add({ x: vAx, y: arr(dR), type: 'line', color: 3, width: 1.2, dash: [4, 3], label: '无 MTI（杂波淹没一切）' })
        .add({ x: vAx, y: arr(dM), type: 'line', color: 0, width: 1.6, label: 'MTI + 加窗 FFT' })
        .vline(vApp, { label: '目标视在速度 ' + vApp.toFixed(0) + ' m/s', color: '#0f766e' })
        .hline(-45, { label: '显示动态下限', color: '#94a3b8' })
        .draw();

      // 对消器频响（含窗的展宽不画，只看凹口）
      const fAx = [], hDb = [];
      const wc = CANCEL[st.canc].w;
      for (let i = 0; i <= 200; i++) {
        const vv = -vmax + i / 200 * 2 * vmax;
        const f = 2 * vv / LAM;
        let hr = 0, hi = 0;
        for (let k = 0; k < wc.length; k++) {
          const ph = -2 * Math.PI * f * k * Tr;
          hr += wc[k] * Math.cos(ph); hi += wc[k] * Math.sin(ph);
        }
        fAx.push(vv);
        hDb.push(Math.max(20 * Math.log10(Math.max(Math.sqrt(hr * hr + hi * hi) / wc.length, 1e-6)), -60));
      }
      mC.clear()
        .add({ x: fAx, y: hDb, type: 'line', color: 1, width: 1.5, label: CANCEL[st.canc].name })
        .vline(vApp, { label: '目标视在速度', color: '#0f766e' })
        .hline(-3, { label: '−3 dB', color: '#b45309' })
        .draw();

      /* ---------- 理论改善因子（高斯杂波谱模型） ---------- */
      const rho = Math.exp(-2 * Math.PI * Math.PI * st.sw * st.sw * Tr * Tr);
      const i1 = 1 / (1 - rho), i2 = 3 / (3 - 4 * rho + rho * rho), i3 = 10 / (10 - 15 * rho + 6 * rho * rho - rho * rho * rho);
      const iTh = st.canc === 'c1' ? i1 : (st.canc === 'c2' ? i2 : (st.canc === 'c3' ? i3 : 1));

      // 实测改善因子：输出目标峰值 / 输出杂波底 相对输入 SCR 的变化
      const ptOut = (function () {
        let best = 0;
        for (let s = Math.max(0, Math.round((vApp + vmax) / (2 * vmax) * Nf) - 2);
             s <= Math.min(Nf - 1, Math.round((vApp + vmax) / (2 * vmax) * Nf) + 2); s++) {
          if (profMti[s] > best) best = profMti[s];
        }
        return best;
      })();
      const scrIn = tAmp * tAmp / pcIn;
      const scrOut = ptOut / Math.max(pcOut * wGain * wGain * NR, 1e-30);
      const iMeas = 10 * Math.log10(Math.max(scrOut / scrIn, 1e-9));

      fillMetrics(mBox, [
        ['波长 / 第一盲速', LAM.toFixed(2) + ' / ' + vPeriod.toFixed(0), 'm / m·s⁻¹'],
        ['最大不模糊速度', vu.toFixed(0), 'm/s'],
        ['目标视在速度（折叠后）', vApp.toFixed(0), 'm/s'],
        ['相参积累增益 10lgN′', (10 * Math.log10(Math.max(Mp, 1))).toFixed(1), 'dB'],
        ['多普勒分辨率 1/N′Tr', (st.prf / Mp).toFixed(1), 'Hz'],
        ['速度分辨率 λ/2N′Tr', (LAM / 2 * st.prf / Mp).toFixed(2), 'm/s'],
        ['实测杂波衰减 CA', caDb.toFixed(1), 'dB'],
        ['改善因子（实测 / 理论）', iMeas.toFixed(1) + ' / ' + (10 * Math.log10(iTh)).toFixed(1), 'dB']
      ]);

      /* ---------- 动态解读 ---------- */
      note.innerHTML = U.md(
        '**当前状态解读：** 波长 ' + LAM.toFixed(2) + ' m、重频 ' + st.prf.toFixed(0) + ' Hz → 速度模糊周期 $\\lambda f_r/2=' +
        vPeriod.toFixed(0) + '\\,\\text{m/s}$，最大不模糊速度 $v_u=\\lambda f_r/4=\\pm' + vu.toFixed(0) + '\\,\\text{m/s}$，' +
        '第一盲速 $v_b=\\lambda f_r/2=' + vPeriod.toFixed(0) + '\\,\\text{m/s}$。目标真实速度 ' + st.v.toFixed(0) +
        ' m/s 折叠后视在速度为 ' + vApp.toFixed(0) + ' m/s' +
        (Math.abs(st.v) > vu ? '（**多普勒模糊**：真实速度超出了 $\\pm' + vu.toFixed(0) + '$ 的不模糊范围，热图上看到的峰位置是折叠值）' : '') +
        (blind ? '，**恰好落在对消器凹口里——这就是盲速**：热图上目标完全消失，被零频杂波"吃"掉了。对策是重频参差（让凹口位置互相错开）或改高重频体制。' : '，不在凹口内，可以检测。') +
        ' 对消器取 ' + CANCEL[st.canc].name + '、杂波谱宽 ' + st.sw.toFixed(0) + ' Hz：相邻脉冲杂波相关系数 $\\rho=\\exp(-2\\pi^2\\sigma_c^2T_r^2)=' +
        rho.toFixed(5) + '$，理论改善因子 ' + (10 * Math.log10(iTh)).toFixed(1) + ' dB，' +
        '实测杂波衰减 ' + caDb.toFixed(1) + ' dB（含窗函数加权差异与有限样本起伏，量级吻合）。' +
        '脉冲数 ' + st.np.toFixed(0) + ' → 对消后剩 ' + Mp + ' 个有效脉冲，相参积累增益 $10\\lg N′=' + (10 * Math.log10(Mp)).toFixed(1) +
        '\\,\\text{dB}$，多普勒分辨率 $1/(N′T_r)=' + (st.prf / Mp).toFixed(1) + '\\,\\text{Hz}$（即 ' + (LAM / 2 * st.prf / Mp).toFixed(2) + ' m/s）。' +
        (st.win === 'rect'
          ? ' 多普勒窗取矩形：滤波器旁瓣只有 −13 dB，强杂波会通过旁瓣漏进所有多普勒通道（看右图热图上杂波条上下的"毛刺"）。'
          : ' 多普勒窗取' + WIN_NAME[st.win] + '：多普勒旁瓣被压低，代价是主瓣展宽约 1.5 倍、信噪比损失 ' + winLossDb(mkWin(st.win, Mp)).toFixed(2) + ' dB —— 与脉压加窗是同一笔账。') +
        (st.cnr > 50 ? ' 杂波强度 ' + st.cnr + ' dB 已经进入实际装备的禁区：单级对消器剩余杂波仍比目标强，实际装备必须用自适应 MTI（凹口自动对准杂波谱中心）或两级级联。' : '')
      );
      UI.renderMathIn(note);
    });

    const sCnr = UI.slider({ label: '地物杂波强度（相对噪声）', min: 10, max: 60, step: 2, value: st.cnr, unit: 'dB', hint: '真实地物杂波比目标回波强 40～70 dB', onInput: v => { st.cnr = v; recalc(); } });
    const sV = UI.slider({ label: '目标径向速度', min: 0, max: 250, step: 5, value: st.v, unit: 'm/s', hint: '拖到第一盲速（λfr/2）看目标消失', onInput: v => { st.v = v; recalc(); } });
    const sPrf = UI.slider({ label: '脉冲重复频率', min: 500, max: 5000, step: 100, value: st.prf, unit: 'Hz', hint: '同时决定不模糊距离 c/2fr 与不模糊速度 λfr/4', onInput: v => { st.prf = v; recalc(); } });
    const sNp = UI.slider({ label: '相参处理脉冲数', min: 8, max: 64, step: 8, value: st.np, unit: '个', hint: '积累增益 10lgN 与多普勒分辨率都由它决定', onInput: v => { st.np = v; recalc(); } });
    const sSw = UI.slider({ label: '杂波谱宽（内部运动）', min: 0, max: 40, step: 1, value: st.sw, unit: 'Hz', hint: '风吹植被/海浪使杂波谱展宽，直接压低改善因子', onInput: v => { st.sw = v; recalc(); } });
    const selC = UI.select({
      label: 'MTI 对消器', value: st.canc, hint: '阶数越高凹口越宽越深，但信噪比损失也越大',
      options: [
        { value: 'none', label: '无 MTI（直通）' },
        { value: 'c1', label: '单脉冲对消 1−z⁻¹' },
        { value: 'c2', label: '双脉冲对消 (1−z⁻¹)²' },
        { value: 'c3', label: '三脉冲对消 (1−z⁻¹)³' }
      ],
      onChange: v => { st.canc = v; recalc(); }
    });
    const selW = UI.select({
      label: '多普勒窗', value: st.win, hint: '压多普勒旁瓣，防止强杂波经旁瓣漏进其他通道',
      options: [
        { value: 'rect', label: '矩形（旁瓣 −13 dB）' },
        { value: 'hann', label: '汉宁' },
        { value: 'hamming', label: '汉明' },
        { value: 'blackman', label: '布莱克曼' }
      ],
      onChange: v => { st.win = v; recalc(); }
    });

    el.appendChild(UI.ctrlPanel('仿真参数（S 波段 λ=0.1 m，距离单元 250 m，杂波占前 40 个单元，目标在第 48 单元）',
      [sCnr, sV, sPrf, sNp, sSw, selC, selW]));
    el.appendChild(boxA.el);
    el.appendChild(h('div.grid.g2', {}, [boxB.el, boxC.el]));
    el.appendChild(mBox);
    el.appendChild(h('div.plot-cap', { html: U.md('上：距离-多普勒二维图，横条为零频地物杂波，亮点为目标峰；左下：目标距离单元的多普勒剖面（虚线为不做 MTI 的对照）；右下：对消器凹口频响与目标视在速度的相对位置。') }));
    el.appendChild(note);
    recalc();
  }

  doc.register('cases/radar/mti-mtd', {
    title: '案例二：MTI 动目标显示与 MTD 相参积累',
    lede: '地物杂波比飞机回波强 40～70 dB——不做慢时间处理，屏幕上只有一片亮带。本节把单/双/三脉冲对消器的凹口、改善因子、盲速与 MTD 多普勒滤波器组一次讲透，并用距离-多普勒二维热图亲眼看到"盲速吃目标"。',
    tags: ['雷达', 'MTI', 'MTD', '相参积累', '盲速'],
    labs: [{ path: 'lab/dft', title: 'DFT/FFT：栅栏效应与频谱泄漏实验台', desc: '多普勒滤波器组就是慢时间维的 DFT，先理解加窗与泄漏' }],
    toc: true,
    sections: [
      {
        id: 'bg', num: '1', title: '工程背景：杂波比目标强 40～70 dB 的世界',
        blocks: [
          { t: 'md', md: '一架雷达截面积 5 m² 的飞机在 50 km 处，回波功率比它脚下那片地物杂波低多少？粗算：飞机截面积 5 m²；而一个距离单元（比如 250 m × 波束宽 2° 的弧长 1.7 km）内的地物，在入射余角 1° 下的等效截面积轻松达到 $10^4\\sim10^6\\,\\text{m}^2$。**杂波比目标强 40～70 dB（一万倍到一千万倍）**。此时若直接把脉压输出画在显示器上，你只会看到一片沿距离轴的亮带——飞机就藏在亮带里，根本看不见。' },
          { t: 'md', md: '好消息是杂波与目标有一个本质区别：**静止地物的多普勒为零，飞机的多普勒不为零**。MTI（动目标显示）与 MTD（动目标检测）正是利用这一点，在慢时间维（脉冲与脉冲之间）把零频杂波滤掉、把目标能量积累出来。以一型典型 S 波段两坐标警戒雷达为例：' },
          { t: 'table', cols: ['项目', '典型取值', '为什么是这个数'], rows: [
            ['工作频率', 'S 波段 2.8～3.2 GHz（$\\lambda\\approx0.1\\,\\text{m}$）', '远程警戒要兼顾大气衰减与角分辨率，S 波段是经典折中'],
            ['脉冲重复频率', '低重频 300～1000 Hz 或中重频 1～4 kHz', '低重频测距不模糊（$R_u=c/2f_r$ 达 150 km 以上）但测速模糊；两者不可兼得'],
            ['相参处理脉冲数', '8～64（一个相参处理间隔）', '决定积累增益 $10\\lg N$ 与多普勒分辨率 $1/(NT_r)$'],
            ['地物杂波强度', '比噪声高 40～60 dB', '低入射余角 + 大距离单元，等效截面积巨大'],
            ['杂波谱宽', '0.5～20 Hz（静止地物～风吹植被）', '内部运动（树叶、海浪、雨滴）决定杂波谱不为零宽，直接限制改善因子'],
            ['改善因子需求', '≥ 40 dB', '要把 −40 dB 的目标从杂波里捞出来，MTI 至少要提供 40 dB'],
            ['速度分辨率', '$\\lambda/(2NT_r)$，典型 1～5 m/s', '区分直升机（悬停旋翼）与慢速运输机的门槛'],
            ['作用距离', '150～400 km', '低重频 + 大脉压比 + 远程驻留']
          ] },
          { t: 'metrics', list: [
            { label: '杂波/目标功率比', value: '40～70', unit: 'dB' },
            { label: '相参积累增益', value: '15', unit: 'dB（N=32）' },
            { label: '改善因子需求', value: '≥40', unit: 'dB' },
            { label: '速度分辨率', value: '1～5', unit: 'm/s' }
          ] },
          { t: 'callout', kind: 'eng', title: '工程师视角：MTI、MTD、脉冲多普勒三种体制的边界', md: '这三个词常被混用，工程上边界其实很清楚：\n\n① **MTI**：慢时间维只做"对消"（一个有限冲激响应高通），把零频杂波滤掉，输出仍是距离维一维画面。实现便宜，但只剩凹口两侧的多普勒信息，且对杂波谱中心偏移敏感；\n② **MTD**：慢时间维做一整个**多普勒滤波器组（FFT）**，每个距离-多普勒单元独立过恒虚警检测。增益比 MTI 高 3～6 dB，还能顺带给出目标径向速度，是现代雷达的标配；\n③ **脉冲多普勒（PD）**：高重频体制，模糊图上距离维高度模糊但速度维清晰，配合距离门滤波器组，专攻强地物背景中的高速目标（机载下视）。三者共享同一套数学：慢时间维的离散傅里叶变换与凹口滤波。' }
        ]
      },
      {
        id: 'model', num: '2', title: '信号模型：慢时间维、杂波谱与起伏',
        blocks: [
          { t: 'md', md: '脉压之后，数据组织成一个三维立方体：**距离（快时间采样）× 脉冲序号（慢时间）× 通道**。本节的处理全部发生在慢时间维：对每个距离门，取 $N$ 个脉冲的复样本组成一个慢时间序列' },
          { t: 'math', tex: 'x_m(R) = A\\,e^{j2\\pi f_d m T_r}\\,e^{j\\varphi_0} + c_m(R) + n_m(R),\\quad m=0,1,\\dots,N-1', tag: '(1)' },
          { t: 'kv', title: '变量说明', pairs: [
            ['$m$', '脉冲序号（慢时间），第 $m$ 个脉冲的时刻为 $mT_r$，$T_r=1/f_r$ 为脉冲重复周期'],
            ['$f_d = 2v/\\lambda$', '目标多普勒频率。$v=100\\,\\text{m/s}$、$\\lambda=0.1\\,\\text{m}$ 时 $f_d=2\\,\\text{kHz}$'],
            ['$c_m(R)$', '该距离门的杂波复样本：大量散射体回波叠加，中心频率为杂波谱中心（静止地物为 0）'],
            ['$n_m(R)$', '接收机热噪声，各脉冲独立（这是噪声与杂波的关键区别：杂波脉冲间强相关，噪声不相关）'],
            ['$\\varphi_0$', '随机初相，逐驻留周期独立（全相参体制下脉冲间保持相干）']
          ] },
          { t: 'md', md: '为什么"脉冲间独立"的噪声可以用 FFT 积累而强相关的杂波不能？看功率谱就明白：慢时间 FFT 相当于一组窄带滤波器，每个滤波器的输出噪声功率不变（白噪声均匀分布），而集中在零频的杂波只落入零频附近的少数滤波器——**这就是相参积累对噪声有效、对杂波必须先对消的原因**。' },
          { t: 'md', md: '**杂波谱模型**是本节最重要的工程输入。地物杂波谱通常建模为中心频率 $f_c$（静止地物为 0，被风吹动的植被有整体漂移）、标准差 $\\sigma_c$ 的高斯谱：' },
          { t: 'math', tex: 'S_c(f) = \\frac{P_c}{\\sqrt{2\\pi}\\,\\sigma_c}\\exp\\!\\left[-\\frac{(f-f_c)^2}{2\\sigma_c^{2}}\\right],\\qquad \\sigma_c = \\frac{2\\sigma_v}{\\lambda}', tag: '(2)' },
          { t: 'md', md: '$\\sigma_v$ 是散射体径向速度起伏的标准差：静止地物约 0～0.2 m/s，风吹植被 0.3～1 m/s，海浪 0.5～2 m/s，气象杂波 1～4 m/s。注意 $\\sigma_c=2\\sigma_v/\\lambda$：**同一个杂波源，波长越短谱越宽**——X 波段雷达的杂波谱宽是 S 波段的 3 倍，这就是远程警戒雷达宁愿用 S 波段的原因之一。' },
          { t: 'md', md: '**杂波幅度起伏**同样重要：每个距离-方位单元的杂波强度随地形、入射余角剧烈变化（静态场景下可达 10～20 dB 的单元间起伏），这就是后一节恒虚警检测存在的根本理由。目标的幅度起伏用 Swerling 模型描述（见案例一第 2 节），慢起伏（Swerling I）在积累中不提供分集增益，快起伏（Swerling II）则提供 $\\sqrt{N}$ 量级的额外检测增益。' },
          { t: 'fold', summary: '展开：回波的慢时间相位从哪里来（把 $e^{j2\\pi f_dmT_r}$ 推出来）', deriv: true, blocks: [
            { t: 'md', md: '目标初始距离 $R_0$、径向速度 $v$（接近为正），第 $m$ 个脉冲发射时刻目标的距离为 $R(m)=R_0-vmT_r$，回波时延 $\\tau_m=2R(m)/c$。取载频相位：' },
            { t: 'math', tex: 's_m(t) = A\\,\\Re\\!\\left\\{u(t-\\tau_m)\\,e^{j2\\pi f_0(t-\\tau_m)}\\right\\}' },
            { t: 'md', md: '正交解调取复包络，在脉冲中心 $t\\approx\\tau_m$ 处采样，得到' },
            { t: 'math', tex: 'x_m \\propto A\\,e^{-j2\\pi f_0\\tau_m} = A\\,e^{-j\\frac{4\\pi}{\\lambda}\\left(R_0 - v mT_r\\right)} = A\\,e^{-j\\frac{4\\pi R_0}{\\lambda}}\\cdot e^{j\\frac{4\\pi v}{\\lambda}mT_r}' },
            { t: 'md', md: '第一项是常数初相，第二项正是 $e^{j2\\pi f_dmT_r}$，其中 $f_d=2v/\\lambda$。**要点：多普勒相位是"逐脉冲线性递增"的，所以慢时间维的匹配处理就是一个离散傅里叶变换**——这是 MTD 全部数学的出发点。' },
            { t: 'md', md: '顺带可得相参积累增益的来历：$N$ 个脉冲同相叠加，信号功率乘 $N^2$，噪声功率（不相关）只乘 $N$，信噪比乘 $N$，即 $10\\lg N$。而杂波若与信号一样脉冲间强相关，同样乘 $N^2$——**对杂波，积累毫无用处，必须先用对消器把它打掉**。' }
          ] },
          { t: 'callout', kind: 'pit', title: '坑：把"积累"当成万能增益', md: '相参积累增益 $10\\lg N$ 只对**脉冲间不相关的噪声**成立。对杂波：静止地物回波脉冲间完全相关，积累增益为零；杂波只能靠对消器（利用其相关性反把它相消）处理。更隐蔽的是：**目标跨距离门徙动**（高速目标在 $N$ 个脉冲期间移动超过一个距离单元）与**目标跨多普勒门徙动**（加速度、旋转部件）都会让积累增益显著低于 $10\\lg N$。N=64 时若不做徙动校正，实际增益可能只有 12 dB 而不是 18 dB。' }
        ]
      },
      {
        id: 'algo', num: '3', title: '算法原理回顾：对消器、改善因子与多普勒滤波器组',
        blocks: [
          { t: 'md', md: 'MTI 的核心是慢时间维的**高通滤波**。单脉冲对消器的系统函数为 $H(z)=1-z^{-1}$，它在零频有一个凹口；双脉冲、三脉冲对消器分别是它的二次方、三次方，凹口更宽更深：' },
          { t: 'math', tex: 'H_1(z)=1-z^{-1},\\quad H_2(z)=(1-z^{-1})^{2},\\quad H_3(z)=(1-z^{-1})^{3},\\qquad |H_1(f)|=2\\left|\\sin(\\pi fT_r)\\right|', tag: '(3)' },
          { t: 'md', md: '**改善因子**是 MTI 的核心指标，定义为输出信杂比与输入信杂比之比（对目标多普勒取平均）。设杂波相邻脉冲相关系数为 $\\rho=\\exp(-2\\pi^2\\sigma_c^2T_r^2)$（高斯谱模型），则各阶对消器的改善因子有解析式：' },
          { t: 'math', tex: 'I_1=\\frac{1}{1-\\rho},\\qquad I_2=\\frac{3}{3-4\\rho+\\rho^{2}},\\qquad I_3=\\frac{10}{10-15\\rho+6\\rho^{2}-\\rho^{3}}', tag: '(4)' },
          { t: 'md', md: '**代入真数**：$\\lambda=0.1\\,\\text{m}$、$f_r=1\\,\\text{kHz}$（$T_r=1\\,\\text{ms}$）、风吹植被 $\\sigma_v=0.5\\,\\text{m/s}$ → $\\sigma_c=10\\,\\text{Hz}$ → $\\rho=\\exp(-2\\pi^2\\times100\\times10^{-6})=0.998$ → $I_1=27\\,\\text{dB}$、$I_2=37\\,\\text{dB}$、$I_3=44\\,\\text{dB}$。**杂波谱越宽（$\\sigma_c$ 大）或重频越低（$T_r$ 大），$\\rho$ 越接近 1，改善因子越差**——这就是"杂波内部运动限制改善因子"的定量表述。' },
          { t: 'fold', summary: '展开：式 (4) 的改善因子公式怎么推出来的', deriv: true, blocks: [
            { t: 'md', md: '设杂波是零均值平稳高斯过程，功率 $P_c$，相关函数 $R(k)=P_c\\rho^{|k|}$。对消器输出杂波功率为二次型：' },
            { t: 'math', tex: 'P_{out}=\\sum_k\\sum_l w_k w_l^{*}R(k-l)=P_c\\left[\\sum_k w_k^{2}+2\\sum_{k<l}w_kw_l\\rho^{\\,l-k}\\right]' },
            { t: 'md', md: '单对消器 $w=[1,-1]$：$P_{out}/P_c=2-2\\rho$。目标信号在多普勒上均匀分布，平均功率增益为 $\\sum w_k^2=2$（最大增益在 $f=f_r/2$ 处为 4，平均为 2）。于是按平均定义' },
            { t: 'math', tex: 'I_1=\\frac{G_{sig}}{P_{out}/P_c}=\\frac{2}{2-2\\rho}=\\frac{1}{1-\\rho}' },
            { t: 'md', md: '双对消器 $w=[1,-2,1]$：$P_{out}/P_c=6-8\\rho+2\\rho^2$，平均信号增益 $\\sum w_k^2=6$，故 $I_2=6/(6-8\\rho+2\\rho^2)=3/(3-4\\rho+\\rho^2)$。三脉冲同理（$P_{out}/P_c=20-30\\rho+12\\rho^2-2\\rho^3$，增益 20）。' },
            { t: 'md', md: '$\\rho\\to1$（完全相关杂波）时分母趋于零，改善因子趋于无穷——理想情况；实际上受杂波谱宽、系统稳定性（相位噪声、定时抖动）、模数转换量化等因素限制，**单级对消器的改善因子上限通常只有 20～30 dB**，这也解释了为什么实际装备要用两级以上。' }
          ] },
          { t: 'table', cols: ['对消器', '系统函数', '凹口宽度（−3 dB）', '信噪比损失', '典型改善因子（ρ=0.998）', '备注'], rows: [
            ['单脉冲', '$1-z^{-1}$', '$\\approx0.31f_r$', '3 dB', '27 dB', '最简单，对谱宽最敏感'],
            ['双脉冲', '$(1-z^{-1})^{2}$', '$\\approx0.44f_r$', '6 dB（速度均匀时）', '37 dB', '工程最常用'],
            ['三脉冲', '$(1-z^{-1})^{3}$', '$\\approx0.53f_r$', '9 dB', '44 dB', '强杂波区选用'],
            ['反馈对消器（IIR）', '带极点的高通', '可调', '小', '50 dB 以上', '瞬态响应长，现代少用']
          ] },
          { t: 'md', md: '**MTD：慢时间 FFT = 多普勒滤波器组。** 对每个距离门做 $N$ 点离散傅里叶变换，等效于把多普勒轴切成 $N$ 个相邻的窄带滤波器，第 $k$ 个滤波器中心频率 $f_k=k/(NT_r)$。它同时完成三件事：' },
          { t: 'md', md: '① **相参积累**：落在某个滤波器通带内的目标，$N$ 个脉冲同相叠加，信噪比提升 $10\\lg N$（本例 32 脉冲 = 15 dB）；\n② **测速**：峰值所在滤波器的序号直接给出多普勒频率（速度），分辨率 $1/(NT_r)$；\n③ **杂波分离**：零频杂波只占据少数滤波器，其余滤波器里目标"干净"地露出来。' },
          { t: 'math', tex: '\\Delta f=\\frac{1}{NT_r},\\qquad \\Delta v=\\frac{\\lambda}{2NT_r},\\qquad v_u=\\pm\\frac{\\lambda f_r}{4},\\qquad v_b=n\\cdot\\frac{\\lambda f_r}{2},\\ n=1,2,\\dots', tag: '(5)' },
          { t: 'md', md: '多普勒滤波器组同样要**加窗**：矩形窗的滤波器旁瓣只有 −13 dB，强杂波会通过旁瓣漏进所有通道（表现为距离-多普勒图上杂波条上下的"毛刺带"），加汉宁/汉明窗压到 −31/−41 dB，代价是主瓣展宽约 1.5 倍（速度分辨率变差）与约 1.3～1.8 dB 信噪比损失。' },
          { t: 'callout', kind: 'pit', title: '坑：盲相位（单通道处理的天生缺陷）', md: '如果系统只用单路（实信号）处理而不用正交双路（$I/Q$），目标多普勒相位可能与采样时刻"对齐"，出现**盲相位**：某些特定多普勒频率的目标在部分脉冲上的采样值恰好为零，对消后损失一半以上增益。全相参雷达一律采用 $I/Q$ 双通道正交采样，配合数字下变频，从根本上避免盲相位——这也是第 4 节链路里"数字下变频"一级必须做校准的原因。' },
          { t: 'callout', kind: 'tip', title: '与知识库的对应关系', md: '慢时间维 FFT 就是标准 DFT，栅栏效应、频谱泄漏与加窗的全部结论都适用于多普勒滤波器组，见「DFT 离散傅里叶变换」与「窗函数基础」两节；$H(z)=1-z^{-1}$ 的零点分析见「Z 变换」一节（零点在 $z=1$，即单位圆上的直流点）。相关函数与功率谱的维纳-辛钦关系见「功率谱密度」一节——改善因子公式 (4) 正是它的直接应用。' }
        ]
      },
      {
        id: 'chain', num: '4', title: '完整处理链路：慢时间维插在哪里',
        blocks: [
          { t: 'flow', v: true, items: [
            { t: '① 天线 / 馈线 / 低噪声放大', d: '同案例一。关键：天线转动使杂波谱中心产生平台运动多普勒（机载/舰载必须补偿）' },
            { t: '② 混频 / 中频 / 模数转换', d: '关键：**系统稳定性**——本振相位噪声与定时抖动直接限制改善因子上限（杂波相关性被破坏，$\\rho$ 下降）' },
            { t: '③ 数字下变频（$I/Q$ 正交双路）', d: '关键：幅相不平衡校准到 −40 dBc 以下；双通道是避免盲相位的前提' },
            { t: '④ 脉冲压缩（快时间维）', d: '输入：单脉冲距离序列；输出：压缩后距离剖面。关键：脉压必须在 MTI 之前完成（MTI 对消会破坏长脉冲的相干性）' },
            { t: '⑤ 杂波图 / 杂波锁定（TACCAR）', d: '输入：历史杂波分布；输出：凹口中心频率与对消器系数。关键：**自适应地把凹口对准杂波谱中心**（地物随风向漂移、平台运动）' },
            { t: '⑥ MTI 对消（慢时间维 FIR）', d: '输入：$N$ 个脉冲的复距离序列；输出：对消后的 $N-M$ 个脉冲。关键：阶数选择（改善因子 vs 信噪比损失）、杂波内部运动的谱宽' },
            { t: '⑦ MTD 多普勒滤波器组（慢时间 FFT + 加窗）', d: '输入：对消后脉冲串；输出：距离-多普勒二维矩阵。关键：窗类型、补零、零频滤波器置零或窄凹口' },
            { t: '⑧ 恒虚警检测（距离-多普勒二维）', d: '输入：二维幅度矩阵；输出：检测点（距离、速度、幅度三坐标信息）。关键：二维参考窗、杂波边缘处理' },
            { t: '⑨ 点迹凝聚 / 测角 / 航迹起始', d: '输入：检测点；输出：目标报告。关键：多普勒模糊解算（中国余数定理）、航迹关联剔除一次虚警' }
          ] },
          { t: 'callout', kind: 'eng', title: '脉压为什么必须在 MTI 之前', md: 'MTI 对消是"脉冲减脉冲"，假设两个脉冲的回波除了多普勒相位外完全相同。长脉冲（未压缩）期间目标距离在变，回波包络错位，对消后残余很大。先脉压把回波压成窄脉冲，再对消，错位量只有"一个脉冲内目标移动的距离"（通常远小于一个距离单元）。反过来的顺序（先 MTI 后脉压）在长脉冲 + 高速目标下改善因子会掉 10 dB 以上——这是一个真实的工程事故模式，教科书很少强调。' }
        ]
      },
      {
        id: 'sim', num: '5', title: '交互仿真：距离-多普勒图上的目标与盲速',
        blocks: [
          { t: 'md', md: '下面这台仿真器生成一个 $96\\times N$ 的距离-慢时间数据立方：前 40 个距离单元是地物杂波（强度、谱宽可调，幅度纹理随机），第 48 单元有一个单脉冲信噪比 0 dB 的目标（S 波段、$\\lambda=0.1\\,\\text{m}$）。处理链：慢时间 MTI 对消 → 加窗 → FFT → 距离-多普勒图。请做四组实验：' },
          { t: 'md', md: '① **把目标速度拖到第一盲速 $\\lambda f_r/2$**（默认重频 2000 Hz 时为 100 m/s 的整数倍）：看热图上目标被零频杂波完全吞掉；\n② **把重频从 2000 Hz 拖到 500 Hz 再拖回来**：看不模糊速度 $\\pm\\lambda f_r/4$ 与盲速位置如何联动变化，速度超过 $v_u$ 时目标峰"折叠"到错误的位置；\n③ **把杂波谱宽从 0 拖到 40 Hz**：看对消器凹口不再能完全对消杂波，剩余杂波从零频"溢出"到邻近多普勒通道；\n④ **切换对消器阶数与多普勒窗**：看凹口宽度、剩余杂波水平与滤波器旁瓣的差别。' },
          { t: 'widget', render: function (el) { simMTD(el); } },
          { t: 'callout', kind: 'note', title: '为什么实测改善因子总比理论公式低几 dB', md: '式 (4) 假设杂波是理想的平稳高斯过程且系统完全稳定。仿真里还有三处"漏损"：有限脉冲数导致的统计起伏（$N=32$ 时改善因子估计本身有 ±1 dB 的随机性）、杂波幅度纹理的空间起伏（把空间起伏误当作时间相关）、以及 FFT 频谱泄漏（未加权时旁瓣把杂波能量搬进目标通道）。实机还要再加上系统稳定性限制（相位噪声、定时抖动）与天线扫描调制（波束扫过杂波使回波幅度起伏，等效于加了一个 1/(波束驻留时间) 的谱展宽），所以**实际改善因子比理论低 5～10 dB 是常态，链路预算必须留这个余量**。' }
        ]
      },
      {
        id: 'amb', num: '6', title: '距离模糊与速度模糊：多重频与中国余数定理',
        blocks: [
          { t: 'md', md: '式 (5) 里藏着这节真正的矛盾：重频 $f_r$ 同时决定最大不模糊距离 $R_u=c/2f_r$ 与最大不模糊速度 $v_u=\\lambda f_r/4$，两者乘积 $R_uv_u=c\\lambda/8$ 是常数。$\\lambda=0.1\\,\\text{m}$ 时这个常数只有 $3.75\\times10^{6}\\,\\text{m}\\cdot\\text{m/s}$ 的一半——要 150 km 不模糊距离，$f_r\\le1\\,\\text{kHz}$，$v_u$ 只有 $\\pm25\\,\\text{m/s}$，连民航客机都测不清速度；要 $\\pm150\\,\\text{m/s}$ 的不模糊速度，$f_r\\ge6\\,\\text{kHz}$，不模糊距离只剩 25 km。' },
          { t: 'md', md: '工程解法是**多重频（参差重频）体制**：一个驻留周期内交替使用几个不同的重频，每个重频下测得一个"视在距离"，用中国余数定理解出真实距离。以三重频 $f_{r1}=4\\,\\text{kHz}$、$f_{r2}=5\\,\\text{kHz}$、$f_{r3}=6.4\\,\\text{kHz}$ 为例（对应不模糊距离 37.5 / 30 / 23.4 km），某目标的视在距离分别为 25 / 10 / 6.25 km：' },
          { t: 'math', tex: 'R\\equiv25\\ (\\text{mod }37.5),\\qquad R\\equiv10\\ (\\text{mod }30),\\qquad R\\equiv6.25\\ (\\text{mod }23.4375)' },
          { t: 'md', md: '逐一验证 $R=n_1\\times37.5+25=n_2\\times30+10=n_3\\times23.4375+6.25$：取 $n_1=2,n_2=3,n_3=4$，三者都给出 $R=100\\,\\text{km}$。**解模糊的最大不模糊距离约为各重频最小公倍数对应的距离**（本例可达数百公里）。速度模糊同理：目标在多个重频下的视在多普勒也满足同余关系，用同样的方法解算。' },
          { t: 'fold', summary: '展开：中国余数定理解模糊的完整算法与工程细节', deriv: true, blocks: [
            { t: 'md', md: '设重频组 $f_{r1},\\dots,f_{rK}$ 对应的不模糊距离为 $R_{uk}=c/2f_{rk}$，测得视在距离 $r_k\\in[0,R_{uk})$，求真实距离 $R$：' },
            { t: 'math', tex: 'R = n_k R_{uk} + r_k,\\quad k=1,\\dots,K' },
            { t: 'md', md: '取两个重频联立：$n_1R_{u1}-n_2R_{u2}=r_2-r_1$，在 $0\\le n_1 < R_{u2}/\\gcd$ 范围内穷举或扩展欧几里得求解，得到候选解后再用第三个重频验证（**三取二表决**）。工程细节四条：' },
            { t: 'md', md: '① **重频间隔必须足够大**：若两重频太接近，视在距离的组合在一个航迹周期内不唯一，一般要求重频间隔大于 5%～10%；\n② **测量误差会放大**：距离测量误差 $\\delta r$ 在解算中被除以重频间隔对应的等效分辨率，重频间隔小时误差放大数十倍，故实际系统先做航迹粗关联再精解算；\n③ **盲区分配**：每个重频都有发射 blind zone（$cT/2$ 内收不到回波），多重频交替可以让不同重频的盲区互相错开，**近距盲区是选择重频组的第一约束**；\n④ **解速度模糊**：多普勒维同样用 CRT，但多普勒测量误差比距离大（多普勒分辨率 $1/NT_r$ 量级），常反过来"用解出的真实距离的多普勒变化率反推真实速度"（距离微分法），两种方法互相校验。' }
          ] },
          { t: 'callout', kind: 'eng', title: '重频选择的完整决策清单', md: '选重频时依次过六道关：① 近距盲区 $cT/2$ 不能盖住最小作用距离；② 解模糊范围（最小公倍数）要大于最大作用距离；③ 多普勒凹口（盲速）不能落在任务速度域的主要区间——或用参差重频把凹口错开；④ 杂波谱与重频的相对位置（凹口要对准杂波中心）；⑤ 驻留时间与数据率（重频低则一个波位要驻留更久才能积累同样脉冲数）；⑥ 电子对抗兼容性（重频参差还能抗重频同步干扰）。实际装备的"重频组"是这六条约束下的优化结果，通常由系统仿真在部署前定死，作战中只做微调。' }
        ]
      },
      {
        id: 'limit', num: '7', title: '工程局限与实际难题',
        blocks: [
          { t: 'md', md: '慢时间处理是雷达信号处理里"参数耦合最深"的一环，以下七个难题在每一型装备的研制中都会真实出现。' },
          { t: 'callout', kind: 'danger', title: '① 盲速与重频选择的互斥死结', md: '凹口必须对准零频（静止杂波），但目标速度扫过 $n\\lambda f_r/2$ 时也掉进凹口。低速小目标（无人机、悬停直升机、气球）速度恰在盲速附近的概率不低。对策：**参差重频**（组内凹口错位，任何速度至少在一个重频下可见）、**凹口展宽 + 慢速目标专用的"零频通道"**（零频滤波器单独输出，靠恒虚警检测从中找慢速目标，代价是虚警剧增）。没有免费的午餐：**不模糊速度、不模糊距离、盲区分布三者只能折中**。' },
          { t: 'callout', kind: 'danger', title: '② 平台运动把杂波谱中心推离零频', md: '机载/舰载平台上，主瓣杂波的多普勒中心为 $f_c=2v_p\\cos\\theta/\\lambda$（$v_p$ 为平台速度、$\\theta$ 为波束与航向夹角），可达数 kHz——固定凹口（零频）完全失效。对策是**杂波锁定/自适应 MTI（TACCAR/MATI）**：实时估计杂波谱中心并把凹口对准它；更进一步是**空时自适应处理（STAP）**，同时利用阵元维与脉冲维自适应形成二维凹口。STAP 需要估计杂波协方差矩阵，训练样本与运算量都是工程门槛，目前只在部分预警机与新型有源相控阵上装备。' },
          { t: 'callout', kind: 'warn', title: '③ 杂波内部运动限制改善因子上限', md: '式 (4) 的定量结论值得再强调一遍：$\\sigma_c=10\\,\\text{Hz}$、$f_r=1\\,\\text{kHz}$ 时，单对消器改善因子只有 27 dB。海面、降雨、被风吹动的林地都属于这一类"谱宽杂波"，**再高阶的对消器也压不掉谱内分量**。对策不是加阶数，而是：提高重频（$T_r$ 小则 $\\rho$ 远离 1）、用多普勒滤波器组代替宽带对消（把杂波限制在少数通道）、或在检测端用恒虚警处理吸收剩余杂波。' },
          { t: 'callout', kind: 'warn', title: '④ 非相参积累：便宜但差 5～10 dB', md: '对非相参（检波后）积累，$N$ 个脉冲的能量直接相加，理想增益接近 $10\\lg\\sqrt{N}$ 量级且与检测损耗耦合，典型比相参积累差 5～10 dB。它的价值在于**不要求系统相参性**：老式磁控管发射机（脉冲间初相随机）只能做非相参积累，配合"相位检波 + 帧间相关"仍能工作。现代全相参体制下非相参积累只剩一个用途：**对多普勒上散开的快起伏目标（Swerling II）做检波后二次积累**，此时它是相参积累的有益补充。' },
          { t: 'callout', kind: 'warn', title: '⑤ 相位噪声：改善因子的物理天花板', md: '对消之所以能压掉杂波，是因为相邻脉冲的杂波"长得一模一样"。本振相位噪声让每个脉冲的杂波相位多出一个随机项 $\\varphi_m$，等效于把相关系数从 $\\rho$ 降到 $\\rho\\cdot e^{-\\sigma_\\varphi^2}$，改善因子因此多出一个上限 $-20\\lg\\sigma_\\varphi$ 量级。要 50 dB 改善因子，脉冲间相位误差必须小于约 0.6°（0.01 rad）——**这直接约束了频率源、锁相环与定时电路的指标分配**，是系统工程师在方案阶段就要算清的账。' },
          { t: 'callout', kind: 'pit', title: '⑥ 常见误区：以为 MTI 之后不需要恒虚警', md: 'MTI 只处理"零频附近"的杂波，剩下的气象杂波、海杂波、谱外剩余在距离-多普勒图上依然是强度随距离/速度剧烈变化的非均匀背景。**恒虚警检测不是可选项，而是 MTI/MTD 的必备后续**——这正是下一节的主题。反过来也成立：CFAR 的参考窗设计必须知道"我的上游已经做过了什么"，否则保护单元与参考窗会取错位置。' },
          { t: 'md', md: '⑦ **距离徙动与多普勒徙动**：$N=64$、$T_r=1\\,\\text{ms}$ 时处理时长 64 ms，600 m/s 的目标期间移动 38 m（S 波段 250 m 距离单元内尚可，X 波段 3 m 单元就跨了 12 个门）；加速度与旋转部件（直升机旋翼、螺旋桨）还会造成多普勒谱展宽。不做徙动校正，积累增益会从 18 dB 掉到 10 dB 以下——这是高分辨雷达慢时间处理的第一难题。' },
          { t: 'md', md: '一笔总结账：**积累增益 $10\\lg N$**（32 脉冲 = 15 dB）；**改善因子按式 (4) 由 $\\rho$ 决定**（谱宽 10 Hz、重频 1 kHz 时单对消器 27 dB）；**多普勒分辨率 $1/(NT_r)$**（32 ms 积累 = 31 Hz ≈ 1.6 m/s）；**盲速在 $\\lambda f_r/2$ 的整数倍**（0.1 m、2 kHz → 100 m/s）；**不模糊速度 $\\pm\\lambda f_r/4$**（±50 m/s）。五笔账彼此牵制，重频一旦选定，其余四笔全部被锁定——这就是慢时间维设计的本质。' },
          { t: 'lab', item: { path: 'lab/dft', title: 'DFT/FFT：栅栏效应与频谱泄漏实验台', desc: '多普勒滤波器组的加窗、泄漏与分辨率，与慢时间维完全同构' } },
          { t: 'chips', list: ['动目标显示', '动目标检测', '多普勒滤波器组', '改善因子', '盲速', '重频参差', '中国余数定理', '杂波锁定', '相位噪声'], cls: 'teal' }
        ]
      }
    ],
    refs: REFS
  });

  /* ============================================================
     案例三：CFAR 恒虚警检测（CA / GO / SO / OS）
     ============================================================= */

  /** 阶乘表（参考窗长度 ≤ 64 足够） */
  const FACT = (function () {
    const f = [1];
    for (let i = 1; i <= 64; i++) f[i] = f[i - 1] * i;
    return f;
  })();

  /** 正则化下不完全伽马（整数形状 n）：P(n,x)=1-e^{-x}Σ_{m=0}^{n-1}x^m/m! */
  function gammaP(n, x) {
    if (x <= 0) return 0;
    let s = 1, term = 1;
    for (let m = 1; m < n; m++) { term *= x / m; s += term; }
    return 1 - Math.exp(-x) * s;
  }

  /** 各检测器的虚警概率闭式解（背景为均值 1 的指数功率分布） */
  const PFA_FN = {
    CA: function (T, N) { return Math.pow(1 + T / N, -N); },
    OS: function (T, N, k) {
      let p = 1;
      for (let j = N - k + 1; j <= N; j++) p *= j / (j + T);
      return p;
    },
    GO: function (T, N) { return pfaGOSO(T, N >> 1, true); },
    SO: function (T, N) { return pfaGOSO(T, N >> 1, false); }
  };

  /** GO/SO 的虚警概率：两侧各 n 个参考单元，取大 / 取小后乘门限 T */
  function pfaGOSO(T, n, isGO) {
    const K = 500, zmax = 15;
    const nn = Math.pow(n, n) / FACT[n - 1];
    let sum = 0;
    for (let i = 0; i < K; i++) {
      const z = (i + 0.5) / K * zmax;
      const pdf = nn * Math.pow(z, n - 1) * Math.exp(-n * z);
      const F = gammaP(n, n * z);
      sum += pdf * Math.exp(-T * z) * (isGO ? F : 1 - F);
    }
    return 2 * sum * (zmax / K);
  }

  /** 二分法求门限系数 T：给定目标虚警概率 */
  function solveAlpha(fn, pfa) {
    let lo = 1e-3, hi = 20000;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (fn(mid) > pfa) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /** 指数分布功率样本（均值 mu），可复现 */
  function expoSample(rng, mu) {
    return -Math.log(Math.max(rng(), 1e-12)) * mu;
  }

  /** Gamma(ν,1) 纹理样本（整数 ν，K 分布杂波用） */
  function gammaSample(rng, nu) {
    let s = 0;
    for (let i = 0; i < nu; i++) s -= Math.log(Math.max(rng(), 1e-12));
    return s / nu;
  }

  /** 单次 CFAR 扫描：pw 为功率序列，返回 {thr, det} */
  function cfarScan(pw, N, G, T, type) {
    const n = pw.length, half = N >> 1;
    const thr = new Float64Array(n).fill(NaN), det = [];
    for (let i = half + G; i < n - half - G; i++) {
      let sl = 0, sr = 0, nl = 0, nr = 0;
      const vals = [];
      for (let d = G + 1; d <= G + half; d++) {
        const li = i - d, ri = i + d;
        if (li >= 0) { sl += pw[li]; nl++; vals.push(pw[li]); }
        if (ri < n) { sr += pw[ri]; nr++; vals.push(pw[ri]); }
      }
      let Z;
      if (type === 'CA') Z = (sl + sr) / Math.max(nl + nr, 1);
      else if (type === 'GO') Z = Math.max(sl / Math.max(nl, 1), sr / Math.max(nr, 1));
      else if (type === 'SO') Z = Math.min(sl / Math.max(nl, 1), sr / Math.max(nr, 1));
      else {
        vals.sort((a, b) => a - b);
        const k = Math.max(1, Math.round(vals.length * 0.75));
        Z = vals[Math.min(vals.length - 1, k - 1)];
      }
      thr[i] = T * Z;
      if (pw[i] > thr[i]) det.push(i);
    }
    return { thr: thr, det: det };
  }

  /** 交互仿真：距离剖面 + 自适应门限 + 检测标记 + 蒙特卡洛统计 */
  function simCFAR(el) {
    const NC = 128;                    // 距离单元数
    const RMAIN = 40;                  // 主目标单元
    const RINT = [34, 46];             // 多目标干扰单元
    const EDGE = 64;                   // 杂波边缘位置（右半区杂波 +20 dB）
    const CLUT = 100;                  // 边缘杂波功率倍数（20 dB）
    const st = { N: 16, G: 2, pe: 4, type: 'CA', multi: false, edge: true, snr: 15, kd: false };
    const MTRIAL = 150;                // 蒙特卡洛次数

    const boxA = UI.plotBox({ title: '距离剖面、自适应门限与检测标记（第 1 次实现）' });
    const mA = P.new(boxA.canvas, { height: 260, xlabel: '距离单元', ylabel: '功率 / dB（相对噪声底）', legend: true, legendPos: 'tl' });
    const mBox = h('div.metrics');
    const note = h('div.prose');

    function genProfile(seed) {
      const rng = U.rng(seed);
      const pw = new Float64Array(NC);
      for (let i = 0; i < NC; i++) {
        let bg = 1;
        if (st.edge && i >= EDGE) bg = CLUT;
        pw[i] = bg * (st.kd ? gammaSample(rng, 2) * expoSample(rng, 1) : expoSample(rng, 1));
      }
      const s = Math.pow(10, st.snr / 10);
      pw[RMAIN] += expoSample(rng, s);
      if (st.multi) {
        pw[RINT[0]] += expoSample(rng, s * 4);
        pw[RINT[1]] += expoSample(rng, s * 4);
      }
      return pw;
    }

    const recalc = U.rafThrottle(function () {
      const N = Math.max(4, Math.round(st.N / 2) * 2);
      const pfa = Math.pow(10, -st.pe);
      const kOS = Math.max(1, Math.round(N * 0.75));
      const fn = PFA_FN[st.type];
      const T = solveAlpha(function (t) { return fn(t, N, kOS); }, pfa);
      const Tideal = -Math.log(pfa);
      const lossDb = 10 * Math.log10(T / Tideal);
      const half = N >> 1;

      /* ---------- 蒙特卡洛统计 ---------- */
      let nFa = 0, nFaCells = 0, nHit = 0;
      let pw0 = null, r0 = null;
      const excl = [];
      excl.push([RMAIN - half - st.G - 1, RMAIN + half + st.G + 1]);
      if (st.multi) RINT.forEach(t => excl.push([t - 2, t + 2]));
      for (let m = 0; m < MTRIAL; m++) {
        const pw = genProfile(9100 + m * 17);
        const r = cfarScan(pw, N, st.G, T, st.type);
        if (m === 0) { pw0 = pw; r0 = r; }
        for (let d = 0; d < r.det.length; d++) {
          const i = r.det[d];
          let isT = false;
          for (let e = 0; e < excl.length; e++) if (i >= excl[e][0] && i <= excl[e][1]) isT = true;
          if (isT && Math.abs(i - RMAIN) <= 1) nHit++;
          else if (!isT) nFa++;
        }
      }
      // 重新精确统计虚警单元数（每帧相同）
      let faCells = NC;
      excl.forEach(e => { faCells -= (e[1] - e[0] + 1); });
      const pfaMeas = nFa / (MTRIAL * faCells);
      const faText = nFa === 0
        ? '0 个（< ' + (1 / (MTRIAL * faCells)).toExponential(1) + '）'
        : pfaMeas.toExponential(1) + '（' + nFa + ' 个）';
      const pdMeas = nHit / MTRIAL;
      const pdTheory = Math.pow(pfa, 1 / (1 + Math.pow(10, st.snr / 10)));

      /* ---------- 绘图（第 1 次实现） ---------- */
      const dbPw = dbP(pw0), dbThr = dbP(r0.thr);
      const xAx = [];
      for (let i = 0; i < NC; i++) xAx.push(i);
      mA.clear()
        .add({ x: xAx, y: arr(dbPw), type: 'line', color: 0, width: 1.3, label: '距离剖面（功率 dB）' })
        .add({ x: xAx, y: arr(dbThr), type: 'line', color: 1, width: 1.6, label: st.type + '-CFAR 门限（×' + T.toFixed(1) + '）' })
        .hline(Tideal, { label: '理想固定门限 −ln Pfa', color: '#7c3aed', dash: [2, 3] });
      const dx = [], dy = [];
      r0.det.forEach(i => { dx.push(i); dy.push(dbPw[i] + 2); });
      mA.add({ x: dx, y: dy, type: 'scatter', color: 3, size: 4, label: '检测标记（' + r0.det.length + ' 个）' });
      mA.vline(RMAIN, { label: '主目标', color: '#0f766e' });
      if (st.multi) RINT.forEach(t => mA.vline(t, { label: '干扰目标', color: '#b91c1c' }));
      if (st.edge) mA.vline(EDGE, { label: '杂波边缘 +20 dB', color: '#b45309' });
      mA.draw();

      fillMetrics(mBox, [
        ['检测器 / 参考窗', st.type + ' / ' + N + ' 单元（保护 ' + st.G + '×2）', ''],
        ['门限系数 α（' + st.type + '）', T.toFixed(2), ''],
        ['理想固定门限 −ln Pfa', Tideal.toFixed(2), ''],
        ['CFAR 损失', lossDb.toFixed(2), 'dB'],
        ['设定虚警概率', '1×10⁻' + st.pe, ''],
        ['实测虚警（' + MTRIAL + ' 次 × ' + faCells + ' 单元）', faText, ''],
        ['主目标检测概率（实测 / 理论）', (pdMeas * 100).toFixed(0) + '% / ' + (pdTheory * 100).toFixed(0) + '%', ''],
        ['第 1 次实现检出 / 虚警', r0.det.length + ' 个检测', '']
      ]);

      /* ---------- 动态解读 ---------- */
      const faRatio = pfaMeas / pfa;
      const masked = pdMeas < 0.5;
      note.innerHTML = U.md(
        '**当前状态解读：** 检测器 ' + st.type + '-CFAR、参考窗 ' + N + ' 单元、保护单元 ±' + st.G + '、设定虚警概率 $10^{-' + st.pe +
        '}$。门限系数由虚警概率闭式解反解：' +
        (st.type === 'CA' ? '$\\alpha=N(P_{fa}^{-1/N}-1)=' + T.toFixed(2) + '$' : '$\\alpha=' + T.toFixed(2) + '$（由 ' +
          (st.type === 'OS' ? '有序统计的乘积公式' : '两侧选' + (st.type === 'GO' ? '大' : '小') + '的积分公式') + '数值反解）') +
        '，理想固定门限只需 $-\\ln P_{fa}=' + Tideal.toFixed(2) + '$，**恒虚警的代价是 ' + lossDb.toFixed(2) + ' dB 的检测损失**（参考窗越长损失越小）。' +
        '蒙特卡洛 ' + MTRIAL + ' 次：实测虚警概率为设定值的 ' + (faRatio < 0.1 ? '0.1 倍以下' : faRatio.toFixed(1) + ' 倍') +
        (faRatio > 3 ? ' —— **虚警失控**' : (faRatio < 0.1 ? '（偏保守）' : '（符合设计）')) + '；主目标检测概率实测 ' + (pdMeas * 100).toFixed(0) + '%' +
        (masked ? '，**主目标被遮蔽或检测不到**：' + (st.multi ? '两侧干扰目标抬高了参考窗均值，门限跟着抬高（多目标遮蔽），换有序统计检测器可以救回来。' : '检查信噪比是否过低。') : '，与 Swerling I 理论值 ' + (pdTheory * 100).toFixed(0) + '% 相符。') +
        (st.edge ? ' 已叠加**杂波边缘**（64 号单元右侧杂波高 20 dB）：' +
          (st.type === 'CA' ? '单元平均检测器把高杂波"平均"进两侧门限，边缘处门限偏低 → **边缘内侧一片虚警**；外侧门限偏高 → **弱目标漏检**。这是 CA 的经典失效模式。'
            : (st.type === 'GO' ? '取大检测器在边缘处选了高杂波一侧做参考，门限抬高，**边缘虚警被压住**（代价是均匀区内损失略大）。'
              : (st.type === 'SO' ? '取小检测器在边缘处仍选低杂波一侧，**边缘虚警依旧失控**——它天生不是对付杂波边缘的。'
                : '有序统计检测器剔除掉参考窗中最大的几个杂波样本，**对边缘有一定的鲁棒性但并非专门设计**。'))) : '') +
        (st.multi ? ' 已叠加**两个比主目标强 6 dB 的干扰目标**（第 ' + RINT[0] + '、' + RINT[1] + ' 单元）：' +
          (st.type === 'CA' || st.type === 'GO' ? '它们落入主目标的参考窗，把均值抬高，**主目标被遮蔽**。'
            : (st.type === 'SO' ? '取小检测器自动避开含干扰目标的那一侧参考窗，**抗多目标遮蔽正是它的设计目标**。'
              : '有序统计把干扰目标当作"离群样本"剔除，第 k 个样本仍是真实杂波水平，**遮蔽被解除**。')) : '') +
        (st.kd ? ' 已切换为**海杂波（K 分布，形状参数 ν=2）**：复合散射使功率分布呈重尾，远重于单元平均假设的指数分布，**实测虚警率远超设定值**——高斯/瑞利假设在真实海杂波面前失效，需要形状参数自适应或对数恒虚警等非线性处理。' : ' 当前背景为瑞利（指数功率）杂波，各检测器的闭式门限公式成立。')
      );
      UI.renderMathIn(note);
    });

    const sN = UI.slider({ label: '参考窗长度 N（检测单元两侧各 N/2）', min: 8, max: 48, step: 2, value: st.N, unit: '单元', hint: '越长虚警越稳、CFAR 损失越小，但对杂波边缘的响应越迟钝', onInput: v => { st.N = v; recalc(); } });
    const sG = UI.slider({ label: '保护单元（每侧）', min: 0, max: 8, step: 1, value: st.G, unit: '单元', hint: '防止目标能量泄漏进参考窗造成自遮蔽', onInput: v => { st.G = v; recalc(); } });
    const selP = UI.select({
      label: '设定虚警概率 Pfa', value: String(st.pe), hint: '每 10⁻⁶ 量级对应约 1 dB 门限抬升',
      options: [
        { value: '3', label: '10⁻³（搜索告警）' },
        { value: '4', label: '10⁻⁴（常规）' },
        { value: '5', label: '10⁻⁵（较严）' },
        { value: '6', label: '10⁻⁶（航迹处理安全）' }
      ],
      onChange: v => { st.pe = parseInt(v, 10); recalc(); }
    });
    const selT = UI.select({
      label: '检测器类型', value: st.type, hint: 'CA 均匀最优 / GO 抗边缘 / SO 抗多目标 / OS 最均衡',
      options: [
        { value: 'CA', label: 'CA 单元平均' },
        { value: 'GO', label: 'GO 两侧选大' },
        { value: 'SO', label: 'SO 两侧选小' },
        { value: 'OS', label: 'OS 有序统计（k=3N/4）' }
      ],
      onChange: v => { st.type = v; recalc(); }
    });
    const sSnr = UI.slider({ label: '主目标信噪比', min: 5, max: 30, step: 1, value: st.snr, unit: 'dB', hint: 'Swerling I 慢起伏目标的平均信噪比', onInput: v => { st.snr = v; recalc(); } });
    const tgMulti = UI.toggle({ label: '叠加两个强 6 dB 的干扰目标（多目标场景）', value: st.multi, onChange: v => { st.multi = v; recalc(); } });
    const tgEdge = UI.toggle({ label: '叠加杂波边缘（64 号单元右侧 +20 dB）', value: st.edge, onChange: v => { st.edge = v; recalc(); } });
    const tgKd = UI.toggle({ label: '海杂波 K 分布（重尾，ν=2）', value: st.kd, onChange: v => { st.kd = v; recalc(); } });

    el.appendChild(UI.ctrlPanel('仿真参数（128 个距离单元，蒙特卡洛 ' + MTRIAL + ' 次统计虚警与检测）',
      [sN, sG, selP, selT, sSnr, tgMulti, tgEdge, tgKd]));
    el.appendChild(boxA.el);
    el.appendChild(mBox);
    el.appendChild(h('div.plot-cap', { html: U.md('蓝线：距离剖面功率（相对噪声底 0 dB）；橙线：自适应门限 = 门限系数 × 背景估计；紫色虚线：已知背景时的理想固定门限；粉点：过门限的检测标记。统计量来自 ' + MTRIAL + ' 次独立蒙特卡洛实现。') }));
    el.appendChild(note);
    recalc();
  }

  doc.register('cases/radar/cfar', {
    title: '案例三：CFAR 恒虚警检测（CA/GO/SO/OS）',
    lede: '噪声和杂波的功率随距离、方位、时间剧烈变化，固定门限要么虚警成灾、要么漏掉目标。CFAR 用参考窗实时估计背景、按设定虚警概率反解门限系数——本节把 CA/GO/SO/OS 四种检测器的门限公式、失效模式与 2 dB 检测损失一次算清，并用蒙特卡洛亲眼看到虚警率失控与多目标遮蔽。',
    tags: ['雷达', 'CFAR', '恒虚警检测', '检测理论'],
    labs: [{ path: 'lab/window', title: '窗函数横向对比实验台', desc: '理解参考窗加权的思想源头' }],
    toc: true,
    sections: [
      {
        id: 'bg', num: '1', title: '工程背景：固定门限为什么必败',
        blocks: [
          { t: 'md', md: '检测问题的标准提法（奈曼-皮尔逊准则）：在约束虚警概率 $P_{fa}$ 的前提下最大化检测概率 $P_d$，最优解是似然比检验，对高斯白噪声中的已知信号退化为一个**固定门限**。但固定门限的前提是"背景功率已知且恒定"——真实雷达从不满足：' },
          { t: 'table', cols: ['背景变化源', '变化的量级', '时间尺度', '对门限的要求'], rows: [
            ['接收机噪声系数随温度漂移', '1～3 dB', '小时～天', '慢速校准即可'],
            ['降雨 / 气象杂波', '0～40 dB（随雨强）', '分钟', '必须实时估计'],
            ['地物杂波（距离/方位）', '单元间起伏 10～30 dB', '场景固定但逐单元不同', '逐距离单元自适应'],
            ['海杂波（随风浪/掠射角）', '0～50 dB，且重尾分布', '秒级起伏', '自适应 + 非线性处理'],
            ['天线扫过强点杂波', '瞬时 +60 dB', '毫秒', '邻近单元快速自适应'],
            ['人为干扰 / 电子对抗', '任意', '有意突变', '恒虚警是抗干扰底线']
          ] },
          { t: 'md', md: '固定门限的两难非常具体：设背景功率在 0～30 dB 之间波动。门限按最低背景设定 → 高背景区**虚警率爆炸**（每多 10 dB 背景，虚警概率乘 10）；门限按最高背景设定 → 低背景区**检测损失 30 dB**，作用距离缩水到原来的 $10^{-30/40}=0.18$ 倍。**唯一出路是让门限跟着背景走：用检测单元附近的参考窗实时估计背景功率，再按设定虚警概率反解出门限**——这就是恒虚警处理（CFAR）。' },
          { t: 'metrics', list: [
            { label: '典型设计虚警概率', value: '10⁻⁶', unit: '（每帧虚警可数）' },
            { label: 'CFAR 检测损失（N=16）', value: '≈2.0', unit: 'dB' },
            { label: 'CA 门限系数（Pfa=10⁻⁶）', value: '21.9', unit: '（N=16）' },
            { label: '参考窗典型长度', value: '16～64', unit: '距离单元' }
          ] },
          { t: 'callout', kind: 'eng', title: '工程师视角：虚警率的真实代价', md: '为什么把 $P_{fa}$ 定在 $10^{-6}$ 这么苛刻？算一笔航迹账：设距离门 1000 个、方位波束 360 个、多普勒通道 32 个，一次扫描共有 $10^7$ 个检测单元。$P_{fa}=10^{-4}$ 时每次扫描虚警 1000 个——**航迹处理器被假点迹淹没，计算机负荷与显示混乱同时到来**；$P_{fa}=10^{-6}$ 时每次扫描 10 个虚警，配合航迹起始逻辑（连续 3 帧中 2 帧相关才起始航迹）可压到每分钟个位数。反过来，$P_{fa}$ 每压低 10 倍需要约 1 dB 额外信噪比，$10^{-6}$ 与 $10^{-4}$ 之间差 2 dB——**这 2 dB 就是为航迹处理器省下的算力**。工程上搜索雷达常用 $10^{-3}\\sim10^{-4}$（靠航迹逻辑兜底），跟踪/火控雷达用 $10^{-6}$。' }
        ]
      },
      {
        id: 'model', num: '2', title: '信号与统计模型：从复高斯到指数功率',
        blocks: [
          { t: 'md', md: 'CFAR 的全部数学建立在**背景概率模型**上。标准假设：经过脉压与多普勒处理后，检测单元的复数据是零均值复高斯（杂波 + 噪声均为高斯过程之和），其模的平方（功率）服从**指数分布**：' },
          { t: 'math', tex: 'p(x)=\\frac{1}{\\mu}e^{-x/\\mu},\\quad x\\ge0;\\qquad \\text{其中 } \\mu \\text{ 为该单元的平均功率（待估计）}', tag: '(1)' },
          { t: 'md', md: '幅度服从瑞利分布——这就是"瑞利杂波"的来历。CFAR 的核心思想：**$\\mu$ 未知且时变，用参考窗样本估计它；门限设为 $\\alpha\\hat\\mu$，选择 $\\alpha$ 使 $P(X>\\alpha\\hat\\mu)=P_{fa}$ 与 $\\mu$ 无关**——这就是"恒虚警"三个字的含义。' },
          { t: 'md', md: '**虚警概率与检测概率的基本关系**（单脉冲、平方律检波、指数模型）：' },
          { t: 'math', tex: 'P_{fa}=e^{-T},\\qquad P_{d}=P_{fa}^{\\frac{1}{1+\\bar S}}\\ \\text{（Swerling I，平均信噪比 } \\bar S\\text{）}', tag: '(2)' },
          { t: 'md', md: '第一个式子：门限为 $T\\mu$ 时 $P(X>T\\mu)=e^{-T}$，与 $\\mu$ 无关——**理想已知背景下的"恒虚警"天生成立**，CFAR 要做的只是在 $\\mu$ 未知时逼近这个性能。第二个式子是 Swerling I 目标单脉冲检测的经典结果：信噪比 13.2 dB、$P_{fa}=10^{-6}$ 时 $P_d\\approx50\\%$；要 $P_d=90\\%$ 需要 21.1 dB——**起伏目标对信噪比极其敏感，这是后面所有"检测损失"讨论的基准**。' },
          { t: 'fold', summary: '展开：式 (2) 的推导（复高斯模型 + Swerling I）', deriv: true, blocks: [
            { t: 'md', md: '背景功率 $X\\sim\\mathrm{Exp}(\\mu)$：$P(X>T\\mu)=\\int_{T\\mu}^{\\infty}\\frac{1}{\\mu}e^{-x/\\mu}dx=e^{-T}$，与 $\\mu$ 无关 ✓。这就是"理想已知背景下虚警恒定"的来源。' },
            { t: 'md', md: '关键一步是认清**信号本身的统计结构**：Swerling I 目标由大量独立散射体组成，其复散射系数是零均值复高斯量——也就是说，**目标回波相量本身就是复高斯的**（幅度瑞利起伏、功率指数分布、平均信噪比 $\\bar S$）。而接收机噪声相量也是零均值复高斯（方差对应 $\\mu$）。两个独立复高斯之和仍是复高斯：' },
            { t: 'math', tex: 'H_1:\\; z = z_s + z_n \\sim \\mathcal{CN}(0,\\ (1+\\bar S)\\mu)\\quad\\Rightarrow\\quad |z|^{2}\\sim\\mathrm{Exp}\\big((1+\\bar S)\\mu\\big)' },
            { t: 'md', md: '于是检测概率一步得到：' },
            { t: 'math', tex: 'P_d=P\\!\\left(|z|^{2}>T\\mu\\right)=\\exp\\!\\left[-\\frac{T\\mu}{(1+\\bar S)\\mu}\\right]=\\exp\\!\\left[-\\frac{T}{1+\\bar S}\\right]=P_{fa}^{\\frac{1}{1+\\bar S}}' },
            { t: 'md', md: '最后一个等号用了 $P_{fa}=e^{-T}$。**常见错误**是把"信号功率 + 噪声功率"当成两个独立指数变量的卷积（得到 $P_d=\\frac{\\bar Se^{-T/\\bar S}-e^{-T}}{\\bar S-1}$），那对应的是"确定性功率偏移 + 指数起伏"的另一种模型；正确的模型是相量域相加，因为检测统计量是 $|\\text{信号相量}+\\text{噪声相量}|^{2}$，不是两者功率之和。' },
            { t: 'md', md: '**记住两个数**（$P_{fa}=10^{-6}$，单脉冲 Swerling I）：$P_d=0.5$ 需 $\\bar S=13.1\\,\\text{dB}$；$P_d=0.9$ 需 $\\bar S=21.1\\,\\text{dB}$。非起伏（Swerling 0）目标只需约 11.8 / 13.1 dB——**起伏惩罚在 $P_d=0.9$ 处高达 8 dB**，这就是积累与频率分集如此重要的原因。' }
          ] },
          { t: 'callout', kind: 'pit', title: '坑：把"功率"和"幅度"的门限混着算', md: '指数分布是**功率**（模平方）的分布；若对幅度（模）设门限，分布是瑞利，门限公式变成平方根关系 $P_{fa}=e^{-T_a^{2}}$（$T_a$ 为幅度门限按 $\\mu$ 归一化）。工程实现里检测统计量几乎都是功率域（脉压输出模平方），门限系数 $\\alpha$ 也是功率域的；**混用会把虚警概率差出几个数量级**（功率门限 21.9 对应幅度门限 4.68，不是一回事）。' }
        ]
      },
      {
        id: 'algo', num: '3', title: '算法原理：CA / GO / SO / OS 四兄弟',
        blocks: [
          { t: 'md', md: '单元平均 CA-CFAR 的结构是一条滑动的窗：**检测单元两侧各留 $G$ 个保护单元（防止目标能量泄漏进参考窗造成自遮蔽），再各取 $N/2$ 个参考单元**，用它们的均值估计背景功率，门限为 $T=\\alpha\\hat\\mu$：' },
          { t: 'math', tex: '\\hat\\mu=\\frac{1}{N}\\sum_{i=1}^{N}x_i,\\qquad T=\\alpha\\,\\hat\\mu,\\qquad \\alpha=N\\left(P_{fa}^{-1/N}-1\\right)', tag: '(3)' },
          { t: 'md', md: '推导只需一步：$N$ 个独立指数样本的均值 $\\hat\\mu$ 服从伽马分布，$P(X>\\alpha\\hat\\mu)=(1+\\alpha/N)^{-N}$，令其等于 $P_{fa}$ 即得 $\\alpha$（完整推导在下方折叠）。**代几个数**：$P_{fa}=10^{-6}$ 时 $N=16$ → $\\alpha=21.9$（CFAR 损失 2.0 dB）；$N=32$ → $\\alpha=18.2$（损失 1.2 dB）；$N=64$ → $\\alpha=16.1$（损失 0.7 dB）。**参考窗越长，恒虚警的代价越小**，但对快变背景的响应也越迟钝——这是 CFAR 设计的第一矛盾。' },
          { t: 'fold', summary: '展开：门限系数 $\\alpha=N(P_{fa}^{-1/N}-1)$ 的推导', deriv: true, blocks: [
            { t: 'md', md: '设参考单元 $x_i$ 独立同分布于指数分布 $\\mathrm{Exp}(\\mu)$，其均值估计 $\\hat\\mu=\\frac{1}{N}\\sum x_i$。令 $Y=N\\hat\\mu/\\mu=\\sum x_i/\\mu$，则 $Y\\sim\\mathrm{Gamma}(N,1)$（$N$ 个单位均值指数变量之和），其矩生成函数为 $M_Y(s)=(1-s)^{-N}$。' },
            { t: 'md', md: '虚警事件为 $X_0>\\alpha\\hat\\mu$（$X_0$ 为检测单元，与参考窗独立、同为 $\\mathrm{Exp}(\\mu)$）。条件于 $\\hat\\mu$：' },
            { t: 'math', tex: 'P_{fa}=E\\!\\left[e^{-\\alpha\\hat\\mu/\\mu}\\right]=E\\!\\left[e^{-(\\alpha/N)Y}\\right]=\\left(1+\\frac{\\alpha}{N}\\right)^{-N}' },
            { t: 'md', md: '令 $P_{fa}$ 为设定值解出 $\\alpha=N(P_{fa}^{-1/N}-1)$。**要点：结果与 $\\mu$ 无关**——这正是"恒虚警"；且 $N\\to\\infty$ 时 $\\alpha\\to-\\ln P_{fa}$（理想固定门限），有限 $N$ 的超出部分就是 CFAR 损失。' },
            { t: 'md', md: '顺带得到 OS-CFAR 的虚警公式：第 $k$ 个有序统计量 $X_{(k)}$ 的矩生成函数为 $\\prod_{j=N-k+1}^{N}\\frac{j}{j+s}$（指数样本顺序统计量的标准结果），于是 $P_{fa}=\\prod_{j=N-k+1}^{N}\\frac{j}{j+\\alpha}$，给定 $P_{fa}$ 数值反解 $\\alpha$ 即可。GO/SO 的公式则需对两侧均值（伽马分布）做一次积分，同样可数值反解——本节仿真用的正是这些闭式/半闭式公式。' }
          ] },
          { t: 'md', md: '**CA 的失效模式**决定了其余三种检测器的存在：' },
          { t: 'md', md: '① **杂波边缘**：参考窗跨过高杂波边界时，估计值介于两侧之间——边缘内侧（高杂波一侧刚进入参考窗）门限偏低 → **成片虚警**；刚离开的单元门限偏高 → **漏检**；\n② **多目标遮蔽**：邻近强目标落入参考窗，把均值抬高 → 主目标门限被抬 → **遮蔽**（表现为"两个近距离目标只能检出一个"）。' },
          { t: 'table', cols: ['检测器', '背景估计方法', '抗杂波边缘', '抗多目标', '额外损失', '计算量', '典型用途'], rows: [
            ['CA 单元平均', '两侧全部参考单元均值', '差（边缘虚警）', '差（遮蔽）', '基准', '最低', '均匀背景、搜索雷达'],
            ['GO 两侧选大', '取两侧均值较大者', '好（门限抬高）', '差', '≈0.3～0.5 dB', '低', '地杂波边缘显著的陆基雷达'],
            ['SO 两侧选小', '取两侧均值较小者', '差', '好（避开干扰侧）', '≈0.3～0.5 dB', '低', '近距多目标（编队/群目标）'],
            ['OS 有序统计', '参考窗排序取第 $k$（常 $k=3N/4$）', '中等', '好（剔除离群样本）', '≈0.2 dB 起步，随 $k$ 增', '高（需排序）', '多目标 + 复杂杂波，现代通用'],
            ['杂波图 CFAR', '按单元存历史平均功率（时间平均）', '好（逐单元独立）', '好', '取决于图更新率', '中（存储）', '固定平台、场景变化慢'],
            ['二维 CFAR', '距离×多普勒二维参考窗', '按维配置', '按维配置', '同维内 CA/OS', '高', 'MTD 后的二维检测（标配）']
          ] },
          { t: 'callout', kind: 'eng', title: '工程上的真实做法：级联与分片', md: '没有一种检测器包打天下，实际装备几乎都是**组合拳**：① MTD 输出的距离-多普勒矩阵先做**二维 CA-CFAR**（参考窗 8～16×4～8，多普勒维通常不加保护单元因为目标只占 1～2 个通道）；② 对**杂波边缘方位区**切换为 GO 或加长参考窗；③ 对**近距强杂波区**用杂波图（时间平均）提供第二重门限；④ OS-CFAR 用于**重点扇区**（编队目标、海面小目标）。检测器系数 $\\alpha$ 也不是常数：按实测背景分布类型（瑞利 / 韦布尔 / K 分布）查表选择。这一整套通常写进雷达的"工作模式控制"软件里，由操作员按海情/地情选择。' },
          { t: 'callout', kind: 'tip', title: '与知识库的对应关系', md: '虚警与检测概率的统计基础见「白噪声与色噪声」与「匹配滤波」两节；参考窗均值估计的统计性质（伽马分布、矩生成函数）见「随机信号与统计处理」模块；杂波图本质上是时间维的递推平均滤波，与「功率谱密度」中平滑周期图的思路同源。' }
        ]
      },
      {
        id: 'chain', num: '4', title: '完整处理链路：CFAR 在哪里、保护谁',
        blocks: [
          { t: 'flow', v: true, items: [
            { t: '① 脉压 + MTI/MTD 输出（距离-多普勒二维矩阵）', d: '输入：复基带数据立方；输出：二维幅度/功率矩阵。关键：**检测统计量应取非相参积累后的功率（模平方）**，分布越接近指数，门限公式越准' },
            { t: '② 杂波图建立与更新（时间维背景估计）', d: '输入：历史检测结果与背景估计；输出：逐距离-方位单元的长期背景图。关键：递推平均 $\\hat\\mu_{new}=\\beta\\hat\\mu_{old}+(1-\\beta)x$，$\\beta$ 取 0.9 以上；**检测到目标时要剔除，防止目标把自己写进杂波图**' },
            { t: '③ 一维距离 CFAR（或直接二维 CFAR）', d: '输入：功率矩阵；输出：过门限单元 + 门限值。关键：参考窗长度、保护单元、检测器类型按扇区配置；**检测单元必须排除在参考窗外**' },
            { t: '④ 二维 CFAR / 多普勒维确认', d: '输入：距离维检测点；输出：二维确认的点迹。关键：多普勒维参考窗要跨过杂波谱展宽区；对模糊速度（折叠）通道单独设窗' },
            { t: '⑤ 点迹凝聚', d: '输入：过门限单元群；输出：每群一个点迹（距离、速度、幅度、方位）。关键：3×3 或 5×5 邻域取局部最大；**不凝聚会让一个目标报出十几个点迹**，虚警率名义上达标、实际爆炸' },
            { t: '⑥ 虚警监视与自适应反馈', d: '输入：长期虚警统计；输出：门限系数修正量、检测器切换指令。关键：实测虚警率与设定值偏差超过 2 倍时告警——**CFAR 的"恒虚警"靠闭环维持，不是靠公式一次算死**' }
          ] },
          { t: 'callout', kind: 'warn', title: '自遮蔽：最常见也最低级的 CFAR 事故', md: '若保护单元数量不足，目标自己的能量（脉压主瓣 + 旁瓣、多普勒展宽）会泄漏进参考窗，把背景估计抬高，**目标把自己检不出来**——表现为"强目标两侧出现门限鼓包、目标顶部反而低于门限"。大尺寸目标（运输机机身跨多个距离单元）、高速目标（多普勒展宽跨多个通道）最容易触发。对策：保护单元按"目标最大尺寸 + 脉压展宽"配置（典型 2～4 个距离单元 × 2 个多普勒通道），或改用 OS 检测器（离群样本被剔除，自遮蔽天然减轻）。' }
        ]
      },
      {
        id: 'sim', num: '5', title: '交互仿真：亲眼看到虚警失控与目标遮蔽',
        blocks: [
          { t: 'md', md: '下面这台仿真器生成 128 个距离单元的功率剖面：瑞利（指数功率）背景，可叠加**杂波边缘**（64 号单元右侧高 20 dB）、**两个强 6 dB 的干扰目标**（第 34、46 单元）、**K 分布海杂波**（重尾）；主目标在第 40 单元（Swerling I，信噪比可调）。门限系数由各检测器的虚警闭式解数值反解（不是拍脑袋给的常数），并用 150 次蒙特卡洛统计实测虚警概率与检测概率。请做四组实验：' },
          { t: 'md', md: '① **打开杂波边缘，检测器取 CA**：看 64 号单元附近门限"塌陷"、虚警成片；再切到 GO 看虚警被压住；\n② **打开多目标，检测器取 CA**：看主目标被两侧干扰目标遮蔽；切到 SO 或 OS 看遮蔽解除；\n③ **打开 K 分布海杂波**：看实测虚警概率远超设定值——重尾分布下高斯假设全面失效；\n④ **把参考窗从 8 拉到 48**：看 CFAR 损失从 3 dB 以上降到 1 dB 以下，同时对杂波边缘的响应变迟钝（边缘过渡带变宽）。' },
          { t: 'widget', render: function (el) { simCFAR(el); } },
          { t: 'callout', kind: 'note', title: '为什么实测虚警概率与设定值对不上也算正常', md: '蒙特卡洛 150 次统计的虚警概率本身有统计起伏：设真实虚警概率为 $p$、独立试验数为 $M$，测量的相对标准差约 $1/\\sqrt{Mp}$。$p=10^{-4}$、$M=150$ 时相对起伏约 80%——**单次统计差 2 倍完全在随机范围内**。判断"虚警失控"要看量级（差 10 倍以上才是系统性失效，如 K 分布或杂波边缘场景）。要做精确的虚警验证，工业界的做法是数百万次蒙特卡洛或重要性抽样，这在设计定型阶段是标准流程。' }
        ]
      },
      {
        id: 'limit', num: '6', title: '工程局限与实际难题',
        blocks: [
          { t: 'callout', kind: 'danger', title: '① 杂波边缘：CA 的经典滑铁卢', md: '门限跟随参考窗均值，而均值在边缘处"半对半错"——高杂波刚进入参考窗时门限最低（虚警最多），刚离开时门限最高（漏检最多）。量化：20 dB 的杂波阶跃、$N=32$ 时 CA 在边缘处的虚警概率可比设定值高 3～4 个数量级。GO 检测器专治此症（选大侧做参考，门限跟着高杂波走），代价是均匀区损失增加约 0.3～0.5 dB。**陆基雷达地杂波边缘 + 海岸线场景，GO 是默认选择**。' },
          { t: 'callout', kind: 'danger', title: '② 多目标遮蔽：SO 与 OS 的分工', md: '编队目标、群目标、干扰机伴随目标是典型场景。CA 把邻近强目标"平均"进背景，门限抬高，主目标消失；SO 取两侧较小均值，只要干扰目标不同时占据两侧，遮蔽即解除；OS 更彻底——把参考窗排序，取第 $k$（约 3N/4）个值，**只要干扰目标数少于 $N-k$，它们就被当作离群样本剔除**。OS 的代价：约 0.2 dB 起步的额外检测损失、每单元一次排序的计算量（$N=32$ 时每单元约 100 次比较，全距离段实时实现需要专用硬件或降采样处理）。' },
          { t: 'callout', kind: 'warn', title: '③ Swerling 起伏下的检测损失', md: '式 (2) 告诉我们慢起伏目标在 $P_d=0.9$ 时比非起伏目标多要 8 dB 信噪比。CFAR 不能消除这笔损失，但它的参考窗会雪上加霜：目标起伏的"好帧"与"坏帧"会让背景估计波动，等效再损失 0.5～1 dB。对策不在检测器而在上游：**频率分集 / 脉间捷变频把慢起伏打散成快起伏**（Swerling I → II），配合多脉冲积累把起伏损失从 8 dB 压到 2～3 dB——这是雷达总体的经典设计套路。' },
          { t: 'callout', kind: 'warn', title: '④ 非高斯海杂波：高斯假设的边界', md: '低掠射角、高分辨率（距离单元小于海浪波长）时，海杂波功率服从 **K 分布**（复合高斯：伽马纹理 × 指数散斑），尾部远重于指数分布。此时所有基于指数假设的门限公式系统性低估虚警——仿真里打开 K 分布开关就能看到虚警率失控。对策：**形状参数自适应的 CFAR**（在线估计 K 分布形状参数 ν，按 ν 修正门限）、对数域处理（把乘性杂波变成加性）、或直接用**分位数检测器**（用参考窗的经验分位数做门限，不依赖分布假设，鲁棒但损失 1～2 dB）。' },
          { t: 'callout', kind: 'warn', title: '⑤ CFAR 损失与信噪比的耦合账', md: 'CFAR 损失的定义：相对已知背景的固定门限，达到同样 $P_d$–$P_{fa}$ 所需的额外信噪比。三个规律：**参考窗越长损失越小**（$N=16$ → 2.0 dB，$N=64$ → 0.7 dB）；**虚警概率越苛刻损失越大**（$10^{-6}$ 比 $10^{-3}$ 多约 1 dB）；**多目标/边缘场景里"有效损失"远大于标称损失**（遮蔽等效于损失无穷大）。链路预算时按标称值加 2 dB 余量、再按场景威胁加 1～3 dB，是稳妥的做法。' },
          { t: 'callout', kind: 'pit', title: '⑥ 常见误区：参考窗越长越好', md: '参考窗长确实压低 CFAR 损失，但有三个代价：**对快速变化背景响应迟钝**（杂波边缘过渡带按 $N/2$ 加宽，长窗在边缘的虚警/漏检带更宽）；**参考窗内混入杂波边缘或多目标的概率更高**；**存储与计算量线性增长**。$N$ 的选取本质是"背景平稳尺度"问题：参考窗应小于背景平稳的空间尺度（地物斑块典型 20～50 个距离单元）、大于目标占据的单元数。工程典型值 16～32，扇区自适应调整。' },
          { t: 'md', md: '⑦ **检测单元必须从参考窗中排除**——本节开头就强调的"自遮蔽"，再强调一次：保护单元不是可选项。真实事故模式：某型雷达脉压后主瓣展宽超过设计值，2 个保护单元不够，目标能量泄漏进参考窗，**强目标两侧各出现一个"门限鼓包"，目标本尊反而检测不到**。排查方法很直接：把门限曲线叠画在剖面上（本节仿真就是这么画的），看鼓包位置与目标位置的相对关系。' },
          { t: 'md', md: '一笔总结账：**门限系数 $\\alpha=N(P_{fa}^{-1/N}-1)$**（$N=16$、$10^{-6}$ → 21.9）；**CFAR 损失 $=10\\lg(\\alpha/(-\\ln P_{fa}))$**（2.0 dB）；**Swerling I 的起伏损失**（$P_d=0.9$ 时 8 dB，靠捷变频 + 积累压到 2～3 dB）；**OS 的排序换鲁棒**（0.2 dB 起步 + 计算量）。四笔账之外，还有一张"失效模式地图"：边缘找 GO、多目标找 SO/OS、重尾找分位数——**CFAR 设计一半是数学，一半是场景工程**。' },
          { t: 'lab', item: { path: 'lab/window', title: '窗函数横向对比实验台', desc: '参考窗加权与谱窗加权是同一套数学，先在实验台建立直觉' } },
          { t: 'chips', list: ['恒虚警检测', '单元平均', '两侧选大', '两侧选小', '有序统计', '杂波图', '虚警概率', '检测概率', 'Swerling 起伏', 'K 分布'], cls: 'teal' }
        ]
      }
    ],
    refs: REFS
  });

  /* ============================================================
     案例四：FMCW 差拍信号测距测速（车载 / 毫米波雷达）
     ============================================================= */

  /** 交互仿真：FMCW 一维距离谱 + 二维距离-多普勒图 + 三角波解耦 + 角度 FFT */
  function simFMCW(el) {
    const F0 = 77e9;                 // 77 GHz 车载毫米波
    const LAM = C0 / F0;             // λ ≈ 3.9 mm
    const st = { R: 40, v: 15, B: 300, Tc: 50, Nc: 64, tri: true, az: 15 };

    const boxA = UI.plotBox({ title: '差拍信号时域（第 1 个 chirp，实部）' });
    const boxB = UI.plotBox({ title: '距离维 FFT 谱（多 chirp 平均，dB）' });
    const boxC = UI.plotBox({ title: '二维距离-多普勒图（上扫频帧）' });
    const boxD = UI.plotBox({ title: '角度 FFT（2×8 虚拟阵元，MIMO）' });
    const pA = P.new(boxA.canvas, { height: 180, xlabel: '采样点', ylabel: '归一化幅度' });
    const pB = P.new(boxB.canvas, { height: 250, xlabel: '距离 / m', ylabel: '幅度 / dB', legend: true, legendPos: 'tl' });
    const pD = P.new(boxD.canvas, { height: 200, xlabel: '方位角 / °', ylabel: '幅度 / dB' });
    const mBox = h('div.metrics');
    const note = h('div.prose');

    const recalc = U.rafThrottle(function () {
      const B = st.B * 1e6, Tc = st.Tc * 1e-6, Nc = st.Nc;
      const k = B / Tc;                                        // 调频斜率 Hz/s
      const Ns = Math.max(256, Math.min(1024, C.nextPow2(Math.ceil(4 * B * 140 / C0))));
      const fs = Ns / Tc;                                      // 差拍采样率
      const dr = C0 / (2 * B);                                 // 距离单元 c/2B
      const Rmax = Ns * C0 / (4 * B);                          // 复采样正距离量程
      const fd = 2 * st.v / LAM;                               // 多普勒 Hz
      const nUp = st.tri ? Math.floor(Nc / 2) : Nc;            // 上扫频 chirp 数
      const nDn = Nc - nUp;
      const Nf = C.nextPow2(Math.max(64, nUp));
      const dv = LAM / (2 * nUp * Tc);                         // 速度分辨率
      const vmax = LAM / (4 * Tc);                             // 最大不模糊速度
      const couple = st.v * F0 * Tc / B;                       // 耦合距离偏移（上扫频偏近）

      /* ---------- 生成差拍数据立方 ---------- */
      const nz1 = U.randn(Nc * Ns, 3301), nz2 = U.randn(Nc * Ns, 3302);
      const cubeR = new Float64Array(Nc * Ns), cubeI = new Float64Array(Nc * Ns);
      for (let m = 0; m < Nc; m++) {
        const up = !st.tri || m < nUp;
        const Rm = st.R - st.v * m * Tc;                       // 慢时间内目标移动
        const frm = Math.max(2 * Rm * k / C0, 0);              // 距离项
        const fb = (up ? frm - fd : frm + fd);                 // 差拍频率（耦合进去）
        const phM = 2 * Math.PI * fd * m * Tc;                 // 慢时间相位
        for (let n = 0; n < Ns; n++) {
          const idx = m * Ns + n;
          const ph = 2 * Math.PI * fb * (n / fs) + phM;
          cubeR[idx] = Math.cos(ph) + 0.15 * nz1[idx];
          cubeI[idx] = Math.sin(ph) + 0.15 * nz2[idx];
        }
      }

      /* ---------- 一维距离 FFT（加汉宁窗抑制泄漏，保留复谱供慢时间用） ---------- */
      const win = mkWin('hann', Ns);
      const halfBins = Ns >> 1;
      const specUp = new Float64Array(halfBins), specDn = new Float64Array(halfBins);
      const rSpecR = new Float64Array(Nc * halfBins), rSpecI = new Float64Array(Nc * halfBins);
      for (let m = 0; m < Nc; m++) {
        const up = !st.tri || m < nUp;
        const br = new Float64Array(Ns), bi = new Float64Array(Ns);
        for (let n = 0; n < Ns; n++) {
          br[n] = cubeR[m * Ns + n] * win[n];
          bi[n] = cubeI[m * Ns + n] * win[n];
        }
        const F = C.fftC({ re: br, im: bi }, Ns);
        for (let b = 0; b < halfBins; b++) {
          const p = F.re[b] * F.re[b] + F.im[b] * F.im[b];
          rSpecR[m * halfBins + b] = F.re[b];
          rSpecI[m * halfBins + b] = F.im[b];
          if (up) specUp[b] += p / nUp;
          else specDn[b] += p / nDn;
        }
      }

      /* ---------- 二维慢时间 FFT（上扫频帧，复数谱保留多普勒相位） ---------- */
      const map2 = new Float64Array(halfBins * Nf);
      const w2 = mkWin('hann', nUp);
      let mx2 = 0, pkBin = 0, pkDop = 0;
      for (let b = 0; b < halfBins; b++) {
        const br = new Float64Array(Nf), bi = new Float64Array(Nf);
        for (let m = 0; m < nUp; m++) {
          br[m] = rSpecR[m * halfBins + b] * w2[m];
          bi[m] = rSpecI[m * halfBins + b] * w2[m];
        }
        const F = C.fftC({ re: br, im: bi }, Nf);
        for (let s = 0; s < Nf; s++) {
          const kk = (s + Nf / 2) % Nf;
          const v = F.re[kk] * F.re[kk] + F.im[kk] * F.im[kk];
          map2[b * Nf + s] = v;
          if (v > mx2) { mx2 = v; pkBin = b; pkDop = kk; }
        }
      }
      // 目标所在距离单元的多普勒峰做抛物线插值 → 亚 bin 测速
      const dopProf = new Float64Array(Nf);
      for (let s = 0; s < Nf; s++) dopProf[s] = map2[pkBin * Nf + s];
      const sPk = (function () {
        let bi = 0, bv = -1;
        for (let s = 0; s < Nf; s++) if (dopProf[s] > bv) { bv = dopProf[s]; bi = s; }
        const l = dopProf[(bi - 1 + Nf) % Nf], c2 = dopProf[bi], r = dopProf[(bi + 1) % Nf];
        const den = l - 2 * c2 + r;
        const fr = Math.abs(den) > 1e-30 ? 0.5 * (l - r) / den : 0;
        return (bi - Nf / 2) + Math.max(-0.5, Math.min(0.5, fr));   // dopProf 已按移序排列：s=Nf/2 ↔ 零频
      })();
      const fdMeas = sPk / (Nf * Tc);
      const vMeas = LAM / 2 * fdMeas;

      /* ---------- 峰位估计（对数域抛物线插值 → 亚 bin 测距 / 三角解耦） ---------- */
      function peakFrac(spec) {
        let bi = 1, bv = -Infinity;
        for (let b = 1; b < spec.length - 1; b++) {
          const db = 10 * Math.log10(Math.max(spec[b], 1e-30));
          if (db > bv) { bv = db; bi = b; }
        }
        const l = 10 * Math.log10(Math.max(spec[bi - 1], 1e-30));
        const c2 = 10 * Math.log10(Math.max(spec[bi], 1e-30));
        const r = 10 * Math.log10(Math.max(spec[bi + 1], 1e-30));
        const den = l - 2 * c2 + r;
        const fr = Math.abs(den) > 1e-12 ? 0.5 * (l - r) / den : 0;
        return bi + Math.max(-0.5, Math.min(0.5, fr));
      }
      const bUf = peakFrac(specUp);
      const fUp = bUf / Tc;
      const Rup = C0 * fUp / (2 * k);
      let Rdec = null, vDec = null, bD = 0;
      if (st.tri) {
        const bDf = peakFrac(specDn);
        bD = Math.round(bDf);
        const fDn = bDf / Tc;
        Rdec = C0 * (fUp + fDn) / (4 * k);
        vDec = LAM * (fDn - fUp) / 4;
      }

      /* ---------- 绘图 ---------- */
      const tAx = [], tY = [];
      for (let n = 0; n < Ns; n++) { tAx.push(n); tY.push(cubeR[n]); }
      pA.clear().add({ x: tAx, y: tY, type: 'line', color: 0, width: 0.8 }).draw();

      const rAx = [], dU = [], dD = [];
      let spMax = 0;
      for (let b = 0; b < Ns / 2; b++) { if (specUp[b] > spMax) spMax = specUp[b]; }
      for (let b = 0; b < Ns / 2; b++) {
        rAx.push(b * dr);
        dU.push(10 * Math.log10(Math.max(specUp[b], 1e-30) / spMax));
        dD.push(10 * Math.log10(Math.max(specDn[b], 1e-30) / spMax));
      }
      pB.clear()
        .add({ x: rAx, y: dU, type: 'line', color: 0, width: 1.4, label: st.tri ? '上扫频段' : '锯齿波（单斜率）' })
        .vline(st.R, { label: '真实距离 ' + st.R.toFixed(1) + ' m', color: '#0f766e' })
        .vline(Rup, { label: '上扫频测得 ' + Rup.toFixed(2) + ' m', color: '#b45309' });
      if (st.tri) pB.add({ x: rAx, y: dD, type: 'line', color: 1, width: 1.2, dash: [4, 3], label: '下扫频段' })
        .vline(bD * dr, { label: '下扫频测得 ' + (bD * dr).toFixed(2) + ' m', color: '#b91c1c' });
      pB.draw();

      const db2 = 10 * Math.log10(Math.max(mx2, 1e-30));
      const mapDb2 = new Float64Array(map2.length);
      for (let i = 0; i < map2.length; i++) mapDb2[i] = 10 * Math.log10(Math.max(map2[i], 1e-30));
      P.heatmap(boxC.canvas, {
        data: mapDb2, cols: Ns / 2, rows: Nf,
        xlim: [0, Rmax], ylim: [-vmax, vmax], flipY: true,
        xlabel: '距离 / m', ylabel: '视在速度 / m/s',
        vmin: db2 - 40, vmax: db2, height: 260,
        title: '距离-多普勒图（上扫频帧）：距离轴已被多普勒耦合推移'
      });

      /* ---------- 角度 FFT（2 发 × 8 收 = 16 虚拟阵元） ---------- */
      const NV = 16, NFFT = 128;
      const ar = new Float64Array(NFFT), ai = new Float64Array(NFFT);
      const sT = Math.sin(st.az * Math.PI / 180);
      const an1 = U.randn(NV, 4401), an2 = U.randn(NV, 4402);
      for (let i = 0; i < NV; i++) {
        const ph = Math.PI * i * sT;
        ar[i] = Math.cos(ph) + 0.25 * an1[i];
        ai[i] = Math.sin(ph) + 0.25 * an2[i];
      }
      const FA = C.fftC({ re: ar, im: ai }, NFFT);
      const aAx = [], aDb = [];
      let aMax = 0;
      const aRaw = new Float64Array(NFFT);
      for (let q = 0; q < NFFT; q++) {
        const u = q < NFFT / 2 ? q / NFFT : (q - NFFT) / NFFT;
        aRaw[q] = Math.sqrt(FA.re[q] * FA.re[q] + FA.im[q] * FA.im[q]);
        if (aRaw[q] > aMax) aMax = aRaw[q];
      }
      for (let q = 0; q < NFFT; q++) {
        const u = q < NFFT / 2 ? q / NFFT : (q - NFFT) / NFFT;
        if (u <= -1 || u > 1) continue;
        aAx.push(Math.asin(u) * 180 / Math.PI);
        aDb.push(20 * Math.log10(Math.max(aRaw[q] / aMax, 1e-6)));
      }
      pD.clear()
        .add({ x: aAx, y: aDb, type: 'line', color: 2, width: 1.4 })
        .vline(st.az, { label: '真实方位 ' + st.az + '°' })
        .draw();

      /* ---------- 指标 ---------- */
      fillMetrics(mBox, [
        ['距离分辨率 c/2B', dr.toFixed(3), 'm'],
        ['正距离量程（Ns·c/4B）', Rmax.toFixed(0), 'm'],
        ['速度分辨率 λ/(2NcTc)', dv.toFixed(2), 'm/s'],
        ['最大不模糊速度 λ/4Tc', vmax.toFixed(1), 'm/s'],
        ['耦合距离偏移 v·f0·Tc/B', couple.toFixed(2), 'm'],
        ['单斜率测距（上扫频）', Rup.toFixed(2), 'm'],
        ['三角波解耦测距 / 测速', st.tri ? Rdec.toFixed(2) + ' / ' + vDec.toFixed(1) : '—（锯齿模式）', 'm / m·s⁻¹'],
        ['慢时间测速（折叠后）', vMeas.toFixed(1), 'm/s']
      ]);

      /* ---------- 动态解读 ---------- */
      note.innerHTML = U.md(
        '**当前状态解读：** 带宽 ' + st.B.toFixed(0) + ' MHz、chirp 周期 ' + st.Tc.toFixed(0) + ' µs → 调频斜率 $k=B/T_c=' +
        (k / 1e12).toFixed(2) + '\\,\\text{GHz/µs}$（即 ' + (k / 1e12).toFixed(1) + '×10¹² Hz/s），距离分辨率 $\\Delta R=c/2B=' +
        dr.toFixed(2) + '\\,\\text{m}$。速度 $v=' + st.v.toFixed(0) + '\\,\\text{m/s}$ 在 77 GHz 对应多普勒 $f_d=2v/\\lambda=' +
        (fd / 1000).toFixed(1) + '\\,\\text{kHz}$，它以两项方式进入差拍频率：$f_b=\\frac{2Rk}{c}\\pm\\frac{2v}{\\lambda}$——' +
        '**距离项 $\\frac{2Rk}{c}=' + (2 * st.R * k / C0 / 1e6).toFixed(2) + '\\,\\text{MHz}$ 远大于速度项 ' + (fd / 1000).toFixed(1) + ' kHz，但速度项足以把测距推偏**：' +
        '耦合偏移 $\\Delta R=\\frac{c}{2}\\cdot\\frac{f_d}{k}=v\\cdot\\frac{f_0T_c}{B}=' + couple.toFixed(2) +
        '\\,\\text{m}$（上扫频时偏近），仿真实测上扫频峰在 ' + Rup.toFixed(2) + ' m，与真值 ' + st.R.toFixed(1) + ' m 差 ' + (Rup - st.R).toFixed(2) + ' m。' +
        (st.tri
          ? ' 三角波模式：下扫频段峰在 ' + (bD * dr).toFixed(2) + ' m（偏远），联立 $R=\\frac{c(f_\\uparrow+f_\\downarrow)}{4k}=' + Rdec.toFixed(2) +
            '\\,\\text{m}$、$v=\\frac{\\lambda(f_\\downarrow-f_\\uparrow)}{4}=' + vDec.toFixed(1) + '\\,\\text{m/s}$，**耦合被解掉**。'
          : ' 锯齿波模式（单斜率）：**没有第二只眼**，测距偏差 ' + couple.toFixed(2) + ' m 无法在本帧内消除，只能靠慢时间维测速后回头修正——切到三角波看解耦。') +
        ' 慢时间维：' + nUp + ' 个有效 chirp → 速度分辨率 $\\lambda/(2N_cT_c)=' + dv.toFixed(2) + '\\,\\text{m/s}$，最大不模糊速度 $\\pm\\lambda/(4T_c)=\\pm' +
        vmax.toFixed(1) + '\\,\\text{m/s}$，' + (Math.abs(st.v) > vmax
          ? '**当前速度已超过不模糊范围**：热图上目标速度折叠为 ' + vMeas.toFixed(1) + ' m/s（模糊周期 $\\lambda/2T_c=' + (LAM / (2 * Tc)).toFixed(1) + '\\,\\text{m/s}$）。'
          : '当前速度未模糊，慢时间维测得 ' + vMeas.toFixed(1) + ' m/s。') +
        ' 差拍信号带宽 $\\approx\\frac{2R_{\\max}k}{c}$，采样率 $f_s=N_s/T_c=' + (fs / 1e6).toFixed(1) + '\\,\\text{MHz}$ 必须覆盖它的一半以上，' +
        '所以本仿真的正距离量程被限制在 $N_s c/4B=' + Rmax.toFixed(0) + '\\,\\text{m}$' + (st.R > Rmax ? '——**目标已超出量程，在谱上折叠到了错误距离**！' : '。') +
        ' 角度维：2 发 8 收合成 16 元半波长虚拟阵列，测角精度由角度 FFT 给出，真实方位 ' + st.az + '° 被准确恢复，波束宽度约 $\\lambda/L\\approx' +
        (180 / Math.PI / NV).toFixed(1) + '°$。'
      );
      UI.renderMathIn(note);
    });

    const sR = UI.slider({ label: '目标距离', min: 2, max: 120, step: 1, value: st.R, unit: 'm', hint: '超过量程时距离谱折叠', onInput: v => { st.R = v; recalc(); } });
    const sV = UI.slider({ label: '目标速度', min: -60, max: 60, step: 1, value: st.v, unit: 'm/s', hint: '超过 λ/4Tc 时速度折叠；同时通过耦合推移测距', onInput: v => { st.v = v; recalc(); } });
    const sB = UI.slider({ label: '带宽 B', min: 100, max: 1000, step: 50, value: st.B, unit: 'MHz', hint: '决定距离分辨率 c/2B，同时推高差拍带宽与采样率需求', onInput: v => { st.B = v; recalc(); } });
    const sTc = UI.slider({ label: 'chirp 周期 Tc', min: 20, max: 100, step: 5, value: st.Tc, unit: 'µs', hint: '斜率 k=B/Tc：Tc 越大耦合越严重，但不模糊速度越低', onInput: v => { st.Tc = v; recalc(); } });
    const sNc = UI.slider({ label: 'chirp 数（一帧）', min: 16, max: 256, step: 16, value: st.Nc, unit: '个', hint: '决定速度分辨率与帧时间（数据立方大小）', onInput: v => { st.Nc = v; recalc(); } });
    const sAz = UI.slider({ label: '目标方位角', min: -60, max: 60, step: 1, value: st.az, unit: '°', hint: 'MIMO 虚拟阵列的角度 FFT 输入', onInput: v => { st.az = v; recalc(); } });
    const segW = UI.seg({
      label: '调制波形', value: st.tri ? 'tri' : 'saw', hint: '三角波上下扫频联立解耦 R 与 v',
      options: [{ value: 'saw', label: '锯齿波（单斜率）' }, { value: 'tri', label: '三角波（可解耦）' }],
      onChange: v => { st.tri = v === 'tri'; recalc(); }
    });

    el.appendChild(UI.ctrlPanel('仿真参数（77 GHz，差拍采样点数 Ns 自适应，噪声固定）',
      [sR, sV, sB, sTc, sNc, sAz, segW]));
    el.appendChild(boxA.el);
    el.appendChild(boxB.el);
    el.appendChild(h('div.grid.g2', {}, [boxC.el, boxD.el]));
    el.appendChild(mBox);
    el.appendChild(h('div.plot-cap', { html: U.md('自上而下：单个 chirp 的差拍时域信号（数百个周期的高频振荡，频率即"距离"）；距离维 FFT 谱（上下扫频两条曲线对称地偏在真值两侧——这就是耦合）；二维距离-多普勒热图与 MIMO 角度谱。') }));
    el.appendChild(note);
    recalc();
  }

  doc.register('cases/radar/fmcw', {
    title: '案例四：FMCW 差拍信号测距测速（车载毫米波）',
    lede: '77 GHz、300 MHz 带宽、50 µs chirp——这组典型车载毫米波参数给出 0.5 m 距离分辨率与 0.6 m/s 速度分辨率。FMCW 不测回波时延而测差拍频率：一个 FFT 测距、第二个 FFT 测速、第三个 FFT 测角，本节把"距离-速度耦合""三角波解耦""MIMO 虚拟阵列"三件事讲透。',
    tags: ['雷达', 'FMCW', '毫米波', '车载', '二维 FFT'],
    labs: [{ path: 'lab/dft', title: 'DFT/FFT：栅栏效应与频谱泄漏实验台', desc: 'FMCW 的三个 FFT 全是 DFT，泄漏与加窗结论直接适用' }],
    toc: true,
    sections: [
      {
        id: 'bg', num: '1', title: '工程背景：一枚芯片上的雷达',
        blocks: [
          { t: 'md', md: '调频连续波（FMCW）雷达与脉冲雷达的本质区别一句话说清：**脉冲雷达测"回波迟到了多久"，FMCW 测"回波与发射波差了多少频率"**。发射的是连续的调频三角波/锯齿波，回波与当前发射信号混频，得到一个频率正比于目标距离的**差拍信号**——把"测时延"变成了"测频率"，而测频率正是数字信号处理最擅长的事（一次 FFT 就够）。' },
          { t: 'md', md: '为什么车载毫米波雷达清一色选择 FMCW？因为它的全部约束都恰好落在车载场景的甜区：' },
          { t: 'table', cols: ['项目', '典型取值', '为什么是这个数'], rows: [
            ['中心频率', '76～81 GHz（$\\lambda\\approx3.9\\sim3.7\\,\\text{mm}$）', '76～77 GHz 远距（自适应巡航），78～81 GHz 近距（角雷达）；波长小 → 天线可集成在芯片封装上'],
            ['带宽 $B$', '0.3～4 GHz（本例 300 MHz）', '$\\Delta R=c/2B$：300 MHz → 0.5 m，4 GHz → 4 cm；带宽直接买到分辨率'],
            ['chirp 周期 $T_c$', '10～100 µs（本例 50 µs）', '斜率 $k=B/T_c$ 决定差拍带宽与耦合量；$T_c$ 还锁定不模糊速度 $\\lambda/4T_c$'],
            ['一帧 chirp 数 $N_c$', '64～512', '速度分辨率 $\\lambda/(2N_cT_c)$ 与帧率（典型 10～20 帧/秒）的折中'],
            ['差拍中频带宽', '数百 kHz～数十 MHz', '决定 ADC 采样率（数十 MHz 量级）——**比脉冲雷达低两个数量级**，这是 FMCW 便宜的根本原因'],
            ['发射功率', '10～15 dBm（单通道）', '连续波体制峰值功率低，CMOS 功放可直接集成，无须行波管'],
            ['探测距离', '近距角雷达 0.5～100 m；前向雷达 4～300 m', '由带宽、积累时间与天线增益共同决定'],
            ['作用对象', '车辆（1 000 m² 级截面积）、行人（0.1～1 m²）、静止物体', '**静止目标必须能测**——这排除了依赖多普勒的体制，FMCW 的距离 FFT 天然覆盖静止目标']
          ] },
          { t: 'metrics', list: [
            { label: '距离分辨率', value: '0.50', unit: 'm（c/2B）' },
            { label: '速度分辨率', value: '0.61', unit: 'm/s（λ/2NcTc）' },
            { label: 'ADC 采样率', value: '≈15', unit: 'MHz（差拍带宽）' },
            { label: '不模糊速度', value: '±19.5', unit: 'm/s（λ/4Tc）' }
          ] },
          { t: 'callout', kind: 'eng', title: '工程师视角：为什么车载不用脉冲体制', md: '脉冲雷达测距要接收到 $2R/c$ 的时延——10 m 目标的时延仅 67 ns，要在脉冲持续期内完成收发切换且不掩盖回波，**收发开关的恢复时间与近距盲区**是硬伤；且脉冲体制峰值功率高、ADC 采样率要覆盖射频带宽，CMOS 工艺做不动。FMCW 把收发同时进行（连续波），近距盲区仅受泄漏抑制限制（可到分米级），ADC 只需覆盖差拍带宽（MHz 级），峰值功率低到可以单片集成——**"把难题从时域搬到频域"这一次搬动，成就了一枚几十块钱的雷达芯片**。代价也有两个：泄漏（发射直接窜进接收机）与距离-速度耦合（本节重点）。' }
        ]
      },
      {
        id: 'model', num: '2', title: '信号模型：chirp、差拍与两项式差拍频率',
        blocks: [
          { t: 'md', md: '发射 chirp 是频率随时间线性上升的正弦（锯齿）或上下来回（三角）的信号。上扫频段：' },
          { t: 'math', tex: 's_{tx}(t)=\\cos\\!\\left(2\\pi f_0 t+\\pi k t^{2}\\right),\\qquad k=\\frac{B}{T_c}\\ \\text{(Hz/s)},\\quad 0\\le t<T_c', tag: '(1)' },
          { t: 'md', md: '距离 $R$、径向速度 $v$（接近为正）的目标回波延迟 $\\tau=2(R-vt)/c$ 且带多普勒频移。回波与本振（当前发射信号）混频、低通取差频，得**差拍信号**。在中频段做近似（$\\tau\\ll T_c$，多普勒远小于 $kT_c$）后，差拍频率是一个**两项式**：' },
          { t: 'math', tex: 'f_b = \\frac{2Rk}{c} \\;\\pm\\; \\frac{2v}{\\lambda} \\;=\\; \\underbrace{\\frac{2Rk}{c}}_{\\text{距离项（正比于 } R\\text{）}} \\;\\pm\\; \\underbrace{f_d}_{\\text{速度项（多普勒）}}', tag: '(2)' },
          { t: 'kv', title: '变量说明', pairs: [
            ['$2Rk/c$', '距离项：目标越远，回波延迟越大，与发射波错开的频率越多。本例 $R=40\\,\\text{m}$ 时约 1.6 MHz'],
            ['$2v/\\lambda = f_d$', '速度项：多普勒频移。$v=15\\,\\text{m/s}$ 时约 7.7 kHz'],
            ['正负号', '上扫频段取减号（$f_{b\\uparrow}=\\frac{2Rk}{c}-f_d$），下扫频段取加号——**这是三角波解耦的全部数学基础**'],
            ['$k=B/T_c$', '调频斜率。$k$ 越大，同样距离差产生的频率差越大 → 分辨率越好，但差拍带宽越大 → 采样率越高'],
            ['$\\tau\\ll T_c$', '窄带近似条件：回波延迟远小于 chirp 周期。车载场景 $\\tau_{\\max}\\approx2\\,\\mu\\text{s}\\ll50\\,\\mu\\text{s}$ ✓']
          ] },
          { t: 'md', md: '差拍信号的完整复基带形式（本节仿真的生成式）：' },
          { t: 'math', tex: 'x_m(n) = A\\,\\exp\\!\\left[j2\\pi f_b\\frac{n}{f_s}+j2\\pi f_d\\,mT_c\\right]+w_m(n)', tag: '(3)' },
          { t: 'md', md: '注意相位里有两个独立的自变量：**快时间 $n/f_s$ 携带差拍频率（距离信息），慢时间 $mT_c$ 携带多普勒相位（速度信息）**——"一个二维矩阵、两次 FFT"的架构就写在式 (3) 里：快时间维 FFT 给距离，慢时间维 FFT 给速度。' },
          { t: 'callout', kind: 'pit', title: '坑：把耦合项当成小到可以忽略', md: '速度项 $f_d=2v/\\lambda$ 与距离项相比确实很小（本例 7.7 kHz 对 1.6 MHz，不到 0.5%），但它对**测距**的影响要用换算式看：$\\Delta R=\\frac{c}{2}\\cdot\\frac{f_d}{k}=v\\cdot\\frac{f_0T_c}{B}$。代入本例：$15\\times77\\times10^9\\times50\\times10^{-6}/3\\times10^8=0.19\\,\\text{m}$——**近半个距离单元**；速度 60 m/s、$T_c=100\\,\\mu\\text{s}$ 时达 1.5 m，三个距离单元。自适应巡航对前车距离的测量精度要求是 ±0.1 m 量级，**这笔账必须算、必须解**。' },
          { t: 'fold', summary: '展开：差拍频率式 (2) 的推导', deriv: true, blocks: [
            { t: 'md', md: '发射瞬时频率 $f_i(t)=f_0+kt$（上扫频）。目标距离随时间变化 $R(t)=R_0-vt$，回波在时刻 $t$ 对应的是 $t-\\tau(t)$ 时刻的发射，其中 $\\tau(t)=2(R_0-vt)/c$。回波瞬时频率为' },
            { t: 'math', tex: 'f_r(t)=f_i\\big(t-\\tau(t)\\big)\\cdot\\Big(1+\\frac{2v}{c}\\Big)\\approx f_0+k\\big(t-\\tau(t)\\big)+\\frac{2vf_0}{c}' },
            { t: 'md', md: '混频取差频：$f_b(t)=f_i(t)-f_r(t)=k\\,\\tau(t)-\\frac{2vf_0}{c}=\\frac{2k(R_0-vt)}{c}-\\frac{2vf_0}{c}$。' },
            { t: 'md', md: '在 chirp 持续期内 $vt\\ll R_0$，舍去 $-2kvt/c$ 项（它只让峰位轻微展宽，$vT_c=1\\,\\text{mm}$ 量级），得' },
            { t: 'math', tex: 'f_b=\\frac{2R_0k}{c}-\\frac{2vf_0}{c}=\\frac{2Rk}{c}-f_d' },
            { t: 'md', md: '这就是上扫频段的减号来源。下扫频段 $f_i(t)=f_0+k(T_c-t)$，斜率反号，同样推导给出 $f_b=\\frac{2Rk}{c}+f_d$。**两式相加消 $f_d$ 得距离，相减消 $\\frac{2Rk}{c}$ 得速度**——下一步解耦的全部依据。' }
          ] }
        ]
      },
      {
        id: 'algo', num: '3', title: '算法原理：三次 FFT 与一次解耦',
        blocks: [
          { t: 'md', md: '**第一维：距离 FFT。** 对每个 chirp 的 $N_s$ 个差拍采样做 FFT，第 $b$ 个频点对应差拍频率 $f_b=b\\,f_s/N_s=b/T_c$，换算距离' },
          { t: 'math', tex: 'R_b=\\frac{c\\,f_b}{2k}=\\frac{c}{2k}\\cdot\\frac{b}{T_c}=b\\cdot\\frac{c}{2B}\\quad\\Rightarrow\\quad \\Delta R=\\frac{c}{2B},\\qquad R_{\\max}=\\frac{N_s\\,c}{4B}\\ \\text{(复采样)}', tag: '(4)' },
          { t: 'md', md: '距离分辨率只由带宽决定（300 MHz → 0.5 m），与 $T_c$ 无关；但**最大量程被采样率卡住**：差拍带宽 $\\frac{2R_{\\max}k}{c}$ 不能超过 $f_s/2$。加大 $B$ 而不加大 $f_s$，量程反而缩短——这是毫米波芯片设计里"带宽换量程"的经典约束。' },
          { t: 'md', md: '**第二维：多普勒 FFT。** 目标在距离谱上占据某个频点，但它的**相位**随 chirp 序号 $m$ 线性旋转：$\\varphi_m=2\\pi f_d mT_c$（推导见案例二第 2 节，完全同构）。对该距离单元沿慢时间维再做一次 $N_c$ 点 FFT：' },
          { t: 'math', tex: '\\Delta v=\\frac{\\lambda}{2N_cT_c},\\qquad v_{\\max}=\\pm\\frac{\\lambda}{4T_c},\\qquad \\text{速度模糊周期}=\\frac{\\lambda}{2T_c}', tag: '(5)' },
          { t: 'md', md: '本例 $\\lambda=3.9\\,\\text{mm}$、$T_c=50\\,\\mu\\text{s}$、$N_c=64$：$\\Delta v=0.61\\,\\text{m/s}$、$v_{\\max}=\\pm19.5\\,\\text{m/s}$（70 km/h）。注意 $T_c$ 越短不模糊速度越大——**快 chirp 买速度范围、慢 chirp 买耦合精度，又是笔互斥账**。两个 FFT 级联得到**距离-多普勒二维矩阵**，同一目标在图上是一个峰，坐标 $(R, v)$ 直接可读。' },
          { t: 'md', md: '**三角波解耦。** 上扫频段测得 $f_\\uparrow=\\frac{2Rk}{c}-f_d$，下扫频段测得 $f_\\downarrow=\\frac{2Rk}{c}+f_d$，联立：' },
          { t: 'math', tex: 'R=\\frac{c\\,(f_\\uparrow+f_\\downarrow)}{4k},\\qquad v=\\frac{\\lambda\\,(f_\\downarrow-f_\\uparrow)}{4}', tag: '(6)' },
          { t: 'md', md: '加法消掉多普勒，减法消掉距离项。**代一组真数**：$R=40\\,\\text{m}$、$v=15\\,\\text{m/s}$、$k=6\\,\\text{GHz/µs}$：$f_\\uparrow=1.6075-0.0077=1.5998\\,\\text{MHz}$，$f_\\downarrow=1.6075+0.0077=1.6152\\,\\text{MHz}$；解出 $R=c(f_\\uparrow+f_\\downarrow)/(4k)=40.00\\,\\text{m}$、$v=\\lambda(f_\\downarrow-f_\\uparrow)/4=15.0\\,\\text{m/s}$ ✓。' },
          { t: 'md', md: '**加窗与泄漏。** 距离 FFT 不加窗时，强目标的 sinc 旁瓣只有 −13 dB，会把邻近弱目标（行人 next to 卡车）完全盖住；加汉宁/汉明窗压到 −31/−41 dB，代价与脉冲压缩完全相同（损失 1.3～1.8 dB、主瓣展宽 1.5 倍）。**泄漏**则是 FMCW 特有的问题：发射信号经天线耦合、电路板串扰直接漏进接收机，它不经过目标反射，在差拍谱上表现为**零频（零距离）处的超强峰**，抬高近距噪声底、甚至使 ADC 饱和。对策：收发天线物理隔离（交叉极化、波导隔离度 50～60 dB）、泄漏对消电路、以及把近距若干距离单元置零。' },
          { t: 'fold', summary: '展开：为什么慢时间维测速是"相位法"，以及它与差拍频率项的关系', deriv: true, blocks: [
            { t: 'md', md: '式 (2) 告诉我们差拍频率里已经含了 $f_d$——那为什么还要慢时间 FFT？两个原因：' },
            { t: 'md', md: '① **精度差三个量级**：$f_d$ 在差拍谱里只占一个频点的偏移（分辨率 $1/T_c=20\\,\\text{kHz}$，对应速度 $\\lambda f_s/2$ 量级，太粗）；而慢时间维的频率分辨率是 $1/(N_cT_c)$（本例 312 Hz，对应 0.61 m/s）。**用相位的时间演化测速，比用频率偏移测速精细 $N_c$ 倍**。' },
            { t: 'md', md: '② **相位法可直接测微小位移**：相邻 chirp 的相位差 $\\Delta\\varphi=2\\pi f_dT_c=4\\pi vT_c/\\lambda$，振动目标（行人微动、发动机）的相位历程就是其运动曲线——生命体征检测、微多普勒分类全靠它。' },
            { t: 'md', md: '所以工程流程是：距离 FFT 定峰 → 慢时间 FFT 测速（精确）→ 用测得的速度按 $\\Delta R=vf_0T_c/B$ 修正距离（或直接用三角波解耦）。三条路径互相校验。' }
          ] },
          { t: 'callout', kind: 'tip', title: '与知识库的对应关系', md: '三次 FFT 全部是标准 DFT：距离 FFT 的泄漏与加窗见「DFT 离散傅里叶变换」与「窗函数基础」；慢时间 FFT 的相参积累与模糊见案例二；角度 FFT 的导向矢量与波束宽度见「波束形成原理」与「相移、波束扫描与栅瓣」两节——虚拟阵列就是一个合成的均匀线阵。' }
        ]
      },
      {
        id: 'chain', num: '4', title: '完整处理链路：从 VCO 到目标列表',
        blocks: [
          { t: 'flow', v: true, items: [
            { t: '① 频率合成器（VCO / 锁相环）产生 chirp', d: '输入：斜率/带宽/周期配置；输出：76～81 GHz 调频连续波。关键：**chirp 线性度**（非线性直接展宽距离谱主瓣）、相位噪声' },
            { t: '② 功放与发射天线', d: '输出：10～15 dBm 连续波。关键：与接收天线的隔离度 ≥ 50 dB（防泄漏饱和）' },
            { t: '③ 接收天线 + 低噪声放大', d: '输入：回波 + 泄漏；输出：微弱射频。关键：泄漏是近距性能的"天花板"' },
            { t: '④ 混频（正交下变频）与差拍低通', d: '输入：回波 × 当前发射波；输出：差拍中频。关键：**混频用"当前"发射信号做本振，差拍频率才正比于距离**；低通截止频率决定量程' },
            { t: '⑤ 模数转换', d: '输入：差拍中频；输出：数字流。关键：采样率覆盖差拍带宽（10～25 MHz）、12～14 bit；**近距强反射（车身、保险杠）可能饱和 ADC，需要近距衰减**' },
            { t: '⑥ 一维距离 FFT（每 chirp 一次）', d: '输入：$N_s$ 点差拍采样；输出：距离谱。关键：加窗（汉宁/汉明）压旁瓣；直流与近距单元置零（去泄漏与收发耦合）' },
            { t: '⑦ 二维多普勒 FFT（沿慢时间）', d: '输入：$N_c$ 个 chirp 的距离谱；输出：距离-多普勒二维矩阵。关键：加窗；静止目标在零速通道——与动目标共存是车载特有需求' },
            { t: '⑧ 二维 CFAR + 目标聚类', d: '输入：二维矩阵；输出：检测点（距离、速度、幅度）。关键：二维参考窗；**聚类（DBSCAN 等）把一个真实目标的多个检测点合并**，剔除鬼影' },
            { t: '⑨ 角度 FFT（MIMO 虚拟阵列）', d: '输入：各接收通道同一距离-多普勒单元的复数据；输出：角度谱与方位角估计。关键：虚拟阵元校准（幅相一致性）、角度模糊（栅瓣）' },
            { t: '⑩ 跟踪与目标列表', d: '输入：点迹（距离、速度、角度、幅度）；输出：目标列表（位置、速度矢量、类别）。关键：多帧关联、幽灵目标剔除、与摄像头/激光雷达融合' }
          ] },
          { t: 'callout', kind: 'eng', title: '与脉冲雷达链路的三个结构性差异', md: '① **没有脉压**：差拍处理本身就是"压缩"——距离信息天然在频域，不需要匹配滤波；② **没有 MTI**：车载必须看静止目标（静止车辆、护栏、行人），零速通道不能像脉冲雷达那样挖掉，改用二维 CFAR 在零速通道单独设门限；③ **没有距离模糊问题**（连续波不存在 PRF），但有**速度模糊**（$T_c$ 定死 $\\lambda/4T_c$）与**多目标配对问题**（见第 6 节）。' }
        ]
      },
      {
        id: 'sim', num: '5', title: '交互仿真：看见耦合、解掉耦合',
        blocks: [
          { t: 'md', md: '下面这台仿真器按式 (3) 生成完整的差拍数据立方：77 GHz、目标距离与速度可调、带宽与 chirp 周期可调、锯齿/三角波可切，另含 2 发 8 收虚拟阵列的角度维。请做四组实验：' },
          { t: 'md', md: '① **把速度从 0 拉到 60 m/s**：看上扫频测得的距离从真值"偷跑"出去（偏近），下扫频段反向偏远——两条曲线对称分开，这就是耦合；\n② **切到三角波**：看联立解耦后的测距/测速回到真值；\n③ **把 chirp 周期从 20 µs 拉到 100 µs**：看耦合偏移 $vf_0T_c/B$ 成正比变大、而不模糊速度 $\\lambda/4T_c$ 反比例变小（速度折叠）；\n④ **把带宽从 100 MHz 拉到 1 GHz**：看距离谱峰变窄（分辨率提高），同时量程被采样率压缩、目标可能折叠出谱。' },
          { t: 'widget', render: function (el) { simFMCW(el); } },
          { t: 'callout', kind: 'note', title: '为什么热图上的速度峰与设定的速度对不上', md: '两种情况都会发生，且都是真的物理而非程序错误：一是**速度折叠**（$|v|>\\lambda/4T_c$ 时按 $\\lambda/2T_c$ 周期卷绕，热图纵轴是"视在速度"）；二是**慢时间相位与差拍频率的一致性**——差拍频率项 $\\mp f_d$ 已经把距离峰推偏，而慢时间相位给出的是"真"多普勒，两者一个看距离轴一个看速度轴，恰好构成解耦的两组方程。仿真里把三角波上下两半帧各做一次慢时间 FFT，就能同时看到这组对称性。' }
        ]
      },
      {
        id: 'mimo', num: '6', title: 'MIMO 虚拟阵列与角度估计',
        blocks: [
          { t: 'md', md: '测角靠天线阵列：目标方位 $\\theta$ 使各阵元回波存在相位差 $\\Delta\\varphi=2\\pi d\\sin\\theta/\\lambda$（$d$ 为阵元间距，取 $\\lambda/2$）。$N_{RX}$ 个接收通道构成 $N_{RX}$ 元阵列，角度分辨率由孔径 $L=N_{RX}d$ 决定：$\\theta_{bw}\\approx\\lambda/L$ 弧度。8 收阵列孔径 $4\\lambda$，波束约 $14°$——对车辆横向定位太粗。**MIMO 的妙招**：2 个发射天线分时发射（时分复用），每个发射与 8 个接收通道的组合在信号处理上等效于 $2\\times8=16$ 元**虚拟阵列**（发射阵元间距设计成 $N_{RX}\\lambda/2$，虚拟阵元恰为半波长均匀排列）：' },
          { t: 'math', tex: 'N_{virtual}=N_{TX}\\times N_{RX}=16,\\qquad \\theta_{bw}\\approx\\frac{\\lambda}{N_{virtual}\\cdot\\lambda/2}=\\frac{2}{N_{virtual}}\\ \\text{rad}\\approx7°', tag: '(7)' },
          { t: 'md', md: '角度估计本身又是一次 FFT（对 16 个虚拟阵元的复数据做角度 FFT，峰位即 $\\sin\\theta$）：**同一套 DFT 机器，在快时间、慢时间、阵元维连用三次**。这是 FMCW 信号处理最优雅的地方。需要更细的角分辨率时用更多通道（级联 4 发 4 收 → 12 虚拟元，或 12 发 16 收 → 192 元成像雷达，波束 1° 量级）。' },
          { t: 'fold', summary: '展开：虚拟阵列为什么"等效"、时分 MIMO 的相位修补', deriv: true, blocks: [
            { t: 'md', md: '第 $m$ 个发射天线位于 $x_m=mN_{RX}\\lambda/2$，第 $n$ 个接收天线位于 $y_n=n\\lambda/2$。远场目标在 $\\theta$ 方向时，收发双程路径差为 $(x_m+y_n)\\sin\\theta$，于是第 $(m,n)$ 通道的相位为' },
            { t: 'math', tex: '\\varphi_{m,n}=\\frac{2\\pi}{\\lambda}(x_m+y_n)\\sin\\theta=\\pi\\big(mN_{RX}+n\\big)\\sin\\theta' },
            { t: 'md', md: '把 $(m,n)$ 重排成下标 $i=mN_{RX}+n$：相位恰为 $\\pi i\\sin\\theta$——与 $i$ 个半波长间距阵元完全一致，**虚拟阵列成立**。' },
            { t: 'md', md: '时分 MIMO 的细节：两个发射天线轮流发射，接收端用同步信号区分"这一 chirp 是谁发的"，分箱后各自与对应的发射阵元配对。代价是**每通道的有效积累时间减半**（速度分辨率变差一倍）与**快慢通道的相位一致性要求**（两发射通道的幅相误差会直接变成角度误差，校准精度要求 ±3° 以内）。' }
          ] },
          { t: 'callout', kind: 'pit', title: '坑：角度模糊与"镜面鬼影"', md: '角度 FFT 与所有 DFT 一样存在模糊：$|\\sin\\theta|>1$ 的区域（即阵列法线 ±90° 以外）没有定义；宽角覆盖时，大角度入射的信号在 FFT 上主瓣展宽、增益下降（投影孔径 $L\\cos\\theta$ 缩短），**±60° 以外角度估计精度急剧恶化**——这是角雷达安装在保险杠两侧时必须面对的现实。另外，多径反射（路面镜面）会让同一目标出现在真实角度与镜像角度两个位置，形成"镜面鬼影"，需要靠高度维信息或跟踪逻辑剔除。' }
        ]
      },
      {
        id: 'limit', num: '7', title: '工程局限与实际难题',
        blocks: [
          { t: 'callout', kind: 'danger', title: '① 距离-速度耦合：单斜率体制的原罪', md: '$\\Delta R=vf_0T_c/B$ 这笔账在高速场景（自动紧急制动要测 30 m/s 的前车）不可忽略：30 m/s、$T_c=50\\,\\mu\\text{s}$、$B=300\\,\\text{MHz}$ → 0.385 m，接近一个距离单元。解法三层：**三角波上下扫频联立**（标准做法，帧时间加倍、处理量加倍）；**慢时间测速回代修正**（利用速度估计修正距离，一帧内完成，但要求目标速度先验平滑）；**快斜率 chirp**（$T_c$ 压短到 10 µs，耦合除以 5，但不模糊速度扩大同时速度分辨率变差——又是互斥账）。' },
          { t: 'callout', kind: 'danger', title: '② 泄漏：近距性能的天花板', md: '发射经天线间耦合与板级串扰直接漏进接收机，差拍谱上表现为**零频附近的超强峰**（本振与回波"零距离差拍"）。危害三连：抬高近距噪声底（掩盖 1 m 内目标）、泄漏功率波动相当于强杂波（CFAR 门限被它带歪）、极端时饱和 ADC。对策按优先级：**收发天线隔离**（波导/双极化，50～60 dB）→ **泄漏对消**（采样泄漏副本加权反灌，再压 20 dB）→ **近距单元置零**（牺牲 0.5 m 内探测）。这就是为什么车载雷达对 0.3 m 内目标普遍"看不见"——不是不想看，是物理不允许。' },
          { t: 'callout', kind: 'warn', title: '③ 多目标配对与鬼影目标', md: '三角波解耦的前提是"上下扫频峰能正确配对"。两个目标 $R_1\\neq R_2$、$v_1\\neq v_2$ 时，上扫频谱有 2 个峰、下扫频谱有 2 个峰，**配对组合有 2×2=4 种**，错配就产生**鬼影目标**（位置速度都是错的，但每个鬼影在二维图上都是合法的峰）。标准解法：不靠一维配对，直接**二维 FFT + 二维 CFAR + 点迹聚类**，每个真实目标在距离-多普勒图上只有一个峰（因为慢时间相位不参与配对歧义）；再用跟踪（多帧运动连续性）剔除残余鬼影。' },
          { t: 'callout', kind: 'warn', title: '④ 相位噪声与 chirp 线性度', md: 'FMCW 的距离谱宽最终由**chirp 线性度**决定：频率误差 $\\delta f(t)$ 使差拍频率附加噪声，表现为距离谱主瓣展宽、近距旁瓣抬高。77 GHz CMOS 锁相环的典型指标：积分相位噪声要压到使 $\\delta f/f_0\\lesssim10^{-6}$ 量级，4 GHz 大带宽 chirp 的线性度误差需在 0.1% 以内——这直接决定芯片成本。**距离越远，对线性度要求越苛刻**（因为差拍频率正比于距离，同一相对误差在远距产生的绝对误差更大），300 m 前向雷达与 30 m 角雷达对 PLL 的要求差一个量级。' },
          { t: 'callout', kind: 'warn', title: '⑤ 近距强反射与 ADC 饱和', md: '自车保险杠、进气格栅的镜面反射可比远端行人强 60 dB 以上；若 ADC 位数不足或增益未按距离加权，近距强反射的谐波与互调会污染整个距离谱。对策：**近距灵敏度衰减**（前若干距离单元数字置零或模拟衰减）、大动态 ADC（14 bit 以上）、以及**时域增益切换**。注意它与泄漏的联合效应：泄漏抬底 + 近距饱和，是"1 米内全是噪声"的两大元凶。' },
          { t: 'callout', kind: 'pit', title: '⑥ 常见误区：把速度分辨率当成测速精度', md: '$\\Delta v=\\lambda/(2N_cT_c)$ 是**分辨两个等强目标的能力**；单目标的测速精度由信噪比决定，可远高于分辨率（插值/相位法可到 0.05 m/s）。反过来，**测速的无偏性受耦合与加速度影响**：目标在帧时间内加速 $a$ 会造成多普勒谱展宽（跨速度单元），60 km/h² 的减速（急刹）在 51 ms 帧内速度变化 0.85 m/s，跨 1 个速度单元——这就是为什么紧急制动场景要缩短帧时间而不是追求速度分辨率。' },
          { t: 'md', md: '⑦ **多径与地面反射**：低安装高度（30 cm）下路面镜面反射让目标同时出现在真实高度与镜像高度，影响俯仰维测角与高度判别；且路面反射随距离干涉起伏（多径瓣），目标回波强度随距离周期性衰落。对策在俯仰维加虚拟阵列或用检测层级的轨迹逻辑平滑。\n\n⑧ **采样率与量程的互斥**：式 (4) 的 $R_{\\max}=N_sc/4B$ 意味着"带宽翻倍、量程减半"（$N_s$ 受芯片 ADC 限制时）。前向雷达 300 m + 4 GHz 带宽需要 $N_s\\ge16000$——单靠提高采样率不现实，实际用**多模式切换**（远距模式窄带宽长 chirp、近距模式宽带宽短 chirp，分时轮询），这也是车载雷达软件里"模式调度器"存在的原因。' },
          { t: 'md', md: '一笔总结账：**距离分辨率 $c/2B$**（300 MHz → 0.5 m）；**速度分辨率 $\\lambda/(2N_cT_c)$**（64×50 µs → 0.61 m/s）；**不模糊速度 $\\pm\\lambda/4T_c$**（±19.5 m/s）；**耦合偏移 $vf_0T_c/B$**（15 m/s → 0.19 m，要解）；**量程 $N_sc/4B$**（受采样率卡死）。五笔账彼此牵制， chirp 参数 $B$、$T_c$、$N_c$ 一旦选定，五笔全部锁定——车载毫米波雷达的波形设计，就是在这张五维约束表里找工程可行解。' },
          { t: 'lab', item: { path: 'lab/dft', title: 'DFT/FFT：栅栏效应与频谱泄漏实验台', desc: '距离谱的泄漏、加窗与栅栏效应，与差拍 FFT 完全同构' } },
          { t: 'chips', list: ['调频连续波', '差拍信号', '距离 FFT', '多普勒 FFT', '距离-速度耦合', '三角波解耦', 'MIMO 虚拟阵列', '角度 FFT', '泄漏抑制', '鬼影目标'], cls: 'teal' }
        ]
      }
    ],
    refs: REFS
  });

})(window);
