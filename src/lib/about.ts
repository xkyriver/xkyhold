// The description of XkyHold lives as static HTML in index.html (#about),
// so it can be read before and without JavaScript, which Google's review
// of the home page needs. The app moves it into its first screen while no
// backup is set up, and shows only the block in the current language.

import type { Lang } from './i18n.svelte'

function about(): HTMLElement | null {
  return document.getElementById('about')
}

/** Called once at start: from now on the app decides where it shows. */
export function hideAbout(): void {
  const block = about()
  if (block) block.hidden = true
}

/** Svelte action: shows the description inside `node` while it is mounted. */
export function adoptAbout(node: HTMLElement): { destroy(): void } {
  const block = about()
  if (block) {
    block.classList.add('adopted')
    block.hidden = false
    node.append(block)
  }
  return {
    destroy() {
      if (!block) return
      block.hidden = true
      document.body.append(block)
    },
  }
}

/** Shows only the block in `lang`. */
export function showAboutIn(lang: Lang): void {
  const block = about()
  if (!block) return
  for (const section of block.querySelectorAll<HTMLElement>('[data-lang]')) section.hidden = section.dataset.lang !== lang
}
