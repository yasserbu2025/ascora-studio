/* ===== Ascora cinematic demo engine — vanilla Three.js (r128) + GSAP ===== */
(function (global) {
  const Cinematic = {};

  function radial(THREE, c0, c1) {
    const cn = document.createElement('canvas'); cn.width = cn.height = 128;
    const g = cn.getContext('2d');
    const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, c0); rg.addColorStop(0.45, c1); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(cn);
  }

  Cinematic.init = function (cfg) {
    const state = { alive: true, scroll: 0, target: 0, mx: 0, my: 0, cmx: 0, cmy: 0,
      cur: { x: innerWidth / 2, y: innerHeight / 2, tx: innerWidth / 2, ty: innerHeight / 2 }, p: 0,
      introZ: cfg.introZ != null ? cfg.introZ : 16 };

    const bar = document.querySelector('.cine-pre .bar i');
    const tick = () => {
      const pct = Math.min(94, (state.p = state.p + 8));
      if (bar) bar.style.width = pct + '%';
      if (global.THREE && global.gsap) start(); else setTimeout(tick, 90);
    };
    tick();

    function start() {
      const THREE = global.THREE, gsap = global.gsap;
      const mobile = innerWidth < 768;
      const cv = document.getElementById('gl');
      const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: !mobile, alpha: false, powerPreference: 'high-performance' });
      renderer.setSize(innerWidth, innerHeight);
      renderer.setPixelRatio(Math.min(mobile ? 1.5 : 2, devicePixelRatio));
      renderer.outputEncoding = THREE.sRGBEncoding;

      const scene = new THREE.Scene();
      const bg = new THREE.Color(cfg.bg != null ? cfg.bg : 0x06070b);
      scene.background = bg;
      const fog = cfg.fog || { color: cfg.bg != null ? cfg.bg : 0x06070b, density: 0.012 };
      scene.fog = new THREE.FogExp2(fog.color, fog.density);

      const camera = new THREE.PerspectiveCamera(56, innerWidth / innerHeight, 0.1, 800);
      camera.position.set(0, 2, 24);

      const accent = new THREE.Color(cfg.accentHex != null ? cfg.accentHex : 0x4d7cff);

      // baseline cinematic lighting
      scene.add(new THREE.AmbientLight(0xffffff, cfg.ambient != null ? cfg.ambient : 0.35));
      const key = new THREE.DirectionalLight(cfg.keyColor != null ? cfg.keyColor : 0xffffff, cfg.keyInt != null ? cfg.keyInt : 1.1);
      key.position.set(8, 16, 10); scene.add(key);
      const rim = new THREE.DirectionalLight(accent.getHex(), cfg.rimInt != null ? cfg.rimInt : 0.8);
      rim.position.set(-10, 6, -12); scene.add(rim);
      const fill = new THREE.PointLight(accent.getHex(), cfg.fillInt != null ? cfg.fillInt : 0.6, 120);
      fill.position.set(0, 8, 0); scene.add(fill);

      // reflective floor (premium) with graceful fallback
      if (cfg.floor !== false) {
        const fy = cfg.floor && cfg.floor.y != null ? cfg.floor.y : 0;
        let floor;
        try {
          if (!mobile && THREE.Reflector) {
            floor = new THREE.Reflector(new THREE.PlaneGeometry(600, 600), {
              clipBias: 0.003,
              textureWidth: Math.floor(innerWidth * 0.7),
              textureHeight: Math.floor(innerHeight * 0.7),
              color: cfg.floor && cfg.floor.color != null ? cfg.floor.color : 0x070910
            });
          }
        } catch (e) { floor = null; }
        if (!floor) {
          floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600),
            new THREE.MeshStandardMaterial({ color: cfg.floor && cfg.floor.color != null ? cfg.floor.color : 0x070910, metalness: 0.9, roughness: 0.35 }));
        }
        floor.rotation.x = -Math.PI / 2; floor.position.y = fy;
        scene.add(floor);
        // soft accent glow puddle (subtle, under the scene)
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(90, 90),
          new THREE.MeshBasicMaterial({ map: radial(THREE, 'rgba(255,255,255,0.08)', 'rgba(120,150,255,0.03)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.rotation.x = -Math.PI / 2; glow.position.set(0, fy + 0.02, -42); scene.add(glow);
      }

      // atmospheric dust
      const N = mobile ? 700 : 1700;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { pos[i*3] = (Math.random()-0.5)*180; pos[i*3+1] = Math.random()*60; pos[i*3+2] = 20 - Math.random()*260; }
      const dgeo = new THREE.BufferGeometry(); dgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const dust = new THREE.Points(dgeo, new THREE.PointsMaterial({ size: mobile?0.5:0.35, map: radial(THREE, '#ffffff', cfg.dust || '#9fb6ff'), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      scene.add(dust);

      const ctx = { THREE, scene, accent, accentHex: accent.getHex(), mobile, radial: (a, b) => radial(THREE, a, b),
        glowSprite(color, size) {
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial(THREE, color, color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
          s.scale.set(size, size, 1); return s;
        } };

      const env = (cfg.build ? cfg.build(THREE, scene, ctx) : null) || {};

      // ----- real photographic gallery floating in the 3D world -----
      const photoFrames = [];
      if (cfg.photos && cfg.photos.length) {
        const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
        cfg.photos.forEach(ph => {
          const w = ph.w || 9, h = ph.h || 6;
          const back = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.4, h + 0.4), new THREE.MeshBasicMaterial({ color: 0x04050a }));
          const mat = new THREE.MeshBasicMaterial({ color: 0x12161f }); mat.toneMapped = false;
          const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); plane.position.z = 0.04;
          const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w + 0.4, h + 0.4)),
            new THREE.LineBasicMaterial({ color: accent.getHex(), transparent: true, opacity: 0.55 }));
          const glow = ctx.glowSprite('rgba(180,200,255,0.18)', Math.max(w, h) * 1.6); glow.position.z = -0.6;
          const grp = new THREE.Group(); grp.add(glow, back, plane, frame);
          grp.position.set(ph.pos[0], ph.pos[1], ph.pos[2]); grp.rotation.y = ph.ry || 0;
          scene.add(grp);
          photoFrames.push({ grp, baseY: ph.pos[1], phase: Math.random() * 6 });
          loader.load('https://images.unsplash.com/photo-' + ph.id + '?w=1000&q=80&auto=format&fit=crop',
            tex => { if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding; mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true; },
            undefined,
            () => { mat.color.set(accent.getHex()).multiplyScalar(0.25); });
        });
      }

      const keys = cfg.cameraKeys;
      function sample(t) {
        let i = 0; while (i < keys.length - 1 && t > keys[i + 1].p) i++;
        const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
        let f = b.p === a.p ? 0 : (t - a.p) / (b.p - a.p); f = Math.max(0, Math.min(1, f));
        f = f < 0.5 ? 2*f*f : 1 - Math.pow(-2*f+2, 2)/2;
        const L = (u, v) => u + (v - u) * f;
        return { pos: [L(a.pos[0],b.pos[0]), L(a.pos[1],b.pos[1]), L(a.pos[2],b.pos[2])],
                 look: [L(a.look[0],b.look[0]), L(a.look[1],b.look[1]), L(a.look[2],b.look[2])] };
      }

      // events
      const onResize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix(); };
      const onMove = e => { state.mx = e.clientX/innerWidth - 0.5; state.my = e.clientY/innerHeight - 0.5; state.cur.tx = e.clientX; state.cur.ty = e.clientY; };
      addEventListener('resize', onResize);
      addEventListener('mousemove', onMove, { passive: true });

      // custom cursor magnet
      const cursorEl = document.querySelector('.cine-cursor');
      document.querySelectorAll('[data-magnet]').forEach(el => {
        el.addEventListener('mouseenter', () => { if (cursorEl){ cursorEl.style.width='54px'; cursorEl.style.height='54px'; cursorEl.style.background='rgba(159,182,255,0.12)'; } });
        el.addEventListener('mouseleave', () => { if (cursorEl){ cursorEl.style.width='30px'; cursorEl.style.height='30px'; cursorEl.style.background='transparent'; el.style.transform=''; } });
        el.addEventListener('mousemove', e => { const r=el.getBoundingClientRect(); el.style.transform=`translate(${(e.clientX-(r.left+r.width/2))*0.25}px,${(e.clientY-(r.top+r.height/2))*0.3}px)`; });
      });

      // reveal glass panels
      const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) en.target.classList.add('in'); }), { threshold: 0.25 });
      document.querySelectorAll('.glass').forEach(g => io.observe(g));

      const tmpL = new THREE.Vector3();
      const t0 = performance.now() * 0.001;
      const floats = [...document.querySelectorAll('.cine-float')];

      function loop() {
        if (!state.alive) return;
        requestAnimationFrame(loop);
        const doc = document.documentElement;
        const max = Math.max(doc.scrollHeight, document.body.scrollHeight) - innerHeight;
        const top = window.scrollY || window.pageYOffset || 0;
        state.target = max > 0 ? top / max : 0;
        state.scroll += (state.target - state.scroll) * 0.07;
        const t = state.scroll;

        state.cmx += (state.mx - state.cmx) * 0.05; state.cmy += (state.my - state.cmy) * 0.05;
        const s = sample(t);
        const introLift = state.introZ * (1 - Math.min(1, t / 0.12)); // only affects the intro framing
        camera.position.set(s.pos[0] + state.cmx * 2.4, s.pos[1] - state.cmy * 1.6 + introLift * 0.4, s.pos[2] + introLift);
        tmpL.set(s.look[0], s.look[1], s.look[2]); camera.lookAt(tmpL);

        const now = performance.now() * 0.001 - t0;
        if (env.update) env.update(t, now);
        for (let i = 0; i < photoFrames.length; i++) { const f = photoFrames[i]; f.grp.position.y = f.baseY + Math.sin(now * 0.5 + f.phase) * 0.28; f.grp.rotation.z = Math.sin(now * 0.3 + f.phase) * 0.012; }
        dust.rotation.y += 0.0003;

        // hero title fades out over the intro fly-through
        const hero = document.querySelector('.cine-hero');
        if (hero) { const o = Math.max(0, 1 - t / 0.1); hero.style.opacity = o.toFixed(3); }
        const cue = document.querySelector('.cine-cue'); if (cue) cue.style.opacity = (t < 0.04 ? 1 : 0);

        // floating parallax cards
        floats.forEach((f, i) => {
          const show = t > (parseFloat(f.dataset.from || 0.12)) && t < (parseFloat(f.dataset.to || 0.9));
          f.classList.toggle('show', show);
          const px = state.cmx * (12 + i * 6), py = state.cmy * (10 + i * 5);
          f.style.transform = `translate(${px}px,${py}px)`;
        });

        if (cursorEl) { state.cur.x += (state.cur.tx-state.cur.x)*0.18; state.cur.y += (state.cur.ty-state.cur.y)*0.18; cursorEl.style.left = state.cur.x+'px'; cursorEl.style.top = state.cur.y+'px'; }

        renderer.render(scene, camera);
      }
      loop();

      // preloader out → CSS-driven hero reveal (reliable even if GSAP is paused)
      setTimeout(() => {
        if (bar) bar.style.width = '100%';
        const pre = document.querySelector('.cine-pre');
        if (pre) { pre.style.opacity = '0'; setTimeout(() => pre.style.display = 'none', 950); }
        document.body.classList.add('ready');
        // GSAP enhancement: cinematic camera push-in on arrival (visible tabs only).
        if (gsap && gsap.to) gsap.to(state, { introZ: 0, duration: 2.8, ease: 'power2.out' });
      }, 500);
    }
  };

  global.Cinematic = Cinematic;
})(window);
