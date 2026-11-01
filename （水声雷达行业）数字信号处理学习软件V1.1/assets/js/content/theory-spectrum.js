/* =============================================================
   theory-spectrum.js —— 知识理论库 · 四、谱估计（3 页）
   路由：theory/spectrum/*

   内容写入方式：结构化 block（见 doc.js 头部注释）
   本文件未改动 core：AR（Levinson-Durbin / Burg）、MUSIC、ESPRIT、
   Pisarenko 求根均在本文件内自建实现，仅调用 DSP.core 的
   periodogram / pwelch / psdBartlett / autocorr 等基础算子。
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const doc = DSP.doc;
  const C = DSP.core;
  const U = DSP.util;

  /* ============================================================
     §0 本页自建算法（不修改 core）
     ------------------------------------------------------------
     · acfBiased   有偏自相关估计
     · levinson    Levinson-Durbin 递推（Yule-Walker 解）
     · burg        Burg 前后向预测误差最小化
     · arSpectrumAt AR 功率谱
     · eigSym      实对称矩阵 Jacobi 特征分解
     · snapCovFB   汉克快照协方差 + 前后向平均
     · musicAt     MUSIC 伪谱
     · espritFreqs ESPRIT 频率封闭解
     · rootsDK     Durand-Kerner 复系数多项式求根
     ============================================================ */

  /* ---------- 复数标量 ---------- */
  function cMul(a, b) { return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }; }
  function cSub(a, b) { return { re: a.re - b.re, im: a.im - b.im }; }
  function cDiv(a, b) {
    const d = b.re * b.re + b.im * b.im;
    return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
  }
  function cAbs(a) { return Math.sqrt(a.re * a.re + a.im * a.im); }

  /* ---------- 霍纳法求复系数多项式值（降幂排列） ---------- */
  function polyvalC(cRe, cIm, z) {
    let r = 0, im = 0;
    for (let k = 0; k < cRe.length; k++) {
      const nr = r * z.re - im * z.im + cRe[k];
      const ni = r * z.im + im * z.re + cIm[k];
      r = nr; im = ni;
    }
    return { re: r, im: im };
  }

  /* ---------- Durand-Kerner 复系数多项式求根 ---------- */
  function rootsDK(cRe, cIm) {
    const n = cRe.length - 1;
    const aR = new Float64Array(n + 1), aI = new Float64Array(n + 1);
    const lr = cRe[0], li = cIm[0];
    const dl = lr * lr + li * li || 1e-30;
    for (let k = 0; k <= n; k++) {
      aR[k] = (cRe[k] * lr + cIm[k] * li) / dl;
      aI[k] = (cIm[k] * lr - cRe[k] * li) / dl;
    }
    const zR = new Float64Array(n), zI = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const ang = 2 * Math.PI * i / n + 0.31;
      zR[i] = 0.72 * Math.cos(ang); zI[i] = 0.72 * Math.sin(ang);
    }
    for (let it = 0; it < 300; it++) {
      let maxd = 0;
      for (let i = 0; i < n; i++) {
        const zi = { re: zR[i], im: zI[i] };
        const num = polyvalC(aR, aI, zi);
        let den = { re: 1, im: 0 };
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          den = cMul(den, cSub(zi, { re: zR[j], im: zI[j] }));
        }
        const corr = cDiv(num, den);
        zR[i] -= corr.re; zI[i] -= corr.im;
        const d = Math.abs(corr.re) + Math.abs(corr.im);
        if (d > maxd) maxd = d;
      }
      if (maxd < 1e-13) break;
    }
    const out = [];
    for (let i = 0; i < n; i++) out.push({ re: zR[i], im: zI[i] });
    return out;
  }

  /* ---------- 实对称矩阵 Jacobi 特征分解 ----------
     返回 { d: 特征值降序, V: 特征向量按列存放（V[i*n+j] 为第 j 个特征向量的第 i 个分量） } */
  function eigSym(Ain, n) {
    const A = Float64Array.from(Ain);
    const V = new Float64Array(n * n);
    for (let i = 0; i < n; i++) V[i * n + i] = 1;
    for (let sweep = 0; sweep < 60; sweep++) {
      let off = 0;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] * A[p * n + q];
      if (off < 1e-26) break;
      for (let p = 0; p < n; p++) {
        for (let q = p + 1; q < n; q++) {
          const apq = A[p * n + q];
          if (Math.abs(apq) < 1e-20) continue;
          const app = A[p * n + p], aqq = A[q * n + q];
          const theta = (aqq - app) / (2 * apq);
          const sg = theta >= 0 ? 1 : -1;
          const t = sg / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          const c = 1 / Math.sqrt(1 + t * t), s = t * c;
          for (let k = 0; k < n; k++) {
            const akp = A[k * n + p], akq = A[k * n + q];
            A[k * n + p] = c * akp - s * akq;
            A[k * n + q] = s * akp + c * akq;
          }
          for (let k = 0; k < n; k++) {
            const apk = A[p * n + k], aqk = A[q * n + k];
            A[p * n + k] = c * apk - s * aqk;
            A[q * n + k] = s * apk + c * aqk;
          }
          for (let k = 0; k < n; k++) {
            const vkp = V[k * n + p], vkq = V[k * n + q];
            V[k * n + p] = c * vkp - s * vkq;
            V[k * n + q] = s * vkp + c * vkq;
          }
        }
      }
    }
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) d[i] = A[i * n + i];
    const idx = [];
    for (let i = 0; i < n; i++) idx.push(i);
    idx.sort((a, b) => d[b] - d[a]);
    const dS = new Float64Array(n), VS = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      dS[i] = d[idx[i]];
      for (let r = 0; r < n; r++) VS[r * n + i] = V[r * n + idx[i]];
    }
    return { d: dS, V: VS };
  }

  /* ---------- 有偏自相关 r[0..p] ---------- */
  function acfBiased(x, p) {
    const N = x.length, r = new Float64Array(p + 1);
    for (let m = 0; m <= p; m++) {
      let s = 0;
      for (let n = m; n < N; n++) s += x[n] * x[n - m];
      r[m] = s / N;
    }
    return r;
  }

  /**
   * Levinson-Durbin 递推
   * @param {Float64Array} r 自相关 r[0..p]
   * @param {number} p 阶数
   * @returns {{a:number[], e:number, k:Float64Array}} a=[1,a1,...,ap]，e 为白噪声方差，k 为反射系数
   */
  function levinson(r, p) {
    const a = [1];
    let e = r[0];
    const k = new Float64Array(p + 1);
    for (let m = 1; m <= p; m++) {
      let s = r[m];
      for (let i = 1; i < a.length; i++) s += a[i] * r[m - i];
      const kk = -s / e;
      k[m] = kk;
      const an = new Array(m + 1);
      an[0] = 1;
      for (let i = 1; i < m; i++) an[i] = a[i] + kk * a[m - i];
      an[m] = kk;
      a.length = 0;
      for (let i = 0; i <= m; i++) a.push(an[i]);
      e *= (1 - kk * kk);
    }
    return { a: a, e: e, k: k };
  }

  /**
   * Burg 方法：最小化前向与后向预测误差功率之和
   * @param {Float64Array} x 数据
   * @param {number} p 阶数
   */
  function burg(x, p) {
    const N = x.length;
    const f = Float64Array.from(x), b = Float64Array.from(x);
    const a = [1];
    const k = new Float64Array(p + 1);
    let e = 0;
    for (let i = 0; i < N; i++) e += x[i] * x[i];
    e /= N;
    for (let m = 1; m <= p; m++) {
      let num = 0, den = 0;
      for (let n = m; n < N; n++) {
        num += f[n] * b[n - 1];
        den += f[n] * f[n] + b[n - 1] * b[n - 1];
      }
      const kk = den > 1e-30 ? -2 * num / den : 0;
      k[m] = kk;
      const an = new Array(m + 1);
      an[0] = 1;
      for (let i = 1; i < m; i++) an[i] = a[i] + kk * a[m - i];
      an[m] = kk;
      a.length = 0;
      for (let i = 0; i <= m; i++) a.push(an[i]);
      for (let n = N - 1; n >= m; n--) {
        const fn = f[n], bn1 = b[n - 1];
        f[n] = fn + kk * bn1;         // f_m[n] = f_{m-1}[n] + k_m·b_{m-1}[n-1]
        b[n] = bn1 + kk * fn;         // b_m[n] = b_{m-1}[n-1] + k_m·f_{m-1}[n]
      }
      e *= (1 - kk * kk);
    }
    return { a: a, e: e, k: k };
  }

  /** AR 功率谱 P(f) = σ² / |1 + Σ a_k e^{-j2πfk/fs}|² */
  function arSpectrumAt(a, sigma2, freqs, fs) {
    const o = new Float64Array(freqs.length);
    for (let i = 0; i < freqs.length; i++) {
      const w = 2 * Math.PI * freqs[i] / fs;
      let sr = 1, si = 0;
      for (let k = 1; k < a.length; k++) { sr += a[k] * Math.cos(w * k); si -= a[k] * Math.sin(w * k); }
      o[i] = sigma2 / Math.max(sr * sr + si * si, 1e-30);
    }
    return o;
  }

  /** 由 AR 系数求极点（频率，并给出半径） */
  function arPoles(a, fs) {
    const zs = rootsDK(a, new Float64Array(a.length));
    return zs.map(z => ({ freq: Math.atan2(z.im, z.re) / (2 * Math.PI) * fs, radius: cAbs(z) }))
      .filter(o => o.freq > 0)
      .sort((x, y) => x.freq - y.freq);
  }

  /** 汉克快照协方差（前向） */
  function snapCov(x, M, K) {
    const R = new Float64Array(M * M);
    for (let k = 0; k < K; k++) {
      for (let i = 0; i < M; i++) {
        const xi = x[k + i];
        for (let j = 0; j < M; j++) R[i * M + j] += xi * x[k + j];
      }
    }
    for (let t = 0; t < M * M; t++) R[t] /= K;
    return R;
  }

  /** 汉克快照协方差 + 前后向平均（恢复相干源秩，等价于空间平滑的前后向版） */
  function snapCovFB(x, M, K) {
    const R = snapCov(x, M, K);
    const Rb = new Float64Array(M * M);
    for (let k = 0; k < K; k++) {
      for (let i = 0; i < M; i++) {
        const xi = x[k + M - 1 - i];
        for (let j = 0; j < M; j++) Rb[i * M + j] += xi * x[k + M - 1 - j];
      }
    }
    for (let t = 0; t < M * M; t++) Rb[t] /= K;
    const out = new Float64Array(M * M);
    for (let t = 0; t < M * M; t++) out[t] = 0.5 * (R[t] + Rb[t]);
    return out;
  }

  /** 取特征分解的第 a..b-1 个特征向量组成矩阵（按列存放） */
  function eigCols(E, M, a, b) {
    const w = b - a;
    const out = new Float64Array(M * w);
    for (let r = 0; r < M; r++) for (let q = 0; q < w; q++) out[r * w + q] = E.V[r * M + a + q];
    return out;
  }

  /** MUSIC 伪谱：P(f) = 1 / Σ_q |v_q^H a(f)|² */
  function musicAt(En, M, nNoise, freqs, fs) {
    const S = new Float64Array(freqs.length);
    for (let i = 0; i < freqs.length; i++) {
      const w = 2 * Math.PI * freqs[i] / fs;
      let acc = 0;
      for (let q = 0; q < nNoise; q++) {
        let sr = 0;
        for (let m = 0; m < M; m++) {
          const v = En[m * nNoise + q];
          sr += v * Math.cos(w * m);
        }
        let sr2 = 0, si2 = 0;
        for (let m = 0; m < M; m++) {
          const v = En[m * nNoise + q];
          si2 += v * Math.sin(w * m);
        }
        acc += sr * sr + si2 * si2;
      }
      S[i] = 1 / Math.max(acc, 1e-30);
    }
    return S;
  }

  /** 实矩阵乘法 C = A·B */
  function matMulReal(A, B, n) {
    const C = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += A[i * n + k] * B[k * n + j];
      C[i * n + j] = s;
    }
    return C;
  }

  /** Faddeev-LeVerrier：实矩阵特征多项式系数（降幂，首项 1） */
  function charPolyReal(P, n) {
    let M = new Float64Array(n * n);
    for (let i = 0; i < n; i++) M[i * n + i] = 1;
    const c = new Float64Array(n + 1);
    c[0] = 1;
    for (let k = 1; k <= n; k++) {
      const AM = matMulReal(P, M, n);
      let tr = 0;
      for (let i = 0; i < n; i++) tr += AM[i * n + i];
      c[k] = -tr / k;
      for (let i = 0; i < n * n; i++) M[i] = AM[i];
      for (let i = 0; i < n; i++) M[i * n + i] += c[k];
    }
    return c;
  }

  /**
   * ESPRIT：利用平移不变性直接给出频率封闭解
   * @param {Float64Array} Es M×d 信号子空间（按列存放）
   */
  function espritFreqs(Es, M, d, fs) {
    const rows = M - 1;
    const G = new Float64Array(d * d), C = new Float64Array(d * d);
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        let g = 0, c = 0;
        for (let r = 0; r < rows; r++) {
          g += Es[r * d + i] * Es[r * d + j];
          c += Es[r * d + i] * Es[(r + 1) * d + j];
        }
        G[i * d + j] = g; C[i * d + j] = c;
      }
    }
    // 高斯-约当求 G 的逆（增广矩阵）
    const W = 2 * d;
    const A = new Float64Array(d * W);
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) A[i * W + j] = G[i * d + j];
      for (let j = 0; j < d; j++) A[i * W + d + j] = (i === j) ? 1 : 0;
    }
    for (let col = 0; col < d; col++) {
      let piv = col;
      for (let r = col + 1; r < d; r++) if (Math.abs(A[r * W + col]) > Math.abs(A[piv * W + col])) piv = r;
      const pv = A[piv * W + col];
      if (Math.abs(pv) < 1e-16) continue;
      if (piv !== col) for (let j = 0; j < W; j++) { const t = A[col * W + j]; A[col * W + j] = A[piv * W + j]; A[piv * W + j] = t; }
      const d0 = A[col * W + col];
      for (let j = 0; j < W; j++) A[col * W + j] /= d0;
      for (let r = 0; r < d; r++) {
        if (r === col) continue;
        const f = A[r * W + col];
        if (f === 0) continue;
        for (let j = 0; j < W; j++) A[r * W + j] -= f * A[col * W + j];
      }
    }
    const Psi = new Float64Array(d * d);
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) {
      let s = 0;
      for (let k = 0; k < d; k++) s += A[i * W + d + k] * C[k * d + j];
      Psi[i * d + j] = s;
    }
    const cp = charPolyReal(Psi, d);
    const roots = rootsDK(cp, new Float64Array(d + 1));
    return roots.map(z => ({ freq: Math.atan2(z.im, z.re) / (2 * Math.PI) * fs, radius: cAbs(z) }))
      .filter(o => o.freq > 0)
      .sort((x, y) => x.freq - y.freq);
  }

  /** 转为 dB（以 ref 为参考） */
  function toDbVec(v, ref) {
    const o = new Float64Array(v.length);
    for (let i = 0; i < v.length; i++) o[i] = 10 * Math.log10(Math.max(v[i], 1e-25) / ref);
    return o;
  }
  function maxOfArr(v) {
    let m = -Infinity;
    for (let i = 0; i < v.length; i++) if (v[i] > m) m = v[i];
    return m;
  }
  /** 均匀频率栅格 */
  function freqGrid(lo, hi, n) {
    const f = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) f[i] = lo + (hi - lo) * i / n;
    return f;
  }
  /** 数组转普通数组（绘图引擎兼容） */
  function arr(a) { return Array.prototype.slice.call(a); }

  /* ============================================================
     1. 经典谱估计
     ============================================================= */
  doc.register('theory/spectrum/classical', {
    title: '经典谱估计：周期图、加窗与平均',
    lede: '周期图是功率谱密度最朴素的估计子——它渐近无偏，却**不一致**：方差不随数据量下降。Bartlett、Welch、Blackman-Tukey 三条改良路线，本质上都在拿分辨率换方差。',
    tags: ['谱估计', '周期图', 'Welch', '加窗', '方差'],
    labs: [{ path: 'lab/window', title: '窗函数交互实验台', desc: '对比矩形窗、汉宁窗、汉明窗的主瓣宽度与旁瓣电平，理解"加窗周期图"的泄漏代价' }],
    toc: true,
    sections: [
      {
        id: 'why', num: '1', title: '谱估计到底在估什么',
        blocks: [
          { t: 'md', md: '谱估计要回答的问题很朴素：**一段观测数据里，功率沿频率是怎么分布的？** 但"频谱"这个词对随机信号是失效的——随机信号的一次实现通常既不绝对可和也不平方可和，严格意义下的傅里叶变换并不存在，你手里能用的只有统计量。' },
          { t: 'md', md: '把这条路打通的是**维纳-辛钦定理**：宽平稳随机序列的功率谱密度与自相关函数构成一对傅里叶变换。这是全部谱估计的理论出发点。' },
          { t: 'math', tex: 'P_{xx}(e^{j\\omega}) = \\sum_{m=-\\infty}^{\\infty} R_{xx}[m]\\,e^{-j\\omega m},\\qquad R_{xx}[m] = E\\{x[n]\\,x^{*}[n-m]\\}', tag: '(1)' },
          { t: 'md', md: '式 (1) 立刻给出两条等价的技术入口：\n\n1. **直接法**：先算数据的傅里叶变换，取模平方并归一——这就是**周期图**；\n2. **间接法**：先估出自相关序列 $\\hat{R}_{xx}[m]$，再做傅里叶变换——这就是 **Blackman-Tukey 法**。\n\n两条路都撞上同一堵墙：**你只有有限长的一段数据**。有限长等价于给信号乘了一个矩形窗，而窗必然带来两件事——**主瓣展宽（分辨率下降）**与**旁瓣泄漏（强分量掩盖弱分量）**。谱估计的全部工程技巧，都是在这两个损失与估计方差之间做交换。' },
          { t: 'kv', title: '评价一个谱估计子的三个指标', pairs: [
            ['偏差 Bias', '$\\hat{P}$ 的均值与真谱 $P$ 的差；由窗的频谱卷积造成，窗越长偏差越小'],
            ['方差 Var', '估计子在频率点上的抖动程度；决定"这根谱线能不能信"'],
            ['分辨率 Δf', '能分开两个等强谱峰的最小频率间隔；对长度 $N$ 的窗约为 $c\\,f_s/N$，$c$ 取决于窗型（矩形 $c\\approx1$，汉宁 $c\\approx2$）']
          ] },
          { t: 'callout', kind: 'tip', title: '一条贯穿全章的主线', md: '**偏差与分辨率可以靠加长数据改善，方差不行。** 周期图的方差恒等于均值的平方，与 $N$ 无关——这是经典谱估计最反直觉、也最重要的结论。后面三种改进方法，都是从不同角度绕开它。' }
        ]
      },
      {
        id: 'per', num: '2', title: '周期图法：定义与两条等价推导',
        blocks: [
          { t: 'md', md: '给定 $N$ 点观测 $x[0],\\dots,x[N-1]$，加窗周期图定义为' },
          { t: 'math', tex: '\\hat{P}_{per}(\\omega) = \\frac{1}{f_s\\displaystyle\\sum_{n=0}^{N-1} w^2[n]}\\left|\\;\\sum_{n=0}^{N-1} w[n]\\,x[n]\\,e^{-j\\omega n}\\right|^2', tag: '(2)' },
          { t: 'md', md: '分母中的 $\\sum w^2[n]$ 是**噪声功率归一化因子**，它保证窗型改变时白噪声的谱线电平不变（这是工程上最容易写错的一项）。取 $w[n]\\equiv1$ 即退化为最基本的周期图 $\\frac{1}{N f_s}|X(e^{j\\omega})|^2$。' },
          {
            t: 'fold', summary: '展开：周期图的两条推导路径', deriv: true, blocks: [
              { t: 'md', md: '**路径一：由 Blackman-Tukey 退化而来（自相关路线）**\n\n取自相关的**有偏估计**' },
              { t: 'math', tex: '\\hat{R}_{xx}[m] = \\frac{1}{N}\\sum_{n=m}^{N-1} x[n]\\,x^{*}[n-m],\\qquad 0\\le m\\le N-1', tag: '(3)' },
              { t: 'md', md: '它是两个长度为 $N$ 的矩形窗序列的互相关，其傅里叶变换恰好是 $\\frac{1}{N}|X(e^{j\\omega})|^2$，即周期图。于是：**周期图 = 自相关有偏估计的傅里叶变换**。这一点很关键——它解释了为什么周期图自带三角窗（Bartlett 窗）平滑：有偏估计 $\\hat{R}[m]$ 天然被 $(1-|m|/N)$ 加权。' },
              { t: 'md', md: '**路径二：由加窗 DFT 直接而来（频谱路线）**\n\n把加窗序列 $x_w[n]=w[n]x[n]$ 的傅里叶变换记为 $X_w(e^{j\\omega})$。若 $x[n]$ 是功率信号，则 $x_w$ 是能量信号，其能量谱密度 $|X_w|^2$ 除以时间长度 $N T_s = N/f_s$ 即得平均功率的估计：' },
              { t: 'math', tex: '\\hat{P}(\\omega) = \\frac{|X_w(e^{j\\omega})|^2}{N T_s} = \\frac{|X_w(e^{j\\omega})|^2}{N/f_s}', tag: '(4)' },
              { t: 'md', md: '把分母中的 $N$ 换成 $\\sum w^2[n]$（对矩形窗二者相等），即得式 (2)。两条路径殊途同归：**周期图是"自相关有偏估计的变换"与"加窗能量谱的时间平均"这两件事的同一个答案**。' }
            ]
          },
          { t: 'kv', title: '变量说明', pairs: [
            ['数据窗 w[n]', '数据窗（矩形、汉宁、汉明、布莱克曼…），长度 $N$'],
            ['采样率 f_s', '采样率；$\\sum w^2 / f_s$ 量纲为秒，使 $\\hat{P}$ 单位为功率/Hz'],
            ['X_w', '加窗序列的 DTFT']
          ] }
        ]
      },
      {
        id: 'var', num: '3', title: '致命缺陷：方差不随数据量下降',
        blocks: [
          { t: 'md', md: '这是本章最需要刻进肌肉记忆的结论。设 $x[n]$ 为零均值高斯白噪声，考虑任意频率点 $\\omega$（避开 $0$ 与 $\\pi$），令' },
          { t: 'math', tex: 'X(\\omega) = \\sum_{n=0}^{N-1} x[n]e^{-j\\omega n} = A(\\omega) + jB(\\omega)', tag: '(5)' },
          { t: 'md', md: '由于 $x[n]$ 独立同分布且高斯，$A$ 与 $B$ 是独立的高斯随机变量，且 $E\\{A^2\\}=E\\{B^2\\}=\\tfrac{1}{2}\\sigma^2 N$。于是 $|X|^2 = A^2+B^2$ 服从**指数分布**，而指数分布的标准差等于均值：' },
          { t: 'math', tex: 'E\\{|X|^2\\} = \\sigma^2 N,\\qquad \\mathrm{Var}\\{|X|^2\\} = \\big(E\\{|X|^2\\}\\big)^2 = \\sigma^4 N^2', tag: '(6)' },
          { t: 'md', md: '注意 $N$ 出现在等式两边且**同阶**：把数据加长 100 倍，均值与标准差同时放大 100 倍，相对起伏一点没变。这个估计子不满足一致性——**你永远无法通过"多采点"让它收敛到真谱**。' },
          {
            t: 'fold', summary: '展开：式 (6) 的完整论证', deriv: true, blocks: [
              { t: 'md', md: '**第一步（高斯性）**：$A=\\sum x[n]\\cos(\\omega n)$、$B=-\\sum x[n]\\sin(\\omega n)$ 都是高斯的线性组合，故 $(A,B)$ 联合高斯。' },
              { t: 'md', md: '**第二步（协方差）**：利用 $E\\{x[n]x[m]\\}=\\sigma^2\\delta[n-m]$ 与三角恒等式，' },
              { t: 'math', tex: 'E\\{A^2\\} = \\sigma^2\\sum_{n}\\cos^2(\\omega n),\\quad E\\{B^2\\}=\\sigma^2\\sum_n \\sin^2(\\omega n),\\quad E\\{AB\\}=-\\sigma^2\\sum_n \\sin(\\omega n)\\cos(\\omega n)', tag: '(7)' },
              { t: 'md', md: '当 $N\\gg1$ 且 $\\omega$ 不靠近 $0$、$\\pi$ 时，$\\sum\\cos^2 \\approx \\sum\\sin^2 \\approx N/2$，$\\sum \\sin\\cos\\approx 0$。故 $A$、$B$ 近似独立、方差同为 $\\sigma^2 N/2$。' },
              { t: 'md', md: '**第三步（分布）**：两个独立同方差零均值高斯变量，其平方和 $A^2+B^2$ 服从指数分布（自由度为 2 的卡方分布的尺度变换）。指数分布满足 $\\sigma = \\mu$，因此' },
              { t: 'math', tex: '\\frac{\\sqrt{\\mathrm{Var}\\{|X|^2\\}}}{E\\{|X|^2\\}} = 1 \\quad\\Longrightarrow\\quad \\mathrm{Var}\\{|X|^2\\} \\approx \\overline{|X|^2}^{\\,2}', tag: '(8)' },
              { t: 'callout', kind: 'danger', title: '这个结论的工程含义', md: '谱线电平的**相对起伏恒为 100%**，与采多长无关。所以：\n\n- 单次 FFT 的谱线电平没有任何统计意义，只在同一实现的多次平均后才有意义；\n- 报告"某频点谱级 −62 dB"时，必须同时给出**平均次数**与**等效分辨率带宽**，否则这个数字不可复现；\n- 检测弱线谱时，门限必须按指数分布（而非高斯）来定，否则虚警率会算错一个量级。' }
            ]
          },
          {
            t: 'widget', render: function (el) {
              const fs2 = 1000;
              const rows = [];
              [128, 512, 2048, 8192].forEach(function (N) {
                const w = C.window('hann', N);
                let sw2 = 0;
                for (let i = 0; i < N; i++) sw2 += w[i] * w[i];
                const T = 200, M = 300;
                const vals = new Float64Array(T * M);
                for (let t = 0; t < T; t++) {
                  const g = U.randn(N, 8100 + t * 13);
                  const xw = new Float64Array(N);
                  for (let i = 0; i < N; i++) xw[i] = g[i] * w[i];
                  const S = C.fft(xw, N);
                  for (let m = 0; m < M; m++) {
                    const k = 40 + m * 3;
                    if (k >= N / 2) continue;
                    vals[t * M + m] = (S.re[k] * S.re[k] + S.im[k] * S.im[k]) / (fs2 * sw2);
                  }
                }
                let s1 = 0, cnt = 0;
                for (let i = 0; i < T * M; i++) { if (vals[i] > 0) { s1 += vals[i]; cnt++; } }
                const mean = s1 / Math.max(cnt, 1);
                let s2 = 0;
                for (let i = 0; i < T * M; i++) { if (vals[i] > 0) { const d = vals[i] - mean; s2 += d * d; } }
                const varr = s2 / Math.max(cnt, 1);
                rows.push([String(N), mean.toExponential(2), varr.toExponential(2), (varr / (mean * mean)).toFixed(3)]);
              });
              el.appendChild(DSP.ui.table({
                cols: ['数据长度 N', '谱值均值（E 的估计）', '谱值方差（Var 的估计）', '方差 ÷ 均值²（理论 1.00）'],
                rows: rows
              }));
              el.appendChild(U.h('div.plot-cap', { html: U.md('各频点取高斯白噪声的加窗周期图，$T=200$ 次实现、每次取 $300$ 个互不相邻的频点，共 $6$ 万个样本。**比值稳定在 1.00 附近，与 $N$ 无关**——加长数据只让曲线更密，不让它更平。') }));
            }
          }
        ]
      },
      {
        id: 'bartlett', num: '4', title: 'Bartlett 分段平均：方差除以 K，分辨率乘以 K',
        blocks: [
          { t: 'md', md: '既然单次周期图抖动太大，最直接的思路是**多算几次求平均**。把 $N$ 点数据切成 $K$ 段互不重叠的子段，每段长 $L = N/K$，各自算周期图再平均：' },
          { t: 'math', tex: '\\hat{P}_{B}(\\omega) = \\frac{1}{K}\\sum_{k=0}^{K-1}\\hat{P}_{per}^{(k)}(\\omega),\\qquad \\hat{P}_{per}^{(k)}(\\omega)=\\frac{1}{L f_s}\\left|\\sum_{n=0}^{L-1}x[kL+n]e^{-j\\omega n}\\right|^2', tag: '(9)' },
          { t: 'md', md: '若各段近似独立，则方差下降为原来的 $1/K$：' },
          { t: 'math', tex: '\\mathrm{Var}\\left\\{\\hat{P}_{B}\\right\\} \\approx \\frac{1}{K}\\,P^2(\\omega),\\qquad \\frac{\\sqrt{\\mathrm{Var}}}{E} \\approx \\frac{1}{\\sqrt{K}}', tag: '(10)' },
          { t: 'md', md: '代价非常明确：**每段只有 $L = N/K$ 点，主瓣展宽为原来的 $K$ 倍，分辨率恶化 $K$ 倍。** 这就是谱估计里最基本的一笔交易——方差与分辨率的乘积近似为常数。' },
          {
            t: 'plot', title: 'Bartlett 分段平均：K 从 1 增到 32 的谱曲线（同一段数据）', height: 270,
            render: function (canvas) {
              const fs2 = 1000, N = 1024;
              const base = C.multisin(N, fs2, [{ freq: 120, amp: 1, phase: 0.4 }, { freq: 150, amp: 0.8, phase: 1.6 }]);
              const x = C.addNoise(base, 6, 9091);
              const p = DSP.plot.new(canvas, { height: 270, xlabel: 'f / Hz', ylabel: 'PSD / dB', legend: true, legendPos: 'tr', ylim: [-55, 6] });
              [1, 2, 8, 32].forEach(function (K, i) {
                const P = C.psdBartlett(x, K, fs2);
                p.add({ x: arr(P.f), y: arr(C.psdDb(P.psd)), color: i, width: 1.7, label: 'K = ' + K });
              });
              p.vline(120, { label: '120 Hz', color: U.themeColor('--text-dim'), width: 1 });
              p.vline(150, { label: '150 Hz', color: U.themeColor('--text-dim'), width: 1 });
              p.draw();
            }
          },
          { t: 'md', md: '$K=1$ 时就是原始周期图：两个谱峰清楚，但整条曲线毛刺剧烈；$K=32$ 时曲线光滑如镜，可 120 Hz 与 150 Hz 已经完全粘在一起。**这就是"要分辨还是要稳定"这个选择的物理来源，不是算法缺陷，是信息论下界。**' },
          { t: 'table', cols: ['分段数 K', '每段长度 L = N/K', '相对标准差', '分辨率恶化', '适用场景'], rows: [
            ['1', '1024', '100%', '1 倍（基准）', '只要分辨、不看电平'],
            ['2', '512', '71%', '2 倍', '折中起步'],
            ['8', '128', '35%', '8 倍', '常规谱分析'],
            ['32', '32', '18%', '32 倍', '只关心宽带谱形状']
          ] }
        ]
      },
      {
        id: 'welch', num: '5', title: 'Welch 改进：允许重叠，并给每段加窗',
        blocks: [
          { t: 'md', md: 'Bartlett 法有两个浪费：**段与段不重叠**（可用的段数被人为限制），以及**每段用矩形窗**（旁瓣高达 −13 dB，泄漏严重）。Welch 法同时修掉这两点：' },
          { t: 'flow', items: [
            { t: '加窗', kind: 'dsp', d: '每段乘汉宁窗，压旁瓣' },
            { t: '重叠', kind: 'dsp', d: '相邻段重叠 50%，段数翻倍' },
            { t: '求周期图', kind: 'dsp', d: '每段 FFT 取模平方并归一' },
            { t: '平均', kind: 'out', d: '得到低方差 PSD 估计' }
          ] },
          { t: 'md', md: '数学表达（$S$ 为段起点步长）：' },
          { t: 'math', tex: '\\hat{P}_{W}(\\omega) = \\frac{1}{K}\\sum_{k=0}^{K-1}\\frac{1}{f_s \\sum_n w^2[n]}\\left|\\sum_{n=0}^{L-1} w[n]\\,x[kS+n]\\,e^{-j\\omega n}\\right|^2,\\qquad S = L(1-r)', tag: '(11)' },
          { t: 'md', md: '其中 $r$ 为**重叠率**，段数为' },
          { t: 'math', tex: 'K = \\left\\lfloor\\frac{N-L}{S}\\right\\rfloor + 1 \\;\\approx\\; \\frac{N}{L(1-r)}', tag: '(12)' },
          { t: 'table', cols: ['重叠率 r', '段数 K（相对 r=0）', '段间相关性', '方差改善（相对 r=0）', '工程评价'], rows: [
            ['0（Bartlett）', '1 倍', '完全独立', '1 倍（基准）', '段数太少，浪费数据'],
            ['25%', '1.33 倍', '较弱', '约 1.2 倍', '略好'],
            ['50%', '2 倍', '中等', '约 1.7 倍', '**推荐默认**'],
            ['75%', '4 倍', '较强', '约 2.2 倍', '边际收益递减，算力翻倍']
          ] },
          { t: 'callout', kind: 'note', title: '为什么是 50%，而不是 75%', md: '段数翻倍本应让方差减半，但**重叠带来的相关性**把收益吃掉一部分。经验规律：方差改善大致正比于 $K_{\\text{eff}} = K/(1+r)$，即 $r=0.5$ 时 $K_{\\text{eff}} = 2K/1.5 = 1.33K$。再往上加到 75%，段数是 4 倍但 $K_{\\text{eff}}$ 只到 $4K/1.75 = 2.29K$，算力却两倍——**不划算**。这就是 50% 成为工业默认值的原因。' },
          { t: 'code', lang: 'python', title: 'Welch 法的核心三行', src: `# 1) 分帧：帧长 L，步长 S = L*(1-r)，r=0.5 为常用重叠率
frames = [x[s:s+L] * w for s in range(0, N-L+1, S)]        # w: 汉宁窗

# 2) 每帧周期图：1/(fs * sum(w^2)) * |FFT|^2
P = np.array([np.abs(np.fft.rfft(f, nfft))**2 for f in frames]) / (fs * np.sum(w**2))

# 3) 平均（单边谱除首尾外补回 2 倍）
P[:, 1:-1] *= 2
psd = P.mean(axis=0)` }
        ]
      },
      {
        id: 'bt', num: '6', title: 'Blackman-Tukey 间接法：滞后窗必须有非负谱',
        blocks: [
          { t: 'md', md: '直接法是"先变换再平方"，间接法是"先相关再变换"。由维纳-辛钦定理直接得' },
          { t: 'math', tex: '\\hat{P}_{BT}(\\omega) = \\sum_{m=-(M-1)}^{M-1} w_M[m]\\,\\hat{R}_{xx}[m]\\,e^{-j\\omega m} = \\hat{R}_{xx}[0] + 2\\sum_{m=1}^{M-1} w_M[m]\\,\\hat{R}_{xx}[m]\\cos(\\omega m)', tag: '(13)' },
          { t: 'md', md: '这里 $M-1$ 是**最大滞后**，$w_M[m]$ 是**滞后窗**（lag window）。当 $M=N$、$w_M[m]\\equiv1$ 时，它严格等于周期图；当 $M<N$ 时，等于对周期图做了一次平滑。' },
          {
            t: 'plot', title: '滞后窗加在自相关上：Bartlett 三角窗与 Parzen 窗', height: 270,
            render: function (canvas) {
              const fs2 = 1000, N = 1024, M = 129;
              const base = C.multisin(N, fs2, [{ freq: 120, amp: 1, phase: 0.4 }, { freq: 150, amp: 0.8, phase: 1.6 }]);
              const x = C.addNoise(base, 6, 9091);
              const ac = C.autocorr(x, true);
              const mid = ac.r.length >> 1;
              const r = [];
              for (let m = 0; m < M; m++) r.push(ac.r[mid + m]);
              const lags = [];
              for (let m = 0; m < M; m++) lags.push(m);
              const wBar = [], wPar = [];
              for (let m = 0; m < M; m++) {
                const u = m / (M - 1);
                wBar.push(1 - u);                                  // Bartlett（三角）窗
                const a = Math.abs(m) <= (M - 1) / 2 ? 1 - 6 * u * u * (1 - u) : 2 * Math.pow(1 - u, 3);
                wPar.push(a);
              }
              const p = DSP.plot.new(canvas, { height: 270, xlabel: '滞后 m', ylabel: '归一化幅值', legend: true, legendPos: 'tr' });
              p.add({ x: lags, y: r, color: 0, width: 1.8, label: '估计的自相关 r[m]' });
              p.add({ x: lags, y: wBar, color: 2, width: 1.6, dash: [5, 3], label: 'Bartlett 滞后窗' });
              p.add({ x: lags, y: wPar, color: 3, width: 1.6, dash: [2, 2], label: 'Parzen 滞后窗' });
              p.draw();
            }
          },
          { t: 'md', md: '滞后窗与数据窗看起来都是"窗"，但**约束完全不同**：\n\n- **数据窗**（加在 $x[n]$ 上）只要求$|W(\\omega)|^2$ 能量集中，任何单调渐降的窗都能用；\n- **滞后窗**（加在 $\\hat{R}[m]$ 上）必须保证 $w_M[m]$ 的傅里叶变换**处处非负**，否则式 (13) 会给出负的功率谱——物理上无意义。' },
          { t: 'math', tex: 'W_M(\\omega) = \\sum_{m=-(M-1)}^{M-1} w_M[m]\\,e^{-j\\omega m} \\;\\ge\\; 0,\\quad \\forall\\omega', tag: '(14)' },
          { t: 'callout', kind: 'warn', title: '这就是与直接法加窗的本质差别', md: '矩形滞后窗的频谱有负旁瓣（−13 dB 以下），因此**直接截断自相关会在谱上造出负值**；而 Bartlett（三角）滞后窗的频谱是 $\\frac{1}{M}\\big[\\frac{\\sin(\\omega M/2)}{\\sin(\\omega/2)}\\big]^2\\ge 0$，Parzen 窗、Welch 窗同理。\n\n反过来，**汉宁窗作为数据窗完全可以，但把汉宁窗的时域形状直接搬到滞后上却要小心**——它是"余弦凸起"型，其变换含非负性需要具体核对。**经验法则：滞后窗只能从"自卷积型"（Bartlett、Parzen、Welch）里选**，它们天然是两个矩形频谱的平方，非负性由构造保证。' },
          { t: 'table', cols: ['滞后窗', '表达式 w[m]', '谱是否非负', '特点'], rows: [
            ['矩形', '1，|m| < M', '否（有负旁瓣）', '等价于周期图，方差大'],
            ['Bartlett（三角）', '1 − |m|/M', '是', '最常用，实现简单'],
            ['Parzen', '分段三次多项式', '是', '平滑更彻底，分辨率略损'],
            ['Welch', '倒抛物线', '是', '介于前两者之间']
          ] }
        ]
      },
      {
        id: 'jitter', num: '7', title: '眼见为实：周期图 vs Welch 的抖动对比',
        blocks: [
          { t: 'md', md: '下面两张图用的是**同一段确定性信号**（两个正弦加谐波）叠加 **8 次独立的噪声实现**。左图每次实现单独算周期图，右图每次实现单独算 Welch 谱（帧长 256、汉宁窗、50% 重叠）。注意两条关键观察：' },
          { t: 'md', md: '1. **抖动幅度**：左图不同实现的曲线可以相差十几 dB，右图几乎重合；\n2. **平坦处**：左图噪声底像锯齿一样跳，右图噪声底是一条稳定的直线。\n\n换句话说，**周期图让你"看见了噪声的随机性"，Welch 才让你"看见了信号的谱"。**' },
          {
            t: 'widget', render: function (el) {
              const fs2 = 2000, N = 1024, nfft = 2048;
              const base = C.multisin(N, fs2, [
                { freq: 300, amp: 1, phase: 0.4 },
                { freq: 340, amp: 0.7, phase: 1.6 },
                { freq: 620, amp: 0.35, phase: 2.2 }
              ]);
              const seeds = [11, 23, 37, 51, 67, 83, 97, 113];
              const winN = C.window('hann', N);
              const boxA = DSP.ui.plotBox({ title: '周期图：8 次实现的单独谱曲线' });
              const pA = DSP.plot.new(boxA.canvas, { height: 260, xlabel: 'f / Hz', ylabel: 'PSD / dB', legend: false, ylim: [-62, 8] });
              const boxB = DSP.ui.plotBox({ title: 'Welch（汉宁窗 + 50% 重叠）：8 次实现的单独谱曲线' });
              const pB = DSP.plot.new(boxB.canvas, { height: 260, xlabel: 'f / Hz', ylabel: 'PSD / dB', legend: false, ylim: [-62, 8] });
              seeds.forEach(function (sd, si) {
                const x = C.addNoise(base, 6, sd);
                const Pg = C.periodogram(x, winN, nfft, fs2);
                pA.add({ x: arr(Pg.f), y: arr(C.psdDb(Pg.psd)), color: si % 5, width: 1, alpha: 0.8 });
                const Pw = C.pwelch(x, { segLen: 256, overlap: 0.5, win: 'hann', nfft: 512, fs: fs2 });
                pB.add({ x: arr(Pw.f), y: arr(C.psdDb(Pw.psd)), color: si % 5, width: 1, alpha: 0.8 });
              });
              pA.draw(); pB.draw();
              const grid = U.h('div.grid.g2', {}, [boxA.el, boxB.el]);
              el.appendChild(grid);
              el.appendChild(U.h('div.plot-cap', { html: U.md('两段曲线均未做额外的平滑滤波，差别**只来自分段平均**。左图的毛刺高度 ≈ 5.5 dB（指数分布的理论起伏），右图被压到 1~2 dB 量级。') }));
            }
          },
          { t: 'callout', kind: 'eng', title: '水声实测里为什么默认 Welch + 汉宁 + 50%', md: '一套典型的船噪/环境噪声分析流程：\n\n1. **先去趋势、去均值**：水听器常有慢漂移，均值不去掉会在 $f\\!\\to\\!0$ 处造出巨大的假谱峰；\n2. **帧长选取**：帧长 $L$ 决定分辨率 $\\Delta f\\approx 1.5 f_s/L$（汉宁窗）。对轴频 ~5 Hz、叶频 ~25 Hz 的目标，$\\Delta f$ 至少要 0.5 Hz，若 $f_s=4$ kHz 则 $L\\ge 12$ k 点，通常取 $L=8192$ 或 $16384$；\n3. **汉宁窗**：旁瓣 −31 dB 且滚降快，能把强线谱的泄漏压到 −60 dB 以下，避免叶频泄漏盖住邻近的弱调制边带；\n4. **50% 重叠**：汉宁窗两端趋零，不重叠会**丢掉每一段两端的信息**；50% 重叠把这段损失补回来，同时段数翻倍；\n5. **最后换算成谱级**：$\\mathrm{PSD}$ 用 $10\\log_{10}$（功率量），若报**谱级**则按水声惯例为 dB re 1 μPa²/Hz，同时注明 $\\Delta f$ 与平均段数 $K$，否则不同团队的数据无法比对。' },
          { t: 'callout', kind: 'pit', title: '只做一次 FFT 就报告谱线幅度', md: '这是水声与振动领域最高频的报告错误。三个典型症状：\n\n- **"发现 −58 dB 的线谱"**：未给平均段数，下一次测量可能变成 −64 dB，于是被误读为"目标变弱"；\n- **比较不同长度的数据**：周期图电平**不随长度归一化自动可比**，必须除以 $\\sum w^2$（等效噪声带宽）后才是 PSD；\n- **用矩形窗看弱谱**：强线谱 −13 dB 的旁瓣会把邻近的弱分量完全淹没，看上去像"没有信号"。\n\n**正确做法**：加窗 → 分段 → 平均 → 报 PSD（dB/Hz）+ 平均段数 + 窗型 + 帧长，并给出置信区间（$K$ 段平均后相对标准差约 $1/\\sqrt{K}$）。' }
        ]
      },
      {
        id: 'choice', num: '8', title: '给工程师的"谱估计三问"与死结总结',
        blocks: [
          { t: 'md', md: '分辨率与方差的死结可以写成一个近似不变式。对长度 $N$ 的数据、$K$ 段平均：' },
          { t: 'math', tex: '\\Delta f \\cdot \\frac{\\sqrt{\\mathrm{Var}\\{\\hat{P}\\}}}{P} \\;\\approx\\; \\frac{c\\,f_s}{N}\\cdot\\frac{1}{\\sqrt{K}} \\Big/ \\frac{N}{K} \\;\\Longrightarrow\\; \\Delta f \\downarrow \\;\\Leftrightarrow\\; \\frac{\\sqrt{\\mathrm{Var}}}{P}\\uparrow', tag: '(15)' },
          { t: 'md', md: '更实用的表述是：**分辨率正比于 $1/L$（帧长），相对标准差正比于 $1/\\sqrt{K}$（段数），而 $K\\cdot L \\approx N$ 固定**。想在 $L$ 上要 2 倍分辨率，就得在 $K$ 上损失 4 倍方差性能。唯一真正破局的办法是**加长原始数据 $N$**（或引入参数模型/子空间先验）。' },
          { t: 'table', cols: ['三问', '若答案是…', '该选什么'], rows: [
            ['一问：要分辨还是要稳定？', '要分辨两个靠得很近的谱峰', '长帧少平均，甚至直接周期图；分辨率不够就上参数模型/子空间方法'],
            ['', '要稳定的宽带谱形状（噪声级、谱斜率）', '短帧多平均，Welch + 50% 重叠；K ≥ 8 起'],
            ['', '两者都要', '先看数据够不够长，不够长就必须接受折中或换高分辨方法'],
            ['二问：数据够不够长？', 'N 远大于 fs/Δf（所需）', '经典 Welch 足够，简单可靠'],
            ['', 'N 只有几个周期', '上 AR（Burg）或子空间方法（MUSIC / ESPRIT），但要承担模型失配风险'],
            ['三问：要不要绝对电平？', '要，且要与其他系统比对', '必须报 PSD（dB/Hz），注明窗型、帧长、平均段数与等效噪声带宽'],
            ['', '只关心相对谱峰', '归一化即可，但仍需平均以控制方差']
          ] },
          { t: 'hr' },
          { t: 'md', md: '**四种方法的定位一句话总结：**' },
          { t: 'table', cols: ['方法', '做法', '方差', '分辨率', '代价'], rows: [
            ['周期图', '一次 FFT 取模平方', '100%（不随 N 降）', '最优 fs/N', '电平完全不可信'],
            ['Bartlett', '不重叠分段再平均', '1/K', '恶化 K 倍', '分辨率损失大'],
            ['Welch', '重叠 + 加窗再平均', '约 1/(1.3K)', '恶化约 K 倍', '需要选窗与重叠率'],
            ['Blackman-Tukey', '先估自相关再加滞后窗', '可调（由 M 控制）', '由最大滞后 M 控制', '滞后窗必须非负谱']
          ] }
        ]
      },
      {
        id: 'pit', num: '9', title: '误区专栏',
        blocks: [
          { t: 'callout', kind: 'pit', title: '① "多采点就能让谱变准"', md: '错。周期图方差恒等于均值平方，采再长也降不下来。加长数据只改善**偏差与分辨率**（主瓣变窄），方差必须靠**平均**或**模型**解决。' },
          { t: 'callout', kind: 'pit', title: '② 擅自用矩形窗看弱信号', md: '矩形窗旁瓣 −13 dB、滚降仅 6 dB/倍频程。强线谱的泄漏会造出"假谱峰"，也会把弱谱线埋掉。默认应当用汉宁窗。' },
          { t: 'callout', kind: 'pit', title: '③ 把滞后窗当成数据窗乱用', md: '滞后窗要求**频谱非负**。矩形、凯泽一类的窗搬到滞后域会得到负功率谱。只选自卷积型（Bartlett / Parzen / Welch）。' },
          { t: 'callout', kind: 'pit', title: '④ 重叠率越高越好', md: '75% 重叠的段数是 50% 的两倍，但相邻段高度相关，方差收益只多约 30%，算力却翻倍。50% 是性价比最优点。' },
          { t: 'callout', kind: 'pit', title: '⑤ 忘记归一化因子（w 的平方和）', md: '换窗后谱线电平会整体偏移 $\\sum w^2/N$（汉宁窗约 −4.3 dB 相对矩形窗的噪声功率归一）。跨窗比较前必须归一。' }
        ]
      }
    ],
    refs: [
      'Stoica & Moses, Spectral Analysis of Signals, Prentice Hall, 2005（经典谱估计的标准参考）',
      'Welch, "The Use of Fast Fourier Transform for the Estimation of Power Spectra", IEEE Trans. Audio Electroacoust., 1967',
      'Blackman & Tukey, The Measurement of Power Spectra, Dover, 1958',
      'Kay, Modern Spectral Estimation: Theory and Application, Prentice Hall, 1988'
    ]
  });

  /* ============================================================
     2. 参数模型谱估计
     ============================================================= */
  doc.register('theory/spectrum/parametric', {
    title: '参数模型谱估计：AR / MA / ARMA',
    lede: '经典谱估计默认"窗外的数据是零"——这就是它分辨率的死穴。参数模型换了个思路：**不给数据加窗，而是给数据建模**，于是分辨率不再被窗长钉死。',
    tags: ['谱估计', 'AR', 'Burg', 'Levinson-Durbin', 'AIC'],
    labs: [],
    toc: true,
    sections: [
      {
        id: 'why', num: '1', title: '为什么要参数模型',
        blocks: [
          { t: 'md', md: '周期图在数学上等价于"用矩形窗截取数据、并把窗外一律当作零"。这个隐含假设带来的后果有两个，而且都很致命：' },
          { t: 'md', md: '1. **分辨率被记录长度锁死**：两个频率间隔小于 $\\approx f_s/N$ 的谱峰必然糊在一起；\n2. **方差不收敛**：无论采多长都不会更稳。\n\n参数模型的出发点是：**不要假设窗外是零，而是假设数据是由某个已知结构的系统产生的**。只要模型结构猜对了，就能用很短的数据"外推"出高分辨的谱。' },
          { t: 'table', cols: ['场景', '经典方法的困境', '参数模型的优势'], rows: [
            ['水声短促瞬态（目标通过）', '可用数据只有几十到几百点', 'AR 可用 2~4 倍更短的片段给出尖锐谱峰'],
            ['语音共振峰估计', '基频高、可用帧短（20~30 ms）', 'LPC（即 AR）直接给出共振峰位置'],
            ['雷达杂波建模', '需要解析的谱形用于 CFAR 设计', 'AR 谱可写成闭式，便于推导检测器'],
            ['低 SNR 线谱检测', '周期图抖动淹没弱线谱', '模型阶数正确时谱峰更集中']
          ] },
          { t: 'callout', kind: 'warn', title: '参数模型不是免费的午餐', md: '它换来分辨率的代价是三条硬约束：**必须知道阶数**（猜错就出伪峰或糊掉）、**必须匹配模型结构**（噪声中的正弦严格说是 ARMA 而非 AR）、**没有统计一致性**（数据再多也不会收敛到真谱，只会收敛到"模型的最佳逼近"）。用之前先问自己：我的数据真的符合这个模型吗？' }
        ]
      },
      {
        id: 'model', num: '2', title: 'AR / MA / ARMA：三种模型与它们的谱',
        blocks: [
          { t: 'md', md: '核心假设：观测 $x[n]$ 是由白噪声 $e[n]$（方差 $\\sigma^2$）激励一个线性时不变系统产生的。按系统是有理分式、纯分子还是纯分母，得到三种模型。' },
          { t: 'math', tex: 'x[n] = -\\sum_{k=1}^{p} a_k\\,x[n-k] \\;+\\; \\sum_{k=0}^{q} b_k\\,e[n-k],\\qquad b_0=1', tag: '(1)' },
          { t: 'md', md: '对应的系统函数与功率谱：' },
          { t: 'math', tex: 'H(z)=\\frac{B(z)}{A(z)}=\\frac{1+\\sum_{k=1}^{q}b_k z^{-k}}{1+\\sum_{k=1}^{p}a_k z^{-k}}, \\qquad P_{xx}(\\omega)=\\sigma^2\\left|H(e^{j\\omega})\\right|^2', tag: '(2)' },
          { t: 'table', cols: ['模型', '系统函数', '功率谱', '谱的特点', '参数估计难度'], rows: [
            ['AR(p)', '1/A(z)（全极点）', 'σ² / |1 + Σ a_k·exp(−jωk)|²', '能造出极尖锐的谱峰，适合线谱与共振', '线性，闭式解（Y-W / Burg）'],
            ['MA(q)', 'B(z)（全零点）', 'σ²·|1 + Σ b_k·exp(−jωk)|²', '只能造谱谷，不能造尖峰', '非线性，需迭代'],
            ['ARMA(p,q)', 'B(z)/A(z)', 'σ²·|B/A|²', '峰谷都能造，最灵活', '非线性，最难']
          ] },
          { t: 'md', md: '**AR 谱的直观图像**：$A(e^{j\\omega})$ 在极点附近接近零，于是 $P_{xx}$ 出现尖峰。极点的**角度**给出频率，极点到单位圆的**距离**给出峰的锐度（带宽）。所以 AR 谱估计等价于**先找极点，再画谱**——这也是它能"外推"的原因。' },
          { t: 'math', tex: 'P_{AR}(\\omega) = \\frac{\\sigma^2}{\\left|\\displaystyle 1+\\sum_{k=1}^{p} a_k e^{-j\\omega k}\\right|^2},\\qquad \\omega_i = \\arg(z_i),\\; z_i:\\; A(z_i)=0', tag: '(3)' },
          { t: 'callout', kind: 'note', title: '为什么工程上几乎只用 AR', md: '（1）AR 的参数估计是**线性问题**（Yule-Walker 方程），有 $O(p^2)$ 的 Levinson-Durbin 递推，实时性好；（2）Wold 分解定理保证：任何不含纯确定性分量的平稳过程都能用足够高阶的 MA（从而 AR）任意逼近；（3）语音、机械振动、舰船线谱等实际信号天然具有**共振结构**，与全极点模型高度契合。' }
        ]
      },
      {
        id: 'yw', num: '3', title: 'Yule-Walker 方程与 Levinson-Durbin 递推',
        blocks: [
          { t: 'md', md: '把式 (1)（取 $q=0$）两边同乘 $x^{*}[n-\\ell]$ 并取期望，利用 $R_{xx}[-m]=R_{xx}^{*}[m]$，得到 Yule-Walker 方程：' },
          { t: 'math', tex: '\\sum_{k=1}^{p} a_k\\,R_{xx}[\\ell-k] = -R_{xx}[\\ell],\\qquad \\ell = 1,2,\\dots,p', tag: '(4)' },
          { t: 'md', md: '以及白噪声方差：$\\sigma^2 = R_{xx}[0] + \\sum_{k=1}^{p} a_k R_{xx}[-k]$。这是一个 **Toeplitz 方程组**，直接求解需 $O(p^3)$；利用 Toeplitz 结构可以用 **Levinson-Durbin 递推**降到 $O(p^2)$：' },
          {
            t: 'fold', summary: '展开：Levinson-Durbin 递推要点与反射系数', deriv: true, blocks: [
              { t: 'md', md: '记 $k_m$ 为第 $m$ 阶**反射系数**（也叫部分相关 PARCOR 系数），$e_m$ 为第 $m$ 阶预测误差功率。递推式为' },
              { t: 'math', tex: 'k_m = -\\frac{R_{xx}[m] + \\sum\\limits_{i=1}^{m-1} a_i^{(m-1)} R_{xx}[m-i]}{e_{m-1}}, \\qquad e_m = e_{m-1}\\left(1-|k_m|^2\\right)', tag: '(5)' },
              { t: 'math', tex: 'a_i^{(m)} = a_i^{(m-1)} + k_m\\,a_{m-i}^{(m-1)\\;*},\\quad i=1,\\dots,m-1;\\qquad a_m^{(m)} = k_m', tag: '(6)' },
              { t: 'md', md: '**为什么 $|\u03ba| < 1$ 保证稳定**：从式 (5) 的第二式可见，$e_m = e_{m-1}(1-|k_m|^2)$。预测误差功率 $e_m$ 是**非负**的物理量，且阶数升高只会让误差功率不增，故必有 $1-|k_m|^2\\ge 0$，即' },
              { t: 'math', tex: '|\\kappa_m| \\le 1 \\quad (\\text{实用中取严格 } |\\kappa_m|<1)', tag: '(7)' },
              { t: 'md', md: '反过来，Levinson 递推的**逆定理**告诉我们：若所有阶的反射系数都满足 $|k_m|<1$，则由它们生成的 AR 多项式 $A_p(z)$ 的**全部零点都在单位圆内**，即模型稳定（最小相位）。这正是**格型滤波器**稳定性的判据，也是 Burg 方法能保证 AR 模型稳定的原因（Burg 的 $k_m$ 由式 (8) 给出，其模长恒 $\\le 1$）。' },
              { t: 'callout', kind: 'eng', title: '工程上要盯住反射系数', md: '每一行递推都打印一下 $|k_m|$：一旦某一阶的 $|k_m|$ 逼近 1，说明**模型接近临界稳定**，谱峰已经接近 $\\delta$ 函数，再往上加阶数就会出现数值爆炸或虚假的极窄谱线。语音 LPC 里常见的"谱峰飞掉"就是这么发生的。' }
            ]
          },
          { t: 'metrics', list: [
            { label: 'Yule-Walker 计算量', value: 'O(p²)', unit: 'Levinson-Durbin' },
            { label: '直接求解 Toeplitz', value: 'O(p³)', unit: '高斯消元' },
            { label: '稳定性判据', value: '|κₘ| < 1', unit: '全部阶次' },
            { label: '典型语音 LPC 阶数', value: '10 ~ 16', unit: '8 kHz 采样' }
          ] }
        ]
      },
      {
        id: 'burg', num: '4', title: 'Burg 方法：为什么它比 Yule-Walker 稳健',
        blocks: [
          { t: 'md', md: 'Yule-Walker 法先用**有偏自相关估计** $\\hat{R}[m]$ 替代真值，再解方程组。问题在两端：自相关估计在大滞后处（$m$ 接近 $N$）方差极大，而这些糟糕的估计被原封不动塞进了方程。' },
          { t: 'md', md: 'Burg 的思路完全不同：**不做显式自相关估计，而是直接最小化前向与后向预测误差功率之和**，逐阶递推求反射系数：' },
          { t: 'math', tex: '\\kappa_m = \\frac{-2\\sum\\limits_{n=m}^{N-1} f_{m-1}[n]\\,b_{m-1}^{*}[n-1]}{\\sum\\limits_{n=m}^{N-1}\\left(|f_{m-1}[n]|^2+|b_{m-1}[n-1]|^2\\right)}', tag: '(8)' },
          { t: 'md', md: '由于分母是分子各项模方的和，由柯西-施瓦茨不等式立刻有 $|\\kappa_m|\\le 1$，**稳定性由构造保证**。' },
          { t: 'table', cols: ['对比项', 'Yule-Walker', 'Burg'], rows: [
            ['是否需要显式自相关', '是', '否（直接对数据操作）'],
            ['递推依据', 'Toeplitz 方程组的阶数递推', '前/后向预测误差功率最小化'],
            ['稳定性保证', '短数据时可能失稳（极点跑出单位圆）', '由式 (8) 恒有 |κ| ≤ 1'],
            ['谱峰偏移', '较明显（自相关估计偏差）', '较小'],
            ['短数据表现', '偏差大、可能出负谱', '**明显更好**'],
            ['已知缺陷', '分辨率偏低', '**谱线分裂**、对初相敏感']
          ] },
          {
            t: 'widget', render: function (el) {
              const fs2 = 1000, N = 64;
              const base = C.multisin(N, fs2, [
                { freq: 200, amp: 1, phase: 0.3 },
                { freq: 212.5, amp: 1, phase: 1.1 }
              ]);
              const x = C.addNoise(base, 20, 20241024);
              const NB = 500, lo = 140, hi = 270;
              const fr = freqGrid(lo, hi, NB);
              const Pper = C.periodogram(x, C.window('rect', N), 2048, fs2);
              // 取周期图在频段内的采样
              const pIdx = [];
              for (let i = 0; i < Pper.f.length; i++) if (Pper.f[i] >= lo && Pper.f[i] <= hi) pIdx.push(i);
              const fper = pIdx.map(i => Pper.f[i]);
              const vper = pIdx.map(i => Pper.psd[i]);
              const ref = maxOfArr(vper);

              const boxL = DSP.ui.plotBox({ title: '同一段数据：Y-W 与 Burg（p = 12）' });
              const pL = DSP.plot.new(boxL.canvas, { height: 260, xlabel: 'f / Hz', ylabel: 'PSD / dB', legend: true, legendPos: 'tr', ylim: [-48, 4] });
              const yw = levinson(acfBiased(x, 12), 12);
              const bg = burg(x, 12);
              const Syw = arSpectrumAt(yw.a, yw.e, fr, fs2);
              const Sbg = arSpectrumAt(bg.a, bg.e, fr, fs2);
              pL.add({ x: arr(fr), y: arr(toDbVec(Syw, maxOfArr(Syw))), color: 1, width: 1.6, label: 'Yule-Walker p = 12' });
              pL.add({ x: arr(fr), y: arr(toDbVec(Sbg, maxOfArr(Sbg))), color: 2, width: 1.8, label: 'Burg p = 12' });

              const boxR = DSP.ui.plotBox({ title: '阶数过高：Burg p = 48 冒出伪峰（p = 12 作参考）' });
              const pR = DSP.plot.new(boxR.canvas, { height: 260, xlabel: 'f / Hz', ylabel: 'PSD / dB', legend: true, legendPos: 'tr', ylim: [-48, 4] });
              const bg48 = burg(x, 48);
              const S48 = arSpectrumAt(bg48.a, bg48.e, fr, fs2);
              pR.add({ x: arr(fr), y: arr(toDbVec(Sbg, maxOfArr(Sbg))), color: 3, width: 1.4, dash: [4, 3], label: 'Burg p = 12（参考）' });
              pR.add({ x: arr(fr), y: arr(toDbVec(S48, maxOfArr(S48))), color: 4, width: 1.8, label: 'Burg p = 48（出现伪峰）' });
              pR.vline(200, { label: '200 Hz', color: U.themeColor('--text-dim') });
              pR.vline(212.5, { label: '212.5 Hz', color: U.themeColor('--text-dim') });
              pL.draw(); pR.draw();
              const grid = U.h('div.grid.g2', {}, [boxL.el, boxR.el]);
              el.appendChild(grid);
              el.appendChild(U.h('div.plot-cap', { html: U.md('左：Burg 谱峰比 Y-W 更窄、更贴近真值（200 / 212.5 Hz）。右：把阶数提到 48（接近 $N$）后，真峰左侧 190 Hz 附近**凭空多出一根谱线**——这就是谱线分裂（伪峰），纯粹是高阶模型把噪声拟合成"信号"的结果。**永远不要凭"峰更多"来判断模型更好。**') }));
            }
          }
        ]
      },
      {
        id: 'order', num: '5', title: '阶数选择：AIC / MDL / FPE 与 p=4 对 p=20 的实例',
        blocks: [
          { t: 'md', md: '阶数是参数模型唯一必须人为给定的量，也是最容易被拍脑袋决定的量。三种经典准则都在"拟合残差"与"参数个数"之间做惩罚：' },
          { t: 'math', tex: '\\mathrm{AIC}(p) = N\\ln \\hat{\\sigma}_p^2 + 2p', tag: '(8)' },
          { t: 'math', tex: '\\mathrm{MDL}(p) = N\\ln \\hat{\\sigma}_p^2 + p\\ln N', tag: '(9)' },
          { t: 'math', tex: '\\mathrm{FPE}(p) = \\hat{\\sigma}_p^2\\,\\frac{N+p+1}{N-p-1}', tag: '(10)' },
          { t: 'table', cols: ['准则', '惩罚项', '统计性质', '工程取舍'], rows: [
            ['AIC', '2p', '不一致：N→∞ 时倾向于过估阶数', '追求预测精度，短数据下更"敢给阶"'],
            ['MDL', 'p·ln N', '一致：N→∞ 时依概率收敛到真阶', '追求模型正确性，长数据下更可靠'],
            ['FPE', '(N+p+1)/(N−p−1)', '等价于 AIC（一阶近似）', '常用于控制系统辨识']
          ] },
          { t: 'md', md: '选阶的实用流程：**先画出 $\\hat{\\sigma}_p^2$ 随 $p$ 的曲线**，找到"拐点"（残差不再明显下降），再用 AIC / MDL 交叉验证。若两者给出不同阶数，通常取二者之间，并**检查谱峰是否随阶数抖动**——抖动剧烈说明模型失配。' },
          {
            t: 'plot', title: 'AIC 与 MDL 随阶数变化（N = 64，两个靠得很近的正弦）', height: 260,
            render: function (canvas) {
              const fs2 = 1000, N = 64;
              const base = C.multisin(N, fs2, [{ freq: 200, amp: 1, phase: 0.3 }, { freq: 212.5, amp: 1, phase: 1.1 }]);
              const x = C.addNoise(base, 20, 20241024);
              const ps = [], aics = [], mdls = [];
              for (let p = 1; p <= 28; p++) {
                const b = burg(x, p);
                ps.push(p);
                aics.push(N * Math.log(Math.max(b.e, 1e-30)) + 2 * p);
                mdls.push(N * Math.log(Math.max(b.e, 1e-30)) + p * Math.log(N));
              }
              const p = DSP.plot.new(canvas, { height: 260, xlabel: '阶数 p', ylabel: '准则值', legend: true, legendPos: 'tr' });
              p.add({ x: ps, y: aics, color: 0, width: 1.8, label: 'AIC' });
              p.add({ x: ps, y: mdls, color: 2, width: 1.8, label: 'MDL' });
              let ai = 0; for (let i = 1; i < aics.length; i++) if (aics[i] < aics[ai]) ai = i;
              let mi = 0; for (let i = 1; i < mdls.length; i++) if (mdls[i] < mdls[mi]) mi = i;
              p.vline(ps[ai], { label: 'AIC 最小 p=' + ps[ai], color: U.themeColor('--plot-c1') });
              p.vline(ps[mi], { label: 'MDL 最小 p=' + ps[mi], color: U.themeColor('--plot-c3') });
              p.draw();
            }
          },
          {
            t: 'widget', render: function (el) {
              const fs2 = 1000, N = 64;
              const base = C.multisin(N, fs2, [{ freq: 200, amp: 1, phase: 0.3 }, { freq: 212.5, amp: 1, phase: 1.1 }]);
              const x = C.addNoise(base, 20, 20241024);
              const rows = [];
              [4, 20].forEach(function (pp) {
                const b = burg(x, pp);
                const pol = arPoles(b.a, fs2);
                const f1 = pol.length ? pol[0].freq : NaN;
                const f2 = pol.length > 1 ? pol[pol.length - 1].freq : NaN;
                const err = Math.max(Math.abs(f1 - 200), Math.abs(f2 - 212.5));
                const aic = N * Math.log(Math.max(b.e, 1e-30)) + 2 * pp;
                const mdl = N * Math.log(Math.max(b.e, 1e-30)) + pp * Math.log(N);
                rows.push([String(pp), aic.toFixed(1), mdl.toFixed(1), f1.toFixed(1) + ' / ' + f2.toFixed(1), err.toFixed(1) + ' Hz', err < 6 ? '已分辨' : '未分辨']);
              });
              el.appendChild(DSP.ui.table({
                cols: ['阶数 p', 'AIC', 'MDL', '估计双峰频率 / Hz', '最大偏差', '是否分辨'],
                rows: rows
              }));
              el.appendChild(U.h('div.plot-cap', { html: U.md('真值 200 Hz 与 212.5 Hz，$N=64$（记录长度仅 64 ms，两音间隔 0.8 个 FFT 栅格）。**$p=4$ 太保守**：一个宽峰盖住两个音；**$p=20$ 恰当**：双峰分离且稳定。注意：这里的"已分辨"是相对 $f_s/N=15.6$ Hz 的瑞利限而言——AR 谱把两个相距 12.5 Hz 的峰分开了。') }));
            }
          }
        ]
      },
      {
        id: 'ma', num: '6', title: 'MA 与 ARMA 的估计难点：非线性之墙',
        blocks: [
          { t: 'md', md: 'AR 之所以好解，是因为预测误差对系数 $a_k$ **是线性的**，于是最小二乘有闭式解。MA 与 ARMA 没有这个性质：' },
          { t: 'math', tex: 'P_{MA}(\\omega)=\\sigma^2\\left|1+\\sum_{k=1}^{q}b_k e^{-j\\omega k}\\right|^2 \\;=\\; \\sigma^2\\!\\!\\sum_{m=-q}^{q}\\!\\!\\left(\\sum_k b_k b_{k+m}\\right)e^{-j\\omega m}', tag: '(11)' },
          { t: 'md', md: '可见 MA 谱是系数 $b_k$ 的**二次函数**。最小化预测误差因此成为非线性优化问题，**误差面存在多个局部极小**，没有闭式解。' },
          { t: 'table', cols: ['方法', '思路', '优点', '缺点'], rows: [
            ['**Durbin 两步法**', '先拟合一个高阶 AR，再由 AR 系数反推 MA', '只需线性运算，实现简单', '不是最大似然，统计效率偏低'],
            ['**非线性最小二乘**', '直接对预测误差做数值优化', '效率较高', '需初值，可能陷入局部极小'],
            ['**最大似然（MLE）**', '在高斯假设下最大化似然函数', '统计最优（渐近有效）', '计算量大，初值敏感'],
            ['**递推预测误差法（RPEM）**', '在线递推更新参数', '适合实时跟踪', '收敛性需监控']
          ] },
          { t: 'callout', kind: 'eng', title: '工程上的现实选择', md: '**能用 AR 就用 AR。** 理由有三：\n\n- 噪声中的正弦严格说是 ARMA 过程，但**只要 SNR 不太低，用足够高阶的 AR 就能任意逼近**（AR(∞) 表示）；\n- AR 有 $O(p^2)$ 的快递推与格型实现，FPGA/DSP 上容易做到实时；\n- MA/ARMA 的迭代优化**没有收敛保证**，在无人值守的嵌入式设备上风险太高。\n\n只有在**谱谷很关键**的场合（例如要精确刻画杂波谱的凹口）才值得上 ARMA，并且一定要做多次初值重启。' }
        ]
      },
      {
        id: 'compare', num: '7', title: 'AR 谱与周期图的本质差别',
        blocks: [
          { t: 'md', md: '这两类方法不是"精度不同"，而是**世界观不同**：' },
          { t: 'table', cols: ['维度', '周期图 / Welch', 'AR 参数谱'], rows: [
            ['窗外数据', '当作零（矩形窗）或加窗渐降', '由模型外推'],
            ['自相关', '只用到 |m| ≤ L，且被窗加权', '先用有限滞后，再由模型外推到 |m| = ∞'],
            ['分辨率来源', '记录长度 1/N', '模型阶数与极点锐度'],
            ['统计一致性', '一致（N→∞ 时方差趋于 0）', '不一致（收敛到"模型的最佳逼近"，非真谱）'],
            ['对模型失配', '不敏感（非参数）', '极其敏感（错阶数 → 伪峰 / 峰偏移）'],
            ['短数据', '完全无能为力', '超分辨能力的主要战场'],
            ['典型失效', '两个近峰糊在一起', '凭空多出峰值（谱线分裂 / 伪峰）']
          ] },
          {
            t: 'plot', title: 'AR 谱与周期图对比：不同阶数（N = 64，间隔 0.8 个 FFT 栅格）', height: 280,
            render: function (canvas) {
              const fs2 = 1000, N = 64;
              const base = C.multisin(N, fs2, [{ freq: 200, amp: 1, phase: 0.3 }, { freq: 212.5, amp: 1, phase: 1.1 }]);
              const x = C.addNoise(base, 20, 20241024);
              const NB = 700, lo = 150, hi = 265;
              const fr = freqGrid(lo, hi, NB);
              const Pper = C.periodogram(x, C.window('hann', N), 2048, fs2);
              const pIdx = [];
              for (let i = 0; i < Pper.f.length; i++) if (Pper.f[i] >= lo && Pper.f[i] <= hi) pIdx.push(i);
              const p = DSP.plot.new(canvas, { height: 280, xlabel: 'f / Hz', ylabel: 'PSD / dB（各自归一化）', legend: true, legendPos: 'tr', ylim: [-42, 4] });
              const vper = pIdx.map(i => Pper.psd[i]);
              p.add({ x: pIdx.map(i => Pper.f[i]), y: arr(toDbVec(vper, maxOfArr(vper))), color: 4, width: 2, dash: [6, 3], label: '周期图（汉宁窗）' });
              const orders = [4, 8, 16, 28];
              orders.forEach(function (pp, i) {
                const b = burg(x, pp);
                const S = arSpectrumAt(b.a, b.e, fr, fs2);
                p.add({ x: arr(fr), y: arr(toDbVec(S, maxOfArr(S))), color: i, width: 1.6, label: 'AR p = ' + pp });
              });
              p.vline(200, { label: '200 Hz' });
              p.vline(212.5, { label: '212.5 Hz' });
              p.draw();
            }
          },
          { t: 'md', md: '读出这张图的信息：$p=4$ 只有一个宽峰；$p=8$ 开始出现肩部；$p=16$ 双峰清晰分离；$p=28$ 峰更窄但开始有伪结构。**阶数不是越大越好，而是要落在"刚好够用"的那一段。**' },
          { t: 'callout', kind: 'danger', title: '一句话记住 AR 的本质与代价', md: '**AR 谱 = 用模型外推自相关。** 外推让它对短数据拥有超分辨能力；但外推的内容是**假设**而不是**观测**，所以它没有统计一致性，且对模型失配极其敏感。\n\n工程口诀：**"短数据要分辨 → 上 AR；要绝对电平或模型不确定 → 回 Welch；两者都要 → 先用 Welch 定全局，再用 AR 精修局部，并交叉验证。"**' }
        ]
      },
      {
        id: 'app', num: '8', title: '应用场景与工程落地',
        blocks: [
          { t: 'table', cols: ['领域', '做法', '为什么用参数模型'], rows: [
            ['语音 LPC', '每 20~30 ms 一帧拟合 AR(10~16)，由极点得共振峰', '声道可建模为全极点谐振腔；AR 阶数低、系数稳定、可插值'],
            ['水声线谱建模', '对舰船辐射噪声做 AR 谱，提取轴频/叶频及其调制边带', '通过时间短、需要远高于 1/N 的分辨率'],
            ['雷达杂波建模', '用低阶 AR 拟合地/海杂波谱，供 CFAR 门限设计', '谱形可写成闭式，便于解析推导检测概率'],
            ['机械故障诊断', '轴承/齿轮振动的 AR 谱峰对应故障特征频率', '瞬态样本短，冲击响应天然是衰减谐振（全极点）']
          ] },
          { t: 'callout', kind: 'eng', title: '声呐目标识别里的实用组合', md: '真实的被动声呐处理链通常这样搭：\n\n1. **宽带分析**：Welch（帧长 8192、汉宁、50% 重叠）得到可靠的连续谱背景；\n2. **线谱提取**：在背景之上做峰值检测，得到候选线谱；\n3. **谐波族建模**：用 AR（Burg，阶数 16~32）精估线谱频率与相对电平，构造轴频—叶频谐波族；\n4. **DEMON 谱**：对选定频带做包络解调再取谱，提取螺旋桨调制谱。\n\n这里 **Welch 负责"可信的电平"，AR 负责"尖锐的频率"**，二者是互补而不是替代关系。' },
          { t: 'callout', kind: 'pit', title: '① 把 AR 谱峰高度当成功率', md: 'AR 谱的峰高由**极点靠近单位圆的程度**决定，而不是信号功率。同一个信号，阶数从 16 提到 28，峰高可能变化 20 dB 以上。**AR 谱只能读频率（峰位置）和相对结构，不能读绝对电平。** 要电平请回到 Welch。' }
        ]
      }
    ],
    refs: [
      'Kay, Modern Spectral Estimation: Theory and Application, Prentice Hall, 1988',
      'Burg, "Maximum Entropy Spectral Analysis", PhD Thesis, Stanford, 1975',
      'Akaike, "A New Look at the Statistical Model Identification", IEEE Trans. Autom. Control, 1974',
      'Rissanen, "Modeling by Shortest Data Description", Automatica, 1978（MDL 准则）'
    ]
  });

  /* ============================================================
     3. 子空间方法
     ============================================================= */
  doc.register('theory/spectrum/subspace', {
    title: '子空间方法：Pisarenko、MUSIC 与 ESPRIT',
    lede: '经典方法与参数模型都在"估谱"，子空间方法根本不估谱——它直接**估频率**。因为"信号子空间与噪声子空间正交"是一条与数据长度无关的几何事实，它绕开了瑞利限。',
    tags: ['谱估计', 'MUSIC', 'ESPRIT', 'Pisarenko', '超分辨', '阵列'],
    labs: [{ path: 'lab/music', title: 'MUSIC 超分辨实验台', desc: '调阵元数、快拍数、SNR 与信源间隔，实时看 MUSIC 谱与周期图的分辨门限' }],
    toc: true,
    sections: [
      {
        id: 'geo', num: '1', title: '为什么能"超分辨"：两条正交的子空间',
        blocks: [
          { t: 'md', md: '先建立一个几何图景。设观测向量 $\\mathbf{x}\\in\\mathbb{C}^{M}$（可以是 $M$ 个阵元的一次快拍，也可以是 $M$ 点连续采样构成的"汉克快照"），它由 $d$ 个复正弦加噪声组成：' },
          { t: 'math', tex: '\\mathbf{x}[k] = \\mathbf{A}\\,\\mathbf{s}[k] + \\mathbf{n}[k],\\qquad \\mathbf{A}=\\big[\\mathbf{a}(\\omega_1),\\dots,\\mathbf{a}(\\omega_d)\\big]\\in\\mathbb{C}^{M\\times d}', tag: '(1)' },
          { t: 'math', tex: '\\mathbf{a}(\\omega)=\\big[1,\\,e^{j\\omega},\\,e^{j2\\omega},\\dots,e^{j(M-1)\\omega}\\big]^{T}', tag: '(2)' },
          { t: 'md', md: '噪声是空时白噪声 $\\mathbf{n}\\sim\\mathcal{CN}(0,\\sigma^2\\mathbf{I})$。于是协方差矩阵为' },
          { t: 'math', tex: '\\mathbf{R} = E\\{\\mathbf{x}\\mathbf{x}^{H}\\} = \\mathbf{A}\\mathbf{P}\\mathbf{A}^{H} + \\sigma^2\\mathbf{I},\\qquad \\mathbf{P}=E\\{\\mathbf{s}\\mathbf{s}^{H}\\}', tag: '(3)' },
          { t: 'md', md: '关键在式 (3) 的结构：$\\mathbf{A}\\mathbf{P}\\mathbf{A}^{H}$ 是一个**秩至多为 $d$ 的半正定矩阵**，加上一个各向同性的 $\\sigma^2\\mathbf{I}$。对这个矩阵做特征分解，前 $d$ 个大特征值 $\\lambda_i=\\mu_i+\\sigma^2$ 对应**信号子空间**，其余 $M-d$ 个特征值严格等于 $\\sigma^2$（**噪声子空间**）。' },
          { t: 'callout', kind: 'tip', title: '超分辨的根源就一句话', md: '**信号子空间 $\\mathcal{E}_S$ 与噪声子空间 $\\mathcal{E}_N$ 正交**，而这条正交性来自**阵列流形的结构**，与快拍数、与记录长度**无关**。\n\n经典方法的分辨率受限于"窗长"，因为它是在**逐点估谱**；子空间方法只需要把"子空间"估准，而子空间是 $d$ 维的低维对象——**估计一个 $d$ 维子空间所需的样本量远小于分辨谱峰所需的样本量**。这就是超分辨的全部秘密。' }
        ]
      },
      {
        id: 'model', num: '2', title: '协方差模型、特征分解与子空间划分',
        blocks: [
          { t: 'md', md: '把 $\\mathbf{R}$ 特征分解并按特征值降序排列：' },
          { t: 'math', tex: '\\mathbf{R} = \\sum_{i=1}^{M}\\lambda_i\\,\\mathbf{v}_i\\mathbf{v}_i^{H} = \\underbrace{\\sum_{i=1}^{d}\\lambda_i\\mathbf{v}_i\\mathbf{v}_i^{H}}_{\\text{信号子空间}} \\;+\\; \\underbrace{\\sigma^2\\sum_{i=d+1}^{M}\\mathbf{v}_i\\mathbf{v}_i^{H}}_{\\text{噪声子空间}}', tag: '(4)' },
          { t: 'md', md: '由此得到两个矩阵：' },
          { t: 'kv', title: '子空间定义', pairs: [
            ['信号子空间 E_S', '$M\\times d$，由前 $d$ 个特征向量张成；$\\mathrm{span}\\{\\mathbf{E}_S\\}=\\mathrm{span}\\{\\mathbf{a}(\\omega_1),\\dots,\\mathbf{a}(\\omega_d)\\}$'],
            ['噪声子空间 E_N', '$M\\times(M\\!-\\!d)$，由后 $M\\!-\\!d$ 个特征向量张成；$\\mathbf{E}_N\\perp\\mathbf{a}(\\omega_i)$']
          ] },
          { t: 'md', md: '**正交性是全部子空间方法的出发点**：对真实频率 $\\omega_i$，有 $\\mathbf{a}^{H}(\\omega_i)\\,\\mathbf{E}_N = \\mathbf{0}$；对其它频率则不成立。于是只要扫描 $\\omega$，寻找使 $\\|\\mathbf{E}_N^{H}\\mathbf{a}(\\omega)\\|$ 最小的点，就找到了频率。' },
          { t: 'math', tex: '\\mathbf{E}_N^{H}\\mathbf{a}(\\omega_i)=\\mathbf{0} \\;\\Longleftrightarrow\\; \\mathbf{a}(\\omega_i)\\in \\mathcal{E}_S \\;\\Longleftrightarrow\\; P_{MU}(\\omega_i)\\to\\infty', tag: '(5)' },
          {
            t: 'fold', summary: '展开：为什么噪声子空间与导向向量正交', deriv: true, blocks: [
              { t: 'md', md: '取噪声子空间任意特征向量 $\\mathbf{v}$（对应特征值 $\\sigma^2$），则 $\\mathbf{R}\\mathbf{v}=\\sigma^2\\mathbf{v}$。代入式 (3)：' },
              { t: 'math', tex: '\\big(\\mathbf{A}\\mathbf{P}\\mathbf{A}^{H}+\\sigma^2\\mathbf{I}\\big)\\mathbf{v}=\\sigma^2\\mathbf{v} \\;\\Longrightarrow\\; \\mathbf{A}\\mathbf{P}\\mathbf{A}^{H}\\mathbf{v}=\\mathbf{0}', tag: '(6)' },
              { t: 'md', md: '左乘 $\\mathbf{v}^{H}$：$\\mathbf{v}^{H}\\mathbf{A}\\mathbf{P}\\mathbf{A}^{H}\\mathbf{v}=0$。若 $\\mathbf{P}$ 正定（信源互不相关），则必有 $\\mathbf{A}^{H}\\mathbf{v}=\\mathbf{0}$，即 $\\mathbf{a}^{H}(\\omega_i)\\,\\mathbf{v}=0$ 对全部 $i$ 成立。∎' },
              { t: 'callout', kind: 'warn', title: '前提：P 必须满秩', md: '上式用到了 $\\mathbf{P}\\succ 0$，即**信源互不相关**。若两个信源相干（例如同一目标的直达波与海面反射波），$\\mathbf{P}$ 奇异，$\\mathbf{A}\\mathbf{P}\\mathbf{A}^{H}$ 的秩小于 $d$，噪声子空间里就混进了信号方向——**此时 MUSIC 会彻底失败，必须先做空间平滑**（见第 7 节）。' }
            ]
          }
        ]
      },
      {
        id: 'pisarenko', num: '3', title: 'Pisarenko：噪声子空间一维时的求根法（MUSIC 的前身）',
        blocks: [
          { t: 'md', md: 'Pisarenko 谐波分解处理的是最简洁的情形：取 $M = d+1$，于是噪声子空间恰好是**一维**的，只由最小特征值对应的特征向量 $\\mathbf{v}_{min}$ 张成。' },
          { t: 'md', md: '既然 $\\mathbf{a}^{H}(\\omega_i)\\mathbf{v}_{min}=0$，把 $\\mathbf{v}_{min}$ 的分量当作多项式系数：' },
          { t: 'math', tex: 'V(z)=\\sum_{m=0}^{M-1} v_{min}[m]\\,z^{-m},\\qquad V\\!\\left(e^{j\\omega_i}\\right)=0', tag: '(7)' },
          { t: 'md', md: '也就是说：**真实频率恰好是多项式 $V(z)$ 在单位圆上的根**。于是算法退化成两步——求最小特征向量、对 $V(z)$ 求根。这正是 MUSIC 的"谱峰"在 $M-d=1$ 时的退化版本：此时 $\\mathbf{E}_N$ 只有一个向量，$\\|\\mathbf{E}_N^H\\mathbf{a}(\\omega)\\|=|V(e^{j\\omega})|$，MUSIC 伪谱的无穷大尖峰就是 $V$ 的零点。' },
          {
            t: 'widget', render: function (el) {
              const fs2 = 1000, M = 5, K = 400, N = K + M - 1;
              const clean = new Float64Array(N);
              for (let n = 0; n < N; n++) clean[n] = Math.cos(2 * Math.PI * 0.20 * n + 0.3) + 0.8 * Math.cos(2 * Math.PI * 0.30 * n + 1.1);
              const x = C.addNoise(clean, 20, 20241024);
              const R = snapCovFB(x, M, K);
              const E = eigSym(R, M);
              const v = [];
              for (let r = 0; r < M; r++) v.push(E.V[r * M + M - 1]);
              const nrm = Math.sqrt(v.reduce((s, t) => s + t * t, 0)) || 1;
              for (let i = 0; i < v.length; i++) v[i] /= nrm;
              const roots = rootsDK(v, new Float64Array(M));
              const rows = [];
              roots.forEach(function (z) {
                rows.push([
                  z.re.toFixed(4) + (z.im >= 0 ? ' + j' : ' − j') + Math.abs(z.im).toFixed(4),
                  cAbs(z).toFixed(4),
                  (Math.atan2(z.im, z.re) / (2 * Math.PI) * fs2).toFixed(2)
                ]);
              });
              el.appendChild(DSP.ui.table({
                cols: ['多项式根 z', '根的模 |z|', '对应频率 / Hz'],
                rows: rows
              }));
              el.appendChild(U.h('div.plot-cap', { html: U.md('$M=5$（两个实正弦 → 4 维信号子空间 + 1 维噪声子空间），$K=400$ 快拍，$\\mathrm{SNR}=20$ dB。四个根**成对共轭出现**（实信号的必然结果），取正频率两支即得 $\\hat f_1,\\hat f_2$，与真值 200 / 300 Hz 吻合到 1 Hz 以内。**这就是 Pisarenko：把频率估计化成了多项式求根。**') }));
            }
          },
          { t: 'callout', kind: 'note', title: 'Pisarenko 的历史地位与现实局限', md: '它是**第一个**利用协方差特征结构做频率估计的方法，MUSIC 是它在 $M>d+1$ 时的自然推广（把"一个向量正交"推广为"一个子空间正交"，并用谱峰搜索代替求根）。\n\n但它有个致命弱点：**只用了一个噪声特征向量**，没有做统计平均，因此在有限快拍下方差很大、对噪声极敏感。现代系统几乎不用它做主估计器，但它仍然是理解子空间方法**最好的入门模型**——因为它把"频率 = 多项式零点"这件事暴露得最直白。' }
        ]
      },
      {
        id: 'music', num: '4', title: 'MUSIC 伪谱：定义、尖峰来源与"它不是功率谱"',
        blocks: [
          { t: 'md', md: 'MUSIC（MUltiple SIgnal Classification）把 Pisarenko 的一维噪声向量推广为噪声子空间，并直接用**谱峰搜索**代替求根：' },
          { t: 'math', tex: 'P_{MU}(\\omega)=\\frac{1}{\\mathbf{a}^{H}(\\omega)\\,\\mathbf{E}_N\\mathbf{E}_N^{H}\\,\\mathbf{a}(\\omega)} \\;=\\; \\frac{1}{\\sum\\limits_{i=d+1}^{M}\\left|\\mathbf{v}_i^{H}\\mathbf{a}(\\omega)\\right|^{2}}', tag: '(6)' },
          { t: 'md', md: '分母叫**噪声子空间投影残差**。当 $\\omega$ 落在真实频率上时，$\\mathbf{a}(\\omega)$ 完全落在信号子空间里，与噪声子空间正交，分母趋于零，伪谱出现尖峰。' },
          {
            t: 'fold', summary: '展开：为什么真实频率处必出现尖峰', deriv: true, blocks: [
              { t: 'md', md: '**第一步**：由式 (3)，$\\mathbf{R}$ 的特征向量分成两组。对 $i>d$，$\\mathbf{R}\\mathbf{v}_i=\\sigma^2\\mathbf{v}_i$，代入式 (3) 得' },
              { t: 'math', tex: '\\mathbf{A}\\mathbf{P}\\mathbf{A}^{H}\\mathbf{v}_i=\\mathbf{0}', tag: '(7)' },
              { t: 'md', md: '**第二步**：左乘 $\\mathbf{v}_i^{H}$，$\\;(\\mathbf{A}^{H}\\mathbf{v}_i)^{H}\\mathbf{P}\\,(\\mathbf{A}^{H}\\mathbf{v}_i)=0$。因 $\\mathbf{P}\\succ0$，必有 $\\mathbf{A}^{H}\\mathbf{v}_i=\\mathbf{0}$，即每个噪声特征向量都与所有导向向量正交。' },
              { t: 'md', md: '**第三步**：把噪声特征向量排成 $\\mathbf{E}_N$，则 $\\mathbf{E}_N^{H}\\mathbf{A}=\\mathbf{0}$，等价地 $\\mathbf{E}_N^{H}\\mathbf{a}(\\omega_i)=\\mathbf{0}$。' },
              { t: 'md', md: '**第四步**：定义 $g(\\omega)=\\|\\mathbf{E}_N^{H}\\mathbf{a}(\\omega)\\|^2\\ge0$，它在 $\\omega=\\omega_i$ 处取零。由于 $\\mathbf{a}(\\omega)$ 与 $\\mathbf{a}(\\omega_i)$ 的内积是 $\\omega$ 的连续函数且随 $|\\!\\omega\\!-\\!\\omega_i\\!|$ 增大而下降（本质是两个不同频率的正弦在有限孔径上不完全相关），$g(\\omega)$ 在真实频率处有**孤立零点**。于是 $P_{MU}=1/g$ 在 $\\omega_i$ 处发散为尖峰。' },
              { t: 'callout', kind: 'warn', title: '有限样本下是"很大"而不是"无穷"', md: '真实工程中 $\\hat{\\mathbf{R}}$ 由 $K$ 个快拍估出，噪声特征值不会严格相等，导向向量也不会精确正交，所以伪谱是**很高但有限**的峰。正是这一点决定了第 6 节的 SNR / 快拍门限。' }
            ]
          },
          { t: 'callout', kind: 'pit', title: '① 伪谱峰的 dB 值不能当功率用', md: 'MUSIC 输出的是 $1/\\|\\mathbf{E}_N^H\\mathbf{a}\\|^2$，量纲与功率无关：\n\n- **峰高由正交性残差决定**，SNR 高、快拍多 → 残差小 → 峰高。同一个信号换个 $K$ 峰高能差 30 dB；\n- 不同频率点的**峰高不可比**：孔径边缘的频率导向向量范数不同；\n- 正确的用法是**只读峰位置**（或者用峰高做相对排序，但绝不能当谱级上报）。\n\n若需要功率，请在估计出频率后，用最小二乘拟合各正弦的幅度，或用 Welch 在对应分辨单元内积分。' }
        ]
      },
      {
        id: 'esprit', num: '5', title: 'ESPRIT：旋转不变性给出的封闭解',
        blocks: [
          { t: 'md', md: 'MUSIC 要在一维频率栅格上搜索，计算量正比于栅格点数，且精度受栅格限制。**ESPRIT**（Estimation of Signal Parameters via Rotational Invariance Techniques）换了个思路：如果阵列具有**平移不变结构**，频率可以直接算出来，不用搜索。' },
          { t: 'md', md: '把信号子空间 $\\mathbf{E}_S$（$M\\times d$）拆成上下重叠的两块：' },
          { t: 'math', tex: '\\mathbf{E}_1 = \\mathbf{E}_S\\,[\\,0:M-2,\\,:\\,],\\qquad \\mathbf{E}_2 = \\mathbf{E}_S\\,[\\,1:M-1,\\,:\\,]', tag: '(8)' },
          { t: 'md', md: '由于导向向量满足 $\\mathbf{a}(\\omega)$ 的第 $m\\!+\\!1$ 个分量 $=e^{j\\omega}\\cdot$ 第 $m$ 个分量，两块之间存在一个**旋转算子** $\\boldsymbol{\\Phi}=\\mathrm{diag}\\{e^{j\\omega_1},\\dots,e^{j\\omega_d}\\}$：' },
          { t: 'math', tex: '\\mathbf{E}_2 = \\mathbf{E}_1\\,\\mathbf{T}^{-1}\\boldsymbol{\\Phi}\\mathbf{T} \\;\\equiv\\; \\mathbf{E}_1\\boldsymbol{\\Psi},\\qquad \\boldsymbol{\\Psi}=\\mathbf{T}^{-1}\\boldsymbol{\\Phi}\\mathbf{T}', tag: '(9)' },
          { t: 'md', md: '$\\boldsymbol{\\Psi}$ 与 $\\boldsymbol{\\Phi}$ **相似**，因此**特征值相同**。于是只要求出 $\\boldsymbol{\\Psi}$ 的特征值 $\\mu_i$，频率即' },
          { t: 'math', tex: '\\hat{\\omega}_i = \\arg(\\mu_i),\\qquad \\hat f_i = \\frac{\\hat{\\omega}_i}{2\\pi}f_s', tag: '(10)' },
          { t: 'md', md: '**实信号下的成对结构**：若数据是实的，每个正弦对应一对共轭复指数 $\\pm\\omega_i$，因此 $\\boldsymbol{\\Psi}$ 的特征值**成共轭对出现**（$\\mu, \\mu^{*}$），取正频率那一支即可。这也是为什么本页用 $d=4$（两个实正弦 → 4 维信号子空间）。' },
          { t: 'md', md: '**TLS-ESPRIT**：式 (9) 两端都有估计误差，直接最小二乘会有偏。更严谨的做法是把 $[\\mathbf{E}_1\\;\\mathbf{E}_2]$ 拼起来做奇异值分解，用**总体最小二乘**同时修正两端的扰动，再取子块构造 $\\boldsymbol{\\Psi}$。在低 SNR 下 TLS 版明显更稳。' },
          { t: 'table', cols: ['对比', 'MUSIC', 'ESPRIT'], rows: [
            ['是否需要谱峰搜索', '**需要**（栅格越细越准，算力线性增长）', '**不需要**（封闭解）'],
            ['是否给出功率', '否（伪谱）', '否（只给频率）'],
            ['阵列要求', '任意阵列结构', '**必须有平移不变子阵**（均匀线阵最典型）'],
            ['统计精度', '高', '通常略优于 MUSIC（渐近方差更低）'],
            ['多维参数配对', '需额外处理', '天然成对/成组输出']
          ] },
          {
            t: 'widget', render: function (el) {
              const fs2 = 1000, N = 128, M = 32, K = N - M + 1;
              const f1 = 200, f2 = 203.9;
              const clean = new Float64Array(N);
              for (let n = 0; n < N; n++) clean[n] = Math.cos(2 * Math.PI * f1 / fs2 * n + 0.3) + Math.cos(2 * Math.PI * f2 / fs2 * n + 1.1);
              const x = C.addNoise(clean, 20, 20241024);
              const R = snapCovFB(x, M, K);
              const E = eigSym(R, M);
              const d = 4, nN = M - d;
              const Es = eigCols(E, M, 0, d), En = eigCols(E, M, d, M);
              const est = espritFreqs(Es, M, d, fs2);
              // MUSIC 峰搜索
              const NB = 4000, lo = 160, hi = 245;
              const fr = freqGrid(lo, hi, NB);
              const S = musicAt(En, M, nN, fr, fs2);
              let mi = 0;
              for (let i = 1; i < S.length; i++) if (S[i] > S[mi]) mi = i;
              // 次峰：排除主峰 ±0.5 Hz
              let m2 = -1;
              for (let i = 1; i < S.length - 1; i++) {
                if (Math.abs(fr[i] - fr[mi]) < 1.2) continue;
                if (S[i] > S[i - 1] && S[i] >= S[i + 1] && (m2 < 0 || S[i] > S[m2])) m2 = i;
              }
              // 周期图峰搜索（同一段数据）
              const Pper = C.periodogram(x, C.window('hann', N), 4096, fs2);
              const pIdx = [];
              for (let i = 0; i < Pper.f.length; i++) if (Pper.f[i] >= lo && Pper.f[i] <= hi) pIdx.push(i);
              const pv = pIdx.map(i => Pper.psd[i]);
              const pPks = [];
              for (let i = 1; i < pv.length - 1; i++) if (pv[i] > pv[i - 1] && pv[i] >= pv[i + 1]) pPks.push({ f: Pper.f[pIdx[i]], v: pv[i] });
              pPks.sort((a, b) => b.v - a.v);
              const mPair = [fr[mi], m2 >= 0 ? fr[m2] : NaN].filter(v => !isNaN(v)).sort((a, b) => a - b);
              const rows = [
                ['真值', '200.00 / 203.90', '间隔 3.9 Hz'],
                ['周期图峰搜索（N = 128）', pPks.length ? pPks[0].f.toFixed(2) + '（仅 1 个峰）' : '—', '瑞利限内无法区分'],
                ['MUSIC 谱峰搜索（M = 32）', mPair.map(v => v.toFixed(2)).join(' / '), '两根尖峰'],
                ['ESPRIT 封闭解（M = 32）', est.map(e => e.freq.toFixed(2)).sort((a, b) => a - b).join(' / '), '无需搜索']
              ];
              el.appendChild(DSP.ui.table({
                cols: ['方法', '估计频率 / Hz', '备注'],
                rows: rows
              }));
              el.appendChild(U.h('div.plot-cap', { html: U.md('同一段数据（两个相距 3.9 Hz 的正弦，$N=128$，$\\mathrm{SNR}=20$ dB）。注意 MUSIC 与 ESPRIT 都给出两个频率，而周期图在 $f_s/N=7.8$ Hz 的瑞利限下只能找到一个峰。（Pisarenko 的数值结果见第 3 节专用示例，那里使用间隔较大的两个音，因为 $M=5$ 的孔径无法支撑 3.9 Hz 的间隔。）') }));
            }
          }
        ]
      },
      {
        id: 'threshold', num: '6', title: '分辨率对比：瑞利限 vs SNR / 快拍门限',
        blocks: [
          { t: 'md', md: '传统分辨率由**孔径**决定（瑞利限 $\\Delta f \\approx f_s/L$）。子空间方法的极限不由孔径决定，而由**子空间估计精度**决定：只要噪声子空间估得准，多近都能分开——但"估得准"需要足够的 SNR 与快拍数。这就把分辨率问题变成了一个**统计门限**问题。' },
          {
            t: 'plot', title: 'MUSIC 谱 vs 周期图：同一段数据（间隔 0.5 个 FFT 栅格）', height: 280,
            render: function (canvas) {
              const fs2 = 1000, N = 128, M = 32, K = N - M + 1;
              const f1 = 200, f2 = 203.9;
              const clean = new Float64Array(N);
              for (let n = 0; n < N; n++) clean[n] = Math.cos(2 * Math.PI * f1 / fs2 * n + 0.3) + Math.cos(2 * Math.PI * f2 / fs2 * n + 1.1);
              const x = C.addNoise(clean, 20, 20241024);
              const E = eigSym(snapCovFB(x, M, K), M);
              const d = 4, nN = M - d;
              const En = eigCols(E, M, d, M);
              const NB = 1200, lo = 170, hi = 235;
              const fr = freqGrid(lo, hi, NB);
              const S = musicAt(En, M, nN, fr, fs2);
              const Pper = C.periodogram(x, C.window('rect', N), 4096, fs2);
              const idx = [];
              for (let i = 0; i < Pper.f.length; i++) if (Pper.f[i] >= lo && Pper.f[i] <= hi) idx.push(i);
              const p = DSP.plot.new(canvas, { height: 280, xlabel: 'f / Hz', ylabel: '归一化 / dB', legend: true, legendPos: 'tr', ylim: [-40, 3] });
              const Sm = maxOfArr(S), Pm = maxOfArr(idx.map(i => Pper.psd[i]));
              p.add({ x: arr(fr), y: arr(toDbVec(S, Sm)), color: 0, width: 2, label: 'MUSIC 伪谱（M = 32）' });
              p.add({ x: idx.map(i => Pper.f[i]), y: arr(toDbVec(idx.map(i => Pper.psd[i]), Pm)), color: 3, width: 1.8, dash: [5, 3], label: '周期图（矩形窗，N = 128）' });
              p.vline(200, { label: '200 Hz' });
              p.vline(203.9, { label: '203.9 Hz' });
              p.draw();
            }
          },
          { t: 'md', md: '**读图要点**：周期图是一条平滑的单峰包络（两音间隔 3.9 Hz 远小于瑞利限 7.8 Hz），**看不出是两个音**；MUSIC 在同一位置给出两根尖锐谱线，谷深约 10 dB。**这就是超分辨**：不是把峰画得更漂亮，而是**从同一段数据里得出了周期图得不到的结构信息**。' },
          { t: 'callout', kind: 'note', title: '门限的物理含义', md: '子空间方法的分辨率极限大致满足：\n\n$$\\Delta\\omega_{th} \\;\\propto\\; \\frac{1}{M}\\left(\\frac{1}{K\\cdot\\mathrm{SNR}\\cdot M}\\right)^{1/4}$$\n\n即：**孔径 $M$ 每翻一倍，门限改善约 $2^{-1.5}\\approx0.35$ 倍；快拍数或 SNR 每提高 16 倍，门限才改善 1 倍。** 这说明单靠堆 SNR 或快拍收效很慢，**加大孔径才是最有效的手段**——这也解释了为什么声呐与雷达都在拼命把阵做大。' }
        ]
      },
      {
        id: 'factors', num: '7', title: '影响性能的四大因素与相干源对策',
        blocks: [
          {
            t: 'widget', render: function (el) {
              const fs2 = 1000;
              const F1 = 200, DF = 3.9;
              function build(M, K, snr, seed) {
                const N = K + M - 1;
                const clean = new Float64Array(N);
                for (let n = 0; n < N; n++) {
                  clean[n] = Math.cos(2 * Math.PI * F1 / fs2 * n + 0.3) + Math.cos(2 * Math.PI * (F1 + DF) / fs2 * n + 1.1);
                }
                const x = C.addNoise(clean, snr, seed);
                const E = eigSym(snapCovFB(x, M, K), M);
                const En = eigCols(E, M, 4, M);
                const NB = 900, lo = 185, hi = 220;
                const fr = freqGrid(lo, hi, NB);
                const S = musicAt(En, M, M - 4, fr, fs2);
                const mx = maxOfArr(S);
                return { f: fr, S: toDbVec(S, mx) };
              }
              const NB = 900, lo = 185, hi = 220;
              const fr = freqGrid(lo, hi, NB);
              // 面板 1：阵元数（孔径）M
              const b1 = DSP.ui.plotBox({ title: '① 孔径 M（K = N − M + 1，SNR = 20 dB）' });
              const p1 = DSP.plot.new(b1.canvas, { height: 220, xlabel: 'f / Hz', ylabel: 'dB', legend: true, legendPos: 'tr', ylim: [-32, 3] });
              [8, 16, 32, 48].forEach(function (M, i) {
                const r = build(M, 128 - M + 1, 20, 20241024);
                p1.add({ x: arr(fr), y: arr(r.S), color: i, width: 1.6, label: 'M = ' + M });
              });
              // 面板 2：快拍数 K
              const b2 = DSP.ui.plotBox({ title: '② 快拍数 K（M = 24，SNR = 20 dB）' });
              const p2 = DSP.plot.new(b2.canvas, { height: 220, xlabel: 'f / Hz', ylabel: 'dB', legend: true, legendPos: 'tr', ylim: [-32, 3] });
              [8, 24, 64, 200].forEach(function (K, i) {
                const r = build(24, K, 20, 20241024);
                p2.add({ x: arr(fr), y: arr(r.S), color: i, width: 1.6, label: 'K = ' + K });
              });
              // 面板 3：SNR
              const b3 = DSP.ui.plotBox({ title: '③ 信噪比 SNR（M = 24，K = 105）' });
              const p3 = DSP.plot.new(b3.canvas, { height: 220, xlabel: 'f / Hz', ylabel: 'dB', legend: true, legendPos: 'tr', ylim: [-32, 3] });
              [-5, 0, 10, 20].forEach(function (sn, i) {
                const r = build(24, 105, sn, 20241024);
                p3.add({ x: arr(fr), y: arr(r.S), color: i, width: 1.6, label: sn + ' dB' });
              });
              [p1, p2, p3].forEach(function (pp) {
                pp.vline(F1, { label: F1 + ' Hz' });
                pp.vline(F1 + DF, { label: (F1 + DF) + ' Hz' });
              });
              p1.draw(); p2.draw(); p3.draw();
              const grid = U.h('div.grid.g2', {}, [b1.el, b2.el, b3.el]);
              el.appendChild(grid);
              el.appendChild(U.h('div.plot-cap', { html: U.md('三个面板分别扫描**孔径 M、快拍数 K、信噪比 SNR**，其余条件固定。两条竖虚线是真实频率 200 / 203.9 Hz（间隔 3.9 Hz，仅为 $f_s/N$ 的一半）。可以看到：孔径不足或快拍太少时，两根谱线粘成一根；随着 M / K / SNR 增大，谷逐渐加深直至完全分离——这就是子空间方法的统计门限。') }));
            }
          },
          { t: 'table', cols: ['因素', '影响规律', '工程对策'], rows: [
            ['阵元数 / 孔径 M', '分辨率门限大致按 M 的 −3/2 次方改善，最有效', '尽量加大孔径；受平台限制时用稀疏阵 + 稀疏恢复'],
            ['快拍数 K', '门限按 K 的 −1/4 次方改善，收益较慢', 'K ≥ 2M 起步；用前后向平均等效加倍'],
            ['信噪比 SNR', '门限按 SNR 的 −1/4 次方改善，收益较慢', '先做相干积累 / 脉冲压缩把 SNR 提上去'],
            ['信源相关性', '相干源使 P 矩阵奇异，子空间秩亏，MUSIC 失效', '必须做空间平滑（前向 / 前后向）']
          ] },
          {
            t: 'fold', summary: '展开：空间平滑为什么能救回相干源', deriv: true, blocks: [
            { t: 'md', md: '设 $d$ 个信源全相干，则信源协方差 $\\mathbf{P}=\\mathbf{p}\\mathbf{p}^{H}$ 秩为 1，信号部分 $\\mathbf{A}\\mathbf{P}\\mathbf{A}^{H}$ 的秩也只有 1，而我们仍按 $d$ 维去划分信号子空间——剩下的 $d\\!-\\!1$ 个"信号方向"被误当成噪声方向，正交性不再成立。' },
            { t: 'md', md: '**前向空间平滑（FSS）**：把 $M$ 元阵列分成 $P=M\\!-\\!L\\!+\\!1$ 个相互重叠、各长 $L$ 的子阵，分别求协方差后平均：' },
            { t: 'math', tex: '\\bar{\\mathbf{R}} = \\frac{1}{P}\\sum_{p=0}^{P-1}\\mathbf{R}^{(p)},\\qquad \\mathbf{R}^{(p)}=\\mathbf{A}_L\\boldsymbol{\\Phi}^{p}\\mathbf{P}\\big(\\boldsymbol{\\Phi}^{p}\\big)^{H}\\mathbf{A}_L^{H}', tag: '(10)' },
            { t: 'md', md: '每个子阵的协方差中，相干信源的相位关系被 $\\boldsymbol{\\Phi}^{p}$ 改变了。把这些**不同相位关系的秩 1 矩阵平均起来**，秩就被"撑"回到 $\\min(d,L)$。代价是有效孔径从 $M$ 降到 $L$，分辨率变差——**又是一次"方差/秩"换"孔径"的交易**。' },
            { t: 'md', md: '**前后向空间平滑（FBSS）**：再叠加一次共轭反转平均 $\\tfrac12(\\bar{\\mathbf{R}}+\\mathbf{J}\\bar{\\mathbf{R}}^{*}\\mathbf{J})$，可进一步恢复秩、提高估计精度，是工程上的标准做法。' }
          ]
          }
        ]
      },
      {
        id: 'eng', num: '8', title: '工程视角：声呐多目标方位、雷达超分辨与计算量',
        blocks: [
          { t: 'md', md: '子空间方法在工业界最成熟的应用是**阵列测向**。此时"频率"换成"方位"，导向向量由传播时延决定：' },
          { t: 'math', tex: '\\mathbf{a}(\\theta)=\\Big[1,\\;e^{j\\frac{2\\pi d}{\\lambda}\\sin\\theta},\\;\\dots,\\;e^{j\\frac{2\\pi d}{\lambda}(M-1)\\sin\\theta}\\Big]^{T}', tag: '(11)' },
          { t: 'table', cols: ['场景', '传统做法的极限', '子空间方法的收益', '落地门槛'], rows: [
            ['声呐多目标方位估计', '常规波束形成（CBF）受 λ/D 波束宽度限制，两个目标靠太近就合成一个', 'MUSIC 可分辨远小于波束宽度的双目标，且输出"干净"的背景', '需校准阵列流形；相干源必须空间平滑'],
            ['雷达俯仰/方位超分辨', '单脉冲测角精度受波束宽度与 SNR 约束', 'ESPRIT 直接给出角度，无需搜索，便于实时', '对阵元误差、互耦敏感，需做校正'],
            ['电磁/声源定位', '到达时延分辨率受带宽限制', '对窄带信号也能给出高分辨 DOA', '快拍数要够，且目标数 d 要先定准']
          ] },
          { t: 'callout', kind: 'eng', title: '实时链路里子空间方法放在哪', md: '一条典型的阵列处理链：\n\n1. **阵元 ADC 同步采样** → 得到复基带 $\\mathbf{x}[k]$；\n2. **阵列校正**：幅度/相位误差、互耦、位置误差的校准矩阵作用上去（这一步决定子空间方法能不能用）；\n3. **协方差估计**：$\\hat{\\mathbf{R}}=\\tfrac{1}{K}\\sum_k\\mathbf{x}[k]\\mathbf{x}^{H}[k]$，通常再做**前后向平均**（对均匀线阵等效于空间平滑，且能处理相干源）；\n4. **信源数判定**：用 AIC / MDL 或者简单的特征值门限确定 $d$；\n5. **特征分解**：$\\hat{\\mathbf{R}}$ 的 EVD 是主要算力开销，$O(M^3)$；\n6. **MUSIC 谱搜索 或 ESPRIT 封闭解** → 输出频率/角度估计；\n7. **后处理**：频率/角度配对、跟踪（卡尔曼）、与目标库比对。\n\n注意第 3 步中的**前后向平均**在声呐里几乎是必做的：海面/海底多径使同一目标产生相干多径，不平滑就会把多径当成独立目标，或者干脆估不出任何目标方位。' },
          { t: 'callout', kind: 'pit', title: '② 相干源不平滑就失败', md: '**症状**：明明有两个很近的强目标，MUSIC 谱上却只有一个峰，或者峰位置落在两个目标中间且随 SNR 抖动。\n\n**原因**：多径 / 转发干扰 / 相干转发使 $\\mathbf{P}$ 秩亏，信号子空间实际维数小于 $d$，噪声子空间里混进了信号分量，正交性被破坏。\n\n**对策**：\n\n- 均匀线阵 → 做**前向空间平滑（FSS）**或更常用的**前后向空间平滑（FBSS）**；\n- 若阵列无平移不变结构 → 用**Toeplitz 重构**或**矩阵 pencil** 类方法；\n- 若能通过频率分集 / 波形分集把相干源去相关（例如跳频、频率捷变），优先在**物理层**解决。' },
          { t: 'callout', kind: 'pit', title: '③ 把 MUSIC 峰高当"目标强度"排序', md: '峰高反映的是**导向向量与噪声子空间的正交程度**，受 SNR、快拍数、陣元误差、目标相干性的共同影响，**与目标强度没有单调关系**。要给目标排强弱，必须在估出角度后用 MVDR（Capon）或最小二乘估计各方向的功率。' },
          { t: 'metrics', list: [
            { label: '特征分解', value: 'O(M³)', unit: '主要开销' },
            { label: '协方差估计', value: 'O(KM²)', unit: '可并行' },
            { label: 'MUSIC 谱搜索', value: 'O(NM(M−d))', unit: 'N 为栅格数' },
            { label: 'ESPRIT 求解', value: 'O(Md²+d³)', unit: '无需搜索' }
          ] },
          { t: 'callout', kind: 'note', title: '与 AR 谱的关系', md: '两者都能超分辨，但机理不同：\n\n- **AR 谱**：假设数据是**全极点模型的输出**；谱峰来自**极点**。它不要求噪声白，但要求**模型结构正确**。\n- **子空间方法**：假设数据是**少量正弦 + 白噪声**；谱峰来自**正交性**。它要求噪声**空间白**（或先做预白化），但**不要求信号是 AR 过程**。\n\n数学上还有一条有趣的联系：**Pisarenko 的最小特征向量恰好构造出一个全极点多项式，其零点落在真实频率上**——这与**Prony 方法**以及高分辨率 AR 谱估计在纯正弦 + 白噪声情形下的解是等价的。换句话说，在"理想正弦 + 白噪声"这个交集上，参数模型谱估计与子空间方法殊途同归。' }
        ]
      }
    ],
    refs: [
      'Schmidt, "Multiple Emitter Location and Signal Parameter Estimation", IEEE Trans. AP, 1986（MUSIC 原始论文）',
      'Roy & Kailath, "ESPRIT — Estimation of Signal Parameters via Rotational Invariance Techniques", IEEE Trans. ASSP, 1989',
      'Pisarenko, "The Retrieval of Harmonics from a Covariance Function", Geophys. J. R. astr. Soc., 1973',
      'Shan, Wax & Kailath, "On Spatial Smoothing for Direction-of-Arrival Estimation of Coherent Signals", IEEE Trans. ASSP, 1985',
      'Stoica & Moses, Spectral Analysis of Signals, 第 4–5 章'
    ]
  });

})(window);
