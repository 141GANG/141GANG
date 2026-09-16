(() => {
  'use strict';

  const footer = document.getElementById('siteFooter');
  const widget = document.getElementById('footerDevelopers');
  const trigger = document.getElementById('footerDevelopersTrigger');
  const credits = document.getElementById('footerDevelopersCredits');

  if (!footer || !widget || !trigger || !credits) return;

  let expanded = false;
  let interacted = false;
  let dismissed = false;
  let revealScrollY = 0;

  const expand = () => {
    if (expanded || dismissed) return;
    if (!interacted) {
      interacted = true;
      revealScrollY = window.scrollY;
    }
    expanded = true;
    widget.classList.add('is-expanded');
    trigger.setAttribute('aria-expanded', 'true');
    credits.setAttribute('aria-hidden', 'false');
  };

  const collapse = () => {
    if (!expanded || dismissed) return;
    expanded = false;
    widget.classList.remove('is-expanded');
    trigger.setAttribute('aria-expanded', 'false');
    credits.setAttribute('aria-hidden', 'true');
  };

  const dismiss = () => {
    if (!interacted || dismissed) return;
    dismissed = true;
    widget.classList.add('is-dismissed');
    widget.classList.remove('is-visible');
    footerObserver?.disconnect();
    window.removeEventListener('scroll', handleScroll);
  };

  const handleScroll = () => {
    if (!interacted || dismissed) return;
    if (Math.abs(window.scrollY - revealScrollY) >= 4) dismiss();
  };

  const footerObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(([entry]) => {
        if (dismissed) return;
        widget.classList.toggle('is-visible', entry.isIntersecting);
      }, { threshold: .2 })
    : null;

  if (footerObserver) footerObserver.observe(footer);
  else widget.classList.add('is-visible');

  widget.addEventListener('pointerenter', expand);
  widget.addEventListener('pointerleave', collapse);
  trigger.addEventListener('focus', expand);
  trigger.addEventListener('blur', collapse);
  trigger.addEventListener('click', expand);
  window.addEventListener('scroll', handleScroll, { passive: true });
})();
