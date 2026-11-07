import { expect, type Page } from '@playwright/test'

/**
 * Horizontal overflow, measured where it actually happens.
 *
 * THE DOCUMENT IS THE WRONG PLACE TO LOOK. Every converted page puts
 * `overflow-x-hidden` on `<main>`, which clips inner overflow instead of
 * repairing it. The document then reports no overflow at all, so a check that
 * reads `documentElement.scrollWidth` alone goes green while a row inside is
 * 200px wider than the phone it is on — truncation silently not happening,
 * content cut off at the clip edge, and nothing to see in the measurement.
 *
 * Every 390px gate in this suite had that hole. None of them was wrong about
 * the document; they were asking the document a question only `<main>` can
 * answer. It surfaced when the Your-repositories page shipped a row whose
 * link chain was missing `min-w-0`: `<main>` measured 581px inside a 375px
 * viewport while the document measured a tidy 375.
 *
 * So both are checked. The document catches a page that genuinely pushes the
 * viewport sideways; `<main>` catches a child that busts its container behind
 * the clip. A page needs to pass both to be right.
 */
export async function expectNoHorizontalOverflow(page: Page, width: number) {
  const m = await page.evaluate(() => {
    const de = document.documentElement
    const main = document.querySelector('main')
    return {
      docScroll: de.scrollWidth,
      docClient: de.clientWidth,
      mainScroll: main?.scrollWidth ?? 0,
      mainClient: main?.clientWidth ?? 0,
      foundMain: main !== null,
    }
  })

  // Rule 3: if the page has no <main>, the second half of this check silently
  // measures 0 <= 0 and passes forever. Say so instead.
  expect(m.foundMain, 'no <main> on the page, so inner overflow cannot be measured').toBe(true)

  expect(
    m.docScroll,
    `the document is ${m.docScroll - m.docClient}px wider than the viewport at ${width}px`,
  ).toBeLessThanOrEqual(m.docClient)

  expect(
    m.mainScroll,
    `<main> is ${m.mainScroll - m.mainClient}px wider than its container at ${width}px — ` +
      `overflow-x-hidden is clipping it, so the document looks fine while content is cut off. ` +
      `Usually a flex item missing min-w-0 somewhere in the chain above a truncating element.`,
  ).toBeLessThanOrEqual(m.mainClient)
}
