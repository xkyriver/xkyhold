// Runs before the landing page renders (a plain script: the page's CSP
// allows no inline code).
//
// - Someone who already uses XkyHold in this browser goes to the app. The
//   app sets "xkyhold.returning"; browsers set up before that flag existed
//   are found by looking for a saved setup in IndexedDB.
// - At "/", a device in Portuguese goes to "/pt/", unless it chose English
//   (same "xkyhold.lang" key as the app). "/pt/" never redirects by
//   language, so a shared "/pt/" link stays in Portuguese.
;(function () {
  var toApp = function () {
    location.replace('/app/')
  }
  try {
    if (localStorage.getItem('xkyhold.returning') === '1') return toApp()
    if (location.pathname === '/') {
      var lang = localStorage.getItem('xkyhold.lang')
      if (lang === 'pt-PT' || (!lang && /^pt/i.test(navigator.language || ''))) {
        location.replace('/pt/' + location.hash)
      }
    }
  } catch (e) {
    // no storage: stay on this page
  }
  // Only look inside the database if it exists: opening a missing one would
  // create it empty, before the app had a chance to set it up.
  try {
    if (!indexedDB.databases) return
    indexedDB.databases().then(function (list) {
      var found = list.some(function (db) {
        return db.name === 'xkyhold'
      })
      if (!found) return
      var open = indexedDB.open('xkyhold')
      open.onsuccess = function () {
        var db = open.result
        try {
          var get = db.transaction('settings', 'readonly').objectStore('settings').get('setup')
          get.onsuccess = function () {
            db.close()
            if (get.result) toApp()
          }
        } catch (e) {
          db.close()
        }
      }
    })
  } catch (e) {
    // no IndexedDB: stay on this page
  }
})()
