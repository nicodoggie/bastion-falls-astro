(function () {
  function openModal(el) {
    var placeholder = document.createComment('markmap-modal-placeholder');
    var modal = document.createElement('div');
    modal.id = 'markmap-modal-overlay';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'markmap-modal-close';
    closeBtn.textContent = '✕ Close';

    el.parentNode.insertBefore(placeholder, el);
    modal.appendChild(closeBtn);
    modal.appendChild(el);
    document.body.appendChild(modal);

    setTimeout(function () { el.dispatchEvent(new Event('resize')); }, 50);

    function close() {
      placeholder.parentNode.insertBefore(el, placeholder);
      placeholder.parentNode.removeChild(placeholder);
      document.body.removeChild(modal);
      setTimeout(function () { el.dispatchEvent(new Event('resize')); }, 50);
    }

    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', onKey);
      }
    });
  }

  function init() {
    document.querySelectorAll('.markmap-wrap').forEach(function (el) {
      var btn = document.createElement('button');
      btn.className = 'markmap-expand-btn';
      btn.title = 'Expand';
      btn.innerHTML =
        '<svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">' +
        '<path d="M3 3h5v2H5v3H3V3zm9 0h5v5h-2V5h-3V3z' +
        'm-9 9h2v3h3v2H3v-5zm12 3h-3v2h5v-5h-2v3z"/></svg>';
      btn.addEventListener('click', function () { openModal(el); });
      el.appendChild(btn);
    });

    var hash = window.location.hash;
    if (hash) {
      var target = document.getElementById(hash.slice(1));
      if (target && target.classList.contains('markmap-wrap')) {
        openModal(target);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
