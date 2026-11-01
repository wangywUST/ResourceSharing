/* =========================================================================
 * 40-engine.js —— 时域信号级仿真内核（自包含，可在 WebWorker 中运行）
 *
 * 严格按真实物理链路顺序执行：
 *   ① 发射波形（复基带）→ ② 声场传播（几何扩散 + Thorp 吸收 + 声速剖面时延
 *      + 海面/海底一阶多途镜像源）→ ③ 海底/目标面元散射（Lambert / Kirchhoff
 *      / 经验模型，目标按 TS 归一化）→ ④ 每个接收阵元独立叠加各路散射回波
 *      → ⑤ 阵元级噪声（环境 + 自噪声 + 通道电噪声 + 量化）→ ⑥ 带通滤波
 *      → ⑦ 匹配滤波（脉冲压缩）→ ⑧ TVG 时变增益 → ⑨ 波束形成（8 种算法）
 *      → ⑩ 输出扇形图像（方位 × 距离）
 *
 * 关键公式（复基带等价表示）：
 *   带通信号   x(t) = Re{ b(t)·e^{j2π f_c t} }
 *   阵元回波   b_m(t) = Σ_i A_i·s_b(t−τ_im)·e^{−j2π f_c τ_im}
 *     A_i   = P₀·√σ_i·D_tx·D_rx·10^{−α(R_tx+R_rx)/20000}/(R_tx·R_rx)
 *     τ_im  = (R_tx + R_rx,m)/c
 *   聚焦波束形成 y(r,θ) = (1/M)·Σ_m w_m·b_m((r+R_m)/c)·e^{−j2π f_c (r−R_m)/c}
 *   注：e^{−j2πf_c τ} 项承载了亚采样间隔的精细相位，是阵列处理正确性的关键。
 * ========================================================================= */
FLS.EngineFactory = function () {
  /* ======================= 复数线性代数 ======================= */
  /** Hermite 正定矩阵 Cholesky：R = L·Lᴴ（L 下三角） */
  function chol(Rre, Rim, n, Lre, Lim) {
    var i, j, k;
    for (i = 0; i < n * n; i++) { Lre[i] = 0; Lim[i] = 0; }
    for (j = 0; j < n; j++) {
      var sre = Rre[j * n + j];
      for (k = 0; k < j; k++) { var ar = Lre[j * n + k], ai = Lim[j * n + k]; sre -= ar * ar + ai * ai; }
      if (sre < 1e-30) sre = 1e-30;
      var d = Math.sqrt(sre);
      Lre[j * n + j] = d; Lim[j * n + j] = 0;
      for (i = j + 1; i < n; i++) {
        var tre = Rre[i * n + j], tim = Rim[i * n + j];
        for (k = 0; k < j; k++) {
          var br = Lre[i * n + k], bi = Lim[i * n + k];
          var cr = Lre[j * n + k], ci = -Lim[j * n + k];
          tre -= br * cr - bi * ci; tim -= br * ci + bi * cr;
        }
        Lre[i * n + j] = tre / d; Lim[i * n + j] = tim / d;
      }
    }
  }
  function fsolve(Lre, Lim, n, bre, bim, zre, zim) {          // L z = b
    for (var i = 0; i < n; i++) {
      var tre = bre[i], tim = bim[i];
      for (var k = 0; k < i; k++) {
        var lr = Lre[i * n + k], li = Lim[i * n + k];
        tre -= lr * zre[k] - li * zim[k]; tim -= lr * zim[k] + li * zre[k];
      }
      var d = Lre[i * n + i];
      zre[i] = tre / d; zim[i] = tim / d;
    }
  }
  function bsolve(Lre, Lim, n, zre, zim, wre, wim) {          // Lᴴ w = z
    for (var i = n - 1; i >= 0; i--) {
      var tre = zre[i], tim = zim[i];
      for (var k = i + 1; k < n; k++) {
        var lr = Lre[k * n + i], li = -Lim[k * n + i];
        tre -= lr * wre[k] - li * wim[k]; tim -= lr * wim[k] + li * wre[k];
      }
      var d = Lre[i * n + i];
      wre[i] = tre / d; wim[i] = tim / d;
    }
  }
  /** Jacobi 特征分解（实对称） */
  function jacobiEig(Ain, n, sweeps) {
    var A = Ain.slice(0), V = new Float64Array(n * n), i;
    for (i = 0; i < n; i++) V[i * n + i] = 1;
    for (var sw = 0; sw < (sweeps || 12); sw++) {
      var off = 0, p, q;
      for (p = 0; p < n; p++) for (q = p + 1; q < n; q++) off += A[p * n + q] * A[p * n + q];
      if (off < 1e-20) break;
      for (p = 0; p < n; p++) {
        for (q = p + 1; q < n; q++) {
          var apq = A[p * n + q];
          if (Math.abs(apq) < 1e-18) continue;
          var app = A[p * n + p], aqq = A[q * n + q];
          var theta = 0.5 * Math.atan2(2 * apq, aqq - app);
          var c = Math.cos(theta), s = Math.sin(theta), k;
          for (k = 0; k < n; k++) {
            var akp = A[k * n + p], akq = A[k * n + q];
            A[k * n + p] = c * akp - s * akq; A[k * n + q] = s * akp + c * akq;
          }
          for (k = 0; k < n; k++) {
            var apk = A[p * n + k], aqk = A[q * n + k];
            A[p * n + k] = c * apk - s * aqk; A[q * n + k] = s * apk + c * aqk;
          }
          for (k = 0; k < n; k++) {
            var vkp = V[k * n + p], vkq = V[k * n + q];
            V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq;
          }
        }
      }
    }
    var val = new Float64Array(n), idx = new Array(n), d;
    for (d = 0; d < n; d++) { val[d] = A[d * n + d]; idx[d] = d; }
    idx.sort(function (a, b) { return val[b] - val[a]; });
    var val2 = new Float64Array(n), V2 = new Float64Array(n * n);
    for (var e = 0; e < n; e++) {
      val2[e] = val[idx[e]];
      for (var r = 0; r < n; r++) V2[r * n + e] = V[r * n + idx[e]];
    }
    return { val: val2, vec: V2 };
  }
  /**
   * Hermite 特征分解：转实对称 2n×2n 后 Jacobi（z = u + j v）
   *   [ A  −B ] [u]       [u]
   *   [ B   A ] [v] = λ · [v]      （R = A + jB，A 对称、B 反对称）
   * 注意：该变换使每个复特征值 λ 在实矩阵中重复出现两次（对应 z 与 j·z）。
   * Jacobi 对退化特征值的排列顺序并不保证「成对相邻」，因此这里对每个候选
   * 复特征向量与「已接受向量」做复内积：若 |<z_k, z_e>| 接近 1，说明它是同一
   * 特征向量的相位旋转（j·z），必须跳过，否则会把同一信号子空间重复计入，
   * 导致 MUSIC 噪声子空间与 ESB 投影子空间错误（表现为方位谱镜像/发散）。
   */
  function hermEig(Rre, Rim, n) {
    var N = 2 * n, M = new Float64Array(N * N), i, j;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      var ar = Rre[i * n + j], ai = Rim[i * n + j];
      M[i * N + j] = ar; M[i * N + n + j] = -ai;
      M[(n + i) * N + j] = ai; M[(n + i) * N + n + j] = ar;
    }
    var E = jacobiEig(M, N, 14);
    var val = new Float64Array(n), vre = new Float64Array(n * n), vim = new Float64Array(n * n);
    var tr = new Float64Array(n), ti = new Float64Array(n);
    var cnt = 0, e, k0, r2, nn, cr, ci, ar2, ai2;
    for (e = 0; e < N && cnt < n; e++) {
      nn = 0;
      for (r2 = 0; r2 < n; r2++) {
        tr[r2] = E.vec[r2 * N + e]; ti[r2] = E.vec[(n + r2) * N + e];
        nn += tr[r2] * tr[r2] + ti[r2] * ti[r2];
      }
      nn = Math.sqrt(nn) || 1;
      for (r2 = 0; r2 < n; r2++) { tr[r2] /= nn; ti[r2] /= nn; }
      var dup = false;
      for (k0 = 0; k0 < cnt; k0++) {
        cr = 0; ci = 0;
        for (r2 = 0; r2 < n; r2++) {
          ar2 = vre[r2 * n + k0]; ai2 = vim[r2 * n + k0];
          cr += ar2 * tr[r2] + ai2 * ti[r2];
          ci += ar2 * ti[r2] - ai2 * tr[r2];
        }
        if (Math.sqrt(cr * cr + ci * ci) > 0.9) { dup = true; break; }
      }
      if (dup) continue;                       // 与已有向量仅差一个复相位 → 退化对
      val[cnt] = E.val[e];
      for (r2 = 0; r2 < n; r2++) { vre[r2 * n + cnt] = tr[r2]; vim[r2 * n + cnt] = ti[r2]; }
      cnt++;
    }
    return { val: val, vre: vre, vim: vim, n: cnt };
  }
  function nextPow2(n) { var p = 1; while (p < n) p <<= 1; return p; }
  function fft(a, n, inv) {
    var i, j, k, bit, len, ur, ui, vr, vi, tr, ti, cr, ci, wr, wi, ncr;
    for (i = 1, j = 0; i < n; i++) {
      for (bit = n >> 1; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { var t1 = a[2 * i], t2 = a[2 * i + 1]; a[2 * i] = a[2 * j]; a[2 * i + 1] = a[2 * j + 1]; a[2 * j] = t1; a[2 * j + 1] = t2; }
    }
    for (len = 2; len <= n; len <<= 1) {
      var ang = (inv ? 2 : -2) * Math.PI / len;
      wr = Math.cos(ang); wi = Math.sin(ang);
      var half = len >> 1;
      for (i = 0; i < n; i += len) {
        cr = 1; ci = 0;
        for (k = 0; k < half; k++) {
          var ia = 2 * (i + k), ib = 2 * (i + k + half);
          ur = a[ia]; ui = a[ia + 1]; vr = a[ib]; vi = a[ib + 1];
          tr = cr * vr - ci * vi; ti = cr * vi + ci * vr;
          a[ia] = ur + tr; a[ia + 1] = ui + ti;
          a[ib] = ur - tr; a[ib + 1] = ui - ti;
          ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
    if (inv) { var s = 1 / n; for (i = 0; i < 2 * n; i++) a[i] *= s; }
  }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  /* ── 标准正态随机数（Box–Muller）─────────────────────────────────────
   * ★ V2.2 修正：原实现每调用一次消耗 2 个均匀随机数、却只产出 1 个正态数
   *   （sin 分支被丢掉），等于把随机数序列的一半扔了，也白算一次 log/sqrt。
   *   现在缓存另一支，隔次直接取用：统计分布不变，随机数消耗减半。
   *   gSpare 用 NaN 标记"空"（比 null 分支少一次类型判断）。
   *   每个 ping 开头必须重置，否则跨帧残留会让 seed 到结果的映射不确定。 */
  var gSpare = NaN;
  function gauss(rnd) {
    if (gSpare === gSpare) { var s = gSpare; gSpare = NaN; return s; }
    var u = 1 - rnd(), v = rnd();
    var R = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * v;
    gSpare = R * Math.sin(th);
    return R * Math.cos(th);
  }

  /* ── 指向性：D(θ)=|sinc(1.3915·θ/θ_h)| ──────────────────────────────
   * ★ V2.2 优化：它只依赖归一化角 q = θ/θ_h，而引擎内层对每个
   *   (散射面元 × 接收阵元) 要算两次 —— 默认配置下是 1.2×10⁶ 次
   *   atan2 + asin + sin + 除法，占单帧仿真约四成耗时。
   *   改为 8192 点查找表 + 线性插值：线性插值误差 < 2×10⁻⁵（绝对值），
   *   相对幅度都在 −34 dB 剔除阈值附近，对结果无影响。
   *   q ≥ QMAX 时 |sinc| ≤ 0.018，已低于调用处的 0.02 剔除线，直接返回 0
   *   （调用处两条 if 都会 continue，行为与原来一致）。 */
  var BP_N = 16384, BP_QMAX = 36, BP_STEP = BP_N / BP_QMAX, bpTab = null;
  /* ★ V3.7：**垂直维**指向性改成「低旁瓣"单调衰减"」模型，与水平维分开。
   *
   *   为什么必须分开：
   *     水平维的 sinc（均匀孔径）是对的 —— 方位旁瓣是真实存在的现象，
   *     目标两侧的"鬼影"、强目标的方位泄漏都靠它。
   *     但垂直维用同一个 sinc 会造出一个纯属伪影的图形：海床是**连续**面，
   *     它的垂直离轴角随斜距单调变化（掠射时 ≈ 常俯角 ≈ 常距离），
   *     于是垂直 sinc 的一串瓣峰被"画"到海床上，成为一圈圈**等斜距离的亮环**；
   *     而且 sinc 的旁瓣只按 1/x 衰减，第 2~5 旁瓣还有 −18…−14 dB，
   *     ROV 一俯仰（主瓣离开海床），整幅图就只剩这些旁瓣撑着的环纹——
   *     这就是"俯仰之后出现亮色环形/弯曲环形条带、换什么波束形成算法都有"的根因
   *     （伪影在**波束形成之前**就已经在后向散射幅度里了，任何算法都会照单全收）。
   *
   *   真实工程里前视声呐的发射/接收垂直孔径都是**加权（阴影）孔径**，
   *   垂直旁瓣被压到 −30 dB 以下且快速滚降，不会把远处的海床"照回来"。
   *   这里用与 −3dB 点严格对齐的高斯主瓣（在 θ = ±θ_h 处正好 0.707）近似这种
   *   低旁瓣孔径：单调、无零点、无旁瓣瓣峰，因此**在几何上不可能**画出等距离环纹。
   *   主瓣以外按 dB 线性过渡到一个 −45 dB 的底（保留一点点真实泄漏）。
   *
   *   副作用检查：默认 20° 垂直开角、离底 10 m 时，9.4 m 以外（掠射角 < 47°）
   *   的垂直衰减都 < 0.5 dB，近场盲区也基本不变；俯仰 ±25° 时图像按几何自然
   *   变暗/变亮，不再出现环。 */
  var bpvTab = null;
  var BEAM_V_FLOOR_DB = -45;
  function beamPatV(theta, halfRad) {
    if (halfRad <= 0) return 1;
    if (!bpvTab) {
      bpvTab = new Float64Array(BP_N + 2);
      var l2 = Math.LN2, fl = Math.pow(10, BEAM_V_FLOOR_DB / 20);
      for (var b = 0; b <= BP_N + 1; b++) {
        var q = b / BP_STEP;
        var g = Math.exp(-l2 * q * q);                   // 主瓣：q=1 → 0.7071
        /* 旁瓣底：q 越大越接近 floor（用 1/(1+q²) 做 dB 线性过渡） */
        var w = Math.min(1, Math.max(0, (q - 1.6) / 2.4));
        var f = fl * (1 / (1 + q * q));
        bpvTab[b] = g * (1 - w) + Math.max(f, g * (1 - w)) * w;
        if (bpvTab[b] < fl * 0.02) bpvTab[b] = 0;         // 远区直接置零，省掉无谓累加
      }
    }
    var q2 = theta / halfRad; if (q2 < 0) q2 = -q2;
    if (q2 >= BP_QMAX) return 0;
    var f2 = q2 * BP_STEP, i2 = f2 | 0;
    return bpvTab[i2] + (bpvTab[i2 + 1] - bpvTab[i2]) * (f2 - i2);
  }
  function beamPat(theta, halfRad) {
    if (halfRad <= 0) return 1;
    if (!bpTab) {
      bpTab = new Float64Array(BP_N + 2);   // Float64：表本身不引入量化误差，只剩插值误差
      for (var b = 0; b <= BP_N + 1; b++) {
        var xb = 1.3915 * (b / BP_STEP);
        bpTab[b] = xb < 1e-9 ? 1 : Math.abs(Math.sin(xb) / xb);
      }
    }
    var q = theta / halfRad; if (q < 0) q = -q;
    if (q >= BP_QMAX) return 0;
    var f = q * BP_STEP, i = f | 0;
    return bpTab[i] + (bpTab[i + 1] - bpTab[i]) * (f - i);
  }

  /* FIR 的临时缓冲复用：原实现每次调用 new Float32Array(n)×2，
     64 路 × 每路 46 KB 意味着单帧 3 MB 的临时分配与 GC 压力。 */
  var firR = null, firI = null;
  /** ★ V3.4：hI 非空时做**复系数**卷积（射频带通映射到基带后一般是复带通）。
   *   y[n] = Σ_k H[k]·x[n−k+mh]，H[k] = h[k] + j·hI[k]。
   *   hI 为空时退化为原来的实系数卷积（默认工况 fc±B/2 → 基带跨零 → 纯低通）。 */
  function firApply(sig, base, n, h, nh, mh, hI) {
    if (!firR || firR.length < n) { firR = new Float32Array(n); firI = new Float32Array(n); }
    var outR = firR, outI = firI;
    if (hI) {
      for (var i = 0; i < n; i++) {
        var sr = 0, si = 0;
        for (var k = 0; k < nh; k++) {
          var j = i - k + mh; if (j < 0 || j >= n) continue;
          var xr = sig[2 * (base + j)], xi = sig[2 * (base + j) + 1];
          sr += h[k] * xr - hI[k] * xi; si += h[k] * xi + hI[k] * xr;
        }
        outR[i] = sr; outI[i] = si;
      }
    } else {
      for (i = 0; i < n; i++) {
        sr = 0; si = 0;
        for (k = 0; k < nh; k++) {
          j = i - k + mh; if (j < 0 || j >= n) continue;
          sr += h[k] * sig[2 * (base + j)]; si += h[k] * sig[2 * (base + j) + 1];
        }
        outR[i] = sr; outI[i] = si;
      }
    }
    for (var q = 0; q < n; q++) { sig[2 * (base + q)] = outR[q]; sig[2 * (base + q) + 1] = outI[q]; }
  }
  /** 复系数小方程组 G h = f，高斯消元
   *  ★ V3.6：f 可由调用方给出（LCMV 的零响应约束需要 f=[1,0,…,0]）；
   *    不给时沿用旧行为 f 全 1（单位增益约束）。 */
  function solveSmall(Re, Im, n, fr) {
    var N = 2 * n, M = new Float64Array(N * (N + 1)), i, j;
    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) {
        M[(2 * i) * (N + 1) + 2 * j] = Re[i * n + j];
        M[(2 * i) * (N + 1) + 2 * j + 1] = -Im[i * n + j];
        M[(2 * i + 1) * (N + 1) + 2 * j] = Im[i * n + j];
        M[(2 * i + 1) * (N + 1) + 2 * j + 1] = Re[i * n + j];
      }
      var fv = fr ? fr[i] : 1;                       // ★ V3.6：约束响应值（缺省全 1）
      M[(2 * i) * (N + 1) + N] = fv; M[(2 * i + 1) * (N + 1) + N] = 0;
    }
    for (var col = 0; col < N; col++) {
      var piv = col, mx = Math.abs(M[col * (N + 1) + col]), rr;
      for (rr = col + 1; rr < N; rr++) { var v = Math.abs(M[rr * (N + 1) + col]); if (v > mx) { mx = v; piv = rr; } }
      if (mx < 1e-20) return null;
      if (piv !== col) for (var cc = 0; cc <= N; cc++) {
        var tt = M[col * (N + 1) + cc]; M[col * (N + 1) + cc] = M[piv * (N + 1) + cc]; M[piv * (N + 1) + cc] = tt;
      }
      var dv = M[col * (N + 1) + col];
      for (var cc2 = col; cc2 <= N; cc2++) M[col * (N + 1) + cc2] /= dv;
      for (var rr2 = 0; rr2 < N; rr2++) {
        if (rr2 === col) continue;
        var f = M[rr2 * (N + 1) + col]; if (Math.abs(f) < 1e-20) continue;
        for (var cc3 = col; cc3 <= N; cc3++) M[rr2 * (N + 1) + cc3] -= f * M[col * (N + 1) + cc3];
      }
    }
    var re = new Float64Array(n), im = new Float64Array(n);
    for (i = 0; i < n; i++) { re[i] = M[(2 * i) * (N + 1) + N]; im[i] = M[(2 * i + 1) * (N + 1) + N]; }
    return { re: re, im: im };
  }
  function cAt(ssp, z) {
    var t = (z - ssp.z0) / ssp.dz;
    if (t <= 0) return ssp.c[0];
    if (t >= ssp.n - 1) return ssp.c[ssp.n - 1];
    var i = Math.floor(t), f = t - i;
    return ssp.c[i] * (1 - f) + ssp.c[i + 1] * f;
  }
  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  /* ======================= 引擎主体 ======================= */
  /* ★ V3.6：BP 跨帧功率累积的滑动窗长度（帧）。见下方 method==='bp' 分支的说明。 */
  var BP_WIN = 8;
  var bpAcc = null, bpCount = 0, lastMethod = null;
  var workA = null, workB = null, kerSpec = null, curNfft = 0;
  // 发射波形卷积专用缓存（冲激响应 ⊗ 发射波形 → 阵元时域回波）
  var convA = null, convB = null, txSpec = null, curNfc = 0;

  function runPing(J) {
    var t0 = nowMs();
    gSpare = NaN;                 // 见 gauss() 注释：保证 seed→结果可复现
    var M = J.M, nsamp = J.nsamp, fsbb = J.fsbb, fc = J.fc;
    var scat = J.scat, nS = scat.length / 11;
    var nBeam = J.beam.nBeam, nBin = J.beam.nBin;
    var elem = J.elem, txPos = J.txPos, fwd = J.fwd, right = J.right, up = J.up;
    var tStart = J.tStart;
    var kAbs = J.kAbs;                       // 幅度吸收系数 (Np/m，单程)
    var TWO_PI_FC = 2 * Math.PI * fc;
    var txRe = J.txRe, txIm = J.txIm, txN = J.txN;

    /* ---------- ①~④ 阵元级时域回波合成 ----------
     * 分两步（标准时域信号级做法）：
     *   (a) 构造各阵元的「信道冲激响应」 h_m(t) = Σ_i A_im·e^{jφ_im}·δ(t − τ_im)
     *       其中 A_im 已含源级、散射截面、指向性、几何扩散、吸收、反射系数，
     *       φ_im = −2πf_c(R_tx+R_rx)/c 为精细相位（承载亚采样间隔信息）。
     *   (b) h_m 与发射复包络 b(t) 卷积： x_m(t) = Σ_i A_im·b(t − τ_im)·e^{jφ_im}
     *       即真正的「发射波形副本 + 时延 + 相位」，FFT 频域实现。
     * 这样计算量为 O(nS·M) + O(M·N log N)，远优于逐波形样本叠加的 O(nS·M·N)。 */
    var imp = new Float32Array(2 * M * nsamp);      // (a) 冲激响应（未含波形）
    var t1a = nowMs(), used = 0, maxAmp = 0;
    /* ★ V3.3：Σ|A|（全部面元×阵元的回波幅度和）。它把"图像变暗"拆成两件事：
       sumA 掉了 → 是照亮/幅度的问题；sumA 不变而图像暗 → 是波束形成相位失相干。
       实测俯仰 0→3° 时 sumA 上升而图像变暗，正是后者（见 diag.sumA）。 */
    var sumA = 0;

    for (var i = 0; i < nS; i++) {
      var o = i * 11;
      var px = scat[o], py = scat[o + 1], pz = scat[o + 2];
      var nx = scat[o + 3], ny = scat[o + 4], nz = scat[o + 5];
      var amp = scat[o + 6], model = scat[o + 7], rough = scat[o + 8], pt = scat[o + 9];
      var phRnd = scat[o + 10];                      // 亚波长粗糙度随机相位（V1.4）

      /* — 发射支路 — */
      var dtx = px - txPos[0], dty = py - txPos[1], dtz;
      if (pt === 1) dtz = pz + txPos[2];            // 海面镜像
      else if (pt === 3) dtz = txPos[2] - pz;       // 海底镜像
      else dtz = pz - txPos[2];
      var Rtx = Math.sqrt(dtx * dtx + dty * dty + dtz * dtz);
      if (Rtx < 0.05) continue;
      var ux = dtx / Rtx, uy = dty / Rtx, uz = dtz / Rtx;
      if (pt !== 0) uz = -uz;                        // 镜像路径：到达方向取镜像
      // 入射角余弦（相对面元法线）
      var ci = -(nx * ux + ny * uy + nz * uz);
      if (ci <= 0.015) continue;                     // 背面 / 极端掠射剔除
      // 发射指向性
      var df = ux * fwd[0] + uy * fwd[1] + uz * fwd[2];
      var dr = ux * right[0] + uy * right[1] + uz * right[2];
      var du = ux * up[0] + uy * up[1] + uz * up[2];
      var Dtx = beamPat(Math.atan2(dr, df), J.txH) * beamPatV(Math.asin(du > 1 ? 1 : (du < -1 ? -1 : du)), J.txV);
      if (Dtx < 0.02) continue;
      var refl = 1;
      if (pt === 1) refl = -J.surfR0 * Math.exp(-2 * Math.pow(J.surfKH * Math.abs(uz), 2));
      else if (pt === 3) refl = J.botR;

      /* — 散射角度因子 — */
      var ang, c2 = ci * ci;
      if (model < 0) ang = 1;                        // 目标：σ 已按 TS 归一化
      else if (model === 1) {                        // Kirchhoff / Biot 粗糙界面
        var s2 = Math.max(1e-4, rough * rough);
        var t2 = (1 - c2) / Math.max(1e-6, c2);
        ang = Math.min(30, Math.sqrt(1 / (8 * Math.PI * s2)) / Math.max(1e-4, c2) * Math.sqrt(Math.exp(-Math.min(40, t2 / (2 * s2)))));
      } else if (model === 2) {                      // 经验公式（含掠射增强项）
        ang = Math.sqrt(c2 * c2 + 0.1 * Math.exp(-Math.acos(ci) / 0.1396));
      } else if (model === 3) {                      // 掠射指数律（V1.4.1）
        /* σ0 = μ·sinθ_g（a=1）。ci = sinθ_g（ci 为入射方向与面元法线夹角的余弦）。
         * 功率 ∝ ang²，故 ang = √ci 才能得到 σ0 ∝ ci。 */
        ang = Math.sqrt(ci);
      } else ang = ci;                               // Lambert：σ0 = μ cos²θ

      var cEff = 0.5 * (cAt(J.ssp, pz) + cAt(J.ssp, txPos[2]));   // 路径等效声速
      var aTx = J.srcAmp * amp * ang * Dtx * Math.exp(-kAbs * Rtx) * refl / Rtx;
      var phTx = -TWO_PI_FC * Rtx / cEff;

      /* — 接收支路：逐阵元独立叠加 — */
      for (var m = 0; m < M; m++) {
        var e3 = m * 3;
        var dx = px - elem[e3], dy = py - elem[e3 + 1], dz;
        var ez0 = elem[e3 + 2];
        var rfl = 1;
        if (pt === 2) dz = pz + ez0;
        else if (pt === 4) dz = ez0 - pz;
        else dz = pz - ez0;
        var Rrx = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (Rrx < 0.05) continue;
        var vx = dx / Rrx, vy = dy / Rrx, vz = dz / Rrx;
        if (pt !== 0) {
          vz = -vz;
          if (pt === 2) rfl = -J.surfR0 * Math.exp(-2 * Math.pow(J.surfKH * Math.abs(vz), 2));
          else if (pt === 4) rfl = J.botR;
        }
        var df2 = vx * fwd[0] + vy * fwd[1] + vz * fwd[2];
        var dr2 = vx * right[0] + vy * right[1] + vz * right[2];
        var du2 = vx * up[0] + vy * up[1] + vz * up[2];
        var Drx = beamPat(Math.atan2(dr2, df2), J.elH) * beamPatV(Math.asin(du2 > 1 ? 1 : (du2 < -1 ? -1 : du2)), J.elV);
        if (Drx < 0.02) continue;
        var A = aTx * Drx * Math.exp(-kAbs * Rrx) * rfl / Rrx * J.chanAmp[m];
        if (A < 1e-14) continue;
        sumA += A;
        var tau = (Rtx + Rrx) / cEff;
        var idxF = (tau - tStart) * fsbb;
        var k0 = Math.floor(idxF);
        if (k0 < 0 || k0 + 1 >= nsamp) continue;
        var fr = idxF - k0;
        var ph = phTx - TWO_PI_FC * Rrx / cEff + J.chanPhase[m] + phRnd;
        var cph = Math.cos(ph), sph = Math.sin(ph);
        var Ar = A * cph, Ai = A * sph;
        var b10 = 2 * (m * nsamp + k0);
        // 线性插值把冲激分配到相邻两个采样点（实现亚采样精度的时延 τ）
        imp[b10] += Ar * (1 - fr);
        imp[b10 + 1] += Ai * (1 - fr);
        imp[b10 + 2] += Ar * fr;
        imp[b10 + 3] += Ai * fr;
        if (A > maxAmp) maxAmp = A;
      }
      used++;
    }

    /* ---------- ④' 冲激响应 ⊗ 发射波形 → 阵元级时域回波信号 ----------
     * x_m(t) = Σ_i A_im·b(t − τ_im)·e^{−j2πf_c τ_im}，射频为 Re{x_m(t)e^{j2πf_c t}} */
    var sig;
    if (txN > 1) {
      var nfc = nextPow2(nsamp + txN);
      if (!convA || curNfc !== nfc || convA.length < 2 * nfc) {
        convA = new Float32Array(2 * nfc); convB = new Float32Array(2 * nfc);
        txSpec = new Float32Array(2 * nfc); curNfc = nfc;
      }
      convB.fill(0);
      for (var kw = 0; kw < txN && kw < nfc; kw++) { convB[2 * kw] = txRe[kw]; convB[2 * kw + 1] = txIm[kw]; }
      fft(convB, nfc, false);
      txSpec.set(convB);
      sig = new Float32Array(2 * M * nsamp);
      for (var mc = 0; mc < M; mc++) {
        var bc = 2 * (mc * nsamp);
        convA.fill(0);
        for (var nc = 0; nc < nsamp; nc++) { convA[2 * nc] = imp[bc + 2 * nc]; convA[2 * nc + 1] = imp[bc + 2 * nc + 1]; }
        fft(convA, nfc, false);
        for (var kc = 0; kc < nfc; kc++) {
          var ar2 = convA[2 * kc], ai2 = convA[2 * kc + 1], br3 = txSpec[2 * kc], bi3 = txSpec[2 * kc + 1];
          convA[2 * kc] = ar2 * br3 - ai2 * bi3;
          convA[2 * kc + 1] = ar2 * bi3 + ai2 * br3;
        }
        fft(convA, nfc, true);
        for (nc = 0; nc < nsamp; nc++) { sig[bc + 2 * nc] = convA[2 * nc]; sig[bc + 2 * nc + 1] = convA[2 * nc + 1]; }
      }
    } else {
      sig = imp;                                     // 无波形（纯冲激）时直接沿用
    }

    /* ---------- ⑤ 阵元级噪声 ---------- */
    var rnd = rng((J.seed + J.frame * 7919) | 0), sigN = J.noiseSig;
    var chPre = (J.retChan >= 0 && J.retChan < M) ? new Float32Array(2 * nsamp) : null;
    var m2, n2, off2;
    for (m2 = 0; m2 < M; m2++) {
      off2 = 2 * (m2 * nsamp);
      for (n2 = 0; n2 < nsamp; n2++) {
        sig[off2 + 2 * n2] += gauss(rnd) * sigN;
        sig[off2 + 2 * n2 + 1] += gauss(rnd) * sigN;
      }
      if (chPre && m2 === J.retChan) chPre.set(sig.subarray(off2, off2 + 2 * nsamp));
    }
    var allPre = J.retAll ? sig.slice(0, 2 * M * nsamp) : null;      // 全部阵元（滤波前，供导出）

    /* ---------- ⑥ 带通滤波（基带等效低通） ---------- */
    var noiseScale = 1;
    /* ★ V3.4：通带与信号频带无交集 → 全阻（见 99-app.js buildFir）。
     * 这里不能"不滤波"，否则设错通带反而等于全放行。噪声同样被滤掉，
     * 但留一个极小残量，避免自适应算法的对角加载基准退化成 0。 */
    if (J.firMute) {
      for (m2 = 0; m2 < M; m2++) {
        var bz = 2 * (m2 * nsamp);
        for (n2 = 0; n2 < 2 * nsamp; n2++) sig[bz + n2] = 0;
      }
      noiseScale = 1e-10;
    }
    if (J.firH) {
      var h = J.firH, nh = h.length, mh = (nh - 1) >> 1, hs = 0;
      var hIm = J.firHI || null;
      /* ★ V3.4：复系数核的功率增益 = Σ|H[k]|² = Σ(h² + hI²)。
         纯实系数（hI 为空）时与旧式完全一致，不会引入回归。 */
      for (var q2 = 0; q2 < nh; q2++) hs += h[q2] * h[q2] + (hIm ? hIm[q2] * hIm[q2] : 0);
      noiseScale *= hs;
      for (m2 = 0; m2 < M; m2++) firApply(sig, m2 * nsamp, nsamp, h, nh, mh, hIm);
    }

    /* ---------- ⑦ 匹配滤波（脉冲压缩，FFT 频域，核频谱全局共用） ---------- */
    if (J.useMF && txN > 1) {
      var nf = nextPow2(nsamp + txN);
      if (!workA || curNfft !== nf || workA.length < 2 * nf) {
        workA = new Float32Array(2 * nf); workB = new Float32Array(2 * nf);
        kerSpec = new Float32Array(2 * nf); curNfft = nf;
      }
      workB.fill(0);
      var kerE = 0;
      for (var kk = 0; kk < txN; kk++) {
        var kr = J.kerRe[kk], ki = J.kerIm[kk];
        workB[2 * kk] = kr; workB[2 * kk + 1] = ki; kerE += kr * kr + ki * ki;
      }
      noiseScale *= kerE;
      fft(workB, nf, false);
      kerSpec.set(workB);
      for (m2 = 0; m2 < M; m2++) {
        var b4 = 2 * (m2 * nsamp);
        workA.fill(0);
        for (n2 = 0; n2 < nsamp; n2++) { workA[2 * n2] = sig[b4 + 2 * n2]; workA[2 * n2 + 1] = sig[b4 + 2 * n2 + 1]; }
        fft(workA, nf, false);
        for (var k3 = 0; k3 < nf; k3++) {
          var ar = workA[2 * k3], ai = workA[2 * k3 + 1], br2 = kerSpec[2 * k3], bi2 = kerSpec[2 * k3 + 1];
          workA[2 * k3] = ar * br2 - ai * bi2; workA[2 * k3 + 1] = ar * bi2 + ai * br2;
        }
        fft(workA, nf, true);
        for (n2 = 0; n2 < nsamp; n2++) { sig[b4 + 2 * n2] = workA[2 * n2]; sig[b4 + 2 * n2 + 1] = workA[2 * n2 + 1]; }
      }
      // 零时延补偿：因果卷积使相关峰滞后 (txN−1) 个样本，左移消除系统距离偏置
      var dly = txN - 1;
      if (dly > 0 && dly < nsamp) {
        for (m2 = 0; m2 < M; m2++) {
          var b6 = 2 * (m2 * nsamp);
          for (n2 = 0; n2 + dly < nsamp; n2++) {
            sig[b6 + 2 * n2] = sig[b6 + 2 * (n2 + dly)];
            sig[b6 + 2 * n2 + 1] = sig[b6 + 2 * (n2 + dly) + 1];
          }
          for (n2 = nsamp - dly; n2 < nsamp; n2++) { sig[b6 + 2 * n2] = 0; sig[b6 + 2 * n2 + 1] = 0; }
        }
      }
    }

    /* ---------- ⑧ TVG 时变增益 ---------- */
    var tvg = J.tvg;
    if (tvg) for (m2 = 0; m2 < M; m2++) {
      var b5 = 2 * (m2 * nsamp);
      for (n2 = 0; n2 < nsamp; n2++) { sig[b5 + 2 * n2] *= tvg[n2]; sig[b5 + 2 * n2 + 1] *= tvg[n2]; }
    }
    var chPost = (J.retChan >= 0 && J.retChan < M) ? sig.slice(2 * (J.retChan * nsamp), 2 * (J.retChan * nsamp + nsamp)) : null;
    var t1b = nowMs();

    /* ---------- ⑨ 波束形成 / 成像 ---------- */
    var img = new Float32Array(nBeam * nBin);
    var bts = (J.retBeam >= 0) ? new Float32Array(2 * nBin) : null;
    var nfArr = new Float32Array(nBin);
    var method = J.beam.method;
    var rmin = J.beam.rmin, rmax = J.beam.rmax;
    var sec = J.beam.sector * Math.PI / 180;
    /* ★ V3.3：聚焦点用**本体轴** fwdB（不含安装/成像俯仰），指向性仍用 J.fwd/J.up。
       原因见 99-app.js buildJob 的说明：一维水平线阵绕右舷轴旋转对波束形成无影响，
       让聚焦点跟着转只会把相位错开、把图像"散焦"压暗（实测 0→3° 时总回波幅度
       上升 24%，图像却掉 42%，是纯伪影）。 */
    var fwdB = J.fwdB || J.fwd;
    var cRef = cAt(J.ssp, txPos[2]);
    var wts = J.beam.shade;
    var needEig = (method === 'esb' || method === 'music');
    var L = Math.min(M, Math.max(2, J.beam.subLen | 0));
    /* ★ V3.6：自适应类算法的参与阵元上限由参数给出（0 = 全阵），不再是写死的 64。
       它以前是常数，界面上看不见也改不了 —— 把阵元数从 64 加到 512，CBF 的
       波束变窄了、MVDR 的却纹丝不动，属于查不出原因的空改。现在可见、可调、
       超限会告警（见 01-core.js derive 的 W 列表）。 */
    var adapM = Math.max(0, J.beam.adapM | 0);
    var useM = needEig ? L : (adapM > 0 ? Math.min(M, adapM) : M);
    var noisePowPre = 2 * sigN * sigN * noiseScale;      // 复噪声功率（滤波+脉压后，单位 μPa²）
    var wsum = 0, wsumA = 0, mw;                          // Σw²、Σw
    for (mw = 0; mw < M; mw++) { wsum += wts[mw] * wts[mw]; wsumA += wts[mw]; }
    if (!(wsumA > 0)) wsumA = 1;
    /* ★ V3.6：BP 的跨帧缓冲按算法切换重置 —— 否则从 BP 切走再切回来，
       会把若干帧之前（甚至是别的算法留下）的旧功率继续平均进来。 */
    if (method !== lastMethod) { bpAcc = null; bpCount = 0; lastMethod = method; }

    // 自适应算法缓存
    var Rre = null, Rim = null, Lre = null, Lim = null, zre = null, zim = null, wre = null, wim = null,
      tzr = null, tzi = null, eigC = null;
    var needR = (method === 'mvdr' || method === 'lcmv' || method === 'acw' || needEig);
    if (needR) {
      Rre = new Float64Array(useM * useM); Rim = new Float64Array(useM * useM);
      Lre = new Float64Array(useM * useM); Lim = new Float64Array(useM * useM);
      zre = new Float64Array(useM); zim = new Float64Array(useM);
      wre = new Float64Array(useM); wim = new Float64Array(useM);
      tzr = new Float64Array(useM); tzi = new Float64Array(useM);
    }
    /* ★ V3.6：快拍数不再拍脑袋取 min(48, 1.5·useM)。
       RMB 准则要求 K ≥ 2·useM，协方差矩阵才有望可逆、MVDR 才不退化成
       "被对角加载主导的 CBF"。旧值 48 < 2×64 = 128，R 的秩只有 48，
       解出来的权重大半由加载量决定 —— 这是 MVDR 看起来"和 CBF 差不多"的
       真正原因，不是算法没实现。
       但快拍窗也不能无限拉长：它跨过的距离越多，相邻距离门的散射就越被混进
       同一个 R，等于自己把距离分辨率糊掉。所以上限取 3 个距离单元对应的样本数。 */
    var sampPerBinK = (rmax - rmin) / nBin * 2 / cRef * fsbb;
    var Kcap = Math.min(256, Math.max(8, Math.round(3 * sampPerBinK)));
    var Ksnap = Math.min(Kcap, Math.max(8, 2 * useM)), halfK = Ksnap >> 1;
    var ksnapShort = Ksnap < 2 * useM;                    // 快拍数仍不足 2M（受距离分辨限制）
    // 对角加载基准：以「阵元噪声功率」为参照（而非协方差迹）。
    // 若以 tr(R)/M 为基准，强目标时迹由信号主导，加载量会淹没信号子空间，
    // 导致 MUSIC/ESB 等特征类算法失效。噪声基准物理意义明确：
    // ε = 10^(dl/10) · σ_n²（σ_n² 为该距离处阵元复噪声功率，含 TVG 放大）。
    var dlBase = Math.pow(10, J.beam.dl / 10) * noisePowPre;
    var nsrc = Math.max(1, Math.min(L - 1, J.beam.nsrc | 0));
    var nulls = J.beam.nulls || [];
    /* ★ V3.6：噪声参考功率的口径**按算法分三类**。
       nf 是「SNR 显示」和「峰值信噪比」的分母，口径错了读数就错；而图像是
       自动归一化的，错了根本看不出来 —— 属于最难发现的那类错。
         ① CBF/BP/PCI：输出 = |Σ w_m x_m| / Σw_m，白噪下输出噪声功率
            = σ²·Σw²/(Σw)²。旧代码除以 M²：开汉宁窗时 Σw²/M² = 0.375/M，
            比正确值 1.5/M 低 4.3 dB → **SNR 读数虚高 4.3 dB**；
         ② MVDR/LCMV/ACW：权重由 R⁻¹ 定、根本不经过加权窗（‖a‖² = useM），
            白噪下 = σ²/useM。旧代码却仍按 Σw²/M² 算，双重错；
         ③ ESB：w = P_s·a，‖w‖² ≈ nsrc，输出还除以 useM → σ²·nsrc/useM²。
       MUSIC 输出是无量纲空间谱，不是幅度，nf 填 1（SNR 退化为谱值 dB）。 */
    var nfScale;
    if (method === 'cbf' || method === 'bp' || method === 'pci') nfScale = wsum / (wsumA * wsumA);
    else if (method === 'esb') nfScale = nsrc / (useM * useM);
    else if (method === 'music') nfScale = 0;               // 见下方：music 的 nf 直接填 1
    else nfScale = 1 / Math.max(1, useM);
    /* LCMV 辅助约束的响应向量 f：① 单位增益全 1；② 零响应 f=[1,0,…,0]（真置零） */
    var fCon = null;
    if (method === 'lcmv' && J.beam.nullMode === 'zero') {
      fCon = new Float64Array(1 + nulls.length);
      fCon[0] = 1;                                          // 其余元素留 0 = 强制零响应
    }
    var eigStride = needEig ? Math.max(1, Math.ceil(nBin / 64)) : 1;
    // ── 特征类算法的快拍窗宽度自适应 ────────────────────────────────────
    // ESB/MUSIC 为控制 Jacobi 分解开销，复用一次协方差服务 eigStride 个距离单元。
    // 此时快拍窗必须覆盖「整组距离单元 + 回波自身展宽」，否则组内多数距离单元
    // 使用的 R 中根本不含该处回波（只剩噪声），信号子空间被噪声占据，
    // 方位谱会完全发散（表现为峰值乱跳/镜像）。
    //   每距离单元样本数 = 2·Δr/(c·fsbb)；脉压后回波展宽 ≈ 2·1.5·fsbb/BW
    var sampPerBin = (rmax - rmin) / nBin * 2 / cRef * fsbb;
    var echoSpan = J.useMF ? (2 * Math.ceil(1.5 * fsbb / Math.max(1, J.bw || 1000)) + 8)
      : Math.min(256, (J.txN | 0) + 8);
    var KsnapE = Math.min(256, Math.max(8, Math.ceil(eigStride * sampPerBin + echoSpan)));
    var Px = new Float64Array(M), Py = new Float64Array(M);
    var phArr = new Float64Array(M);
    var beamAngles = new Float64Array(nBeam), bi;
    for (bi = 0; bi < nBeam; bi++) beamAngles[bi] = -sec / 2 + sec * (nBeam === 1 ? 0.5 : bi / (nBeam - 1));
    var Pt = new Float64Array(3);
    var rBuilt = -1;
    /* 阵元相对孔径中心的弧长偏移 s_m（沿右舷方向，单位 m）。
       由 elem_m = txPos + s_m·right 反解：s_m = (elem_m − txPos)·right。
       与孔径中心到各阵元的距离一起，构成上面 R_m² 二次式的自变量表。 */
    var lcmvBuf = null, esbBuf = null;      // V2.2：自适应算法的工作数组（逐点复用）
    var sOff = new Float64Array(M);
    for (var mm = 0; mm < M; mm++) {
      var e9 = mm * 3;
      sOff[mm] = (elem[e9] - txPos[0]) * right[0] + (elem[e9 + 1] - txPos[1]) * right[1] +
        (elem[e9 + 2] - txPos[2]) * right[2];
    }

    /** 估计协方差矩阵
     *  bIdx  : 起始距离单元序号
     *  bCen  : 本组「中心」距离单元（快拍窗以其对应距离为圆心）
     *  返回   : 是否成功（快拍窗有效） */
    function buildR(bIdx, bCen) {
      var r2 = rmin + (rmax - rmin) * (bCen + 0.5) / nBin;
      var nc = (2 * r2 / cRef - tStart) * fsbb;
      var Ks = needEig ? KsnapE : Ksnap, hK = Ks >> 1;
      var n0 = Math.round(nc) - hK;
      var useSub = needEig && J.beam.smooth;
      var nSub = useSub ? (M - L + 1) : 1;
      var a, p, q, sn, su;
      for (a = 0; a < useM * useM; a++) { Rre[a] = 0; Rim[a] = 0; }
      var cnt = 0;
      for (sn = 0; sn < Ks; sn++) {
        var idx0 = n0 + sn;
        if (idx0 < 0 || idx0 >= nsamp) continue;
        for (su = 0; su < nSub; su++) {
          for (p = 0; p < useM; p++) {
            var mp = useSub ? (su + p) : p;
            var bp2 = 2 * (mp * nsamp + idx0);
            var xr = sig[bp2], xi = sig[bp2 + 1];
            for (q = 0; q < useM; q++) {
              var mq = useSub ? (su + q) : q;
              var bq2 = 2 * (mq * nsamp + idx0);
              var yr = sig[bq2], yi = sig[bq2 + 1];
              Rre[p * useM + q] += xr * yr + xi * yi;
              Rim[p * useM + q] += xi * yr - xr * yi;
            }
          }
          cnt++;
        }
      }
      if (!cnt) return false;
      var sc = 1 / cnt;
      for (a = 0; a < useM * useM; a++) { Rre[a] *= sc; Rim[a] *= sc; }
      var tr = 0;
      for (p = 0; p < useM; p++) tr += Rre[p * useM + p];
      // 当前距离处的 TVG 增益（快拍取自 TVG 之后的数据，噪声同样被放大）
      var ncv = (2 * r2 / cRef - tStart) * fsbb;
      var tgv = tvg ? tvg[Math.min(nsamp - 1, Math.max(0, Math.round(ncv)))] : 1;
      var eps = dlBase * tgv * tgv;
      if (!(eps > 0)) eps = 1e-12 * (tr / useM) + 1e-18;
      for (p = 0; p < useM; p++) Rre[p * useM + p] += eps;      // 对角加载
      chol(Rre, Rim, useM, Lre, Lim);
      return true;
    }

    /** 自适应波束输出
     *  导向矢量：a_m = e^{−j2πf_c(R_m−r)/c} = e^{−j·phArr[m]}。
     *  推导：阵元 m 相对参考点的额外路程为 (R_m − r)，接收相位滞后 e^{−j2πf_c(R_m−r)/c}；
     *  CBF 的补偿相位为 e^{+j·phArr}（即 w = a^H 形式），因此 a 必须取负号，
     *  否则自适应波束主瓣会镜像到 −θ 方向。 */
    function adaptiveOut(r, nCenter) {
      var m7, i3;
      for (m7 = 0; m7 < useM; m7++) { tzr[m7] = Math.cos(-phArr[m7]); tzi[m7] = Math.sin(-phArr[m7]); }
      var idxS = Math.round(nCenter);
      if (idxS < 0 || idxS >= nsamp) return 0;
      if (method === 'mvdr' || method === 'acw') {
        // ACW 的旁瓣抑制部分即 MVDR 自适应输出，再乘以相干因子 CF^p
        fsolve(Lre, Lim, useM, tzr, tzi, wre, wim);
        var denom = 0;
        for (i3 = 0; i3 < useM; i3++) denom += wre[i3] * wre[i3] + wim[i3] * wim[i3];
        if (!(denom > 1e-30)) return 0;
        bsolve(Lre, Lim, useM, wre, wim, zre, zim);             // z = R⁻¹a
        var yr = 0, yi = 0;
        for (m7 = 0; m7 < useM; m7++) {
          var b8 = 2 * (m7 * nsamp + idxS);
          var xr2 = sig[b8], xi2 = sig[b8 + 1];
          yr += (zre[m7] * xr2 + zim[m7] * xi2) / denom;        // Re{conj(w)x}
          yi += (zre[m7] * xi2 - zim[m7] * xr2) / denom;
        }
        return Math.sqrt(yr * yr + yi * yi);
      }
      if (method === 'lcmv') {
        var nc2 = 1 + nulls.length;
        /* ★ V2.2：这些工作数组原本在**每个 (距离门 × 波束) 点**里 new 一次，
           默认 256×181 = 46336 个点 → 单帧几百万次临时分配，GC 压力直接吃掉
           大半帧预算。改为按最大约束数预分配、逐点复用。 */
        if (!lcmvBuf || lcmvBuf.nc < nc2) {
          lcmvBuf = {
            nc: nc2,
            Cre: new Float64Array(useM * nc2), Cim: new Float64Array(useM * nc2),
            Zre: new Float64Array(useM * nc2), Zim: new Float64Array(useM * nc2),
            Gre: new Float64Array(nc2 * nc2), Gim: new Float64Array(nc2 * nc2)
          };
        }
        var Cre = lcmvBuf.Cre, Cim = lcmvBuf.Cim, Zre = lcmvBuf.Zre, Zim = lcmvBuf.Zim,
          Gre = lcmvBuf.Gre, Gim = lcmvBuf.Gim;
        for (m7 = 0; m7 < useM; m7++) { Cre[m7 * nc2] = tzr[m7]; Cim[m7 * nc2] = tzi[m7]; }
        /* ★ V3.6：辅助约束的导向矢量必须与主瓣**同一个公式、同一个角度**。
           旧实现走的是远场投影 proj = s_m·sinθ_N，而且差一个符号 —— 算出来
           其实是 a(−θ_N)：填 +30° 被约束到了 −30° 上（实测：与 a(+θ_N) 的平均
           矢量差 1.28，与 a(−θ_N) 只差 0.065，后者的残差纯粹来自缺失的近场二次项）。
           现在照抄主瓣那一套：聚焦点 P = tx + r(cosθ_N·fwdB + sinθ_N·right)，
           R_m = |P − elem_m|，a_m = e^{−j·2πf_c·(R_m−r)/c} —— 与 tzr 同号同式，
           并且连近场二次项（A − 2Bs + s² 那个 A/B 化简）也一起带上。 */
        for (var ci2 = 0; ci2 < nulls.length; ci2++) {
          var angN = nulls[ci2] * Math.PI / 180;
          var caN = Math.cos(angN), saN = Math.sin(angN);
          var exN = r * (fwdB[0] * caN + right[0] * saN);
          var eyN = r * (fwdB[1] * caN + right[1] * saN);
          var ezN = r * (fwdB[2] * caN + right[2] * saN);
          var AN = exN * exN + eyN * eyN + ezN * ezN;
          var BN = exN * right[0] + eyN * right[1] + ezN * right[2];
          for (m7 = 0; m7 < useM; m7++) {
            var sN = sOff[m7];
            var RmN = Math.sqrt(AN - 2 * BN * sN + sN * sN);
            var ph4 = TWO_PI_FC * (RmN - r) / cRef;
            Cre[m7 * nc2 + 1 + ci2] = Math.cos(-ph4); Cim[m7 * nc2 + 1 + ci2] = Math.sin(-ph4);
          }
        }
        var c3, m11;
        for (c3 = 0; c3 < nc2; c3++) {
          for (m11 = 0; m11 < useM; m11++) { wre[m11] = Cre[m11 * nc2 + c3]; wim[m11] = Cim[m11 * nc2 + c3]; }
          fsolve(Lre, Lim, useM, wre, wim, zre, zim);
          bsolve(Lre, Lim, useM, zre, zim, wre, wim);
          for (m11 = 0; m11 < useM; m11++) { Zre[m11 * nc2 + c3] = wre[m11]; Zim[m11 * nc2 + c3] = wim[m11]; }
        }
        for (var p2 = 0; p2 < nc2; p2++) for (var q4 = 0; q4 < nc2; q4++) {
          var gre = 0, gim = 0;
          for (m7 = 0; m7 < useM; m7++) {
            var cr2 = Cre[m7 * nc2 + p2], ci3 = -Cim[m7 * nc2 + p2];
            var zr2 = Zre[m7 * nc2 + q4], zi2 = Zim[m7 * nc2 + q4];
            gre += cr2 * zr2 - ci3 * zi2; gim += cr2 * zi2 + ci3 * zr2;
          }
          Gre[p2 * nc2 + q4] = gre; Gim[p2 * nc2 + q4] = gim;
        }
        /* ★ V3.6：fCon 为 null 时全 1（单位增益保形，旧行为）；
           为 [1,0,…,0] 时在辅助方向强制零响应 —— 这才是"干扰置零"。
           旧版帮助文字写着"用于干扰方向置零"，实现的却是单位增益，说法与行为不符。 */
        var hh = solveSmall(Gre, Gim, nc2, fCon);
        if (!hh) return 0;
        var yr3 = 0, yi3 = 0;
        for (m7 = 0; m7 < useM; m7++) {
          var wr3 = 0, wi3 = 0;
          for (var c4 = 0; c4 < nc2; c4++) {
            wr3 += Zre[m7 * nc2 + c4] * hh.re[c4] - Zim[m7 * nc2 + c4] * hh.im[c4];
            wi3 += Zre[m7 * nc2 + c4] * hh.im[c4] + Zim[m7 * nc2 + c4] * hh.re[c4];
          }
          var b14 = 2 * (m7 * nsamp + idxS);
          yr3 += wr3 * sig[b14] + wi3 * sig[b14 + 1];
          yi3 += wr3 * sig[b14 + 1] - wi3 * sig[b14];
        }
        return Math.sqrt(yr3 * yr3 + yi3 * yi3);
      }
      // ESB / MUSIC：使用缓存的特征分解（每个距离段只分解一次，供该段全部波束复用）
      var E = eigC, k4, m15;
      if (!E) return 0;
      if (method === 'music') {
        // MUSIC 空间谱：P(θ) = 1 / ‖E_nᴴ a(θ)‖²，E_n 为噪声子空间（λ 最小的 L−D 个特征向量）
        // 归一化到 ‖a‖²=L，使谱值量级为 1；峰值处投影趋于 0 → 出现尖锐谱峰。
        var psum = 0;
        for (k4 = nsrc; k4 < useM; k4++) {
          var ar2 = 0, ai2 = 0;
          for (m15 = 0; m15 < useM; m15++) {
            var vre = E.vre[m15 * useM + k4], vim = E.vim[m15 * useM + k4];
            ar2 += vre * tzr[m15] + vim * tzi[m15];
            ai2 += vre * tzi[m15] - vim * tzr[m15];
          }
          psum += ar2 * ar2 + ai2 * ai2;
        }
        return 1 / Math.sqrt(1e-9 + psum / useM);
      }
      /* ESB 特征空间波束形成（Feldman–Griffiths 投影法）
       *   w_ESB = U_s U_sᴴ a = Σ_{k<D} v_k (v_kᴴ a)
       * 即把常规导向矢量投影到由 D 个主特征向量张成的信号子空间，剔除噪声子空间分量，
       * 从而在导向矢量失配（阵元误差、声速误差、近场模型偏差）时比 MVDR 更稳健。
       * 两点注意：
       *   ① 不能按 ‖w‖ 归一化——D=1 时 |wᴴx|/‖w‖ 中的投影系数会被约掉，
       *      输出与角度完全无关（图像变成一整片等亮度的扇形，峰值随机落在边缘）。
       *   ② 不做 1/λ_k 加权——无回波区 λ_k 极小，1/λ 会把噪声区输出反常抬高。 */
      /* ★ V2.2：同上，原本每个 (距离 × 波束) 点 new 一次，改为复用。 */
      if (!esbBuf) esbBuf = { wr: new Float64Array(useM), wi: new Float64Array(useM) };
      var wr4 = esbBuf.wr, wi4 = esbBuf.wi;
      for (k4 = 0; k4 < nsrc && k4 < useM; k4++) {
        var ar3 = 0, ai3 = 0, m16;
        for (m16 = 0; m16 < useM; m16++) {
          var vre2 = E.vre[m16 * useM + k4], vim2 = E.vim[m16 * useM + k4];
          ar3 += vre2 * tzr[m16] + vim2 * tzi[m16];       // Re{v_kᴴ a}
          ai3 += vim2 * tzr[m16] - vre2 * tzi[m16];       // Im{v_kᴴ a}
        }
        for (m16 = 0; m16 < useM; m16++) {
          var vr4 = E.vre[m16 * useM + k4], vi4 = E.vim[m16 * useM + k4];
          // v_k · (v_kᴴ a) = (vr + j·vi)·(ar3 + j·ai3)
          wr4[m16] += vr4 * ar3 - vi4 * ai3;
          wi4[m16] += vr4 * ai3 + vi4 * ar3;
        }
      }
      var yr4 = 0, yi4 = 0;
      for (m15 = 0; m15 < useM; m15++) {
        var b18 = 2 * (m15 * nsamp + idxS);
        // wᴴ x = Σ conj(w_m)·x_m
        yr4 += wr4[m15] * sig[b18] + wi4[m15] * sig[b18 + 1];
        yi4 += wr4[m15] * sig[b18 + 1] - wi4[m15] * sig[b18];
      }
      return Math.sqrt(yr4 * yr4 + yi4 * yi4) / useM;
    }

    for (var bIdx = 0; bIdx < nBin; bIdx++) {
      var r = rmin + (rmax - rmin) * (bIdx + 0.5) / nBin;
      var tArrive = 2 * r / cRef;
      var nCenter = (tArrive - tStart) * fsbb;
      var tg = tvg ? tvg[Math.min(nsamp - 1, Math.max(0, Math.round(nCenter)))] : 1;
      nfArr[bIdx] = (method === 'music') ? 1
        : Math.max(1e-30, noisePowPre * tg * tg * nfScale);
      if (needR && (rBuilt < 0 || bIdx - rBuilt >= eigStride)) {
        // 本组中心距离单元：快拍窗以它为中心，保证整组单元都被回波覆盖
        var bCen = Math.min(nBin - 1, bIdx + ((eigStride - 1) >> 1));
        if (buildR(bIdx, bCen)) {
          rBuilt = bIdx;
          // 特征类算法：本距离段只做一次特征分解（Jacobi），供全部波束复用
          if (needEig) eigC = hermEig(Rre, Rim, useM);
        }
      }
      for (var aIdx = 0; aIdx < nBeam; aIdx++) {
        var ang2 = beamAngles[aIdx];
        var ca = Math.cos(ang2), sa = Math.sin(ang2);
        /* 聚焦点：本体轴 fwdB 展开的扇形栅格（俯仰不参与，见上） */
        Pt[0] = txPos[0] + r * (ca * fwdB[0] + sa * right[0]);
        Pt[1] = txPos[1] + r * (ca * fwdB[1] + sa * right[1]);
        Pt[2] = txPos[2] + r * (ca * fwdB[2] + sa * right[2]);
        var sumRe = 0, sumIm = 0, m6;
        /* ★ V2.2 代数化简（数学严格等价，非近似）：
           阵元沿载体右舷方向等间距排列，elem_m = txPos + s_m·right，|right| = 1，
           于是 R_m² = |Pt − txPos|² − 2 s_m (Pt − txPos)·right + s_m²
                     = A − 2·B·s + s²
           其中 A、B 只与 (距离门 r, 波束角) 有关、与阵元序号无关。
           原实现每个 (r, θ, m) 都要做 3 次减法 + 3 次平方 + 2 次加法（2.97×10⁶ 次），
           现在 A、B 每 (r, θ) 只算一次（4.6×10⁴ 次），内层只剩一次二次式求值 + sqrt。 */
        var ex0 = Pt[0] - txPos[0], ey0 = Pt[1] - txPos[1], ez0 = Pt[2] - txPos[2];
        var Afac = ex0 * ex0 + ey0 * ey0 + ez0 * ez0;
        var Bfac = ex0 * right[0] + ey0 * right[1] + ez0 * right[2];
        for (m6 = 0; m6 < M; m6++) {
          var sm = sOff[m6];
          var Rm = Math.sqrt(Afac - 2 * Bfac * sm + sm * sm);
          var Tm = (r - Rm) / cRef;
          var idxD = ((r + Rm) / cRef - tStart) * fsbb;
          var k0b = Math.floor(idxD);
          var xr = 0, xi = 0;
          if (k0b >= 0 && k0b + 1 < nsamp) {
            var frb = idxD - k0b, bb = 2 * (m6 * nsamp + k0b);
            xr = sig[bb] + (sig[bb + 2] - sig[bb]) * frb;
            xi = sig[bb + 1] + (sig[bb + 3] - sig[bb + 1]) * frb;
          }
          var ph2 = -TWO_PI_FC * Tm;
          var cp = Math.cos(ph2), sp = Math.sin(ph2);
          var xv = xr * cp - xi * sp, yv = xr * sp + xi * cp;
          Px[m6] = xv; Py[m6] = yv; phArr[m6] = ph2;
          var ww = wts[m6];
          sumRe += ww * xv; sumIm += ww * yv;
        }
        var val;
        if (method === 'cbf' || method === 'bp') {
          /* ★ V3.6：归一化由 /M 改为 /Σw_m。
             旧写法下开"旁瓣抑制"（默认汉宁窗）会把整幅图顺带压暗
             20lg(Σw/M) = −6 dB —— 加权窗本该只改旁瓣、不改主瓣峰值，
             现在点目标的峰值电平与加权窗无关，窗只做它该做的事。 */
          val = Math.sqrt(sumRe * sumRe + sumIm * sumIm) / wsumA;
          if (method === 'bp') {
            /* ★ V3.6：跨帧累积改为**指数滑动窗**（等效最近 BP_WIN 帧的功率平均）。
               旧写法是"从开机起所有帧的功率和 ÷ 帧数"，bpCount 一路上涨，
               第 N 帧的新数据只占 1/N 权重 —— 跑几十帧之后画面基本冻住，
               ROV 再怎么走图像都不动（看着像卡死，其实是累积口径的问题）。
               取 8 帧：既能把散斑压到 ≈8 视的水平，又能跟着运动实时更新。 */
            if (!bpAcc || bpAcc.length !== nBeam * nBin) { bpAcc = new Float32Array(nBeam * nBin); bpCount = 0; }
            var key = bIdx * nBeam + aIdx, pw2 = val * val;
            if (bpCount === 0) bpAcc[key] = pw2;
            else bpAcc[key] += (pw2 - bpAcc[key]) * (1 / Math.min(BP_WIN, bpCount + 1));
            val = Math.sqrt(bpAcc[key] > 0 ? bpAcc[key] : 0);
          }
        } else if (method === 'pci' || method === 'acw') {
          /* ★ V3.6：子阵划分必须覆盖**全部** M 个阵元。
             旧写法 sub = ⌊M/4⌋ 后按 kk2·sub + j2 取值：M 不能被 4 整除时末尾
             几个阵元被漏掉（M=130 只用前 128 个）；M<4 时 sub=1 却仍循环
             kk2=0..3，会读到 Px[2]/Px[3]（越界返回 undefined → NaN），
             整幅图直接变 0 —— 默认 128 元下看不见，调到 2~3 元就暴露。
             现在按 [⌊kM/K⌋, ⌊(k+1)M/K⌋) 分区，天然覆盖全部且不留余数。 */
          var K = Math.min(4, M), csRe = 0, csIm = 0, pSum = 0, kk2, j2;
          for (kk2 = 0; kk2 < K; kk2++) {
            var i0 = Math.floor(kk2 * M / K), i1 = Math.floor((kk2 + 1) * M / K);
            var sr2 = 0, si2 = 0;
            for (j2 = i0; j2 < i1; j2++) { sr2 += Px[j2]; si2 += Py[j2]; }
            csRe += sr2; csIm += si2;
            pSum += Math.sqrt(sr2 * sr2 + si2 * si2);
          }
          var cf = pSum > 1e-20 ? Math.max(0, Math.min(1, Math.sqrt(csRe * csRe + csIm * csIm) / pSum)) : 0;
          if (method === 'pci') val = Math.sqrt(sumRe * sumRe + sumIm * sumIm) / wsumA * Math.pow(cf, J.beam.gamma);
          else val = adaptiveOut(r, nCenter) * Math.pow(cf, J.beam.acwP);
        } else {
          val = adaptiveOut(r, nCenter);
        }
        img[aIdx * nBin + bIdx] = val;
        if (bts && aIdx === J.retBeam) { bts[2 * bIdx] = sumRe / wsumA; bts[2 * bIdx + 1] = sumIm / wsumA; }
      }
    }
    if (method === 'bp') bpCount = Math.min(BP_WIN, bpCount + 1);

    var t2 = nowMs();
    var allPost = J.retAll ? sig.slice(0, 2 * M * nsamp) : null;     // 全部阵元（预处理后）
    return {
      img: img, nf: nfArr, nsamp: nsamp, fsbb: fsbb,
      chPre: chPre, chPost: chPost, beamTS: bts, retChan: J.retChan,
      allPre: allPre, allPost: allPost,
      diag: {
        nScat: nS, nScatUsed: used, sumA: sumA, tSim: t1b - t1a, tBeam: t2 - t1b, tTotal: t2 - t0,
        maxEchoAmp: maxAmp, nsamp: nsamp, M: M, nBeam: nBeam, nBin: nBin, bpCount: bpCount,
        noisePow: noisePowPre, cRef: cRef,
        /* ★ V3.6：波束形成校核用得上、且以前完全看不见的量 */
        method: method, useM: useM, adapM: adapM, ksnap: Ksnap, ksnapShort: ksnapShort,
        shadeSum: wsumA, shadePow: wsum, nfScale: nfScale, nsrc: nsrc, subLen: L
      }
    };
  }

  return {
    runPing: runPing,
    reset: function () { bpAcc = null; bpCount = 0; },
    beamPat: beamPat,
    /* 线性代数例程导出，便于离线单元测试（不影响仿真链路） */
    linalg: { chol: chol, fsolve: fsolve, bsolve: bsolve, jacobiEig: jacobiEig, hermEig: hermEig, solveSmall: solveSmall }
  };
};

/* 主线程引擎实例（Worker 不可用时退化为主线程计算） */
FLS.engineMain = FLS.EngineFactory();
