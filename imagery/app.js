(() => {
  'use strict';
  const panels = ['people','lemonade','stars','groups','hordes','observability','string-cup'];
  function showPanel() {
    const requested = location.hash.slice(1);
    const active = panels.includes(requested) ? requested : 'people';
    for (const panel of document.querySelectorAll('[data-imagery-panel]')) panel.hidden = panel.id !== active;
    for (const link of document.querySelectorAll('aside a')) {
      if (link.hash === '#' + active) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    }
    document.getElementById('scene-title').textContent = document.getElementById(active).dataset.title;
    document.querySelector('.legend').hidden = active === 'groups';
  }
  window.addEventListener('hashchange',showPanel);
  showPanel();
})();
