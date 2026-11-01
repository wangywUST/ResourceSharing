/* =============================================================
   share.js —— 分享链接 / 页面导出 / 参数恢复
   全局命名空间：window.DSP.share

   能力：
     1. 生成分享链接：把当前页面路径 + 交互参数编码进 URL hash
     2. 解析参数：页面初始化时读取，恢复实验台状态
     3. 导出页面：把当前页面（含公式 LaTeX、笔记、表格）导出为 Markdown 文本
   ============================================================= */
(function (global) {
  'use strict';

  const DSP = global.DSP || (global.DSP = {});
  const U = DSP.util;
  const h = U.h;

  /** 当前页面路径（去掉参数） */
  function currentPath() {
    return U.hashParts().path;
  }

  /** 当前参数对象 */
  function params() {
    return U.hashParts().params;
  }

  /** 生成分享链接（可附加/覆盖参数） */
  function link(extra, path) {
    const p = Object.assign({}, params(), extra || {});
    const base = location.href.split('#')[0];
    return base + U.buildHash(path || currentPath(), p);
  }

  /** 复制分享链接 */
  function copyLink(extra, path) {
    const url = link(extra, path);
    U.copy(url).then(() => DSP.ui.toast('分享链接已复制'));
    return url;
  }

  /**
   * 把交互参数写回地址栏（不触发路由跳转）
   * 用于滑块拖动时保持链接可分享
   */
  function syncParams(obj) {
    const p = Object.assign({}, params(), obj);
    const newHash = U.buildHash(currentPath(), p);
    if (newHash !== location.hash) {
      history.replaceState(null, '', newHash);
    }
  }

  /* ------------------------- 页面导出 ------------------------- */

  /** DOM → Markdown（保留标题层级、公式、表格、代码、列表、提示） */
  function domToMd(root) {
    const out = [];
    function walk(node, depth) {
      for (let i = 0; i < node.childNodes.length; i++) {
        const c = node.childNodes[i];
        if (c.nodeType === 3) {
          const t = c.nodeValue.replace(/\s+/g, ' ');
          if (t.trim()) out.push(t.trim() + ' ');
          continue;
        }
        if (c.nodeType !== 1) continue;
        if (c.classList.contains('no-export')) continue;
        const tag = c.tagName;

        if (/^H[1-6]$/.test(tag)) {
          const lv = parseInt(tag[1], 10);
          out.push('\n\n' + '#'.repeat(Math.min(lv, 6)) + ' ' + textOf(c) + '\n\n');
          continue;
        }
        if (tag === 'P') { out.push('\n' + textOf(c) + '\n'); continue; }
        if (tag === 'LI') { out.push('\n- ' + textOf(c)); continue; }
        if (tag === 'PRE') { out.push('\n\n```\n' + c.textContent + '\n```\n'); continue; }
        if (tag === 'CODE' && c.parentElement.tagName !== 'PRE') { out.push('`' + c.textContent + '`'); continue; }
        if (tag === 'TABLE') {
          const rows = U.qsa('tr', c);
          if (rows.length) {
            rows.forEach((r, ri) => {
              const cells = U.qsa('th,td', r).map(td => textOf(td).replace(/\|/g, '\\|'));
              out.push('\n| ' + cells.join(' | ') + ' |');
              if (ri === 0) out.push('\n| ' + cells.map(() => '---').join(' | ') + ' |');
            });
            out.push('\n');
          }
          continue;
        }
        // 公式：优先用 data-tex（原始 LaTeX）
        if (c.classList.contains('math-block') || c.dataset.tex) {
          out.push('\n\n$$\n' + (c.dataset.tex || textOf(c)) + '\n$$\n\n');
          continue;
        }
        if (c.classList.contains('callout')) {
          out.push('\n> **' + textOf(U.qs('.co-t', c) || c) + '** ' + textOf(c) + '\n');
          continue;
        }
        if (tag === 'CANVAS') {
          out.push('\n\n*[此处为交互图形，请在网页中查看]*\n\n');
          continue;
        }
        if (c.classList.contains('katex')) continue;   // 跳过公式渲染产物
        walk(c, depth + 1);
      }
    }
    walk(root, 0);
    return out.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  function textOf(el) {
    if (!el) return '';
    // 公式用 LaTeX 源码占位
    const clone = el.cloneNode(true);
    U.qsa('[data-tex]', clone).forEach(n => { n.textContent = ' $' + n.dataset.tex + '$ '; });
    U.qsa('.katex', clone).forEach(n => n.remove());
    U.qsa('canvas', clone).forEach(n => n.replaceWith(document.createTextNode('[图]')));
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /** 导出当前页面（含笔记）为 Markdown 文件 */
  function exportPage(o) {
    o = o || {};
    const root = o.root || U.qs('#view') || document.body;
    const title = o.title || document.title.replace(/\s*·.*$/, '') || '页面';
    const path = currentPath();
    const note = DSP.notes.get(path);

    const lines = [];
    lines.push('# ' + title);
    lines.push('');
    const APPs = (global.DSP && global.DSP.APP) || { name: '数字信号处理知识学习实践系统', version: 'V1.1' };
    lines.push('> 来源：' + APPs.name + ' ' + APPs.version + '　页面路径：`#/' + path + '`');
    lines.push('> 导出时间：' + U.stamp() + '　分享链接：' + link());
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(domToMd(root));
    if (note && note.trim()) {
      lines.push('\n\n---\n\n## 📝 我的笔记\n\n' + note + '\n');
    }
    const text = lines.join('\n');
    if (o.download !== false) {
      const fname = (title.replace(/[\\/:*?"<>|\s]+/g, '_') || 'page') + '_' + U.stamp().replace(/[-: ]/g, '') + '.md';
      U.download(fname, text, 'text/markdown');
      DSP.ui.toast('页面已导出为 Markdown');
    }
    return text;
  }

  /** 导出为纯文本（去标记，便于粘贴到 Word / 微信） */
  function exportPlain(root, title) {
    const md = domToMd(root || U.qs('#view'));
    const txt = md
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .replace(/\$\$/g, '')
      .replace(/^>\s*/gm, '');
    U.download((title || '页面') + '.txt', txt, 'text/plain');
    DSP.ui.toast('已导出为文本');
  }

  /** 顶栏下拉：分享 / 导出 菜单 */
  function menu(anchorEl) {
    const body = h('div', {}, [
      h('div', { class: 'small dim', style: { marginBottom: '10px' } }, '把当前页面或实验参数分享给同学 / 同事'),
      h('div.btn-row', {}, [
        h('button.btn.primary', {
          text: '复制分享链接',
          onclick: function () { copyLink(); this.closest('.modal-mask').remove(); }
        }),
        h('button.btn', {
          text: '导出为 Markdown',
          onclick: function () { exportPage(); this.closest('.modal-mask').remove(); }
        }),
        h('button.btn', {
          text: '导出为纯文本',
          onclick: function () { exportPlain(); this.closest('.modal-mask').remove(); }
        })
      ]),
      h('hr', { class: 'hr' }),
      h('div.small.dim', {}, [
        h('div', { text: '分享链接会把当前交互参数一并写入地址栏，对方打开即可复现你调好的实验状态。' }),
        h('div', { text: '导出内容包含公式的 LaTeX 源码与本机笔记。' })
      ]),
      h('div', { style: { marginTop: '10px' } }, [
        h('input', {
          type: 'text', readonly: true, value: link(),
          style: { fontSize: '12px' }
        })
      ])
    ]);
    DSP.ui.modal({ title: '分享与导出', body: body });
  }

  DSP.share = {
    currentPath, params, link, copyLink, syncParams,
    domToMd, exportPage, exportPlain, menu
  };
})(window);
