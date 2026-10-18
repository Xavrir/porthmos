(function () {
  // Motion helpers shared by every scene. Every effect is placed on a paused GSAP timeline, so a frame depends only on
  // the seek time. Text effects use accessor proxies: GSAP assigns the property on every seek, even when callbacks are
  // suppressed, so the setter always runs.

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function driver(apply) {
    let v = 0;
    const p = {};
    Object.defineProperty(p, "v", {
      get: () => v,
      set: (x) => {
        v = x;
        apply(x);
      },
    });
    return p;
  }

  function type(tl, el, text, at, dur) {
    const chars = Array.from(text);
    const p = driver((x) => {
      el.textContent = chars.slice(0, Math.round(x * chars.length)).join("");
    });
    el.textContent = "";
    tl.fromTo(p, { v: 0 }, { v: 1, duration: dur, ease: "none", immediateRender: false }, at);
    tl.set(p, { v: 0 }, 0);
    return tl;
  }

  function blink(tl, el, from, to, period) {
    const half = (period || 1) / 2;
    for (let t = from, on = true; t < to; t += half, on = !on) tl.set(el, { opacity: on ? 1 : 0 }, t);
    tl.set(el, { opacity: 0 }, to);
  }

  function glitch(tl, el, at, dur, seed, strength) {
    const r = rng(seed || 7);
    const k = strength || 1;
    const step = 1 / 30;
    for (let t = 0; t < dur; t += step) {
      const on = r() < 0.7;
      const top = Math.floor(r() * 80);
      const h = 6 + Math.floor(r() * 30);
      tl.set(
        el,
        {
          x: on ? (r() - 0.5) * 36 * k : 0,
          skewX: on ? (r() - 0.5) * 14 * k : 0,
          textShadow: on
            ? `${(-6 - r() * 8) * k}px 0 rgba(249,149,16,0.85), ${(6 + r() * 8) * k}px 0 rgba(78,195,151,0.7)`
            : "none",
          clipPath: on && r() < 0.5 ? `inset(${top}% 0 ${Math.max(0, 100 - top - h)}% 0)` : "inset(0% 0 0% 0)",
        },
        at + t,
      );
    }
    tl.set(el, { x: 0, skewX: 0, textShadow: "none", clipPath: "inset(0% 0 0% 0)" }, at + dur);
  }

  function count(tl, el, to, at, dur, fmt, ease) {
    const f = fmt || ((x) => Math.round(x).toLocaleString("en-US"));
    const p = driver((x) => {
      el.textContent = f(x);
    });
    el.textContent = f(0);
    tl.set(p, { v: 0 }, 0);
    tl.fromTo(p, { v: 0 }, { v: to, duration: dur, ease: ease || "power2.out", immediateRender: false }, at);
  }

  // Camera move on a wrapper whose transform-origin is 0 0: scale s, then translate so the focal point (fx, fy, as
  // fractions of the screen) lands on the screen centre, clamped so the frame edge never shows.
  function cam(s, fx, fy, W, H) {
    const x = Math.min(0, Math.max(W - W * s, W / 2 - fx * W * s));
    const y = Math.min(0, Math.max(H - H * s, H / 2 - fy * H * s));
    return { scale: s, x, y };
  }

  function zoom(tl, el, keys, W, H) {
    tl.set(el, Object.assign({ transformOrigin: "0 0" }, cam(1, 0.5, 0.5, W, H)), 0);
    keys.forEach((k) => {
      tl.to(el, Object.assign({ duration: k.dur || 0.9, ease: k.ease || "power3.inOut" }, cam(k.scale, k.fx, k.fy, W, H)), k.at);
    });
  }

  function stamp(tl, el, at) {
    tl.fromTo(
      el,
      { opacity: 0, scale: 2.4, rotation: -14 },
      { opacity: 1, scale: 1, rotation: -6, duration: 0.28, ease: "back.out(2.2)", immediateRender: true },
      at,
    );
  }

  function rise(tl, el, at, opts) {
    const o = opts || {};
    tl.fromTo(
      el,
      { opacity: 0, y: o.y == null ? 40 : o.y },
      { opacity: 1, y: 0, duration: o.dur || 0.6, ease: o.ease || "power3.out", stagger: o.stagger || 0 },
      at,
    );
  }

  function slam(tl, el, at, opts) {
    const o = opts || {};
    tl.fromTo(
      el,
      { opacity: 0, scale: o.from || 1.35 },
      { opacity: 1, scale: 1, duration: o.dur || 0.22, ease: "power4.out", stagger: o.stagger || 0 },
      at,
    );
  }

  window.FX = { rng, driver, type, blink, glitch, count, cam, zoom, stamp, rise, slam };
})();
