// The EN/PT links remember the choice as "xkyhold.lang", the same key as
// the app's language setting, so a device has one language choice.
// The links work without this script too; it only stores the choice.

for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-set-lang]')) {
  link.addEventListener('click', () => {
    try {
      localStorage.setItem('xkyhold.lang', link.dataset.setLang ?? 'en')
    } catch {
      // no storage: the link still goes to the other language
    }
  })
}
