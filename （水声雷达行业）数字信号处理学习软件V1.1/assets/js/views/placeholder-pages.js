/* =============================================================
   placeholder-pages.js —— 兜底页面
   在所有内容模块加载完毕后执行：扫描导航树，为"尚未注册视图"的
   叶子路由补一个说明页，保证点击任何目录项都不会白屏。
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP;
  const U = DSP.util;
  const UI = DSP.ui;
  const h = U.h;

  const missing = DSP.nav.flat.filter(f => !DSP.router.views[f.path]);

  missing.forEach(f => {
    DSP.router.register(f.path, {
      title: f.title,
      lede: '本节内容正在补充中，你可以先在这里记录疑问，或用下方入口前往相关章节。',
      tags: [f.group || '建设中'],
      render: function (el) {
        el.appendChild(UI.callout('note', '内容建设中',
          '「' + f.title + '」的详细内容将在后续版本补充。当前可用的相关内容入口见下。'));
        el.appendChild(h('div.grid.g3', {}, [
          card('📘 知识理论库', '信号分类、采样、变换、滤波、谱估计、阵列', 'theory/basic/sampling'),
          card('🎛️ 交互实验台', '10 个可调参数的仿真实验', 'lab/sampling'),
          card('📡 工程案例', '声呐与雷达真实处理链路', 'cases/sonar/pulse-compression')
        ]));
        el.appendChild(h('hr', { class: 'hr' }));
        el.appendChild(h('div.small.dim', { text: '页面路径：#/' + f.path }));
      }
    });
  });

  function card(t, d, path) {
    return h('a.card', { href: '#/' + path, style: { display: 'block', textDecoration: 'none', color: 'inherit' } },
      h('div.card-bd', {}, [
        h('div', { style: { fontWeight: '650', color: 'var(--text-strong)' }, text: t }),
        h('div.small.dim', { style: { marginTop: '4px' }, text: d })
      ]));
  }

  if (missing.length) {
    console.warn('[placeholder] 以下路由尚未实现，已用占位页兜底：', missing.map(m => m.path).join(', '));
  } else {
    console.log('%c[placeholder] 全部导航路由均已实现，无占位页', 'color:#0f766e');
  }
})(window);
