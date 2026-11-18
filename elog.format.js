// 如果你在本地启用了 frontMatter，需要保留这一行（提前安装或随 @elog/cli 已自带）
const { matterMarkdownAdapter } = require('@elog/plugin-adapter')

/**
 * 将 @feishux/doc-to-md 输出的伪块级公式按上下文还原为行内公式 $...$ 或保留块级公式 $$...$$
 */
function fixFeishuEquations(markdown) {
  if (!markdown) return markdown

  // 1. 先保护围栏代码块 ```...```，避免误伤代码里的 $$
  const codeBlocks = []
  let text = markdown.replace(/```[\s\S]*?```/g, (match) => {
    const idx = codeBlocks.push(match) - 1
    return `__ELOG_CODE_BLOCK_${idx}__`
  })

  // 2. 保护行内代码 `...`
  const inlineCodes = []
  text = text.replace(/`[^`\n]+`/g, (match) => {
    const idx = inlineCodes.push(match) - 1
    return `__ELOG_INLINE_CODE_${idx}__`
  })

  // 3. 识别 @feishux/doc-to-md 生成的 `$$\n<公式内容>\n$$`（注意原库是 `$$\n${text}$$\n`）
  //    逐个判断该公式是否“独占一个段落”
  text = text.replace(/\$\$\n([\s\S]*?)\$\$\n?/g, (fullMatch, expr, offset, fullStr) => {
    const trimmed = expr.trim()
    const before = fullStr.slice(0, offset)
    const after = fullStr.slice(offset + fullMatch.length)

    // 前面要么是文档开头，要么以换行结束（说明公式前面没有同行文字）
    const atLineStart = offset === 0 || before.endsWith('\n')
    // 后面要么是文档结尾，要么以空行/换行结束且本身不是多行混排
    const atLineEnd = after.length === 0 || after.startsWith('\n')

    // 如果同一行前后还有文字（或前面不是行首、后面不是换行），一定是行内公式
    // 注意：表格行 `| ... |`、列表 `- ...`、标题 `# ...`、引用 `> ...` 前面都不是行首，会自动命中这里转为 $...$
    if (!atLineStart || !atLineEnd) {
      // 行内公式不能包含换行，同时去掉首尾空白以兼容严格解析器
      const inlineExpr = trimmed.replace(/\r?\n+/g, ' ')
      return `$${inlineExpr}$`
    }

    // 如果前后虽然都是换行，但紧邻前/后行并非空行（同一文本块内被强行换了行），也视为行内公式；
    // 仅当它上下都被空行（或文档边界）隔开时，才保留为真正的块级公式 $$...$$
    const prevIsBlankOrStart = offset === 0 || before.endsWith('\n\n')
    const nextIsBlankOrEnd = after.length === 0 || after.startsWith('\n')
    if (prevIsBlankOrStart && nextIsBlankOrEnd) {
      return `\n$$\n${trimmed}\n$$\n`
    }

    const inlineExpr = trimmed.replace(/\r?\n+/g, ' ')
    return `$${inlineExpr}$`
  })

  // 4. 还原行内代码与代码块
  text = text.replace(/__ELOG_INLINE_CODE_(\d+)__/g, (_, i) => inlineCodes[Number(i)])
  text = text.replace(/__ELOG_CODE_BLOCK_(\d+)__/g, (_, i) => codeBlocks[Number(i)])

  return text
}

/**
 * @param {import('@elog/types').DocDetail} doc
 */
const format = (doc) => {
  doc.body = fixFeishuEquations(doc.body)

  // 如果原本配置了 frontMatter: { enable: true } 或 format: 'matter-markdown'，
  // 配置 formatExt 后会覆盖默认适配器，需要显式调用 matterMarkdownAdapter(doc)
  // 如果没开启 frontMatter，直接 return doc 即可
  doc.body = matterMarkdownAdapter(doc)
  return doc
}

module.exports = { format }
