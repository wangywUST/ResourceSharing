/* =========================================================================
 * 20-env.js —— 海洋环境模型
 *   1) 声速剖面：Mackenzie(1981) 九项式经验公式 + 简化线性温跃层
 *   2) 海水吸收：Thorp 公式（dB/km，f 单位 kHz）
 *   3) 环境噪声：Knudsen 谱（−17 dB/decade，约 −5 dB/oct）+ 风速修正
 *   4) 基阵自噪声 / 通道电噪声 / ADC 量化噪声
 *   5) 海面粗糙反射系数
 * 全部单位：长度 m，频率 Hz（界面 kHz），声速 m/s，声压 μPa
 * ========================================================================= */
(function () {
  var U = FLS.U;

  /** Mackenzie(1981) 声速经验公式
   *  c = 1448.96 + 4.591T − 5.304e-2 T² + 2.374e-4 T³ + 1.340(S−35)
   *      + 1.630e-2 D + 1.675e-7 D² − 1.025e-2 T(S−35) − 7.139e-13 T D³
   *  T: °C, S: psu, D: 深度 m（静压，1 dbar ≈ 1 m） */
  FLS.Env = {};
  FLS.Env.mackenzie = function (T, S, D) {
    return 1448.96 + 4.591 * T - 5.304e-2 * T * T + 2.374e-4 * T * T * T
      + 1.340 * (S - 35) + 1.630e-2 * D + 1.675e-7 * D * D
      - 1.025e-2 * T * (S - 35) - 7.139e-13 * T * D * D * D;
  };

  /** 温度剖面（简化）：海面温度 = 设定值，随深度线性下降（默认 0.02 °C/m 温跃层） */
  FLS.Env.tempAt = function (z) {
    var T0 = FLS.P['env.temp'];
    var grad = 0.02;                       // °C/m，简化温跃层
    return T0 - grad * Math.max(0, -z);    // z 为天向坐标（水下为负）
  };

  /** 声速剖面 c(z)：z 为天向坐标（m，水下为负） */
  FLS.Env.profileAt = function (z) {
    if (FLS.P['env.sspMode'] === 'iso') return FLS.P['env.c0'];
    var T = FLS.Env.tempAt(z), S = FLS.P['env.sal'], D = Math.max(0, -z);
    return FLS.Env.mackenzie(T, S, D);
  };

  /** 路径等效声速：射线近似取两端点（及中点）平均，等声速近似取常数 */
  FLS.Env.effC = function (z1, z2) {
    if (FLS.P['env.prop'] === 'spherical') {
      return FLS.P['env.sspMode'] === 'iso' ? FLS.P['env.c0'] : FLS.Env.profileAt(z1);
    }
    return 0.5 * (FLS.Env.profileAt(z1) + FLS.Env.profileAt(z2));
  };

  /** Thorp 吸收公式：α 单位 dB/km，f 单位 kHz */
  FLS.Env.thorp = function (fkHz) {
    var f2 = fkHz * fkHz;
    return 0.11 * f2 / (1 + f2) + 44 * f2 / (4100 + f2) + 2.75e-4 * f2 + 0.003;
  };

  /** 单程吸收衰减的幅度因子（线性域）：A = 10^(−α·R/20)，α 为 dB/km，R 为 m */
  FLS.Env.absorbFactor = function (fkHz, Rm) {
    var mode = FLS.P['env.absorb'];
    if (mode === 'none') return 1;
    var a = (mode === 'manual') ? FLS.P['env.alphaManual'] : FLS.Env.thorp(fkHz);
    return Math.pow(10, -a * (Rm / 1000) / 20);
  };

  /** 环境（Knudsen）噪声谱级 dB re 1 μPa/√Hz
   *  NL(f) = NL_1kHz − 17·log10(f/1kHz) + ΔNL(风速)
   *  ΔNL(风速) = 10·log10(1 + (v/5)²)（经验拟合，风关噪声随风速上升） */
  FLS.Env.ambientNL = function (fHz) {
    var nl1k = FLS.P['env.nl1k'];
    var v = FLS.P['env.wind'];
    var dNL = 10 * Math.log10(1 + (v / 5) * (v / 5));
    return nl1k - 17 * Math.log10(Math.max(1, fHz) / 1000) + dNL;
  };

  /** 自噪声谱级（假定白谱，随频率略升） */
  FLS.Env.selfNL = function (fHz) {
    return FLS.P['env.selfNoise'] - 3 * Math.log10(Math.max(1, fHz) / 1000);
  };

  /* ------------------------------------------------------------------
   * ★ V3.3：接收链路噪声 —— 让「灵敏度 / 前置增益 / 采样位数 / 通道噪声开关」
   *         四个参数真正落到噪底上。
   *
   * 旧版的问题（三个都是"界面能改、模型不看"的空改）：
   *   ① rx.sens 只出现在链路电平核算里，噪声公式里根本没有它；
   *   ② rx.preGain 直接从 chanNoise 里减一次了事，没有标定点，
   *      也无法与 rx.sens 协同（两者本该是"同一段模拟前端的两种说法"）；
   *   ③ rx.chanNoiseOn 写着"每个阵元独立叠加噪声"，但那个 if 从来没被读过；
   *   ④ 量化噪声的满量程写死 SL−60 dB —— 与 ADC 位数挂钩，却与
   *      "灵敏度 + 前置增益"无关，于是把 ADC 从 16 位打到 8 位也几乎看不到变化。
   *
   * 现在按模拟前端的真实关系重写，并且**刻意让两个参数各管一段**：
   *
   *   ① 前置增益只影响「折算到输入的通道电噪声」：
   *          CH = chanNoise − (preGain − PRE0)
   *      标定点 PRE0 = 20 dB 处 CH ≡ env.chanNoise（默认工况与旧版逐位相同）。
   *      物理来源：后级（混频、滤波、ADC 驱动）的电噪声折算到输入端要除以
   *      前置增益，故增益越大折算值越低。前置放大器自身的输入噪声不随增益变，
   *      这一项已含在 chanNoise 的基准里，所以增益高到一定程度就"加不动"了。
   *
   *   ② 灵敏度只影响「ADC 满量程折算到声学端」：
   *          p_FS = ADC0 − sens − preGain
   *      灵敏度是"每 μPa 出多少伏"，它同时缩放信号与全部声学噪声，
   *      因此**不改变声学信噪比**（这是"灵敏度 ≠ 噪声系数"的常识），
   *      它改变的是"多大声压正好打满 ADC"——也就是量化噪声的位置。
   *      若让灵敏度也去改 CH，两个参数的效果会完全相同（一个是 −20 dB、
   *      另一个也是 −20 dB，任何 A/B 都测出同一组数），那才是真的冗余旋钮。
   * ------------------------------------------------------------------ */
  var PRE0 = 20, ADC0 = -10;

  /** 通道电噪声折算到输入端的等效谱级（只受前置增益影响） */
  FLS.Env.chanNL = function () {
    var pre = parseFloat(FLS.P['rx.preGain']); if (!isFinite(pre)) pre = PRE0;
    return FLS.P['env.chanNoise'] - (pre - PRE0);
  };

  /** ADC 满量程折算到声学端（dB re 1 μPa） */
  FLS.Env.adcFullScale = function () {
    var sens = parseFloat(FLS.P['rx.sens']); if (!isFinite(sens)) sens = -180;
    var pre = parseFloat(FLS.P['rx.preGain']); if (!isFinite(pre)) pre = PRE0;
    return ADC0 - sens - pre;
  };

  /** 接收机总噪声功率（μPa²），含环境噪声、自噪声、通道电噪声、量化噪声
   *  Bn：噪声带宽（Hz）——基带等效后取 min(信号带宽, fs_bb·0.9)
   *  SLdB：保留参数位（旧版用它当 ADC 满量程基准，V3.3 起不再使用） */
  FLS.Env.noisePower = function (fcHz, bwHz, fsbb, SLdB) {
    var Bn = Math.min(bwHz, fsbb * 0.9);
    var NL = FLS.Env.ambientNL(fcHz);
    var SELF = FLS.Env.selfNL(fcHz);
    var chOn = !!FLS.P['rx.chanNoiseOn'];
    var CH = chOn ? FLS.Env.chanNL() : -999;          // 关掉 = 该项不参与
    var pAmb = U.db2pow(NL), pSelf = U.db2pow(SELF);
    var pChan = chOn ? U.db2pow(CH) : 0;
    var P = (pAmb + pSelf + pChan) * Bn;               // μPa²
    var bits = parseFloat(FLS.P['rx.bits']) || 16;
    var fsDb = FLS.Env.adcFullScale();
    var FS = U.db2lin(fsDb);
    var qn = FS * FS / (12 * Math.pow(2, 2 * bits));
    P += qn;
    /* 各分项占总噪声的比例（线性）——用于界面标出"当前由谁主导" */
    var tot = pAmb * Bn + pSelf * Bn + pChan * Bn + qn;
    return {
      P: P, NLdb: NL, SELFdb: SELF, CHdb: CH, CHon: chOn, Bn: Bn,
      quantDb: U.pow2db(qn), qn: qn, fsDb: fsDb, bits: bits,
      pAmb: pAmb * Bn, pSelf: pSelf * Bn, pChan: pChan * Bn,
      frac: {
        amb: (pAmb * Bn) / tot, self: (pSelf * Bn) / tot,
        chan: (pChan * Bn) / tot, quant: qn / tot
      }
    };
  };

  /** 海面反射系数（含粗糙度损失），返回带符号幅反射系数（压力释放面取负） */
  FLS.Env.surfaceRefl = function (fcHz, grazingRad) {
    var R0 = FLS.P['env.surfRefl'];
    var rough = FLS.P['env.surfRough'];
    var c = FLS.Env.profileAt(0);
    var lam = c / fcHz;
    var k = 2 * Math.PI / lam;
    var h = 0.5 * rough;                       // 等效海面起伏 rms（m）
    var ang = Math.max(1e-3, Math.sin(Math.PI / 2 - Math.abs(grazingRad))); // 相对海面法线的正弦
    var rho = Math.exp(-2 * Math.pow(k * h * ang, 2));
    return -R0 * rho;
  };

  /** 海底反射系数（由底质类型给出经验值） */
  FLS.Env.bottomRefl = function (mat) {
    var m = { mud: 0.35, sand: 0.55, gravel: 0.65, rock: 0.8, coral: 0.7 };
    return m[mat] !== undefined ? m[mat] : 0.5;
  };

  /** 底质散射参数：μ（Lambert 散射系数）、等效粗糙度 */
  FLS.Env.bottomMu = function (mat) {
    // 典型值：泥 −30 dB，砂 −25 dB，砾石 −20 dB，岩石 −18 dB，珊瑚 −16 dB
    var m = { mud: -30, sand: -25, gravel: -20, rock: -18, coral: -16 };
    return U.db2pow(m[mat] !== undefined ? m[mat] : -25);
  };
})();
