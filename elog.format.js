// 兼容全局安装与本地安装的 @elog/cli，无需依赖外部注入 NODE_PATH 即可解析 @elog/plugin-adapter
const adapterPath = require.resolve('@elog/plugin-adapter', {
  paths: [...module.paths, ...(require.main ? require.main.paths : [])]
})
const { matterMarkdownAdapter } = require(adapterPath)

const BLOCK_OR_INLINE_MATH_RE = /\$\$[\s\S]+?\$\$|\$(?!\s)(?:\\.|[^$\n\\])*?(?:\\.|[^\s$\n\\])\$/g

/**
 * 判断正文（剔除围栏代码块与行内代码后）是否包含数学公式
 */
function containsMath(markdown) {
  if (!markdown) return false
  const stripped = markdown
    .replace(/(?:```|~~~)[\s\S]*?(?:```|~~~)/g, '')
    .replace(/(`+)(?:(?!\1)[^`\n])+?\1/g, '')
  BLOCK_OR_INLINE_MATH_RE.lastIndex = 0
  return BLOCK_OR_INLINE_MATH_RE.test(stripped)
}

/**
 * 将 @feishux/doc-to-md 输出的伪块级公式按上下文还原为行内公式 $...$ 或保留块级公式 $$...$$，
 * 同时修复飞书子列表缩进 \t 残留以及粗体 ** 包裹公式时的空格错位问题
 */
function fixFeishuEquations(markdown) {
  if (!markdown) return markdown

  // 1. 先保护围栏代码块 ```...``` / ~~~...~~~，避免误伤代码里的 $$ 或 **
  const codeBlocks = []
  let text = markdown.replace(/(?:```|~~~)[\s\S]*?(?:```|~~~)/g, (match) => {
    const idx = codeBlocks.push(match) - 1
    return `__ELOG_CODE_BLOCK_${idx}__`
  })

  // 2. 保护行内代码 `...`
  const inlineCodes = []
  text = text.replace(/(`+)(?:(?!\1)[^`\n])+?\1/g, (match) => {
    const idx = inlineCodes.push(match) - 1
    return `__ELOG_INLINE_CODE_${idx}__`
  })

  // 3. 识别 @feishux/doc-to-md 生成的 `$$\n<公式内容>$$`
  //    原库固定输出 `$$\n${text}$$\n`，在嵌套列表项中换行后还会被追加 `\t*` 缩进。
  //    这里仅吞掉公式自带的单个换行与列表续行 `\t*`（保留作者手写的空格，且不跨入下一列表项或块级元素）。
  const feishuEqRe = /\$\$\r?\n([\s\S]*?)\$\$(\r?\n\t*(?![-*+][ \t]|\d+\.[ \t]|#{1,6}[ \t]|>|```|~~~)|\r?\n)?/g

  text = text.replace(feishuEqRe, (fullMatch, expr, trailing, offset, fullStr) => {
    const trimmed = expr.trim()
    const before = fullStr.slice(0, offset)

    // 定位闭合 $$ 之后的原始位置，仅剥离公式自带的最多一个换行，用于判断其后是否处于块尾
    const rawAfterClosingDollar = fullStr.slice(
      offset + fullMatch.length - (trailing ? trailing.length : 0)
    )
    const afterOneNewline = rawAfterClosingDollar.replace(/^\r?\n/, '')

    // 前面位于文档开头或行首（同行无文字、列表前缀、引用符等），
    // 且后面位于文档结尾或紧跟换行（即公式独占整个飞书段落块），保留为块级公式 $$...$$
    const atLineStart = offset === 0 || before.endsWith('\n')
    const atBlockEnd =
      afterOneNewline.length === 0 ||
      afterOneNewline.startsWith('\n') ||
      afterOneNewline.startsWith('\r\n')

    if (atLineStart && atBlockEnd) {
      const prefix = offset === 0 || before.endsWith('\n\n') ? '' : '\n'
      const afterMatch = fullStr.slice(offset + fullMatch.length)
      let suffix = '\n\n'
      if (afterMatch.length === 0) {
        suffix = '\n'
      } else if (afterMatch.startsWith('\n\n') || afterMatch.startsWith('\r\n\r\n')) {
        suffix = ''
      } else if (afterMatch.startsWith('\n') || afterMatch.startsWith('\r\n')) {
        suffix = '\n'
      }
      return `${prefix}$$\n${trimmed}\n$$${suffix}`
    }

    // 其余情况均为行内公式：压缩内部换行与缩进，转为单行 $...$
    const inlineExpr = trimmed.replace(/\s*\r?\n\s*/g, ' ')
    return `$${inlineExpr}$`
  })

  // 4. 保护所有数学公式后，修复飞书粗体 ** 被公式截断及首尾空格卡在 ** 内导致 CommonMark 解析错位的问题
  const maths = []
  text = text.replace(BLOCK_OR_INLINE_MATH_RE, (match) => {
    const idx = maths.push(match) - 1
    return `__ELOG_MATH_${idx}__`
  })

  // 合并被行内公式切碎的连续粗体：`**用 **$h$** 种**` -> `**用 $h$ 种**`
  const splitBoldByMathRe = /\*\*([^*\n]+?)\*\*([ \t]*__ELOG_MATH_\d+__[ \t]*)\*\*([^*\n]+?)\*\*/g
  while (splitBoldByMathRe.test(text)) {
    splitBoldByMathRe.lastIndex = 0
    text = text.replace(splitBoldByMathRe, '**$1$2$3**')
  }

  // 将 `**文字 **` / `** 文字**` 内部首尾的空格或制表符移到 `**` 外侧，兼容严格 CommonMark 定界符规则
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, (match, inner) => {
    const leadMatch = inner.match(/^[ \t]+/)
    const tailMatch = inner.match(/[ \t]+$/)
    const core = inner.replace(/^[ \t]+|[ \t]+$/g, '')
    if (!core) return match
    const lead = leadMatch ? leadMatch[0] : ''
    const tail = tailMatch ? tailMatch[0] : ''
    return `${lead}**${core}**${tail}`
  })

  // 5. 依次还原数学公式、行内代码与代码块
  text = text.replace(/__ELOG_MATH_(\d+)__/g, (_, i) => maths[Number(i)])
  text = text.replace(/__ELOG_INLINE_CODE_(\d+)__/g, (_, i) => inlineCodes[Number(i)])
  text = text.replace(/__ELOG_CODE_BLOCK_(\d+)__/g, (_, i) => codeBlocks[Number(i)])

  return text
}

/**
 * Volantis 主题通过 `plugins: [mathjax]`（或 `katex`）注入前端公式渲染脚本，不识别 `mathjax: true`。
 * 当文章设置了 `mathjax: true` 或正文包含公式时，自动补齐 `plugins: ['mathjax']`。
 */
function ensureVolantisMathPlugin(doc) {
  if (!doc || !doc.properties) return
  const props = doc.properties
  const explicitMath = props.mathjax === true || props.mathjax === 'true'
  if (!explicitMath && !containsMath(doc.body)) return

  let plugins = []
  if (Array.isArray(props.plugins)) {
    plugins = [...props.plugins]
  } else if (typeof props.plugins === 'string' && props.plugins.trim()) {
    plugins = [props.plugins.trim()]
  }

  const hasMathRenderer = plugins.some((item) =>
    typeof item === 'string'
      ? item === 'mathjax' || item === 'katex'
      : item && (item.mathjax || item.katex)
  )
  if (!hasMathRenderer) {
    plugins.push('mathjax')
  }
  props.plugins = plugins
}

/**
 * @param {import('@elog/types').DocDetail} doc
 */
const format = (doc) => {
  doc.body = fixFeishuEquations(doc.body)
  ensureVolantisMathPlugin(doc)

  // 配置 formatExt 后会覆盖默认适配器，需要显式调用 matterMarkdownAdapter(doc)
  doc.body = matterMarkdownAdapter(doc)
  return doc
}

module.exports = { format, fixFeishuEquations, ensureVolantisMathPlugin }
