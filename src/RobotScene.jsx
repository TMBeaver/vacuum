import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createRobot } from "./robot-model";

const labels = {
  power: "Power",
  bin: "Dust bin",
  mop: "Wet clean",
  auto: "Autoclean",
  dock: "Home",
  station: "The station",
};
const leaders = {
  power: "M20 20 L110 -45 L145 -45",
  mop: "M20 20 L-50 -42 L-70 -42",
  auto: "M20 20 L-65 56 L-110 56",
  dock: "M20 20 L140 56 L180 56",
  bin: "M20 20 L20 98 L20 114",
  station: "M20 20 L44 -40 L52 -40",
};
export default function RobotScene({
  theme,
  wet,
  active,
  phase = "docked",
  binOpen = false,
  binCount = 0,
  auto = false,
  mini = false,
  disabled = false,
  onAction = () => {},
}) {
  const host = useRef(),
    canvasHost = useRef(),
    hotspots = useRef({}),
    current = useRef({}),
    pressed = useRef({ action: null, until: 0 }),
    renderActivity = useRef(performance.now() + 1800),
    [hover, setHover] = useState(null),
    [failed, setFailed] = useState(false);
  current.current = {
    theme,
    wet,
    active,
    phase,
    binOpen,
    binCount,
    auto,
    disabled,
    onAction,
  };
  useEffect(() => {
    const el = host.current,
      mount = canvasHost.current;
    if (!el || !mount) return;
    let renderer, frame, observer, controls, environmentMap;
    const scene = new THREE.Scene(),
      model = createRobot(theme === "dark");
    scene.add(model.robot, model.dock);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: mini ? "low-power" : "high-performance",
      });
      renderer.setPixelRatio(Math.min(devicePixelRatio, mini ? 1.5 : 2));
      renderer.shadowMap.enabled = !mini;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      mount.appendChild(renderer.domElement);
      const pmrem = new THREE.PMREMGenerator(renderer),
        room = new RoomEnvironment();
      environmentMap = pmrem.fromScene(room, 0.05);
      scene.environment = environmentMap.texture;
      room.dispose();
      pmrem.dispose();
      const camera = mini
        ? new THREE.OrthographicCamera(-18, 18, 3.6, -3.6, 0.1, 100)
        : new THREE.PerspectiveCamera(28, 1, 0.1, 100);
      camera.position.set(...(mini ? [0, 17, 23] : [3.2, 7.7, 8.8]));
      camera.lookAt(0, 0.3, -0.3);
      if (!mini) {
        controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 0.3, -0.3);
        controls.enableDamping = true;
        controls.dampingFactor = 0.075;
        controls.enablePan = false;
        controls.enableZoom = false;
        controls.minPolarAngle = 0.38;
        controls.maxPolarAngle = 1.03;
        controls.minAzimuthAngle = -0.85;
        controls.maxAzimuthAngle = 0.85;
        controls.rotateSpeed = 0.45;
      }
      scene.add(new THREE.AmbientLight(0xf0f3eb, 0.7));
      const key = new THREE.DirectionalLight(0xfff7e9, 3);
      key.position.set(-3, 9, 5);
      key.castShadow = !mini;
      key.shadow.mapSize.set(2048, 2048);
      Object.assign(key.shadow.camera, {
        left: -6,
        right: 6,
        top: 6,
        bottom: -6,
      });
      key.shadow.normalBias = 0.025;
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xd8e7f2, 1.9);
      rim.position.set(5, 4, -5);
      scene.add(rim);
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 100),
        new THREE.ShadowMaterial({ opacity: theme === "dark" ? 0.3 : 0.16 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);
      if (mini) {
        model.dock.position.x = -12.8;
        model.robot.position.x = -12.8;
        model.robot.scale.setScalar(0.78);
        model.dock.scale.setScalar(0.7);
      }
      const trailMaterial = new THREE.MeshBasicMaterial({
          color: 0xb3bd9f,
          transparent: true,
          opacity: 0.23,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
        trail = new THREE.InstancedMesh(
          new THREE.CircleGeometry(1, 10),
          trailMaterial,
          64,
        );
      trail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      trail.frustumCulled = false;
      scene.add(trail);
      const particles = Array.from({ length: 64 }, () => ({
          life: 0,
          x: 0,
          z: 0,
          wet: false,
        })),
        dummy = new THREE.Object3D();
      let particleIndex = 0,
        spawnTime = 0;
      const ray = new THREE.Raycaster(),
        pointer = new THREE.Vector2(),
        down = new THREE.Vector2();
      const targetAt = (e) => {
        const r = renderer.domElement.getBoundingClientRect();
        pointer.set(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        );
        ray.setFromCamera(pointer, camera);
        return ray.intersectObjects(model.interactive, false)[0]?.object
          .userData.action;
      };
      const pointerDown = (e) => {
          down.set(e.clientX, e.clientY);
          pressed.current = {
            action: targetAt(e),
            until: performance.now() + 220,
          };
        },
        pointerMove = (e) => {
          renderActivity.current = performance.now() + 1500;
          const action = targetAt(e);
          mount.style.cursor = action ? "pointer" : "grab";
          setHover((prev) => (prev === action ? prev : action || null));
        },
        pointerUp = (e) => {
          if (down.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) < 6) {
            const action = targetAt(e);
            if (action && !current.current.disabled)
              current.current.onAction(action);
          }
        },
        leave = () => setHover(null);
      if (!mini) {
        renderer.domElement.addEventListener("pointerdown", pointerDown);
        renderer.domElement.addEventListener("pointermove", pointerMove);
        renderer.domElement.addEventListener("pointerup", pointerUp);
        renderer.domElement.addEventListener("pointerleave", leave);
      }
      const resize = () => {
        const w = el.clientWidth,
          h = el.clientHeight;
        renderer.setSize(w, h);
        if (mini) {
          camera.left = -18;
          camera.right = 18;
          camera.top = (18 * h) / w;
          camera.bottom = (-18 * h) / w;
        } else camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      observer = new ResizeObserver(resize);
      observer.observe(el);
      resize();
      const clock = new THREE.Clock(),
        point = new THREE.Vector3();
      let lastTheme = theme,
        themeProgress = 1;
      let elapsed = 0,
        sweepTime = 0,
        wasWorking = false,
        moving = 0,
        opening = 0,
        mopping = 0,
        emptying = 0,
        lastPaint = 0,
        heading = 0;
      const animate = (now) => {
        frame = requestAnimationFrame(animate);
        const live = current.current;
        const motion =
          ["departing", "cleaning", "wet", "returning", "emptying"].includes(
            live.phase,
          ) ||
          live.theme !== lastTheme ||
          themeProgress < 0.999 ||
          live.binOpen ||
          opening > 0.005 ||
          Math.abs(mopping - Number(live.wet)) > 0.005 ||
          now < renderActivity.current;
        if (!motion && now - lastPaint < 49) return;
        lastPaint = now;
        const dt = Math.min(clock.getDelta(), 0.05);
        elapsed += dt;
        if (live.theme !== lastTheme) {
          lastTheme = live.theme;
          themeProgress = 0;
        }
        const themeBlend = 1 - Math.exp(-6 * dt);
        themeProgress = THREE.MathUtils.lerp(themeProgress, 1, themeBlend);
        model.updateTheme(live.theme === "dark", themeBlend);
        floor.material.opacity = THREE.MathUtils.lerp(
          floor.material.opacity,
          live.theme === "dark" ? 0.3 : 0.16,
          themeBlend,
        );
        const s = current.current,
          working = ["departing", "cleaning", "wet"].includes(s.phase),
          returning = s.phase === "returning",
          washing = s.phase === "wet",
          damp = (v, t, speed = 5) => THREE.MathUtils.damp(v, t, speed, dt);
        if (working && !wasWorking) sweepTime = 0;
        if (working) sweepTime += dt;
        wasWorking = working;
        moving = damp(moving, working ? 1 : 0, 2.8);
        opening = damp(opening, s.binOpen || s.phase === "emptying" ? 1 : 0, 6);
        mopping = damp(mopping, s.wet ? 1 : 0, 5);
        emptying = damp(emptying, s.phase === "emptying" ? 1 : 0, 8);
        if (mini) {
          const route = reduced
            ? -0.25
            : Math.sin(sweepTime * 0.68 - Math.PI / 2);
          model.robot.position.x = damp(
            model.robot.position.x,
            working ? route * 12.5 : -12.8,
            returning ? 4 : 7,
          );
          const direction = Math.cos(sweepTime * 0.68 - Math.PI / 2);
          heading = damp(
            heading,
            working ? (direction > 0 ? -Math.PI / 2 : Math.PI / 2) : 0,
            4,
          );
          model.robot.rotation.y = reduced ? 0 : heading;
          model.robot.position.z = working ? 0.15 : 0;
        } else {
          model.robot.position.x = reduced
            ? 0
            : damp(
                model.robot.position.x,
                working ? Math.sin(elapsed * 0.68) * 0.95 : 0,
                3,
              );
          model.robot.position.z = reduced
            ? 0
            : damp(
                model.robot.position.z,
                working ? 1 + Math.cos(elapsed * 0.45) * 0.3 : 0,
                3,
              );
          model.robot.rotation.y = reduced
            ? 0
            : damp(
                model.robot.rotation.y,
                working ? Math.cos(elapsed * 0.68) * 0.3 : 0,
                3,
              );
        }
        model.hatch.rotation.x = reduced
          ? s.binOpen
            ? -1.45
            : 0
          : -opening * 1.45;
        model.cassette.position.y = 0.43 + model.deckRise + opening * 0.75;
        model.cassette.rotation.z = reduced
          ? 0
          : Math.sin(elapsed * 8) * emptying * 0.06;
        model.dust.scale.setScalar(
          s.binCount ? Math.max(0.01, 1 - emptying) : 0.001,
        );
        model.mop.position.z = -1.52 - mopping * 0.43;
        model.mop.visible = mopping > 0.02;
        for (const [i, b] of model.brushes.entries())
          if (!reduced) b.rotation.y += dt * moving * (i ? -10 : 10);
        for (const [action, button] of Object.entries(model.buttons))
          button.position.y = damp(
            button.position.y,
            0.75 +
              model.deckRise -
              (pressed.current.action === action && now < pressed.current.until
                ? 0.025
                : 0),
            18,
          );
        if (!reduced) model.scanner.rotation.y += dt * (working ? 4 : 0.32);
        model.led.color.setHex(s.wet ? 0x9ccfe3 : 0xc3d4a9);
        model.led.emissive.setHex(s.wet ? 0x4f9ab5 : 0x8aab65);
        model.led.emissiveIntensity =
          (working ? 0.65 : 0.25) + (reduced ? 0 : Math.sin(elapsed * 2) * 0.1);
        if (!reduced && working && spawnTime > 0.045) {
          spawnTime = 0;
          const p = particles[particleIndex++ % particles.length];
          p.life = 1;
          p.x =
            model.robot.position.x + (Math.random() - 0.5) * (mini ? 0.6 : 1.8);
          p.z = model.robot.position.z + 0.7 + (Math.random() - 0.5) * 0.5;
          p.wet = washing;
        }
        spawnTime += dt;
        trailMaterial.color.setHex(washing ? 0x8bcbe4 : 0xa7af91);
        particles.forEach((p, i) => {
          p.life = Math.max(0, p.life - dt * 0.55);
          dummy.position.set(p.x, 0.018, p.z);
          dummy.rotation.set(-Math.PI / 2, 0, 0);
          dummy.scale.setScalar(p.life * (p.wet ? 0.17 : 0.065));
          dummy.updateMatrix();
          trail.setMatrixAt(i, dummy.matrix);
        });
        trail.instanceMatrix.needsUpdate = true;
        controls?.update();
        scene.updateMatrixWorld(true);
        if (!mini)
          for (const [action, anchor] of Object.entries(model.anchors)) {
            const button = hotspots.current[action];
            if (button) {
              anchor.getWorldPosition(point);
              point.project(camera);
              button.style.transform = `translate(${(point.x * 0.5 + 0.5) * el.clientWidth}px,${(-point.y * 0.5 + 0.5) * el.clientHeight}px) translate(-50%,-50%)`;
              button.style.visibility = point.z < 1 ? "visible" : "hidden";
            }
          }
        el.dataset.motion = returning
          ? "returning"
          : working
            ? "travelling"
            : opening > 0.5
              ? "hatch-open"
              : "docked";
        el.dataset.yaw = String(model.robot.rotation.y.toFixed(3));
        el.dataset.view = String(
          (controls?.getAzimuthalAngle() || 0).toFixed(3),
        );
        el.dataset.hatch = String(opening.toFixed(3));
        el.dataset.offset = String(model.robot.position.x.toFixed(3));
        el.dataset.trail = washing ? "water" : working ? "dust" : "none";
        renderer.render(scene, camera);
      };
      frame = requestAnimationFrame(animate);
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls?.dispose();
        renderer.domElement.removeEventListener("pointerdown", pointerDown);
        renderer.domElement.removeEventListener("pointermove", pointerMove);
        renderer.domElement.removeEventListener("pointerup", pointerUp);
        renderer.domElement.removeEventListener("pointerleave", leave);
        scene.traverse((o) => {
          o.geometry?.dispose();
          if (o.material)
            for (const m of Array.isArray(o.material)
              ? o.material
              : [o.material]) {
              m.map?.dispose();
              m.dispose();
            }
        });
        environmentMap.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    } catch (e) {
      console.error("Robot rendering unavailable:", e);
      renderer?.dispose();
      setFailed(true);
    }
  }, [mini]);
  const names = {
    power: active ? "Return to dock" : "Start cleaning",
    bin: "Open dust bin",
    mop: wet ? "Disable wet cleaning" : "Enable wet cleaning",
    auto: auto ? "Disable daily autoclean" : "Enable daily autoclean",
    dock: "Return to dock",
    station: active ? "Return to dock" : "Station settings",
  };
  return (
    <div
      className={`robot-scene ${mini ? "mini-scene" : ""} ${binOpen ? "bin-open" : ""}`}
      ref={host}
      role="group"
      aria-label={
        mini
          ? "Robot vacuum desktop companion"
          : "Interactive 3D vacuum. Drag to look around. Press its physical controls."
      }
    >
      <div className="canvas-mount" ref={canvasHost} />
      {!mini &&
        !failed &&
        Object.keys(labels).map((action) => (
          <button
            key={action}
            ref={(el) => {
              hotspots.current[action] = el;
            }}
            className={`robot-hotspot hotspot-${action} ${hover === action ? "hovered" : ""}`}
            aria-label={names[action]}
            aria-pressed={
              action === "mop" ? wet : action === "auto" ? auto : undefined
            }
            disabled={
              disabled ||
              (active && !["power", "dock", "station"].includes(action))
            }
            onPointerEnter={() => setHover(action)}
            onPointerMove={() => {
              renderActivity.current = performance.now() + 1500;
            }}
            onPointerDown={() => {
              pressed.current = { action, until: performance.now() + 220 };
            }}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(action)}
            onBlur={() => setHover(null)}
            onClick={() => current.current.onAction(action)}
          >
            <span className="hotspot-target" />
            <svg className="hotspot-leader" aria-hidden="true">
              <path d={leaders[action]} />
            </svg>
            <span className="hotspot-caption">
              <b>
                {action === "power"
                  ? active
                    ? "Go home"
                    : "Power"
                  : labels[action]}
              </b>
              <small>
                {action === "power"
                  ? active
                    ? "Return to dock"
                    : "Press to clean"
                  : action === "bin"
                    ? binCount
                      ? `${binCount} collected · press to empty`
                      : "Lift the lid"
                    : action === "mop"
                      ? wet
                        ? "Mop attached"
                        : "Attach the mop"
                      : action === "auto"
                        ? auto
                          ? "Daily rounds on"
                          : "Daily rounds off"
                        : action === "dock"
                          ? "Return home"
                          : "Schedule & settings"}
              </small>
            </span>
          </button>
        ))}
      {failed && (
        <div className="scene-fallback">
          <p>3D rendering is unavailable on this device.</p>
          <button className="outline-button" onClick={() => onAction("power")}>
            {names.power}
          </button>
          <button className="outline-button" onClick={() => onAction("bin")}>
            Open dust bin
          </button>
        </div>
      )}
    </div>
  );
}
