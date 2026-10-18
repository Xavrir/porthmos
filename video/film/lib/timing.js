(function () {
  // Film-wide timing shared by index.html (16:9) and square.html (1:1). Times are global seconds from SCRIPT.md.

  const SEA_OPACITY = [
    { t: 12, v: 1, dur: 2.6 },
    { t: 25, v: 0.16 },
    { t: 38, v: 0.34 },
    { t: 93, v: 0.24 },
    { t: 113, v: 0.2 },
    { t: 123, v: 0.3, dur: 0.4 },
    { t: 143, v: 0.2 },
    { t: 160, v: 0.32 },
    { t: 165.8, v: 0.16, dur: 0.5 },
    { t: 186, v: 0.8 },
    { t: 202, v: 0.5 },
    { t: 216, v: 1 },
  ];

  const ramp = (a, b, x) => Math.max(0, Math.min(1, (x - a) / (b - a)));
  const ease = (x) => x * x * (3 - 2 * x);

  function seaParams(t) {
    const part = ease(ramp(15.6, 17.4, t)) * (1 - 0.65 * ease(ramp(19.5, 22, t))) * (t < 25 ? 1 : 0);
    const calm = ease(ramp(215, 218, t));
    let shipFrac = null;
    let ship = true;
    if (t < 25) shipFrac = 0.79 + (t - 12) * 0.0028;
    else if (t >= 186 && t < 202) shipFrac = 0.06 + (t - 186) * 0.005;
    else if (t >= 216) shipFrac = 0.7 + (t - 216) * 0.0035;
    else ship = (t < 93 || t >= 113) && (t < 202 || t >= 216);
    return { part, calm, shipFrac, ship };
  }

  function seaTrack(tl, canvas, layer, night, from, to) {
    const sea = PorthmosSea.create(canvas, { fontPx: canvas.width >= 1900 ? 16 : 14 });
    const drive = FX.driver((t) => {
      if (t >= 11.5) sea.draw(t, seaParams(t));
    });
    tl.fromTo(drive, { v: from }, { v: to, duration: to - from, ease: "none", immediateRender: true }, 0);
    tl.set(layer, { opacity: 0 }, 0);
    tl.set(night, { opacity: 0 }, 0);
    tl.set(night, { opacity: 1 }, 11.95 - from);
    SEA_OPACITY.forEach((k) => {
      if (k.t >= to) return;
      const at = Math.max(0, k.t - from);
      if (k.dur) tl.to(layer, { opacity: k.v, duration: k.dur, ease: "power1.inOut" }, at);
      else tl.set(layer, { opacity: k.v }, at);
    });
    return sea;
  }

  window.FILM = { seaParams, seaTrack };
})();
