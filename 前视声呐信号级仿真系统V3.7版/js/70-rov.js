/* =========================================================================
 * 70-rov.js —— ROV 载体运动控制（键盘实时控制 / 预设航迹自动巡航）
 *   规则：只有在「仿真已启动且未暂停」时，键盘控制才生效；暂停时载体静止。
 *   坐标系：ENU（E 东, N 北, U 天），航向角自正北顺时针，俯仰艏上为正，横滚右滚为正。
 * ========================================================================= */
(function () {
  var U = FLS.U, DEG = U.DEG;
  var R = { lastTrail: null };
  FLS.Rov = R;

  var KEYACT = {
    fore: 'f+', back: 'f-', left: 'r-', right: 'r+', up: 'u+', down: 'u-',
    yawL: 'yaw-', yawR: 'yaw+', pitchUp: 'pitch+', pitchDn: 'pitch-', rollL: 'roll-', rollR: 'roll+'
  };

  R.init = function () {
    window.addEventListener('keydown', function (e) {
      if (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      var code = e.code || e.key;
      FLS.state.keys[code] = true;
      /* 方向键一律吃掉默认行为，否则视口/面板会跟着滚动 */
      if (/^Arrow|^Space/.test(code)) e.preventDefault();
      if (!FLS.state.running || FLS.state.paused) {
        // 提示名单从当前键位表动态取，避免新增动作后漏提示（原先硬编码且漏了方向键）
        var km = FLS.state.keyMap || {}, bound = [];
        Object.keys(km).forEach(function (a) { if (km[a]) bound.push(km[a]); });
        if (bound.indexOf(code) >= 0 && !e.repeat)
          FLS.log('提示：请先启动仿真（仿真未运行，键盘控制不生效）。', 'warn');
        return;
      }
    });
    window.addEventListener('keyup', function (e) {
      FLS.state.keys[e.code || e.key] = false;
    });
    window.addEventListener('blur', function () { FLS.state.keys = {}; });
  };

  R.axes = function () { return FLS.scene3d.bodyAxes(FLS.state.rov); };

  /** 由参数初始化载体位姿 */
  R.reset = function () {
    var P = FLS.P;
    FLS.state.rov = {
      x: P['rov.x'], y: P['rov.y'], z: P['rov.z'],
      heading: P['rov.heading'], pitch: P['rov.pitch'], roll: P['rov.roll']
    };
    FLS.state.trails = [];
    FLS.state.trackIdx = 0;
    FLS.state.simTime = 0;
    FLS.scene3d.setTrack([]);
  };

  /** 解析航点序列 "E,N,U;E,N,U;…" */
  R.parseTrack = function () {
    var s = FLS.P['rov.track'] || '';
    var out = [];
    s.split(/[;；]/).forEach(function (seg) {
      var v = seg.split(/[,，\s]+/).map(parseFloat).filter(function (x) { return !isNaN(x); });
      if (v.length >= 3) out.push([v[0], v[1], v[2]]);
      else if (v.length === 2) out.push([v[0], v[1], FLS.state.rov.z]);
    });
    FLS.state.track = out;
    return out;
  };

  /** 单步推进 dt 秒 */
  R.update = function (dt) {
    var st = FLS.state, P = FLS.P, r = st.rov;
    if (!st.running || st.paused) return;
    st.simTime += dt;
    var ax = R.axes();
    var vLin = P['rov.linVel'], wAng = P['rov.angVel'];

    if (P['rov.mode'] === 'route') {
      /* —— V1.3 航路规划巡航 ——
       * 与「预设航迹」的区别：
       *   ① 航点只给水平位置 E/N，绝对高度由**离水底高度** alt 反算
       *      （U = −depth(e,n) + alt），所以地形起伏或手工编辑后航路自动贴合；
       *   ② 每段用该航点自带的 spd，段与段之间速度可以不同。 */
      var rt = st.route || [];
      if (!rt.length) {
        if (!R._noRouteWarned) { FLS.log('航路为空：请先在三维视口点「打点」添加航点。', 'warn'); R._noRouteWarned = 1; }
      } else {
        R._noRouteWarned = 0;
        var i0 = ((st.routeIdx % rt.length) + rt.length) % rt.length;
        var wp2 = rt[i0];
        var tu = -FLS.Terrain.depth(wp2.e, wp2.n) + (wp2.alt || 0);
        var de = wp2.e - r.x, dn = wp2.n - r.y;
        var dhw = Math.sqrt(de * de + dn * dn);
        if (dhw < 1.5 && Math.abs(r.z - tu) < 1.2) {
          var nx = i0 + 1;
          if (nx >= rt.length) nx = st.routeLoop ? 0 : rt.length - 1;
          st.routeIdx = nx;
          wp2 = rt[nx];
          tu = -FLS.Terrain.depth(wp2.e, wp2.n) + (wp2.alt || 0);
          de = wp2.e - r.x; dn = wp2.n - r.y;
          dhw = Math.sqrt(de * de + dn * dn);
          FLS.log('航路：抵达 #' + (i0 + 1) + '，进入第 ' + (nx + 1) + ' 段（速度 ' + (wp2.spd || 1).toFixed(2) + ' m/s）。');
        }
        var sp2 = Math.max(0.05, parseFloat(wp2.spd) || 1);
        // 航向平滑转向目标航点
        var want2 = Math.atan2(de, dn) / DEG;
        var dh3 = ((want2 - r.heading + 540) % 360) - 180;
        r.heading += U.clamp(dh3, -wAng * dt * 2, wAng * dt * 2);
        // 水平推进：单步不超过本段剩余距离，避免在航点附近过冲抖动
        if (dhw > 1e-6) {
          var step = Math.min(sp2 * dt, dhw);
          r.x += de / dhw * step; r.y += dn / dhw * step;
        }
        // 高度向「离底 alt」收敛 —— 地形变化时航路自动跟随
        r.z += (tu - r.z) * Math.min(1, dt * 0.9);
        var wantP2 = Math.atan2(tu - r.z, Math.max(0.5, dhw)) / DEG;
        r.pitch += (wantP2 - r.pitch) * Math.min(1, dt * 0.8);
        r.roll *= (1 - Math.min(1, dt));
      }
    } else if (P['rov.mode'] === 'track') {
      // —— 预设航迹自动巡航 ——
      if (!st.track || !st.track.length) R.parseTrack();
      if (st.track && st.track.length) {
        var wp = st.track[Math.min(st.trackIdx, st.track.length - 1)];
        var dx = wp[0] - r.x, dy = wp[1] - r.y, dz = wp[2] - r.z;
        var dh = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dh < 1.2) { st.trackIdx = (st.trackIdx + 1) % st.track.length; wp = st.track[st.trackIdx]; }
        var sp = P['rov.trackSpeed'];
        // 航向平滑转向目标航点
        var want = Math.atan2(wp[0] - r.x, wp[1] - r.y) / DEG;
        var dh2 = ((want - r.heading + 540) % 360) - 180;
        var maxTurn = wAng * dt * 2;
        r.heading += U.clamp(dh2, -maxTurn, maxTurn);
        var vx = (wp[0] - r.x), vy = (wp[1] - r.y), vz = (wp[2] - r.z);
        var L = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
        r.x += vx / L * sp * dt; r.y += vy / L * sp * dt; r.z += vz / L * sp * dt;
        // 俯仰跟随航点高度差
        var wantPitch = Math.atan2(vz, Math.max(0.1, Math.sqrt(vx * vx + vy * vy))) / DEG;
        r.pitch += (wantPitch - r.pitch) * Math.min(1, dt * 0.8);
        r.roll *= (1 - Math.min(1, dt));
      }
    } else {
      // —— 手动键盘漫游 ——
      var k = st.keys, km = st.keyMap;
      function on(act) { var code = km[act]; return code && (k[code] || k[code.replace('Key', '')] || k[code.replace('Digit', '')]); }
      var f = 0, rr = 0, uu = 0;
      if (on('fore')) f += 1;
      if (on('back')) f -= 1;
      if (on('right')) rr += 1;
      if (on('left')) rr -= 1;
      if (on('up')) uu += 1;      // Q 沿本体上浮
      if (on('down')) uu -= 1;    // E 沿本体下潜
      r.x += (ax.fwd[0] * f + ax.right[0] * rr + ax.up[0] * uu) * vLin * dt;
      r.y += (ax.fwd[1] * f + ax.right[1] * rr + ax.up[1] * uu) * vLin * dt;
      r.z += (ax.fwd[2] * f + ax.right[2] * rr + ax.up[2] * uu) * vLin * dt;
      /* 「提高 / 降低高度」（← →）走**世界天向**而非本体系：
       * 高度是相对海面的绝对量，用本体系会在有俯仰/横滚时把升沉耦合进水平位移，
       * 操作员按「升高 1 m」的直觉就會對不上。本体轴的微调留给 Q / E。 */
      var hv = 0;
      if (on('heaveUp')) hv += 1;
      if (on('heaveDn')) hv -= 1;
      if (hv) r.z += hv * vLin * dt;
      if (on('yawL')) r.heading -= wAng * dt;
      if (on('yawR')) r.heading += wAng * dt;
      if (on('pitchUp')) r.pitch += wAng * dt;
      if (on('pitchDn')) r.pitch -= wAng * dt;
      if (on('rollL')) r.roll -= wAng * dt;
      if (on('rollR')) r.roll += wAng * dt;
    }
    // 约束
    r.heading = ((r.heading + 180) % 360 + 360) % 360 - 180;
    r.pitch = U.clamp(r.pitch, -60, 60);
    r.roll = U.clamp(r.roll, -60, 60);
    var zbot = -FLS.Terrain.depth(r.x, r.y) + 1.2;
    if (r.z < zbot) { r.z = zbot; }
    if (r.z > -0.5) { r.z = -0.5; }
    // 轨迹
    var p = [r.x, r.y, r.z];
    if (!R.lastTrail || dist(p, R.lastTrail) > 0.4) {
      st.trails.push(p); R.lastTrail = p;
      if (st.trails.length > 4000) st.trails.shift();
      FLS.scene3d.setTrack(st.trails);
    }
  };
  function dist(a, b) { return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2])); }

  /** 键盘映射编辑界面 */
  R.editKeys = function () {
    var labels = {
      fore: '前进（沿艏向）', back: '后退',
      yawL: '左转（航向−）', yawR: '右转（航向+）',
      pitchUp: '抬头（俯仰+）', pitchDn: '低头（俯仰−）',
      heaveUp: '提高高度（世界天向+）', heaveDn: '降低高度（世界天向−）',
      up: '本体上浮', down: '本体下潜',
      left: '左平移（默认未绑定）', right: '右平移（默认未绑定）',
      rollL: '左横滚', rollR: '右横滚'
    };
    var html = '<table style="font-size:12px"><tr><th>动作</th><th>按键</th></tr>';
    Object.keys(labels).forEach(function (k) {
      html += '<tr><td>' + labels[k] + '</td><td><input class="kb" data-k="' + k + '" value="' + (FLS.state.keyMap[k] || '') + '" style="width:120px;font-family:monospace"></td></tr>';
    });
    html += '</table><div style="margin-top:8px;color:#5a6879">点击输入框后按下新按键即可修改；支持 KeyW / ArrowLeft 等 code 写法。</div>';
    FLS.modal('键盘快捷键设置', html, [
      {
        t: '恢复默认', fn: function () {
          FLS.state.keyMap = Object.assign({}, FLS.DEFAULTS.keyMap);
          FLS.ok('键盘映射已恢复默认（W/S 前后、A/D 转向、↑↓ 俯仰、←→ 高度、Q/E 本体升沉、Z/C 横滚）。');
        }
      },
      { t: '保存', primary: true, fn: function () { } }
    ]);
    var mask = document.getElementById('modalMask');
    mask.querySelectorAll('input.kb').forEach(function (inp) {
      inp.addEventListener('keydown', function (e) {
        e.preventDefault();
        inp.value = e.code || e.key;
        FLS.state.keyMap[inp.dataset.k] = inp.value;
        inp.blur();
      });
    });
  };
})();
