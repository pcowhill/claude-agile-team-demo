type Page = import('@playwright/test').Page

/**
 * The customer's host page (#651): a header before `#root` and a footer
 * after it, each a fixed height — all a host does, since the app's own
 * stylesheet sizes `<body>` (#652). Shared by `embedded-host.spec.ts`, which
 * measures the layout, and `embedded-menu.spec.ts` (#653), which measures
 * where a menu opens inside it.
 */
export const HEADER = 80
export const FOOTER = 60

export async function embedBetweenHeaderAndFooter(page: Page) {
  await page.evaluate(
    ({ header, footer }) => {
      const root = document.getElementById('root')!
      const make = (className: string, height: number) => {
        const div = document.createElement('div')
        div.className = className
        div.textContent = className
        div.style.height = `${height}px`
        div.style.background = '#3a2a5a'
        return div
      }
      root.before(make('header', header))
      root.after(make('footer', footer))
    },
    { header: HEADER, footer: FOOTER },
  )
}
