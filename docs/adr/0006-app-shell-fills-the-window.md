# 0006. The app shell fills the window; the editor column scrolls, the page does not

- Status: accepted
- Date: 2026-09-17
- Links: #519 (customer feedback: the guide panel and the timeline sit below
  the window), #524 (the bug, derived from it), #478 (the guide panel this
  bit first), #416 (lifted menus, which this changes the reach of), #126 /
  #128 (the preview's 40 % floor, whose overflow this re-routes)

## Context

The customer reported that the user guide panel ran below the bottom of the
window, so the lower end of its own scrollbar was off-screen, and that the
timeline sat about fifty pixels below the window too (#519).

Both came from one shape. `.app` was `min-height: 100vh`, which is not wrong
by itself — with little content the document did fit — but it leaves
`.app-body`'s height **indefinite**. Nothing inside an indefinite-height box
can size itself against *the room under the header*, so the guide panel said
`max-height: 100vh` instead: a whole viewport, starting a header-height down
the page, ending that far past the bottom of the window. The same
indefiniteness sent a busy timeline's overflow to the page.

The header rules out the obvious repair. `.app-header` is `flex-wrap: wrap`
and measures **92 px at 1280 px wide and 146 px at 360 px** (measured on
`main` at `a9c805c`), so no `calc(100vh - <constant>)` is right at every
width, and any fix that subtracts a header height has to *measure* it with a
`ResizeObserver` and publish it as a custom property.

Three candidates were on the table (#524 and its un-claim comment):

1. **Measured custom property**, panel capped at `calc(100dvh - var(--app-header-height))`. Smallest diff. Leaves the panel a header-height short of the window once the page is scrolled past the header — a visible gap under a bordered column.
2. **Sticky header plus (1).** No gap, coherent in both scroll states. Changes app-wide behaviour and puts a new stacking context above menus and dialogs.
3. **The shell fills the viewport and the editor column scrolls internally.**

## Decision

**(3): `.app` is `height: 100dvh`, `.app-body` and `.app-main` carry
`min-height: 0`, `.app-main` is `overflow-y: auto`, and the guide panel is
`max-height: 100%` with `position: sticky` removed.**

The deciding argument is that it is the only candidate that needs **no
measurement**. A definite height lets flex hand `.app-body` exactly what the
header leaves, at whatever height the header happens to be, so `max-height:
100%` and an internally scrolling column mean what they say — no
`ResizeObserver`, no custom property, nothing to keep in sync with a header
that wraps. It also makes "the timeline is below the window" structurally
impossible rather than tuned away.

`dvh`, not `vh`, wherever a viewport unit remains in the shell — including
the preview row's `minmax(40dvh, 1fr)` floor. `vh` is the *large* viewport on
mobile browsers, so it would put the shell's own bottom under the URL bar
whenever the bar is showing. On desktop the two are identical, so #126's
approved 40 % preview floor is unchanged where it was measured.

## Consequences

**The page never scrolls; the editor column does.** Every panel is either on
screen or reachable by scrolling `.app-main`, and the header stays put. Code
or specs that ask `documentElement.scrollHeight > window.innerHeight` to mean
"there is more below" must ask `main` instead — `e2e/preview-layout.spec.ts`
is the one that did, and it now reads the same guarantee off the column.

**A full-height surface added later inherits the fix** as long as it sizes
itself against its container rather than the viewport. `e2e/layout.ts`'s
`expectNoVerticalPageScroll` is the guard: the absence of a vertical twin for
`expectNoHorizontalScroll` is why this shipped at all, since every recent UI
PR asserted the app did not overflow *sideways* — that being the assertion
that existed.

**A viewport-sized cap inside the shell is now the wrong unit.** The media
library's list was bounded at `max-height: 50vh` (#308), chosen when the
panel always grew to fit it; once the top row was the height the window
leaves rather than the height of its content, half the viewport could be
more than the room under the panel's header, and the list painted past the
panel onto the timeline (#545, fixed under #546 by bounding the list with a
flex column on the panel). The general form of the previous paragraph: a
surface inside the shell sizes itself against its container, and a `vh`
or `dvh` figure there is at best a second cap.

**Menus inside the editor are now lifted.** `overflow-y: auto` makes
`.app-main` a clipping ancestor, so `Menu.tsx` lifts a panel opened inside it
to `position: fixed` (#416) — better, in that the column can no longer cut a
menu off, but it brought #416's close-on-scroll rule into reach of every
timeline and library menu. That rule had to become *measured*: a scroll event
is dispatched asynchronously, so the scroll a browser performs to bring a
trigger into view before clicking it can arrive after the menu that click
opened, and closing on it shut the menu at once (two browser specs failed
this way). The panel now compares the trigger's position with where it sat
when the panel was lifted and closes only when it has actually moved, which
keeps #416's intent exactly.

**Rejected alternatives.** (1) leaves a header-height gap beneath a bordered
panel in the scrolled state — trading one visible oddity for another. (2)
avoids the gap but pins the header app-wide and adds a stacking context over
menus and dialogs, and both (1) and (2) keep a page that scrolls, so neither
can satisfy #524's narrow-width criterion: at 360×640 an *empty* project
overflowed by 111 px, because below 700 px the editor's panels stack and
genuinely exceed the window. Only an internal scroll container fits there,
which is what makes (3) the answer to the whole report rather than half of
it.
