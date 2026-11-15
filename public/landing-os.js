// Visitors on Linux see the Linux app first (docs/LANDING.md, section 4).
// A plain script that runs before the page renders (the page's CSP allows
// no inline code). It only adds a class; without it, every way to use
// XkyHold keeps the same weight. Nobody is redirected.
;(function () {
  try {
    var ua = navigator.userAgent || ''
    var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''
    // Android and ChromeOS also say Linux.
    if (/linux/i.test(platform + ' ' + ua) && !/android|cros/i.test(ua)) {
      document.documentElement.classList.add('os-linux')
    }
  } catch (e) {
    // no detection: the neutral page
  }
})()
