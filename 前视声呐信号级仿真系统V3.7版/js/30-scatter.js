/* =========================================================================
 * 30-scatter.js —— 海底地形库 / 水下目标库 / 面元化散射模型
 *   1) 10 种典型海底地形（高程场 d(x,y)：正值 = 深度，海面 z=0，海底 z=−d）
 *   2) 地形布尔叠加（并集 / 交集 / 差集）—— 高程域近似布尔运算
 *   3) 12 种水下目标三维模型（三角面片）+ 材料目标强度预设
 *   4) 散射面元抽取：海底分层随机抽样面元 / 目标三角面元
 * 散射记录（Float32Array，stride=11）：
 *   [x, y, z, nx, ny, nz, ampCoef, model, rough, pathType, phaseOff]
 *   ampCoef = sqrt(σ0·dA) 中的非角度部分（见引擎角度因子），model:0 Lambert/1 Kirchhoff/2 经验
 *   pathType: 0 直达, 1 海面镜像(发射支路), 2 海面镜像(接收支路), 3 海底镜像(发射), 4 海底镜像(接收)
 *   phaseOff: 亚波长粗糙度引入的随机相位（0~2π），V1.4 新增，见 seafloor() 的说明
 *
 * ★ V1.4：stride 由 10 扩到 11 —— 少一个随机相位，海底混响就退化成"相干光栅"，
 *   而不是 Rayleigh 散斑场。这是 V1.0~V1.3 成像"糊成一团"的根因之一。
 * ========================================================================= */
(function () {
  var U = FLS.U, DEG = U.DEG;

  /* ---------------------------------------------------- 确定性随机 / 噪声 */
  function hash2(i, j, s) {
    var n = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s | 0, 1274126177);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  /** 二维值噪声（周期格点，值域 0~1） */
  function vnoise(x, y, seed) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u1 = smooth(xf), u2 = smooth(yf);
    var a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
    var c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
    return (a * (1 - u1) + b * u1) * (1 - u2) + (c * (1 - u1) + d * u1) * u2;
  }
  /** 分形（fBm）噪声，值域约 −1~1；H 为 Hurst 指数（H = 3 − 分形维数 D） */
  function fbm(x, y, H, oct, seed) {
    var amp = 1, f = 1, sum = 0, norm = 0;
    for (var o = 0; o < oct; o++) {
      sum += amp * (vnoise(x * f, y * f, seed + o * 101) * 2 - 1);
      norm += amp;
      amp *= Math.pow(2, -H); f *= 2;
    }
    return sum / norm;
  }

  /** 线段 S→P 是否与轴对齐盒相交（slab 法，参数限定在 S 与 P 之间） */
  function segHitsBox(sx, sy, sz, px, py, pz, b) {
    var s = [sx, sy, sz], d = [px - sx, py - sy, pz - sz];
    var mn = [b.e0, b.n0, b.u0], mx = [b.e1, b.n1, b.u1];
    var t0 = 0, t1 = 1;
    for (var i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (s[i] < mn[i] || s[i] > mx[i]) return false;
        continue;
      }
      var inv = 1 / d[i], lo = (mn[i] - s[i]) * inv, hi = (mx[i] - s[i]) * inv;
      if (lo > hi) { var t = lo; lo = hi; hi = t; }
      if (lo > t0) t0 = lo;
      if (hi < t1) t1 = hi;
      if (t0 > t1) return false;
    }
    return t1 > 0.02 && t0 < 0.985;   // 交点须真正落在两点之间（不贴两端）
  }

  /* ---------------------------------------------------- 海底地形库（10 种）
   * ★ V3.2：深度模型从「每层自带绝对深度」改为「基准面 + 零均值起伏」。
   *
   *   旧模型（V3.1 及以前）：每层 f_i 返回一个**绝对深度**（如 200 m），
   *   合成取最浅 h = min_i f_i。问题出在"取最浅"上 —— 叠一层山脊，
   *   全场上只有"变浅"没有"变深"，平均水深被一层层往上推；
   *   叠 5 层之后海床整体抬到 190 m 出头，与用户设定的 200 m 对不上，
   *   而且越加地形越浅，最后连 60 m 量程都照不到。
   *
   *   新模型：每层只描述**相对基准面的起伏** s_i(E,N)（m，正 = 更深），
   *   合成再套一个全局基准深度 H₀：
   *
   *       h(E,N) = H₀ + [ min_i (b_i + s_i(E,N)) − s̄ ]
   *
   *     H₀ —— 「海底平均深度」参数（terr.base，默认 200 m），随时可改；
   *     b_i —— 该层的「层深度偏移」（bias，默认 0 = 贴合基准面）；
   *     s̄  —— 当前地形组合**在足迹上的面积平均起伏**（由 Terrain.updateDc 算）。
   *           减去它，叠加多少层都不会把平均水深拖走 —— 这正是用户要的
   *           "基本保持海底的平均水深为默认设置的水深"。
   *
   *   于是：
   *     · 打开系统 = 一份 flat 层（s≡0）→ h ≡ H₀，平坦均质海底；
   *     · 加山脊 = 山脊处 −height 的隆起、周围按 s̄ 做亚米级下沉补偿，
   *       平均水深仍是 H₀（补偿量随面积占比变，占总量的 0.1%~1%）；
   *     · 改 H₀ = 整张图整体平移一个常数，**不需要重烘焙**（见 compose）。
   *
   *   ★ 各层的 s 只依赖形状参数，不再读 depth。地形库里的 10 种地形因此
   *     "没有自己的深度"，深度只有一个出处 —— 这是"参数不再互相矛盾"的
   *     基本前提（同一件事不允许有两个可独立设置的值）。 */

  /** 全局基准深度（m）。读写 FLS.P['terr.base']，这里只做兜底。 */
  function baseDepth() {
    var v = parseFloat(FLS.P['terr.base']);
    return (isFinite(v) && v > 0) ? v : 200;
  }

  var T = {
    flat: {
      name: '平坦均质海底',
      params: [],
      f: function () { return 0; }
    },
    slope: {
      name: '缓坡倾斜海底',
      params: [
        { k: 'grade', l: '坡度', u: '°', min: 0.1, max: 30, def: 5, step: 0.1 },
        { k: 'dir', l: '倾斜方向', u: '°', min: -180, max: 180, def: 0, step: 1 }
      ],
      f: function (p, x, y) {
        var a = p.dir * DEG;
        return Math.tan(p.grade * DEG) * (x * Math.cos(a) + y * Math.sin(a));
      }
    },
    ridge: {
      name: '山脊地形',
      params: [
        { k: 'height', l: '脊高', u: 'm', min: 0.5, max: 200, def: 8, step: 0.5 },
        { k: 'width', l: '脊宽', u: 'm', min: 1, max: 300, def: 12, step: 0.5 },
        { k: 'dir', l: '走向', u: '°', min: -180, max: 180, def: 0, step: 1 }
      ],
      f: function (p, x, y) {
        var a = p.dir * DEG;
        var t = -x * Math.sin(a) + y * Math.cos(a);
        return -p.height * Math.exp(-(t / p.width) * (t / p.width));
      }
    },
    trench: {
      name: '海沟凹陷地形',
      params: [
        { k: 'deep', l: '下凹深度', u: 'm', min: 0.5, max: 300, def: 10, step: 0.5 },
        { k: 'width', l: '沟宽', u: 'm', min: 1, max: 300, def: 10, step: 0.5 },
        { k: 'dir', l: '走向', u: '°', min: -180, max: 180, def: 0, step: 1 }
      ],
      f: function (p, x, y) {
        var a = p.dir * DEG;
        var t = -x * Math.sin(a) + y * Math.cos(a);
        return p.deep * Math.exp(-(t / p.width) * (t / p.width));
      }
    },
    dunes: {
      name: '沙丘 / 沙波海底',
      params: [
        { k: 'amp', l: '波高', u: 'm', min: 0.05, max: 20, def: 1.2, step: 0.05 },
        { k: 'wavelen', l: '波长', u: 'm', min: 1, max: 200, def: 12, step: 0.5 },
        { k: 'dir', l: '沙纹走向', u: '°', min: -180, max: 180, def: 90, step: 1 }
      ],
      f: function (p, x, y) {
        var a = p.dir * DEG;
        var t = x * Math.cos(a) + y * Math.sin(a);
        return -p.amp * Math.sin(2 * Math.PI * t / p.wavelen);
      }
    },
    gravel: {
      name: '碎石砾石粗糙海底',
      params: [
        { k: 'rms', l: '起伏 RMS', u: 'm', min: 0.01, max: 20, def: 0.6, step: 0.01 },
        { k: 'corr', l: '相关长度', u: 'm', min: 0.5, max: 200, def: 4, step: 0.5 }
      ],
      f: function (p, x, y, seed) { return p.rms * fbm(x / p.corr, y / p.corr, 0.5, 5, seed || 0); }
    },
    mud: {
      name: '泥质平滑海底',
      params: [
        { k: 'rms', l: '起伏 RMS', u: 'm', min: 0, max: 5, def: 0.08, step: 0.01 },
        { k: 'corr', l: '相关长度', u: 'm', min: 1, max: 500, def: 40, step: 1 }
      ],
      f: function (p, x, y, seed) { return p.rms * fbm(x / p.corr, y / p.corr, 0.8, 3, seed || 0); }
    },
    reef: {
      name: '岩礁凸起海底',
      params: [
        { k: 'height', l: '礁体高度', u: 'm', min: 0.2, max: 60, def: 2.5, step: 0.1 },
        { k: 'size', l: '礁体尺度', u: 'm', min: 0.5, max: 60, def: 3, step: 0.1 },
        { k: 'density', l: '礁体密度', u: '/100m²', min: 0.1, max: 20, def: 2, step: 0.1 }
      ],
      f: function (p, x, y, seed) {
        var d = 0, cell = 20, s = seed || 0;
        var i0 = Math.floor(x / cell) - 1, j0 = Math.floor(y / cell) - 1;
        for (var i = i0; i <= i0 + 2; i++) {
          for (var j = j0; j <= j0 + 2; j++) {
            var cnt = Math.max(1, Math.round(p.density * cell * cell / 100));
            for (var k = 0; k < cnt; k++) {
              var rx = hash2(i, j * 31 + k, s), ry = hash2(i * 17 + k, j, s + 7), rh = hash2(i + k, j + k, s + 13);
              var cx = (i + rx) * cell, cy = (j + ry) * cell;
              var dx = (x - cx) / p.size, dy = (y - cy) / p.size;
              var hh = p.height * (0.4 + 0.6 * rh);
              d -= hh * Math.exp(-(dx * dx + dy * dy));
            }
          }
        }
        return d;
      }
    },
    terrace: {
      name: '阶梯状台地海底',
      params: [
        { k: 'stepH', l: '台阶高度', u: 'm', min: 0.2, max: 50, def: 3, step: 0.1 },
        { k: 'stepW', l: '台阶宽度', u: 'm', min: 1, max: 200, def: 15, step: 0.5 },
        { k: 'dir', l: '台阶走向', u: '°', min: -180, max: 180, def: 0, step: 1 }
      ],
      f: function (p, x, y) {
        var a = p.dir * DEG;
        var t = x * Math.cos(a) + y * Math.sin(a);
        return p.stepH * Math.floor(t / p.stepW);
      }
    },
    fractal: {
      name: '复合起伏海底',
      params: [
        { k: 'rms', l: '起伏 RMS', u: 'm', min: 0.05, max: 60, def: 2.5, step: 0.05 },
        { k: 'fdim', l: '分形维数 D', u: '', min: 2.0, max: 2.95, def: 2.4, step: 0.01 },
        { k: 'corr', l: '特征尺度', u: 'm', min: 1, max: 500, def: 30, step: 1 }
      ],
      f: function (p, x, y, seed) {
        var H = 3 - p.fdim;
        return p.rms * fbm(x / p.corr, y / p.corr, H, 6, seed || 0);
      }
    }
  };
  /* 每一层都补一个「层深度偏移」—— 它**不是**该层自己的绝对深度，
   * 而是"这一层整体相对基准面上下挪多少"。默认 0 就贴在基准面上，
   * 想让某层坐在浅滩上（如礁石场整体抬高 5 m）填 −5 即可。
   * 之所以做成统一的一行而不写进各类型的 params 字面量：10 种地形共用同一个
   * 含义，写 10 遍只会出现 10 个不一致的措辞与取值范围。 */
  Object.keys(T).forEach(function (k) {
    T[k].params.push({
      k: 'bias', l: '层深度偏移', u: 'm', min: -300, max: 300, def: 0, step: 0.5,
      h: '这一层整体相对「海底平均深度」上下平移多少（负 = 更浅）。默认 0 = 贴合基准面；' +
        '想让礁石场坐在比周围浅 5 m 的浅滩上就填 −5。这是"层"的偏移，' +
        '海底总深度由页面顶部的「海底平均深度」统一决定。'
    });
  });

  /* ====================================================================
   * V3.1：海底「栅格化烘焙」
   * --------------------------------------------------------------------
   * 由来：V3.0 及以前，求一次水深要把**所有**地形层解析求值一遍
   *   d(x,y) = min_i f_i(x,y; params_i, seed_i)
   * 层数一多，compose() 就成了全系统最热的函数 —— 三维网格每重建一次调用
   * (n+1)² 次（n=220 即 48 841 次），每帧海底面元化再调用数万次；而 reef /
   * gravel / fractal 这类层单次求值要跑几十次 exp / hash。层数线性增长、
   * 每帧几十万次求值，就是"越加地形越卡"的根因。
   *
   * 做法：地形在属性面板里点「确认」之后，把已确认的那一批层**一次性栅格化**
   * 成一张规则网格 —— 深度图（Float32）+ 底质图（Uint8），就像把矢量图
   * 栅格化成位图。此后 compose() 在网格覆盖范围内只做双线性插值查表：
   *   · 单次代价与层数**无关**（O(1) 而不是 O(N)）；
   *   · 数据量固定：401×401 格 = 深度 643 KB + 底质 161 KB ≈ 0.8 MB，
   *     再往里加地形也不会继续变大（只是把同样这些格子重算一遍）。
   *
   * 三种状态，语义必须分清：
   *   ① pending === true  待确认层：只参与实时预览，**不进栅格**；
   *   ② pending !== true  已融入层：是栅格的来源，改参数会自动重烘焙
   *      （已经确认过了，不必再点一次"确认"）；
   *   ③ 网格覆盖范围之外：回退到解析求值 —— 结果与栅格一致，只是慢一点。
   *      因此任何时刻都不会因为"出了栅格"而算错，烘焙纯属加速手段。
   * ==================================================================== */
  /** 栅格目标格距（m）。取 1.2 m 是为了与三维显示网格对齐：
   *  显示网格 260 m 视口 / 220 边 = 1.18 m 格距，两者基本一致，
   *  于是显示端从栅格取值几乎不插值，不会把沙波脊线读成折线。 */
  var BAKE_CELL = 1.2;
  /* 单方向格数下限 / 上限，以及**总格点预算**。
     预算这一项是 V3.4 才有的：旧版只夹单方向 [160, 420]，于是
     - 长边被 NMAX 夹住后格距被迫变大，短边按同一格距铺出去就会**溢出边界**
       （实测 lenX=600 / lenY=150：nx 夹到 420 → cell 1.43 m，ny=160 铺出去
        228 m，比设定的 150 m 多出 78 m）；
     - 短边被 NMIN 抬到 160 又反过来逼粗长边的格距。
     两头夹取互相拉扯，最终两个方向都盖不准。现在改成"先按预算定格距、
     再由格距定格数"，只在第二步收敛时用一次绝对下限，两个方向都精确。 */
  var BAKE_NMIN = 24, BAKE_NMAX = 640, BAKE_BUDGET = 120000;
  /** ★ V3.4：栅格尺寸由「海底长 × 宽」（terr.lenX / terr.lenY）决定。
   *
   *  旧版写死为 max(260, min(900, rmax×2.6))，即"量程越大海底越大"。
   *  这是把两个本来独立的自由度（场景多大 / 看多远）捆在了一起：
   *  用户只想把量程从 60 m 拉到 120 m，结果整片海底被静默放大到 312 m，
   *  海底的绝对尺度、地形起伏的空间频率全都跟着变 —— 这是"改一个量、
   *  另一个量偷偷跟着变"，比空改更难发现。
   *  现在长宽是显式参数（默认 300 × 300 m），与量程完全解耦。
   *
   *  定尺寸的次序（两步）：
   *    ① 格距 cell = max(目标格距 BAKE_CELL, √(lenX·lenY / 格点预算))
   *       第二项是"面积太大就整体放粗"，它保证总格点不超预算；
   *    ② 格数 n = ⌈边长 / cell⌉，各方向独立夹在 [NMIN, NMAX]，
   *       然后**按夹取后的结果重算 cell = max(lenX/nx, lenY/ny) 并再取一次格数**。
   *       重算这一步是关键的收敛：cell 取两方向的较大者，于是
   *       nx·cell ≥ lenX 且 ny·cell ≥ lenY —— 两个方向都**至少**盖满，绝不欠覆盖。
   *
   *  默认 300 × 300 m → cell = 1.2 m → 250 × 250 → 251×251 = 63 001 格（约 302 KB）。
   *  600 × 150 m      → cell = 1.2 m → 500 × 125 → 501×126 = 63 126 格（同样量级）。 */
  function bakeGeom() {
    var lenX = Math.max(20, Math.min(4000, parseFloat(FLS.P['terr.lenX']) || 300));
    var lenY = Math.max(20, Math.min(4000, parseFloat(FLS.P['terr.lenY']) || 300));
    var cell = Math.max(BAKE_CELL, Math.sqrt(lenX * lenY / BAKE_BUDGET));
    var nx = Math.min(BAKE_NMAX, Math.max(BAKE_NMIN, Math.ceil(lenX / cell)));
    var ny = Math.min(BAKE_NMAX, Math.max(BAKE_NMIN, Math.ceil(lenY / cell)));
    /* 收敛：格距取两方向所需值的较大者，格数按它再取一次（下限 4 只是防 0）。
       cell ≥ lenX/NMAX 且 ≥ lenY/NMAX，所以重取后的格数自动不超 NMAX。 */
    cell = Math.max(lenX / nx, lenY / ny);
    nx = Math.max(4, Math.ceil(lenX / cell));
    ny = Math.max(4, Math.ceil(lenY / cell));
    return { lenX: lenX, lenY: lenY, nx: nx, ny: ny, cell: cell,
             span: Math.max(lenX, lenY) };      // span：旧接口兼容（三维刻度用最大值）
  }
  /** 一份地形层都没有时的兜底底质（深度由全局基准深度给出，见 baseDepth） */
  var DEF_MAT = { bmat: 'sand', smodel: 3, rough: 0.1 };

  /** ★ V3.2：判断"这一层就是基准面本身"。
   *
   *  合成规则是 min（取最浅）。平坦层的起伏恒为 0、层偏移也为 0，它若参与取小，
   *  就等于给整片海床加了一条"不得低于基准面"的硬地板 —— 于是**所有朝下走的
   *  地形全部失效**：海沟（deep=+10）被 min(0, 10) 吃掉，台地的下切、缓坡的下坡侧
   *  也一样。用户的做法是"在平坦海底上叠加其他海底地形"，所以平坦层是**底**，
   *  不是"竞争的层"：只要场景里还有别的层，它就不该参与取小。
   *
   *  带非零层偏移的平坦层仍然算真层（那是"整片抬高/压低的平台"，是用户的明确意图）。 */
  function isRefLayer(t) {
    if (!t || t.type !== 'flat') return false;
    return !(parseFloat(t.params && t.params.bias) || 0);
  }
  /** 场景里有没有"真"地形层（非基准面） */
  function hasRealLayer(list) {
    for (var i = 0; i < list.length; i++) if (!isRefLayer(list[i])) return true;
    return false;
  }

  /** 把「已融入」的全部地形层栅格化。cx/cy = 栅格中心（ENU）。
   *  没有任何已融入层时返回 null（compose 直接把起伏当 0）。
   *
   *  ★ V3.2：栅格里存的是**起伏量**（相对基准面，正 = 更深），不是绝对深度。
   *    这样做的好处是「改平均水深」变成给整张图加一个常数，不必重烘焙 ——
   *    用户拖一下平均深度滑块，海底立刻整体下沉/上浮，0 毫秒代价。
   *    （若存绝对深度，改一次平均深度就得重算 4.75 万格 × 层数 ≈ 150 ms。） */
  function bakeGrid(cx, cy) {
    var list = FLS.state.terrains;
    var src = [];
    for (var m = 0; m < list.length; m++) if (!list[m].pending) src.push(list[m]);
    if (!src.length) return null;
    /* V3.2：平坦基准层不参与取最浅（见 isRefLayer）。只剩基准层时仍要留一份，
     * 因为它的 bmat / smodel 决定了海床底质 —— 砂底不该因为"没加地形"就丢成 DEF_MAT。 */
    if (src.length > 1) {
      var _real = [];
      for (var m1 = 0; m1 < src.length; m1++) if (!isRefLayer(src[m1])) _real.push(src[m1]);
      if (_real.length) src = _real;
    }
    /* V3.2：整张栅格里只有基准层（起伏恒为 0）。这时栅格**不代表任何地形**，
     * 只是个"深度 0 的地板"。若让 compose 照常查这张表，它会先拿到 sv = 0，
     * 于是待确认层里凡是"变深"（s > 0）的部分全被 min 挡掉 —— 海沟、台地下切、
     * 缓坡的下坡侧一律失效，平均水深还会朝"变浅"偏。必须让 compose 认出这张表
     * 是空的，直接走解析分支。 */
    var refOnly = true;
    for (var m2 = 0; m2 < src.length; m2++) if (!isRefLayer(src[m2])) { refOnly = false; break; }
    var gm = bakeGeom();
    var nx = gm.nx, ny = gm.ny, w = nx + 1, h = ny + 1, cell = gm.cell;
    var hx = gm.lenX / 2, hy = gm.lenY / 2;
    var dev = new Float32Array(w * h);
    var mi = new Uint8Array(w * h);
    var mats = [], matIx = {}, nm = src.length;
    /* 把 f / params / seed 先摊平到三个数组里：内层循环每格要跑 nm 次，
     * 每省一次 `T[...].f` 的属性链查找，16 万格 × 5 层就是几百万次 —— 实测
     * 这一手把烘焙从 628 ms 降到约 190 ms（默认 260 m 跨度）。 */
    var F0 = [], P0 = [], S0 = [], B0 = [];
    for (var q = 0; q < nm; q++) {
      F0.push(T[src[q].type].f); P0.push(src[q].params); S0.push(src[q].seed || 0);
      B0.push(parseFloat(src[q].params && src[q].params.bias) || 0);
    }
    for (var j = 0; j <= ny; j++) {
      var y = cy - hy + j * cell;
      for (var i = 0; i <= nx; i++) {
        var x = cx - hx + i * cell;
        var sv = B0[0] + F0[0](P0[0], x, y, S0[0]), dom = 0;
        for (var k = 1; k < nm; k++) {
          var sk = B0[k] + F0[k](P0[k], x, y, S0[k]);
          if (sk < sv) { sv = sk; dom = k; }               // 叠加：取最浅（起伏最小）
        }
        var o = src[dom];
        var bmat = o.bmat || 'sand';
        var smod = o.smodel === undefined ? 0 : o.smodel;
        var rgh = o.rough === undefined ? 0.05 : o.rough;
        var key = bmat + '|' + smod + '|' + rgh;
        var ix = matIx[key];
        if (ix === undefined) {
          ix = mats.length;                                // 材质表最多 256 项（Uint8）
          if (ix > 255) ix = 255;
          matIx[key] = ix;
          mats.push({ bmat: bmat, smodel: smod, rough: rgh });
        }
        var pp = j * w + i;
        dev[pp] = isFinite(sv) ? sv : 0;
        mi[pp] = ix;
      }
    }
    return {
      cx: cx, cy: cy, lenX: gm.lenX, lenY: gm.lenY,
      nx: nx, ny: ny, w: w, h: h, cell: cell, span: gm.span, n: nx,
      dev: dev, mi: mi, mats: mats,
      nSrc: nm, refOnly: refOnly, names: src.map(function (o) { return o.name; }), t: Date.now()
    };
  }

  /** 当前地形组合在足迹上的面积平均起伏 s̄（相对基准面，正 = 更深）。
   *
   *  为什么必须有这一步：合成是 min（取最浅），而 min 是**非线性的**。
   *  若每层都是零均值起伏，min_i s_i 的平均值仍会偏负（偏浅），
   *  量级约 0.5σ（σ 为最浅两层的起伏标准差）；若某层只"凸"不"凹"
   *  （山脊、礁石这类），平均偏差更大。不校正的话，加一层 8 m 高的山脊
   *  会把整片基准面抬高 0.7~1 m，加五层就偏到 3~5 m —— 正是用户说的
   *  "越叠越高"。
   *
   *  实现：在栅格足迹上做 25×25 的规则采样（625 点）取平均。
   *  为什么不用解析积分：10 种地形里有 3 种靠 hash 噪声 / 随机礁体，
   *  没有闭式均值；而 625 点的采样误差对 260 m 足迹已小于 1 cm。
   *  代价：≤1 ms（最重的 reef 层），只在"地形变了"时跑一次。
   *
   *  ★ 只在编辑时调用，绝不进逐点查询的路径 —— 见 compose 里的注释。 */
  function meanDev() {
    var list = FLS.state.terrains;
    if (!list.length) return 0;
    var b = FLS.state.terrainBake;
    var cx = b ? b.cx : (FLS.state.rov ? FLS.state.rov.x : 0);
    var cy = b ? b.cy : (FLS.state.rov ? FLS.state.rov.y : 0);
    var gm = bakeGeom(), hx = gm.lenX / 2, hy = gm.lenY / 2, N = 24;
    var stepX = gm.lenX / N, stepY = gm.lenY / N;
    /* V3.2：与 bakeGrid / compose 用**同一套**取小规则（排除平坦基准层），
     * 否则"统计用的均值"和"实际合成出来的海床"会来自两条不同的式子 —— 那就白算了。 */
    var use = list;
    if (list.length > 1) {
      var _r = [];
      for (var q0 = 0; q0 < list.length; q0++) if (!isRefLayer(list[q0])) _r.push(list[q0]);
      if (_r.length) use = _r;
    }
    var nm = use.length, F0 = [], P0 = [], S0 = [], B0 = [];
    for (var q = 0; q < nm; q++) {
      F0.push(T[use[q].type].f); P0.push(use[q].params); S0.push(use[q].seed || 0);
      B0.push(parseFloat(use[q].params && use[q].params.bias) || 0);
    }
    var sum = 0, cnt = 0;
    for (var j = 0; j <= N; j++) {
      var y = cy - hy + j * stepY;
      for (var i = 0; i <= N; i++) {
        var x = cx - hx + i * stepX;
        var sv = B0[0] + F0[0](P0[0], x, y, S0[0]);
        for (var k = 1; k < nm; k++) {
          var sk = B0[k] + F0[k](P0[k], x, y, S0[k]);
          if (sk < sv) sv = sk;
        }
        if (isFinite(sv)) { sum += sv; cnt++; }
      }
    }
    return cnt ? sum / cnt : 0;
  }

  FLS.Terrain = {
    TYPES: T,
    LIST: Object.keys(T).map(function (k) { return { id: k, name: T[k].name }; }),
    defaultParams: function (id) {
      var o = {};
      T[id].params.forEach(function (p) { o[p.k] = p.def; });
      return o;
    },
    /* ---- 栅格化烘焙的对外接口 ---- */
    BAKE_CELL: BAKE_CELL,
    /** 当前该用的栅格几何（跨度 / 边数 / 格距），供界面显示与测试读取 */
    bakeGeom: bakeGeom,
    /** V3.2：全局基准深度（海底平均深度） */
    base: baseDepth,
    /** V3.2：重算"面积平均起伏"并写回 state.terrainDc。
     *  凡是地形层集合或其参数变化（增 / 删 / 改 / 确认 / 载入）都要调用一次。 */
    updateDc: function () {
      FLS.state.terrainDc = meanDev();
      return FLS.state.terrainDc;
    },
    /** 只做统计（不写回）：给界面显示"实测平均水深"用 */
    measure: function () {
      var b = bakeGeom(), hx2 = b.lenX / 2, hy2 = b.lenY / 2, N = 24;
      var stX = b.lenX / N, stY = b.lenY / N;
      var cx = FLS.state.rov ? FLS.state.rov.x : 0, cy = FLS.state.rov ? FLS.state.rov.y : 0;
      var H0 = baseDepth(), dc = FLS.state.terrainDc || 0;
      var lo = Infinity, hi = -Infinity, sum = 0, cnt = 0;
      for (var j = 0; j <= N; j++) {
        for (var i = 0; i <= N; i++) {
          var d = FLS.Terrain.compose(cx - hx2 + i * stX, cy - hy2 + j * stY).d;
          if (!isFinite(d)) continue;
          sum += d; cnt++;
          if (d < lo) lo = d;
          if (d > hi) hi = d;
        }
      }
      return { mean: cnt ? sum / cnt : H0, min: lo, max: hi, base: H0, dc: dc };
    },
    /** 以 (cx,cy) 为中心重新烘焙；返回 bake 对象（无已融入层时为 null） */
    bake: function (cx, cy) {
      FLS.state.terrainBake = bakeGrid(cx, cy);
      FLS.Terrain.updateDc();
      return FLS.state.terrainBake;
    },
    /** 栅格是否覆盖 (x,y)（含 1 格余量，边界插值需要右/上邻格） */
    covers: function (x, y) {
      var b = FLS.state.terrainBake;
      if (!b) return false;
      return Math.abs(x - b.cx) <= b.lenX / 2 && Math.abs(y - b.cy) <= b.lenY / 2;
    },
    /** 若栅格缺失、尺寸变了、或中心漂出余量，就地重烘焙；否则原样返回。
     *  余量取 18% 跨度：默认 260 m 跨度即 47 m，ROV 在这个范围内跑动不必反复
     *  烘焙；超出后一次性重烘焙，之后又恢复成 O(1) 查表。 */
    ensureBake: function (cx, cy) {
      var b = FLS.state.terrainBake, gm = bakeGeom();
      if (b && b.nx === gm.nx && b.ny === gm.ny && b.lenX === gm.lenX && b.lenY === gm.lenY &&
        Math.abs(cx - b.cx) <= gm.lenX * 0.18 &&
        Math.abs(cy - b.cy) <= gm.lenY * 0.18) return b;
      return FLS.Terrain.bake(cx, cy);
    },
    /** 组合深度场：返回 {d, idx, mat}
     *  d —— 水深（m，正=深）；idx —— 主导层在 state.terrains 里的下标
     *       （来自栅格时为 −1）；mat —— {bmat, smodel, rough}，已解析好，
     *       调用方不必再按 idx 反查（栅格格点的主导层根本不在 terrains 里）。
     *
     *  ★ V3.0：布尔运算撤除，所有地形一律叠加（取较浅）。
     *  ★ V3.1：已融入的层改为查栅格（双线性插值），只有待确认层才解析求值。
     *  ★ V3.2：深度 = 全局基准 + (起伏 − 面积平均起伏)。
     *    最后那一步减法就是"平均水深守恒"：无论叠多少层、每层只凸不凹，
     *    整片海床的平均深度都钉在 terr.base 上。 */
    compose: function (x, y) {
      var list = FLS.state.terrains;
      var b = FLS.state.terrainBake;
      var sv = Infinity, mat = null, dom = -1;
      /* ---- ① 已融入的地形：命中栅格就双线性查表（O(1)，与层数无关） ---- */
      if (b && !b.refOnly) {
        var nx2 = b.nx, ny2 = b.ny, w = b.w || (nx2 + 1), hx3 = b.lenX / 2, hy3 = b.lenY / 2;
        var fx = (x - b.cx + hx3) / b.cell, fy = (y - b.cy + hy3) / b.cell;
        // 注意写成 `fx >= 0 && …` 而不是取反：fx/fy 为 NaN 时四个比较全 false，
        // 自然落到下面的解析分支，不会把 NaN 带进深度
        if (fx >= 0 && fy >= 0 && fx <= nx2 && fy <= ny2) {
          var i = fx | 0, j = fy | 0;
          if (i >= nx2) i = nx2 - 1;
          if (j >= ny2) j = ny2 - 1;
          var tx = fx - i, ty = fy - j;
          var a = j * w + i, c = a + w;
          var s0 = b.dev[a] + (b.dev[a + 1] - b.dev[a]) * tx;
          var s1 = b.dev[c] + (b.dev[c + 1] - b.dev[c]) * tx;
          sv = s0 + (s1 - s0) * ty;
          // 底质是离散量，不能插值：取最近的一个格点
          mat = b.mats[b.mi[a + (tx < 0.5 ? 0 : 1) + (ty < 0.5 ? 0 : w)]] || null;
        }
      }
      /* ---- ② 栅格没覆盖（或还没烘焙）→ 解析求值已融入的层，结果完全一致 ---- */
      /* V3.2：只要场景里还有真地形层，平坦基准层就不参与取小（见 isRefLayer）。
       * 否则"海沟 / 下切"这类朝下走的地形会被 min(0, …) 整个吃掉。 */
      var hr = hasRealLayer(list);
      if (sv === Infinity) {
        for (var m = 0; m < list.length; m++) {
          var tm = list[m];
          if (tm.pending) continue;
          if (hr && isRefLayer(tm)) continue;
          var sm = (parseFloat(tm.params && tm.params.bias) || 0) + T[tm.type].f(tm.params, x, y, tm.seed || 0);
          if (sm < sv) { sv = sm; mat = tm; dom = m; }     // 叠加：取最浅
        }
      }
      /* ---- ③ 待确认层：叠加，实时预览，不入栅格 ---- */
      for (var k = 0; k < list.length; k++) {
        var t = list[k];
        if (!t.pending) continue;
        if (hr && isRefLayer(t)) continue;
        var si = (parseFloat(t.params && t.params.bias) || 0) + T[t.type].f(t.params, x, y, t.seed || 0);
        if (si < sv) { sv = si; mat = t; dom = k; }
      }
      /* 排除掉基准层之后一个已融入的层都没剩下（栅格又恰好只含基准层）：
       * 把基准层请回来 —— 它给的是 bmat / smodel，起伏仍是 0。
       * ★ 必须放在待确认层之后：否则这个 0 就成了地板，又把"变深"的那一半挡住。 */
      if (sv === Infinity) {
        for (var m0 = 0; m0 < list.length; m0++) {
          var t0 = list[m0];
          if (t0.pending || !isRefLayer(t0)) continue;
          var s0b = parseFloat(t0.params && t0.params.bias) || 0;
          if (s0b < sv) { sv = s0b; mat = t0; dom = m0; }
        }
      }
      /* 一份地形都没有（连栅格也没有）：起伏取 0，即一片基准平面。
       * 海总有底 —— 与其给出 0 或 NaN 让吸收项发散，不如给一个明确的默认值。 */
      if (sv === Infinity) { sv = 0; mat = DEF_MAT; }
      /* ---- V3.2：套上基准深度并扣掉面积平均起伏 ---- */
      var d = baseDepth() + sv - (FLS.state.terrainDc || 0);
      /* ---- V1.2 手工编辑层：叠加在程序化地形之上的笔刷偏移 ----
       * 采用有限支撑的钟形权函数（升余弦 / 截断高斯），笔刷半径外严格为 0，
       * 这样编辑只影响局部，且可按半径快速跳过，不会拖慢逐面元的深度查询。
       * amp > 0 → 抬高海床（深度变小）；amp < 0 → 压低海床（深度变大）。
       * ★ V3.2：笔刷**不参与**面积平均起伏的统计 —— 它是局部手工编辑，
       *   若把它算进均值，画一笔就会让整片海床跟着平移，手感会"发飘"。 */
      var ED = FLS.state.terrainEdits;
      if (ED && ED.length) {
        var off = 0;
        for (var q = 0; q < ED.length; q++) {
          var ed = ED[q];
          if (!ed || ed.on === false) continue;
          var rr = Math.max(0.5, ed.r);
          var ex = x - ed.e, ey = y - ed.n;
          var d2 = ex * ex + ey * ey;
          if (d2 >= rr * rr) continue;                       // 有限支撑：半径外无影响
          var u = Math.sqrt(d2) / rr;                        // 0..1
          var wgt = (ed.shape === 'gauss')
            ? Math.exp(-4.5 * u * u) - Math.exp(-4.5)        // 截断高斯（边界归零）
            : 0.5 * (1 + Math.cos(Math.PI * u));             // 升余弦钟形（默认）
          if (wgt < 0) wgt = 0;
          off += ed.amp * wgt;
        }
        if (off) d -= off;
      }
      // 保底 0.2 m：避免多次抬高把海床顶出水面（深度 ≤ 0 会让吸收/几何项发散）
      if (!(d > 0.2)) d = 0.2;
      if (!mat) mat = list[0] || DEF_MAT;
      return { d: d, idx: dom, mat: mat };
    },
    /** 施加一次笔刷：返回新建的编辑记录 */
    addEdit: function (e, n, amp, r, shape) {
      var ed = { id: 'E' + (FLS.state.terrainEdits.length + 1) + '_' + Date.now().toString(36),
        e: e, n: n, amp: amp, r: r, shape: shape || 'cos', on: true };
      FLS.state.terrainEdits.push(ed);
      return ed;
    },
    /** 取消上一步（撤销） */
    undoEdit: function () { return FLS.state.terrainEdits.pop() || null; },
    clearEdits: function () { var n = FLS.state.terrainEdits.length; FLS.state.terrainEdits.length = 0; return n; },
    depth: function (x, y) { return FLS.Terrain.compose(x, y).d; },
    /** 海底高程 z（天向，水下为负） */
    zAt: function (x, y) { return -FLS.Terrain.depth(x, y); },
    /** 有限差分法向（单位向量，天向为正） */
    normalAt: function (x, y, eps) {
      eps = eps || 0.35;
      var zl = FLS.Terrain.zAt(x - eps, y), zr = FLS.Terrain.zAt(x + eps, y);
      var zb = FLS.Terrain.zAt(x, y - eps), zf = FLS.Terrain.zAt(x, y + eps);
      var nx = -(zr - zl) / (2 * eps), ny = -(zf - zb) / (2 * eps), nz = 1;
      var L = Math.sqrt(nx * nx + ny * ny + nz * nz);
      return { x: nx / L, y: ny / L, z: nz / L };
    }
  };

  /* ---------------------------------------------------- 水下目标模型库 */
  /* 每个模型返回若干 {geom, color} 部件，geom 为 THREE.BufferGeometry（已应用局部变换） */
  function G(geo, mtx, color) { if (mtx) geo.applyMatrix4(mtx); return { geom: geo, color: color }; }
  function m4(x, y, z, rx, ry, rz, sx, sy, sz) {
    var m = new THREE.Matrix4();
    var q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rx || 0) * DEG, (ry || 0) * DEG, (rz || 0) * DEG, 'ZYX'));
    m.compose(new THREE.Vector3(x || 0, y || 0, z || 0), q, new THREE.Vector3(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz));
    return m;
  }
  /* ★ V3.4：为新增的六类目标补几种材质色 —— 轮胎的橡胶黑、珊瑚的粉橙、
     鲸鱼的深灰蓝、蛙人的氯丁胶黑与气瓶黄，都是各目标的固有色。 */
  var COL = { steel: 0x8a94a0, dark: 0x5a636e, rust: 0x8c5a3c, yellow: 0xd8b23a, green: 0x4f7a4a,
    grey: 0x9aa3ad, black: 0x3a4048, copper: 0xb87333,
    rubber: 0x22242a, coral: 0xe0736a, coral2: 0xf0a06a, whale: 0x4a5560, whaleBelly: 0xa8b2b8,
    wetsuit: 0x1b2430, tank: 0xd8b23a, glass: 0x8fd4e8, carBody: 0x2f4f6f, rigDeck: 0x6b7280 };

  /* ====================================================================
   * V3.0：高精度建模辅助工具
   * --------------------------------------------------------------------
   * 旧版模型是「几个 Box + Cylinder + Sphere 拼个意思」：水雷是圆柱加两个半球
   * 再插 6 根棍，飞机用盒子当机翼，沉船是圆柱接个球。形似而已，边缘全是硬折线，
   * 分段数也低（圆柱 18 段、球 18×12），转起来能看见棱。
   *
   * V3.0 改用**真实型线 + 高阶曲面**重建：
   *   ① lathe()    回转体 —— UUV / 水雷 / 舱段这类本来就是回转体，过去用
   *                 「柱 + 两个半球」拼，接缝处法线突变、有一道明显的棱；
   *                 现在一条型线回转到底，艏部椭球、中段柱、艉部锥连续过渡。
   *   ② foilShape() NACA 对称翼型 —— 舵、翼、尾翼过去是薄盒子，现在是有前后缘
   *                 和真实厚度分布的翼型截面，迎声面积随姿态的变化才是对的。
   *   ③ prop()     导管螺旋桨 —— 桨毂 + n 叶带扭转角的桨叶，可整体摆位。
   *   ④ rod()      任意方向的杆件 —— 用四元数把圆柱的 +Y 转到给定方向，
   *                 触角、斜撑、吊杆这类"斜着插"的零件不必再硬凑欧拉角。
   *
   * ★ 提高精度**不会**拖慢仿真内核：
   *   散射计算走 Models.facets(parts, mw, maxFacet)，那里按预算抽样
   *   （精度档 low/mid/high = 120/400/1400 个面元），几何三角形再多也只是
   *   被 stride 抽稀，参与运算的面元数不变。多出来的开销全在 GPU 渲染侧。
   *   反过来，更密的三角形让**抽样后的面元分布更均匀**，声学上反而更准。
   * ==================================================================== */

  /**
   * 回转体：由型线生成。
   * profile = [[半径, 轴向坐标], …]，绕 Y 轴回转（THREE.LatheGeometry 的约定），
   * 所以返回的几何体轴向是 Y；调用处用 m4(…, 90, 0, 0) 转到模型约定的 +Z 艏向。
   * 型线沿轴必须单调，否则自交、法线翻转。
   */
  function lathe(profile, seg, col, mtx) {
    var pts = [];
    for (var i = 0; i < profile.length; i++) {
      pts.push(new THREE.Vector2(Math.max(0, profile[i][0]), profile[i][1]));
    }
    return G(new THREE.LatheGeometry(pts, seg || 36), mtx, col);
  }

  /**
   * NACA 对称翼型截面（NACA 00tt 系列）。
   *   y(ξ) = 5t·(0.2969√ξ − 0.1260ξ − 0.3516ξ² + 0.2843ξ³ − 0.1036ξ⁴),  ξ = x/c
   * 末项取 −0.1036（而非常见的 −0.1015），让后缘真正闭合收尖，不留一条缝。
   * 弦向取余弦分布：前缘曲率大，多给点；后缘平缓，少给点。
   * 返回的 Shape 弦长沿 +X（0→c），厚度沿 Y，前缘在原点。
   */
  function foilShape(c, t) {
    var n = 22, up = [], lo = [], i, xi, k, y;
    for (i = 0; i <= n; i++) {
      xi = i / n;
      k = (1 - Math.cos(xi * Math.PI)) / 2;          // 余弦分布：加密前缘
      y = 5 * t * c * (0.2969 * Math.sqrt(k) - 0.1260 * k - 0.3516 * k * k
        + 0.2843 * k * k * k - 0.1036 * k * k * k * k);
      up.push([k * c, y]); lo.push([k * c, -y]);
    }
    var s = new THREE.Shape();
    s.moveTo(up[0][0], up[0][1]);
    for (i = 1; i < up.length; i++) s.lineTo(up[i][0], up[i][1]);
    for (i = lo.length - 2; i >= 0; i--) s.lineTo(lo[i][0], lo[i][1]);
    s.closePath();
    return s;
  }

  /**
   * 由翼型挤出一个翼面。挤出方向为 Z（ExtrudeGeometry 的约定），展长沿 Z 且居中。
   * 调用者用 mtx 摆位：绕 Y 转 90° → 展向沿 X（机翼）；再绕 Z 转 90° → 展向沿 Y（垂尾）。
   * @param span 展长  @param chord 弦长  @param thick 相对厚度 t
   */
  function foil(span, chord, thick, col, mtx) {
    var g = new THREE.ExtrudeGeometry(foilShape(chord, thick),
      { depth: span, bevelEnabled: false, curveSegments: 6, steps: 1 });
    g.translate(0, 0, -span / 2);
    return G(g, mtx, col);
  }

  /**
   * 导管螺旋桨：桨毂 + n 叶带扭转的桨叶（+ 可选 Kort 导管）。
   * m4 的欧拉序是 'ZYX'，即 R = Rz(az)·Ry(twist)·Rx(0)：桨叶先绕自身长轴 Y 扭转
   * twist，再绕 Z 转到方位角 az —— 顺序正好是我们要的。绕 Z 转 az 后 +Y 指向
   * (−sin az, cos az, 0)，故叶心平移到 rMid 处。
   * @param zPos 桨盘面在轴向（局部 +Z）上的位置
   * @param duct 是否带导管
   * @param outer 可选的 THREE.Matrix4 整体变换（先于各零件自身变换施加），
   *              用于把整台推进器搬到 ROV 的某个角落并转向。
   */
  function prop(rHub, rTip, chord, nB, twist, col, zPos, duct, outer) {
    var p = [], rMid = (rHub + rTip) / 2, len = rTip - rHub, i, a;
    var O = outer || new THREE.Matrix4();
    var put = function (m) { return m.premultiply(O); };   // world = outer · local
    p.push(G(new THREE.CylinderGeometry(rHub, rHub * 0.72, 0.075, 16),
      put(m4(0, 0, zPos, 90, 0, 0)), COL.dark));
    for (i = 0; i < nB; i++) {
      a = i * 2 * Math.PI / nB;
      p.push(G(new THREE.BoxGeometry(chord, len, 0.012),
        put(m4(-rMid * Math.sin(a), rMid * Math.cos(a), zPos, 0, twist, a)), col));
    }
    if (duct) {
      p.push(G(new THREE.CylinderGeometry(rTip * 1.12, rTip * 1.12, 0.17, 28, 1, true),
        put(m4(0, 0, zPos, 90, 0, 0)), COL.dark));
    }
    return p;
  }

  /** 任意方向的杆件：把圆柱的 +Y 用四元数转到给定方向，用于斜撑、触角、吊杆 */
  function rod(px, py, pz, dx, dy, dz, len, rad, col) {
    var q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
    var m = new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(1, 1, 1));
    return G(new THREE.CylinderGeometry(rad, rad, len, 10), m, col);
  }

  /** 一段管材（框架、栏杆、管路），沿指定欧拉角摆放 */
  function tube(x, y, z, rx, ry, rz, len, rad, col) {
    return G(new THREE.CylinderGeometry(rad, rad, len, 12), m4(x, y, z, rx, ry, rz), col || COL.dark);
  }

  /** 绕 Z 轴（艏向）的一圈环箍：舱段接缝、加强筋、法兰箍 */
  function ring(z, rad, thick, col) {
    return G(new THREE.TorusGeometry(rad, thick, 10, 40), m4(0, 0, z), col || COL.steel);
  }

  /** 绕 X 轴的一圈环箍（用于桅杆、烟囱这类竖直构件） */
  function ringX(x, y, z, rad, thick, col) {
    return G(new THREE.TorusGeometry(rad, thick, 8, 24), m4(x, y, z, 90, 0, 0), col || COL.steel);
  }

  FLS.Models = {
    TYPES: {
      wreck: {
        name: '沉船（破损）', ts: -8, size: 1,
        build: function () {
          var p = [];
          /* 船体：一条型线回转出纺锤体，再压扁成船的横剖面（半宽 2.1 m、半深 3.6 m）。
           * 旧版是「圆柱 + 两个半球 + 两个盒子」，舷侧与舭部全是直棱，艏艉一样粗。
           * 现在艉部方钝（方尾货船）、舯部最宽、艏部收尖：
           * 长 34 m / 宽 4.2 m / 型深 7.2 m，长宽比 8.1，接近真实沿海货船。 */
          p.push(lathe([
            [0.00, -17.0], [0.60, -16.3], [1.25, -15.0], [1.90, -13.0], [2.55, -10.5],
            [3.15, -7.0], [3.60, -3.0], [3.82, 1.0], [3.90, 4.0], [3.82, 7.0],
            [3.52, 10.0], [3.00, 12.8], [2.20, 15.0], [1.25, 16.6], [0.45, 17.4], [0.00, 17.7]
          ], 30, COL.rust, m4(0, 0, 0, 90, 0, 0, 0.525, 1, 0.9)));
          // 主甲板（沿全长，舷墙内收）
          p.push(G(new THREE.BoxGeometry(3.9, 0.22, 30), m4(0, 1.75, -1), COL.dark));
          // 货舱：舱口围板 + 舱盖 ×3
          [-8, 0, 8].forEach(function (z) {
            p.push(G(new THREE.BoxGeometry(2.6, 0.30, 4.2), m4(0, 1.98, z), COL.dark));
            p.push(G(new THREE.BoxGeometry(2.4, 0.12, 4.0), m4(0, 2.18, z), COL.steel));
          });
          // 艉部上层建筑：三层带舷窗
          p.push(G(new THREE.BoxGeometry(3.2, 1.5, 4.4), m4(0, 3.05, -12.2), COL.grey));
          p.push(G(new THREE.BoxGeometry(2.6, 1.3, 3.6), m4(0, 4.35, -12.2), COL.grey));
          p.push(G(new THREE.BoxGeometry(2.0, 1.1, 2.8), m4(0, 5.45, -12.2), COL.grey));
          for (var w = 0; w < 5; w++) {
            p.push(G(new THREE.BoxGeometry(0.06, 0.34, 0.5), m4(1.61, 3.2, -13.6 + w * 0.85), COL.black));
          }
          // 烟囱 + 顶部排烟口箍
          p.push(G(new THREE.CylinderGeometry(0.62, 0.72, 2.4, 20), m4(0, 5.4, -9.6), COL.rust));
          p.push(ringX(0, 6.55, -9.6, 0.64, 0.05, COL.black));
          // 桅杆 + 横桁 + 吊货杆
          p.push(tube(0, 6.2, -4.0, 0, 0, 0, 5.6, 0.14, COL.steel));
          p.push(tube(0, 8.4, -4.0, 0, 90, 0, 3.4, 0.09, COL.steel));
          p.push(rod(0.9, 7.4, -6.4, 0.6, -0.5, 0, 3.0, 0.08, COL.steel));
          /* 破损：艏段在 z≈+9 处断开，向左舷倾覆并下沉 —— 沉船最典型的姿态。
           * 断口处露出三道肋骨（半环），比"整条船完好地躺着"更像沉船。 */
          p.push(lathe([
            [0.00, 0.0], [0.90, 0.5], [1.70, 1.4], [2.50, 3.0], [3.10, 5.2],
            [3.50, 7.6], [3.60, 9.4], [3.30, 10.6], [2.40, 11.6], [1.20, 12.2], [0.00, 12.4]
          ], 26, COL.rust, m4(-2.2, 1.4, 9.0, 90, -14, 26, 0.52, 1, 0.85)));
          for (var rb = 0; rb < 3; rb++) {
            p.push(G(new THREE.TorusGeometry(2.0, 0.13, 8, 26, Math.PI),
              m4(0.4, -0.6, 8.4 - rb * 1.5), COL.steel));
          }
          // 艉部：4 叶螺旋桨（带扭转）+ NACA 翼型舵 + 舵杆
          p = p.concat(prop(0.28, 1.35, 0.55, 4, 0.42, COL.steel, -17.4, false));
          p.push(foil(2.4, 1.5, 0.14, COL.steel, m4(0, -1.9, -16.2, 0, 90, 0)));
          p.push(tube(0, -1.2, -16.2, 0, 0, 0, 1.6, 0.16, COL.dark));
          // 艏部锚链：从锚链筒垂下的 4 个交错链环
          for (var c = 0; c < 4; c++) {
            p.push(G(new THREE.TorusGeometry(0.34, 0.09, 7, 16),
              m4(1.2, 0.5 - c * 0.55, 15.6, 0, (c % 2) ? 90 : 0, 0), COL.steel));
          }
          // 艉段尚存的舷墙栏杆
          for (var g2 = 0; g2 < 7; g2++) {
            p.push(tube(1.85, 2.35, -15.5 + g2 * 1.1, 0, 0, 0, 0.5, 0.035, COL.steel));
          }
          p.push(tube(1.85, 2.6, -12.1, 90, 0, 0, 7.2, 0.04, COL.steel));
          return p;
        }
      },
      uuv: {
        name: '无人潜航器 UUV（Ø324 mm）', ts: -22, size: 0.324,
        build: function () {
          var p = [];
          /* 主艇体：一条型线回转到底（艏部椭球 → 中段柱 → 艉部锥）。
           * 旧版是「圆柱 + 半球头 + 尾锥」三件硬拼，接缝处有一圈硬棱，
           * 在声图上会表现为一条假的强回波环；现在整条连续。 */
          p.push(lathe([
            [0.000, 1.46], [0.048, 1.40], [0.088, 1.30], [0.120, 1.16],
            [0.146, 0.98], [0.157, 0.76], [0.162, 0.52], [0.162, -0.52],
            [0.159, -0.76], [0.150, -0.96], [0.132, -1.12], [0.108, -1.28],
            [0.078, -1.40], [0.042, -1.48], [0.000, -1.52]
          ], 40, COL.yellow, m4(0, 0, 0, 90, 0, 0)));
          // 艏部导流罩（深色玻璃钢，透声），与主艇体间留一道接缝
          p.push(lathe([
            [0.000, 1.47], [0.050, 1.41], [0.090, 1.31], [0.122, 1.17], [0.144, 1.02]
          ], 36, COL.dark, m4(0, 0, 0, 90, 0, 0)));
          // 舱段接缝环 ×3
          [0.52, 0.0, -0.52].forEach(function (z) { p.push(ring(z, 0.164, 0.006)); });
          // 舷侧两条侧扫声呐条
          [1, -1].forEach(function (s) {
            p.push(G(new THREE.BoxGeometry(0.05, 0.045, 0.7), m4(s * 0.16, -0.06, -0.1), COL.black));
          });
          // 尾部十字舵：4 片 NACA 翼型，展 0.34 m / 弦 0.26 m / 厚 12%
          [0, 90, 180, 270].forEach(function (a) {
            p.push(foil(0.34, 0.26, 0.12, COL.dark,
              m4(0, 0, -1.06).premultiply(new THREE.Matrix4().makeRotationZ(a * DEG))
                .premultiply(new THREE.Matrix4().makeTranslation(0, 0.17, 0))));
          });
          // 艉部导管螺旋桨（Kort 导管 + 5 叶）
          p = p.concat(prop(0.05, 0.145, 0.075, 5, 0.35, COL.steel, -1.42, true));
          // 顶部通信天线 + 两个起吊耳环
          p.push(tube(0, 0.20, 0.30, 0, 0, 0, 0.22, 0.012, COL.black));
          [0.62, -0.62].forEach(function (z) {
            p.push(G(new THREE.TorusGeometry(0.05, 0.012, 6, 14), m4(0, 0.17, z, 0, 90, 0), COL.steel));
          });
          return p;
        }
      },
      rov: {
        name: '遥控潜水器 ROV（本声呐载体）', ts: -18, size: 1,
        build: function () {
          var p = [];
          /* 框架式作业 ROV：管材焊接框架 + 顶部浮力块 + 横置电子舱 + 前视声呐头
           * + 3 台导管推进器（艉部左右 2 台主推、艉顶 1 台垂推）+ 摄像头与 LED。
           * 旧版是「黄盒子 + 4 个圆柱 + 声呐头」共 9 件，现在 40 余件。 */
          var W = 0.34, H = 0.26, D = 0.30;                 // 框架半尺寸
          // —— 框架：底部 2 根纵梁 + 顶部 2 根纵梁 + 4 根立柱 + 4 根横梁
          [-W, W].forEach(function (x) {
            [-H, H].forEach(function (y) {
              p.push(tube(x, y, 0, 90, 0, 0, 2 * D, 0.026));      // 纵梁（沿 Z）
            });
            [-D, D].forEach(function (z) {
              p.push(tube(x, 0, z, 0, 0, 0, 2 * H, 0.026));       // 立柱（沿 Y）
              p.push(tube(x, -H, z, 90, 0, 0, 2 * W, 0.026));     // 底部横梁（沿 X）
            });
          });
          // —— 顶部浮力块（合成泡沫，黄色；两端半圆收头）
          p.push(G(new THREE.BoxGeometry(0.62, 0.15, 0.46), m4(0, H + 0.09, 0), COL.yellow));
          [0.23, -0.23].forEach(function (z) {
            p.push(G(new THREE.CylinderGeometry(0.075, 0.075, 0.62, 16), m4(0, H + 0.09, z, 0, 0, 90), COL.yellow));
          });
          // —— 电子舱（横置耐压圆柱 + 两端端盖 + 一道卡箍）
          p.push(G(new THREE.CylinderGeometry(0.115, 0.115, 0.52, 24), m4(0, -0.02, -0.18, 90, 0, 0), COL.grey));
          [0.08, -0.44].forEach(function (z) {
            p.push(G(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 24), m4(0, -0.02, z, 90, 0, 0), COL.black));
          });
          p.push(ring(-0.02, 0.118, 0.008, COL.dark));
          // —— 前视声呐头（本系统核心载荷，艏部正中）
          p.push(G(new THREE.BoxGeometry(0.30, 0.17, 0.14), m4(0, -0.06, 0.34), COL.steel));
          p.push(G(new THREE.CylinderGeometry(0.115, 0.115, 0.05, 28), m4(0, -0.06, 0.42, 90, 0, 0), COL.black));
          // 声呐阵面：16 个阵元小球沿圆周排布，直观对应「接收阵元数」
          for (var e = 0; e < 16; e++) {
            var ea = e * 2 * Math.PI / 16;
            p.push(G(new THREE.SphereGeometry(0.011, 8, 6),
              m4(0.088 * Math.cos(ea), -0.06 + 0.088 * Math.sin(ea), 0.445), 0x2f6f9f));
          }
          // —— 摄像头 + 2 盏 LED
          p.push(G(new THREE.CylinderGeometry(0.042, 0.042, 0.09, 14), m4(0, 0.10, 0.33, 90, 0, 0), COL.black));
          [-0.13, 0.13].forEach(function (x) {
            p.push(G(new THREE.SphereGeometry(0.032, 12, 8), m4(x, 0.10, 0.35), 0xd8d8c0));
          });
          // —— 艉部左右 2 台主推（轴向沿艏向 Z）
          [-0.30, 0.30].forEach(function (x) {
            p = p.concat(prop(0.028, 0.085, 0.055, 4, 0.40, COL.steel, -0.34, true,
              new THREE.Matrix4().makeTranslation(x, -0.02, 0)));
          });
          // —— 艉顶 1 台垂推：整体绕 X 转 90° 后轴向指向天向
          p = p.concat(prop(0.026, 0.080, 0.050, 4, 0.40, COL.steel, -0.30, true,
            new THREE.Matrix4().makeTranslation(0, H + 0.04, 0)
              .multiply(new THREE.Matrix4().makeRotationX(90 * DEG))));
          // —— 脐带缆接口 + 一小段缆
          p.push(G(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 12), m4(0, H - 0.02, -0.36, 90, 0, 0), COL.black));
          p.push(rod(0, H + 0.10, -0.52, 0, 0.6, -1, 0.30, 0.018, COL.black));
          return p;
        }
      },
      mine: {
        name: '水雷（圆柱+半球封头）', ts: -14, size: 1,
        build: function () {
          var p = [];
          /* 雷体：一条型线回转出「半球封头 + 柱段 + 半球封头」。
           * 旧版是三个独立几何体硬拼，接缝处法线不连续，声图上会出现两圈假亮环；
           * 现在整条连续，只有材料分界、没有几何棱。 */
          p.push(lathe([
            [0.00, 0.95], [0.20, 0.92], [0.34, 0.84], [0.44, 0.72], [0.49, 0.56],
            [0.50, 0.30], [0.50, -0.30], [0.49, -0.56], [0.44, -0.72], [0.34, -0.84],
            [0.20, -0.92], [0.00, -0.95]
          ], 36, COL.dark, m4(0, 0, 0, 90, 0, 0)));
          // 加强箍 ×2 + 赤道合拢焊缝（上下半壳的接缝）
          [0.34, -0.34].forEach(function (z) { p.push(ring(z, 0.505, 0.020)); });
          p.push(ring(0.0, 0.503, 0.010));
          /* 触角 ×6：真实触角雷（锚雷 / 漂雷）的触角是软铅管，受撞击弯折后接通
           * 电池—雷管电路。旧版只是 6 根直棍；现在每根由「固定座 + 斜伸段
           * + 铜电极球」组成，并向外张开 18°，与真实触角雷的伞状布置一致。 */
          var tilt = 18 * DEG, seg = 0.64;
          for (var i = 0; i < 6; i++) {
            var a = i * 60 * DEG, dx = Math.cos(a), dy = Math.sin(a);
            var r0 = 0.40, r1 = r0 + seg * Math.sin(tilt), z1 = 0.72 + seg * Math.cos(tilt);
            var mx = (r0 + r1) / 2 * dx, my = (r0 + r1) / 2 * dy, mz = (0.72 + z1) / 2;
            p.push(G(new THREE.CylinderGeometry(0.055, 0.055, 0.09, 10),
              m4(r0 * dx, r0 * dy, 0.75, 90, 0, 0), COL.dark));                 // 固定座
            p.push(rod(mx, my, mz, dx * Math.sin(tilt), dy * Math.sin(tilt), Math.cos(tilt),
              seg, 0.032, COL.steel));                                           // 斜伸段
            p.push(G(new THREE.SphereGeometry(0.055, 12, 8), m4(r1 * dx, r1 * dy, z1), COL.copper));
          }
          // 艏部水压引信孔 + 舷侧吊耳 ×2
          p.push(G(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 16), m4(0, 0, 0.96, 90, 0, 0), COL.steel));
          [0.30, -0.30].forEach(function (x) {
            p.push(G(new THREE.TorusGeometry(0.05, 0.014, 6, 14), m4(x, 0, 0.62, 0, 90, 0), COL.steel));
          });
          // 雷索系留环（底部）+ 3 节雷索（通向雷锚）
          p.push(G(new THREE.TorusGeometry(0.11, 0.022, 8, 20), m4(0, 0, -1.02, 0, 90, 0), COL.steel));
          for (var c = 0; c < 3; c++) {
            p.push(G(new THREE.TorusGeometry(0.09, 0.022, 6, 14),
              m4(0, 0, -1.14 - c * 0.16, 0, (c % 2) ? 90 : 0, 0), COL.steel));
          }
          return p;
        }
      },
      box: {
        name: '标准长方体目标', ts: -12, size: 1,
        /* 标准反射体本就该是规整的长方体（用于标定测距与 TS），保持简洁是对的，
         * 但把「六个面 + 边棱」写实：加两端加强框与四个吊点，摆位时好辨认朝向。 */
        build: function () {
          var p = [G(new THREE.BoxGeometry(2, 1, 1.2), m4(0, 0, 0), COL.steel)];
          [1.01, -1.01].forEach(function (x) {
            p.push(G(new THREE.BoxGeometry(0.06, 1.04, 1.24), m4(x, 0, 0), COL.dark));
          });
          [[0.9, 0.51, 0.61], [0.9, 0.51, -0.61], [-0.9, 0.51, 0.61], [-0.9, 0.51, -0.61]].forEach(function (a) {
            p.push(G(new THREE.TorusGeometry(0.055, 0.016, 6, 14), m4(a[0], a[1], a[2], 0, 90, 0), COL.dark));
          });
          return p;
        }
      },
      sphere: {
        name: '标准球体目标', ts: -20, size: 1,
        /* 标准靶球（Ø0.8 m 实心钢球）对球形度有要求，分段从 26×18 提到 48×32；
         * 真实靶球是吊在缆上的，故补一个吊环与一小段吊缆。 */
        build: function () {
          var p = [G(new THREE.SphereGeometry(0.8, 48, 32), m4(0, 0, 0), COL.steel)];
          p.push(G(new THREE.TorusGeometry(0.075, 0.018, 8, 18), m4(0, 0.86, 0, 0, 90, 0), COL.dark));
          p.push(tube(0, 1.12, 0, 0, 0, 0, 0.48, 0.012, COL.black));
          return p;
        }
      },
      plane: {
        name: '失事飞机（简化）', ts: -6, size: 1,
        build: function () {
          var p = [];
          /* 机身：回转体（艏部整流罩 → 等截面段 → 艉部收锥），比旧版的
           * 「圆柱 + 半球」更像机身。失事状态：机身在 z≈+1 处断成两段，
           * 后段向左舷倾覆并下沉。 */
          p.push(lathe([
            [0.00, -7.4], [0.28, -7.2], [0.62, -6.6], [0.92, -5.6], [1.08, -4.2],
            [1.12, -2.0], [1.12, 1.0], [1.10, 3.0], [1.02, 5.0], [0.84, 6.6],
            [0.55, 7.8], [0.24, 8.6], [0.00, 8.9]
          ], 30, COL.grey, m4(0, 0, 0, 90, 0, 0)));
          // 断裂后段：向左舷折 22°、下沉 0.5 m
          p.push(lathe([
            [0.00, 0.0], [0.60, 0.4], [0.98, 1.2], [1.12, 2.6], [1.12, 4.4],
            [1.04, 6.0], [0.86, 7.2], [0.58, 8.0], [0.26, 8.4], [0.00, 8.6]
          ], 28, COL.grey, m4(-1.4, -0.5, -1.0, 90, 0, 22)));
          // 断口处外露的隔框 ×2
          [0.9, 0.2].forEach(function (z) { p.push(ring(z, 1.05, 0.055, COL.dark)); });
          /* 主翼：NACA 翼型挤出，弦 3.0 m / 厚 12%。
           * 左翼完好（展 9 m）；右翼内段 5 m、外段在 6 m 处折断下垂 26°。 */
          p.push(foil(9.0, 3.0, 0.12, COL.grey, m4(-4.5, -0.25, -0.6, 0, 90, 0)));
          p.push(foil(5.0, 3.0, 0.12, COL.grey, m4(2.5, -0.25, -0.6, 0, 90, 0)));
          p.push(foil(4.0, 2.9, 0.12, COL.grey,
            new THREE.Matrix4().makeTranslation(6.4, -0.85, -0.6)
              .multiply(new THREE.Matrix4().makeRotationZ(-26 * DEG))       // 外段下垂
              .multiply(new THREE.Matrix4().makeRotationY(90 * DEG))));     // 展向沿 X
          // 水平尾翼（展 7 m）+ 垂直尾翼（高 2.6 m）
          p.push(foil(7.0, 1.6, 0.10, COL.grey, m4(0, 0.15, -7.0, 0, 90, 0)));
          p.push(foil(2.6, 1.8, 0.10, COL.grey, m4(0, 1.30, -7.3, 0, 90, 90)));
          // 翼下发动机短舱 ×2（回转体）+ 桨毂与桨叶
          [4.4, -4.4].forEach(function (x) {
            p.push(lathe([
              [0.00, 1.05], [0.30, 1.00], [0.46, 0.80], [0.52, 0.45], [0.54, 0.0],
              [0.52, -0.45], [0.44, -0.80], [0.28, -0.98], [0.00, -1.02]
            ], 24, COL.dark, m4(x, -0.85, -0.3, 90, 0, 0)));
            p = p.concat(prop(0.06, 0.52, 0.16, 3, 0.38, COL.steel, 1.15, false,
              new THREE.Matrix4().makeTranslation(x, -0.85, 0)));
          });
          // 主起落架：折断外撇 + 机轮
          [1.6, -1.6].forEach(function (x) {
            p.push(rod(x, -1.35, 0.4, x > 0 ? 0.22 : -0.22, -1, 0, 1.0, 0.055, COL.dark));
            p.push(G(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 16),
              m4(x + (x > 0 ? 0.22 : -0.22), -1.85, 0.4, 0, 0, 90), COL.black));
          });
          return p;
        }
      },
      pipeline: {
        name: '海底油气管线', ts: -16, size: 1,
        build: function (o) {
          o = o || {};
          var L = o.len || 120, bend = (o.bend || 0);
          /* 沿管长取 96 个控制点（旧版 24），走向与弯曲更平滑；
           * 环向 20 段（旧版 14），横截面更圆 —— 掠射下的镜面回波才对。 */
          var pts = [], n = 96, i, t, s;
          for (i = 0; i <= n; i++) {
            t = i / n; s = (t - 0.5) * L;
            pts.push(new THREE.Vector3(s, bend * L * 0.06 * Math.sin(Math.PI * t), 0));
          }
          var curve = new THREE.CatmullRomCurve3(pts);
          var p = [G(new THREE.TubeGeometry(curve, 120, 0.35, 20, false), m4(0, 0, 0), COL.dark)];
          /* 混凝土配重层：每 12 m 一道环（真实海底管线靠它抗浮、抗拖网），
           * 它也是声图上沿管线出现的周期性强回波的来源。 */
          var nR = Math.max(2, Math.round(L / 12));
          for (var k = 0; k <= nR; k++) {
            var tt = k / nR;
            p.push(G(new THREE.CylinderGeometry(0.46, 0.46, 1.1, 22, 1, true),
              m4((tt - 0.5) * L, bend * L * 0.06 * Math.sin(Math.PI * tt), 0, 90, 0, 0), 0x9a958a));
          }
          // 两端法兰（检修 / 连接用）
          [1, -1].forEach(function (s2) {
            p.push(G(new THREE.CylinderGeometry(0.52, 0.52, 0.18, 24), m4(s2 * L / 2, 0, 0, 90, 0, 0), COL.steel));
          });
          return p;
        }
      },
      caisson: {
        name: '混凝土沉箱', ts: -10, size: 1,
        build: function () {
          var p = [], c = 0xb9b3a6, t = 0.25, W = 4, H = 3, D = 4;
          p.push(G(new THREE.BoxGeometry(W, t, D), m4(0, -H / 2, 0), c));
          p.push(G(new THREE.BoxGeometry(t, H, D), m4(-W / 2, 0, 0), c));
          p.push(G(new THREE.BoxGeometry(t, H, D), m4(W / 2, 0, 0), c));
          p.push(G(new THREE.BoxGeometry(W, H, t), m4(0, 0, -D / 2), c));
          p.push(G(new THREE.BoxGeometry(W, H, t), m4(0, 0, D / 2), c));
          /* V3.0 增补：内部隔壁 ×2（真实沉箱分舱灌注，靠它控制下沉姿态）、
           * 四角加强柱、顶部吊环 ×4、底部刃脚裙板（坐底防滑）。 */
          [-1.0, 1.0].forEach(function (z) {
            p.push(G(new THREE.BoxGeometry(W - 2 * t, H - t, 0.18), m4(0, 0, z), 0xaaa49a));
          });
          [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (s) {
            p.push(G(new THREE.BoxGeometry(0.16, H - 0.2, 0.16),
              m4(s[0] * (W / 2 - 0.08), 0, s[1] * (D / 2 - 0.08)), 0xaaa49a));
            p.push(G(new THREE.TorusGeometry(0.16, 0.045, 8, 18),
              m4(s[0] * 1.55, H / 2 + 0.12, s[1] * 1.55, 0, 0, 90), COL.steel));
          });
          p.push(G(new THREE.BoxGeometry(W + 0.5, 0.30, D + 0.5), m4(0, -H / 2 - 0.15, 0), 0x8f897e));
          return p;
        }
      },
      chain: {
        name: '锚链', ts: -24, size: 1,
        build: function (o) {
          o = o || {};
          var n = o.links || 18, p = [], R = 0.4, r = 0.11, step = 1.35 * R;
          /* 链环径向 10 段、环向 24 段（旧版 8×16），环体截面更圆；
           * 相邻环仍交错 90°（真实有档锚链的穿法）。 */
          for (var i = 0; i < n; i++) {
            p.push(G(new THREE.TorusGeometry(R, r, 10, 24),
              m4((i - n / 2) * step, 0, 0, 0, (i % 2) ? 90 : 0, 0), COL.steel));
          }
          // 两端卸扣（shackle）：U 形环 + 横销
          [1, -1].forEach(function (s) {
            var x = s * (n / 2) * step;
            p.push(G(new THREE.TorusGeometry(0.26, 0.075, 8, 20, Math.PI * 1.35),
              m4(x + s * 0.22, 0, 0, 90, 0, 0), COL.dark));
            p.push(G(new THREE.CylinderGeometry(0.055, 0.055, 0.52, 10),
              m4(x + s * 0.22, 0.26, 0, 90, 0, 0), COL.steel));
          });
          return p;
        }
      },
      elbow: {
        name: '管线弯头接头', ts: -18, size: 1,
        build: function () {
          var p = [];
          /* 弯管本体：环向 20 段（旧版 14）、纵向 28 段（旧版 20），
           * 弯头外侧的拉伸与内侧的挤压在几何上是真实的。 */
          p.push(G(new THREE.TorusGeometry(1.0, 0.32, 20, 28, Math.PI / 2), m4(0, 0, 0), COL.copper));
          p.push(G(new THREE.CylinderGeometry(0.32, 0.32, 1.6, 20), m4(1.0, -0.8, 0), COL.copper));
          p.push(G(new THREE.CylinderGeometry(0.34, 0.34, 1.6, 20), m4(0, 0, 1.0, 90, 0, 0), COL.copper));
          /* V3.0 增补：两端法兰（DN300 级：8 个均布螺栓 + 密封面）。
           * 法兰是弯头在声图上最亮的部件 —— 一个大平面正对来波。 */
          var flange = function (x, y, z, rx) {
            var q = [G(new THREE.CylinderGeometry(0.52, 0.52, 0.16, 26), m4(x, y, z, rx, 0, 0), COL.steel)];
            for (var i = 0; i < 8; i++) {
              var a = i * 45 * DEG;
              // 螺栓绕法兰圆周均布：先在局部 XZ 面定位，再按法兰轴向旋转
              var v = new THREE.Vector3(0.40 * Math.cos(a), 0, 0.40 * Math.sin(a))
                .applyMatrix4(new THREE.Matrix4().makeRotationX((rx || 0) * DEG));
              q.push(G(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 8),
                m4(x + v.x, y + v.y, z + v.z, rx, 0, 0), COL.dark));
            }
            return q;
          };
          p = p.concat(flange(1.0, -1.58, 0, 0));
          p = p.concat(flange(0, 0, 1.78, 90));
          // 弯头两端的加强环
          p.push(G(new THREE.TorusGeometry(0.34, 0.05, 8, 24), m4(1.0, -0.1, 0), COL.dark));
          p.push(G(new THREE.TorusGeometry(0.36, 0.05, 8, 24), m4(0.1, 0, 1.0, 90, 0, 0), COL.dark));
          return p;
        }
      },
      reefblock: {
        name: '人工鱼礁块', ts: -12, size: 1,
        build: function () {
          var p = [], c = 0x8d8579;
          /* 四面开孔的方框礁体：四片侧壁错开 45° 形成过流通道（真实鱼礁靠它
           * 制造上升流），顶底板 + 四根立柱 + 内部两层隔板 + 底部支腿。 */
          for (var i = 0; i < 4; i++) {
            var a = i * 90 * DEG;
            p.push(G(new THREE.BoxGeometry(2.6, 2.2, 0.18), m4(0, 0, 0, 0, a, 0), c));
            // 每片壁上的两个过流孔（深色内嵌盒表示开口）
            [0.6, -0.6].forEach(function (h) {
              p.push(G(new THREE.BoxGeometry(0.62, 0.62, 0.22),
                m4(1.30 * Math.cos(a + Math.PI / 2), h, 1.30 * Math.sin(a + Math.PI / 2), 0, a, 0), 0x6d675d));
            });
          }
          p.push(G(new THREE.BoxGeometry(2.4, 0.18, 2.4), m4(0, 1.1, 0), c));
          p.push(G(new THREE.BoxGeometry(2.4, 0.18, 2.4), m4(0, -1.1, 0), c));
          for (var k = 0; k < 4; k++) {
            var b = k * 90 * DEG + 45 * DEG;
            p.push(G(new THREE.CylinderGeometry(0.13, 0.13, 2.2, 10), m4(1.1 * Math.cos(b), 0, 1.1 * Math.sin(b)), c));
          }
          // 内部两层水平隔板（附着面）
          [0.4, -0.4].forEach(function (h) {
            p.push(G(new THREE.BoxGeometry(1.9, 0.10, 1.9), m4(0, h, 0), 0x7d776e));
          });
          // 底部四根支腿（防止陷入软泥）
          [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (s) {
            p.push(G(new THREE.CylinderGeometry(0.11, 0.14, 0.5, 10), m4(s[0] * 1.05, -1.35, s[1] * 1.05), 0x7d776e));
          });
          // 顶部吊环
          p.push(G(new THREE.TorusGeometry(0.20, 0.045, 8, 18), m4(0, 1.32, 0, 0, 90, 0), COL.steel));
          return p;
        }
      },

      /* ==================================================================
       * ★ V3.4 新增六类目标
       *   应需求加入：水下钻井平台 / 蛙人 / 轮胎 / 小汽车 / 大型珊瑚丛 / 鲸鱼。
       *   六类覆盖了前视声呐的四类典型作业对象：
       *     · 大型钢结构（钻井平台）—— 强反射体，几十米尺度，是避障与普查对象；
       *     · 人体尺度软目标（蛙人）—— TS 极低（−15 dB 上下），是安检声呐最难的一类；
       *     · 橡胶丢弃物（轮胎）—— 声学上"软而透明"，常被用作人工鱼礁；
       *     · 沉车 —— 交通事故与涉水逃生的搜救对象，车体是强反射、玻璃是弱反射；
       *     · 生物礁体（珊瑚丛）—— 底质分类与生态调查对象，形态分叉、散射弥散；
       *     · 大型海洋生物（鲸鱼）—— 哺乳动物有肺，是水体中少见的"体积散射体"。
       *   尺度一律按真实尺寸建（平台 46 m、鲸鱼 12 m、沉车 4.6 m、轮胎 0.8 m、
       *   蛙人 1.9 m、珊瑚 3.4 m），不靠 scale 凑 —— 这样"量程 100 m 内布 5 个
       *   目标"时各目标的角尺度才是真实的。
       * ================================================================== */
      rig: {
        name: '水下钻井平台（导管架）', ts: 12, size: 46,
        build: function () {
          var p = [], c = COL.rigDeck;
          /* 导管架平台（jacket platform）：4 根主桩（略外倾）+ 三层水平撑
           * + 各面 X 形斜撑 + 上部甲板 + 井架 + 立管 + 桩腿上的防沉板。
           * 真实导管架的受力单元就是这些三角形，声学上它是一大片"角反射器阵列"，
           * 所以 TS 给到 +12 dB（比沉船高 20 dB，是水下最强的一类人造目标）。 */
          var H = 40, R0 = 8.5, R1 = 5.6;             // 泥面处 / 甲板处的桩距半径
          var legs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
          function legPos(s, h) {                      // 高度 h 处该腿的平面位置
            var t = h / H, r = R0 + (R1 - R0) * t;
            return [s[0] * r, s[1] * r];
          }
          // ① 四根主桩（分段：泥面以下 6 m 的入泥段 + 上部）
          legs.forEach(function (s) {
            var a = legPos(s, 0), b = legPos(s, H);
            p.push(rod((a[0] + b[0]) / 2, H / 2 - 3, (a[1] + b[1]) / 2,
              b[0] - a[0], H, b[1] - a[1], Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + H * H + (b[1] - a[1]) * (b[1] - a[1])), 0.62, c));
            // 入泥段（略粗，颜色深）
            p.push(rod(a[0], -3, a[1], 0, 1, 0, 6, 0.70, COL.dark));
            // 防沉板
            p.push(G(new THREE.BoxGeometry(2.6, 0.22, 2.6), m4(a[0], -2.4, a[1]), COL.dark));
          });
          // ② 三层水平撑（每层 4 根横杆，围成方框）
          [6, 18, 30, H].forEach(function (h, li) {
            for (var i = 0; i < 4; i++) {
              var s1 = legs[i], s2 = legs[(i + 1) % 4];
              var a = legPos(s1, h), b = legPos(s2, h);
              p.push(rod((a[0] + b[0]) / 2, h, (a[1] + b[1]) / 2, b[0] - a[0], 0, b[1] - a[1],
                Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1])), 0.30, c));
            }
          });
          // ③ 每个面的 X 形斜撑（两层之间交叉两根）
          [6, 18, 30].forEach(function (h0) {
            var h1 = (h0 === 6) ? 18 : (h0 === 18 ? 30 : H);
            for (var i = 0; i < 4; i++) {
              var s1 = legs[i], s2 = legs[(i + 1) % 4];
              var a = legPos(s1, h0), b = legPos(s2, h1);
              var c2 = legPos(s2, h0), d2 = legPos(s1, h1);
              [[a, b], [c2, d2]].forEach(function (pr) {
                p.push(rod((pr[0][0] + pr[1][0]) / 2, (h0 + h1) / 2, (pr[0][1] + pr[1][1]) / 2,
                  pr[1][0] - pr[0][0], h1 - h0, pr[1][1] - pr[0][1],
                  Math.sqrt((pr[1][0] - pr[0][0]) * (pr[1][0] - pr[0][0]) + (h1 - h0) * (h1 - h0) + (pr[1][1] - pr[0][1]) * (pr[1][1] - pr[0][1])), 0.22, COL.steel));
              });
            }
          });
          // ④ 甲板（主甲板 + 下层甲板）+ 甲板四周栏杆立柱
          p.push(G(new THREE.BoxGeometry(15, 0.5, 15), m4(0, H + 0.3, 0), COL.dark));
          p.push(G(new THREE.BoxGeometry(15, 0.4, 15), m4(0, H + 4.2, 0), COL.dark));
          for (var rr = 0; rr < 4; rr++) {
            var la = rr * 90 * DEG;
            p.push(rod(7.4 * Math.cos(la), H + 2.4, 7.4 * Math.sin(la), 0, 1, 0, 3.6, 0.10, COL.steel));
          }
          // ⑤ 井架（derrick）：四根立柱收成锥 + 顶部天车 + 二层台
          [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (s) {
            var x0 = s[0] * 2.4, z0 = s[1] * 2.4, x1 = s[0] * 0.9, z1 = s[1] * 0.9;
            p.push(rod((x0 + x1) / 2, H + 12.5, (z0 + z1) / 2, x1 - x0, 16, z1 - z0,
              Math.sqrt((x1 - x0) * (x1 - x0) + 256 + (z1 - z0) * (z1 - z0)), 0.24, COL.yellow));
          });
          p.push(G(new THREE.BoxGeometry(2.2, 0.7, 2.2), m4(0, H + 20.6, 0), COL.steel));
          p.push(G(new THREE.BoxGeometry(3.4, 0.18, 3.4), m4(0, H + 9.0, 0), COL.yellow));
          // ⑥ 钻杆立管（从井架中心垂直下到泥面）+ 井口盘
          p.push(rod(0, H / 2, 0, 0, 1, 0, H, 0.20, COL.steel));
          p.push(G(new THREE.CylinderGeometry(1.1, 1.1, 0.5, 18), m4(0, -1.2, 0), COL.dark));
          // ⑦ 生活模块（上层建筑）与两台吊机基座
          p.push(G(new THREE.BoxGeometry(6.0, 3.4, 4.4), m4(-4.6, H + 6.2, 3.6), COL.grey));
          p.push(G(new THREE.BoxGeometry(3.0, 2.6, 3.6), m4(4.8, H + 5.8, -3.4), COL.grey));
          [[3.2, -4.4], [-3.6, 4.2]].forEach(function (q) {
            p.push(G(new THREE.CylinderGeometry(0.42, 0.42, 2.2, 14), m4(q[0], H + 1.6, q[1]), COL.yellow));
            p.push(rod(q[0] + 0.5, H + 3.4, q[1], 2.6, 1.4, 0, 3.2, 0.16, COL.yellow));
          });
          return p;
        }
      },
      diver: {
        name: '蛙人', ts: -15, size: 1.9,
        build: function () {
          var p = [], w = COL.wetsuit;
          /* 蛙人：这是安检 / 港口警戒声呐最难的一类目标 ——
           * 人体组织的声阻抗与水接近，只有骨骼、气瓶（钢/铝）与呼吸气泡反射明显，
           * 实测 TS 在 −12 ~ −18 dB 之间（比水雷还弱 5 dB）。
           * 建模要点：① 躯干与四肢用回转体而非盒子（湿衣贴合、外形圆滑）；
           * ② 背后两只气瓶是钢瓶，是蛙人身上唯一的高反射部件；
           * ③ 脚蹼是长薄板，姿态略微上翘（游动中的典型姿态）。 */
          // 躯干：上宽下窄的回转体（湿衣包裹后的外形）
          p.push(lathe([
            [0.00, -0.62], [0.16, -0.60], [0.20, -0.42], [0.21, -0.10], [0.22, 0.20],
            [0.21, 0.44], [0.18, 0.58], [0.13, 0.66], [0.00, 0.68]
          ], 24, w, m4(0, 0, 0, 90, 0, 0, 1, 1, 1.15)));
          // 头 + 面镜（面镜是平面玻璃，正对来波时会有一次强镜面反射）
          p.push(G(new THREE.SphereGeometry(0.135, 20, 14), m4(0, 0.80, 0.10), w));
          p.push(G(new THREE.BoxGeometry(0.20, 0.10, 0.06), m4(0, 0.82, 0.22), COL.glass));
          // 双臂：肩 → 肘 → 手，前伸（游动姿态）
          [[1], [-1]].forEach(function (s) {
            var sg = s[0];
            p.push(rod(sg * 0.24, 0.44, 0, sg * 0.9, -0.35, 0.25, 0.44, 0.055, w));      // 上臂
            p.push(rod(sg * 0.52, 0.28, 0.12, sg * 0.8, 0.35, 0.75, 0.42, 0.048, w));     // 前臂
            p.push(G(new THREE.SphereGeometry(0.062, 10, 8), m4(sg * 0.70, 0.40, 0.36), w)); // 手
          });
          // 双腿 + 脚蹼
          [[1], [-1]].forEach(function (s) {
            var sg = s[0];
            p.push(rod(sg * 0.11, -0.80, 0, sg * 0.2, -1, 0.05, 0.48, 0.072, w));        // 大腿
            p.push(rod(sg * 0.16, -1.20, 0.03, sg * 0.15, -1, -0.25, 0.44, 0.060, w));   // 小腿
            // 脚蹼：长 0.62 m 的薄板，上翘 20°
            p.push(G(new THREE.BoxGeometry(0.20, 0.030, 0.62),
              m4(sg * 0.19, -1.52, -0.16, -70, 0, 0), 0x101820));
          });
          // 背部双瓶（钢瓶 Ø0.18 × 0.62 m）+ 一级头与中压管
          [[1], [-1]].forEach(function (s) {
            p.push(G(new THREE.CylinderGeometry(0.09, 0.09, 0.62, 16),
              m4(s[0] * 0.085, 0.20, -0.24, 90, 0, 0), COL.tank));
            p.push(G(new THREE.SphereGeometry(0.09, 12, 8), m4(s[0] * 0.085, 0.51, -0.24), COL.tank));
          });
          p.push(G(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 12), m4(0, 0.42, -0.20, 0, 0, 0), COL.steel));
          p.push(tube(0.10, 0.36, -0.06, 0, 0, 70, 0.34, 0.022, COL.black));
          // 配重带
          p.push(G(new THREE.BoxGeometry(0.30, 0.06, 0.16), m4(0, -0.34, 0.02), COL.black));
          return p;
        }
      },
      tire: {
        name: '轮胎（丢弃物）', ts: -22, size: 0.8,
        build: function () {
          var p = [];
          /* 轮胎：橡胶的声阻抗只比水高约 1.5 倍、且内部孔隙吸水，
           * 是水下出了名的"声学软目标"（TS ≈ −22 dB，比同尺寸钢构件弱 25 dB）。
           * 它被大量用作人工鱼礁正是因为这个特性：看得见、但不挡声。
           * 建模：主环（Torus）+ 两侧胎肩 + 24 组胎面花纹块 + 轮辋内圈。 */
          p.push(G(new THREE.TorusGeometry(0.40, 0.155, 16, 40), m4(0, 0, 0, 90, 0, 0), COL.rubber));
          p.push(G(new THREE.TorusGeometry(0.40, 0.150, 12, 40), m4(0, 0.005, 0, 90, 0, 0), 0x2c2f36));
          // 胎肩（内外各一圈略小的环，做出胎侧弧度）
          [0.13, -0.13].forEach(function (dy) {
            p.push(G(new THREE.TorusGeometry(0.395, 0.120, 10, 36), m4(0, dy, 0, 90, 0, 0), COL.rubber));
          });
          // 胎面花纹：24 组斜块，沿周向排布（真实胎面是块状花纹，不是光头胎）
          for (var i = 0; i < 24; i++) {
            var a = i * 15 * DEG;
            p.push(G(new THREE.BoxGeometry(0.075, 0.045, 0.20),
              m4(0.40 * Math.cos(a), 0.40 * Math.sin(a), 0, 0, 0, a * 180 / Math.PI + 78), 0x15171c));
          }
          // 轮辋（钢圈，是轮胎上唯一的高反射部件）
          p.push(G(new THREE.TorusGeometry(0.255, 0.045, 10, 32), m4(0, 0, 0, 90, 0, 0), COL.steel));
          p.push(G(new THREE.CylinderGeometry(0.075, 0.075, 0.10, 14), m4(0, 0, 0, 0, 0, 0), COL.steel));
          for (var k = 0; k < 5; k++) {
            var b = k * 72 * DEG;
            p.push(rod(0.15 * Math.cos(b), 0.15 * Math.sin(b), 0, Math.cos(b), Math.sin(b), 0, 0.16, 0.022, COL.steel));
          }
          return p;
        }
      },
      car: {
        name: '沉车（小汽车）', ts: -5, size: 4.6,
        build: function () {
          var p = [], cb = COL.carBody;
          /* 沉车：涉水事故与刑侦搜救的主要对象。
           * 声学上它是"强反射外壳 + 空腔"——车体钢板 TS 高（−5 dB 量级），
           * 但车窗玻璃与内饰是弱反射，因此声图上常呈现"车顶亮、侧窗暗"的特征。
           * 建模：车身用两段箱体（下部车身 + 上部舱室）做出真实的侧面轮廓，
           * 而不是一个盒子；四轮用扁圆柱（沉底后轮胎多已瘪）。 */
          // 下部车身
          p.push(G(new THREE.BoxGeometry(1.82, 0.62, 4.40), m4(0, 0.52, 0), cb));
          // 上部舱室（略窄、后移，做出三厢车轮廓）
          p.push(G(new THREE.BoxGeometry(1.62, 0.58, 2.10), m4(0, 1.10, -0.30), cb));
          // 前风挡 / 后风挡 / 侧窗（玻璃：弱反射，深色半透明感）
          p.push(G(new THREE.BoxGeometry(1.58, 0.50, 0.08), m4(0, 1.08, 0.78, -32, 0, 0), 0x9fc4d8));
          p.push(G(new THREE.BoxGeometry(1.58, 0.46, 0.08), m4(0, 1.08, -1.36, 30, 0, 0), 0x9fc4d8));
          [0.82, -0.82].forEach(function (x) {
            p.push(G(new THREE.BoxGeometry(0.06, 0.40, 1.90), m4(x, 1.12, -0.30), 0x9fc4d8));
          });
          // 发动机舱盖 + 行李箱盖的分缝
          p.push(G(new THREE.BoxGeometry(1.74, 0.05, 1.30), m4(0, 0.84, 1.52), 0x24405a));
          p.push(G(new THREE.BoxGeometry(1.74, 0.05, 0.90), m4(0, 0.84, -1.72), 0x24405a));
          // 四轮（Ø0.66 m，沉底后压扁一点）
          [[0.86, 1.42], [-0.86, 1.42], [0.86, -1.42], [-0.86, -1.42]].forEach(function (w) {
            p.push(G(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 18), m4(w[0], 0.30, w[1], 0, 0, 90), COL.rubber));
          });
          // 前后保险杠 + 大灯 + 后视镜
          [1.9, -1.9].forEach(function (z) {
            p.push(G(new THREE.BoxGeometry(1.86, 0.22, 0.16), m4(0, 0.52, z * 1.16), 0x3a4048));
          });
          [0.62, -0.62].forEach(function (x) {
            p.push(G(new THREE.BoxGeometry(0.34, 0.16, 0.10), m4(x, 0.68, 2.22), 0xdfe8ee));
          });
          [0.90, -0.90].forEach(function (x) {
            p.push(G(new THREE.BoxGeometry(0.16, 0.09, 0.22), m4(x, 1.06, 0.72), 0x3a4048));
          });
          // 车顶行李架（很多沉车带这个，是很好认的轮廓特征）
          [0.62, -0.62].forEach(function (x) {
            p.push(rod(x, 1.42, -0.30, 0, 0, 1, 1.30, 0.026, COL.steel));
          });
          return p;
        }
      },
      coral: {
        name: '大型珊瑚丛', ts: -16, size: 3.4,
        build: function () {
          var p = [];
          /* 大型珊瑚丛：底质分类与生态调查的对象。
           * 声学上它是"弥散体积散射体"——不是一两个亮点，而是几万根分枝各自
           * 散射的叠加，TS 随入射角变化平缓（−14 ~ −19 dB），且回波有明显的
           * 频率依赖（分枝尺度与波长可比）。
           * 建模：一个不规则基底 + 递归生成的分叉枝（每根枝再分 2~3 根），
           * 分枝逐级变细变短，末梢带一个小的膨大（珊瑚虫群体的形态）。 */
          function branch(x, y, z, dx, dy, dz, len, rad, depth) {
            if (depth <= 0 || rad < 0.018) return;
            var hx = x + dx * len / 2, hy = y + dy * len / 2, hz = z + dz * len / 2;
            p.push(rod(hx, hy, hz, dx, dy, dz, len, rad, depth > 2 ? COL.coral : COL.coral2));
            var bx = x + dx * len, by = y + dy * len, bz = z + dz * len;
            if (depth === 1) {
              p.push(G(new THREE.SphereGeometry(rad * 1.5, 8, 6), m4(bx, by, bz), COL.coral2));
              return;
            }
            var n = (depth % 2) ? 3 : 2;
            for (var i = 0; i < n; i++) {
              var a = i * (360 / n) * DEG + depth * 0.7;
              var spread = 0.55 + 0.12 * (3 - depth);
              var nx = dx * Math.cos(spread) + (Math.cos(a) * 0.62 + Math.sin(a) * 0.18) * spread;
              var nz = dz * Math.cos(spread) + (Math.sin(a) * 0.62 - Math.cos(a) * 0.18) * spread;
              var ny = dy * Math.cos(spread) + 0.30 * spread;
              var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
              branch(bx, by, bz, nx / nl, ny / nl, nz / nl, len * 0.68, rad * 0.62, depth - 1);
            }
          }
          // 基底：不规则钙质岩块（用扁球 + 几个附着的凸起）
          p.push(G(new THREE.SphereGeometry(0.90, 20, 12), m4(0, -0.35, 0, 0, 0, 0, 1, 0.55, 1), 0xb9a48c));
          for (var k = 0; k < 5; k++) {
            var b = k * 72 * DEG + 0.4;
            p.push(G(new THREE.SphereGeometry(0.26, 12, 8),
              m4(0.72 * Math.cos(b), -0.22, 0.72 * Math.sin(b), 0, 0, 0, 1, 0.6, 1), 0xb9a48c));
          }
          // 主枝 ×5（从基底不同位置长出，方向与粗细各不相同）
          var seeds = [[0.0, 0.0, 0.25], [0.52, -0.1, 0.34], [-0.48, -0.12, -0.30], [0.30, -0.08, -0.52], [-0.34, -0.06, 0.50]];
          for (var i2 = 0; i2 < seeds.length; i2++) {
            var s = seeds[i2];
            branch(s[0], s[1] + 0.05, s[2], s[0] * 0.30, 1, s[2] * 0.30, 1.15, 0.105, 4);
          }
          // 底部附着的几株小型软珊瑚（扇形，颜色更浅）
          for (var j2 = 0; j2 < 3; j2++) {
            var c = j2 * 120 * DEG;
            p.push(G(new THREE.SphereGeometry(0.30, 12, 8),
              m4(0.95 * Math.cos(c), -0.15, 0.95 * Math.sin(c), 0, 0, 0, 1.5, 0.14, 1.1), 0xf0b98a));
          }
          return p;
        }
      },
      whale: {
        name: '鲸鱼', ts: -10, size: 12,
        build: function () {
          var p = [];
          /* 鲸鱼：水体中少见的"体积散射体"。
           * 哺乳动物的肺（含气）是极强的反射体，肌肉与脂肪的声阻抗与水接近，
           * 骨骼又是强反射 —— 于是回波是"两三个强亮点 + 一片弱散射"的组合，
           * 实测 TS 在 −5 ~ −15 dB，随方位剧烈起伏（正横最弱、艏艉最强）。
           * 建模：一条型线回转出纺锤体（鲸的体形本就是回转体），
           * 再压扁成"背腹略扁"的横剖面；尾鳍、胸鳍、背鳍都是薄板。
           * 长 12 m（一头成年座头鲸的体长量级），最大直径约 2.6 m。 */
          p.push(lathe([
            [0.00, -5.6], [0.30, -5.1], [0.62, -4.2], [0.92, -3.0], [1.14, -1.6],
            [1.28, 0.0], [1.30, 1.4], [1.24, 2.6], [1.08, 3.6], [0.86, 4.5],
            [0.58, 5.2], [0.30, 5.7], [0.00, 5.95]
          ], 32, COL.whale, m4(0, 0, 0, 90, 0, 0, 0.82, 1, 1)));
          // 腹面（浅色，鲸腹的斑纹是识别特征，也让腹部与背部的回波有差别）
          p.push(lathe([
            [0.00, -5.4], [0.28, -4.9], [0.58, -4.0], [0.86, -2.8], [1.06, -1.4],
            [1.18, 0.2], [1.16, 1.6], [1.02, 2.8], [0.80, 3.8], [0.54, 4.7],
            [0.28, 5.3], [0.00, 5.6]
          ], 32, COL.whaleBelly, m4(0, -0.06, 0, 90, 0, 0, 0.80, 0.55, 0.96)));
          // 尾柄 + 尾鳍（水平展开的薄板，宽 3.0 m）
          p.push(lathe([[0.00, -5.6], [0.26, -5.9], [0.34, -6.4], [0.30, -6.9], [0.00, -7.05]],
            20, COL.whale, m4(0, 0, 0, 90, 0, 0, 0.8, 1, 1)));
          p.push(G(new THREE.BoxGeometry(3.0, 0.10, 1.0), m4(0, 0, -7.35, 0, 0, 0), COL.whale));
          [1, -1].forEach(function (s) {
            p.push(G(new THREE.BoxGeometry(1.30, 0.085, 0.72), m4(s * 1.55, 0, -7.55, 0, s * 12, 0), COL.whale));
          });
          // 胸鳍（一对，向后掠 35°）
          [1, -1].forEach(function (s) {
            p.push(G(new THREE.BoxGeometry(1.70, 0.11, 0.52), m4(s * 1.25, -0.18, 1.9, 0, s * (-28), s * 8), COL.whale));
          });
          // 背鳍（小型，位于体后 1/3 处）
          p.push(G(new THREE.BoxGeometry(0.16, 0.62, 0.58), m4(0, 1.24, -2.2, 0, 0, -12), COL.whale));
          // 头部：下颚的喉腹褶（须鲸的识别特征，5~7 道纵向沟）
          for (var i = 0; i < 7; i++) {
            var y = -0.55 - i * 0.055;
            p.push(G(new THREE.BoxGeometry(0.05, 0.05, 2.0), m4(0, y, 3.9, 0, 0, 0), COL.whaleBelly));
          }
          // 眼睛（小，位于口角后上方）
          [1, -1].forEach(function (s) {
            p.push(G(new THREE.SphereGeometry(0.075, 10, 8), m4(s * 1.05, 0.28, 4.55), COL.black));
          });
          // 喷气孔（头顶一对）
          [0.14, -0.14].forEach(function (x) {
            p.push(G(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 10), m4(x, 1.06, 4.30), COL.black));
          });
          return p;
        }
      }
    },
    MATERIALS: [
      { id: 'steel', name: '钢', ts: -15 },
      { id: 'alu', name: '铝', ts: -17 },
      { id: 'grp', name: '玻璃钢', ts: -23 },
      { id: 'rubber', name: '橡胶', ts: -29 },
      { id: 'water', name: '空腔充水', ts: -21 },
      { id: 'air', name: '空腔充气', ts: -8 }
    ],
    BOTTOM_MATS: [
      { id: 'mud', name: '泥' },
      { id: 'sand', name: '砂' },
      { id: 'gravel', name: '砾石' },
      { id: 'rock', name: '岩石' },
      { id: 'coral', name: '珊瑚' }
    ],
    /* 中文模式下显示纯中文名；英文原名放入 alias，在悬浮提示中给出便于对照文献 */
    SCAT_MODELS: [
      { id: 0, name: '朗伯散射模型', alias: 'Lambert：σ₀ = μ·cos²θ' },
      { id: 1, name: '基尔霍夫粗糙界面模型', alias: 'Biot / Kirchhoff（含毕奥粗糙界面修正）' },
      { id: 2, name: '经验海底散射公式', alias: 'Empirical（含掠射角增强项）' },
      /* ★ V1.4.1 新增：前视声呐的作业掠射角只有 5°~30°，朗伯模型在这里衰减太快
       * （σ₀ ∝ sin²θ_g，22°→6.4° 掉 19 dB），图像上表现为近场一条亮带、其余全黑。
       * 实测海底反向散射在低掠射段近似 σ₀ ∝ sinθ_g（指数 a≈1），故单列一档。 */
      { id: 3, name: '掠射指数律（前视声呐推荐）', alias: 'σ₀ = μ·sinθ_g（指数 a=1）' }
    ],
    tsOf: function (matId) {
      var m = FLS.Models.MATERIALS.filter(function (x) { return x.id === matId; })[0];
      return m ? m.ts : -15;
    },
    /** 抽取模型的三角面元（世界坐标），返回 {c:Float32Array(3N), n:Float32Array(3N), a:Float32Array(N)} */
    facets: function (parts, matrixWorld, maxFacet) {
      var pos = [], nrm = [], area = [];
      var vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(),
        e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3();
      parts.forEach(function (p) {
        var g = p.geom.index ? p.geom.toNonIndexed() : p.geom;
        var a = g.attributes.position.array;
        for (var i = 0; i < a.length; i += 9) {
          vA.set(a[i], a[i + 1], a[i + 2]).applyMatrix4(matrixWorld);
          vB.set(a[i + 3], a[i + 4], a[i + 5]).applyMatrix4(matrixWorld);
          vC.set(a[i + 6], a[i + 7], a[i + 8]).applyMatrix4(matrixWorld);
          e1.subVectors(vB, vA); e2.subVectors(vC, vA);
          nn.crossVectors(e1, e2);
          var len = nn.length();
          if (len < 1e-9) continue;
          var ar = 0.5 * len;
          nn.multiplyScalar(1 / len);
          pos.push((vA.x + vB.x + vC.x) / 3, (vA.y + vB.y + vC.y) / 3, (vA.z + vB.z + vC.z) / 3);
          nrm.push(nn.x, nn.y, nn.z);
          area.push(ar);
        }
      });
      var N = area.length;
      if (!N) return null;
      var stride = 1;
      if (maxFacet && N > maxFacet) stride = Math.ceil(N / maxFacet);
      var m = Math.floor(N / stride);
      var c = new Float32Array(3 * m), n2 = new Float32Array(3 * m), a2 = new Float32Array(m);
      for (var k = 0; k < m; k++) {
        var s = k * stride;
        c[3 * k] = pos[3 * s]; c[3 * k + 1] = pos[3 * s + 1]; c[3 * k + 2] = pos[3 * s + 2];
        n2[3 * k] = nrm[3 * s]; n2[3 * k + 1] = nrm[3 * s + 1]; n2[3 * k + 2] = nrm[3 * s + 2];
        var acc = 0;
        for (var q = 0; q < stride; q++) acc += area[s + q];
        a2[k] = acc;
      }
      return { c: c, n: n2, a: a2, count: m, totalTris: N };
    }
  };

  /* ---------------------------------------------------- 散射面元构建 */
  FLS.Scatter = {};

  /* ========================= 海底混响面元（V1.4 重写） =========================
   *
   * ★ 为什么要重写（V1.0~V1.3 的根本缺陷）
   *   V1.3 及以前用「在扇面内做 N_a×N_s 分层随机抽样」的方式布点：
   *     N_a = round(sqrt(budget·sector)) ≈ 59,  N_s = budget/N_a ≈ 28
   *   即方位 59 个点、距离 28 个点。而图像网格是 nBeam×nBin = 181×512 = 92,672 个
   *   分辨单元 —— 海底面元只覆盖 2,278 个单元（2.5%）。
   *   每个面元被 3.2° 的水平波束与 3×3 多视摊成一个「2~5° × 2.5 m 的软斑」，
   *   于是整幅图是「几十个大块亮度起伏」，而不是真实前视声呐那种
   *   「逐个分辨单元独立起伏的散斑场」。实测图像距离向自相关 25 个单元(3.4 m)、
   *   方位向半个扇区不衰减、局部极大值只占 0.5% 的单元。
   *
   * ★ V1.4 的做法：**一个分辨单元一个散射体**
   *   对每个方位单元（默认 = 波束栅格）沿地面剖面求出被垂直波束照亮的区间，
   *   再对区间内每个距离单元放一个面元：
   *     - 面元面积 dA = (s·Δθ) · (ΔR/|∂R/∂s|) / |n_z|   （真实的单元足迹面积）
   *     - 幅度 amp = sqrt(μ·dA)（与引擎的角度因子相乘后即 sqrt(σ0·dA)）
   *     - **相位取 [0,2π) 随机**（phaseOff）：真实粗糙界面在单元内的高程起伏
   *       远超 λ/(4π)，各散射体相位近似均匀分布。V1.3 的相位完全由距离决定，
   *       同距离的面元相干叠加 —— 实测把面元数从 5,000 提到 600,000，
   *       图像反而更平滑（距离向相邻差 4.12→1.17 dB），这在物理上是不可能的。
   *   ⇒ 每个单元一个独立随机相位散射体，波束形成输出的强度自然服从指数分布，
   *     即 Rayleigh 幅度散斑，起伏标准差 5.6 dB —— 与真实声呐一致。
   *
   * ★ 附加：地形自遮挡（声影）
   *   沿剖面跟踪「已见最大仰角」，低于它的地面点被前方地形挡住，不产生回波。
   *   这是真实图像中目标/山脊背后出现暗带的原因，V1.3 完全没有。
   *
   * 说明：本函数不再使用「面元预算」控制数量 —— 数量由几何（照亮区间）决定，
   *   这样混响电平与预算无关，改预算只影响计算量不影响亮度。
   *   ctx.cellStride 用于低精度档：方位按 2/4 个波束取一个单元、距离按 2/4 个
   *   单元取一个，以牺牲散斑细度换取速度。
   * ========================================================================= */
  FLS.Scatter.seafloor = function (ctx) {
    var P = FLS.P, st = FLS.state;
    if (!P['env.reverb']) return new Float32Array(0);
    // V3.0：地形不再有「隐藏」态，直接用 state.terrains，省掉一次 filter 分配
    // V3.1：地形层的数量不再决定有没有海床 —— 已确认的层已经烘进栅格了，
    //       所以这里不能再因为 terrains 为空就返回空数组（那样"删光地形层"
    //       会连带把混响一起弄没，而三维里海床明明还在）。
    var list = st.terrains;
    if (!list.length && !st.terrainBake) return new Float32Array(0);

    var rmax = P['alg.rmax'], rmin = Math.max(0.2, P['alg.rmin']);
    var sector = P['alg.sector'] * DEG;
    var nBeam = Math.max(2, P['alg.nBeam'] | 0);
    var nBin = Math.max(8, P['alg.nBin'] | 0);
    var vHalf = P['tx.vbeam'] * DEG / 2;
    var pose = ctx.pose;                                   // {pos:[x,y,z], fwd:[..], right:[..], up:[..]}
    var step = Math.max(1, Math.min(6, ctx.cellStride | 0));  // 1=最高精度
    var NA = Math.max(8, Math.round(nBeam / step));         // 方位单元数
    var dAz = sector / NA;
    var dRb = (rmax - rmin) / nBin;                         // 距离单元宽（m）
    var rnd = U.rng(ctx.seed);

    // 方位单元的角宽有限：太窄时相邻单元的散斑本应相关，多给随机数只是浪费。
    var sMin = 0.35, sMax = rmax * 1.2;
    var NP = 200;                                            // 每条剖面的采样数
    var sTab = new Float64Array(NP), rTab = new Float64Array(NP), eTab = new Float64Array(NP);
    var eSon = new Float64Array(NP);                          // ★ V3.7 声呐系仰角
    var zTab = new Float64Array(NP), dTab = new Float64Array(NP);
    var zTab2 = new Float64Array(NP);                        // 平滑剖面（仅用于遮挡判定）
    var maxR = new Float64Array(NP);                          // rTab 的运行最大值
    var vis = new Uint8Array(NP);
    var out = [];
    var elLim = vHalf * 1.6 + 3 * DEG;                       // 垂直维照亮截止（相对**声呐指向**）
    var MAXOUT = 260000;                                     // 安全上限（约 260k 面元）

    /* ★ V3.7：两个把「俯仰角」放进几何里的关键修正 —— 这是本轮"扇形图上出现
     *   亮色同心环 / 弯曲环形条带"的根因。
     *
     *   ① 水平射线方向必须是**单位向量**。
     *      旧写法直接取 pose.fwd[0..1]（fwd 含俯仰，其水平投影长度 = cos(pitch)）
     *      再去乘 cos(th)：|h|² = cos²th·cos²pitch + sin²th < 1。
     *      于是参数 s 不再是水平距离，而 s 与真实斜距的换算 rr = √(s²+dz²)
     *      也整体偏大 —— 俯仰 25° 时正前方 50 m 处偏大近 3 m（≈8 个距离门），
     *      而且各方位偏得不一样（正前方最多、±90° 为零），一条等距离线被拉成
     *      弯曲的弧。这就是"弯曲的环形条带"里那层几何扭曲。
     *      修法：先取 fwd / right 的水平投影并归一化，再用它们组方位射线。
     *      俯仰 = 0 时两者本来就等于原值，所以**横平姿态下的结果逐位不变**。
     *
     *   ② 照亮截止必须相对**声呐实际指向**，而不是相对水平面。
     *      旧写法 eTab[k] = atan2(dz, s) 是海床点相对水平面的俯角，判据
     *      |elj| ≤ vHalf·1.6+3° 与声呐朝哪看毫无关系 —— 声呐抬头 25° 之后，
     *      垂直主瓣（±10°）早已离开海床，面元却照旧铺满全扇面；这些面元不是
     *      被主瓣照亮的，而是被垂直 sinc 的第 2~5 旁瓣"照亮"的，于是等俯角
     *      （≈等距离）的旁瓣瓣峰被画成一圈圈亮环。
     *      修法：改用**声呐坐标系下的仰角** asin(u·up) 做截止（与引擎
     *      beamPat(asin(du)) 的判据完全同口径），抬头就没有面元，图像自然是
     *      暗的；低头则照亮区跟着往近端收。 */
    var upx = pose.up ? pose.up[0] : 0, upy = pose.up ? pose.up[1] : 0, upz = pose.up ? pose.up[2] : 1;
    var fhx = pose.fwd[0], fhy = pose.fwd[1], fhl = Math.sqrt(fhx * fhx + fhy * fhy);
    if (!(fhl > 1e-6)) { fhx = 1; fhy = 0; fhl = 1; }        // 指向正上/正下的退化情形
    fhx /= fhl; fhy /= fhl;
    var rhx = pose.right[0], rhy = pose.right[1], rhl = Math.sqrt(rhx * rhx + rhy * rhy);
    if (!(rhl > 1e-6)) { rhx = -fhy; rhy = fhx; rhl = 1; }   // 横滚 90° 的退化：取水平面内正交方向
    rhx /= rhl; rhy /= rhl;

    /* ---- ★ V1.4.1 目标声影：把每个目标的世界包围盒当作不透明体 ----
     * 真实前视声呐图像里，目标背后那道黑楔子（声影）是判读目标最有力的特征之一；
     * V1.3 及以前只有地形自遮挡，没有目标遮挡，所以"目标背后照旧亮"，看着很假。
     * 用轴对齐包围盒而不是包围球：沉船/管线这类细长目标用球会把影子摊成一大片，
     * 用盒至少能保住「影子沿目标长轴延伸」的形态。THREE 世界系 (x=E,y=U,z=−N)。 */
    var occl = null;
    if (P['env.shadow'] && typeof THREE !== 'undefined') {
      occl = [];
      st.targets.forEach(function (tg) {
        if (tg.visible === false) return;
        var obj = FLS.scene3d && FLS.scene3d.targetObjs && FLS.scene3d.targetObjs[tg.id];
        if (!obj) return;
        var bb = new THREE.Box3().setFromObject(obj);
        if (!isFinite(bb.min.x) || bb.isEmpty()) return;
        occl.push({
          e0: bb.min.x - 0.12, e1: bb.max.x + 0.12,
          n0: -bb.max.z - 0.12, n1: -bb.min.z + 0.12,
          u0: bb.min.y - 0.12, u1: bb.max.y + 0.12
        });
      });
      if (!occl.length) occl = null;
    }
    var sx0 = pose.pos[0], sy0 = pose.pos[1], sz0 = pose.pos[2];

    for (var ia = 0; ia < NA && out.length < MAXOUT * 11; ia++) {
      var th = -sector / 2 + (ia + 0.5) * dAz;
      var ca = Math.cos(th), sa = Math.sin(th);
      /* ★ V3.7：用归一化后的水平基组射线（见上面 ① 的说明），
         s 从此是真正的水平距离，rr = √(s²+dz²) 是真正的斜距。 */
      var hx = fhx * ca + rhx * sa;
      var hy = fhy * ca + rhy * sa;

      /* ---- ① 沿方位角切一条地面剖面：s（水平距离）→ 深度/斜距/仰角 ---- */
      for (var k = 0; k < NP; k++) {
        var s = sMin + (sMax - sMin) * k / (NP - 1);
        var px = pose.pos[0] + s * hx, py = pose.pos[1] + s * hy;
        var res = FLS.Terrain.compose(px, py);
        var zb = -res.d;
        var dz = zb - pose.pos[2];
        var rr = Math.sqrt(s * s + dz * dz);
        sTab[k] = s; zTab[k] = zb; rTab[k] = rr;
        /* ★ V3.7：仰角存两份 ——
         *   eTab  = 相对**水平面**的俯角（地形遮挡判据要用它，纯几何）；
         *   eSon  = 相对**声呐指向**的仰角 asin(u·up)，照亮截止用它，
         *           与引擎里 beamPat(asin(du), txV) 的判据完全同口径。 */
        eTab[k] = Math.atan2(dz, s);
        var rcp = 1 / Math.max(1e-6, rr);
        var duK = (s * hx * upx + s * hy * upy + dz * upz) * rcp;
        eSon[k] = Math.asin(duK > 1 ? 1 : (duK < -1 ? -1 : duK));
        dTab[k] = res.d;
      }

      /* 地形自遮挡（声影）：只有仰角不低于「此前已见最大仰角」的点才被照亮。
       * ★ V1.4.1 修：判据必须用**平滑后**的剖面。
       *   剖面采样间距只有 sMax/NP ≈ 0.42 m，而海底微地形（RMS 0.15 m）在
       *   0.42 m 内就能拉起 20° 的局部坡度——这个"坡度"本身比掠射角还大，
       *   于是把后面一整段海底判成声影。实测后果：模板③ 181×256 个分辨单元
       *   只落了 14 095 个面元（30%），图像上出现成片的硬黑洞和明暗跳变。
       *   物理上，宽度不足一个分辨单元的微起伏不会形成米级声影，因此这里用
       *   ±1 个采样点（约 0.84 m）的滑动平均做遮蔽判定，取位仍用原始剖面。 */
      var zS = zTab2;
      for (var ks = 0; ks < NP; ks++) {
        var a0 = ks > 0 ? ks - 1 : 0, a1 = ks < NP - 1 ? ks + 1 : NP - 1, ssum = 0;
        for (var qq = a0; qq <= a1; qq++) ssum += zTab[qq];
        zS[ks] = ssum / (a1 - a0 + 1);
      }
      var elMax = -1e9;
      for (var kv = 0; kv < NP; kv++) {
        var elv = Math.atan2(zS[kv] - pose.pos[2], sTab[kv]);
        if (elv >= elMax - 1e-4) { vis[kv] = 1; elMax = elv; } else vis[kv] = 0;
      }

      /* 运行最大值：剖面首次到达某斜距的判据（对非单调剖面也成立） */
      var mr = -1e9;
      for (var kr = 0; kr < NP; kr++) { if (rTab[kr] > mr) mr = rTab[kr]; maxR[kr] = mr; }

      /* ---- ② 沿剖面按距离单元布点 ----
       * ★ 关键：面元必须落在**该距离单元对应的精确斜距**上。
       *   V1.4 第一版把面元吸附到剖面采样点（间距 sMax/NP ≈ 0.42 m），
       *   而距离单元只有 0.135 m —— 于是只有 1/3 的单元里有回波，
       *   图像出现周期 3 个单元的亮暗梳纹（实测单波束剖面
       *   bins 148..155 = 157 102 99 154 97 97 156 93）。这里改为线性插值 +
       *   一次牛顿修正，把面元精确放到 R(s)=r_j 处。
       * ★ V1.4.1 再修：不能假设 R(s) 单调。
       *   地形一起伏（局部坡度超过掠射角），R(s) 就会回折：一段剖面段的
       *   两个端点落在「后一个比前一个更近」的状态，旧代码的 `r1 <= r0 → continue`
       *   直接把整格丢掉。实测模板③（泥底 rms 0.15 m、相关长度 40 m）：
       *   181×256 个单元只落了 14 095 个面元（30%），单波束剖面出现周期约 4 m、
       *   摆幅 ±20 dB 的明暗跳变 —— 图像上就是成片的硬黑洞。
       *   现在用「运行最大值 maxR 二分推进 + 局部窗口找跨越段」：先定位剖面
       *   首次到达 rj 的采样点 km，再在 [km-6, km+2] 里找一段真正跨越 rj 且
       *   两端都被照亮的段。平坦海底时窗口内的第一个候选就是原解，行为不变。 */
      var km = 0;
      for (var j = 0; j < nBin; j++) {
        var rj = rmin + (j + 0.5) * dRb;
        if (rj > rmax) break;
        while (km < NP - 1 && maxR[km] < rj) km++;              // 剖面首次到达 rj
        var kSel = -1;
        for (var kc = Math.max(0, km - 6), kcE = Math.min(NP - 2, km + 2); kc <= kcE; kc++) {
          if (!vis[kc] || !vis[kc + 1]) continue;               // 该段在声影里
          var ra = rTab[kc], rb = rTab[kc + 1];
          if ((ra < rj && rb >= rj) || (ra > rj && rb <= rj)) { kSel = kc; break; }
        }
        if (kSel < 0) continue;                                // 该单元无被照亮的穿越
        var kk = kSel;
        var r0 = rTab[kk], r1 = rTab[kk + 1];
        var elj = eTab[kk];                                    // 相对水平面的俯角（仅诊断用）
        /* ★ V3.7：照亮截止改用**声呐系仰角**（见上面 ②）。
           旧写法用 |eTab| ≤ elLim，等于假设"声呐永远朝水平看"——抬头 25° 之后
           垂直主瓣早就离开海床，面元却还铺到 100 m，全靠垂直 sinc 的旁瓣照亮，
           于是一条条等俯角的瓣峰被画成同心亮环。改成声呐系仰角后，抬头就没有
           面元（图像是暗的，物理上正确），低头照亮区跟着往近端收。
           俯仰 = 0 时 asin(u·up) 恒等于 atan2(dz, s)，所以**横平姿态逐位不变**。 */
        var fSeg = (r1 !== r0) ? (rj - r0) / (r1 - r0) : 0;
        if (fSeg < 0) fSeg = 0; else if (fSeg > 1) fSeg = 1;
        var elSon = eSon[kk] + (eSon[kk + 1] - eSon[kk]) * fSeg;
        if (Math.abs(elSon) > elLim) continue;                 // 在垂直波束之外

        // ---- 线性插值 + 牛顿修正：解 R(s) = rj ----
        var ds0 = sTab[kk + 1] - sTab[kk];
        var mz = (zTab[kk + 1] - zTab[kk]) / Math.max(1e-6, ds0);   // 局部 dz/ds
        var f = (rj - r0) / (r1 - r0);
        var sj = sTab[kk] + f * ds0;
        var zj = zTab[kk] + mz * (sj - sTab[kk]);
        var hz = zj - pose.pos[2];
        var Rc = Math.sqrt(sj * sj + hz * hz);
        var dRds = (sj + hz * mz) / Math.max(1e-6, Rc);
        if (dRds > 0.03) sj += (rj - Rc) / dRds;
        zj = zTab[kk] + mz * (sj - sTab[kk]);
        var pxj = pose.pos[0] + sj * hx, pyj = pose.pos[1] + sj * hy;

        // 地面法向（有限差分）
        var eps = Math.max(0.08, sj * 0.01);
        var nz0 = FLS.Terrain.normalAt(pxj, pyj, eps);

        /* ---- ③ 单元足迹面积 dA ----
         * 切向：s·Δθ （地面弧长）
         * 径向：dRb / ∂R/∂s  —— 平板海底 ∂R/∂s = s/R = cos(el)，即 Δs = ΔR/cos(el)
         * 坡度修正：除以 |n_z| 得真实面积。
         * ★ 掠射极限处 ∂R/∂s → 0，一个距离单元对应极长的一条地面带。
         *   这里按最长 1.2 m 拆成若干子面元（各自独立随机相位）—— 物理上也正确：
         *   单元内包含更多独立散射体，散斑起伏本来就该更小。 */
        if (!(dRds > 0.03)) dRds = 0.03;
        var dsTot = dRb / dRds;
        var nSub = Math.min(6, Math.max(1, Math.ceil(dsTot / 1.2)));
        var dsEach = dsTot / nSub;
        /* V3.1：底质随地形一起栅格化了 —— 栅格格点的主导层压根不在
         * state.terrains 里（它可能早就和其它层融成一张图了），所以不能再用
         * compose().idx 去 terrains 里反查。compose() 直接把解析好的
         * {bmat, smodel, rough} 带出来，这里拿来就用。 */
        var inst = FLS.Terrain.compose(pxj, pyj).mat || list[0] || DEF_MAT;
        var mu = FLS.Env.bottomMu(inst.bmat || 'sand');
        var modelCode = inst.smodel === undefined ? 0 : inst.smodel;
        var rough = (inst.rough === undefined ? 0.05 : inst.rough);
        var dA = (sj * dAz) * dsEach / Math.max(0.08, Math.abs(nz0.z));
        if (!(dA > 0) || !isFinite(dA)) continue;

        /* ---- ④ 目标声影：被目标挡住的海底面元不产生回波 ---- */
        if (occl) {
          var blocked = false;
          for (var oi = 0; oi < occl.length; oi++) {
            if (segHitsBox(sx0, sy0, sz0, pxj, pyj, zj, occl[oi])) { blocked = true; break; }
          }
          if (blocked) continue;
        }

        /* ---- ⑤ 沉积物非均匀性（V1.4.1）----
         * 真实海底不是统计均匀的：砂/砾/贝壳/淤泥斑块以及 cm~dm 级微地形，使局部
         * 散射强度在亚米~米级尺度上起伏约 ±3 dB。
         * 只给单元一个随机相位时，输出是"纯散斑"：相关长度在方位向等于波束宽度、
         * 在距离向等于压缩脉冲长度（2.5 cm）。显示上就表现为细长的方位向拉丝，
         * 与实拍前视声呐那种各向同性的颗粒/斑块纹理明显不同。
         * 这里叠一层各向同性的相关随机场 g（相关长度 PL、均值≈1），
         * 即局部散射截面按 g 起伏 → 纹理在距离向获得与方位向同量级的相关长度。 */
        var nv = fbm(pxj / 0.85, pyj / 0.85, 0.55, 3, 7919);
        var amp = Math.sqrt(mu * dA * Math.exp(0.62 * nv));
        if (nSub === 1) {
          out.push(pxj, pyj, zj, nz0.x, nz0.y, nz0.z, amp, modelCode, rough, 0, rnd() * 6.283185307179586);
        } else {
          var stepS = dsEach;
          for (var su = 0; su < nSub; su++) {
            var ssu = sj + (su - (nSub - 1) / 2) * stepS;
            if (ssu <= 0) continue;
            var zsu = zTab[kk] + mz * (ssu - sTab[kk]);
            out.push(pose.pos[0] + ssu * hx, pose.pos[1] + ssu * hy, zsu,
              nz0.x, nz0.y, nz0.z, amp, modelCode, rough, 0, rnd() * 6.283185307179586);
          }
        }
      }
    }
    return new Float32Array(out);
  };

  /** 目标散射面元：按面元把目标总散射截面 σ_TS 加权分配（入射余弦² 加权），stride=10 */
  FLS.Scatter.targets = function (ctx) {
    var st = FLS.state, P = FLS.P, out = [];
    st.targets.forEach(function (tg) {
      if (tg.visible === false) return;
      var obj = FLS.scene3d && FLS.scene3d.targetObjs[tg.id];
      if (!obj) return;
      var facetBudget = ({ low: 120, mid: 400, high: 1400 })[tg.fres || 'mid'];
      var fc = FLS.Models.facets(obj.userData.parts, obj.matrixWorld, facetBudget);
      if (!fc) return;
      /* ★ 坐标系换算（V1.2 修复的重大缺陷）
       * Models.facets() 对顶点施加的是 three.js 的 matrixWorld，输出落在
       *   three 世界坐标：x=E, y=U, z=−N
       * 而整条物理链路（引擎回波合成、海底面元生成、setScatterers 显示）统一使用
       *   ENU：x=E, y=N, z=U
       * 若不做换算，目标的 N 与 U 会被对调（且 N 反号），声学上被搬到另一个位置：
       *   例：载体 (0,0,−15) 处正前方 30 m、同深的目标 (E=0,N=30,U=−15)
       *       被解读成 (E=0,N=−15,U=−30) —— 跑到载体后方 15 m、深 30 m，
       *       既不在扇区内、也不在垂直波束内，于是「目标明明放在扫描扇区里却完全没有反映」。
       * 这里统一换算成 ENU，后续所有环节（入射余弦、指向性、显示）才自洽。 */
      for (var fcI = 0; fcI < fc.count; fcI++) {
        var ex = fc.c[3 * fcI], ey = -fc.c[3 * fcI + 2], ez = fc.c[3 * fcI + 1];
        fc.c[3 * fcI] = ex; fc.c[3 * fcI + 1] = ey; fc.c[3 * fcI + 2] = ez;
        var nx0 = fc.n[3 * fcI], ny0 = -fc.n[3 * fcI + 2], nz0 = fc.n[3 * fcI + 1];
        fc.n[3 * fcI] = nx0; fc.n[3 * fcI + 1] = ny0; fc.n[3 * fcI + 2] = nz0;
      }
      // 目标强度：TS = TS设置 + 20lg(缩放)
      var tsDb = (tg.ts !== undefined ? tg.ts : FLS.Models.tsOf(tg.mat));
      tsDb += 20 * Math.log10(Math.max(0.05, tg.scale || 1));
      var sigTot = U.db2pow(tsDb);                       // m²，线性域 10^(TS/10)
      // 第一遍：计算入射余弦² 加权
      var w = new Float32Array(fc.count), sum = 0;
      for (var i = 0; i < fc.count; i++) {
        var ux = ctx.pose.pos[0] - fc.c[3 * i], uy = ctx.pose.pos[1] - fc.c[3 * i + 1], uz = ctx.pose.pos[2] - fc.c[3 * i + 2];
        var L = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
        ux /= L; uy /= L; uz /= L;
        var ci = fc.n[3 * i] * ux + fc.n[3 * i + 1] * uy + fc.n[3 * i + 2] * uz;
        var ww = ci > 0 ? fc.a[i] * ci * ci : 0;
        w[i] = ww; sum += ww;
      }
      if (sum <= 0) return;
      for (var k = 0; k < fc.count; k++) {
        if (w[k] <= 0) continue;
        var sig = sigTot * w[k] / sum;
        // model = −1：目标面元的 σ 已由 TS 归一化，引擎不再施加角度因子
        // phaseOff = 0：目标各面元之间必须保持由几何决定的相干相位，
        //   否则镜面回波（glint）会被随机相位抹平，只剩非相干叠加的弱回波。
        out.push(fc.c[3 * k], fc.c[3 * k + 1], fc.c[3 * k + 2],
          fc.n[3 * k], fc.n[3 * k + 1], fc.n[3 * k + 2],
          Math.sqrt(sig), -1, 0.02, 0, 0);
      }
    });
    return new Float32Array(out);
  };

  /** 生成多途镜像副本（海面 / 海底一阶），复制面元并标记 pathType
   *  注意：镜像副本沿用原面元的 phaseOff —— 随机相位属于散射体本身，
   *  与传播路径无关；若给镜像副本另取随机相位，目标的多途干涉结构会被破坏。 */
  FLS.Scatter.multipath = function (base, ctx) {
    var P = FLS.P, out = [];
    var mS = P['env.mSurf'] && P['env.surfOn'];
    var mB = P['env.mBot'];
    if (!mS && !mB) return base;
    var n = base.length / 11;
    for (var i = 0; i < n; i++) {
      var o = i * 11;
      var ph0 = base[o + 10];
      if (mS) {
        out.push(base[o], base[o + 1], base[o + 2], base[o + 3], base[o + 4], base[o + 5], base[o + 6], base[o + 7], base[o + 8], 1, ph0);
        out.push(base[o], base[o + 1], base[o + 2], base[o + 3], base[o + 4], base[o + 5], base[o + 6], base[o + 7], base[o + 8], 2, ph0);
      }
      if (mB) {
        out.push(base[o], base[o + 1], base[o + 2], base[o + 3], base[o + 4], base[o + 5], base[o + 6], base[o + 7], base[o + 8], 3, ph0);
        out.push(base[o], base[o + 1], base[o + 2], base[o + 3], base[o + 4], base[o + 5], base[o + 6], base[o + 7], base[o + 8], 4, ph0);
      }
    }
    if (!out.length) return base;
    var all = new Float32Array(base.length + out.length);
    all.set(base, 0); all.set(out, base.length);
    return all;
  };

  /** 汇总一帧的全部散射面元
   *
   * ★ V1.4：一阶多途默认**只作用于目标**（env.revMpath 可开回海底）。
   *   理由是实测的：海底面元现在有 ~3.8 万个，海面镜像副本会让法向计算量翻 3 倍；
   *   而打开/关闭该选项，实测图像的距离剖面几乎不变（21m:134/131, 34m:131/138,
   *   47m:142/136, 60m:129/128）—— 海面一阶反射对海底混响的贡献被主混响淹没，
   *   而它对目标的「多径鬼影」才是有观测意义的部分。目标仍走完整多途。 */
  FLS.Scatter.build = function (ctx) {
    var sf = FLS.Scatter.seafloor(ctx);
    var tg = FLS.Scatter.targets(ctx);
    var sfOut = FLS.P['env.revMpath'] ? FLS.Scatter.multipath(sf, ctx) : sf;
    var tgOut = FLS.Scatter.multipath(tg, ctx);
    var all = new Float32Array(sfOut.length + tgOut.length);
    all.set(sfOut, 0); all.set(tgOut, sfOut.length);
    return { arr: all, nSurf: sfOut.length / 11, nTarget: tgOut.length / 11, nAll: all.length / 11 };
  };
})();
