(() => {
  'use strict';
  const panels = ['people','lemonade','stars','groups'];
  const palette = document.getElementById('palette');
  const layout = document.getElementById('layout');
  const names = {
    'cobalt-red': ['Cobalt','#2148B8','Signal Red','#C83232'],
    'botanical-oxblood': ['Botanical Green','#008A4B','Oxblood','#8F3434'],
    'ultramarine-orange': ['Ultramarine','#263E99','Safety Orange','#E55D2B']
  };

  function showGroup() {
    const key = (layout.value === 'line' ? 'holding-hands-' : 'dancing-circle-') + palette.value;
    const image = window.imageryCatalog.find(item => item.key === key);
    const figure = document.getElementById('group-figure');
    const img = document.getElementById('group-image');
    figure.dataset.layout = layout.value;
    img.src = image.file;
    img.width = image.width;
    img.height = image.height;
    img.alt = image.alt;
    figure.querySelector('a').href = image.file;
    document.getElementById('group-caption').textContent = image.title;
    document.getElementById('group-prompt').href = image.prompt;
    updateLegend(palette.value);
  }

  function updateLegend(key) {
    const colors = names[key];
    document.getElementById('human-ink').style.backgroundColor = colors[1];
    document.getElementById('agent-ink').style.backgroundColor = colors[3];
    document.getElementById('human-label').textContent = 'Human / ' + colors[0];
    document.getElementById('agent-label').textContent = 'Agent / ' + colors[2];
  }

  function showPanel() {
    const requested = location.hash.slice(1);
    const active = panels.includes(requested) ? requested : 'people';
    for (const panel of document.querySelectorAll('[data-imagery-panel]')) panel.hidden = panel.id !== active;
    for (const link of document.querySelectorAll('aside a')) {
      if (link.hash === '#' + active) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    }
    document.getElementById('scene-title').textContent = document.getElementById(active).dataset.title;
    if (active === 'groups') showGroup();
    else updateLegend('cobalt-red');
  }
  palette.addEventListener('change',showGroup);
  layout.addEventListener('change',showGroup);
  window.addEventListener('hashchange',showPanel);
  showPanel();
})();
