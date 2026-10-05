(() => {
  'use strict';

  const root = new URL('../', document.currentScript.src);
  const themeKey = 'sf-theme';
  const pageKey = 'sf-landing-page';
  const modes = ['light', 'green'];
  const pages = [
    { path: 'landing/index.html', label: 'Projects' },
    { path: 'landing/friends.html', label: 'Friends' },
    { path: 'landing/hordes.html', label: 'Hordes' },
    { path: 'landing/orchestra.html', label: 'Orchestra' }
  ];
  const links = [
    { path: 'interface-designs/index.html', label: 'Interfaces' },
    { path: 'imagery/index.html', label: 'Imagery' },
    { path: 'architecture/index.html', label: 'How it works' },
    { path: 'design-system/index.html', label: 'Design rules' }
  ];
  const url = path => new URL(path, root).href;
  const readPreference = key => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const savePreference = (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* Preferences are optional. */ }
  };
  const validTheme = value => (value === 'green' || value === 'dark') ? 'green' : 'light';
  document.documentElement.dataset.theme = validTheme(readPreference(themeKey));

  function mount() {
    const header = document.querySelector('[data-project-header]');
    if (!header) return;
    header.classList.add('project-header');
    header.innerHTML = `
      <a class="project-wordmark" href="${url('landing/index.html')}" aria-label="surprised-face home">
        <span class="project-face">:o</span><span>surprised-face</span>
      </a>
      <nav class="project-menu" aria-label="Project">
        <label class="project-page-label">Page
          <select id="landing-variant" aria-label="Landing page">
            ${pages.map(page => `<option value="${url(page.path)}">${page.label}</option>`).join('')}
          </select>
        </label>
        ${links.map(link => `<a href="${url(link.path)}"${location.href.split('#')[0] === url(link.path) ? ' aria-current="page"' : ''}>${link.label}</a>`).join('')}
        <button id="theme" type="button">Theme</button>
      </nav>`;

    const picker = header.querySelector('select');
    const current = pages.find(page => url(page.path) === location.href.split('#')[0]);
    const remembered = pages.find(page => page.path === readPreference(pageKey));
    const selected = current || remembered || pages[0];
    picker.value = url(selected.path);
    if (current) savePreference(pageKey, current.path);
    picker.addEventListener('change', () => {
      const page = pages.find(page => url(page.path) === picker.value);
      if (!page) return;
      savePreference(pageKey, page.path);
      location.href = url(page.path);
    });

    const control = header.querySelector('#theme');
    function labelTheme() {
      const theme = document.documentElement.dataset.theme;
      const name = theme === 'green' ? 'Green' : 'Blue / red';
      control.textContent = 'Theme: ' + name;
      control.setAttribute('aria-label', 'Color theme ' + name + '. Click to change.');
    }
    function applyTheme(theme) {
      document.documentElement.dataset.theme = validTheme(theme);
      labelTheme();
      window.dispatchEvent(new CustomEvent('sf-theme-change'));
    }
    control.addEventListener('click', () => {
      const next = modes[(modes.indexOf(document.documentElement.dataset.theme) + 1) % modes.length];
      savePreference(themeKey, next);
      applyTheme(next);
    });
    window.addEventListener('storage', event => {
      if (event.key === themeKey) applyTheme(event.newValue);
    });
    labelTheme();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
