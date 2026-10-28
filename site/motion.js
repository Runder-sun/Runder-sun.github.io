(() => {
  const root = document.documentElement;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionButton = document.querySelector('#motion-toggle');
  const indicator = motionButton?.querySelector('.motion-indicator');
  const progress = document.querySelector('.reading-progress > span');
  const disclosure = document.querySelector('#scene-disclosure');
  const scene = document.querySelector('#scene-notes');
  const disclosureLabel = disclosure?.querySelector('span[data-zh][data-en]');
  const revealed = new WeakSet();
  const animations = new Set();
  let userSelectedMotion = false;
  let progressFrame = 0;
  let previousProgress = -1;

  function updateMotionButton() {
    if (!motionButton) return;
    const enabled = root.dataset.motion === 'full';
    const english = root.lang.startsWith('en');
    motionButton.setAttribute('aria-pressed', String(enabled));
    motionButton.dataset.labelZh = enabled ? '关闭页面动效' : '开启页面动效';
    motionButton.dataset.labelEn = enabled ? 'Turn off page motion' : 'Turn on page motion';
    motionButton.setAttribute('aria-label', motionButton.dataset[english ? 'labelEn' : 'labelZh']);
    if (indicator) {
      indicator.dataset.zh = enabled ? '开' : '关';
      indicator.dataset.en = enabled ? 'On' : 'Off';
      indicator.textContent = indicator.dataset[english ? 'en' : 'zh'];
    }
  }

  function setMotion(enabled) {
    root.dataset.motion = enabled ? 'full' : 'reduced';
    if (!enabled) document.getAnimations().forEach(animation => animation.cancel());
    updateMotionButton();
  }

  setMotion(!preference.matches);
  if (motionButton) {
    motionButton.hidden = false;
    motionButton.addEventListener('click', () => {
      userSelectedMotion = true;
      setMotion(root.dataset.motion !== 'full');
    });
  }
  preference.addEventListener('change', event => {
    if (!userSelectedMotion) setMotion(!event.matches);
  });

  function enter(element, delay = 0) {
    if (revealed.has(element)) return;
    revealed.add(element);
    if (root.dataset.motion !== 'full' || !element.animate) return;
    const animation = element.animate([
      { opacity: .72, transform: 'translateY(12px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration: 550, delay, easing: 'cubic-bezier(.22, .61, .36, 1)', fill: 'backwards' });
    animations.add(animation);
    animation.addEventListener('finish', () => animations.delete(animation), { once: true });
    animation.addEventListener('cancel', () => animations.delete(animation), { once: true });
  }

  function cancelEntrances(container) {
    animations.forEach(animation => {
      if (container.contains(animation.effect.target)) animation.cancel();
    });
  }

  if ('IntersectionObserver' in window) {
    const heroParts = [...document.querySelectorAll('.hero-copy > .eyebrow, .hero-copy > h1, .hero-copy > .hero-links')];
    const targets = [...document.querySelectorAll('.hero-copy > .eyebrow, .hero-copy > h1, .hero-copy > .hero-links, .hero-visual, .research-index, .research-interests, .section-heading, .paper .paper-visual, .experience-group, .contact-section')];
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const index = heroParts.indexOf(entry.target);
        enter(entry.target, index < 0 ? 0 : Math.min(index * 40, 120));
        observer.unobserve(entry.target);
      });
    }, { threshold: .08 });

    function skipAnchor(hash) {
      const target = document.getElementById(hash.slice(1));
      if (!target) return;
      targets.forEach(element => {
        if (!target.contains(element)) return;
        revealed.add(element);
        observer.unobserve(element);
      });
      cancelEntrances(target);
    }

    skipAnchor(window.location.hash);
    targets.forEach(element => {
      if (!revealed.has(element)) observer.observe(element);
    });
    window.addEventListener('hashchange', () => skipAnchor(window.location.hash));
    document.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest('a[href^="#"]');
      if (link) skipAnchor(link.hash);
    });
  }

  function updateProgress() {
    progressFrame = 0;
    const distance = root.scrollHeight - window.innerHeight;
    const value = distance > 0 ? Math.min(1, Math.max(0, window.scrollY / distance)) : 0;
    if (value === previousProgress) return;
    progress.style.transform = `scaleX(${value})`;
    previousProgress = value;
  }

  function scheduleProgress() {
    if (progress && !progressFrame) progressFrame = window.requestAnimationFrame(updateProgress);
  }

  if (progress) {
    window.addEventListener('scroll', scheduleProgress, { passive: true });
    window.addEventListener('resize', scheduleProgress);
    if ('ResizeObserver' in window) {
      const resizeObserver = new ResizeObserver(scheduleProgress);
      resizeObserver.observe(document.body);
    }
    window.addEventListener('load', scheduleProgress, { once: true });
    scheduleProgress();
  }

  function updateDisclosure() {
    if (!disclosure || !scene) return;
    const open = scene.classList.contains('is-open');
    disclosure.setAttribute('aria-expanded', String(open));
    if (disclosureLabel) {
      disclosureLabel.dataset.zh = open ? '收起空间手记' : '展开空间手记';
      disclosureLabel.dataset.en = open ? 'Close spatial notes' : 'Open spatial notes';
      disclosureLabel.textContent = disclosureLabel.dataset[root.lang.startsWith('en') ? 'en' : 'zh'];
    }
  }

  if (disclosure && scene) {
    updateDisclosure();
    disclosure.addEventListener('click', () => {
      const open = scene.classList.toggle('is-open');
      updateDisclosure();
      if (open) enter(scene);
      else cancelEntrances(scene);
      scheduleProgress();
    });
  }

  const languageObserver = new MutationObserver(() => {
    updateMotionButton();
    updateDisclosure();
    scheduleProgress();
  });
  languageObserver.observe(root, { attributes: true, attributeFilter: ['lang'] });
})();
