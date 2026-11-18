/* global hexo */

'use strict';

// 单趟扫描：优先跳过代码块与行内代码，仅捕获正文中的 $$...$$ 与 $...$ 公式
const CODE_OR_MATH_RE = /(<hexoPostRenderCodeBlock>[\s\S]*?<\/hexoPostRenderCodeBlock>|(?:```|~~~)[\s\S]*?(?:```|~~~)|(`+)(?:(?!\2)(?!\n\n)[\s\S])+?\2)|(\$\$[\s\S]+?\$\$|\$(?!\s)(?:\\.|[^$\n\\])*?(?:\\.|[^\s$\n\\])\$)/g;
const PLACEHOLDER_RE = /HEXOMATHPLACEHOLDER(\d+)END/g;

function escapeHtmlMinimal(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function ensureMathPluginList(data) {
  let plugins = [];
  if (Array.isArray(data.plugins)) {
    plugins = data.plugins.slice();
  } else if (typeof data.plugins === 'string' && data.plugins.trim()) {
    plugins = [data.plugins.trim()];
  }

  const hasRenderer = plugins.some(item =>
    typeof item === 'string'
      ? item === 'mathjax' || item === 'katex'
      : item && (item.mathjax || item.katex)
  );

  if (hasRenderer) return true;

  if (data.mathjax === true || data.mathjax === 'true') {
    plugins.push('mathjax');
    data.plugins = plugins;
    return true;
  }

  if (data.katex === true || data.katex === 'true') {
    plugins.push('katex');
    data.plugins = plugins;
    return true;
  }

  return false;
}

// 优先级设为 11，确保在 Hexo 内置的 backtick_code_block（优先级 10）处理完围栏代码块之后执行，
// 并在 Nunjucks（{{...}}）和 hexo-renderer-marked 转义前把公式保护起来
hexo.extend.filter.register('before_post_render', function(data) {
  if (!data || !data.content || !ensureMathPluginList(data)) return data;

  const placeholders = [];
  data.content = data.content.replace(CODE_OR_MATH_RE, (match, codeSegment, _backtick, mathSegment) => {
    if (codeSegment) return codeSegment;
    const idx = placeholders.push(escapeHtmlMinimal(mathSegment)) - 1;
    return `HEXOMATHPLACEHOLDER${idx}END`;
  });

  if (placeholders.length > 0) {
    data._mathPlaceholders = placeholders;
  }

  return data;
}, 11);

// 优先级设为 5，确保在主题的 after_post_render 过滤器（默认优先级 10）之前还原出原始 LaTeX 公式
hexo.extend.filter.register('after_post_render', function(data) {
  const placeholders = data && data._mathPlaceholders;
  if (!placeholders || !placeholders.length) return data;

  const restore = (_, idx) => placeholders[Number(idx)];
  if (data.content) data.content = data.content.replace(PLACEHOLDER_RE, restore);
  if (data.excerpt) data.excerpt = data.excerpt.replace(PLACEHOLDER_RE, restore);
  if (data.more) data.more = data.more.replace(PLACEHOLDER_RE, restore);

  delete data._mathPlaceholders;
  return data;
}, 5);
