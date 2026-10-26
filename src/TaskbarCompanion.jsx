import { useEffect, useRef } from "react";
import { companionPose } from "./companion-path.mjs";

// A quiet, low-cost taskbar animation. Pose follows a continuous capsule path:
// straight passes with semicircular turns, rather than abrupt direction flips.
export default function TaskbarCompanion({ theme, phase }) {
  const canvas = useRef(),
    current = useRef({ theme, phase });
  current.current = { theme, phase };
  useEffect(() => {
    const el = canvas.current,
      c = el.getContext("2d"),
      reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame,
      last = performance.now(),
      distance = -36,
      wasWorking = false,
      heading = 0,
      x = 18,
      y = 20,
      w = 280,
      h = 42;
    const dust = [];
    let emission = 0;
    const size = () => {
      w = el.clientWidth;
      h = el.clientHeight;
      const ratio = Math.min(devicePixelRatio, 2);
      el.width = Math.round(w * ratio);
      el.height = Math.round(h * ratio);
      c.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const observer = new ResizeObserver(size);
    observer.observe(el);
    size();
    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const s = current.current,
        working = ["departing", "cleaning", "wet"].includes(s.phase),
        wet = s.phase === "wet";
      if (working && !wasWorking) distance = -36;
      wasWorking = working;
      if (working && !reduced) distance += dt * 32;
      const p =
        working && !reduced
          ? companionPose(w, h, distance)
          : { x: 18, y: h * 0.5, a: Math.PI };
      const speed = working ? 12 : 4.5;
      x += (p.x - x) * (1 - Math.exp(-speed * dt));
      y += (p.y - y) * (1 - Math.exp(-speed * dt));
      const angle = Math.atan2(
        Math.sin(p.a - heading),
        Math.cos(p.a - heading),
      );
      heading += angle * (1 - Math.exp(-9 * dt));
      c.clearRect(0, 0, w, h);
      // Small dock contacts; the Windows tray icon remains the permanent station.
      c.fillStyle = s.theme === "light" ? "#71816b" : "#b5c5a4";
      c.globalAlpha = 0.45;
      c.beginPath();
      c.roundRect(5, h * 0.5 - 10, 6, 20, 3);
      c.fill();
      c.globalAlpha = 1;
      emission += dt;
      if (working && !reduced && emission > 0.06) {
        emission = 0;
        dust.push({
          x: x - Math.cos(heading) * 10,
          y: y - Math.sin(heading) * 10,
          life: 1,
          wet,
        });
      }
      for (let i = dust.length - 1; i >= 0; i--) {
        const d = dust[i];
        d.life -= dt * 0.85;
        if (d.life <= 0) {
          dust.splice(i, 1);
          continue;
        }
        c.globalAlpha = d.life * (d.wet ? 0.32 : 0.22);
        c.fillStyle = d.wet
          ? "#9dd9ee"
          : s.theme === "light"
            ? "#e9eee2"
            : "#e0e6d7";
        c.beginPath();
        c.ellipse(
          d.x,
          d.y,
          d.wet ? 2.8 : 1.8,
          d.wet ? 1.7 : 1.2,
          0,
          0,
          Math.PI * 2,
        );
        c.fill();
      }
      c.globalAlpha = 1;
      const r = Math.min(13, h * 0.3);
      c.save();
      c.translate(x, y);
      c.rotate(heading);
      c.fillStyle = "#15231133";
      c.beginPath();
      c.ellipse(1, 2, r, r * 0.93, 0, 0, Math.PI * 2);
      c.fill();
      // The side brush sits below the shell; only its outer bristles show.
      if (working && !reduced) {
        c.strokeStyle = s.theme === "light" ? "#c3ccb8" : "#8b9c7a";
        c.lineWidth = 0.7;
        const spin = now * 0.015;
        c.save();
        c.translate(r * 0.55, r * 0.7);
        c.rotate(spin);
        for (let i = 0; i < 3; i++) {
          c.rotate((Math.PI * 2) / 3);
          c.beginPath();
          c.moveTo(0, 0);
          c.lineTo(4, 0);
          c.stroke();
        }
        c.restore();
      }
      const g = c.createRadialGradient(-r * 0.4, -r * 0.5, 1, 0, 0, r);
      g.addColorStop(0, s.theme === "light" ? "#fafbf5" : "#76806e");
      g.addColorStop(0.65, s.theme === "light" ? "#dce1d3" : "#394431");
      g.addColorStop(1, s.theme === "light" ? "#a6b09b" : "#26321e");
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = 0.8;
      c.strokeStyle = s.theme === "light" ? "#eef2e9" : "#9eac8e";
      c.stroke();
      c.strokeStyle = s.theme === "light" ? "#929e86" : "#1a2615";
      c.lineWidth = 0.5;
      c.beginPath();
      c.arc(0, 0, r - 2.5, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = s.theme === "light" ? "#b9c3ae" : "#4d5e3e";
      c.beginPath();
      c.arc(-r * 0.27, 0, r * 0.3, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = wet ? "#acdff0" : "#b7cc9f";
      c.stroke();
      c.fillStyle = wet ? "#acdff0" : "#c4d6aa";
      c.beginPath();
      c.arc(r * 0.34, 0, 1.1, 0, Math.PI * 2);
      c.fill();
      c.restore();
      el.dataset.motion = working
        ? "capsule"
        : s.phase === "returning"
          ? "returning"
          : "docked";
      el.dataset.trail = wet ? "water" : working ? "dust" : "none";
      el.dataset.offset = x.toFixed(2);
      el.dataset.offsetY = y.toFixed(2);
      el.dataset.heading = heading.toFixed(3);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return (
    <canvas
      ref={canvas}
      className="taskbar-canvas"
      aria-label="Small vacuum driving looping passes beside Start"
    />
  );
}
