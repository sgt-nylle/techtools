/* Applies the saved theme before first paint (external file: MV3 CSP forbids inline scripts). */
(function () {
  var themes = { bridge: 1, navy: 0, 'amber-phosphor': 1, 'oled-black': 1, 'paper-navy': 1 };
  var t = 'bridge';
  try {
    var v = localStorage.getItem('tt_theme');
    if (v === 'clean') v = 'bridge';
    if (v && Object.prototype.hasOwnProperty.call(themes, v)) t = v;
  } catch {}
  var root = document.documentElement;
  root.setAttribute('data-theme', t);
  if (themes[t]) root.setAttribute('data-flat', '');
})();
