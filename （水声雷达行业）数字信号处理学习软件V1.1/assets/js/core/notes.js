/* =============================================================
   notes.js —— 全局笔记（localStorage 持久化 + 右侧抽屉 + 页内联块）
   全局命名空间：window.DSP.notes

   存储结构： dspLab:notes = { "<页面路径>": { text, updated, title } }
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP || (global.DSP = {});
  const U = DSP.util;
  const h = U.h;

  const KEY = 'notes';

  function all() { return U.store.get(KEY, {}) || {}; }
  function get(path) { const n = all()[path]; return n ? n.text : ''; }
  function set(path, text, title) {
    const n = all();
    if (!text || !text.trim()) {
      delete n[path];
    } else {
      n[path] = { text: text, updated: Date.now(), title: title || path };
    }
    U.store.set(KEY, n);
    refreshUI();
    return true;
  }
  function remove(path) { const n = all(); delete n[path]; U.store.set(KEY, n); refreshUI(); }
  function count() { return Object.keys(all()).length; }

  /** 导出全部笔记为 Markdown */
  function exportAll() {
    const n = all();
    const APPn = (global.DSP && global.DSP.APP) || { name: '数字信号处理知识学习实践系统', version: 'V1.1' };
    const lines = ['# 我的学习笔记 — ' + APPn.name + ' ' + APPn.version, '',
      '> 导出时间：' + U.stamp() + '　共 ' + Object.keys(n).length + ' 条', ''];
    Object.keys(n).sort().forEach(p => {
      lines.push('## ' + (n[p].title || p) + '　`#/' + p + '`');
      lines.push('');
      lines.push(n[p].text);
      lines.push('');
      lines.push('*更新于 ' + U.stamp(new Date(n[p].updated)) + '*');
      lines.push('');
    });
    return lines.join('\n');
  }

  /* ------------------------- 右侧抽屉 ------------------------- */
  let drawer = null, curPath = '';

  function buildDrawer() {
    if (drawer) return drawer;
    drawer = h('div', { id: 'notes-drawer' });
    document.body.appendChild(drawer);
    return drawer;
  }

  function renderDrawer() {
    const d = buildDrawer();
    U.clear(d);
    const note = all()[curPath] || { text: '', title: curPath };

    d.appendChild(h('div.nd-hd', {}, [
      h('span', { text: '📝 笔记' }),
      h('div.sp', {}, [
        h('button.btn.sm.ghost', {
          text: '导出全部',
          onclick: () => {
            const txt = exportAll();
            U.download('DSP笔记_' + U.stamp().replace(/[-: ]/g, '') + '.md', txt, 'text/markdown');
            DSP.ui.toast('笔记已导出');
          }
        }),
        h('button.btn.icon.ghost', { text: '✕', onclick: () => toggle(false) })
      ])
    ]));

    const body = h('div.nd-bd', {}, [
      h('div', { class: 'small dim', style: { marginBottom: '6px' } }, [
        h('span', { text: '当前页面：' }),
        h('code', { text: curPath || '—' })
      ]),
      (function () {
        const ta = h('textarea', { placeholder: '在此记录你对本页知识点的理解、疑问或工程经验…（自动保存到本机浏览器）' });
        ta.value = note.text || '';
        const save = U.debounce(function () {
          set(curPath, ta.value, document.title);
        }, 400);
        ta.addEventListener('input', function () {
          status.textContent = '输入中…（自动保存）';
          save();
        });
        var status = h('span', { class: 'small muted', text: note.updated ? '上次保存：' + U.stamp(new Date(note.updated)) : '未保存' });
        const wrap = h('div', {}, [ta, h('div', { style: { marginTop: '6px' } }, [status])]);
        return wrap;
      })(),
      h('hr', { class: 'hr' }),
      h('div', { class: 'small', style: { fontWeight: '700', color: 'var(--text-faint)', marginBottom: '6px' } },
        '全部笔记（' + count() + '）'),
      (function () {
        const n = all();
        const keys = Object.keys(n).sort((a, b) => (n[b].updated || 0) - (n[a].updated || 0));
        if (!keys.length) return h('div.nd-empty', { text: '还没有笔记。在任意页面右上角点击「笔记」即可记录。' });
        return h('div', {}, keys.map(k => h('div.nd-item', {}, [
          h('a.ni-path', {
            href: '#/' + k, text: n[k].title || k,
            onclick: () => toggle(false)
          }),
          h('div.ni-time', { text: U.stamp(new Date(n[k].updated)) }),
          h('div.ni-txt', { text: n[k].text.length > 160 ? n[k].text.slice(0, 160) + '…' : n[k].text }),
          h('div.ni-act', {}, [
            h('button.btn.sm.ghost', { text: '跳转', onclick: () => { location.hash = '#/' + k; toggle(false); } }),
            h('button.btn.sm.ghost', { text: '删除', onclick: function () { remove(k); } })
          ])
        ])));
      })()
    ]);
    d.appendChild(body);
  }

  function toggle(open) {
    const d = buildDrawer();
    if (open === undefined) open = !d.classList.contains('open');
    if (open) { curPath = DSP.router ? DSP.router.currentPath() : ''; renderDrawer(); }
    d.classList.toggle('open', open);
  }

  function refreshUI() {
    if (drawer && drawer.classList.contains('open')) renderDrawer();
    const badge = U.qs('#note-count');
    if (badge) {
      const c = count();
      badge.textContent = c ? String(c) : '';
      badge.style.display = c ? '' : 'none';
    }
  }

  /* ------------------------- 页内联笔记块 ------------------------- */
  function noteBlock(path, title) {
    const saved = get(path);
    const ta = h('textarea', { placeholder: '记录本节的要点 / 疑问 / 工程经验…（保存在本机）' });
    ta.value = saved || '';
    const status = h('span', { text: saved ? '已保存 ' + (all()[path] ? U.stamp(new Date(all()[path].updated)) : '') : '未保存' });
    const save = U.debounce(function () {
      set(path, ta.value, (title || path) + ' — 数字信号处理学习软件');
      status.textContent = '已保存 ' + U.stamp();
    }, 500);
    ta.addEventListener('input', function () { status.textContent = '输入中…'; save(); });
    return h('div.inline-note', {}, [
      h('div.in-hd', {}, [
        h('span', { text: '📝 本节笔记' }),
        h('div.sp', {}, [
          h('button.btn.sm.ghost', {
            text: '清空', onclick: function () { ta.value = ''; set(path, ''); status.textContent = '已清空'; }
          })
        ])
      ]),
      ta,
      h('div.in-ft', {}, [status, h('span', { text: '· 笔记保存在本机浏览器，换设备不会同步' })])
    ]);
  }

  DSP.notes = {
    all, get, set, remove, count, exportAll,
    toggle, refreshUI, noteBlock, setPath: p => { curPath = p; }
  };
})(window);
