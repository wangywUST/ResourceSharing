/* =============================================================
   lab-kit.js —— 交互式仿真实验台统一框架
   全局命名空间：window.DSP.lab

   为什么要有它：10 个实验台的"骨架"完全一样——
     参数控件区 → 图形区 → 实时文字解读 → 参数建议/工程注意/常见错误
   把骨架抽出来，每个实验台只写"参数定义 + 更新函数 + 解读文字"，
   既保证体验一致（含 URL 参数同步、主题重绘、窗口缩放重绘），
   也避免十份重复的样板代码。

   用法：
     DSP.lab.create({
       path:'lab/dft', title:'…', lede:'…', tags:['变换','交互'],
       params:[ {k:'N', type:'slider', label:'FFT 点数 N', min:32,max:1024,step:32,value:256, fmt:v=>v},
                {k:'win', type:'select', label:'窗函数', options:[{value:'rect',label:'矩形'}], value:'rect', hint:'…'},
                {k:'mode', type:'seg', label:'模式', options:[{value:'a',label:'A'}], value:'a'},
                {k:'on',  type:'toggle', label:'显示…', value:true},
                {k:'x',   type:'number', label:'…', value:1, min:0, max:10, step:0.1} ],
       plots:[ {key:'time', title:'时域波形', height:240, opts:{xlabel:'t / ms', ylabel:'幅度', legend:true}},
               {key:'spec', title:'频谱', height:260, type:'plot'} ],
       update: function(st, P, ui){       // P[key] = {plot, canvas}
         P.spec.plot.clear().add({x:…,y:…,label:'…'}).draw();
         ui.explain('**当前**：…');        // 实时文字解读（支持极简 md）
         ui.metrics([{label:'主瓣宽',value:4,unit:'bin'}]);
       },
       advice:'参数调整建议…',
       eng:'工程使用注意事项…',
       wrong:'常见错误示范…',
       see:[{path:'theory/transform/dft', title:'DFT 理论页'}]
     });
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP || (global.DSP = {});
  const U = DSP.util;
  const UI = DSP.ui;
  const h = U.h;

  /** 控件工厂 */
  function mkCtrl(d, st, onChange) {
    const o = {
      label: d.label, min: d.min, max: d.max, step: d.step, value: d.value,
      unit: d.unit, hint: d.hint, fmt: d.fmt, digits: d.digits,
      options: d.options,
      onInput: v => { st[d.k] = v; onChange(d.k, v); },
      onChange: v => { st[d.k] = v; onChange(d.k, v); }
    };
    switch (d.type) {
      case 'select': return UI.select(o);
      case 'seg': return UI.seg(o);
      case 'toggle': return UI.toggle(o);
      case 'number': return UI.number(o);
      default: return UI.slider(o);
    }
  }

  /** 从 URL 参数恢复状态 */
  function initState(params) {
    const st = {};
    const p0 = {};
    try { Object.assign(p0, DSP.share.params()); } catch (e) {}
    params.forEach(d => {
      let v = d.value;
      const raw = p0[d.k];
      if (raw !== undefined && raw !== '') {
        if (d.type === 'slider' || d.type === 'number') {
          const n = parseFloat(raw);
          if (!isNaN(n)) v = n;
        } else if (d.type === 'toggle') {
          v = (raw === '1' || raw === 'true');
        } else {
          v = raw;
        }
      }
      st[d.k] = v;
    });
    return st;
  }

  function create(spec) {
    return DSP.router.register(spec.path, {
      title: spec.title,
      lede: spec.lede,
      tags: spec.tags || ['交互实验台'],
      render: function (el) {
        const params = spec.params || [];
        const st = initState(params);
        const P = {};          // key → {plot, canvas, box}
        let explainEl = null, explainBody = null, metricsEl = null, extraEl = null;
        let cleaningUp = false;

        /* ---------- 1. 参数区 ---------- */
        const ctrls = [];
        params.forEach(d => {
          const c = mkCtrl(d, st, (k, v) => { if (!cleaningUp) update(); });
          ctrls.push(c);
        });

        const resetBtn = UI.button('重置参数', function () {
          params.forEach((d, i) => {
            st[d.k] = d.value;
            const c = ctrls[i];
            if (c.set) c.set(d.value, true);
          });
          update();
          UI.toast('参数已重置');
        }, 'sm ghost');

        const ctrlHost = h('div.card', { style: { marginBottom: 'var(--sp-4)' } }, [
          h('div.card-hd', {}, [
            h('span.accent-bar'),
            h('span', { text: '参数控制区' }),
            h('div.right', {}, [
              h('span.small.dim', { text: '拖动参数，图形与解读实时更新' }),
              resetBtn
            ])
          ]),
          h('div.card-bd', {}, [
            UI.ctrlPanel('', ctrls.map(c => c.el), spec.ctrlExtra || null)
          ])
        ]);
        el.appendChild(ctrlHost);

        /* ---------- 2. 图形区 ---------- */
        const plots = spec.plots || [];
        const gridCls = plots.length > 1 && (spec.cols === 2) ? 'grid g2' : '';
        const plotHost = h('div' + (gridCls ? '.' + gridCls.split(' ').join('.') : ''));
        plots.forEach(pd => {
          const box = UI.plotBox({ title: pd.title, caption: pd.caption });
          const entry = { canvas: box.canvas, box: box.el, plot: null, def: pd };
          if (!pd.type || pd.type === 'plot') {
            entry.plot = DSP.plot.new(box.canvas, Object.assign({
              height: pd.height || 240, xlabel: '', ylabel: '', legend: false
            }, pd.opts || {}));
          }
          P[pd.key] = entry;
          plotHost.appendChild(box.el);
        });
        el.appendChild(plotHost);

        /* ---------- 3. 自定义区（实验台可自行插入 DOM） ---------- */
        extraEl = h('div');
        el.appendChild(extraEl);

        const ui = {
          explain: function (mdText) {
            explainBody.innerHTML = U.md(mdText || '');
            // 解读文字每次都会重写，其中的 $…$ 公式必须重新渲染（否则只剩 LaTeX 源码）
            DSP.ui.renderMathIn(explainBody);
            if (DSP.glossary) DSP.glossary.annotate(explainBody);
          },
          metrics: function (list) {
            U.clear(metricsEl);
            (list || []).forEach(m => metricsEl.appendChild(h('div.metric', {}, [
              h('div.m-l', { text: m.label }),
              h('div.m-v', { text: String(m.value) }),
              m.unit ? h('div', {}, h('span.m-u', { text: m.unit })) : null
            ])));
            metricsEl.style.display = (list && list.length) ? '' : 'none';
          },
          extra: function (node) { U.clear(extraEl); if (node) extraEl.appendChild(node); },
          state: st
        };

        /* ---------- 4. 实时解读 ---------- */
        explainEl = h('div.callout.note', {}, [
          h('div.co-t', { text: '画面解读（随参数实时更新）' })
        ]);
        explainBody = h('div');
        explainEl.appendChild(explainBody);
        metricsEl = h('div.metrics', { style: { marginTop: '8px' } });

        // 供实验台把自定义 DOM（播放条、对照表等）插到解读区之前
        if (spec.build && typeof spec.build === 'function') {
          try { spec.build(el, ui, P, st); } catch (e) { console.error('[lab] build error', e); }
        }
        el.appendChild(explainEl);
        el.appendChild(metricsEl);

        /* ---------- 5. 更新循环 ---------- */
        function update() {
          try {
            spec.update(st, P, ui);
          } catch (e) {
            console.error('[lab] update error @' + spec.path, e);
            ui.explain('更新出错：' + (e && e.message));
          }
          try { DSP.share.syncParams(st); } catch (e) {}
        }
        update();

        /* ---------- 6. 提示三件套 + 关联知识页 ---------- */
        const tail = h('div.doc-section', { id: 'sec-tips' }, [
          h('h2', {}, [h('span', { text: '这个实验怎么用' })])
        ]);
        if (spec.advice) tail.appendChild(UI.callout('tip', '参数调整建议', spec.advice));
        if (spec.eng) tail.appendChild(UI.callout('eng', '工程使用注意事项', spec.eng));
        if (spec.wrong) tail.appendChild(UI.callout('pit', '常见错误示范', spec.wrong));
        if (spec.see && spec.see.length) {
          tail.appendChild(h('div', { style: { marginTop: 'var(--sp-3)' } }, [
            h('div.k', { style: { fontWeight: '650', marginBottom: '6px', color: 'var(--text-strong)', fontSize: '13px' }, text: '配套知识点' }),
            h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
              spec.see.map(s => h('a.btn.sm.ghost', { href: '#/' + s.path, text: '📘 ' + s.title })))
          ]));
        }
        el.appendChild(tail);

        /* ---------- 清理 ---------- */
        return function cleanup() {
          cleaningUp = true;
          if (spec.cleanup && typeof spec.cleanup === 'function') {
            try { spec.cleanup(); } catch (e) {}
          }
        };
      }
    });
  }

  DSP.lab = { create: create, mkCtrl: mkCtrl, initState: initState };
})(window);
