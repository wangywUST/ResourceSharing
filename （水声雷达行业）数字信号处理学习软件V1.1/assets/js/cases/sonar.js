/* =============================================================
   cases/sonar.js —— 工程案例库 · 水声（声呐）专题（5 页）
   路由：cases/sonar/pulse-compression | passive | beamforming | mbes | doppler

   写法：结构化 block（见 doc.js 头部注释），与 theory-*.js 同一套渲染器。
   每一页统一按「工程背景 → 信号模型 → 算法原理回顾 → 完整处理链路 →
   交互仿真 → 工程局限」六段式展开，交互仿真使用 DSP.ui 控件 + DSP.plot 绘图。

   约定：声速 c = 1500 m/s（除多波束一节的声速剖面讨论外）。
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

  const CW = 1500;            // 海水声速 m/s（全书统一取值）

  /* ============================================================
     通用小工具（本文件内部复用）
     ============================================================ */

  /** 空复数数组 */
  function cpx(n) {
    return { re: new Float64Array(n), im: new Float64Array(n) };
  }

  /** 单位方差复高斯噪声（可复现） */
  function cnoise(n, seed) {
    const a = U.randn(n, seed), b = U.randn(n, (seed || 1) + 9773);
    const o = cpx(n);
    const k = Math.SQRT1_2;
    for (let i = 0; i < n; i++) { o.re[i] = a[i] * k; o.im[i] = b[i] * k; }
    return o;
  }

  /** 复数取模 */
  function magc(X) {
    const n = X.re.length, o = new Float64Array(n);
    for (let i = 0; i < n; i++) o[i] = Math.sqrt(X.re[i] * X.re[i] + X.im[i] * X.im[i]);
    return o;
  }

  /** 复匹配滤波包装：补上 length 属性，供 C.pulseMetrics 使用 */
  function mfC(x, hh) {
    const y = C.matchedFilterC(x, hh);
    y.length = y.re.length;
    return y;
  }

  /** 复数线性卷积（混响建模用） */
  function cconvC(x, hh) {
    const N = x.re.length, M = hh.re.length, L = N + M - 1;
    const o = cpx(L);
    for (let i = 0; i < N; i++) {
      const xr = x.re[i], xi = x.im[i];
      if (xr === 0 && xi === 0) continue;
      for (let j = 0; j < M; j++) {
        o.re[i + j] += xr * hh.re[j] - xi * hh.im[j];
        o.im[i + j] += xr * hh.im[j] + xi * hh.re[j];
      }
    }
    return o;
  }

  /** 相对峰值归一化的 dB 序列（带下限保护） */
  function dbNorm(mag, floorDb) {
    const n = mag.length;
    let mx = 0;
    for (let i = 0; i < n; i++) if (mag[i] > mx) mx = mag[i];
    if (mx <= 0) mx = 1;
    const out = new Float64Array(n);
    const fl = floorDb === undefined ? -80 : floorDb;
    for (let i = 0; i < n; i++) {
      const v = 20 * Math.log10(Math.max(mag[i], 1e-12) / mx);
      out[i] = v < fl ? fl : v;
    }
    return { db: out, peak: mx };
  }

  /** 数组切片（Float64Array → 普通数组，供 plot 使用） */
  function sub(arr, a, b) {
    a = Math.max(0, a | 0); b = Math.min(arr.length, b | 0);
    const o = [];
    for (let i = a; i < b; i++) o.push(arr[i]);
    return o;
  }

  /**
   * 复 Hermitian 矩阵的特征分解（Jacobi 旋转法）
   * 输入：N×N Hermitian，行主序展平于 Ar / Ai
   * 输出：{ val: Float64Array(N) 升序, vr, vi: N*N，第 j 列为第 j 个特征向量 }
   */
  function hermEig(N, Ar, Ai) {
    const Rr = Float64Array.from(Ar), Ri = Float64Array.from(Ai);
    const vr = new Float64Array(N * N), vi = new Float64Array(N * N);
    for (let i = 0; i < N; i++) vr[i * N + i] = 1;

    for (let sweep = 0; sweep < 30; sweep++) {
      let off = 0;
      for (let p = 0; p < N - 1; p++) {
        for (let q = p + 1; q < N; q++) {
          const zr = Rr[p * N + q], zi = Ri[p * N + q];
          const mz = Math.sqrt(zr * zr + zi * zi);
          if (mz < 1e-13) continue;
          off += mz * mz;
          const a = Rr[p * N + p], b = Rr[q * N + q];
          const tau = (b - a) / (2 * mz);
          const sg = tau >= 0 ? 1 : -1;
          const t = -sg / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
          const cc = 1 / Math.sqrt(1 + t * t), ss = t * cc;
          const phi = Math.atan2(zi, zr);
          const er = Math.cos(phi), ei = -Math.sin(phi);          // e^{-jφ}
          const uqp_r = er * ss, uqp_i = ei * ss;                 // U[q][p]
          const uqq_r = er * cc, uqq_i = ei * cc;                 // U[q][q]
          // 右乘 U：更新 p、q 两列
          for (let i = 0; i < N; i++) {
            const arp = Rr[i * N + p], aip = Ri[i * N + p];
            const arq = Rr[i * N + q], aiq = Ri[i * N + q];
            Rr[i * N + p] = cc * arp + (uqp_r * arq - uqp_i * aiq);
            Ri[i * N + p] = cc * aip + (uqp_r * aiq + uqp_i * arq);
            Rr[i * N + q] = -ss * arp + (uqq_r * arq - uqq_i * aiq);
            Ri[i * N + q] = -ss * aip + (uqq_r * aiq + uqq_i * arq);
          }
          // 左乘 U^H：更新 p、q 两行
          for (let i = 0; i < N; i++) {
            const bpr = Rr[p * N + i], bpi = Ri[p * N + i];
            const bqr = Rr[q * N + i], bqi = Ri[q * N + i];
            // conj(uqp) = (uqp_r, -uqp_i)，conj(uqq) 同理
            Rr[p * N + i] = cc * bpr + (uqp_r * bqr + uqp_i * bqi);
            Ri[p * N + i] = cc * bpi + (uqp_r * bqi - uqp_i * bqr);
            Rr[q * N + i] = -ss * bpr + (uqq_r * bqr + uqq_i * bqi);
            Ri[q * N + i] = -ss * bpi + (uqq_r * bqi - uqq_i * bqr);
          }
          // 特征向量累加 V ← V·U
          for (let i = 0; i < N; i++) {
            const vp_r = vr[i * N + p], vp_i = vi[i * N + p];
            const vq_r = vr[i * N + q], vq_i = vi[i * N + q];
            vr[i * N + p] = cc * vp_r + (uqp_r * vq_r - uqp_i * vq_i);
            vi[i * N + p] = cc * vp_i + (uqp_r * vq_i + uqp_i * vq_r);
            vr[i * N + q] = -ss * vp_r + (uqq_r * vq_r - uqq_i * vq_i);
            vi[i * N + q] = -ss * vp_i + (uqq_r * vq_i + uqq_i * vq_r);
          }
        }
      }
      if (off < 1e-18) break;
    }

    const val = new Float64Array(N);
    for (let i = 0; i < N; i++) val[i] = Rr[i * N + i];
    const idx = [];
    for (let i = 0; i < N; i++) idx.push(i);
    idx.sort((a, b) => val[a] - val[b]);
    const oval = new Float64Array(N);
    const ovr = new Float64Array(N * N), ovi = new Float64Array(N * N);
    for (let j = 0; j < N; j++) {
      const s = idx[j];
      oval[j] = val[s];
      for (let i = 0; i < N; i++) {
        ovr[i * N + j] = vr[i * N + s];
        ovi[i * N + j] = vi[i * N + s];
      }
    }
    return { val: oval, vr: ovr, vi: ovi };
  }

  /** 复矩阵的逆作用于向量：R^{-1} a（借特征分解，R 为 Hermitian 正定） */
  function hermSolve(N, eg, ar, ai, lamFloor) {
    const yr = new Float64Array(N), yi = new Float64Array(N);
    for (let j = 0; j < N; j++) {
      const lam = Math.max(eg.val[j], lamFloor || 1e-10);
      // v_j^H a
      let sr = 0, si = 0;
      for (let i = 0; i < N; i++) {
        const vrr = eg.vr[i * N + j], vii = eg.vi[i * N + j];
        sr += vrr * ar[i] + vii * ai[i];
        si += vrr * ai[i] - vii * ar[i];
      }
      const sr2 = sr / lam, si2 = si / lam;
      for (let i = 0; i < N; i++) {
        yr[i] += eg.vr[i * N + j] * sr2 - eg.vi[i * N + j] * si2;
        yi[i] += eg.vr[i * N + j] * si2 + eg.vi[i * N + j] * sr2;
      }
    }
    return { re: yr, im: yi };
  }

  /** 一维复数组的下标 → 复数乘加 helper（矩阵向量积） */
  function hermMulVec(N, Mr, Mi, vr_, vi_) {
    const or = new Float64Array(N), oi = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let sr = 0, si = 0;
      for (let j = 0; j < N; j++) {
        sr += Mr[i * N + j] * vr_[j] - Mi[i * N + j] * vi_[j];
        si += Mr[i * N + j] * vi_[j] + Mi[i * N + j] * vr_[j];
      }
      or[i] = sr; oi[i] = si;
    }
    return { re: or, im: oi };
  }

  /** 供五页共用的参考书目 */
  const REFS = [
    'R. J. Urick, 《Principles of Underwater Sound》, 3rd ed., McGraw-Hill, 1983.',
    'A. D. Waite, 《Sonar for Practising Engineers》, 3rd ed., Wiley, 2002.',
    'X. Lurton, 《An Introduction to Underwater Acoustics: Principles and Applications》, Springer, 2002.',
    'W. S. Burdic, 《Underwater Acoustic System Analysis》, 2nd ed., Prentice-Hall, 1991.',
    '李启虎, 《声呐信号处理引论》, 海洋出版社, 2000.',
    '田坦、刘国枝、孙大军, 《声呐技术》, 哈尔滨工程大学出版社, 2000.',
    'P. C. Etter, 《Underwater Acoustic Modeling and Simulation》, 4th ed., CRC Press, 2013.',
    'M. A. Richards, 《Fundamentals of Radar Signal Processing》, 2nd ed., McGraw-Hill, 2014.'
  ];

  /* ============================================================
     案例一：主动声呐 LFM 脉冲压缩
     ============================================================= */

  /** 交互仿真：LFM 脉冲压缩 */
  function simPulseCompression(el) {
    const N = 1024;                 // 接收窗样点数
    const R1 = 60;                  // 强目标真实距离 m
    const F0 = 12000;               // 中心频率 Hz
    const st = { snr: -5, T: 50, B: 3000, w: 'hann', sep: 3, v: 0, wdb: -16, rl: 4 };

    const nzR = U.randn(N, 8123), nzI = U.randn(N, 45677);
    const scR = U.randn(N, 22133), scI = U.randn(N, 99731);

    const boxA = UI.plotBox({ title: '脉冲压缩输出：距离剖面（dB，相对峰值）' });
    const boxB = UI.plotBox({ title: '主瓣与旁瓣结构：强目标附近 ±15 m 放大' });
    const pA = P.new(boxA.canvas, { height: 250, xlabel: '距离 / m', ylabel: '幅度 / dB', legend: true });
    const pB = P.new(boxB.canvas, { height: 230, xlabel: '相对强目标的距离 / m', ylabel: '幅度 / dB', legend: true });

    const mBox = h('div.metrics');
    const note = h('div.prose');
    const grid = h('div.grid.g2', {}, [boxA.el, boxB.el]);

    function buildEcho(fs, T, k, alpha, fd, targets) {
      const o = cpx(N);
      for (let q = 0; q < targets.length; q++) {
        const tg = targets[q];
        const tau = 2 * tg.r / CW;
        const tEnd = tau + T / (1 + alpha);
        let n0 = Math.floor(tau * fs) - 2, n1 = Math.ceil(tEnd * fs) + 2;
        if (n0 < 0) n0 = 0;
        if (n1 > N - 1) n1 = N - 1;
        for (let n = n0; n <= n1; n++) {
          const t = n / fs;
          const tt = (1 + alpha) * (t - tau);
          if (tt < 0 || tt > T) continue;
          const ph = Math.PI * k * tt * tt + 2 * Math.PI * fd * t;
          o.re[n] += tg.a * Math.cos(ph);
          o.im[n] += tg.a * Math.sin(ph);
        }
      }
      return o;
    }

    function recalc() {
      const fs = st.B;                       // 复基带采样率取带宽：一个距离单元 = c/(2B)
      const T = st.T / 1000;                 // 脉宽 s
      const M = Math.max(8, Math.round(T * fs));
      const k = st.B / T;                    // 调频斜率 Hz/s
      const alpha = 2 * st.v / CW;           // 时间尺度因子
      const fd = alpha * F0;                 // 多普勒频移 Hz
      const dr = CW / (2 * fs);              // 距离采样间隔 m
      const rAx = new Float64Array(N);
      for (let i = 0; i < N; i++) rAx[i] = i * dr;

      // 发射复包络 u(t) = exp(jπk t²)
      const ur = new Float64Array(M), ui = new Float64Array(M);
      for (let m = 0; m < M; m++) {
        const t = m / fs; const ph = Math.PI * k * t * t;
        ur[m] = Math.cos(ph); ui[m] = Math.sin(ph);
      }
      // 接收端加权（只加在复制信号上）
      const w = C.window(st.w, M, st.w === 'kaiser' ? 6 : undefined);
      const wr = new Float64Array(M), wi = new Float64Array(M);
      for (let m = 0; m < M; m++) { wr[m] = ur[m] * w[m]; wi[m] = ui[m] * w[m]; }

      // 纯净回波（仅强目标，含多普勒）：用于测旁瓣 / 分辨率 / 距离徙动
      const clean = buildEcho(fs, T, k, alpha, fd, [{ r: R1, a: 1 }]);
      // 完整接收：强目标 + 弱目标 + 混响 + 噪声
      const A2 = Math.pow(10, st.wdb / 20);
      const sig = buildEcho(fs, T, k, alpha, fd, [{ r: R1, a: 1 }, { r: R1 + st.sep, a: A2 }]);

      // 混响：散射体（强度随距离衰减）与发射波形卷积
      const gr = new Float64Array(N), gi = new Float64Array(N);
      for (let n = 0; n < N; n++) {
        const env = Math.exp(-n * dr / 120);
        gr[n] = scR[n] * env; gi[n] = scI[n] * env;
      }
      const rev = cconvC({ re: gr, im: gi }, { re: ur, im: ui });
      let prv = 0;
      for (let n = 0; n < N; n++) prv += rev.re[n] * rev.re[n] + rev.im[n] * rev.im[n];
      prv = Math.max(prv / N, 1e-20);
      const pRef = M / N;                                   // 强目标回波在窗内的平均功率
      const sRev = Math.sqrt(pRef * Math.pow(10, st.rl / 10) / prv);

      const sigN = Math.pow(10, -st.snr / 20);              // 噪声标准差
      const x = cpx(N);
      for (let n = 0; n < N; n++) {
        x.re[n] = sig.re[n] + sRev * rev.re[n] + sigN * nzR[n] * Math.SQRT1_2;
        x.im[n] = sig.im[n] + sRev * rev.im[n] + sigN * nzI[n] * Math.SQRT1_2;
      }

      // 匹配滤波（加权 / 不加权 / 纯净）
      const yW = mfC(x, { re: wr, im: wi });
      const y0 = mfC(x, { re: ur, im: ui });
      const yC = mfC(clean, { re: wr, im: wi });

      const mW = magc(yW), m0 = magc(y0), mC = magc(yC);
      const dW = dbNorm(mW), dC = dbNorm(mC);

      // 噪声底：取远端无目标区间
      let i0 = Math.round(180 / dr), i1 = Math.min(mW.length, Math.round(250 / dr));
      let nf = 0, cnt = 0;
      for (let i = i0; i < i1; i++) { nf += mW[i] * mW[i]; cnt++; }
      nf = Math.max(nf / Math.max(cnt, 1), 1e-30);
      let pk = 0, pkIdx = 0;
      for (let i = 0; i < mW.length; i++) if (mW[i] > pk) { pk = mW[i]; pkIdx = i; }
      const snrOut = 10 * Math.log10(pk * pk / nf);

      let pk0 = 0;
      for (let i = 0; i < m0.length; i++) if (m0[i] > pk0) pk0 = m0[i];
      const snrOut0 = 10 * Math.log10(pk0 * pk0 / nf);
      const winLoss = snrOut0 - snrOut;

      const pm = C.pulseMetrics(yC);
      const resM = pm.width3dB * dr;                       // −3 dB 主瓣宽度 → 距离分辨率
      const rMeas = pm.peakIdx * dr;
      const drift = rMeas - R1;
      const driftTh = (CW / 2) * (fd / k);

      // 弱目标是否被强目标旁瓣遮蔽
      const iw = Math.round(2 * (R1 + st.sep) / CW * fs);
      let wk = -1e9;
      for (let i = Math.max(0, iw - 6); i <= Math.min(mW.length - 1, iw + 6); i++) if (dW.db[i] > wk) wk = dW.db[i];
      const iS = Math.round(2 * R1 / CW * fs);
      let sll = -1e9;
      for (let i = 0; i < mW.length; i++) {
        if (Math.abs(i - iS) < 40 || Math.abs(i - iw) < 40) continue;   // 排除两个目标的主瓣区
        if (dW.db[i] > sll) sll = dW.db[i];
      }
      const masked = wk < sll + 3;

      /* ---------- 绘图 ---------- */
      const rArr = []; for (let i = 0; i < mW.length; i++) rArr.push(i * dr);
      const thDb = 10 * Math.log10(nf / (pk * pk)) + 8;     // 噪声底上方 8 dB 的检测门
      pA.clear()
        .add({ x: rArr, y: Array.from(dW.db), type: 'line', color: 0, width: 1.5, label: '脉压输出（' + (st.w === 'rect' ? '矩形' : '加权：' + st.w) + '）' })
        .hline(thDb, { label: '噪声底 + 8 dB', color: '#b45309' })
        .vline(R1, { label: '强目标 ' + R1 + ' m' })
        .vline(R1 + st.sep, { label: '弱目标 ' + (R1 + st.sep).toFixed(1) + ' m', color: '#0f766e' })
        .draw();

      const rel = [], relDb = [], relDbC = [];
      const half = Math.round(15 / dr);
      for (let i = Math.max(0, pkIdx - half); i <= Math.min(mW.length - 1, pkIdx + half); i++) {
        rel.push((i - pkIdx) * dr);
        relDb.push(dW.db[i]);
        relDbC.push(dC.db[i]);
      }
      pB.clear()
        .add({ x: rel, y: relDb, type: 'line', color: 0, width: 1.6, label: '含噪声 / 混响' })
        .add({ x: rel, y: relDbC, type: 'line', color: 2, width: 1.2, dash: [4, 3], label: '纯净回波（旁瓣基线）' })
        .hline(-3, { label: '−3 dB（分辨率）', color: '#b45309' })
        .vline(st.sep, { label: '弱目标 ' + st.sep.toFixed(1) + ' m', color: '#0f766e' })
        .draw();

      /* ---------- 指标 ---------- */
      U.clear(mBox);
      const mets = [
        ['时宽带宽积 BT', (st.B * T).toFixed(0), ''],
        ['处理增益 10lg(BT)', (10 * Math.log10(Math.max(st.B * T, 1e-9))).toFixed(1), 'dB'],
        ['实测输出信噪比', snrOut.toFixed(1), 'dB'],
        ['−3 dB 距离分辨率', resM.toFixed(2), 'm'],
        ['峰值旁瓣 PSL', pm.psl.toFixed(1), 'dB'],
        ['积分旁瓣 ISLR', pm.islr.toFixed(1), 'dB'],
        ['距离徙动（测/理论）', drift.toFixed(2) + ' / ' + driftTh.toFixed(2), 'm'],
        ['加权信噪比损失', winLoss.toFixed(2), 'dB']
      ];
      mets.forEach(m => mBox.appendChild(h('div.metric', {}, [
        h('div.m-l', { text: m[0] }),
        h('div.m-v', { text: m[1] }),
        m[2] ? h('div', {}, h('span.m-u', { text: m[2] })) : null
      ])));

      /* ---------- 动态文字解读 ---------- */
      const wn = st.w === 'rect' ? '矩形（不加窗）' : (st.w === 'hann' ? '汉宁' : (st.w === 'hamming' ? '汉明' : (st.w === 'blackman' ? '布莱克曼' : '凯泽 β=6')));
      const bt = st.B * T;
      note.innerHTML = U.md(
        '**当前状态解读：** 脉宽 ' + st.T.toFixed(0) + ' ms、带宽 ' + (st.B / 1000).toFixed(1) + ' kHz → 时宽带宽积 $BT=' + bt.toFixed(0) +
        '$，理论处理增益 $10\\lg(BT)=' + (10 * Math.log10(bt)).toFixed(1) + '\\,\\text{dB}$，理论距离分辨率 $\\Delta R=c/2B=' +
        (CW / (2 * st.B)).toFixed(2) + '\\,\\text{m}$。仿真实测 −3 dB 主瓣宽度 ' + resM.toFixed(2) + ' m，输出信噪比由输入的 ' +
        st.snr.toFixed(0) + ' dB 提升到 ' + snrOut.toFixed(1) + ' dB —— 提升量正是"把 ' + M + ' 个样点相干加起来"的收益。' +
        (st.w === 'rect'
          ? ' 复制信号未加权，输出就是 LFM 的 $\\mathrm{sinc}$ 状包络：**最高旁瓣只有 −13.3 dB**，距离上每隔约 ' + (CW / (2 * st.B)).toFixed(2) + ' m 就有一串"假目标"。'
          : ' 复制信号加了' + wn + '窗，最高旁瓣压到 ' + pm.psl.toFixed(1) + ' dB，代价是主瓣展宽到 ' + resM.toFixed(2) +
            ' m（约为不加权时的 ' + (resM / (CW / (2 * st.B))).toFixed(2) + ' 倍）并损失 ' + winLoss.toFixed(2) + ' dB 信噪比 —— 这就是教材里常说的"压旁瓣要付 2 dB"。') +
        ' 目标间距 ' + st.sep.toFixed(1) + ' m、弱目标比强目标低 ' + (-st.wdb) + ' dB：弱目标处的输出电平为 ' + wk.toFixed(1) +
        ' dB，而强目标旁瓣背景约 ' + sll.toFixed(1) + ' dB，因此弱目标**' + (masked ? '被旁瓣（或噪声）淹没，单靠加带宽救不回来，必须先压旁瓣' : '可被检测出来') + '**。' +
        ' 径向速度 ' + st.v.toFixed(1) + ' m/s 对应多普勒 $f_d=2vf_0/c=' + fd.toFixed(0) + '\\,\\text{Hz}$，主峰整体平移 ' + drift.toFixed(2) +
        ' m（理论 $\\Delta R=\\tfrac{c}{2}f_d/k=' + driftTh.toFixed(2) + '\\,\\text{m}$），' +
        (Math.abs(drift) > resM ? '**平移已超过一个分辨率单元**：若用固定距离门做脉冲串积累，能量会跨门分散。' : '平移尚在半个分辨率单元内，可直接按距离门积累。')
      );
      UI.renderMathIn(note);
    }

    const sSnr = UI.slider({ label: '输入信噪比', min: -20, max: 20, step: 1, value: st.snr, unit: 'dB', hint: '单个采样点上回波功率与噪声功率之比', onInput: v => { st.snr = v; recalc(); } });
    const sT = UI.slider({ label: '脉宽 T', min: 10, max: 100, step: 5, value: st.T, unit: 'ms', hint: '增大 T：能量增大、处理增益提高，但近距盲区变大、多普勒更敏感', onInput: v => { st.T = v; recalc(); } });
    const sB = UI.slider({ label: '带宽 B', min: 1000, max: 6000, step: 250, value: st.B, unit: 'Hz', hint: '决定距离分辨率 c/2B，同时决定基带采样率', onInput: v => { st.B = v; recalc(); } });
    const sSep = UI.slider({ label: '目标间距', min: 0.5, max: 15, step: 0.5, value: st.sep, unit: 'm', hint: '两目标在距离上的间隔', onInput: v => { st.sep = v; recalc(); } });
    const sWeak = UI.slider({ label: '弱目标强度', min: -40, max: 0, step: 1, value: st.wdb, unit: 'dB', hint: '相对强目标的回波幅度（负值）', onInput: v => { st.wdb = v; recalc(); } });
    const sV = UI.slider({ label: '目标径向速度', min: -15, max: 15, step: 0.5, value: st.v, unit: 'm/s', hint: '正值表示靠近（回波被压缩、多普勒为正）', onInput: v => { st.v = v; recalc(); } });
    const sRl = UI.slider({ label: '混响级（相对回波）', min: -20, max: 20, step: 2, value: st.rl, unit: 'dB', hint: '混响是"被脉压也压不掉"的信号型干扰', onInput: v => { st.rl = v; recalc(); } });
    const selW = UI.select({
      label: '旁瓣加权窗', value: st.w,
      options: [
        { value: 'rect', label: '矩形（不加窗）' },
        { value: 'hann', label: '汉宁（余弦平方）' },
        { value: 'hamming', label: '汉明' },
        { value: 'blackman', label: '布莱克曼' },
        { value: 'kaiser', label: '凯泽 β=6' }
      ],
      onChange: v => { st.w = v; recalc(); }
    });

    el.appendChild(UI.ctrlPanel('仿真参数（拖动即实时重算）', [sSnr, sT, sB, sSep, sWeak, sV, sRl, selW]));
    el.appendChild(grid);
    el.appendChild(mBox);
    el.appendChild(h('div.plot-cap', { html: U.md('左图：整段距离剖面与检测门限；右图：强目标附近 ±15 m 的细节，实线含噪声与混响，虚线为纯净回波的旁瓣基线。横轴一个采样间隔即 $c/2B$。') }));
    el.appendChild(note);
    recalc();
  }

  doc.register('cases/sonar/pulse-compression', {
    title: '案例一：主动声呐 LFM 脉冲压缩',
    lede: '12 kHz 中心频率、3 kHz 带宽、50 ms 脉宽——这组典型舰壳声呐参数给出 21.8 dB 处理增益与 25 cm 距离分辨率。本节按真实装备的处理链路走一遍，并把"压旁瓣要付 2 dB""距离-多普勒耦合"这两笔账算清楚。',
    tags: ['水声', '主动声呐', '脉冲压缩', '匹配滤波'],
    labs: [{ path: 'lab/matched', title: '匹配滤波与脉冲压缩实验台', desc: '拖动脉宽/带宽/窗函数，实测处理增益、PSL 与主瓣宽度' }],
    toc: true,
    sections: [
      {
        id: 'bg', num: '1', title: '工程背景：这个任务在装备里是什么',
        blocks: [
          { t: 'md', md: '舰壳声呐、拖曳式主动阵、鱼雷自导头、航空吊放声呐、声呐浮标——凡是"自己发射、自己接收"的那一路，今天几乎都在用线性调频（LFM）脉冲加匹配滤波。原因很直白：**作用距离要能量，距离分辨率要带宽，而发射机峰值功率受换能器与空化限制**。LFM 用一个长脉冲把能量堆够，再在接收端把它"压"成一个窄脉冲把带宽找回，是唯一能同时满足两者的办法。' },
          { t: 'md', md: '以一型中频舰壳声呐为例，典型参数与指标压力如下。注意其中的张力：每一项指标都不是"越大越好"，而是彼此打架。' },
          { t: 'table', cols: ['项目', '典型取值', '为什么是这个数'], rows: [
            ['中心频率 $f_0$', '8～15 kHz（本例 12 kHz）', '吸收损失随频率急剧上升，远程探测只能用低频；但低频换能器尺寸大、带宽窄'],
            ['带宽 $B$', '2～5 kHz（本例 3 kHz）', '直接决定距离分辨率 $\\Delta R=c/2B$；受换能器可用带宽限制'],
            ['脉宽 $T$', '20～200 ms（本例 50 ms）', '决定脉冲能量与处理增益；同时决定近距盲区 $R_{\\min}=cT/2$'],
            ['时宽带宽积 $BT$', '100～300（本例 150）', '处理增益 $=10\\lg(BT)$，本例 21.8 dB'],
            ['发射声源级', '210～220 dB', '受换能器空化阈值与阵列尺寸限制，不能随便加'],
            ['脉冲重复周期', '1～6 s', '由最大作用距离 $R_{\\max}=cT_r/2$ 决定，远程要几秒才不产生距离模糊'],
            ['海况', '3～6 级', '海面散射强度随风速上升，混响级随之抬高；高海况下平台自噪声也上升'],
            ['平台自噪声', '螺旋桨空化 + 流噪声', '本舰航速每提高几节，自噪声可抬升十几 dB，直接吞掉处理增益']
          ] },
          { t: 'metrics', list: [
            { label: '处理增益', value: '21.8', unit: 'dB（BT=150）' },
            { label: '距离分辨率', value: '0.25', unit: 'm（c/2B）' },
            { label: '近距盲区', value: '37.5', unit: 'm（cT/2）' },
            { label: '脉冲能量（相对 CW）', value: '150', unit: '倍（时长 ×150）' }
          ] },
          { t: 'callout', kind: 'eng', title: '工程师视角：混响限制还是噪声限制', md: '声呐方程里分母有两项：**海洋环境噪声**与**混响**。深海垂直发射、海底平坦时通常是噪声限制，加大发射功率就有效；**浅海水平发射几乎必然是混响限制**——加大发射功率，回波和混响同时变强，信噪比一点都不改善。这时真正有用的是：提高距离分辨率（增大 B，让每个分辨单元里的混响体积变小）、降低旁瓣、用多普勒把运动目标从静止混响里分离出来。先判断自己属于哪一种体制，再决定改进方向。' }
        ]
      },
      {
        id: 'model', num: '2', title: '信号模型：发射波形、信道与接收信号',
        blocks: [
          { t: 'md', md: '发射的实信号是载频 $f_0$ 上的线性调频脉冲，在一个脉宽内瞬时频率从 $f_0-B/2$ 线性扫到 $f_0+B/2$：' },
          { t: 'math', tex: 's_p(t) = a(t)\\,\\cos\\!\\left[2\\pi f_0 t + \\pi k t^2\\right],\\quad a(t)=\\mathrm{rect}\\!\\left(\\frac{t}{T}\\right),\\quad k=\\frac{B}{T}\\ \\text{(Hz/s)}', tag: '(1)' },
          { t: 'md', md: '工程上做处理时一律用**复包络（基带）**表示，把载频搬掉，只在 $|f|\\le B/2$ 的带宽里工作，采样率可以从 $2(f_0+B/2)$ 降到 $B$ 量级：' },
          { t: 'math', tex: 'u(t) = \\exp\\!\\left(j\\pi k t^{2}\\right),\\quad 0\\le t\\le T;\\qquad s_p(t)=\\Re\\!\\left\\{u(t)e^{j2\\pi f_0 t}\\right\\}', tag: '(2)' },
          { t: 'md', md: '信道要算三笔账：**传播损失**（扩展损失 $20\\lg R$ 加吸收损失 $\\alpha R$，$\\alpha$ 在 12 kHz 约 1 dB/km 量级）、**多径**（海面与海底反射形成多途，浅海可多达十几条途径，直达声与多途在时间上分离或重叠）、**多普勒**（目标径向速度 $v$ 使回波在时间轴上被压缩或拉伸，尺度因子 $\\eta = 1+2v/c$，同时引入载频偏移 $f_d = 2vf_0/c$）。' },
          { t: 'md', md: '于是接收端的复基带信号可以写成下面这个"标准教科书模型"，本节后面所有仿真都由它生成：' },
          { t: 'math', tex: 'r(t) = \\sum_i A_i\\,u\\!\\big(\\eta_i(t-\\tau_i)\\big)\\,e^{j2\\pi f_{d,i} t} \\;+\\; \\underbrace{\\sum_m \\rho_m u(t-\\tau_m)}_{\\text{混响（散射体叠加）}} \\;+\\; n(t),\\quad \\tau_i=\\frac{2R_i}{c}', tag: '(3)' },
          { t: 'kv', title: '变量说明', pairs: [
            ['$A_i$', '第 $i$ 个目标的回波复幅度，含目标强度、传播损失与指向性响应'],
            ['$\\tau_i = 2R_i/c$', '双程时延；距离 $R_i$ 与时延的换算系数是 $c/2$，不是 $c$'],
            ['$\\eta_i = 1 + 2v_i/c$', '时间尺度因子（宽带模型）。$v>0$ 表示接近，回波被压缩'],
            ['$f_{d,i} = 2 v_i f_0/c$', '载频多普勒。对 12 kHz、10 m/s：$f_d = 160\\,\\text{Hz}$，达中心频率的 1.33%'],
            ['$\\rho_m$', '第 $m$ 个散射体的复散射系数，混响是大量散射体回波的叠加'],
            ['$n(t)$', '海洋环境噪声 + 平台自噪声 + 接收机热噪声，通常建模为带限高斯']
          ] },
          { t: 'callout', kind: 'pit', title: '坑：把 $n(t)$ 当成唯一的干扰', md: '式 (3) 里第二项（混响）与第三项（噪声）性质完全不同：噪声是加性的、与发射无关，加大发射功率就能压下去；混响是**发射信号本身的回波**，与信号相关，会被匹配滤波同样地压缩，加大功率毫无用处。很多初学者按噪声限制的思路做链路预算，结果实机指标差 10 dB 以上——因为在浅海，分母里几乎全是混响。' },
          { t: 'fold', summary: '展开：为什么要写成 $\\eta(t-\\tau)$ 而不是 $t-\\tau$（宽带 vs 窄带）', deriv: true, blocks: [
            { t: 'md', md: '若目标以径向速度 $v$ 运动，第 $n$ 个发射脉冲的回波时延 $\\tau(t)=2(R_0-vt)/c$ 随时间变化，回波波形因此被整体压缩（接近）或拉伸（远离），压缩比为' },
            { t: 'math', tex: 'r_p(t)=s_p\\!\\big(\\eta\\,(t-\\tau_0)\\big),\\qquad \\eta = 1+\\frac{2v}{c}' },
            { t: 'md', md: '在脉宽 $T$ 内，波形首尾的时延差为 $\\Delta = (\\eta-1)T = 2vT/c$。若 $\\Delta \\ll 1/B$（即 $2vBT/c \\ll 1$），压缩效应不可分辨，可退化为"纯延迟 + 载频频移"的窄带模型 $r(t)\\approx u(t-\\tau)e^{j2\\pi f_d t}$。判据：**$2v/c \\cdot BT \\ll 1$**。本例 $BT=150$，临界速度 $v \\approx c/(2BT) = 5\\,\\text{m/s}$（约 10 节）——**这是一个很容易被突破的门槛**，所以宽带声呐必须用尺度补偿而不是简单频移（详见案例五）。' }
          ] }
        ]
      },
      {
        id: 'algo', num: '3', title: '算法原理回顾：匹配滤波、加权与耦合',
        blocks: [
          { t: 'md', md: '匹配滤波的冲击响应是"共轭翻转"的复制信号，输出是接收信号与参考波形的相关函数，等价于在距离维做卷积：' },
          { t: 'math', tex: 'y(\\tau) = \\int r(t)\\,u^{*}(t-\\tau)\\,dt \\;=\\; \\mathcal{F}^{-1}\\!\\left\\{R(f)\\,U^{*}(f)\\right\\}', tag: '(4)' },
          { t: 'md', md: '三条必须记住的结论：' },
          { t: 'md', md: '① **白噪声下输出信噪比最大**，改善量 $=10\\lg(BT)$：本例 150 倍 → 21.8 dB。这就是"长脉冲换能量"能成立的原因。\n② **输出是模糊函数在 $(\\tau, f_d)$ 处的一个切片**：无多普勒失配时是 LFM 的自相关，主瓣宽约 $1/B$，旁瓣呈 $\\mathrm{sinc}$ 衰减，第一旁瓣只有 −13.3 dB。\n③ **多普勒失配会让主瓣平移加展宽**：这就是距离-多普勒耦合。' },
          { t: 'math', tex: '\\Delta R = \\frac{c}{2}\\cdot\\frac{f_d}{k} = \\frac{c}{2}\\cdot\\frac{f_d T}{B},\\qquad f_d=\\frac{2vf_0}{c}', tag: '(5)' },
          { t: 'md', md: '代入本例：$B=3\\,\\text{kHz}$、$T=50\\,\\text{ms}$ → $k=6\\times10^4\\,\\text{Hz/s}$；目标速度 10 m/s → $f_d=160\\,\\text{Hz}$ → $\\Delta R = 750\\times 160/60000 = 2.0\\,\\text{m}$。也就是说：**目标每运动 10 m/s，测距就偏 2 m**，是分辨率单元的 8 倍。好消息是平移量可预测、可补偿；坏消息是它随 $T/B$ 增大，大时宽带宽积波形对多普勒更敏感。' },
          { t: 'fold', summary: '展开：LFM 匹配滤波输出的主瓣与旁瓣是怎么算出来的', deriv: true, blocks: [
            { t: 'md', md: '把基带 LFM $u(t)=e^{j\\pi k t^2}\\mathrm{rect}(t/T)$ 与自身相关，忽略边缘项，用驻定相位法或 Fresnel 积分可得' },
            { t: 'math', tex: '|y(\\tau)| \\approx \\left|\\frac{\\sin\\!\\left(\\pi B \\tau (1-|\\tau|/T)\\right)}{\\pi B \\tau}\\right|,\\quad |\\tau|\\le T' },
            { t: 'md', md: '分子在 $\\tau$ 很小时为主瓣：第一个零点在 $\\tau = 1/B$，故 −3 dB 宽度约 $0.886/B$，对应距离 $0.886\\,c/(2B)$；工程上直接写 $\\Delta R \\approx c/(2B)$。分母 $\\propto 1/(\\pi B\\tau)$ 说明旁瓣只按 $1/\\tau$ 衰减，**第一旁瓣电平为 $\\mathrm{sinc}$ 的 −13.26 dB，与 $BT$ 无关**——这是 LFM 的固有缺陷。要压旁瓣只能加窗（频域加权），代价见下表。' },
            { t: 'table', cols: ['加权窗', '最高旁瓣 PSL', '信噪比损失', '主瓣展宽系数', '适用'], rows: [
              ['矩形（不加窗）', '−13.3 dB', '0 dB', '1.00', '只测单个强目标、不怕假目标'],
              ['汉宁（余弦平方）', '−31 dB 左右', '≈1.8 dB', '≈1.6', '通用首选，弱目标检测'],
              ['汉明', '−43 dB 左右', '≈1.3 dB', '≈1.5', '性价比最高的常用窗'],
              ['布莱克曼', '−58 dB 左右', '≈2.4 dB', '≈1.9', '强目标附近有弱目标时'],
              ['凯泽 β=6', '−50～−60 dB', '≈2 dB', '≈1.7', '可按 β 连续调节旁瓣与损失']
            ] }
          ] },
          { t: 'callout', kind: 'tip', title: '与知识库的对应关系', md: '匹配滤波的一般理论与最优性证明见「随机信号与相关」一节的匹配滤波部分，脉冲压缩指标（PSL / ISLR / 主瓣宽度）的实测方法见实验台 `lab/matched`；窗函数的旁瓣与等效噪声带宽数据见「窗函数」一节。本节只在工程语境下使用这些结论，不重复推导。' }
        ]
      },
      {
        id: 'chain', num: '4', title: '完整处理链路：从换能器到显示器',
        blocks: [
          { t: 'md', md: '下面是一台真实主动声呐接收机的纵向链路。每一级都标了输入、输出与关键参数——**工程调试时出问题，99% 都能定位到其中某一级**。' },
          { t: 'flow', v: true, items: [
            { t: '① 发射机与发射换能器', d: '输入：波形参数 $(f_0,B,T,\text{锥角})$；输出：声源级 $SL\\approx 215\\,\\text{dB}$。关键：换能器带内起伏 ≤ ±1.5 dB、发射机非线性产生的谐波与互调要低于 −30 dB' },
            { t: '② 海洋信道', d: '输入：声源级；输出：目标处声压。关键：传播损失 $TL=20\\lg R+\\alpha R$、多途结构、声速剖面导致的声线弯曲、海面/海底散射（混响源）' },
            { t: '③ 接收换能器（阵）与前置放大', d: '输入：µV 级信号 + 混响 + 噪声；输出：V 级。关键：**灵敏度 −180 dB 左右**、本舰自噪声隔离、前置放大器噪声系数、动态范围（近距回波比远距强 60 dB 以上）' },
            { t: '④ 时变增益 TVG', d: '输入：随距离剧烈变化的回波；输出：动态范围压缩后的信号。关键：$TVG = 40\\lg R + 2\\alpha R$（或工程上简化为 $30\\lg R$）；**起点时刻与斜率设错会直接毁掉整条链路**' },
            { t: '⑤ 抗混叠滤波 + 模数转换', d: '输入：模拟宽带信号；输出：数字流。关键：带通采样时 $f_s$ 要同时满足带宽与不混叠条件；位数 ≥ 14 bit（动态范围 84 dB 以上）；通道间幅相一致性' },
            { t: '⑥ 数字下变频（正交解调）', d: '输入：中频/射频采样；输出：复基带 $I/Q$。关键：混频 + 低通 + 抽取；**$I/Q$ 幅度不平衡与相位正交误差要校准到 −40 dBc 镜像以下**，否则会出现假目标' },
            { t: '⑦ 匹配滤波 / 脉冲压缩', d: '输入：复基带；输出：距离剖面。关键：频域实现 $Y=\\mathrm{FFT}(r)\\cdot U^*$、参考波形是否加权、是否做多普勒多路并行（速度滤波器组）' },
            { t: '⑧ 检波、归一化与检测', d: '输入：距离剖面；输出：检测点。关键：取包络 → 恒虚警（CFAR）门限（单元平均或有序统计）→ 时间累积与航迹起始' },
            { t: '⑨ 显示与后处理', d: '输入：检测点；输出：A 显/B 显/瀑布图。关键：距离-方位-时间三维显示、自动跟踪、与目标运动分析（TMA）接口' }
          ] },
          { t: 'code', lang: 'python', title: '脉冲压缩核心（频域实现，可直接跑在真实数据上）', src: 'import numpy as np\n\n# r: 复基带回波 (N,)；u: 发射复包络 (M,)；win: 加权窗\ndef pulse_compress(r, u, win=None, nfft=None):\n    M = len(u)\n    if win is None:\n        win = np.hanning(M)          # 接收端加权：压旁瓣，付约 1.8 dB\n    hw = u * win\n    N = nfft or (len(r) + M - 1)\n    H = np.fft.fft(hw, N)\n    Y = np.fft.fft(r, N) * np.conj(H)\n    y = np.fft.ifft(Y)[:len(r) + M - 1]\n    return y                          # 峰值位置 n → 距离 R = n * c / (2 * fs)\n\n# 指标：PSL / ISLR / -3 dB 宽度\ndef metrics(y):\n    a = np.abs(y); a /= a.max()\n    db = 20 * np.log10(a + 1e-12)\n    pk = int(np.argmax(a))\n    # 主瓣零点：从峰值向两侧找到第一个局部极小\n    r = pk\n    while r + 1 < len(a) and not (db[r] < db[r-1] and db[r] <= db[r+1] and db[r] < -20):\n        r += 1\n    psl = db[r+2:].max() if r + 2 < len(db) else -99.0\n    main = (np.abs(a) ** 2)[max(0, pk-(r-pk)): pk+(r-pk)+1].sum()\n    islr = 10 * np.log10((np.abs(a) ** 2).sum() / main)\n    return dict(psl=psl, islr=islr, w3db=np.sum(a >= a.max()/np.sqrt(2)))\n' }
        ]
      },
      {
        id: 'sim', num: '5', title: '交互仿真：拖参数看脉压输出、旁瓣与距离徙动',
        blocks: [
          { t: 'md', md: '下面这台仿真器完全按式 (3) 生成回波：强目标固定在 60 m（幅度 1），弱目标在其后 `sep` 米处（幅度可调），再叠加**随距离衰减的散射体混响**（与发射波形卷积，因此也会被脉压）和复高斯噪声。基带采样率取 $f_s=B$，于是**一个采样点就是一个分辨率单元 $c/2B$**。请重点做三组对照实验：' },
          { t: 'md', md: '① **窗函数对照**：把窗从矩形切到汉宁/布莱克曼，看右图旁瓣从 −13 dB 掉到 −40 dB 以下，同时看指标卡里"加权信噪比损失"从 0 涨到 2 dB 上下、主瓣从 0.25 m 展宽到 0.45 m 左右——这就是分辨率与旁瓣的直接交换。\n② **强弱目标遮蔽**：固定窗为矩形，把目标间距拉到 2 m、弱目标强度设为 −25 dB，弱目标完全消失；再切到布莱克曼窗，它立刻从旁瓣里冒出来。**距离分辨率 $c/2B$ 只告诉你主瓣多宽，不保证两个目标能分开**——真正决定"能否分开"的是旁瓣电平。\n③ **距离-多普勒耦合**：拖径向速度到 +10 m/s，看左图主峰整体右移约 2 m（指标卡给出实测值与理论值 $\\Delta R=\\tfrac{c}{2}f_d/k$ 的对照），并且主峰略有展宽、峰值下降。' },
          { t: 'widget', render: function (el) { simPulseCompression(el); } },
          { t: 'callout', kind: 'note', title: '为什么输出信噪比常常达不到 21.8 dB', md: '仿真里"实测输出信噪比 = 输入信噪比 + 21.8 dB − 加权损失"只有在**噪声是白的、且没有混响**时才成立。把混响级拖到 +15 dB 再看：混响也被匹配滤波压缩，输出底噪不再平坦，而是出现一片片"假目标"似的尖峰，检测门限被迫抬高，实际增益远低于理论值。' }
        ]
      },
      {
        id: 'limit', num: '6', title: '工程局限与实际难题',
        blocks: [
          { t: 'table', cols: ['难题', '机理', '典型后果', '工程对策'], rows: [
            ['混响主导而非噪声主导', '混响与信号相关，同样被压缩', '加大功率无效；虚警集中在近距与海底方向', '提高 B（缩小分辨单元体积）、压旁瓣、用多普勒分离、选掠射角'],
            ['海底混响的多普勒展宽', '海底静止但平台在动，散射回波被平台速度调制', '零多普勒附近出现宽谱"混响墙"，慢速目标检测不到', '平台速度补偿、零多普勒凹槽滤波、空时自适应处理'],
            ['发射机非线性', '功率放大器饱和产生谐波与互调，波形幅度被削顶', '实际波形与理想 LFM 失配，旁瓣抬高 5～10 dB', '功放回退（back-off）+ 预失真；用实测录波做参考波形'],
            ['换能器带内起伏', '带内幅频响应不平坦（±2 dB 很常见）', '匹配滤波失配，主瓣展宽、旁瓣抬高', '用换能器实测响应修正参考波形，或加带内均衡滤波器'],
            ['多径与多途', '海面/海底反射造成同波形多次到达', '一个目标变多个"假目标"，测距出现系统性偏移', '多途建模与匹配追踪、利用垂直指向性抑制海面/海底途径'],
            ['TVG 设置错误', '增益随距离上升过快或过慢', '近距回波削波（ADC 溢出，产生大量谐波假目标）；远距信号被量化噪声淹没', '按 $40\\lg R+2\\alpha R$ 设计并用实测回波校准；加限幅保护与溢出告警'],
            ['多普勒容限 vs 距离精度', '增大 $T/B$ 提高增益与耦合量', '大 $BT$ 波形对速度敏感，未补偿时主峰掉 3～10 dB', '多普勒滤波器组（并行多路复制相关）或先估计速度再补偿'],
            ['距离模糊与盲区', '脉冲重复周期与脉宽的限制', '远程回波落在下一个周期里被当成近距目标；发射期间不能接收', '按 $R_{\\max}$ 选重复周期；用多周期编码或脉冲串解模糊']
          ] },
          { t: 'callout', kind: 'pit', title: '坑：把 $c/2B$ 当成"两个目标一定能分开"的最小间距', md: '$\\Delta R = c/2B$ 是**单个点目标主瓣的 −3 dB 宽度**。两个目标能否分辨，取决于弱目标处的输出电平是否高于强目标在该处的旁瓣（或噪声/混响）：强目标比弱目标强 30 dB 时，即使间距有 10 个分辨率单元，弱目标仍然躺在 −13 dB 旁瓣的包络里出不来。**先压旁瓣，再谈分辨率**——这也是为什么实用声呐几乎无一例外地加了窗。' },
          { t: 'callout', kind: 'eng', title: '工程师视角：参考波形要用"录下来的"，不要用"算出来的"', md: '教科书上匹配滤波的参考是理想 LFM。实机上，发射机非线性、换能器带内起伏、匹配网络、TVG 与抗混叠滤波器的相位特性，全都串在"实际发射波形"里。**正规做法是在发射耦合端接一个校准通道，把真实发射波形录下来作为匹配滤波的参考**，这一条往往能带来 2～4 dB 的实际增益，比调算法划算得多。同理，$I/Q$ 通道的幅度不平衡与相位正交误差必须定期校准，否则镜像频率会造出对称的假目标。' }
        ]
      },
      {
        id: 'sum', num: '7', title: '小结与配套实验台',
        blocks: [
          { t: 'md', md: '记住这张"账本"：处理增益 $=10\\lg(BT)$（本例 21.8 dB，是能量的账）；距离分辨率 $=c/2B$（本例 0.25 m，是带宽的账）；压旁瓣付 1.3～2.4 dB 并把主瓣展宽 1.5～2 倍（是旁瓣的账）；距离徙动 $=\\tfrac{c}{2}f_d T/B$（本例 10 m/s → 2 m，是多普勒的账）。四笔账彼此独立，调一个必然动另一个——**所谓波形设计，就是在这四笔账之间按任务做取舍**。' },
          { t: 'lab', item: { path: 'lab/matched', title: '匹配滤波与脉冲压缩实验台', desc: '在不同波形与窗函数下实测处理增益、PSL、ISLR 与主瓣宽度' } },
          { t: 'chips', list: ['LFM 脉冲压缩', '匹配滤波', '距离-多普勒耦合', '旁瓣加权', '混响限制', 'TVG'], cls: 'teal' }
        ]
      }
    ],
    refs: REFS
  });

  /* ============================================================
     案例二：被动声呐谱检测与线谱提取
     ============================================================= */

  /** 一维中位数（小数组，排序实现） */
  function median(a) {
    const b = Array.from(a).sort((x, y) => x - y);
    const n = b.length;
    return n === 0 ? 0 : (n % 2 ? b[(n - 1) / 2] : 0.5 * (b[n / 2 - 1] + b[n / 2]));
  }

  /** 交互仿真：LOFAR 谱 + DEMON 谱 + 线谱检测判决 */
  function simPassive(el) {
    const FS = 2000;                       // 被动声呐低频段采样率
    const st = { snr: 8, fsh: 4.2, nb: 5, T: 12, kn: 8, mov: 'steady' };

    const boxL = UI.plotBox({ title: 'LOFAR 功率谱（Welch 平均，26 s 数据 → 4096 点分段）' });
    const boxD = UI.plotBox({ title: 'DEMON 包络谱（解调谱，提取轴频 / 叶频）' });
    const pL = P.new(boxL.canvas, { height: 250, xlabel: '频率 / Hz', ylabel: '谱级 / dB', legend: false });
    const pD = P.new(boxD.canvas, { height: 250, xlabel: '调制频率 / Hz', ylabel: '谱级 / dB', legend: false });
    const hmBox = UI.plotBox({ title: 'LOFAR 时频图（前 8 s，检验线谱时间稳定度）' });

    const mBox = h('div.metrics');
    const note = h('div.prose');
    const grid = h('div.grid.g2', {}, [boxL.el, boxD.el]);

    function recalc() {
      const n = Math.round(st.T * FS);
      const toneA = Math.pow(10, st.snr / 20);
      const driftK = st.mov === 'maneuver' ? 0.006 : (st.mov === 'uniform' ? 0.0008 : 0);
      const bbDb = st.kn * 0.9;                              // 流噪声随航速抬升（工程近似）
      const bbA = Math.pow(10, bbDb / 20) * 0.12;

      /* ---------- 1. 合成舰船辐射噪声 ---------- */
      const w1 = U.randn(n, 5551), w2 = U.randn(n, 7772);
      const x = new Float64Array(n);
      let p1 = 0, p2 = 0;
      for (let i = 0; i < n; i++) {
        const t = i / FS;
        p1 += 2 * Math.PI * st.fsh * (1 + driftK * t) / FS;          // 轴频相位（含漂移）
        p2 += 2 * Math.PI * st.fsh * st.nb * (1 + driftK * t) / FS;  // 叶频相位
        const mod = 1 + 0.65 * Math.cos(p2) + 0.25 * Math.cos(p1);   // 叶频调幅 + 轴频调幅
        const bb = (w1[i] + 0.35 * w2[i]) * mod;                      // 宽带连续谱
        let ton = 0;
        for (let hh = 1; hh <= 4; hh++) ton += Math.sin(hh * p1 + 0.7 * hh) / (hh * hh);
        ton += 0.9 * Math.sin(p2 + 1.1);                              // 叶频线谱
        x[i] = bbA * bb + toneA * ton;
      }

      /* ---------- 2. LOFAR：Welch 平均周期图 ---------- */
      const lof = C.pwelch(x, { segLen: 4096, overlap: 0.5, win: 'hann', fs: FS });
      const ldb = C.psdDb(lof.psd);

      /* ---------- 3. DEMON：带通 → 包络 → 再谱分析 ---------- */
      const L = C.nextPow2(n);
      const re = new Float64Array(L), im = new Float64Array(L);
      for (let i = 0; i < n; i++) re[i] = x[i];
      C.fftInPlace(re, im, false);
      const fax = C.fftFreq(L, FS);
      for (let i = 0; i < L; i++) {
        const f = Math.abs(fax[i]);
        if (f < 400 || f > 900) { re[i] = 0; im[i] = 0; }             // 只留空化带
      }
      C.fftInPlace(re, im, true);
      const dec = 10, nd = Math.floor(n / dec), fD = FS / dec;        // 包络采样率 200 Hz
      const env = new Float64Array(nd);
      for (let i = 0; i < nd; i++) {
        const j = i * dec;
        let sr = 0, si = 0;
        for (let q = 0; q < dec; q++) {                               // 抽取前平滑抗混叠
          const k2 = j + q;
          sr += re[k2]; si += im[k2];
        }
        env[i] = Math.sqrt(sr * sr + si * si) / dec;
      }
      let em = 0;
      for (let i = 0; i < nd; i++) em += env[i];
      em /= nd;
      for (let i = 0; i < nd; i++) env[i] -= em;                      // 去均值（去直流分量）
      const dem = C.pwelch(env, { segLen: 1024, overlap: 0.5, win: 'hann', fs: fD, nfft: 2048 });
      const ddb = C.psdDb(dem.psd);

      /* ---------- 4. LOFAR 时频图（前 8 s） ---------- */
      const n2 = Math.min(n, 8 * FS);
      const ST = C.stft(x.slice(0, n2), { winLen: 1024, hop: 512, win: 'hann', fs: FS });
      let smax = -1e9;
      for (let i = 0; i < ST.S.length; i++) if (ST.S[i] > smax) smax = ST.S[i];

      /* ---------- 5. 线谱检测：中值门限 + 峰值 + 稳定度 ---------- */
      const med = median(ldb);
      const thr = med + 9;
      const peaks = [];
      for (let i = 3; i < ldb.length - 3; i++) {
        if (ldb[i] < thr) continue;
        let isPk = true;
        for (let q = -3; q <= 3; q++) if (q !== 0 && ldb[i + q] > ldb[i]) isPk = false;
        if (isPk && (peaks.length === 0 || lof.f[i] - peaks[peaks.length - 1].f > 3)) {
          peaks.push({ f: lof.f[i], db: ldb[i] });
        }
      }
      // 时间稳定度：该频点超过"帧内中值 + 6 dB"的帧占比
      const binHz = FS / ST.nfft;
      peaks.forEach(pk => {
        const bi = Math.round(pk.f / binHz);
        let ok = 0, tot = 0;
        for (let m = 0; m < ST.frames; m++) {
          let fm = 0, cn = 0;
          for (let q = -4; q <= 4; q++) {
            const b2 = bi + q;
            if (b2 >= 0 && b2 < ST.bins) { fm += ST.S[m * ST.bins + b2]; cn++; }
          }
          fm /= Math.max(cn, 1);
          tot++;
          if (ST.S[m * ST.bins + bi] > fm + 6) ok++;
        }
        pk.stab = ok / tot;
      });
      const good = peaks.filter(pk => pk.stab > 0.6);

      // DEMON 谱线检测
      const dmed = median(ddb);
      const dpeaks = [];
      for (let i = 3; i < ddb.length; i++) {
        const f = dem.f[i];
        if (f > 60 || f < 1) continue;
        if (ddb[i] < dmed + 10) continue;
        let isPk = true;
        for (let q = -3; q <= 3; q++) if (q !== 0 && ddb[i + q] > ddb[i]) isPk = false;
        if (isPk && (dpeaks.length === 0 || f - dpeaks[dpeaks.length - 1] > 1.5)) dpeaks.push(f);
      }

      /* ---------- 6. 绘图 ---------- */
      const lf = [], ld = [];
      for (let i = 0; i < ldb.length; i++) {
        if (lof.f[i] > 1000) break;
        lf.push(lof.f[i]); ld.push(ldb[i]);
      }
      pL.clear()
        .add({ x: lf, y: ld, type: 'line', color: 0, width: 1.3 })
        .hline(thr, { label: '检测门限（中值 + 9 dB）', color: '#b45309' });
      good.forEach(pk => pL.vline(pk.f, { label: pk.f.toFixed(1) + ' Hz', color: '#0f766e' }));
      pL.draw();

      const df = [], dd = [];
      for (let i = 0; i < ddb.length; i++) {
        if (dem.f[i] > 60) break;
        df.push(dem.f[i]); dd.push(ddb[i]);
      }
      pD.clear()
        .add({ x: df, y: dd, type: 'line', color: 1, width: 1.3 })
        .vline(st.fsh, { label: '轴频 ' + st.fsh.toFixed(1), color: '#7c3aed' })
        .vline(st.fsh * st.nb, { label: '叶频 ' + (st.fsh * st.nb).toFixed(1), color: '#b91c1c' });
      pD.draw();

      P.heatmap(hmBox.canvas, {
        data: ST.S, cols: ST.frames, rows: ST.bins,
        xlim: [ST.t[0], ST.t[ST.frames - 1]], ylim: [0, 500],
        vmin: smax - 40, vmax: smax, flipY: true,
        xlabel: '时间 / s', ylabel: '频率 / Hz', height: 220,
        title: '线谱轨迹：稳定水平线 = 良好积分对象，弯曲 = 目标机动'
      });

      /* ---------- 7. 指标与判决 ---------- */
      U.clear(mBox);
      const stabTxt = good.length ? (good[0].stab * 100).toFixed(0) : '—';
      [
        ['频率分辨率', (FS / 4096).toFixed(2), 'Hz'],
        ['Welch 段数 K', String(Math.round((n - 4096) / 2048) + 1), '段'],
        ['检测到线谱', String(good.length), '条'],
        ['最稳线谱稳定度', stabTxt, '%'],
        ['DEMON 谱线数', String(dpeaks.length), '条'],
        ['轴频（设定）', st.fsh.toFixed(2), 'Hz'],
        ['叶频（轴频×叶数）', (st.fsh * st.nb).toFixed(2), 'Hz'],
        ['判决', good.length >= 2 ? '检测 + 初识别' : (good.length === 1 ? '仅检测' : '未检出'), '']
      ].forEach(m => mBox.appendChild(h('div.metric', {}, [
        h('div.m-l', { text: m[0] }),
        h('div.m-v', { text: m[1] }),
        m[2] ? h('div', {}, h('span.m-u', { text: m[2] })) : null
      ])));

      /* ---------- 8. 动态文字解读 ---------- */
      const det = good.map(pk => pk.f.toFixed(1)).join('、') || '无';
      const exp = [st.fsh, 2 * st.fsh, 3 * st.fsh, 4 * st.fsh, st.fsh * st.nb].map(v => v.toFixed(1)).join('、');
      note.innerHTML = U.md(
        '**当前状态解读：** 积分时间 ' + st.T.toFixed(0) + ' s、采样率 ' + (FS / 1000).toFixed(0) + ' kHz，4096 点加 50% 重叠共分 ' +
        Math.round((n - 4096) / 2048) + ' 段做 Welch 平均，频率分辨率 $\\Delta f = f_s/N = ' + (FS / 4096).toFixed(2) +
        '\\,\\text{Hz}$，平均把谱估计的方差压低约 $10\\lg K \\approx ' + (10 * Math.log10(Math.max(1, (n - 4096) / 2048))).toFixed(0) +
        '\\,\\text{dB}$。LOFAR 谱上超过中值门限 9 dB 且时间稳定度大于 60% 的线谱共 ' + good.length + ' 条（' + det +
        '），理论期望位置为 ' + exp + ' Hz（轴频 1～4 次谐波与叶频）。' +
        (st.mov === 'maneuver'
          ? ' 目标机动使线谱以 $\\pm' + (0.6 * st.fsh).toFixed(1) + '\\,\\text{Hz}$ 量级漂移（时频图上呈弯曲轨迹），单根谱线在 4096 点内扫过多个频点，**能量被摊薄、长积分失效**——此时应改用短积分 + 轨迹关联（或先做运动补偿再积分）。'
          : (driftK > 0
            ? ' 匀速目标有微小多普勒，谱线略展宽但仍在频点内，积分有效。'
            : ' 目标静止时谱线锐利，积分收益最大。')) +
        ' DEMON 通道在 400～900 Hz 空化带取包络再做谱分析，检测到 ' + dpeaks.length + ' 条调制谱线：包络谱只关心"调制频率"（十几赫兹量级），对载波频率不敏感，因此**轴频/叶频的估计精度由包络谱的分辨率决定（' + (fD / 1024).toFixed(2) + ' Hz），比直接在 LOFAR 上分辨低频线谱容易得多**。' +
        (st.kn > 14 ? ' 航速 ' + st.kn + ' 节使本舰流噪声抬升约 ' + (st.kn * 0.9).toFixed(0) + ' dB，宽带底抬高把弱线谱埋进门限以下——这就是"高速平台反而不利于被动检测"的原因。' : '')
      );
      UI.renderMathIn(note);
    }
    const rec = U.rafThrottle(recalc);

    const sSnr = UI.slider({ label: '线谱信噪比', min: -10, max: 30, step: 1, value: st.snr, unit: 'dB', hint: '单根线谱功率与宽带连续谱功率之比', onInput: () => rec() });
    const sFsh = UI.slider({ label: '轴频（螺旋桨转速）', min: 2, max: 8, step: 0.1, value: st.fsh, unit: 'Hz', hint: '商船 1～3 Hz，军舰可达 6～8 Hz', onInput: () => rec() });
    const sNb = UI.slider({ label: '螺旋桨叶片数', min: 3, max: 7, step: 1, value: st.nb, unit: '叶', hint: '叶频 = 轴频 × 叶片数，DEMON 谱中最强', onInput: () => rec() });
    const sT = UI.slider({ label: '积分时间', min: 4, max: 26, step: 2, value: st.T, unit: 's', hint: '越长分辨率越高，但要求目标谱线稳定', onInput: () => rec() });
    const sKn = UI.slider({ label: '本舰航速', min: 0, max: 20, step: 1, value: st.kn, unit: '节', hint: '流噪声近似随航速 6 次方增长', onInput: () => rec() });
    const segMov = UI.seg({
      label: '目标运动状态', value: st.mov,
      options: [{ value: 'static', label: '静止' }, { value: 'uniform', label: '匀速' }, { value: 'maneuver', label: '机动' }],
      onChange: v => { st.mov = v; rec(); }
    });

    el.appendChild(UI.ctrlPanel('仿真参数', [sSnr, sFsh, sNb, sT, sKn, segMov]));
    el.appendChild(grid);
    el.appendChild(hmBox.el);
    el.appendChild(mBox);
    el.appendChild(h('div.plot-cap', { html: U.md('上排左：LOFAR 功率谱与检测门限（绿色竖线为过门限且时间稳定的线谱）；上排右：DEMON 包络谱（紫/红竖线为设定的轴频与叶频）；下方热力图：线谱的时间轨迹，用来执行"稳定度判决"。') }));
    el.appendChild(note);
    recalc();
  }

  doc.register('cases/sonar/passive', {
    title: '案例二：被动声呐谱检测与线谱提取',
    lede: '不发射、只听音。潜艇辐射噪声 = 宽带连续谱 + 轴频/叶频线谱族。本节走一遍真实的 LOFAR + DEMON 处理链路：2 kHz 采样、26 s 数据、4096 点 Welch 平均，再把包络解调谱里的轴频和叶频抠出来，最后做恒虚警检测与时间稳定度判决。',
    tags: ['水声', '被动声呐', 'LOFAR', 'DEMON', '线谱检测'],
    labs: [{ path: 'lab/stft', title: 'STFT 时频分辨率实验台', desc: '理解 LOFAR 时频图的窗长/重叠取舍' }],
    toc: true,
    sections: [
      {
        id: 'bg', num: '1', title: '工程背景：安静平台上的"听音"任务',
        blocks: [
          { t: 'md', md: '被动声呐不发射声波，唯一的能量来源是目标自己发出的噪声。对潜艇这类安静目标，辐射噪声功率比主动回波低得多，**检测完全依赖长时间的能量积累与统计判决**。典型任务链是：声呐员听音 → LOFAR 谱分析发现线谱 → DEMON 解调确认螺旋桨特征 → 结合线谱频率与稳定度做分类识别。整条链路的核心 DSP 问题只有一个：**在宽带噪声背景中，把被淹没的窄带线谱以指定虚警概率检测出来，并给出尽可能准确的频率估计**。' },
          { t: 'md', md: '指标压力来自四个方面：' },
          { t: 'table', cols: ['压力来源', '典型数值', '对处理链的影响'], rows: [
            ['目标辐射噪声总声源级', '潜艇低速 100～120 dB，商船 170～190 dB', '信噪比跨越 40 dB 以上，处理链必须覆盖大动态范围'],
            ['检测指数（识别系数）', 'DT ≈ 10～15 dB', '决定需要的积分增益：时间带宽积 $BT$ 至少 10⁴ 量级'],
            ['海况 / 航速', '3～6 级海况；航速 0～20 节', '本舰自噪声与流噪声随航速急剧上升，吞掉积分增益'],
            ['识别要求', '区分渔船 / 商船 / 军舰', '不能只检测，还要给出轴频、叶频、谐波族结构等特征']
          ] },
          { t: 'callout', kind: 'eng', title: '工程师视角：为什么"线谱"如此值钱', md: '宽带连续谱只能告诉你"这里有个目标"，而**线谱携带推进信息**：轴频反推转速、叶频与轴频之比反推叶片数、谐波族的丰富程度反映机械状态。更重要的是，线谱是纯音，可以在长时间里做极窄带积分（$Q$ 值极高的滤波），积分增益远高于宽带检测。所以被动声呐的处理链，本质上是围绕"保住线谱、放大线谱、确认线谱"设计的。' }
        ]
      },
      {
        id: 'model', num: '2', title: '信号模型：辐射噪声的三大成分',
        blocks: [
          { t: 'md', md: '一艘水面船或潜艇的辐射噪声谱，工程上拆成三部分叠加：' },
          { t: 'math', tex: 'x(t) = \\underbrace{n_{\\text{宽}}(t)\\big[1+\\mu\\cos(2\\pi f_{\\text{叶}}t)\\big]}_{\\text{空化噪声：宽带连续谱 + 叶频调幅}} + \\underbrace{\\sum_{i} \\frac{A_i}{i^2}\\sin(2\\pi i f_{\\text{轴}} t)}_{\\text{机械线谱：轴频谐波族}} + \\underbrace{n_{0}(t)}_{\\text{环境噪声}}', tag: '(1)' },
          { t: 'kv', title: '变量说明', pairs: [
            ['$f_{\\text{轴}}$', '轴频：螺旋桨转轴频率，商船 1～3 Hz、军舰可达 6～8 Hz；机械不平衡还产生它的 2、3、4 次谐波'],
            ['$f_{\\text{叶}} = N_b f_{\\text{轴}}$', '叶频：叶片数 $N_b$ 乘轴频；每片叶扫过桨盘面不均匀流场时产生一次强空化脉冲'],
            ['$\\mu$', '调幅深度，典型 0.3～0.8；空化噪声被叶频周期性调制是 DEMON 处理的物理基础'],
            ['$n_{\\text{宽}}(t)$', '宽带空化连续谱，谱级随航速以约 6 次方律增长'],
            ['$n_0(t)$', '海洋环境噪声（风关、航无关）与接收平台自噪声']
          ] },
          { t: 'md', md: '两个工程上必须记住的量化关系：**流噪声近似随航速的 6 次方增长**（航速翻倍，谱级抬升约 18 dB）；**线谱存在多普勒**——目标与接收机的相对径向速度 $v$ 使线谱频率偏移 $\\Delta f = f\\, v/c$，对 400 Hz 线谱、10 节目标约 1.3 Hz，已经超过窄带分析的分辨单元。' },
          { t: 'callout', kind: 'pit', title: '坑：把"单次 FFT 的谱峰"当成检测', md: '随机信号单次 FFT 的幅度平方是随机变量，其方差与均值同量级——**任何一段噪声都能翻出一个 8～10 dB 的假峰**。所以被动检测必须回答三个问题：这个峰超过统计门限了吗（CFAR）？它在时间上稳定吗（稳定度判决）？它的谐波族结构自洽吗（叶频 = 轴频整数倍）？三问全过才算"检测到目标"。' },
          { t: 'fold', summary: '展开：LOFAR 与 DEMON 的定义及谱级归一', deriv: true, blocks: [
            { t: 'md', md: '**LOFAR**（低频分析与记录）：对宽带时序做分段加窗 FFT，得到功率谱随时间的瀑布图；单帧即周期图' },
            { t: 'math', tex: '\\hat P_k(f)=\\frac{1}{f_s\\sum_n w^2[n]}\\left|\\sum_{n=0}^{N-1} x_k[n]w[n]e^{-j2\\pi fn/f_s}\\right|^2' },
            { t: 'md', md: '$K$ 段平均后方差降为 $1/K$（Welch 方法），频率分辨率 $\\Delta f=f_s/N$。本例 $f_s=2\\,\\text{kHz}$、$N=4096$ → $\\Delta f\\approx0.49\\,\\text{Hz}$，26 s 数据含 12 个独立段。\n**DEMON**（解调谱）：宽带空化噪声被叶频调幅，取包络即把调制搬到了零频附近。对带通（如 400～900 Hz）信号 $b(t)$ 取解析包络' },
            { t: 'math', tex: 'e(t)=\\left|b(t)+j\\,\\mathcal{H}\\{b(t)\\}\\right|,\\qquad P_e(f)=\\left|E\\{e(t)\\}\\right|^2 \\ \\text{的功率谱}' },
            { t: 'md', md: '包络谱在十几赫兹范围内呈现轴频、叶频及其谐波——因为包络本身只有几十赫兹带宽，**采样率可以降到 200 Hz 再做谱分析，分辨率轻松到 0.2 Hz**，比在 LOFAR 上硬分辨低频线谱便宜一个量级。注意包络谱前必须去均值，否则直流分量会把整个动态范围吃掉。' }
          ] }
        ]
      },
      {
        id: 'algo', num: '3', title: '算法原理回顾：谱估计、包络解调与恒虚警',
        blocks: [
          { t: 'md', md: '本案例用到三块已在知识库详细展开的内容，这里只列工程要点：' },
          { t: 'md', md: '① **Welch 平均周期图**：分段、加汉宁窗、50% 重叠、逐段 FFT 后平均。窗长决定分辨率（$\\Delta f = f_s/N$），段数决定方差（$\\propto 1/K$），重叠是为了在同样数据长度下多出段数。50% 重叠 + 汉宁窗时相邻段相关，方差实际降为约 $9/(8K)$ 而不是 $1/K$。\n② **希尔伯特变换取包络**：解析信号 $\\;z= x+j\\mathcal{H}\\{x\\}\\;$ 的模即包络；频域实现就是"正频率加倍、负频率置零"。\n③ **恒虚警（CFAR）门限**：门限 = 背景水平估计 × 系数。被动谱检测最常用**滑动中值**做背景估计——它对线谱本身不敏感（中值滤波天然剔除少数尖峰），虚警率对背景起伏稳健。' },
          { t: 'math', tex: 'T(f) = \\mathrm{med}_{|f\'-f|\\le W}\\,\\hat P(f\') \\;+\\; \\alpha,\\qquad \\hat P(f) > T(f) \\ \\Rightarrow\\ \\text{候选线谱}', tag: '(2)' },
          { t: 'md', md: '第四块是**时间稳定度判决**：真实目标线谱在几十秒内频率基本不动（漂移量远小于分辨单元），而脉冲干扰、混响条纹、生物声源在时频图上要么一闪而过、要么频率乱跳。把"过门限"与"在 ≥60% 的帧里持续超过帧内背景 6 dB"两个条件串联，虚警率能压低两个数量级。' },
          { t: 'callout', kind: 'tip', title: '与知识库的对应关系', md: '周期图为什么必须平均（方差不下协）见「随机信号与功率谱」一章；Welch 分段参数的取舍实验见实验台 `lab/stft`；希尔伯特变换的频域实现见「希尔伯特变换」一节。' },
          { t: 'fold', summary: '展开：积分增益的账——为什么 26 s 数据只换 10 dB 出头', deriv: true, blocks: [
            { t: 'md', md: '窄带检测的积累增益为 $10\\lg(B_{\\text{检}}T)$，其中 $B_{\\text{检}}$ 是检测带宽。本例 $\\Delta f = 0.49\\,\\text{Hz}$、$T = 26\\,\\text{s}$ → $10\\lg(0.49\\times26) \\approx 11\\,\\text{dB}$。想再赚 10 dB，可以把谱线带宽再压一半（数据翻倍）或者积分时间翻倍——**但目标机动会把这条路堵死**：若目标在积分期内转过一个小角度，多普勒漂移超过 $\\Delta f$，能量摊到相邻几个频点上，增益不升反降。这就是"被动声呐的积分时间由目标机动性决定"的工程含义。' }
          ] }
        ]
      },
      {
        id: 'chain', num: '4', title: '完整处理链路：从水听器到识别报告',
        blocks: [
          { t: 'flow', v: true, items: [
            { t: '① 水听器基阵（舷侧阵 / 拖曳阵 / 球鼻艏阵）', d: '输入：声压场；输出：多路模拟信号。关键：灵敏度（约 −200 dB）、阵元间一致性、拖曳阵的流噪声' },
            { t: '② 前置放大 + 带通预滤波', d: '输入：µV 级；输出：V 级。关键：噪声系数 ≤ 3 dB；带宽按工作频段选（被动低频段常取 10～3000 Hz）' },
            { t: '③ 波束形成（先于谱分析）', d: '输入：多路数字信号；输出：指定方向的波束时间序列。关键：先在方位上把目标与干扰分开，谱分析对单波束数据进行' },
            { t: '④ 抗混叠 + ADC', d: '输入：模拟波束输出；输出：24 bit 数字流（$f_s$ 按最高分析频率的 2.56 倍取，本例 2 kHz）' },
            { t: '⑤ 预处理：去均值、去趋势、分频段', d: '输入：原始数字流；输出：各频段时间序列。关键：低频段单独抽取（10～300 Hz 用于线谱，400～900 Hz 用于 DEMON）；去均值防止直流泄漏' },
            { t: '⑥ LOFAR 谱分析', d: '输入：低频段序列；输出：功率谱瀑布图。关键：4096 点 FFT、汉宁窗、50% 重叠、$K$ 段平均；时间帧与分辨率在显示器上的取舍' },
            { t: '⑦ DEMON 解调谱', d: '输入：空化带信号；输出：包络谱。关键：希尔伯特取包络 → 去均值 → 抽取到 200 Hz → 再 Welch；提取轴频/叶频' },
            { t: '⑧ 恒虚警检测 + 稳定度判决', d: '输入：功率谱 + 时频图；输出：线谱清单（频率、电平、稳定度）。关键：滑动中值门限；峰值聚簇；跨帧关联' },
            { t: '⑨ 特征提取与分类显示', d: '输入：线谱清单；输出：目标属性。关键：轴频/叶频/谐波族/谱线稳定度 → 规则库或分类器；A 显 + 瀑布图给声呐员' }
          ] },
          { t: 'code', lang: 'python', title: 'LOFAR + DEMON 核心（可跑在真实水声数据上）', src: 'import numpy as np\nfrom scipy.signal import welch, hilbert\n\ndef lofar(x, fs, nfft=4096):\n    """Welch 平均周期图：汉宁窗 + 50% 重叠"""\n    f, p = welch(x, fs, window="hann", nperseg=nfft,\n                 noverlap=nfft//2, detrend="constant")\n    return f, 10*np.log10(p + 1e-20)\n\ndef demon(x, fs, band=(400, 900), fdec=200, nfft=1024):\n    """带通 -> 希尔伯特包络 -> 抽取 -> 再谱分析"""\n    X = np.fft.rfft(x)\n    f = np.fft.rfftfreq(len(x), 1/fs)\n    X[(f < band[0]) | (f > band[1])] = 0        # 频域带通\n    b = np.fft.irfft(X, len(x))\n    env = np.abs(hilbert(b))                    # 包络\n    env -= env.mean()                           # 去直流（必须！）\n    q = int(fs / fdec)\n    env = env[:len(env)//q*q].reshape(-1, q).mean(axis=1)\n    return lofar(env, fdec, nfft)\n\ndef detect(f, db, med_w=200, margin=9):\n    """滑动中值 CFAR + 局部峰值"""\n    from scipy.ndimage import median_filter\n    bg = median_filter(db, med_w)\n    cand = np.where(db > bg + margin)[0]\n    out = []\n    for i in cand:\n        if db[i] == db[max(0,i-3):i+4].max():\n            if not out or f[i] - out[-1] > 3:\n                out.append(f[i])\n    return out\n' }
        ]
      },
      {
        id: 'sim', num: '5', title: '交互仿真：拖参数看 LOFAR / DEMON 与检测判决',
        blocks: [
          { t: 'md', md: '仿真器按式 (1) 合成辐射噪声：宽带空化谱（受叶频调幅）+ 轴频 1～4 次谐波线谱 + 叶频线谱，可调航速与目标机动。处理链与第 4 节完全一致。请做四组实验：' },
          { t: 'md', md: '① **积分时间**：把积分从 4 s 拖到 26 s，看 LOFAR 谱上线谱从"淹没在起伏里"变成"清晰冒头"——Welch 段数增多、方差下降的直接后果。\n② **航速**：把本舰航速从 0 拖到 20 节，宽带底整体抬升十几 dB，弱线谱被门限吞掉——高速平台被动检测吃亏的量化演示。\n③ **机动**：切到"机动"档，时频图上的线谱轨迹变弯，稳定度判决开始失败——长积分的失效模式。\n④ **DEMON**：改轴频与叶片数，看 DEMON 谱里叶频线（红）跟着轴频×叶片数移动，轴频谐波族（紫）保持等间隔——这就是识别"推进器类型"的原始依据。' },
          { t: 'widget', render: function (el) { simPassive(el); } },
          { t: 'callout', kind: 'note', title: '读图指南', md: 'LOFAR 谱上，宽带连续谱是缓慢下倾的底，线谱是底上的细尖峰；绿色竖线是同时满足"过 CFAR 门限"与"时间稳定度 ≥ 60%"的检测输出。DEMON 谱的横轴是调制频率（0～60 Hz），与载波频率无关；轴频谐波族等间隔排列，叶频通常是其中最高的一根。' }
        ]
      },
      {
        id: 'limit', num: '6', title: '工程局限与实际难题',
        blocks: [
          { t: 'table', cols: ['难题', '机理', '后果', '对策'], rows: [
            ['本舰自噪声', '螺旋桨、主机、泵喷通过壳体与水直接辐射到本阵', '近频段自噪声比远场目标强 20～40 dB', '隔振、阵形远离噪声源、自噪声测量与对消、选频规避'],
            ['流噪声随航速增长', '湍流边界层压力起伏，约随航速 6 次方', '航速翻倍谱底抬 18 dB，弱目标丢失', '拖曳阵深拖（远离海面边界层）、导流罩设计、航速管理'],
            ['多径导致线谱分裂', '直达声与海面反射声叠加，干涉在频域形成梳状结构', '一根线谱裂成两三根"假线谱"，识别混淆', '波束形成压制多途方向；跨帧关联合并；结合方位信息判别'],
            ['目标机动多普勒漂移', '转向或变速使线谱频率漂移超过分辨单元', '长积分失效，稳定度判决失败', '短积分 + 轨迹关联（跟踪前检测）；运动补偿后再积分'],
            ['渔船与商船混淆', '两者都是低速大叶频目标，谐波族相似', '分类错误率上升', '结合航速、方位变化率、宽带/线谱能量比等多特征联合判决'],
            ['环境噪声非平稳', '风关噪声随海况缓变，航无关噪声突变', '固定门限虚警率失控', '门限随背景慢自适应（CFAR）；分频段独立归一化'],
            ['生物干扰', '虾群、鱼群发出宽带瞬态与似线谱', '虚警密集、听音饱和', '瞬态检测剔除、时频形态识别、声呐员人工复核']
          ] },
          { t: 'callout', kind: 'pit', title: '坑：DEMON 谱忘了去均值', md: '包络信号里有一个很大的直流分量（平均幅度）。若不去均值直接做 FFT，直流泄漏会通过窗函数的旁瓣把 0～60 Hz 整个频段抬高几十 dB，轴频/叶频全部看不见。**任何包络谱处理的第一行都应该是减均值**——这是 DEMON 处理最常见的低级错误。' },
          { t: 'callout', kind: 'eng', title: '工程师视角：线谱参数怎么报才规范', md: '工程报告里线谱不报"频率 + 电平"就完了，至少要包含：频率（Hz，分辨率内）、3 dB 宽度（判断展宽与多普勒）、持续时长与稳定度、谐波族归属（属于轴频族还是叶频族）、随时间的漂移率。有了这五项，后端的目标运动分析与分类才有可用输入；只报一个峰值频率，等于把辛苦测到的信息全部扔掉。' }
        ]
      },
      {
        id: 'sum', num: '7', title: '小结与配套实验台',
        blocks: [
          { t: 'md', md: '被动处理的四步逻辑：**先分频段**（线谱段与空化段分开）、**再平均**（Welch 把随机起伏压掉）、**后判决**（CFAR 门限 + 时间稳定度 + 谐波族自洽）、**最后解调**（DEMON 把推进特征搬进低频段）。积分时间不是越长越好——它的上限由目标机动性和本舰自噪声共同决定。' },
          { t: 'lab', item: { path: 'lab/stft', title: 'STFT 时频分辨率实验台', desc: '理解 LOFAR 时频图中窗长、重叠与帧率的取舍' } },
          { t: 'chips', list: ['LOFAR', 'DEMON', 'Welch 平均', 'CFAR', '线谱稳定度', '轴频 / 叶频'], cls: 'teal' }
        ]
      }
    ],
    refs: REFS
  });

  /* ============================================================
     案例三：声呐波束形成与目标方位估计
     ============================================================= */

  /** 交互仿真：CBF / MVDR / MUSIC 方位谱对比 */
  function simBeamforming(el) {
    const F0 = 1000, LAM = CW / F0;                 // 中心频率 1 kHz，波长 1.5 m
    const st = { N: 32, dlam: 0.5, th1: 15, dual: true, dth: 8, snr: 10, K: 50, meth: 'all', coh: false, smooth: true };

    const boxP = UI.plotBox({ title: '常规波束形成器方向图（全平面，dB）' });
    const boxA = UI.plotBox({ title: '方位谱对比：CBF / MVDR / MUSIC（dB）' });
    const pA = P.new(boxA.canvas, { height: 300, xlabel: '方位角 / 度', ylabel: '归一化谱 / dB', legend: true });

    const mBox = h('div.metrics');
    const note = h('div.prose');
    const grid = h('div.grid.g2', {}, [boxP.el, boxA.el]);

    const sRe0 = U.randn(400, 7001), sIm0 = U.randn(400, 9002);
    const nRe0 = U.randn(9600, 11003), nIm0 = U.randn(9600, 12007);

    function manifoldAmp(i, theta, M2, dlam) {      // 第 i 阵元对角度 theta 的相位因子
      const ph = 2 * Math.PI * dlam * i * Math.sin(theta);
      return [Math.cos(ph), Math.sin(ph)];
    }

    function recalc() {
      const N = st.N, dlam = st.dlam, d = dlam * LAM;
      const D = st.dual ? 2 : 1;
      const ths = [st.th1 * Math.PI / 180];
      if (D === 2) ths.push((st.th1 + st.dth) * Math.PI / 180);
      const K = Math.max(1, Math.round(st.K));
      const sigma = Math.pow(10, -st.snr / 20);

      /* ---------- 1. 阵列快拍数据 X (N×K) ---------- */
      const Xr = new Float64Array(N * K), Xi = new Float64Array(N * K);
      const A = [];                                    // A[s] = {re,im} 长度 N 的导向矢量
      ths.forEach(th => {
        const ar = new Float64Array(N), ai = new Float64Array(N);
        for (let i = 0; i < N; i++) {
          const ph = 2 * Math.PI * dlam * i * Math.sin(th);
          ar[i] = Math.cos(ph); ai[i] = Math.sin(ph);
        }
        A.push({ re: ar, im: ai });
      });
      for (let k = 0; k < K; k++) {
        const sv = [];
        for (let s = 0; s < D; s++) {
          sv.push(st.coh && s > 0 ? { re: sRe0[k], im: sIm0[k] } : { re: sRe0[200 * s + k], im: sIm0[200 * s + k] });
        }
        for (let i = 0; i < N; i++) {
          let xr = 0, xi = 0;
          for (let s = 0; s < D; s++) {
            xr += A[s].re[i] * sv[s].re - A[s].im[i] * sv[s].im;
            xi += A[s].re[i] * sv[s].im + A[s].im[i] * sv[s].re;
          }
          Xr[k * N + i] = xr + sigma * nRe0[i * 200 + (k % 200)];
          Xi[k * N + i] = xi + sigma * nIm0[i * 200 + (k % 200)];
        }
      }

      /* ---------- 2. 样本协方差（含前向空间平滑） ---------- */
      let Ne = N, dlamE = dlam;
      let Rr = new Float64Array(N * N), Ri = new Float64Array(N * N);
      const doSmooth = st.coh && st.smooth && D >= 2;
      if (doSmooth) {
        const Lsub = Math.max(2, Math.floor(N / 2));
        const M2 = N - Lsub + 1;
        Rr = new Float64Array(M2 * M2); Ri = new Float64Array(M2 * M2);
        Ne = M2; dlamE = dlam;
        for (let l = 0; l < Lsub; l++) {
          for (let k = 0; k < K; k++) {
            for (let i = 0; i < M2; i++) {
              const xr = Xr[k * N + l + i], xi = Xi[k * N + l + i];
              for (let j = 0; j < M2; j++) {
                Rr[i * M2 + j] += xr * Xr[k * N + l + j] + xi * Xi[k * N + l + j];
                Ri[i * M2 + j] += xi * Xr[k * N + l + j] - xr * Xi[k * N + l + j];
              }
            }
          }
        }
      } else {
        for (let k = 0; k < K; k++) {
          for (let i = 0; i < N; i++) {
            const xr = Xr[k * N + i], xi = Xi[k * N + i];
            for (let j = 0; j < N; j++) {
              Rr[i * N + j] += xr * Xr[k * N + j] + xi * Xi[k * N + j];
              Ri[i * N + j] += xi * Xr[k * N + j] - xr * Xi[k * N + j];
            }
          }
        }
      }
      const sc = 1 / K;
      for (let i = 0; i < Rr.length; i++) { Rr[i] *= sc; Ri[i] *= sc; }

      /* ---------- 3. 特征分解（MVDR 与 MUSIC 共用） ---------- */
      const eg = hermEig(Ne, Rr, Ri);
      const Ir = new Float64Array(Ne * Ne), Ii = new Float64Array(Ne * Ne);
      const lamFloor = eg.val[0] * 1.02 + 1e-8;        // 用最小特征值构造对角加载下限
      for (let j = 0; j < Ne; j++) {
        const g = 1 / Math.max(eg.val[j], lamFloor);
        for (let i = 0; i < Ne; i++) {
          for (let k = 0; k < Ne; k++) {
            // (v_j v_j^H)[i,k] = v_j[i] * conj(v_j[k])
            Ir[i * Ne + k] += g * (eg.vr[i * Ne + j] * eg.vr[k * Ne + j] + eg.vi[i * Ne + j] * eg.vi[k * Ne + j]);
            Ii[i * Ne + k] += g * (eg.vi[i * Ne + j] * eg.vr[k * Ne + j] - eg.vr[i * Ne + j] * eg.vi[k * Ne + j]);
          }
        }
      }

      /* ---------- 4. 三种方法的方位谱 ---------- */
      const nAng = 361, ang = [], cbfDb = [], mvdrDb = [], musicDb = [];
      let cPk = -1e9, mPk = -1e9, uPk = -1e9;
      const rawC = new Float64Array(nAng), rawM = new Float64Array(nAng), rawU = new Float64Array(nAng);
      for (let q = 0; q < nAng; q++) {
        const thDeg = -90 + q * 0.5;
        ang.push(thDeg);
        const th = thDeg * Math.PI / 180;
        const ar = new Float64Array(Ne), ai = new Float64Array(Ne);
        for (let i = 0; i < Ne; i++) {
          const ph = 2 * Math.PI * dlamE * i * Math.sin(th);
          ar[i] = Math.cos(ph); ai[i] = Math.sin(ph);
        }
        // CBF：a^H R a
        let pc = 0;
        for (let i = 0; i < Ne; i++) {
          for (let j = 0; j < Ne; j++) {
            const rr = Rr[i * Ne + j], ri = Ri[i * Ne + j];
            // a_i^* R_ij a_j
            pc += (ar[i] * rr - ai[i] * ri) * ar[j] + (ar[i] * ri + ai[i] * rr) * ai[j];
          }
        }
        // MVDR：1/(a^H R^{-1} a)
        let srr = 0, sii = 0;
        for (let i = 0; i < Ne; i++) {
          let zr = 0, zi = 0;
          for (let k = 0; k < Ne; k++) {
            zr += Ir[i * Ne + k] * ar[k] - Ii[i * Ne + k] * ai[k];
            zi += Ir[i * Ne + k] * ai[k] + Ii[i * Ne + k] * ar[k];
          }
          srr += ar[i] * zr + ai[i] * zi;
          sii += ar[i] * zi - ai[i] * zr;
        }
        const pmv = 1 / Math.max(srr, 1e-12);
        // MUSIC：1/||En^H a||²（En 取最小的 Ne−D 个特征值对应的向量）
        let sm = 0;
        for (let j = 0; j < Ne - D; j++) {
          let pr = 0, pi2 = 0;
          for (let i = 0; i < Ne; i++) {
            pr += eg.vr[i * Ne + j] * ar[i] + eg.vi[i * Ne + j] * ai[i];
            pi2 += eg.vr[i * Ne + j] * ai[i] - eg.vi[i * Ne + j] * ar[i];
          }
          sm += pr * pr + pi2 * pi2;
        }
        const pms = 1 / Math.max(sm, 1e-12);
        rawC[q] = pc; rawM[q] = pmv; rawU[q] = pms;
        if (pc > cPk) cPk = pc;
        if (pmv > mPk) mPk = pmv;
        if (pms > uPk) uPk = pms;
      }
      for (let q = 0; q < nAng; q++) {
        cbfDb.push(Math.max(20 * Math.log10(rawC[q] / cPk), -40));
        mvdrDb.push(Math.max(20 * Math.log10(rawM[q] / mPk), -40));
        musicDb.push(Math.max(20 * Math.log10(rawU[q] / uPk), -40));
      }

      /* ---------- 5. 极坐标方向图（CBF 全平面） ---------- */
      const polTh = [], polR = [];
      for (let q = 0; q <= 180; q++) {
        const thDeg = -90 + q * 2;
        const th = thDeg * Math.PI / 180;
        const ar = new Float64Array(N), ai = new Float64Array(N);
        let pc = 0;
        for (let i = 0; i < N; i++) {
          const ph = 2 * Math.PI * dlam * i * Math.sin(th);
          ar[i] = Math.cos(ph); ai[i] = Math.sin(ph);
        }
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            const rr = Rr[i * N + j], ri = Ri[i * N + j];
            pc += (ar[i] * rr - ai[i] * ri) * ar[j] + (ar[i] * ri + ai[i] * rr) * ai[j];
          }
        }
        polTh.push(thDeg);
        polR.push(Math.max(20 * Math.log10(Math.max(pc, 1e-12) / cPk), -40));
      }

      /* ---------- 6. 主瓣宽度与估计误差 ---------- */
      function width3(arr, x0, step) {
        let pk = -1e9, pi = 0;
        for (let i = 0; i < arr.length; i++) if (arr[i] > pk) { pk = arr[i]; pi = i; }
        let l = pi, r = pi;
        while (l > 0 && arr[l] > -3) l--;
        while (r < arr.length - 1 && arr[r] > -3) r++;
        return { w: (r - l) * step, err: x0[pi] };
      }
      const wC = width3(cbfDb, ang, 0.5);
      const wM = width3(mvdrDb, ang, 0.5);
      const wU = width3(musicDb, ang, 0.5);
      const rayleigh = (LAM / (N * d * Math.cos(st.th1 * Math.PI / 180))) * 180 / Math.PI;
      const trueBest = D === 2 ? st.th1 + st.dth / 2 : st.th1;

      /* ---------- 7. 绘图 ---------- */
      pA.clear()
        .add({ x: ang, y: cbfDb, type: 'line', color: 0, width: 1.6, label: 'CBF（常规）' })
        .add({ x: ang, y: mvdrDb, type: 'line', color: 1, width: 1.6, label: 'MVDR（最小方差）' })
        .add({ x: ang, y: musicDb, type: 'line', color: 2, width: 1.6, dash: [5, 3], label: 'MUSIC（子空间）' })
        .vline(st.th1, { label: '目标1 ' + st.th1 + '°' })
        .vline(st.th1 + (D === 2 ? st.dth : 0), { label: D === 2 ? '目标2 ' + (st.th1 + st.dth) + '°' : '', color: '#0f766e' })
        .draw();
      P.polar(boxP.canvas, {
        theta: polTh, r: polR, rMin: -40, rMax: 0, height: 300,
        labels: [[0, '0°（正横）'], [90, '90°'], [180, '180°'], [270, '−90°']],
        title: 'CBF 方向图（依赖 sinθ，两端对称 → 线列阵的左右舷模糊）'
      });

      /* ---------- 8. 指标 ---------- */
      U.clear(mBox);
      [
        ['阵列孔径', ((N - 1) * d).toFixed(2), 'm'],
        ['瑞利限 λ/(Nd·cosθ)', rayleigh.toFixed(2), '°'],
        ['CBF 主瓣宽度', wC.w.toFixed(2), '°'],
        ['MVDR 主瓣宽度', wM.w.toFixed(2), '°'],
        ['MUSIC 谱峰宽', wU.w.toFixed(2), '°'],
        ['快拍数', String(K), '个'],
        ['协方差秩', doSmooth ? '平滑后恢复满秩' : (st.coh && D === 2 ? '亏秩（相干）' : '满秩'), ''],
        ['两源是否分辨', (D === 2 ? (wC.w < st.dth ? 'CBF 可分' : 'CBF 不可分') : '单目标'), '']
      ].forEach(m => mBox.appendChild(h('div.metric', {}, [
        h('div.m-l', { text: m[0] }),
        h('div.m-v', { text: m[1] }),
        m[2] ? h('div', {}, h('span.m-u', { text: m[2] })) : null
      ])));

      /* ---------- 9. 动态解读 ---------- */
      note.innerHTML = U.md(
        '**当前状态解读：** $N=' + N + '$ 个阵元、$d/\\lambda=' + dlam + '$、孔径 $(N-1)d=' + ((N - 1) * d).toFixed(1) +
        '\\,\\text{m}$。常规波束形成的 −3 dB 主瓣宽约 $0.886\\,\\lambda/(Nd\\cos\\theta)\\approx' + (0.886 * rayleigh).toFixed(2) +
        '^\\circ$（瑞利限 ' + rayleigh.toFixed(2) + '°，实测 ' + wC.w.toFixed(2) + '°），这个宽度**只由孔径决定，与信噪比无关**。' +
        (st.dual
          ? ' 两个目标相距 ' + st.dth + '°：' + (wC.w < st.dth
            ? 'CBF 尚能分辨。'
            : '**CBF 已糊成一个峰**——此时看 MVDR（宽 ' + wM.w.toFixed(2) + '°）与 MUSIC（宽 ' + wU.w.toFixed(2) +
              '°）：MVDR 利用协方差求逆在强源方向"挖洞"，分辨率突破孔径限制；MUSIC 把信号子空间与噪声子空间分开，谱峰更窄更尖。但两者的分辨率都依赖快拍数与信噪比——把快拍数拖到 5 个试试，它们会退化甚至失效。')
          : ' 单目标场景下三种方法都给出主峰，差别体现在旁瓣与峰宽上。') +
        (st.coh && D === 2
          ? (doSmooth
            ? ' 已开启**前向空间平滑**：把 $N=' + N + '$ 阵列划成 ' + Math.floor(N / 2) + ' 个 ' + (N - Math.floor(N / 2) + 1) +
              ' 元子阵平均协方差，恢复协方差满秩，MUSIC 重新工作（代价：有效孔径缩小到 ' + ((N - Math.floor(N / 2)) * d).toFixed(1) + ' m，主瓣变宽）。'
            : ' **相干多径未做平滑**：两源信号完全相关，样本协方差亏秩（秩 1），噪声子空间被污染，MUSIC 谱峰乱跳——这就是多径环境下 MUSIC 失效的经典现场。')
          : '') +
        ' 极坐标图呈现的是 CBF 响应随 $\\sin\\theta$ 的对称性：线列阵只测得 $\\sin\\theta$，**±θ 方向完全模糊**（左右舷不清），工程上用双线阵、矢量水听器或平台机动解模糊。'
      );
      UI.renderMathIn(note);
    }
    const rec = U.rafThrottle(recalc);

    const sN = UI.slider({ label: '阵元数 N', min: 8, max: 40, step: 4, value: st.N, unit: '元', hint: '孔径 (N−1)d 决定瑞利限', onInput: () => rec() });
    const sDl = UI.slider({ label: '间距 d/λ', min: 0.2, max: 1.2, step: 0.1, value: st.dlam, unit: '', hint: '超过 0.5 出现栅瓣（空间混叠）', onInput: () => rec() });
    const sTh = UI.slider({ label: '目标方位', min: -60, max: 60, step: 1, value: st.th1, unit: '°', hint: '0° 为正横（线列阵敏感方向）', onInput: () => rec() });
    const sDth = UI.slider({ label: '双目标间距', min: 2, max: 30, step: 1, value: st.dth, unit: '°', hint: '检验三种方法的分辨能力', onInput: () => rec() });
    const sSnr = UI.slider({ label: '信噪比', min: -10, max: 25, step: 1, value: st.snr, unit: 'dB', hint: '每阵元每快拍的单源信噪比', onInput: () => rec() });
    const sK = UI.slider({ label: '快拍数 K', min: 1, max: 200, step: 1, value: st.K, unit: '个', hint: '样本协方差的平均次数，MVDR/MUSIC 的生命线', onInput: () => rec() });
    const tgDual = UI.toggle({ label: '双目标', value: st.dual, onChange: v => { st.dual = v; rec(); } });
    const tgCoh = UI.toggle({ label: '相干多径（第二源与第一源同波形）', value: st.coh, onChange: v => { st.coh = v; rec(); } });
    const tgSm = UI.toggle({ label: '空间平滑', value: st.smooth, onChange: v => { st.smooth = v; rec(); } });

    el.appendChild(UI.ctrlPanel('仿真参数', [sN, sDl, sTh, sDth, sSnr, sK, tgDual, tgCoh, tgSm]));
    el.appendChild(grid);
    el.appendChild(mBox);
    el.appendChild(h('div.plot-cap', { html: U.md('左图：CBF 方向图（极坐标，0° 指向正横）；右图：同一份阵列数据下三种方位谱的对比，竖直虚线为真实方位。所有谱相对各自峰值归一化到 0 dB、显示下限 −40 dB（MUSIC 谱峰极窄，其余角度被压到下限属正常现象）。') }));
    el.appendChild(note);
    recalc();
  }

  doc.register('cases/sonar/beamforming', {
    title: '案例三：声呐波束形成与目标方位估计',
    lede: '拖曳线列阵 32 元、间距半波长、中心频率 1 kHz。本节把常规波束形成（CBF）、最小方差（MVDR）与子空间法（MUSIC）放在同一份阵列数据上对比：瑞利限由孔径锁死，超分辨靠协方差结构，而多径相干源会让 MUSIC 当场失效——现场怎么救，看完就会。',
    tags: ['水声', '波束形成', '方位估计', 'MVDR', 'MUSIC'],
    labs: [{ path: 'lab/music', title: 'MUSIC 超分辨谱估计实验台', desc: '快拍数、信噪比与源数对 MUSIC 的影响' }],
    toc: true,
    sections: [
      {
        id: 'bg', num: '1', title: '工程背景：方位是声呐的第二张脸',
        blocks: [
          { t: 'md', md: '被动声呐输出两个基本量：**频率**（案例二）与**方位**。方位由波束形成给出——把 N 个水听器的输出按规律加权求和，让"某个方向来的信号同相叠加、其他方向相互抵消"。现代声呐同时形成几十到上百个波束覆盖全向，每个波束再独立走一遍谱分析与检测链路。' },
          { t: 'md', md: '典型场景参数如下。注意线列阵的几何：阵在拖缆方向上，只有正横方向（±30° 扇面）是可靠工作区，端射方向孔径投影缩短、波束急剧展宽。' },
          { t: 'table', cols: ['项目', '典型取值', '为什么'], rows: [
            ['阵型', '拖曳线列阵 / 舷侧阵 / 圆柱阵', '拖曳阵孔径大（百米级）、远离本舰自噪声；代价是左右舷模糊与阵形不确定性'],
            ['阵元数 $N$', '32～128', '孔径决定分辨率；阵元多还要考虑采集通道成本与数据量'],
            ['间距 $d$', '$\\lambda/2$（本例 0.75 m @ 1 kHz）', '半波长是栅瓣刚好不出现的上限；宽带系统只能对最高频率满足'],
            ['中心频率', '500 Hz～2 kHz（被动低频段）', '低频吸收小、传播远；低频线谱目标丰富'],
            ['快拍数', '几十～几百', '样本协方差的平均次数，决定 MVDR/MUSIC 能否工作'],
            ['方位分辨率需求', '1°～3°', '直接决定目标运动分析（TMA）的定位收敛速度']
          ] },
          { t: 'callout', kind: 'eng', title: '工程师视角：为什么还要研究"超分辨"', md: '瑞利限 $\\lambda/(Nd)$ 是孔径的物理账，谁也绕不开。但两目标相距 2°、瑞利限 3.6° 时，常规波束形成确实糊成一个峰——而 MVDR/MUSIC 利用数据本身的协方差结构（信号子空间方向），可以在孔径不变的情况下把峰"挤"出来。**代价是它们对模型失配极其敏感**：阵形误差、幅相误差、相干多径、快拍不足，任何一条不满足都会当场翻车。所以工程结论是：CBF 做保底，超分辨做增强，两者同时在屏幕上给声呐员看。' }
        ]
      },
      {
        id: 'model', num: '2', title: '信号模型：窄带阵列模型与样本协方差',
        blocks: [
          { t: 'md', md: '对中心频率 $f_0$（波长 $\\lambda = c/f_0$）的窄带模型，$N$ 元等间距线列阵对远场平面波（方位 $\\theta$，从正横起算）的导向矢量为' },
          { t: 'math', tex: '\\mathbf{a}(\\theta) = \\left[1,\\; e^{j 2\\pi \\frac{d}{\\lambda}\\sin\\theta},\\; \\dots,\\; e^{j 2\\pi (N-1)\\frac{d}{\\lambda}\\sin\\theta}\\right]^{\\mathsf T}', tag: '(1)' },
          { t: 'md', md: '$D$ 个源 + 噪声的阵列快拍模型与样本协方差矩阵为' },
          { t: 'math', tex: '\\mathbf{x}(k) = \\sum_{s=1}^{D} b_s(k)\\,\\mathbf{a}(\\theta_s) + \\mathbf{n}(k),\\qquad \\hat{\\mathbf{R}} = \\frac{1}{K}\\sum_{k=1}^{K} \\mathbf{x}(k)\\mathbf{x}^{\\mathsf H}(k)', tag: '(2)' },
          { t: 'kv', title: '变量说明', pairs: [
            ['$b_s(k)$', '第 $s$ 个源的第 $k$ 个快拍复幅度；各源相互独立时协方差满秩'],
            ['$\\mathbf{n}(k)$', '阵元噪声，设为空间白高斯，功率 $\\sigma^2 = 10^{-\\text{SNR}/10}$'],
            ['$K$', '快拍数：协方差平均次数；$K \\ge 2D$ 才能分辨 $D$ 个源，$K \\gg D$ 才稳定'],
            ['$\\hat{\\mathbf{R}}$', '样本协方差；理想情况 $\\mathbf{R} = \\mathbf{A}\\mathbf{P}\\mathbf{A}^{\\mathsf H} + \\sigma^2\\mathbf{I}$'],
            ['$d/\\lambda$', '间距波长比；决定相位斜率，超过 1/2 出现栅瓣（空间混叠）']
          ] },
          { t: 'callout', kind: 'pit', title: '坑：把线列阵的"±θ 模糊"当 bug', md: '线列阵的响应只依赖 $\\sin\\theta$（式 1），因此 +30° 与 150°（左右舷对称方向）的导向矢量完全相同——**这不是实现错误，是几何宿命**。工程对策：① 拖曳阵转向（平台机动前后各测一次，用三角定位解模糊）；② 双线阵（上下平行两条子阵，靠声程差判左右）；③ 矢量水听器（声压 + 振速组合指向性天然单值）。设计阶段没想清楚这一条，实船数据里就会出现"镜对称假目标"。' },
          { t: 'fold', summary: '展开：为什么相干多径会毁掉 MUSIC（协方差亏秩的机理）', deriv: true, blocks: [
            { t: 'md', md: 'MUSIC 的前提是协方差可写成 $\\mathbf{R} = \\mathbf{A}\\mathbf{P}\\mathbf{A}^{\\mathsf H}+\\sigma^2\\mathbf{I}$，其中源协方差 $\\mathbf{P}$ **正定**（各源独立）。当第二源是第一源经海面/海底反射的副本：$b_2(k)=\\rho\\,b_1(k)$，则' },
            { t: 'math', tex: '\\mathbf{A}\\mathbf{P}\\mathbf{A}^{\\mathsf H} = (\\mathbf{a}_1 + \\rho\\mathbf{a}_2)\\,P_{11}\\,(\\mathbf{a}_1+\\rho\\mathbf{a}_2)^{\\mathsf H}' },
            { t: 'md', md: '秩为 1！$D=2$ 个源在协方差里只剩一个"等效源"，其方向是 $\\mathbf{a}_1$ 与 $\\mathbf{a}_2$ 的合成方向——**MUSIC 只能找到一个峰，且位置随反射系数相位乱摆**。前向空间平滑的补救：把 $N$ 元阵列滑窗切成 $L=N-M+1$ 个 $M$ 元子阵，对各自协方差取平均。由于各子阵的导向矢量相位结构不同，平均后秩恢复为 2；代价是有效孔径缩到 $(M-1)d$，主瓣展宽约 $N/M$ 倍。双向平滑、Toeplitz 重构可进一步减小损失。' }
          ] }
        ]
      },
      {
        id: 'algo', num: '3', title: '算法原理回顾：CBF、MVDR 与 MUSIC 的账本',
        blocks: [
          { t: 'md', md: '三种方法共用同一份协方差，差别只在"怎么用它"：' },
          { t: 'table', cols: ['方法', '方位谱', '需要什么', '分辨能力', '失效条件'], rows: [
            ['CBF（常规 / Bartlett）', '$P(\\theta)=\\mathbf{a}^{\\mathsf H}\\hat{\\mathbf{R}}\\,\\mathbf{a}$', '只要 $\\hat{\\mathbf{R}}$（甚至单快拍）', '瑞利限 $\\lambda/(Nd\\cos\\theta)$，与 SNR 无关', '几乎不失效，最稳健'],
            ['MVDR（Capon）', '$P(\\theta)=1/\\mathbf{a}^{\\mathsf H}\\hat{\\mathbf{R}}^{-1}\\mathbf{a}$', '满秩 $\\hat{\\mathbf{R}}$，$K \\gtrsim 2N$ 才稳', '约 CBF 的 1/2～1/3 宽，随 SNR 提升', '相干源、快拍不足（对角加载可救）'],
            ['MUSIC', '$P(\\theta)=1/\\|\\mathbf{E}_n^{\\mathsf H}\\mathbf{a}(\\theta)\\|^2$', '特征分解 + 源数 $D$ 估计 + 满秩', '理论上任意窄（峰宽随 SNR/K 收敛）', '相干源、$D$ 估计错、阵列误差']
          ] },
          { t: 'md', md: '三点工程补充：' },
          { t: 'md', md: '① **频域波束形成**：宽带信号先分频段（FFT），对每个频点用该频率的 $\\lambda$ 做相位加权求和，再合成宽带方位谱；时域做法则是真时延波束形成（分数延迟滤波）。窄带公式里的 $d/\\lambda$ 必须随频点更新——这是宽带系统里最常被忽略的细节。\n② **FFT 波束形成**：对均匀线列阵，波束扫描可用一次空域 FFT 同时完成（形成 $N$ 个正交波束），计算量从 $N^2$ 降到 $N\\log N$，是实时系统的标准做法。\n③ **峰值插值**：方位谱分辨率再高也受角度网格限制，实用中在峰值附近用三点抛物线插值把方位估到网格的 1/10。' },
          { t: 'callout', kind: 'tip', title: '与知识库的对应关系', md: '阵列响应、栅瓣与加窗（空间域锥削）的推导见「阵列与波束形成」知识页；MUSIC 的特征结构分解与源数估计见实验台 `lab/music`。本节的 MVDR 与 MUSIC 都通过同一套特征分解实现，便于对比。' }
        ]
      },
      {
        id: 'chain', num: '4', title: '完整处理链路：从阵元到方位-时间历程',
        blocks: [
          { t: 'flow', v: true, items: [
            { t: '① 水听器阵（拖曳线列阵 / 舷侧阵）', d: '输入：声压场；输出：$N$ 路模拟信号。关键：阵元灵敏度一致性、拖缆深度与阵形监测（深度计 + 方位传感器）' },
            { t: '② 前置放大 + ADC（每阵元一路）', d: '输入：µV 级；输出：24 bit 数字流。关键：**通道间幅相一致性是超分辨算法的生命线**，不一致要靠校准补偿' },
            { t: '③ 阵列校准与阵形修正', d: '输入：标校数据 + 姿态；输出：修正后的阵元坐标。关键：拖曳阵弯曲（流致形变）使实际阵形偏离直线，直接破坏导向矢量模型' },
            { t: '④ 频域波束形成（分频段）', d: '输入：多路数字流；输出：波束域时间序列 / 频点-方位矩阵。关键：FFT 分段 → 每频点相位加权求和 → 空间锥削（切比雪夫权）压旁瓣' },
            { t: '⑤ 多波束并行覆盖', d: '输入：波束域数据；输出：全向方位扫描。关键：波束间隔 ≤ 半波束宽；端射区自动加宽间隔' },
            { t: '⑥ 方位谱精估（可选超分辨）', d: '输入：选定波束的协方差；输出：CBF/MVDR/MUSIC 谱。关键：快拍积累、对角加载、空间平滑开关' },
            { t: '⑦ 峰值检测与跟踪', d: '输入：方位谱；输出：目标方位历程。关键：峰值聚簇、左右舷判别、跨帧航迹关联' },
            { t: '⑧ 显示：方位-时间历程（BTR）', d: '输入：方位历程；输出：目标轨迹。关键：时间轴上的方位亮线即为目标，交叉线即方位模糊/多径' }
          ] },
          { t: 'code', lang: 'python', title: 'CBF / MVDR / MUSIC 一体化实现', src: 'import numpy as np\n\ndef steer(N, dlam, th_deg):\n    th = np.deg2rad(th_deg)\n    return np.exp(1j * 2*np.pi * dlam * np.arange(N) * np.sin(th))\n\ndef spectra(X, dlam, D, angles):\n    """X: (N, K) 阵列快拍；返回 CBF/MVDR/MUSIC 方位谱(dB)"""\n    N = X.shape[0]\n    R = X @ X.conj().T / X.shape[1]\n    # 特征分解（Hermitian）\n    ev, V = np.linalg.eigh(R)            # 升序\n    En = V[:, :N-D]                      # 噪声子空间\n    Rinv = np.linalg.inv(R + 1e-6*np.eye(N)*np.trace(R)/N)   # 对角加载\n    out = {k: [] for k in ("cbf", "mvdr", "music")}\n    for th in angles:\n        a = steer(N, dlam, th)\n        out["cbf"].append(np.real(a.conj() @ R @ a))\n        out["mvdr"].append(1.0 / np.real(a.conj() @ Rinv @ a))\n        out["music"].append(1.0 / np.linalg.norm(En.conj().T @ a)**2)\n    return {k: 10*np.log10(np.array(v)/np.max(v) + 1e-12)\n            for k, v in out.items()}\n\ndef spatial_smooth(X, L):\n    """前向空间平滑：L 个 (N-L+1) 元子阵"""\n    N, K = X.shape; M = N - L + 1\n    R = np.zeros((M, M), complex)\n    for l in range(L):\n        Xs = X[l:l+M, :]\n        R += Xs @ Xs.conj().T\n    return R / L\n' }
        ]
      },
      {
        id: 'sim', num: '5', title: '交互仿真：三种方位谱的现场对决',
        blocks: [
          { t: 'md', md: '仿真器生成 $N$ 元半间距线列阵的阵列快拍（默认双源），对**同一份数据**同时计算三种方位谱。请按顺序做五组实验：' },
          { t: 'md', md: '① **孔径的账**：把阵元数从 8 拖到 40，看 CBF 主瓣从约 11° 收窄到 2°——瑞利限与孔径成反比，与信噪比无关。\n② **栅瓣**：把 $d/\\lambda$ 拖过 0.5，极坐标图上冒出对称的假峰（栅瓣）——空间采样混叠。\n③ **分辨能力**：双目标间距拖到 4°（小于瑞利限），CBF 糊成一个峰而 MVDR/MUSIC 仍给出两个峰。\n④ **快拍不足**：把快拍数拖到 5，MVDR/MUSIC 立刻发散——协方差估计的方差太大，超分辨是"吃快拍"的。\n⑤ **相干多径**：勾选"相干多径"、关掉"空间平滑"，MUSIC 谱峰乱跳；再打开平滑，峰立刻回到真实方位（但主瓣变宽——孔径缩小的代价）。' },
          { t: 'widget', render: function (el) { simBeamforming(el); } },
          { t: 'callout', kind: 'note', title: '读图指南', md: '右图三根曲线来自同一份协方差：蓝（CBF）最宽但永远稳定；橙（MVDR）在强源方向形成凹槽，弱源反而更突出；绿虚线（MUSIC）最尖锐但只在模型成立时可信。左图极坐标是 CBF 响应的全平面视图，注意其关于 0°/180° 轴对称——那就是左右舷模糊。' }
        ]
      },
      {
        id: 'limit', num: '6', title: '工程局限与实际难题',
        blocks: [
          { t: 'table', cols: ['难题', '机理', '后果', '对策'], rows: [
            ['阵形畸变 / 阵列弯曲', '拖缆受流作用弯成弧线，阵元真实位置偏离等间距直线', '导向矢量失配，主瓣展宽、旁瓣抬升、超分辨失效', '阵形测量（深度计+方位传感器+航向仪）、阵形自适应补偿、弯曲敏感的稳健波束形成'],
            ['幅相误差', '通道增益/相位不一致、放大器温漂', '等效于随机扰动导向矢量，旁瓣从 −13 dB 抬到 −8 dB 以上', '周期性电标校、通道均衡、鲁棒波束形成（对角加载）'],
            ['阵元失效', '水密故障、断芯', '方向图出现坏点，栅瓣抬升', '通道状态监测、自动剔除与重构权、冗余阵元'],
            ['拖曳阵流噪声的空间相关', '湍流边界层沿阵长相关', '噪声不再是空间白，MVDR 假设破坏', '降噪导流罩、隔振段、阵元间距避开相关长度'],
            ['相干多径', '海面/海底反射副本与直达声完全相关', '协方差亏秩，MUSIC 失效、MVDR 偏移', '空间平滑（前向/双向）、对角加载、相干信号子空间法（CSSM）'],
            ['左右舷模糊', '线列阵响应只依赖 $\\sin\\theta$', '每条航迹都有一个镜像假目标', '平台机动解算、双线阵、矢量水听器'],
            ['宽带处理复杂度', '$d/\\lambda$ 随频率变化，窄带公式不成立', '高频栅瓣、低频波束变宽', '分频段波束形成（每组频段独立锥削）或真时延迟域波束形成']
          ] },
          { t: 'callout', kind: 'pit', title: '坑：超分辨算法不看快拍数就上机', md: 'MVDR 与 MUSIC 的方差随 $K$ 收敛，$K < 2N$ 时样本协方差本身严重病态：MVDR 的谱开始"撕出"假凹槽，MUSIC 直接出乱峰。工程上必须检查：① $K \\ge 2N$（最好 $5N$）；② 加对角加载（$\\hat{\\mathbf{R}}+\\epsilon\\,\\mathrm{tr}(\\hat{\\mathbf{R}})\\mathbf{I}/N$，$\\epsilon\\approx 10^{-2}$）；③ 谱峰必须与 CBF 峰位一致才采信。**超分辨是"确认工具"不是"发现工具"**。' },
          { t: 'callout', kind: 'eng', title: '工程师视角：阵列校准是超分辨的前提，不是可选件', md: '仿真里导向矢量精确已知，所以 MUSIC 神奇；海上不是。实测拖曳阵的阵形弯曲可达十分之一个波长量级，足以让 MUSIC 谱峰漂移数度。正规做法是安装期做声标校（拖曳发射器扫描全阵，测出每通道的幅相与位置偏差存表），运行期用合作目标或强线谱目标做在线自校（"自校准波束形成"）。**阵列误差预算应与孔径设计同时做**：孔径给分辨率，误差给下限，两者取短板。' }
        ]
      },
      {
        id: 'sum', num: '7', title: '小结与配套实验台',
        blocks: [
          { t: 'md', md: '记三句话：**孔径买分辨率**（瑞利限 $\\lambda/(Nd\\cos\\theta)$，物理账）；**协方差买超分辨**（MVDR/MUSIC 用数据结构突破孔径，但要付快拍数、满秩、模型精度三张票）；**相干多径是超分辨的天敌**（空间平滑是标准解药，代价是孔径缩水）。' },
          { t: 'lab', item: { path: 'lab/music', title: 'MUSIC 超分辨谱估计实验台', desc: '调整快拍数、源数与信噪比，观察 MUSIC 的收敛与失效' } },
          { t: 'chips', list: ['CBF', 'MVDR', 'MUSIC', '空间平滑', '左右舷模糊', '栅瓣'], cls: 'teal' }
        ]
      }
    ],
    refs: REFS
  });

  /* ============================================================
     案例四：多波束测深与侧扫图像去噪
     ============================================================= */

  /** 交互仿真 A：侧扫声呐图像的斑点噪声与去噪对比 */
  function simSideScan(el) {
    const W = 360, H = 200, NPIX = W * H, NL = 8;
    const st = { L: 1, meth: 'raw', k: 1.5 };

    /* 干净场景：水柱 + 首次回波 + 波纹海底 + 目标高亮与阴影 + 岩石 */
    const clean = new Float32Array(NPIX);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let v;
        if (y < 24) v = 0.02;                                     // 水柱（拖鱼下方盲区）
        else if (y < 27) v = 0.9;                                 // 海底首次回波亮线
        else {
          v = 0.42 + 0.10 * Math.sin(x * 0.09) + 0.05 * Math.sin(x * 0.023 + 2);
          v *= 1 - 0.22 * (y - 27) / (H - 27);                    // 远距回波衰减
          if (x > 210 && x < 236 && y > 60 && y < 78) v = 0.95;   // 目标（沉箱）高亮
          if (x > 214 && x < 244 && y >= 78 && y < 108) v = 0.05; // 目标声影
          if (x > 90 && x < 108 && y > 100 && y < 112) v = 0.8;   // 岩石凸起
          if (x > 300 && x < 312 && y > 40 && y < 52) v = 0.75;   // 第二个小目标
        }
        clean[y * W + x] = Math.max(0, Math.min(1, v));
      }
    }

    /* 预生成均匀随机数：第 q 视的斑点（可复现） */
    const uni = new Float32Array(NPIX * NL);
    const rr = U.rng(424242);
    for (let i = 0; i < uni.length; i++) uni[i] = Math.max(rr(), 1e-6);

    /** L 视斑点噪声图像（指数分布乘性模型） */
    function makeNoisy(L) {
      const out = new Float32Array(NPIX);
      for (let i = 0; i < NPIX; i++) {
        let s = 0;
        for (let q = 0; q < L; q++) s += -Math.log(uni[i * NL + q]);
        out[i] = clean[i] * (s / L);
      }
      return out;
    }

    /** 灰度显示（开方压缩斑点动态范围） */
    function drawTo(cv, img) {
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      const im = ctx.createImageData(W, H);
      for (let i = 0; i < NPIX; i++) {
        const g = Math.min(255, Math.round(255 * Math.sqrt(Math.max(img[i], 0))));
        im.data[4 * i] = g; im.data[4 * i + 1] = g; im.data[4 * i + 2] = g; im.data[4 * i + 3] = 255;
      }
      ctx.putImageData(im, 0, 0);
    }

    /** 二维中值滤波（r = 1 或 2） */
    function median2D(img, r) {
      const out = new Float32Array(NPIX);
      const buf = new Array((2 * r + 1) * (2 * r + 1));
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let n = 0;
          for (let dy = -r; dy <= r; dy++) {
            const yy = Math.min(H - 1, Math.max(0, y + dy));
            for (let dx = -r; dx <= r; dx++) {
              const xx = Math.min(W - 1, Math.max(0, x + dx));
              buf[n++] = img[yy * W + xx];
            }
          }
          const s = buf.slice(0, n).sort((a, b) => a - b);
          out[y * W + x] = s[n >> 1];
        }
      }
      return out;
    }

    /** Haar 小波 1 级分解 + 软阈值重构 */
    function waveletDenoise(img, k) {
      const W2 = W >> 1, H2 = H >> 1;
      const LL = new Float32Array(W2 * H2), LH = new Float32Array(W2 * H2),
        HL = new Float32Array(W2 * H2), HH = new Float32Array(W2 * H2);
      for (let y = 0; y < H2; y++) {
        for (let x = 0; x < W2; x++) {
          const a = img[(2 * y) * W + 2 * x], b = img[(2 * y) * W + 2 * x + 1];
          const c = img[(2 * y + 1) * W + 2 * x], d = img[(2 * y + 1) * W + 2 * x + 1];
          LL[y * W2 + x] = (a + b + c + d) / 4;
          HL[y * W2 + x] = (a + c - b - d) / 4;      // 垂直细节
          LH[y * W2 + x] = (a + b - c - d) / 4;      // 水平细节
          HH[y * W2 + x] = (a - b - c + d) / 4;      // 对角细节
        }
      }
      // 噪声标准差：对角细节的绝对中位数差
      const absHH = Array.from(HH).map(Math.abs).sort((a, b) => a - b);
      const sigma = absHH[(absHH.length / 2) | 0] / 0.6745;
      const thr = k * sigma * Math.sqrt(2 * Math.log(W2 * H2));
      const soft = v => Math.abs(v) < thr ? 0 : (v > 0 ? v - thr : v + thr);
      for (let i = 0; i < LH.length; i++) { LH[i] = soft(LH[i]); HL[i] = soft(HL[i]); HH[i] = soft(HH[i]); }
      const out = new Float32Array(NPIX);
      for (let y = 0; y < H2; y++) {
        for (let x = 0; x < W2; x++) {
          const s = LL[y * W2 + x], p = LH[y * W2 + x], q = HL[y * W2 + x], t = HH[y * W2 + x];
          out[(2 * y) * W + 2 * x] = s + p + q + t;
          out[(2 * y) * W + 2 * x + 1] = s + p - q - t;
          out[(2 * y + 1) * W + 2 * x] = s - p + q - t;
          out[(2 * y + 1) * W + 2 * x + 1] = s - p - q + t;
        }
      }
      return out;
    }

    /** 各向异性扩散（Perona-Malik，8 次迭代） */
    function anisoDiffuse(img) {
      let cur = Float32Array.from(img);
      const K2 = 0.02;
      for (let it = 0; it < 8; it++) {
        const nxt = Float32Array.from(cur);
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            const i = y * W + x, c0 = cur[i];
            let fl = 0;
            const nb = [cur[i - 1], cur[i + 1], cur[i - W], cur[i + W]];
            for (let q = 0; q < 4; q++) {
              const d2 = nb[q] - c0;
              fl += d2 / (1 + d2 * d2 / K2);
            }
            nxt[i] = c0 + 0.15 * fl;
          }
        }
        cur = nxt;
      }
      return cur;
    }

    /** 均质区等效视数 ENL = μ²/σ² */
    function enl(img) {
      let s = 0, s2 = 0, n = 0;
      for (let y = 120; y < 180; y++) {
        for (let x = 260; x < 350; x++) {
          const v = img[y * W + x];
          s += v; s2 += v * v; n++;
        }
      }
      const mu = s / n, va = Math.max(s2 / n - mu * mu, 1e-9);
      return mu * mu / va;
    }

    /* 界面 */
    const cvA = h('canvas', { style: { width: '100%', imageRendering: 'pixelated', display: 'block' } });
    const cvB = h('canvas', { style: { width: '100%', imageRendering: 'pixelated', display: 'block' } });
    const boxA = h('div', {}, [
      h('div', { style: { font: '600 12.5px sans-serif', color: 'var(--text-strong)', margin: '0 0 4px' }, text: '原始图像（含斑点）' }),
      cvA
    ]);
    const boxB = h('div', {}, [
      h('div', { style: { font: '600 12.5px sans-serif', color: 'var(--text-strong)', margin: '0 0 4px' }, text: '处理后图像' }),
      cvB
    ]);
    const grid = h('div.grid.g2', {}, [boxA, boxB]);
    const mBox = h('div.metrics');
    const note = h('div.prose');

    function recalc() {
      const noisy = makeNoisy(Math.max(1, Math.round(st.L)));
      let proc;
      if (st.meth === 'raw') proc = noisy;
      else if (st.meth === 'med3') proc = median2D(noisy, 1);
      else if (st.meth === 'med5') proc = median2D(noisy, 2);
      else if (st.meth === 'wave') proc = waveletDenoise(noisy, st.k);
      else if (st.meth === 'diff') proc = anisoDiffuse(noisy);
      else proc = makeNoisy(4);                                  // 多视：4 视平均
      drawTo(cvA, noisy);
      drawTo(cvB, proc);
      const e1 = enl(noisy), e2 = enl(proc);
      U.clear(mBox);
      [
        ['斑点视数（设定）', String(Math.round(st.L)), '视'],
        ['等效视数 ENL（原始）', e1.toFixed(2), ''],
        ['等效视数 ENL（处理后）', e2.toFixed(2), ''],
        ['斑点噪声改善', (10 * Math.log10(Math.max(e2, 0.01) / Math.max(e1, 0.01))).toFixed(1), 'dB'],
        ['目标阴影是否保留', (st.meth === 'med5' ? '边缘发糊' : '保留'), ''],
        ['理论 ENL 上限', st.meth === 'raw' ? String(Math.round(st.L)) : (st.meth === 'multi' ? '4 视' : '受滤波窗限制'), '']
      ].forEach(m => mBox.appendChild(h('div.metric', {}, [
        h('div.m-l', { text: m[0] }),
        h('div.m-v', { text: m[1] }),
        m[2] ? h('div', {}, h('span.m-u', { text: m[2] })) : null
      ])));
      const mn = { raw: '不处理', med3: '3×3 中值', med5: '5×5 中值', wave: '小波软阈值', diff: '各向异性扩散', multi: '多视平均（4 视）' };
      note.innerHTML = U.md(
        '**当前状态解读：** 斑点噪声是乘性的：$I = R\\cdot n$，$n$ 服从指数分布（单视）时标准差与均值相等，**ENL = 1**——所以单视侧扫图像永远"麻"。把视数拖到 ' + Math.round(st.L) +
        '，ENL 理论上等于视数（实测 ' + e1.toFixed(2) + '）。当前处理方式「' + mn[st.meth] + '」把均质区的 ENL 从 ' + e1.toFixed(2) +
        ' 提到 ' + e2.toFixed(2) + '（斑点方差下降 $10\\lg=' + (10 * Math.log10(Math.max(e2, 0.01) / Math.max(e1, 0.01))).toFixed(1) + '\\,\\text{dB}$）。' +
        (st.meth === 'med5' ? ' 注意看沉箱边缘与阴影边界：5×5 中值把边缘磨圆了——**去斑与保边是一对矛盾**，窗口越大 ENL 越高但细小目标（锚链、管线）也越容易被抹掉。'
          : (st.meth === 'wave' ? ' 小波方法把细节系数软阈值化：平坦区细节被置零（斑点消失），边缘处细节大而保留——ENL 与保边兼顾，代价是阈值系数需要现场调。'
            : (st.meth === 'diff' ? ' 各向异性扩散只在"平坦方向"上扩散、跨边缘不扩散，因此阴影边界锐利；迭代次数过多会退化为类似高斯模糊。'
              : (st.meth === 'multi' ? ' 多视平均是最"物理"的办法：牺牲分辨率换视数，ENL 直接翻倍——但全视处理要求波束分解，实机往往用部分视数折中。'
                : ' 不处理时斑点标准差≈均值，ENL≈1，弱目标与纹理完全被噪声淹没。'))))
      );
      UI.renderMathIn(note);
    }

    const segM = UI.seg({
      label: '去噪方法', value: st.meth,
      options: [
        { value: 'raw', label: '不处理' }, { value: 'med3', label: '中值 3×3' }, { value: 'med5', label: '中值 5×5' },
        { value: 'wave', label: '小波阈值' }, { value: 'diff', label: '扩散滤波' }, { value: 'multi', label: '多视×4' }
      ],
      onChange: v => { st.meth = v; recalc(); }
    });
    const sL = UI.slider({ label: '斑点视数', min: 1, max: 8, step: 1, value: st.L, unit: '视', hint: '独立视数越高斑点越弱（分辨率代价）', onInput: v => { st.L = v; recalc(); } });
    const sK = UI.slider({ label: '小波阈值系数', min: 0.5, max: 3, step: 0.1, value: st.k, unit: '', hint: '通用阈值 = k·σ·√(2lnN)，只在"小波阈值"档生效', onInput: v => { st.k = v; recalc(); } });

    el.appendChild(UI.ctrlPanel('图像仿真参数', [segM, sL, sK]));
    el.appendChild(grid);
    el.appendChild(mBox);
    el.appendChild(note);
    recalc();
  }

  /** 交互仿真 B：多波束深度剖面的"笑脸 / 哭脸"伪地形 */
  function simMBES(el) {
    const D0 = 40;                                   // 真实水深 m
    const st = { eps: 2, cov: 65, roll: 0.15 };
    const box = UI.plotBox({ title: '多波束深度剖面：伪地形 = 深度误差随横距的分布' });
    const p = P.new(box.canvas, { height: 280, xlabel: '横距 / m', ylabel: '深度误差 / m', legend: true });
    const note = h('div.prose');
    const mBox = h('div.metrics');

    function recalc() {
      const thMax = st.cov * Math.PI / 180;
      const nB = 121;
      const xs = [], dev = [], devR = [];
      const gNorm = 1 / Math.cos(thMax) - 1;
      for (let i = 0; i < nB; i++) {
        const th = -thMax + 2 * thMax * i / (nB - 1);
        const x = D0 * Math.tan(th);
        const e = D0 * (st.eps / 100) * (1 / Math.cos(th) - 1) / gNorm;   // 声速误差项
        const r = Math.tan(st.roll * Math.PI / 180) * x;                  // 横摇残留项（随横距线性）
        xs.push(x);
        dev.push(e);
        devR.push(e + r);
      }
      const eEdge = dev[nB - 1];
      p.clear()
        .add({ x: xs, y: dev, type: 'line', color: 0, width: 2, label: '仅声速误差 ε=' + st.eps.toFixed(1) + '%' })
        .add({ x: xs, y: devR, type: 'line', color: 1, width: 1.6, dash: [6, 3], label: '声速误差 + 横摇残留 ' + st.roll.toFixed(2) + '°' })
        .hline(0, { label: '真实海底（平底）', color: '#0f766e' })
        .annotate(0, eEdge * 0.6 + 0.1, eEdge > 0.05 ? '外缘偏深 → 剖面两端下垂' : (eEdge < -0.05 ? '外缘偏浅 → 剖面两端上翘' : '误差在验收限内'), { dy: -6 })
        .draw();
      const iho = Math.sqrt(1 + Math.pow(0.013 * D0, 2));               // IHO S-44 一等精度近似
      U.clear(mBox);
      [
        ['外缘深度误差', eEdge.toFixed(2), 'm'],
        ['IHO S-44 一等限（40 m 水深）', iho.toFixed(2), 'm'],
        ['声速误差是否超标', Math.abs(eEdge) > iho ? '超限' : '合格', ''],
        ['横摇残留在外缘的贡献', (Math.tan(st.roll * Math.PI / 180) * D0 * Math.tan(thMax)).toFixed(2), 'm'],
        ['覆盖宽度（±' + st.cov + '°）', (2 * D0 * Math.tan(thMax)).toFixed(0), 'm'],
        ['外缘掠射角', (90 - st.cov).toFixed(0), '°']
      ].forEach(m => mBox.appendChild(h('div.metric', {}, [
        h('div.m-l', { text: m[0] }),
        h('div.m-v', { text: m[1] }),
        m[2] ? h('div', {}, h('span.m-u', { text: m[2] })) : null
      ])));
      note.innerHTML = U.md(
        '**当前状态解读：** 真实海底是平的（水深 40 m），但测出来的剖面两端翘/垂。声速误差 $\\varepsilon=' + st.eps.toFixed(1) +
        '\\%$ 的简化模型下，误差正比于 $(1/\\cos\\theta-1)$：正下方为 0、外缘最大，达 ' + eEdge.toFixed(2) +
        ' m——对照 IHO S-44 一等测量限差 ±' + iho.toFixed(2) + ' m（40 m 水深），' + (Math.abs(eEdge) > iho ? '**判超限，数据要返工**' : '勉强合格，但已接近红线') +
        '。横摇残留 ' + st.roll.toFixed(2) + '° 贡献的是随横距线性变化的斜坡（虚线），与声速误差的"碗状"形态不同——**看误差曲线的形状就能反推误差源**：对称碗状 → 声速；倾斜直线 → 横摇；锯齿跳变 → 底检测抖动。' +
        (eEdge > 0.05 ? ' 外缘偏深时，行业里习惯叫"哭脸"（剖面两端下沉）；偏浅则称"笑脸"。不同厂商文档对这两个名字偶有互换，**判读时抓住本质：外缘偏深还是偏浅、误差是否随 $\\theta$ 二次增长**。' : '')
      );
      UI.renderMathIn(note);
    }

    const sE = UI.slider({ label: '声速误差 ε（假设 − 实际）', min: -4, max: 4, step: 0.5, value: st.eps, unit: '%', hint: '表层声速仪不准或剖面过期都会产生', onInput: v => { st.eps = v; recalc(); } });
    const sC = UI.slider({ label: '覆盖扇区半角', min: 40, max: 75, step: 5, value: st.cov, unit: '°', hint: '外缘角越大，声速误差被放大得越厉害', onInput: v => { st.cov = v; recalc(); } });
    const sR = UI.slider({ label: '横摇补偿残留', min: 0, max: 0.5, step: 0.05, value: st.roll, unit: '°', hint: '姿态传感器精度与安装对准误差', onInput: v => { st.roll = v; recalc(); } });

    el.appendChild(UI.ctrlPanel('剖面仿真参数', [sE, sC, sR]));
    el.appendChild(box.el);
    el.appendChild(mBox);
    el.appendChild(note);
    recalc();
  }

  doc.register('cases/sonar/mbes', {
    title: '案例四：多波束测深与侧扫图像去噪',
    lede: '一幅水深图、一幅海底图像，是海洋测绘的两张基本产品。本节拆开两条真实的处理链：多波束的斜距→深度→声线弯曲改正→底检测（笑脸/哭脸伪地形从哪来），以及侧扫的斑点噪声乘性模型与四种去噪方法（多视、中值、小波、扩散）的现场对决。',
    tags: ['水声', '多波束测深', '侧扫声呐', '斑点噪声', '图像去噪'],
    labs: [],
    toc: true,
    sections: [
      {
        id: 'bg', num: '1', title: '工程背景：测深与成像，两种产品一条链',
        blocks: [
          { t: 'md', md: '多波束测深仪（成百个波束同时斜向发射）给出**水深**，侧扫声呐给出**海底图像**；现代设备往往两者合一。它们的共同物理基础是：向海底斜发射一个窄波束，接收海底反向散射，把"回波时间 + 角度"换算成"位置 + 深度/强度"。但两者关心的量不同：测深关心**回波到达时间的精度**（厘米级），成像关心**回波幅度的保真**（底质判读），所以处理链在中段分岔。' },
          { t: 'table', cols: ['指标', '典型要求', '难点'], rows: [
            ['深度精度（IHO S-44 一等）', '$\\pm\\sqrt{1^2+(0.013 d)^2}$ cm 级', '40 m 水深约 ±1.0 m 限差；声速与姿态误差直接吃掉它'],
            ['覆盖宽度', '水深 4～7 倍（±60°～±75°）', '外缘波束掠射，回波弱、底检测抖动大'],
            ['侧扫分辨率', '沿航向 5～20 cm', '换能器纵向孔径决定；拖鱼越高盲区越大'],
            ['图像判读质量', '底质分类、目标识别', '斑点噪声（ENL≈1）与入射角引起的灰度起伏必须补偿']
          ] },
          { t: 'callout', kind: 'eng', title: '工程师视角：测深精度是"系统账"不是"算法账"', md: '深度误差预算里，算法（底检测）通常只占 10%～20%，大头在：声速剖面（可达 0.3%～1% 水深的误差）、姿态（横摇 0.05° 在 60° 外缘就是几十厘米）、定位与时延。**先把传感器误差预算做完，再谈算法**——这是测深项目与图像项目思维方式的根本区别。' }
        ]
      },
      {
        id: 'model', num: '2', title: '信号模型：斜距、声线弯曲与乘性斑点',
        blocks: [
          { t: 'md', md: '**测深几何**：波束以俯角 $\\theta$（从垂线起算）斜射，测得斜距 $R$ 与波束角后换算深度与横距：' },
          { t: 'math', tex: 'd = R\\cos\\theta,\\qquad y = R\\sin\\theta', tag: '(1)' },
          { t: 'md', md: '式 (1) 只在"声线是直线、声速均匀"时成立。真实水体分层，声速随深度变化，声线按斯涅尔定律弯曲，式 (1) 变成沿声线路径的数值积分（**声线跟踪**）：' },
          { t: 'math', tex: '\\frac{\\cos\\theta(z)}{c(z)} = \\text{常数（斯涅尔）},\\qquad d=\\int c_z\\,\\text{沿路径},\\quad y=\\int \\tan\\theta(z)\\,dz', tag: '(2)' },
          { t: 'md', md: '工程上用**等效声速**（谐波平均声速）一步改正：只要"等效声速 × 单程时间"与真实路径的端点一致，深度就不偏——但等效声速本身依赖声速剖面测量，剖面过期或表层声速不准，误差集中爆发在外缘波束（$\\propto 1/\\cos\\theta$），这就是"笑脸/哭脸"伪地形的来源。' },
          { t: 'md', md: '**成像灰度**：侧扫图像的像素值正比于海底反向散射强度，由声呐方程改写：' },
          { t: 'math', tex: 'EL = SL - 2TL + S_b + 10\\lg A_b - NL + AG,\\qquad S_b(\\theta_{\\text{掠射}})\\ \\text{随掠射角剧烈变化}', tag: '(3)' },
          { t: 'md', md: '$S_b$ 在正下方（垂直入射）附近有一个强峰，小掠射角处快速下跌——所以原始侧扫图像"中间亮两头黑"，必须做**入射角增益改正（AGC / TVG 补偿）**才能判读。在此之上再叠加**乘性斑点噪声**：' },
          { t: 'math', tex: 'I = R\\cdot n,\\qquad p_n(n)=\\frac{L^L}{(L-1)!}n^{L-1}e^{-Ln},\\quad \\mathrm{ENL}=L', tag: '(4)' },
          { t: 'kv', title: '变量说明', pairs: [
            ['$R$', '真实的海底反射率（想去掉的"信号"）'],
            ['$n$', '斑点乘性因子；单视时为指数分布，均值 1、标准差 1'],
            ['$L$', '独立视数：$L$ 视平均后方差降为 $1/L$，等效视数 ENL = L'],
            ['$S_b$', '单位面积的底反向散射强度（dB），依赖底质（泥/沙/岩）与掠射角'],
            ['$A_b$', '散射面元面积，$A_b = R\\,\\beta\\, c\\tau/(2\\cos\\theta)$（波束宽 × 脉宽投影）']
          ] },
          { t: 'callout', kind: 'pit', title: '坑：把斑点当加性高斯噪声去滤', md: '斑点是**乘性**的：亮区斑点强、暗区斑点弱（标准差正比于均值）。对图像直接套高斯低通/均值滤波，等于把边缘一起抹掉；正确做法要么先取对数（把乘性变加性）再滤波，要么直接用针对乘性模型的滤波器（Lee、Kuan、多视）。本节交互仿真里可以直观对比这两类做法的差别。' },
          { t: 'fold', summary: '展开：底检测的两条路——振幅检测与相位差检测', deriv: true, blocks: [
            { t: 'md', md: '**振幅检测（WMT，加权均值时间）**：在每条波束的回波包络上找最强点。正下方附近（$\\theta < 25^\\circ$）回波强、形状干净，精度好；外缘小掠射角时回波弱且被斑点淹没，抖动大。\n**相位差检测**：利用相邻两个接收子阵的相位差 $\\Delta\\varphi = 2\\pi d\\sin\\theta/\\lambda$ 反演波束角，再用过零点时刻定斜距。它**不依赖回波幅度**，在外缘弱回波区精度远好于振幅检测——现代多波束在外缘一律以相位差为主、振幅为辅。' },
            { t: 'md', md: '两者的误差来源不同：振幅检测怕斑点与底质突变，相位差检测怕多径（多途叠加破坏相位单值性）与旁瓣污染。**正下方±20°常用振幅检测、外缘用相位差检测**，交接带要做一致性融合，否则剖面接缝处会出现台阶——这也是实测数据最常见的伪迹之一。' }
          ] }
        ]
      },
      {
        id: 'algo', num: '3', title: '算法原理回顾：从斜距记录到干净图像',
        blocks: [
          { t: 'md', md: '① **斜距记录与斜距改正**：侧扫声呐显示的原始图像是"斜距 × 沿航向"，不是平面几何。斜距改正把斜距 $R$ 换成水平距离 $\\sqrt{R^2-h^2}$（$h$ 为拖鱼高度）；水柱去除把拖鱼以下 $h$ 内的"空白"裁掉。拖鱼高度设错，图像里的目标位置整体变形。\n② **TVG 与入射角改正**：时间增益补偿 $40\\lg R+2\\alpha R$（球面扩展 + 吸收），入射角增益补偿 $S_b(\\theta)$ 曲线，两者之后图像灰度才与底质单调对应。\n③ **多视平均**：把一个发射脉冲分成若干独立子波束（或用前后视），各自成像后平均。视数 $L$ 翻倍，斑点方差减半——**用分辨率换信噪比**，是最物理的去斑方法。\n④ **中值滤波**：非线性滤波，取窗口中位数。对"脉冲型"斑点（少数极亮/极暗点）效果好且保边，但窗口大时会抹掉细小目标。\n⑤ **小波阈值去噪**：Haar/王-玛拉特分解后，细节系数做软阈值 $\\tilde w=\\mathrm{sgn}(w)\\max(|w|-T,0)$，$T=k\\hat\\sigma\\sqrt{2\\ln N}$，$\\hat\\sigma$ 用对角细节的绝对中位数差估计。平坦区细节置零、边缘细节保留。\n⑥ **各向异性扩散（Perona–Malik）**：迭代扩散方程，扩散系数 $c(|\\nabla I|)=1/(1+|\\nabla I|^2/K^2)$ 在平坦区大、跨边缘小——"沿边走、不跨边"。' },
          { t: 'callout', kind: 'tip', title: '与知识库的对应关系', md: '斑点模型的统计推导（为什么单视是指数分布）是"随机信号功率谱"一章里复高斯包络模平方分布的直接应用；TVG 与主动声呐方程的关系见案例一第 2 节；小波去噪的阈值理论见「小波变换」知识页。' }
        ]
      },
      {
        id: 'chain', num: '4', title: '完整处理链路：两条链对照',
        blocks: [
          { t: 'md', md: '**多波束测深链**（左）与**侧扫成像链**（右），共同前段、分岔中段：' },
          { t: 'flow', v: true, items: [
            { t: '① 换能器基阵（发射扇形波束 × 接收线性阵）', d: '输入：电信号；输出：扇区声覆盖。关键：发射波束沿航向窄（0.5°～1.5°）、接收波束沿航向宽（扇区覆盖）——两者乘积形成"脚印"' },
            { t: '② 姿态与定位同步（GPS/惯导/声速仪）', d: '输入：横摇纵摇升沉航向 + 声速剖面；输出：每一 ping 的姿态快照。关键：**时间同步误差 10 ms 在 5 节航速下就是 2.5 cm**' },
            { t: '③ 波束形成与频域处理', d: '输入：多通道回波；输出：各波束复包络。关键：外缘波束用相位差子阵、正下方用振幅子阵' },
            { t: '④ 底检测（分岔 A：测深）', d: '输入：波束包络 + 相位差；输出：每波束斜距 + 角度。关键：振幅/相位差融合、野值剔除、交接带一致性' },
            { t: '⑤ 声线跟踪与地理编码', d: '输入：斜距/角度 + 声速剖面 + 姿态；输出：每个脚印的三维坐标。关键：等效声速或分层追踪；外缘误差 ∝ 1/cosθ' },
            { t: '⑥ 表面削平与网格化', d: '输入：离散脚印；输出：水深网格/等深线。关键：统计滤波去野值；相邻条带拼接的边缘匹配' },
            { t: '⑦ 幅度归一与成像（分岔 B：侧扫）', d: '输入：波束/通道包络；输出：灰度图像。关键：TVG + 入射角改正 + 斑点抑制；斜距改正与水柱去除' },
            { t: '⑧ 目标解译', d: '输入：去噪图像；输出：目标清单（位置、尺寸、影长→高）。关键：阴影长度反演目标高度 $h= L_{\\text{影}}\\tan\\alpha$（$\\alpha$ 为掠射角）' }
          ] },
          { t: 'code', lang: 'python', title: '侧扫去噪与深度改正核心', src: 'import numpy as np\n\ndef enl(img, mask=None):\n    """等效视数 ENL = 均值²/方差（乘性斑点的标准度量）"""\n    x = img[mask] if mask is not None else img.ravel()\n    mu = x.mean()\n    return mu*mu / max(x.var(), 1e-12)\n\ndef multi_look(looks):\n    """L 幅独立视图像非相干平均：ENL ≈ L"""\n    return sum(looks) / len(looks)\n\ndef lee_filter(img, win=7):\n    """Lee 滤波：针对乘性斑点 I = R*n 的最小均方估计"""\n    from scipy.ndimage import uniform_filter\n    mu = uniform_filter(img, win)\n    var = uniform_filter(img*img, win) - mu*mu\n    cv = var / np.maximum(mu*mu, 1e-12)          # 变异系数（先验）\n    Ci2 = 1.0 / L_LOOKS                          # 视数倒数\n    W = np.clip(1 - Ci2 / np.maximum(cv, 1e-9), 0, 1)\n    return mu + W * (img - mu)\n\ndef depth_correct(slant, theta_deg, c_eq=1500.0, two_way=True):\n    """斜距 -> 深度/横距（等效声速一步改正）"""\n    R = slant if two_way else slant/2\n    th = np.deg2rad(theta_deg)\n    return R*np.cos(th), R*np.sin(th)\n' }
        ]
      },
      {
        id: 'sim', num: '5', title: '交互仿真：图像去噪对决 + 伪地形剖面',
        blocks: [
          { t: 'md', md: '**仿真 A（侧扫去噪）**：程序生成一幅含水柱、海底首次回波、波纹、沉箱（高亮 + 阴影）与岩石的合成侧扫图，再按式 (4) 乘上 L 视斑点。六种处理方式实时对比，指标卡给出均质区等效视数与改善分贝。请做三组对照：' },
          { t: 'md', md: '① 把视数从 1 拖到 8（不处理档）：斑点肉眼可见地减弱，ENL 从 1 涨到 8——多视的物理收益。\n② 中值 3×3 与 5×5 对比：ENL 升高，但沉箱边缘和阴影边界发糊——去斑与保边的矛盾。\n③ 小波阈值系数从 0.5 拖到 3：阈值过低斑点残留，过高把岩石细节抹平——通用阈值公式 $k\\hat\\sigma\\sqrt{2\\ln N}$ 里的 k 就是现场要调的旋钮。' },
          { t: 'widget', render: function (el) { simSideScan(el); } },
          { t: 'md', md: '**仿真 B（多波束伪地形）**：真实海底是平的（40 m 水深），测出的剖面却两端翘/垂。拖动声速误差、外缘角与横摇残留，观察误差曲线从"碗状"（声速）变成"斜线"（横摇），并对照 IHO S-44 限差判断是否返工。' },
          { t: 'widget', render: function (el) { simMBES(el); } },
          { t: 'callout', kind: 'note', title: '读图指南', md: '仿真 A：左图为含斑点的原始图像，右图为处理结果，注意沉箱高亮与黑色声影是否同时保留——阴影是判读目标高度的关键信息，被抹掉等于丢失信息。仿真 B：纵轴是深度误差（0 为真实海底），误差曲线的"形状"直接对应误差源：对称碗状 → 声速剖面；随横距线性 → 横摇残留；两侧同号 → 声速，两侧异号 → 时延。' }
        ]
      },
      {
        id: 'limit', num: '6', title: '工程局限与实际难题',
        blocks: [
          { t: 'table', cols: ['难题', '机理', '后果', '对策'], rows: [
            ['声速剖面误差', '剖面过期、表层声速仪不准、内波引起剖面时变', '外缘波束深度偏差 ∝ 1/cosθ，形成笑脸/哭脸伪地形', '现场声速剖面仪（SVP）+ 表层声速仪；条带重叠区交叉检查；误差超限重测'],
            ['姿态补偿残留', '横摇纵摇传感器精度 0.02°～0.05°、安装对准残差', '外缘深度偏差随横距线性增长；条带间拼缝', '高精度光纤惯导、安装偏差标定、后处理平滑'],
            ['底质与掠射角差异', '$S_b$ 随底质与掠射角剧烈变化', '图像"中间亮两头黑"；底质分类混淆', '入射角增益改正 + 底质分类模型；多频对照'],
            ['拖鱼位置误差', '超短基线/长基线定位误差、拖缆释放长度估计误差', '图像拼接错位、目标坐标不准', '声学定位 + 惯导组合；同步标定；条带互配准'],
            ['旁瓣污染', '相邻波束旁瓣叠加到目标波束', '强目标两侧出现假"条带影子"', '空间锥削压旁瓣；检测门限提高；相位差检测复核'],
            ['目标阴影识别', '阴影长度反演高度依赖掠射角与拖鱼高度', '高度算错、目标误判（岩石 vs 沉船）', '先斜距改正再量影长；结合多视角；人工复核'],
            ['斑点与弱目标', '单视斑点 ENL=1，弱小目标（锚链、管线）淹没', '漏检小目标', '多视 / Lee / 小波去噪后自动检测 + 人工复核双轨']
          ] },
          { t: 'callout', kind: 'pit', title: '坑：TVG 设错把图像"调"出假纹理', md: '侧扫的 TVG 若按 $20\\lg R$ 设置（应为 $40\\lg R$ 或按实测 $S_b$ 曲线），远距回波被系统性压低，图像上出现随距离的亮度梯度——初学者常把它当成"海底倾斜"或"底质变化"去解译，得出完全错误的结论。**判读图像前先检查增益链**：近距削波、远距淹没、随距离的条纹，三者都是增益设置错误的指纹。' },
          { t: 'callout', kind: 'eng', title: '工程师视角：条带重叠区是免费的质检工具', md: '规范作业要求相邻条带保持 20%～50% 重叠。重叠区的同名点深度差，就是声速、姿态、定位误差的**现场体检报告**：系统性碗状差 → 声速剖面问题；方向性倾斜 → 姿态安装偏差；随机散布 → 底检测抖动。会读重叠区误差图的项目组，返工率能低一半。' }
        ]
      },
      {
        id: 'sum', num: '7', title: '小结',
        blocks: [
          { t: 'md', md: '测深链的核心账：深度 = 斜距 × cosθ，误差随 1/cosθ 放大——所以**声速与姿态这两个"非声学"传感器决定了产品精度上限**；成像链的核心账：灰度 ∝ 底散射强度 × 乘性斑点，斑点是乘性的——所以**去噪要么变换域（对数/小波）、要么乘性模型专用滤波器、要么物理性多视**，直接套高斯滤波是错的。' },
          { t: 'chips', list: ['多波束', '声线弯曲', '相位差检测', '斑点噪声', '多视', '小波阈值', '各向异性扩散'], cls: 'teal' }
        ]
      }
    ],
    refs: REFS
  });

  /* ============================================================
     案例五：水下信道多普勒补偿与运动目标回波积累
     ============================================================= */

  /** 交互仿真：多普勒对脉压的三种影响与三种补偿的对决 */
  function simDoppler(el) {
    const F0 = 12000;                                  // 中心频率 Hz
    const PRI = 0.1;                                   // 脉冲重复周期 s
    const st = { v: 8, B: 3000, T: 40, Np: 12, comp: 'all' };

    const boxL = UI.plotBox({ title: '脉压峰值损失：三条补偿路线的对决' });
    const pL = P.new(boxL.canvas, { height: 250, xlabel: '目标径向速度 / m/s', ylabel: '峰相对无失配 / dB', legend: true });
    const boxM = UI.plotBox({ title: '脉冲串距离剖面（未补偿）：距离徙动' });
    const boxR = UI.plotBox({ title: '宽带补偿后：脉冲串距离剖面' });
    const boxD = UI.plotBox({ title: '多普勒滤波器组输出（脉内并行复制相关 → 速度轴）' });
    const pD = P.new(boxD.canvas, { height: 220, xlabel: '多普勒通道对应速度 / m/s', ylabel: '幅度 / dB', legend: true });

    const mBox = h('div.metrics');
    const note = h('div.prose');
    const grid = h('div.grid.g3', {}, [boxM.el, boxR.el, boxD.el]);

    /** 单脉冲基带 LFM（fs = B，一个距离单元 = c/2B） */
    function chirpRef(M, k) {
      const ur = new Float64Array(M), ui = new Float64Array(M);
      for (let m = 0; m < M; m++) {
        const t = m / st.B; const ph = Math.PI * k * t * t;
        ur[m] = Math.cos(ph); ui[m] = Math.sin(ph);
      }
      return { re: ur, im: ui };
    }

    /** 生成第 p 个脉冲的基带回波（含尺度 η、多普勒相位、距离徙动） */
    function pulseEcho(p, k, M, Wlen) {
      const eta = 1 + 2 * st.v / CW;
      const fd = 2 * st.v * F0 / CW;
      const tau = 2 * (60 - st.v * p * PRI) / CW;      // 距离徙动：每脉冲前进 v·PRI
      const o = { re: new Float64Array(Wlen), im: new Float64Array(Wlen) };
      const t0 = tau;
      let n0 = Math.floor(t0 * st.B) - 2, n1 = Math.ceil((t0 + Math.min(PRI, st.T / 1000 / eta)) * st.B) + 2;
      if (n0 < 0) n0 = 0;
      if (n1 > Wlen - 1) n1 = Wlen - 1;
      for (let n = n0; n <= n1; n++) {
        const t = n / st.B;
        const tt = eta * (t - tau);
        if (tt < 0 || tt > st.T / 1000) continue;
        const ph = Math.PI * k * tt * tt + 2 * Math.PI * fd * t;
        o.re[n] = Math.cos(ph); o.im[n] = Math.sin(ph);
      }
      return { sig: o, tau: tau, eta: eta, fd: fd };
    }

    /** 宽带通道模板：u(η·t)·e^{j2πfd t} —— 尺度化 chirp（斜率 kη²、脉宽 T/η）+ 频移 */
    function wideTemplate(eta, fd, k, fs, T) {
      const Mw = Math.max(8, Math.round(T / eta * fs));
      const kw = k * eta * eta;
      const hw = { re: new Float64Array(Mw), im: new Float64Array(Mw) };
      for (let m = 0; m < Mw; m++) {
        const t = m / fs;
        const ph = Math.PI * kw * t * t + 2 * Math.PI * fd * t;
        hw.re[m] = Math.cos(ph); hw.im[m] = Math.sin(ph);
      }
      return hw;
    }

    /** 固定距离门（真时延附近 ±3 个距离单元）上的峰，相对该通道模板长度 M 的损失 */
    function lossAt(y, bin, M) {
      let pk = 0;
      for (let i = Math.max(0, bin - 3); i <= Math.min(y.re.length - 1, bin + 3); i++) {
        const m = y.re[i] * y.re[i] + y.im[i] * y.im[i];
        if (m > pk) pk = m;
      }
      return 10 * Math.log10(Math.max(Math.sqrt(pk), 1e-9) / M);
    }

    function recalc() {
      const fs = st.B;                                  // 基带采样率 = 带宽
      const T = st.T / 1000;
      const M = Math.max(16, Math.round(T * fs));
      const k = st.B / T;
      const Wlen = Math.round(PRI * fs);                // 每脉冲接收窗
      const Np = Math.max(1, Math.round(st.Np));

      /* ---------- 1. 峰值损失 vs 速度（单脉冲，三条补偿路线） ---------- */
      const vs = [], lossNone = [], lossNb = [], lossWb = [];
      for (let iv = -15; iv <= 15; iv += 1) {
        vs.push(iv);
        const eta = 1 + 2 * iv / CW;
        const fd = 2 * iv * F0 / CW;
        // 无失配参考峰
        const ref = chirpRef(M, k);
        let mRef = 0;
        for (let i = 0; i < M; i++) mRef += 1;          // 峰 = M（模值）
        // 单脉冲回波（不含噪声；时延放窗中部）
        const tau = Wlen / fs * 0.35;
        const e = { re: new Float64Array(Wlen), im: new Float64Array(Wlen) };
        for (let n = 0; n < Wlen; n++) {
          const t = n / fs;
          const tt = eta * (t - tau);
          if (tt < 0 || tt > T) continue;
          const ph = Math.PI * k * tt * tt + 2 * Math.PI * fd * t;
          e.re[n] = Math.cos(ph); e.im[n] = Math.sin(ph);
        }
        // ① 无补偿
        lossNone.push(lossAt(C.matchedFilterC(e, ref), Math.round(tau * fs), M));
        // ② 窄带：仅频移补偿
        const nb = { re: new Float64Array(Wlen), im: new Float64Array(Wlen) };
        for (let n = 0; n < Wlen; n++) {
          const t = n / fs, ph = -2 * Math.PI * fd * t;
          const c = Math.cos(ph), s = Math.sin(ph);
          nb.re[n] = e.re[n] * c - e.im[n] * s;
          nb.im[n] = e.re[n] * s + e.im[n] * c;
        }
        lossNb.push(lossAt(C.matchedFilterC(nb, ref), Math.round(tau * fs), M));
        // ③ 宽带：通道参考 = 尺度化 chirp + 频移（在参考侧完成补偿，无插值损失；
        //    模板长度 M/η，损失按本通道模板长度归一）
        const hw = wideTemplate(eta, fd, k, fs, T);
        lossWb.push(lossAt(C.matchedFilterC(e, hw), Math.round(tau * fs), hw.re.length));
      }

      /* ---------- 2. 脉冲串距离剖面（未补偿 vs 宽带补偿 + 距离对准） ---------- */
      // 剖面显示用汉宁加权参考压旁瓣（便于读图；损失曲线用未加权参考）
      const ref = chirpRef(M, k);
      const etaV = 1 + 2 * st.v / CW;
      const fdV = 2 * st.v * F0 / CW;
      const hwT = wideTemplate(etaV, fdV, k, fs, T);       // 宽带通道模板
      const refW = cpx(M), hwTW = cpx(hwT.re.length);
      const wA = C.window('hann', M), wB = C.window('hann', hwT.re.length);
      for (let i = 0; i < M; i++) { refW.re[i] = ref.re[i] * wA[i]; refW.im[i] = ref.im[i] * wA[i]; }
      for (let i = 0; i < hwT.re.length; i++) { hwTW.re[i] = hwT.re[i] * wB[i]; hwTW.im[i] = hwT.im[i] * wB[i]; }
      const profNone = [], profWb = [];
      for (let p = 0; p < Np; p++) {
        const pe = pulseEcho(p, k, M, Wlen);
        const y0 = C.matchedFilterC(pe.sig, refW);
        const mag0 = new Float64Array(Wlen);
        for (let i = 0; i < Wlen; i++) mag0[i] = Math.sqrt(y0.re[i] * y0.re[i] + y0.im[i] * y0.im[i]);
        profNone.push(mag0);
        // 宽带补偿（尺度化模板）后，再按已知速度做跨脉冲距离对准
        const y1 = C.matchedFilterC(pe.sig, hwTW);
        const mag1 = new Float64Array(Wlen);
        for (let i = 0; i < Wlen; i++) mag1[i] = Math.sqrt(y1.re[i] * y1.re[i] + y1.im[i] * y1.im[i]);
        const dShift = Math.round(2 * st.v * p * PRI / CW * fs);   // 第 p 脉冲相对第 0 脉冲的走移
        const magA = new Float64Array(Wlen);
        for (let i = 0; i < Wlen; i++) {
          const j = i - dShift;
          magA[i] = (j >= 0 && j < Wlen) ? mag1[j] : 0;
        }
        profWb.push(magA);
      }
      // dB 化并截断动态范围（热力图布局：data[i*Np + p]，列 = 距离、行 = 脉冲）
      const matDb = mat => {
        let mx = 0;
        mat.forEach(r => r.forEach(v => { if (v > mx) mx = v; }));
        const out = new Float32Array(Wlen * Np);
        for (let p = 0; p < mat.length; p++) {
          for (let i = 0; i < Wlen; i++) {
            out[i * Np + p] = Math.max(20 * Math.log10(Math.max(mat[p][i], 1e-12) / mx), -35);
          }
        }
        return { data: out, mx: mx };
      };
      const mN = matDb(profNone), mW = matDb(profWb);
      P.heatmap(boxM.canvas, {
        data: mN.data, cols: Wlen, rows: Np,
        xlim: [0, Wlen * CW / (2 * fs)], ylim: [0, Np - 1],
        vmin: -35, vmax: 0, flipY: true, height: 220,
        xlabel: '距离 / m', ylabel: '脉冲序号',
        title: '未补偿：目标亮线随脉冲序号移动'
      });
      P.heatmap(boxR.canvas, {
        data: mW.data, cols: Wlen, rows: Np,
        xlim: [0, Wlen * CW / (2 * fs)], ylim: [0, Np - 1],
        vmin: -35, vmax: 0, flipY: true, height: 220,
        xlabel: '距离 / m', ylabel: '脉冲序号',
        title: '宽带补偿 + 距离对准后：亮线回到固定距离'
      });

      /* ---------- 3. 多普勒滤波器组（脉内并行复制相关 → 速度轴） ---------- */
      // 每个通道对一个速度假设：频移 + 尺度化模板做匹配滤波，在目标距离门上取输出幅度
      // （跟踪型处理；检测型则全距离搜索各通道峰值，靠模糊函数脊的斜率解距离-多普勒耦合）
      const pe0 = pulseEcho(0, k, M, Wlen);
      const vMax = Math.min(16, Math.max(10, Math.abs(st.v) + 2));
      const chN = 81;
      const vStep = 2 * vMax / (chN - 1);
      const vax = [], vdb = [];
      const bank = new Float64Array(chN);
      let bankMax = 0, bankIdx = 0;
      const gate = Math.round(pe0.tau * fs);
      for (let m = 0; m < chN; m++) {
        const vv = -vMax + m * vStep;
        const fAss = 2 * vv * F0 / CW;                 // 通道假设的多普勒
        const hw = wideTemplate(1 + 2 * vv / CW, fAss, k, fs, T);
        const y = C.matchedFilterC(pe0.sig, hw);
        let bv = 0;
        for (let i = Math.max(0, gate - 3); i <= Math.min(y.re.length - 1, gate + 3); i++) {
          const m2 = y.re[i] * y.re[i] + y.im[i] * y.im[i];
          if (m2 > bv) bv = m2;
        }
        bank[m] = bv;
        vax.push(vv);
        if (bv > bankMax) { bankMax = bv; bankIdx = m; }
      }
      for (let m = 0; m < chN; m++) vdb.push(20 * Math.log10(Math.max(bank[m] / bankMax, 1e-6)));
      const vEst = vax[bankIdx];

      /* ---------- 4. 指标 ---------- */
      const fd = 2 * st.v * F0 / CW;
      const eta = 1 + 2 * st.v / CW;
      const curIdx = Math.round(st.v) + 15;
      const mig = st.v * Np * PRI;
      const dv = CW / (2 * F0) / (Np * PRI);          // 速度分辨率
      U.clear(mBox);
      [
        ['多普勒频移 fd', fd.toFixed(1), 'Hz'],
        ['fd / f0', (fd / F0 * 100).toFixed(3), '%'],
        ['时间尺度 η−1', ((eta - 1) * 100).toFixed(3), '%'],
        ['未补偿峰损', lossNone[curIdx].toFixed(1), 'dB'],
        ['窄带补偿峰损', lossNb[curIdx].toFixed(1), 'dB'],
        ['宽带补偿峰损', lossWb[curIdx].toFixed(1), 'dB'],
        ['积累期距离徙动', mig.toFixed(2), 'm'],
        ['速度估计（峰值通道）', vEst.toFixed(2), 'm/s'],
        ['滤波器组通道间隔', vStep.toFixed(2), 'm/s']
      ].forEach(m => mBox.appendChild(h('div.metric', {}, [
        h('div.m-l', { text: m[0] }),
        h('div.m-v', { text: m[1] }),
        m[2] ? h('div', {}, h('span.m-u', { text: m[2] })) : null
      ])));

      /* ---------- 5. 绘图 ---------- */
      pL.clear()
        .add({ x: vs, y: lossNone, type: 'line', color: 0, width: 1.8, label: '无补偿' })
        .add({ x: vs, y: lossNb, type: 'line', color: 1, width: 1.8, label: '窄带（仅频移）补偿' })
        .add({ x: vs, y: lossWb, type: 'line', color: 2, width: 1.8, dash: [5, 3], label: '宽带（尺度 + 相位）补偿' })
        .vline(st.v, { label: '当前 ' + st.v.toFixed(1) + ' m/s' })
        .draw();
      pD.clear()
        .add({ x: vax, y: vdb, type: 'stem', color: 0, width: 1.6 })
        .vline(st.v, { label: '真实速度 ' + st.v.toFixed(1) + ' m/s' })
        .draw();
      /* ---------- 6. 动态解读 ---------- */
      note.innerHTML = U.md(
        '**当前状态解读：** 径向速度 ' + st.v.toFixed(1) + ' m/s（约 ' + (st.v * 1.94).toFixed(0) + ' 节）→ 多普勒 $f_d = 2vf_0/c = ' + fd.toFixed(0) +
        '\\,\\text{Hz}$，相对带宽 $f_d/f_0 = ' + (fd / F0 * 100).toFixed(3) + '\\%$（声速只有 $1500\\,\\text{m/s}$，这是电磁波十万分之一量级的比值，**水声多普勒天生严重**）。它同时干两件事：给回波加一个线性相位（时频移 $f_d$），并把波形在时间轴上拉伸 $\\eta-1=' + ((eta - 1) * 100).toFixed(3) + '\\%$。' +
        ' 判据 $\\eta B T \\gtrsim 1$：当前 $BT = ' + (st.B * T).toFixed(0) + '$ → 临界速度约 $c/(2BT) = ' + (CW / (2 * st.B * T)).toFixed(1) +
        '\\,\\text{m/s}$。' + (st.v > CW / (2 * st.B * T)
          ? '**已越过临界速度**：看左图，无补偿掉 ' + lossNone[curIdx].toFixed(1) + ' dB；只做频移补偿（橙线）仍然损失 ' + lossNb[curIdx].toFixed(1) + ' dB——因为频移没有修复时间轴拉伸；只有"重采样 + 残余相位解斜"（绿虚线）把峰拉了回来。'
          : ' 尚未越界，频移补偿（橙线）与宽带补偿（绿虚线）几乎重合——**窄带假设在小 BT 或低速时是够用的**，盲目上重采样是浪费。') +
        ' 脉冲串积累：' + Np + ' 个脉冲、重复周期 ' + (PRI * 1000).toFixed(0) + ' ms → 积累时间 ' + (Np * PRI).toFixed(1) + ' s，目标距离随之变化 ' + mig.toFixed(2) +
        ' m = ' + (mig / (CW / (2 * st.B))).toFixed(1) + ' 个距离单元——中图亮线的斜率就是距离徙动，宽带补偿后（右图）亮线回到固定距离门，跨脉冲才能相干相加。' +
        ' 速度通道：滤波器组按 $\\pm' + vMax.toFixed(0) + '\\,\\text{m/s}$ 铺开 ' + chN + ' 个速度假设，每路用"频移 + 尺度化"模板做匹配滤波，在目标距离门上取输出——峰值通道即速度估计（' + vEst.toFixed(2) +
        ' m/s，真实 ' + st.v.toFixed(1) + ' m/s），通道间隔 ' + vStep.toFixed(2) + ' m/s。注意它与左图的差别：**滤波器组曲线是损失曲线的"镜像"**（通道对了峰就回来）；而检测型处理在距离未知的全距离上搜各通道峰值，单脉冲 LFM 的模糊函数脊会让"峰高"对速度不敏感——这正是检测用滤波器组、测速靠通道间峰位差或双向 chirp 的工程分工原因。'
      );
      UI.renderMathIn(note);
    }
    const rec = U.rafThrottle(recalc);

    const sV = UI.slider({ label: '目标径向速度', min: -15, max: 15, step: 0.5, value: st.v, unit: 'm/s', hint: '正值 = 靠近（时间被压缩）', onInput: () => rec() });
    const sB = UI.slider({ label: '信号带宽 B', min: 500, max: 5000, step: 250, value: st.B, unit: 'Hz', hint: 'BT 越大，宽带效应越早显现', onInput: () => rec() });
    const sT = UI.slider({ label: '脉宽 T', min: 10, max: 80, step: 5, value: st.T, unit: 'ms', hint: '与带宽共同决定临界速度 c/2BT', onInput: () => rec() });
    const sNp = UI.slider({ label: '积累脉冲数', min: 1, max: 24, step: 1, value: st.Np, unit: '个', hint: '相干积累增益 10lgNp，但要求距离门内对齐', onInput: () => rec() });

    el.appendChild(UI.ctrlPanel('仿真参数', [sV, sB, sT, sNp]));
    el.appendChild(boxL.el);
    el.appendChild(grid);
    el.appendChild(mBox);
    el.appendChild(h('div.plot-cap', { html: U.md('上：固定距离门上的单脉冲脉压峰损失随速度的曲线（三条补偿路线；损失含距离-多普勒耦合引起的峰移）。下排：' + PRI * 1000 + ' ms 重复周期的脉冲串距离剖面（已加汉宁权压旁瓣）——未补偿时目标亮线随脉冲序号滑动（距离徙动），宽带补偿并做距离对准后亮线回到固定距离门；最右为脉内并行复制相关构成的多普勒滤波器组输出，峰值通道给出速度估计。') }));
    el.appendChild(note);
    recalc();
  }

  doc.register('cases/sonar/doppler', {
    title: '案例五：水下信道多普勒补偿与运动目标回波积累',
    lede: '声速 1500 m/s、目标 10 m/s，多普勒就占中心频率的 1.3%——比雷达恶劣十万倍。本节把"多普勒毁脉压"的两种机制（频移 + 时间拉伸）拆开算账，对比无补偿、窄带频移、宽带尺度三条路线，最后做成套的多普勒滤波器组并行脉压，把运动目标的脉冲串能量真正积累起来。',
    tags: ['水声', '多普勒', '重采样', '相参积累', '距离徙动'],
    labs: [{ path: 'lab/matched', title: '匹配滤波与脉冲压缩实验台', desc: '先在静止场景下熟悉脉压指标，再回头看多普勒失配' }],
    toc: true,
    sections: [
      {
        id: 'bg', num: '1', title: '工程背景：水声多普勒为什么天生严重',
        blocks: [
          { t: 'md', md: '多普勒的相对量级由 $f_d/f_0 = 2v/\\text{波速}$ 决定。电磁波速 $3\\times10^8\\,\\text{m/s}$：飞机 300 m/s → $2\\times10^{-6}$，雷达几乎可以无视；水声波速 $1500\\,\\text{m/s}$：目标 10 m/s → $1.33\\times10^{-2}$，**比值大十万倍**。后果立刻出现：雷达里"窄带近似"永远成立，水声里它有明确的失效边界。' },
          { t: 'metrics', list: [
            { label: 'fd/f0（雷达，3 m/s 目标）', value: '0.000002', unit: '' },
            { label: 'fd/f0（水声，10 m/s 目标）', value: '0.013', unit: '（十万倍）' },
            { label: '12 kHz 上的 fd（10 m/s）', value: '160', unit: 'Hz' },
            { label: '3 kHz 带宽内 fd 占比', value: '5.3', unit: '%' }
          ] },
          { t: 'md', md: '对主动声呐的三重打击：**① 脉压失配**——匹配滤波参考是零多普勒波形，失配让主瓣下降、展宽、平移（案例一已算过平移账）；**② 相参积累失效**——脉冲串积累要求脉冲间相位对齐，多普勒相位在脉冲间线性旋转，不对齐则积累增益归零；**③ 测速与测距耦合**——LFM 的距离-多普勒耦合让测距带进速度的系统误差。' },
          { t: 'callout', kind: 'eng', title: '工程师视角：先算临界速度再选方案', md: '宽带效应显现的判据是 $\\eta BT \\gtrsim 1$（$\\eta = 2v/c$）。$BT = 150$ → 临界速度 5 m/s（10 节）；$BT = 30$ → 25 m/s（50 节，鱼雷级）。**工程流程：先算自己波形的临界速度，低于它用频移补偿/多普勒滤波器组就够，高于它必须上重采样**。很多系统"多普勒补偿无效"的根因，就是拿窄带方法对付了宽带波形。' }
        ]
      },
      {
        id: 'model', num: '2', title: '信号模型：时间尺度 + 多普勒相位的严格形式',
        blocks: [
          { t: 'md', md: '接近目标（径向速度 $v$）的宽带回波模型：发射波形在时间轴上被压缩 $\\eta = 1+2v/c$ 倍，同时解调后残留载频偏移：' },
          { t: 'math', tex: 'r_p(t) = A\\,u\\!\\big(\\eta(t-\\tau_p)\\big)\\,e^{\\,j2\\pi f_d t}\\,e^{-j2\\pi f_0\\eta\\tau_p} + n_p(t),\\quad \\tau_p = \\frac{2(R_0 - v\\,p\\,T_r)}{c}', tag: '(1)' },
          { t: 'kv', title: '变量说明', pairs: [
            ['$\\eta = 1 + 2v/c$', '时间尺度因子；$v=10\\,\\text{m/s}$ → $\\eta-1 = 1.33\\%$，40 ms 脉宽的波形被压短 0.53 ms'],
            ['$f_d = 2vf_0/c$', '解调后的载频偏移（多普勒）；与 $\\eta$ 是同一个物理效应的两面'],
            ['$\\tau_p$', '第 $p$ 个脉冲的双程时延；脉冲间每步变化 $2vT_r/c$ —— 距离徙动的源头'],
            ['$T_r$', '脉冲重复周期（本节取 100 ms）'],
            ['$n_p(t)$', '各脉冲独立的噪声与混响']
          ] },
          { t: 'md', md: '注意 $\\eta$ 与 $f_d$ 不是两个独立参数——$f_d = f_0(\\eta-1)$。做"窄带补偿"只消掉了 $e^{j2\\pi f_d t}$，时间轴拉伸仍在；做"宽带补偿"要把 $u(\\eta(t-\\tau))$ 还原成 $u(t-\\tau)$。两者失效区间的分界就是 $\\eta BT \\approx 1$。' },
          { t: 'fold', summary: '展开：为什么"重采样 + 残余相位解斜"能把宽带回波完全还原', deriv: true, blocks: [
            { t: 'md', md: '解调后的基带回波为 $r_b(t) = u(\\eta(t-\\tau))e^{j2\\pi f_d t}$（固定相位因子略去）。**第一步：时间轴重采样**，令 $y_1(t) = r_b(t/\\eta)$：' },
            { t: 'math', tex: 'y_1(t) = u(t-\\eta\\tau)\\,e^{\\,j2\\pi f_d t/\\eta}' },
            { t: 'md', md: '波形已还原，但残留相位项 $e^{j2\\pi (f_d/\\eta)t}$。**第二步：残余解斜**，乘 $e^{-j2\\pi f_0(1-1/\\eta)t}$：注意 $f_d/\\eta = f_0(\\eta-1)/\\eta = f_0(1-1/\\eta)$，两个频率**严格相等**，所以' },
            { t: 'math', tex: 'y_2(t) = u(t-\\eta\\tau)\\,e^{j2\\pi f_0(1-1/\\eta)t}\\,e^{-j2\\pi f_0(1-1/\\eta)t} = u(t-\\eta\\tau)' },
            { t: 'md', md: '得到纯延迟的原始波形——这就是"尺度 + 相位"两步补偿的数学全貌。误差来源只有重采样插值（线性插值信噪比损失约 0.1～0.5 dB，升采样后插值可再降）与 $\\eta$ 估计误差。' }
          ] }
        ]
      },
      {
        id: 'algo', num: '3', title: '算法原理回顾：估计、补偿与积累',
        blocks: [
          { t: 'md', md: '**① 多普勒估计**（补偿的前提）：' },
          { t: 'table', cols: ['方法', '原理', '适用'], rows: [
            ['多脉冲相位差', '相邻脉冲回波在目标距离门上的相位差 $\\Delta\\varphi = 2\\pi f_d T_r$', '已有跟踪目标距离门，精度高、成本低'],
            ['回波自相关', '相邻脉冲回波的相关相位即 $f_d$', '信噪比中等，工程最常用'],
            ['回波谱峰', '对长脉冲回波直接看谱峰偏移', '单脉冲、高信噪比'],
            ['多通道滤波器组', '并行 $M$ 路不同 $f_d$ 假设分别脉压，取最大', '无需先验速度，检测型声呐标配'],
            ['分数阶傅里叶变换', 'LFM 在分数阶域能量最集中，搜索最佳阶数同时估 $k$ 与 $f_d$', '低信噪比、强多普勒耦合场景']
          ] },
          { t: 'md', md: '**② 补偿三法**：频移（窄带，乘 $e^{-j2\\pi\\hat f_d t}$）；重采样（宽带，插值 $t/\\hat\\eta$）；**多普勒滤波器组**（不显式估计，直接并行 $M$ 路假设——把"估计"变成"搜索"，用计算量换鲁棒性，是检测型声呐的主流结构）。' },
          { t: 'md', md: '**③ 脉冲串积累**：$N_p$ 个脉冲相干求和，增益 $10\\lg N_p$；代价是必须同时满足**相位对齐**（多普勒补偿）与**距离对齐**（距离徙动校正）。做不到相干时退化为非相干积累，增益约 $5\\lg N_p$ 量级（多损失一半）。跨距离单元徙动的目标，能量在距离-脉冲二维平面里呈斜线——Hough/Radon 变换沿斜线累加，可同时完成检测与速度估计（航迹起始前检测，TMA 的入口）。' },
          { t: 'math', tex: 'G_{\\text{相干}} = 10\\lg N_p,\\qquad G_{\\text{非相干}} \\approx 5\\lg N_p,\\qquad \\Delta v = \\frac{c}{2f_0\\,N_p T_r}', tag: '(2)' },
          { t: 'callout', kind: 'tip', title: '与知识库的对应关系', md: 'LFM 模糊函数与距离-多普勒耦合公式见案例一第 3 节；相参/非相干积累的理论在「随机信号与匹配滤波」一章；FRFT 的原理与实现见「分数阶傅里叶变换」知识页。' }
        ]
      },
      {
        id: 'chain', num: '4', title: '完整处理链路：从带多普勒的回波到速度-距离像',
        blocks: [
          { t: 'flow', v: true, items: [
            { t: '① 发射脉冲串（LFM × Np）', d: '输入：波形参数 $(f_0,B,T,T_r)$；输出：脉冲串。关键：重复周期按最大作用距离定，波形按临界速度预判' },
            { t: '② 接收链（前放 / TVG / ADC / 正交解调）', d: '同案例一①～⑥；关键：TVG 对脉冲串要按"距离 + 脉冲序号"双维设置' },
            { t: '③ 多通道复制相关（多普勒滤波器组）', d: '输入：基带回波；输出：$M$ 路（速度假设 × 距离）相关矩阵。关键：通道数 $=2v_{\\max}/\\Delta v$；每通道用 $f_d$ 预乘或重采样预补偿' },
            { t: '④ 距离徙动校正', d: '输入：相关矩阵；输出：距离对齐的脉冲串。关键：按通道速度做跨脉冲平移（keystone 变换的时域等价）' },
            { t: '⑤ 跨脉冲相干积累', d: '输入：对齐后的复数据；输出：积累后距离谱。关键：相位对齐精度 $\\le \\pi/4$；必要时用 FFT 完成跨脉冲滤波（等效速度精搜）' },
            { t: '⑥ 检测与参数估计', d: '输入：速度-距离像；输出：目标（距离、速度、电平）。关键：CFAR；速度由通道号给出，距离由峰位给出' },
            { t: '⑦ 航迹起始（Hough/Radon）', d: '输入：连续多 ping 的距离-脉冲图；输出：候选航迹。关键：沿斜线累加检测弱机动目标；斜率即速度' },
            { t: '⑧ 显示：距离-速度（RV）图', d: '输入：检测结果；输出：声呐员界面。关键：速度轴按通道映射；左右舷与多径的双峰要标注' }
          ] },
          { t: 'code', lang: 'python', title: '多普勒滤波器组 + 距离徙动校正（核心骨架）', src: 'import numpy as np\n\ndef doppler_bank(echo, ref, fd_max, fd_step, fs, c=1500, f0=12000, wideband=True):\n    """对一段接收数据并行尝试 M 个速度假设，返回 (M, N) 相关矩阵"""\n    M = int(2*fd_max/fd_step) + 1\n    out = np.zeros((M, len(echo)), complex)\n    for m in range(M):\n        fd = -fd_max + m*fd_step\n        v = fd * c / (2*f0)\n        eta = 1 + 2*v/c\n        x = echo.astype(complex)\n        if wideband and abs(eta-1) > 1e-4:\n            # 宽带：时间轴重采样 t -> t/eta（线性插值足够）\n            n = np.arange(len(x))\n            src = n * eta\n            x = np.interp(src, n, x.real) + 1j*np.interp(src, n, x.imag)\n        # 残余相位解斜（窄带部分，两种情况都需要）\n        t = np.arange(len(x)) / fs\n        x *= np.exp(-2j*np.pi*f0*(1-1/eta)*t)\n        # 匹配滤波\n        out[m] = np.fft.ifft(np.fft.fft(x) * np.conj(np.fft.fft(ref, len(x))))\n    return out\n\ndef range_align_and_integrate(bank_out, v_axis, pri, fs):\n    """按各通道速度平移对齐脉冲串，再跨脉冲相干积累"""\n    # bank_out: (M, Np, N) 每速度假设的脉冲串距离剖面\n    M, Np, N = bank_out.shape\n    integ = np.zeros((M, N), complex)\n    for m in range(M):\n        shift = v_axis[m] * pri * 2 / c * fs       # 每脉冲平移的样本数\n        for p in range(Np):\n            integ[m] += np.roll(bank_out[m, p], int(round(shift*p)))\n    return 20*np.log10(np.abs(integ).max(axis=1) + 1e-9)\n' }
        ]
      },
      {
        id: 'sim', num: '5', title: '交互仿真：三条补偿路线与脉冲串积累的现场验证',
        blocks: [
          { t: 'md', md: '仿真器用严格宽带模型（式 1）生成脉冲串回波：$\\eta$ 时间拉伸 + $f_d$ 相位 + 逐脉冲距离徙动，基带采样率取 $f_s = B$。四组实验：' },
          { t: 'md', md: '① **临界速度**：固定 $B=3\\,\\text{kHz}$、$T=40\\,\\text{ms}$（$BT=120$，临界速度 6.25 m/s），把速度从 0 拖到 15：无补偿曲线开始下坠，窄带补偿在中低速段有效、越过临界速度后与无补偿一起失效，只有宽带补偿持平。\n② **带宽的作用**：把 $B$ 拖到 500 Hz（小 BT 波形），三条曲线在全部速度范围内几乎重合——**窄带波形天生多普勒容忍**，代价是距离分辨率 1.5 m。\n③ **距离徙动**：把积累脉冲数拖到 24（积累 2.4 s），中图未补偿剖面的亮线斜率肉眼可见，宽带补偿后对齐——相干积累的前提。\n④ **速度通道**：看多普勒滤波器组输出，峰值通道位置应落在真实速度虚线上；通道间隔由 $\\Delta v = c/(2f_0N_pT_r)$ 决定，脉冲数越多峰越窄。' },
          { t: 'widget', render: function (el) { simDoppler(el); } },
          { t: 'callout', kind: 'note', title: '为什么"无补偿"曲线在零速两侧对称下降', md: 'LFM 对多普勒失配的峰损失近似 $|\\mathrm{sinc}(\\pi f_d T (1-|f_d|/B))|$，只依赖 $|f_d|$，所以曲线关于零速对称；而"窄带补偿"曲线之所以在高速段仍然下坠，是因为它消掉了相位却没有修复时间拉伸——残余失配量 $\\eta-1$ 随速度单调增长，直到宽带补偿（重采样）把它归零。三条曲线的间距，就是"选对补偿方法"的价值。' }
        ]
      },
      {
        id: 'limit', num: '6', title: '工程局限与实际难题',
        blocks: [
          { t: 'table', cols: ['难题', '机理', '后果', '对策'], rows: [
            ['宽带与窄带搞混', '对大 BT 波形只做频移补偿', '高速目标脉压峰仍然损失 3～10 dB，系统"莫名其妙"掉指标', '按 η·BT ≳ 1 判据选路线；大 BT 一律重采样（或滤波器组按尺度设通道）'],
            ['匀速假设', '目标机动时 $\\eta$、$\\tau_p$ 随时间变', '积累期间补偿失配，增益退化', '分段补偿 + 航迹更新；积累长度按机动性截断'],
            ['多径导致多普勒双峰', '直达声与海面反射的多普勒不同（掠射角不同）', '速度通道出现双峰，测速模糊、虚警', '波束形成先分离多途；速度通道聚簇；结合方位判别'],
            ['平台自身运动', '本舰速度叠加在 $\\eta$ 与徙动上', '静止海底回波也带多普勒，通道被本舰速度占据', '惯导速度预补偿（对海杂波/混响的"平台多普勒剔除"）'],
            ['跨距离单元徙动', '积累期 $vN_pT_r$ 超过距离单元', '能量分散在多个距离门，积累增益打折', '距离徙动校正（keystone / 逐通道平移）或缩短积累段'],
            ['重采样插值损失', '线性插值等效低通，带边信号被削弱', '宽带补偿本身引入 0.1～0.5 dB 损失', '升采样后再插值；或用频域相位校正替代时域插值'],
            ['速度通道数爆炸', '$M = 2v_{\\max}/\\Delta v$，长积累时 $\\Delta v$ 很小', '并行通道数上百，计算量翻倍', '两级搜索（粗通道组 + 精化）；频域快速实现；化"估计"为"搜索"的调度策略']
          ] },
          { t: 'callout', kind: 'pit', title: '坑：宽带信号用频移补偿（最容易犯、最难察觉的错误）', md: '频移补偿在窄带里永远正确，在宽带里"看起来也在工作"——峰确实回来了，只是低了 3～8 dB，而且速度越高速降越多。这种损失混在传播损失起伏与目标强度起伏里，**很难从现场数据里直接看出来**，只能靠桌面复算。自检方法：对同一组数据分别跑"频移版"与"重采样版"脉压，比较峰差；峰差超过 1 dB 就说明你的波形已经进入宽带区。' },
          { t: 'callout', kind: 'eng', title: '工程师视角：检测用滤波器组，跟踪用估计器', md: '检测型声呐不估计多普勒——它**并行铺开 M 个速度假设**，每路独立脉压、独立 CFAR，谁的峰高信谁。这是把"估计精度"问题转化为"通道密度"问题，鲁棒性极高，代价是计算量；现代实现靠 FFT 与分组复用把 M 压到几十。而跟踪型处理（已有目标航迹）才用显式估计（相位差/自相关）做精补偿。**两套结构并存，按数据流阶段切换**——这是运动目标处理链的标准分工。' }
        ]
      },
      {
        id: 'sum', num: '7', title: '小结与配套实验台',
        blocks: [
          { t: 'md', md: '三笔账收尾：**多普勒有多严重**——$f_d/f_0 = 2v/c$，水声比雷达恶劣十万倍；**补偿选哪条路**——判据 $\\eta BT \\gtrsim 1$，宽带必须重采样、窄带频移即可；**积累怎么不白做**——相位对齐（多普勒补偿）与距离对齐（徙动校正）缺一不可，否则 $10\\lg N_p$ 的增益只剩一半甚至归零。' },
          { t: 'lab', item: { path: 'lab/matched', title: '匹配滤波与脉冲压缩实验台', desc: '在静止场景实测 BT 与处理增益，为多普勒账本提供基准' } },
          { t: 'chips', list: ['宽带多普勒', '时间尺度 η', '重采样补偿', '多普勒滤波器组', '距离徙动', '相参积累'], cls: 'teal' }
        ]
      }
    ],
    refs: REFS
  });

})(window);
