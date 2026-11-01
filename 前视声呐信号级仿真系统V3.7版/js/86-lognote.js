/* ==========================================================================
 * 86-lognote.js —— 仿真日志便签（默认收起，点底部按钮弹出，可拖动）
 * --------------------------------------------------------------------------
 * V3.0 之前，仿真日志是右栏控制台固定三块之一，常年占着一块版面。
 * 但日志的实际用法是"出问题了回头翻记录"，平时刷屏的都是初始化信息 ——
 * 让它一直占地方不划算。现在改成：
 *
 *   底部控制台上放一个「📋 仿真日志」按钮 → 点击弹出一张便签纸 →
 *   看完点 × 或按 Esc 收起（也可按便签标题栏右侧的 ⋮⋮ 拖到别处）。
 *
 * ★ 为什么用 fixed 定位 + 手动拖动，而不是 draggable 属性：
 *   HTML5 的 draggable 会走"拖放"语义（dragstart/dragover/drop），
 *   在 Windows 上还要处理拖影与放置目标，做浮层拖动属于杀鸡用牛刀；
 *   这里直接监听 pointerdown/move/up 自己算偏移，代码短、行为可控。
 *
 * ★ 关闭用 .hide 的 display:none 而不是 visibility —— 隐藏时 FLS.log()
 *   依然在往 #logWin 里 append（日志要一直记，不能因为没打开就不记），
 *   display:none 下 append 照样生效，只是不可见；打开时补一次滚到底即可。
 * ========================================================================== */
(function () {
  var FLS = window.FLS || (window.FLS = {});
  var LN = {};
  FLS.LogNote = LN;

  var note = null, btn = null, grab = null, closeBtn = null, win = null;

  LN.init = function () {
    note = document.getElementById('logNote');
    btn = document.getElementById('btnLog');
    grab = document.getElementById('lnHd') && document.querySelector('#lnHd .ln-grab');
    closeBtn = document.getElementById('logClose');
    win = document.getElementById('logWin');
    if (!note) return;

    if (btn) btn.addEventListener('click', function () { LN.toggle(); });
    if (closeBtn) closeBtn.addEventListener('click', function () { LN.close(); });
    // Esc 关闭：只在便签打开时拦截，且让冒泡先走（避免抢掉弹窗的 Esc）
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && LN.isOpen()) { LN.close(); e.stopPropagation(); }
    }, true);
    if (grab) bindDrag();
  };

  LN.isOpen = function () { return !!note && !note.classList.contains('hide'); };

  LN.open = function () {
    if (!note) return;
    note.classList.remove('hide');
    if (btn) btn.classList.add('on');
    // 隐藏期间攒下的日志可能已经滚出视野，打开时补一次滚到底
    if (win) win.scrollTop = win.scrollHeight;
  };

  LN.close = function () {
    if (!note) return;
    note.classList.add('hide');
    if (btn) btn.classList.remove('on');
  };

  LN.toggle = function () { if (LN.isOpen()) LN.close(); else LN.open(); };

  /** 拖动便签：按住标题栏的 ⋮⋮ 拖。位置用 left/top 直接写，不借助 transform，
   *  因为便签本身带一个 rotate(-.5deg) 的装饰性旋转 —— 两者叠一起会让
   *  坐标换算变绕，分开存更省心。 */
  function bindDrag() {
    var dragging = false, ox = 0, oy = 0;
    grab.addEventListener('pointerdown', function (e) {
      dragging = true;
      var r = note.getBoundingClientRect();
      ox = e.clientX - r.left; oy = e.clientY - r.top;
      // 改成 left/top 定位（初始是 right/bottom），否则拖完一松手又弹回去
      note.style.left = r.left + 'px';
      note.style.top = r.top + 'px';
      note.style.right = 'auto';
      note.style.bottom = 'auto';
      grab.setPointerCapture && grab.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    grab.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var x = e.clientX - ox, y = e.clientY - oy;
      // 留 40 px 在视口内，别让它被拖到屏幕外找不回来
      var maxX = window.innerWidth - 40, maxY = window.innerHeight - 40;
      note.style.left = Math.max(-note.offsetWidth + 80, Math.min(maxX, x)) + 'px';
      note.style.top = Math.max(0, Math.min(maxY, y)) + 'px';
    });
    var end = function (e) {
      if (!dragging) return;
      dragging = false;
      grab.releasePointerCapture && e.pointerId != null && grab.releasePointerCapture(e.pointerId);
    };
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);
  }
})();
