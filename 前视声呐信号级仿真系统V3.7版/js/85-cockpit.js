/* ==========================================================================
 * 85-cockpit.js —— 驾控台（姿态仪 / 航向罗盘 / ROV 操控按键说明）
 * --------------------------------------------------------------------------
 * 挂在「前视声呐成像」栏左上角 mini 三维视口的正下方，共三块：
 *
 *   ① 姿态仪（ADI，Attitude Director Indicator）
 *      飞机驾舱里那个"天地球"：一条地平线把圆分成天（上）与地（下），
 *      地平线的**倾斜角 = 横滚 roll**、**离圆心的上下偏移 = 俯仰 pitch**。
 *      中间固定不动的是机体符号（飞机/潜器的"小翅膀"标记）。
 *
 *   ② 航向罗盘（HSI 的简化版）
 *      一张会转的罗盘卡：刻度盘随机艏转动，顶端三角固定指向机艏方向，
 *      于是三角压住的刻度就是当前航向角（正北 0°，顺时针增大）。
 *      用"卡转针不转"而不是"针转盘不转"，是为了和真实 HSI 一致 ——
 *      读起来是"机艏正对着哪个方位"，而不是"指针指到几"。
 *
 *   ③ ROV 操控按键说明
 *      新用户看到三维场景，第一反应是"这是张图"，不知道 ROV 是能用键盘开的。
 *      这里用键帽图标把 12 个按键的作用直接摊在眼前，不用去翻帮助弹窗。
 *      键帽在**按下时高亮**（keydown/keyup 监听），所以按一下就知道映射对不对。
 *
 * 数据来源：FLS.state.rov（heading / pitch / roll，单位：度）。
 *
 * ★ 为什么要节流：这两个表盘是纯装饰性读数，20 Hz 足够（人眼上限），
 *   而 canvas 2D 每画一次要走几十条路径。仿真跑起来时主循环是 30~60 Hz，
 *   不节流等于白白吃掉每帧 1~2 ms。这里按「值变了才画 + 最少间隔 45 ms」双重限制。
 * ========================================================================== */
(function () {
  var FLS = window.FLS || (window.FLS = {});
  var CK = {};
  FLS.Cockpit = CK;

  var DEG = Math.PI / 180;
  /** 刷新节流：最快 45 ms 一帧（≈22 Hz），且三个姿态角都没变时干脆不画 */
  var MIN_MS = 45, lastT = 0, lastKey = '';

  var adi = null, hsi = null, ctxA = null, ctxH = null;
  var elPitch = null, elHdg = null, keyGrid = null;

  /* V3.2：表盘改用「逻辑坐标 150×150 + ctx 缩放」画。
   * 背景：V3.2 把姿态仪/罗盘从右栏小格子挪到成像栏三维视口正下方并放大
   *      （CSS 让 canvas 吃掉一半列宽），如果继续按 canvas.width 当绘图坐标，
   *      固定 11px 的字号在 300px 的画布上会缩成蚂蚁；反之若沿用 150 的
   *      后备存储、靠 CSS 拉大，又会整体糊掉。
   * 做法：后备存储按「CSS 像素 × DPR」设定，绘图前 setTransform(k,0,0,k,0,0)
   *      把坐标压回 150×150 的逻辑空间 —— 字号 / 线宽 / 游标全都按比例放大，
   *      既清晰又不改一行几何代码。 */
  var CV_LOG = 150;                      // 逻辑设计尺寸（与旧版硬编码一致）
  var kA = 1, kH = 1;                    // 各自的缩放系数 = 后备存储边长 / CV_LOG

  /* ------------------------------------------------------------------ 按键表
   * 与「帮助 → 键盘控制」里的说明保持一致，也与 70-rov.js 的默认映射一致。
   * 分组：行进（前后左右平移） / 转向与俯仰 / 升降与横滚。 */
  var KEYS = [
    { g: '行进', items: [
      { k: 'W', d: '前进' }, { k: 'S', d: '后退' },
      { k: 'A', d: '左平移' }, { k: 'D', d: '右平移' }
    ] },
    { g: '转向 / 俯仰', items: [
      { k: '←', d: '左转' }, { k: '→', d: '右转' },
      { k: '↑', d: '抬头' }, { k: '↓', d: '低头' }
    ] },
    { g: '升降 / 横滚', items: [
      { k: 'Q', d: '上浮' }, { k: 'E', d: '下潜' },
      { k: 'Z', d: '左横滚' }, { k: 'C', d: '右横滚' }
    ] }
  ];
  /* keyup/keydown 用的规范化：把 event.key 统一成上面 KEYS 里的写法 */
  var NORM = {
    'w': 'W', 's': 'S', 'a': 'A', 'd': 'D', 'q': 'Q', 'e': 'E', 'z': 'Z', 'c': 'C',
    'arrowleft': '←', 'arrowright': '→', 'arrowup': '↑', 'arrowdown': '↓'
  };

  /* ------------------------------------------------------------------ 初始化 */
  CK.init = function () {
    adi = document.getElementById('adiCanvas');
    hsi = document.getElementById('hsiCanvas');
    elPitch = document.getElementById('ckPitch');
    elHdg = document.getElementById('ckHdg');
    keyGrid = document.getElementById('ckKeyGrid');
    if (adi) ctxA = adi.getContext('2d');
    if (hsi) ctxH = hsi.getContext('2d');
    buildKeys();
    bindKeyLight();
    CK.resize();          // 内含 CK.draw(true)
  };

  /**
   * V3.2：按 CSS 实际渲染尺寸重设两块表盘的后备存储（含 DPR），随后重画一次。
   * 必须在画布**可见**时调用（隐藏视图 clientWidth 为 0，量到的尺寸无意义）——
   * 所以挂在 app.resizeAll() 的 image 分支与切视图之后。
   */
  CK.resize = function () {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var fit = function (cv, which) {
      if (!cv) return 1;
      var w = cv.clientWidth || CV_LOG;
      var px = Math.max(CV_LOG, Math.round(w * dpr));
      if (cv.width !== px || cv.height !== px) {
        cv.width = px; cv.height = px;
      }
      return px / CV_LOG;
    };
    kA = fit(adi, 'adi');
    kH = fit(hsi, 'hsi');
    CK.draw(true);
  };

  /** 生成按键说明的键帽网格 */
  function buildKeys() {
    if (!keyGrid) return;
    var h = '';
    /* V3.0：三组各占一列、组内四个键竖排。
     * 一开始写成"每组一行、行内四对"（组名 + 键帽 + 说明 ×4），
     * 但按键区实际只有约 205 px 宽，一行塞 4 对必然折行，读起来是错位的
     * （"行进 W前进 S后退 A / D右平移"）。改竖排后宽度只需要 3×68 px，
     * 高度 4 行，正好塞满这块地方。 */
    KEYS.forEach(function (grp) {
      h += '<div class="ck-kgrp"><span class="ck-kgrp-nm">' + grp.g + '</span>';
      h += '<div class="ck-krow">';
      grp.items.forEach(function (it) {
        h += '<span class="ck-kitem">' +
          '<kbd class="ck-key" data-k="' + it.k + '">' + it.k + '</kbd>' +
          '<span class="ck-kd">' + it.d + '</span></span>';
      });
      h += '</div></div>';
    });
    keyGrid.innerHTML = h;
  }

  /** 按下时高亮对应键帽 —— 让用户按一下就能确认"这个键管这个动作" */
  function bindKeyLight() {
    var set = function (k, on) {
      if (!keyGrid) return;
      var el = keyGrid.querySelector('.ck-key[data-k="' + k + '"]');
      if (el) el.classList.toggle('on', on);
    };
    window.addEventListener('keydown', function (e) {
      if (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      var k = NORM[(e.key || '').toLowerCase()];
      if (k) set(k, true);
    });
    window.addEventListener('keyup', function (e) {
      var k = NORM[(e.key || '').toLowerCase()];
      if (k) set(k, false);
    });
    // 切走窗口时把所有高亮清掉，否则回来会看到"卡住"的亮键
    window.addEventListener('blur', function () {
      if (!keyGrid) return;
      keyGrid.querySelectorAll('.ck-key.on').forEach(function (x) { x.classList.remove('on'); });
    });
  }

  /* ------------------------------------------------------------ 姿态仪（ADI） */
  /**
   * 画法：
   *   ① 把画布原点移到圆心，先按 −roll 转（这样地平线在屏幕上斜 roll 角）；
   *   ② 画"天"（上）与"地"（下）两个大半圆，分界线就是地平线；
   *   ③ 地平线相对圆心的纵向偏移 = pitch 对应的像素（每度 pxPerDeg）；
   *   ④ 上面盖一层固定不动的机体符号与俯仰刻度梯。
   * 注意：转的是画布而不是几何体 —— 这样"地"永远是屏幕下方的大半圆，
   * 地平线自然倾斜，与真实陀螺地平仪的表现一致。
   */
  function drawADI(pitch, roll) {
    if (!ctxA) return;
    var c = ctxA;
    // 清屏必须按物理像素清（此时还没加缩放变换）
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, adi.width, adi.height);
    c.setTransform(kA, 0, 0, kA, 0, 0);            // 进入 150×150 逻辑坐标
    var W = CV_LOG, H = CV_LOG, cx = W / 2, cy = H / 2, R = W / 2 - 2;

    c.save();
    c.beginPath(); c.arc(cx, cy, R, 0, 2 * Math.PI); c.clip();

    // 天地球的移动范围：±90° 对应 ±R（这样 90° 时地平线正好推到圆边缘）
    var pxPerDeg = R / 45;                       // 每度像素（±45° 推到 ±R）
    var off = Math.max(-R * 2, Math.min(R * 2, pitch * pxPerDeg));

    c.save();
    c.translate(cx, cy);
    c.rotate(-roll * DEG);
    c.translate(0, off);

    // 天（上）：浅蓝；地（下）：土黄（与三维海床的沙土黄同一套色系，视觉上呼应）
    var big = R * 3;
    c.fillStyle = '#5b9bd5';
    c.fillRect(-big, -big, big * 2, big);
    c.fillStyle = '#b8945a';
    c.fillRect(-big, 0, big * 2, big);
    // 地平线
    c.strokeStyle = '#ffffff'; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(-big, 0); c.lineTo(big, 0); c.stroke();

    // 俯仰刻度梯：0° 最长，±10/±20/±30 依次缩短
    c.strokeStyle = '#ffffff'; c.lineWidth = 1.6;
    c.font = 'bold 11px ui-monospace,Consolas,monospace';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (var d = -30; d <= 30; d += 10) {
      if (d === 0) continue;
      var y = -d * pxPerDeg;
      var half = (d % 20 === 0) ? R * 0.42 : R * 0.24;
      c.beginPath(); c.moveTo(-half, y); c.lineTo(half, y); c.stroke();
    }
    // 0° 基准线略长、加粗
    c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(-R * 0.55, 0); c.lineTo(R * 0.55, 0); c.stroke();
    c.restore();

    /* 横滚刻度：外圈固定的小刻线（0/±10/±20/±30/±45），
     * 与顶端的三角游标配合读横滚角 —— 游标不动、刻度盘转。 */
    c.save();
    c.translate(cx, cy);
    c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1.4;
    [0, 10, 20, 30, 45, -10, -20, -30, -45].forEach(function (a) {
      var rr = -90 * DEG + a * DEG;
      var len = (a === 0) ? 10 : ((a % 30 === 0) ? 8 : 5);
      c.beginPath();
      c.moveTo(Math.cos(rr) * R, Math.sin(rr) * R);
      c.lineTo(Math.cos(rr) * (R - len), Math.sin(rr) * (R - len));
      c.stroke();
    });
    c.restore();
    c.restore();                                   // 解除圆形裁剪

    /* 机体符号（固定）：中间一个小圆点 + 两侧"机翼"短横。
     * 真实 ADI 的机体符号是固定不动的，天地球绕着它转 —— 这是关键，
     * 反过来（符号转）会让人分不清"是我在转还是地平线在转"。 */
    c.strokeStyle = '#ffd23f'; c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx - R * 0.52, cy); c.lineTo(cx - R * 0.17, cy);
    c.moveTo(cx + R * 0.17, cy); c.lineTo(cx + R * 0.52, cy);
    c.stroke();
    c.fillStyle = '#ffd23f';
    c.beginPath(); c.arc(cx, cy, 3, 0, 2 * Math.PI); c.fill();

    // 外圈
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, R, 0, 2 * Math.PI); c.stroke();
  }

  /* ---------------------------------------------------------- 航向罗盘（HSI） */
  /**
   * 画法：整张刻度盘按 −heading 转，顶端的三角游标固定。
   * 于是游标压住的刻度 = 当前航向。N/E/S/W 四个方位字随盘一起转，
   * 所以转到顶端的那个字母就是"机艏正对的方位"。
   */
  function drawHSI(hdg) {
    if (!ctxH) return;
    var c = ctxH;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, hsi.width, hsi.height);
    c.setTransform(kH, 0, 0, kH, 0, 0);
    var W = CV_LOG, H = CV_LOG, cx = W / 2, cy = H / 2, R = W / 2 - 2;

    c.save();
    c.beginPath(); c.arc(cx, cy, R, 0, 2 * Math.PI); c.clip();

    // 盘面底色
    var gr = c.createRadialGradient(cx, cy, R * 0.15, cx, cy, R);
    gr.addColorStop(0, '#20303f'); gr.addColorStop(1, '#101a24');
    c.fillStyle = gr; c.fillRect(0, 0, W, H);

    c.save();
    c.translate(cx, cy);
    c.rotate(-hdg * DEG);                          // 刻度盘随机艏转

    // 每 10° 一小刻、每 30° 一大刻并标数字
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (var d = 0; d < 360; d += 10) {
      var a = (d - 90) * DEG;                      // 0° 画在正上方
      var big = (d % 30 === 0);
      var r1 = R - (big ? 15 : 9), r2 = R - 2;
      c.strokeStyle = big ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.45)';
      c.lineWidth = big ? 2 : 1.2;
      c.beginPath();
      c.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      c.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      c.stroke();
      if (big) {
        var rt = R - 27;
        c.fillStyle = 'rgba(255,255,255,.9)';
        c.font = 'bold 11px ui-monospace,Consolas,monospace';
        c.fillText(String(d / 10), Math.cos(a) * rt, Math.sin(a) * rt);
      }
    }
    // 四方位字：N 红（正北），其余白
    [['N', 0, '#ff6b5e'], ['E', 90, '#e8eef5'], ['S', 180, '#e8eef5'], ['W', 270, '#e8eef5']].forEach(function (q) {
      var a = (q[1] - 90) * DEG, rt = R - 44;
      c.fillStyle = q[2];
      c.font = 'bold 13px ui-monospace,Consolas,monospace';
      c.fillText(q[0], Math.cos(a) * rt, Math.sin(a) * rt);
    });
    c.restore();
    c.restore();                                   // 解除裁剪

    // 顶端固定游标（机艏指向）
    c.fillStyle = '#ffd23f';
    c.beginPath();
    c.moveTo(cx, cy - R + 1);
    c.lineTo(cx - 7, cy - R + 13);
    c.lineTo(cx + 7, cy - R + 13);
    c.closePath(); c.fill();

    c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, R, 0, 2 * Math.PI); c.stroke();
  }

  /* ------------------------------------------------------------------ 刷新 */
  /**
   * @param {boolean} force 忽略节流与"值未变"判断，立即重画（切视图、改主题时用）
   */
  CK.draw = function (force) {
    var r = (FLS.state && FLS.state.rov) ? FLS.state.rov : null;
    if (!r) return;
    var hdg = ((r.heading || 0) % 360 + 360) % 360;
    var pitch = r.pitch || 0, roll = r.roll || 0;

    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    var key = hdg.toFixed(1) + '|' + pitch.toFixed(1) + '|' + roll.toFixed(1);
    if (!force && key === lastKey) return;                // 姿态没动：不画
    if (!force && (now - lastT) < MIN_MS) return;         // 节流
    lastKey = key; lastT = now;

    drawADI(pitch, roll);
    drawHSI(hdg);
    if (elPitch) elPitch.textContent = (pitch >= 0 ? '+' : '') + pitch.toFixed(1) + '°';
    if (elHdg) elHdg.textContent = hdg.toFixed(1) + '°';
  };

  /* 切换深浅主题时表盘的配色跟着换（天地球与盘底都是硬编码色，必须重画一次） */
  if (FLS.Theme && FLS.Theme.onChange) FLS.Theme.onChange(function () { CK.draw(true); });
})();
