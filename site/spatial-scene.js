(() => {
  const canvas = document.querySelector('#spatial-canvas');
  const context = canvas.getContext('2d');
  if (!context) return;

  const toggleButton = document.querySelector('#scene-toggle');
  const resetButton = document.querySelector('#scene-reset');
  const hint = document.querySelector('#scene-hint');
  const viewButtons = Array.from(document.querySelectorAll('[data-scene-view]'));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const views = {
    scene: { yaw: .68, pitch: .55, zh: '空间场景', en: 'Scene' },
    motion: { yaw: -.42, pitch: .38, zh: '人体动作', en: 'Motion' },
    path: { yaw: .08, pitch: 1, zh: '运动路径', en: 'Path' }
  };
  let currentView = 'scene';
  let yaw = views.scene.yaw;
  let pitch = views.scene.pitch;
  let emphasis = { scene: 1, motion: 0, path: 0 };
  let cameraTransition = null;
  // Keep the user's playback choice when the global motion setting changes.
  let playing = true;
  let motionReduced = readMotionSetting();
  let visible = false;
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let frame = 0;
  let previousTime = 0;
  let elapsed = 0;
  let pointer = null;
  let colors;

  const route = [[-1.12, .88], [-.46, .42], [.28, .57], [.88, .18], [.55, -.25], [1.16, -.38]];
  const segmentLengths = route.slice(1).map((point, index) => Math.hypot(point[0] - route[index][0], point[1] - route[index][1]));
  const routeLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  const furniture = [
    [-1.37, 0, -.94, 1.04, .28, .48],
    [-1.37, .28, -.94, 1.04, .25, .12],
    [-1.37, .28, -.82, .12, .11, .36],
    [-.45, .28, -.82, .12, .11, .36],
    [-.5, 0, -.26, .52, .24, .4],
    [.9, 0, -1.02, .46, .66, .43]
  ];

  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';
  canvas.style.aspectRatio = '4 / 3';

  function readMotionSetting() {
    const setting = document.documentElement.dataset.motion;
    return setting === 'reduced' || (setting !== 'full' && reducedMotion.matches);
  }

  function updateLabels() {
    const language = document.documentElement.lang.startsWith('zh') ? 'zh' : 'en';
    toggleButton.dataset.zh = motionReduced ? '静态模式' : playing ? '暂停动画' : '播放动画';
    toggleButton.dataset.en = motionReduced ? 'Static view' : playing ? 'Pause' : 'Play';
    toggleButton.textContent = toggleButton.dataset[language];
    toggleButton.disabled = motionReduced;
    toggleButton.setAttribute('aria-pressed', String(playing && !motionReduced));
    resetButton.dataset.zh = '重置视角';
    resetButton.dataset.en = 'Reset view';
    resetButton.textContent = resetButton.dataset[language];
    hint.dataset.zh = motionReduced ? '静态模式 · 拖动或方向键调整视角' : '拖动旋转 · 方向键调整 · 空格播放/暂停';
    hint.dataset.en = motionReduced ? 'Static view · Drag or use arrow keys to orbit' : 'Drag to orbit · Arrow keys to rotate · Space to play/pause';
    hint.textContent = hint.dataset[language];
    viewButtons.forEach(button => {
      const view = views[button.dataset.sceneView];
      if (!view) return;
      button.dataset.zh = button.dataset.zh || view.zh;
      button.dataset.en = button.dataset.en || view.en;
      button.textContent = button.dataset[language];
      button.setAttribute('aria-pressed', String(button.dataset.sceneView === currentView));
    });
  }

  function stopFrame() {
    cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
  }

  function requestFrame() {
    if (!frame && visible && !document.hidden && width > 0 && height > 0) {
      frame = requestAnimationFrame(render);
    }
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    if (!width || !height) {
      stopFrame();
      return;
    }
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const physicalWidth = Math.round(width * pixelRatio);
    const physicalHeight = Math.round(height * pixelRatio);
    if (canvas.width !== physicalWidth || canvas.height !== physicalHeight) {
      canvas.width = physicalWidth;
      canvas.height = physicalHeight;
    }
    const style = getComputedStyle(document.documentElement);
    colors = {
      accent: style.getPropertyValue('--accent').trim() || '#514b45',
      detail: style.getPropertyValue('--detail').trim() || '#927448',
      person: style.getPropertyValue('--muted').trim() || '#68645f',
      paper: style.getPropertyValue('--paper').trim() || '#f5f1e9',
      ink: style.getPropertyValue('--ink').trim() || '#302e2b',
      line: style.getPropertyValue('--line').trim() || '#d7cfc2'
    };
    requestFrame();
  }

  function render(timestamp) {
    frame = 0;
    if (!visible || document.hidden || !width || !height) {
      previousTime = 0;
      return;
    }
    const animating = playing && !motionReduced;
    const delta = previousTime ? Math.min((timestamp - previousTime) / 1000, .05) : 0;
    if (animating) elapsed += delta;
    if (cameraTransition) {
      cameraTransition.elapsed += delta;
      const progress = Math.min(cameraTransition.elapsed / .55, 1);
      const eased = progress * progress * (3 - 2 * progress);
      yaw = cameraTransition.yaw + (cameraTransition.targetYaw - cameraTransition.yaw) * eased;
      pitch = cameraTransition.pitch + (cameraTransition.targetPitch - cameraTransition.pitch) * eased;
      Object.keys(views).forEach(view => {
        const target = view === currentView ? 1 : 0;
        emphasis[view] = cameraTransition.emphasis[view] + (target - cameraTransition.emphasis[view]) * eased;
      });
      if (progress === 1) cameraTransition = null;
    }
    previousTime = animating || cameraTransition ? timestamp : 0;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    const scale = Math.min(width / 4.8, height / 4.5);
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const roomOpacity = 1 - .4 * emphasis.motion - .28 * emphasis.path;
    const personOpacity = .85 + .15 * emphasis.motion - .12 * emphasis.path;
    const personWeight = 1 + .35 * emphasis.motion;
    const pathOpacity = .55 - .25 * emphasis.motion + .4 * emphasis.path;

    function project(point) {
      const [x, y, z] = point;
      const depth = x * sinYaw + z * cosYaw;
      return [width / 2 + (x * cosYaw - z * sinYaw) * scale,
        height * .57 + (depth * sinPitch - y * cosPitch) * scale,
        depth * cosPitch + y * sinPitch];
    }

    function trace(points, close = false) {
      context.beginPath();
      points.forEach((point, index) => {
        const [x, y] = project(point);
        if (index) context.lineTo(x, y);
        else context.moveTo(x, y);
      });
      if (close) context.closePath();
    }

    function line(points, color, opacity = 1, thickness = 1, close = false) {
      trace(points, close);
      context.strokeStyle = color;
      context.globalAlpha = opacity;
      context.lineWidth = thickness;
      context.stroke();
      context.globalAlpha = 1;
    }

    function dot(point, radius, fill, outline = false, stroke = colors.accent, opacity = 1) {
      const [x, y] = project(point);
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = fill;
      context.globalAlpha = opacity;
      context.fill();
      if (outline) {
        context.strokeStyle = stroke;
        context.lineWidth = 1.2;
        context.stroke();
      }
      context.globalAlpha = 1;
    }

    const floor = [[-1.6, 0, -1.2], [1.6, 0, -1.2], [1.6, 0, 1.2], [-1.6, 0, 1.2]];
    trace(floor, true);
    context.fillStyle = colors.accent;
    context.globalAlpha = .025 * roomOpacity;
    context.fill();
    context.globalAlpha = 1;
    line(floor, colors.ink, .35 * roomOpacity, 1, true);
    for (const x of [-.8, 0, .8]) line([[x, 0, -1.2], [x, 0, 1.2]], colors.ink, .09 * roomOpacity, .7);
    for (const z of [-.6, 0, .6]) line([[-1.6, 0, z], [1.6, 0, z]], colors.ink, .09 * roomOpacity, .7);
    line([[-1.6, 0, 1.2], [-1.6, 1.25, 1.2], [-1.6, 1.25, -1.2], [1.6, 1.25, -1.2], [1.6, 0, -1.2]], colors.ink, .3 * roomOpacity, 1);
    line([[-1.6, 0, -1.2], [-1.6, 1.25, -1.2]], colors.ink, .25 * roomOpacity, 1);
    line([[-1.59, .58, -.85], [-1.59, 1.02, -.85], [-1.59, 1.02, .08], [-1.59, .58, .08]], colors.ink, .19 * roomOpacity, .8, true);

    context.setLineDash([3, 5]);
    line(route.map(([x, z]) => [x, .015, z]), colors.detail, pathOpacity, 1.3 + .65 * emphasis.path);
    context.setLineDash([]);
    route.forEach(([x, z], index) => dot([x, .015, z], index === 0 || index === route.length - 1 ? 3 : 1.8, colors.paper, true, colors.detail, pathOpacity));

    // Sort the cuboid faces in camera space so the furniture stays solid while orbiting.
    const faces = [];
    furniture.forEach(([x, y, z, w, h, d]) => {
      const corners = [[x, y, z], [x + w, y, z], [x + w, y, z + d], [x, y, z + d],
        [x, y + h, z], [x + w, y + h, z], [x + w, y + h, z + d], [x, y + h, z + d]];
      [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]].forEach((indices, side) => {
        const points = indices.map(index => corners[index]);
        faces.push({ points, depth: points.reduce((sum, point) => sum + project(point)[2], 0) / 4, side });
      });
    });
    faces.sort((a, b) => a.depth - b.depth).forEach(face => {
      trace(face.points, true);
      context.fillStyle = colors.paper;
      context.fill();
      context.fillStyle = colors.accent;
      context.globalAlpha = (face.side === 4 ? .06 : .1) * roomOpacity;
      context.fill();
      context.globalAlpha = 1;
      line(face.points, colors.ink, .38 * roomOpacity, .95, true);
    });

    let distance = (elapsed * .25) % (routeLength * 2);
    const direction = distance > routeLength ? -1 : 1;
    if (direction < 0) distance = routeLength * 2 - distance;
    let segment = 0;
    while (segment < segmentLengths.length - 1 && distance > segmentLengths[segment]) {
      distance -= segmentLengths[segment];
      segment += 1;
    }
    const start = route[segment];
    const end = route[segment + 1];
    const progress = distance / segmentLengths[segment];
    const x = start[0] + (end[0] - start[0]) * progress;
    const z = start[1] + (end[1] - start[1]) * progress;
    const forwardX = (end[0] - start[0]) / segmentLengths[segment] * direction;
    const forwardZ = (end[1] - start[1]) / segmentLengths[segment] * direction;
    const stride = Math.sin(elapsed * 7) * .09;
    const body = (side, y, forward = 0) => [x - forwardZ * side + forwardX * forward, y, z + forwardX * side + forwardZ * forward];

    dot([x, .012, z], 3.5, colors.paper, true, colors.person, personOpacity);
    line([body(0, .33), body(0, .61)], colors.person, personOpacity, 1.7 * personWeight);
    line([body(-.1, .57), body(.1, .57)], colors.person, personOpacity, 1.5 * personWeight);
    for (const side of [-1, 1]) {
      line([body(side * .1, .57), body(side * .14, .43, -stride * side), body(side * .12, .32, -stride * side)], colors.person, personOpacity * .9, 1.5 * personWeight);
      line([body(side * .045, .33), body(side * .055, .17, stride * side), body(side * .06, 0, stride * side)], colors.person, personOpacity, 1.6 * personWeight);
      line([body(side * .06, 0, stride * side), body(side * .06, 0, stride * side + .065)], colors.person, personOpacity, 1.6 * personWeight);
    }
    dot(body(0, .69), scale * .063, colors.paper, true, colors.person, personOpacity);
    if (animating || cameraTransition) requestFrame();
  }

  function togglePlayback() {
    if (motionReduced) return;
    playing = !playing;
    stopFrame();
    updateLabels();
    requestFrame();
  }

  function selectView(view) {
    if (!views[view]) return;
    currentView = view;
    const targetYaw = yaw + Math.atan2(Math.sin(views[view].yaw - yaw), Math.cos(views[view].yaw - yaw));
    if (motionReduced) {
      yaw = targetYaw;
      pitch = views[view].pitch;
      Object.keys(views).forEach(name => { emphasis[name] = name === view ? 1 : 0; });
      cameraTransition = null;
    } else {
      cameraTransition = { yaw, pitch, targetYaw, targetPitch: views[view].pitch, emphasis: { ...emphasis }, elapsed: 0 };
    }
    previousTime = 0;
    updateLabels();
    requestFrame();
  }

  function resetView() {
    selectView('scene');
  }

  function rotate(horizontal, vertical) {
    cameraTransition = null;
    Object.keys(views).forEach(view => { emphasis[view] = view === currentView ? 1 : 0; });
    yaw += horizontal;
    pitch = Math.max(.25, Math.min(1.05, pitch + vertical));
    requestFrame();
  }

  toggleButton.addEventListener('click', togglePlayback);
  resetButton.addEventListener('click', resetView);
  viewButtons.forEach(button => {
    button.addEventListener('click', () => selectView(button.dataset.sceneView));
  });
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointer) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    rotate((event.clientX - pointer.x) * .009, (event.clientY - pointer.y) * .007);
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  });
  function endDrag(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    pointer = null;
    canvas.style.cursor = 'grab';
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);
  canvas.addEventListener('keydown', event => {
    const arrows = { ArrowLeft: [-.1, 0], ArrowRight: [.1, 0], ArrowUp: [0, -.08], ArrowDown: [0, .08] };
    if (arrows[event.key]) rotate(...arrows[event.key]);
    else if (event.code === 'Space') togglePlayback();
    else if (event.key === 'Home') resetView();
    else return;
    event.preventDefault();
  });

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (visible) resize();
    else stopFrame();
  }).observe(canvas);
  function syncPageState() {
    const nextReduced = readMotionSetting();
    if (nextReduced !== motionReduced) {
      motionReduced = nextReduced;
      if (motionReduced && cameraTransition) {
        yaw = cameraTransition.targetYaw;
        pitch = cameraTransition.targetPitch;
        Object.keys(views).forEach(view => { emphasis[view] = view === currentView ? 1 : 0; });
        cameraTransition = null;
      }
      stopFrame();
      requestFrame();
    }
    updateLabels();
  }
  new MutationObserver(syncPageState).observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'data-motion'] });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopFrame();
    else requestFrame();
  });
  reducedMotion.addEventListener('change', syncPageState);
  window.addEventListener('resize', resize);
  updateLabels();
  resize();
})();
