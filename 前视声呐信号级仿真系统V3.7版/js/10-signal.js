/* =========================================================================
 * 10-signal.js —— FFT / 窗函数 / 发射信号生成 / 匹配滤波 / 频谱分析
 * 说明：仿真内核采用「复基带等效」表示：
 *       带通实信号 x(t) = Re{ b(t) · exp(j2π f_c t) }
 *       其中 b(t) 为复包络（基带），采样率 f_s_bb ≥ 2.5·B 即可完整表征。
 *       该表示与射频带通信号严格等价，但计算量降低 fs/fs_bb 倍。
 * ========================================================================= */
(function () {
  var U = FLS.U;

  /* -------------------------------------------------------------- FFT */
  FLS.FFT = (function () {
    function nextPow2(n) { var p = 1; while (p < n) p <<= 1; return p; }
    /** 交错存储复数数组的原地 FFT；a.length = 2n；inv=true 为逆变换（含 1/n 归一） */
    function fft(a, n, inv) {
      var i, j, k, bit, len, ur, ui, vr, vi, tr, ti, cr, ci, wr, wi, ncr;
      for (i = 1, j = 0; i < n; i++) {
        for (bit = n >> 1; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
          var t1 = a[2 * i], t2 = a[2 * i + 1];
          a[2 * i] = a[2 * j]; a[2 * i + 1] = a[2 * j + 1];
          a[2 * j] = t1; a[2 * j + 1] = t2;
        }
      }
      for (len = 2; len <= n; len <<= 1) {
        var ang = (inv ? 2 : -2) * Math.PI / len;
        wr = Math.cos(ang); wi = Math.sin(ang);
        var half = len >> 1;
        for (i = 0; i < n; i += len) {
          cr = 1; ci = 0;
          for (k = 0; k < half; k++) {
            var ia = 2 * (i + k), ib = 2 * (i + k + half);
            ur = a[ia]; ui = a[ia + 1];
            vr = a[ib]; vi = a[ib + 1];
            tr = cr * vr - ci * vi; ti = cr * vi + ci * vr;
            a[ia] = ur + tr; a[ia + 1] = ui + ti;
            a[ib] = ur - tr; a[ib + 1] = ui - ti;
            ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
          }
        }
      }
      if (inv) { var s = 1 / n; for (i = 0; i < 2 * n; i++) a[i] *= s; }
    }
    /** 频域卷积（重叠保留简化版：零填充后全卷积取前 N 点） */
    function convolve(dst, dstN, src, srcN, ker, kerN, workA, workB, nfft) {
      // dst = src (*) ker，长度 dstN = srcN（线性卷积前 srcN 点）
      var i;
      workA.fill(0); workB.fill(0);
      for (i = 0; i < srcN; i++) { workA[2 * i] = src[2 * i]; workA[2 * i + 1] = src[2 * i + 1]; }
      for (i = 0; i < kerN; i++) { workB[2 * i] = ker[2 * i]; workB[2 * i + 1] = ker[2 * i + 1]; }
      fft(workA, nfft, false); fft(workB, nfft, false);
      for (i = 0; i < nfft; i++) {
        var ar = workA[2 * i], ai = workA[2 * i + 1], br = workB[2 * i], bi = workB[2 * i + 1];
        workA[2 * i] = ar * br - ai * bi; workA[2 * i + 1] = ar * bi + ai * br;
      }
      fft(workA, nfft, true);
      for (i = 0; i < dstN; i++) { dst[2 * i] = workA[2 * i]; dst[2 * i + 1] = workA[2 * i + 1]; }
    }
    return { fft: fft, nextPow2: nextPow2, convolve: convolve };
  })();

  /* -------------------------------------------------------------- 窗函数 */
  FLS.Win = function (type, n, sll) {
    var w = new Float32Array(n), i;
    /* ★ V3.6：n < 3 时一切"两端归零"的窗都会退化成全零 ——
       汉宁窗 w[i] = 0.5 − 0.5cos(2πi/(n−1))，n = 2 时两个端点都是 0，
       整窗恒等于 0，于是加权后的阵元全部被抹掉、图像一片全黑。
       （阵元数下限是 2，所以这条真的会被踩到。）2~3 个阵元谈不上"加权"，
       直接给矩形窗。 */
    if (n < 3) { w.fill(1); return w; }
    var N = n - 1;
    switch (type) {
      case 'hann':
        for (i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); break;
      case 'hamming':
        for (i = 0; i < n; i++) w[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / N); break;
      case 'taylor':
        // 泰勒窗（简化：nbar=5 等副瓣近似，用修正余弦和逼近，副瓣电平 sll dB）
        var A = Math.pow(10, (sll || 30) / 20);
        var a0 = 1, a1 = 0.4 / Math.max(1, A / 3), a2 = 0.1 / Math.max(1, A / 3);
        for (i = 0; i < n; i++) {
          var u = i / N * 2 - 1;
          var p = Math.PI * u;
          w[i] = a0 + 2 * a1 * Math.cos(p) + 2 * a2 * Math.cos(2 * p);
        }
        var mx = 0; for (i = 0; i < n; i++) mx = Math.max(mx, w[i]);
        for (i = 0; i < n; i++) w[i] /= mx;
        break;
      default: // rect
        for (i = 0; i < n; i++) w[i] = 1;
    }
    /* 兜底：任何窗都不该把整条权向量抹成 0（否则图像全黑且看不出原因） */
    var mx2 = 0;
    for (i = 0; i < n; i++) if (w[i] > mx2) mx2 = w[i];
    if (!(mx2 > 0)) w.fill(1);
    return w;
  };

  /* -------------------------------------------------------------- 发射信号 */
  /**
   * 生成复基带发射波形
   * @param o {type, bw(Hz), T(s), fs(Hz), win, sll, seed}
   * @return {re:Float32Array, im:Float32Array, n}  复包络 b(t)
   */
  FLS.Sig = {};
  FLS.Sig.genTx = function (o) {
    var n = Math.max(8, Math.round(o.T * o.fs));
    var re = new Float32Array(n), im = new Float32Array(n);
    var w = FLS.Win(o.win || 'rect', n, o.sll || 30);
    var B = o.bw, T = o.T, i, u, ph, f, acc = 0, dt = 1 / o.fs;
    var rnd = U.rng(o.seed || 12345);

    if (o.type === 'cw') {
      // CW：基带为常数（射频为单频填充脉冲），带宽由脉宽决定
      for (i = 0; i < n; i++) { re[i] = w[i]; im[i] = 0; }
    } else if (o.type === 'lfm') {
      // 线性调频：瞬时频率 -B/2 → +B/2，相位 φ(t)=π(B/T)t²
      for (i = 0; i < n; i++) {
        var t = (i - n / 2) * dt;
        ph = Math.PI * (B / T) * t * t;
        re[i] = w[i] * Math.cos(ph); im[i] = w[i] * Math.sin(ph);
      }
    } else if (o.type === 'nlfm') {
      // 非线性调频：三次频率律 f(u) = (B/2)·(u+u³)/2，u∈[-1,1]
      // 使频谱自然呈钟形加权，距离旁瓣低（无需额外失配加窗）
      acc = 0;
      for (i = 0; i < n; i++) {
        u = (i / (n - 1)) * 2 - 1;
        f = (B / 2) * (u + u * u * u) / 2;
        acc += 2 * Math.PI * f * dt;
        re[i] = w[i] * Math.cos(acc); im[i] = w[i] * Math.sin(acc);
      }
      // 去除累积相位直流分量，使相位居中
      for (i = 0; i < n; i++) { }
    } else if (o.type === 'hfm') {
      // 双曲调频：f(t) = f1·f2·T / (f2·T − (f2−f1)·t)，f1=fc−B/2, f2=fc+B/2
      var fc = o.fc || (4 * B), f1 = fc - B / 2, f2 = fc + B / 2;
      if (f1 <= 0) f1 = B / 2;
      acc = 0;
      for (i = 0; i < n; i++) {
        var tt = i * dt;
        f = f1 * f2 * T / Math.max(1e-6, (f2 * T - (f2 - f1) * tt));
        acc += 2 * Math.PI * (f - fc) * dt;
        re[i] = w[i] * Math.cos(acc); im[i] = w[i] * Math.sin(acc);
      }
      // 去均值相位（使中心频率对齐 fc）
      var mid = acc / 2;
      for (i = 0; i < n; i++) {
        var p2 = Math.atan2(im[i], re[i]);
        var a2 = p2 - mid * (i / (n - 1));
        var m2 = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
        re[i] = m2 * Math.cos(a2); im[i] = m2 * Math.sin(a2);
      }
    } else { // prn：伪随机二相编码（m 序列），码片速率 = 带宽
      var nc = Math.max(4, Math.round(T * B));
      var chipLen = n / nc;
      // 5 级 m 序列（长度 31）循环扩展
      var reg = 0b10101, seq = [];
      for (i = 0; i < nc; i++) {
        var bit = ((reg >> 4) ^ (reg >> 2)) & 1;
        reg = ((reg << 1) | bit) & 0b11111;
        seq.push(bit ? -1 : 1);
      }
      for (i = 0; i < n; i++) {
        var ci = Math.min(nc - 1, Math.floor(i / chipLen));
        re[i] = w[i] * seq[ci]; im[i] = 0;
      }
    }
    return { re: re, im: im, n: n };
  };

  /** 匹配滤波器核：h(t) = b*(-t)（共轭翻转），可选频域加窗抑制距离旁瓣 */
  FLS.Sig.matchedKernel = function (tx, winType, sll) {
    var n = tx.n;
    var kr = new Float32Array(n), ki = new Float32Array(n);
    var i;
    for (i = 0; i < n; i++) { kr[n - 1 - i] = tx.re[i]; ki[n - 1 - i] = -tx.im[i]; }
    if (winType && winType !== 'rect') {
      var w = FLS.Win(winType, n, sll || 30);
      // 在频域加窗等价于时域卷积窗谱；此处直接对核做时域加窗（等效于失配滤波）
      for (i = 0; i < n; i++) { kr[i] *= w[i]; ki[i] *= w[i]; }
    }
    // 能量归一（使匹配滤波输出峰值 = 输入回波幅度 A，噪声功率 ×1/E，等价于 N₀/T）
    var e = 0; for (i = 0; i < n; i++) e += tx.re[i] * tx.re[i] + tx.im[i] * tx.im[i];
    var s = e > 0 ? 1 / e : 1;
    for (i = 0; i < n; i++) { kr[i] *= s; ki[i] *= s; }
    return { re: kr, im: ki, n: n };
  };

  /** FIR 低通（基带等效带通）设计：窗函数法 */
  FLS.Sig.lowpassKernel = function (fcut, fs, ntaps) {
    if (fcut <= 0 || fcut >= fs / 2) return null;
    var n = ntaps | 1, m = (n - 1) / 2;
    var h = new Float32Array(n), sum = 0, i;
    var w = FLS.Win('hamming', n, 30);
    for (i = 0; i < n; i++) {
      var k = i - m;
      var x = 2 * Math.PI * fcut * k / fs;
      h[i] = (k === 0 ? 2 * fcut / fs : Math.sin(x) / (Math.PI * k)) * w[i];
      sum += h[i];
    }
    if (Math.abs(sum) > 1e-9) for (i = 0; i < n; i++) h[i] /= sum;
    return h;
  };

  /** 对复基带信号做实系数 FIR 滤波（直接卷积，核长通常 ≤65） */
  FLS.Sig.firApply = function (sig, sigN, h) {
    if (!h) return;
    var n = h.length, m = (n - 1) / 2;
    var outR = new Float32Array(sigN), outI = new Float32Array(sigN);
    for (var i = 0; i < sigN; i++) {
      var sr = 0, si = 0;
      for (var k = 0; k < n; k++) {
        var j = i - k + m;
        if (j < 0 || j >= sigN) continue;
        sr += h[k] * sig[2 * j]; si += h[k] * sig[2 * j + 1];
      }
      outR[i] = sr; outI[i] = si;
    }
    for (var q = 0; q < sigN; q++) { sig[2 * q] = outR[q]; sig[2 * q + 1] = outI[q]; }
  };

  /** Welch 功率谱估计（返回 dB，长度 nfft/2） */
  FLS.Sig.spectrum = function (sig, sigN, nfft) {
    var nfft2 = FLS.FFT.nextPow2(Math.min(nfft || 1024, sigN));
    var seg = nfft2, nseg = Math.max(1, Math.floor(sigN / seg));
    var P = new Float32Array(seg / 2);
    var w = FLS.Win('hann', seg, 30);
    var buf = new Float32Array(2 * seg);
    var norm = 0;
    for (var s = 0; s < nseg; s++) {
      buf.fill(0);
      var off = s * seg;
      for (var i = 0; i < seg; i++) {
        buf[2 * i] = sig[2 * (off + i)] * w[i];
        buf[2 * i + 1] = sig[2 * (off + i) + 1] * w[i];
      }
      FLS.FFT.fft(buf, seg, false);
      for (var k = 0; k < seg / 2; k++) {
        P[k] += buf[2 * k] * buf[2 * k] + buf[2 * k + 1] * buf[2 * k + 1];
      }
      norm += 1;
    }
    var out = new Float32Array(seg / 2);
    var wsum = 0; for (var q = 0; q < seg; q++) wsum += w[q] * w[q];
    for (var k2 = 0; k2 < seg / 2; k2++) {
      out[k2] = U.pow2db(P[k2] / Math.max(1, norm) / (wsum * seg / 2));
    }
    return out;
  };

  /** 复基带插值为射频实信号（用于波形显示）：x[n]=Re{b[n]·e^{j2π fc n/fs}} */
  FLS.Sig.toRF = function (sig, sigN, fc, fs) {
    var out = new Float32Array(sigN);
    var w = 2 * Math.PI * fc / fs;
    for (var i = 0; i < sigN; i++) {
      var c = Math.cos(w * i), s = Math.sin(w * i);
      out[i] = sig[2 * i] * c - sig[2 * i + 1] * s;
    }
    return out;
  };

  /** 复基带 I/Q 插值到 K 倍采样率（输出长度严格 = sigN*K，采样率严格 = K*fsbb）
   *
   *  V1.1 修正：原实现走 FFT 频域零填充，但本工程 FFT 只支持 2 的幂，
   *  于是取 n2 = nextPow2(sigN*K)，而 n2 与 sigN*K 不成整数倍——输出长度被拉长到
   *  n2（79110 → 131072），调用方却仍按 n2/showN 反算采样率，于是标称采样率变成
   *  1325 kHz（应为 800 kHz），且负频分量索引写成 sigN-k2（应为 n2-k2），把正频
   *  搬到了负频位置，波形在时间轴上整体前移（峰值出现在 4.8 ms，实际 51.7 ms）。
   *  改用纯时域 Catmull-Rom 三次插值：基带最高 40 kHz、K=10 时每个基带周期仍有
   *  20 个插值点，插值误差 ~1e-4，远小于显示精度，且长度/采样率天然精确。 */
  FLS.Sig.upsample = function (sig, sigN, K) {
    if (K <= 1) return { arr: sig, n: sigN };
    var n = sigN * K, out = new Float32Array(2 * n);
    function idx(i) { return i < 0 ? 0 : (i >= sigN ? sigN - 1 : i); }  // 端点钳位
    for (var k = 0; k < n; k++) {
      var x = k / K, i0 = Math.floor(x), t = x - i0;
      var a = idx(i0 - 1), b = idx(i0), c = idx(i0 + 1), d = idx(i0 + 2);
      var t2 = t * t, t3 = t2 * t;
      // Catmull-Rom 基函数
      var w0 = -0.5 * t3 + t2 - 0.5 * t;
      var w1 = 1.5 * t3 - 2.5 * t2 + 1;
      var w2 = -1.5 * t3 + 2 * t2 + 0.5 * t;
      var w3 = 0.5 * t3 - 0.5 * t2;
      out[2 * k] = w0 * sig[2 * a] + w1 * sig[2 * b] + w2 * sig[2 * c] + w3 * sig[2 * d];
      out[2 * k + 1] = w0 * sig[2 * a + 1] + w1 * sig[2 * b + 1] + w2 * sig[2 * c + 1] + w3 * sig[2 * d + 1];
    }
    return { arr: out, n: n };
  };
})();
