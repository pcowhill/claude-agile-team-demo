import type { ReactNode } from 'react'
import type { GuideConstants } from '../lib/guide/constantNames'
import type { GuideBlock, GuideInline, GuideLinkTarget } from '../lib/guide/document'
import { guideHash, headingElementId } from '../lib/guide/location'

/**
 * Renders the compiled guide's blocks (#478). The structure comes from the
 * build (`tools/guide/compileGuide.ts`); nothing here parses or injects
 * markup, which is what keeps the Markdown parser out of the browser and
 * lets an internal link navigate the panel rather than the page.
 */

interface RenderContext {
  /** The section being rendered, for heading ids. */
  section: string
  constants: GuideConstants
  onNavigate: (target: GuideLinkTarget) => void
}

export function GuideInlines({ inlines, context }: { inlines: readonly GuideInline[]; context: RenderContext }) {
  return inlines.map((inline, index) => <Inline key={index} inline={inline} context={context} />)
}

function Inline({ inline, context }: { inline: GuideInline; context: RenderContext }): ReactNode {
  switch (inline.kind) {
    case 'text':
      return inline.text
    case 'strong':
      return (
        <strong>
          <GuideInlines inlines={inline.inlines} context={context} />
        </strong>
      )
    case 'em':
      return (
        <em>
          <GuideInlines inlines={inline.inlines} context={context} />
        </em>
      )
    case 'code':
      return <code>{inline.text}</code>
    case 'placeholder':
      return context.constants[inline.name as keyof GuideConstants] ?? inline.name
    case 'break':
      return <br />
    case 'image':
      // Image assets and their pipeline are #483's; the compiler already
      // accepts the node so that PR adds pictures, not syntax.
      return <img className="user-guide-image" src={inline.src} alt={inline.alt} />
    case 'link': {
      const { target } = inline
      if (target === null) {
        return (
          <a href={inline.href} target="_blank" rel="noreferrer">
            <GuideInlines inlines={inline.inlines} context={context} />
          </a>
        )
      }
      // The href is the real deep link, so middle-click and copy-link work;
      // a plain click stays inside the panel.
      return (
        <a
          href={guideHash(target)}
          onClick={(event) => {
            event.preventDefault()
            context.onNavigate(target)
          }}
        >
          <GuideInlines inlines={inline.inlines} context={context} />
        </a>
      )
    }
  }
}

/** The article's title is an h2, so a level-2 heading in the source is an h3. */
const HEADING_TAGS = { 2: 'h3', 3: 'h4', 4: 'h5' } as const

export function GuideBlocks({ blocks, context }: { blocks: readonly GuideBlock[]; context: RenderContext }) {
  return blocks.map((block, index) => <Block key={index} block={block} context={context} />)
}

function Block({ block, context }: { block: GuideBlock; context: RenderContext }): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const Tag = HEADING_TAGS[block.level]
      return (
        <Tag id={headingElementId(context.section, block.anchor)}>
          <GuideInlines inlines={block.inlines} context={context} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p>
          <GuideInlines inlines={block.inlines} context={context} />
        </p>
      )
    case 'list': {
      const items = block.items.map((item, index) => (
        <li key={index}>
          <GuideBlocks blocks={item.blocks} context={context} />
        </li>
      ))
      return block.ordered ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>
    }
    case 'table':
      return (
        <table>
          <thead>
            <tr>
              {block.header.map((cell, index) => (
                <th key={index} style={cell.align === null ? undefined : { textAlign: cell.align }} scope="col">
                  <GuideInlines inlines={cell.inlines} context={context} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, index) => (
                  <td key={index} style={cell.align === null ? undefined : { textAlign: cell.align }}>
                    <GuideInlines inlines={cell.inlines} context={context} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'blockquote':
      return (
        <blockquote>
          <GuideBlocks blocks={block.blocks} context={context} />
        </blockquote>
      )
    case 'code':
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      )
    case 'rule':
      return <hr />
  }
}
