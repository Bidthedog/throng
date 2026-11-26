/* global document, window, HTMLDialogElement, IntersectionObserver */
// throng-ide.com behaviour. The page works without it: every system's install steps show, and the video links to YouTube.
(function () {
  document.documentElement.classList.add('js');

  // GitHub Pages never sees request headers, so the visitor's system is read in the browser (064, 2026-11-17).
  function detectOs() {
    var platform = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '').toLowerCase();
    var ua = navigator.userAgent.toLowerCase();
    if (/android|iphone|ipad|ipod/.test(ua)) return null;
    if (platform.indexOf('win') === 0 || /windows/.test(ua)) return 'windows';
    if (platform.indexOf('mac') === 0 || /mac os x/.test(ua)) return 'macos';
    if (/linux|x11|cros/.test(platform + ' ' + ua)) return 'linux';
    return null;
  }

  var names = { windows: 'Windows', linux: 'Linux', macos: 'macOS' };

  document.querySelectorAll('[data-install]').forEach(function (root) {
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
    function select(tab, focus, animate) {
      tabs.forEach(function (t) {
        var on = t === tab;
        var panel = document.getElementById(t.getAttribute('aria-controls'));
        var changed = on && panel.hidden;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        panel.hidden = !on;
        if (changed && animate) {
          panel.classList.remove('entering');
          void panel.offsetWidth; // restart the animation on a quick second switch
          panel.classList.add('entering');
        }
      });
      if (focus) tab.focus();
    }
    root.addEventListener('animationend', function (e) { e.target.classList.remove('entering'); });
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t, false, true); });
      t.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
        if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
        if (e.key === 'Home') next = tabs[0];
        if (e.key === 'End') next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); select(next, true, true); }
      });
    });
    var os = detectOs();
    var match = os && tabs.filter(function (t) { return t.dataset.os === os; })[0];
    select(match || tabs[0], false);
    var note = root.querySelector('[data-os-note]');
    if (note) note.textContent = match ? 'Showing ' + names[os] + ', the system this browser is running on.' : 'Choose your system.';
  });

  if (navigator.clipboard) {
    document.querySelectorAll('pre[data-copy]').forEach(function (pre) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy';
      button.textContent = 'Copy';
      button.addEventListener('click', function () {
        navigator.clipboard.writeText(pre.querySelector('code').textContent).then(function () {
          button.textContent = 'Copied';
          setTimeout(function () { button.textContent = 'Copy'; }, 1600);
        });
      });
      pre.classList.add('has-copy');
      pre.appendChild(button);
    });
  }

  // Past the first screen, the header gains its rule and the back-to-top button appears.
  var header = document.querySelector('header.top');
  var toTop = document.querySelector('.to-top');
  function onScroll() {
    var y = window.scrollY;
    if (header) header.classList.toggle('scrolled', y > 8);
    if (toTop) toTop.classList.toggle('shown', y > window.innerHeight * 0.6);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Screenshots load lazily (the browser's loading="lazy" fetches them a little ahead of the scroll) and
  // fade in as each scrolls into view, once it has loaded.
  var shots = document.querySelectorAll('.shot img');
  function reveal(img) {
    function shown() { img.classList.add('loaded'); }
    if (img.complete) shown();
    else { img.addEventListener('load', shown); img.addEventListener('error', shown); }
  }
  if ('IntersectionObserver' in window) {
    var watcher = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        watcher.unobserve(entry.target);
        reveal(entry.target);
      });
    }, { threshold: 0.15 });
    shots.forEach(function (img) { watcher.observe(img); });
  } else {
    shots.forEach(reveal);
  }

  // 080 FR-053 — the guide's navigation scrolls on its own (FR-039), so on a page low in its list the open page's
  // entry would sit out of sight. Scroll the navigation itself (never scrollIntoView, which would also move the page
  // off the section a link asked for) so the entry is in view, near the middle.
  var guideNav = document.querySelector('.guide-nav');
  var here = guideNav && guideNav.querySelector('a[aria-current="page"]');
  if (here && guideNav.scrollHeight > guideNav.clientHeight) {
    var navBox = guideNav.getBoundingClientRect();
    var hereBox = here.getBoundingClientRect();
    if (hereBox.top < navBox.top || hereBox.bottom > navBox.bottom) {
      guideNav.scrollTop += hereBox.top - navBox.top - (guideNav.clientHeight - hereBox.height) / 2;
    }
  }

  // 080 FR-051 — in throng's Help window (the guide shipped with the app) the mouse's back and forward buttons step
  // the guide's history, as they do in a browser. A browser already does this, so the website is left alone.
  if (window.location.protocol === 'throng-help:') {
    window.addEventListener('mouseup', function (e) {
      if (e.button === 3) { e.preventDefault(); window.history.back(); }
      else if (e.button === 4) { e.preventDefault(); window.history.forward(); }
    });

    // 080 FR-062 — the Help window has no status line, so a hovered link shows its address in one popover at the
    // bottom left, with whether it stays in the guide. A browser draws its own, so the website is left alone.
    var linkStatus = document.createElement('div');
    linkStatus.className = 'link-status';
    linkStatus.setAttribute('aria-hidden', 'true');
    var linkKind = document.createElement('span');
    linkKind.className = 'link-status__kind';
    var linkAddress = document.createElement('span');
    linkAddress.className = 'link-status__address';
    linkStatus.appendChild(linkKind);
    linkStatus.appendChild(linkAddress);
    document.body.appendChild(linkStatus);
    var linkOf = function (target) { return target && target.closest ? target.closest('a[href]') : null; };
    // The Help window keeps only guide and sitemap pages (FR-050); a shipped link to any other page (the header's
    // Home, Features, Install) opens the website in the browser, so it is external and shows the website's address.
    var canonical = document.querySelector('link[rel="canonical"]');
    var website = canonical ? new URL(canonical.href).origin : '';
    var staysInGuide = function (link) {
      return link.protocol === window.location.protocol && link.host === window.location.host &&
        /^\/(guide|sitemap)\//.test(link.pathname);
    };
    document.addEventListener('pointerover', function (e) {
      var link = linkOf(e.target);
      if (!link) return;
      var inGuide = staysInGuide(link);
      linkKind.textContent = inGuide ? 'In the guide' : 'External';
      linkStatus.classList.toggle('link-status--external', !inGuide);
      linkAddress.textContent = inGuide
        ? link.pathname + link.hash
        : link.protocol === window.location.protocol ? website + link.pathname + link.search + link.hash : link.href;
      linkStatus.classList.add('shown');
    });
    document.addEventListener('pointerout', function (e) {
      var link = linkOf(e.target);
      if (link && !link.contains(e.relatedTarget)) linkStatus.classList.remove('shown');
    });
  }

  // A screenshot opens full size in a modal; without script its link opens the image itself.
  var zooms = document.querySelectorAll('a.zoom');
  if (zooms.length && typeof HTMLDialogElement === 'function') {
    var dialog = document.createElement('dialog');
    dialog.className = 'lightbox';
    dialog.setAttribute('aria-label', 'Enlarged screenshot');
    dialog.innerHTML = '<button type="button" class="lightbox__close" aria-label="Close">×</button><img alt="">';
    document.body.appendChild(dialog);
    var big = dialog.querySelector('img');
    // It animates shut unless the visitor asks for reduced motion; the class holds it open for the 150ms that takes.
    var still = window.matchMedia('(prefers-reduced-motion: reduce)');
    function shut() {
      if (!dialog.open || dialog.classList.contains('closing')) return;
      if (still.matches) { dialog.close(); return; }
      dialog.classList.add('closing');
      setTimeout(function () { dialog.classList.remove('closing'); dialog.close(); }, 150);
    }
    dialog.querySelector('.lightbox__close').addEventListener('click', shut);
    // Esc, the × or a click on the backdrop closes it; a click on the image does not.
    dialog.addEventListener('cancel', function (e) { e.preventDefault(); shut(); });
    dialog.addEventListener('click', function (e) { if (e.target === dialog) shut(); });
    // The × appears while the mouse moves over the image (not the backdrop, which is the dialog
    // element itself as an event target), and fades half a second after it stops or leaves.
    var idle = null;
    function settle() {
      clearTimeout(idle);
      idle = setTimeout(function () { dialog.classList.remove('pointer-moving'); }, 500);
    }
    dialog.addEventListener('mousemove', function (e) {
      if (e.target === dialog) return;
      dialog.classList.add('pointer-moving');
      settle();
    });
    big.addEventListener('mouseleave', settle);
    dialog.addEventListener('close', function () { big.removeAttribute('src'); dialog.classList.remove('pointer-moving'); });
    zooms.forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        var thumb = link.querySelector('img');
        big.src = link.getAttribute('href');
        big.alt = thumb ? thumb.alt : '';
        dialog.showModal();
      });
    });
  }

  // The player loads only when asked for, from youtube-nocookie.com (064 FR-002).
  document.querySelectorAll('[data-yt]').forEach(function (link) {
    var id = link.dataset.yt;
    if (!id) return;
    link.addEventListener('click', function (e) {
      e.preventDefault();
      var frame = document.createElement('iframe');
      frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(id) + '?autoplay=1&rel=0';
      frame.title = link.getAttribute('aria-label') || 'Video';
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      link.replaceWith(frame);
    });
  });

  // The guide's search (080 FR-002c): Pagefind's static index, built at deploy time. Absent locally without
  // Pagefind, in which case the field simply is not drawn.
  var search = document.getElementById('search');
  if (search && typeof window.PagefindUI === 'function') {
    new window.PagefindUI({ element: '#search', showSubResults: true, showImages: false, resetStyles: false,
      // FR-035: the clear control is drawn as an icon; its name is still read out.
      translations: { clear_search: 'Clear search' } });
    // The results panel hangs from the header's foot (080 FR-029), whose height changes when the header wraps.
    var top = document.querySelector('header.top');
    var measure = function () {
      document.documentElement.style.setProperty('--header-h', top.getBoundingClientRect().height + 'px');
    };
    if (top) {
      measure();
      if (typeof window.ResizeObserver === 'function') new window.ResizeObserver(measure).observe(top);
    }
  }
})();
