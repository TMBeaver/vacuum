import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

function lettering(text, color, size = 72) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const c = canvas.getContext("2d");
  c.fillStyle = color;
  c.font = `500 ${size}px Arial`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, 256, 80);
  return new THREE.CanvasTexture(canvas);
}
export default function RobotScene({ theme, wet, active, onStart }) {
  const host = useRef(),
    current = useRef({ active, wet, onStart }),
    [failed, setFailed] = useState(false);
  current.current = { active, wet, onStart };
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer, frame, observer;
    const dark = theme === "dark",
      reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const robot = new THREE.Group();
    scene.add(robot);
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
      });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      el.appendChild(renderer.domElement);
      const environment = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      const environmentMap = environment.fromScene(room, 0.04);
      scene.environment = environmentMap.texture;
      room.dispose();
      environment.dispose();
      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
      camera.position.set(5.6, 9.2, 9.8);
      camera.lookAt(0, 0.1, -0.1);
      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const key = new THREE.DirectionalLight(0xfff8e9, 2.5);
      key.position.set(-4, 9, 4);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = -6;
      key.shadow.camera.right = 6;
      key.shadow.camera.top = 6;
      key.shadow.camera.bottom = -6;
      key.shadow.normalBias = 0.025;
      key.shadow.radius = 7;
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xdbe8f4, 1.6);
      rim.position.set(6, 4, -3);
      scene.add(rim);
      const body = new THREE.MeshPhysicalMaterial({
        color: dark ? 0x252a28 : 0xd7d9d0,
        metalness: dark ? 0.52 : 0.12,
        roughness: 0.3,
        clearcoat: 0.5,
        clearcoatRoughness: 0.32,
        envMapIntensity: 0.6,
      });
      const top = new THREE.MeshPhysicalMaterial({
        color: dark ? 0x161c19 : 0xd7d9d0,
        metalness: dark ? 0.32 : 0.08,
        roughness: 0.34,
        clearcoat: 0.55,
        envMapIntensity: 0.6,
      });
      const charcoal = new THREE.MeshStandardMaterial({
        color: 0x171c1a,
        roughness: 0.65,
      });
      const metal = new THREE.MeshStandardMaterial({
        color: dark ? 0x69736c : 0xbcc3b8,
        metalness: 0.8,
        roughness: 0.3,
      });
      const light = new THREE.MeshStandardMaterial({
        color: wet ? 0x91c8e0 : 0xb8c996,
        emissive: wet ? 0x4a91aa : 0x7b9752,
        emissiveIntensity: 0.4,
      });
      const mesh = (
        geometry,
        material,
        x = 0,
        y = 0,
        z = 0,
        parent = robot,
      ) => {
        const m = new THREE.Mesh(geometry, material);
        m.position.set(x, y, z);
        m.castShadow = true;
        m.receiveShadow = true;
        parent.add(m);
        return m;
      };
      const cylinder = (r, h, mat, x, y, z, parent) =>
        mesh(new THREE.CylinderGeometry(r, r, h, 128), mat, x, y, z, parent);
      cylinder(2, 0.32, charcoal, 0, 0.3, 0);
      cylinder(2.035, 0.19, body, 0, 0.49, 0);
      cylinder(2, 0.09, metal, 0, 0.62, 0);
      cylinder(1.975, 0.1, top, 0, 0.7, 0);
      const seam = mesh(
        new THREE.TorusGeometry(1.8, 0.008, 8, 128),
        charcoal,
        0,
        0.757,
        0,
      );
      seam.rotation.x = Math.PI / 2;
      const rimRing = mesh(
        new THREE.TorusGeometry(2.01, 0.018, 12, 128),
        metal,
        0,
        0.625,
        0,
      );
      rimRing.rotation.x = Math.PI / 2;
      cylinder(0.53, 0.09, charcoal, 0, 0.805, -0.65);
      cylinder(0.49, 0.18, body, 0, 0.925, -0.65);
      cylinder(0.455, 0.035, top, 0, 1.034, -0.65);
      const lidar = mesh(
        new THREE.TorusGeometry(0.48, 0.015, 10, 80),
        light,
        0,
        0.94,
        -0.65,
      );
      lidar.rotation.x = Math.PI / 2;
      // The power button is a real, raycastable part of the robot.
      cylinder(0.245, 0.035, charcoal, 0, 0.787, 0.45);
      const power = cylinder(0.221, 0.027, body, 0, 0.81, 0.45);
      const powerCanvas = document.createElement("canvas");
      powerCanvas.width = 128;
      powerCanvas.height = 128;
      const ctx = powerCanvas.getContext("2d");
      ctx.strokeStyle = wet ? "#9ccfe3" : "#b9cc9b";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(64, 67, 27, -Math.PI * 0.3, Math.PI * 1.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(64, 31);
      ctx.lineTo(64, 63);
      ctx.stroke();
      const p = mesh(
        new THREE.PlaneGeometry(0.3, 0.3),
        new THREE.MeshBasicMaterial({
          map: new THREE.CanvasTexture(powerCanvas),
          transparent: true,
          depthWrite: false,
        }),
        0,
        0.827,
        0.45,
      );
      p.rotation.x = -Math.PI / 2;
      cylinder(0.07, 0.02, metal, -0.42, 0.79, 0.45);
      cylinder(0.07, 0.02, metal, 0.42, 0.79, 0.45);
      const word = mesh(
        new THREE.PlaneGeometry(1.15, 0.36),
        new THREE.MeshBasicMaterial({
          map: lettering("vacuum", dark ? "#a1a89f" : "#747d70"),
          transparent: true,
          depthWrite: false,
        }),
        0,
        0.762,
        1.12,
      );
      word.rotation.x = -Math.PI / 2;
      const sensor = mesh(
        new THREE.BoxGeometry(0.68, 0.13, 0.06),
        charcoal,
        0,
        0.43,
        2.0,
      );
      sensor.rotation.x = 0.1;
      for (const x of [-1.45, 1.45])
        mesh(new THREE.BoxGeometry(0.28, 0.22, 0.62), charcoal, x, 0.14, 0.1);
      // Three-armed side brush, tucked under the body.
      const brush = new THREE.Group();
      brush.position.set(-1.68, 0.17, 1.27);
      robot.add(brush);
      for (let i = 0; i < 3; i++) {
        const arm = mesh(
          new THREE.BoxGeometry(0.06, 0.025, 0.58),
          metal,
          0,
          0,
          0.22,
          brush,
        );
        arm.rotation.y = (i * Math.PI * 2) / 3;
        arm.position.set(
          Math.sin(arm.rotation.y) * 0.25,
          0,
          Math.cos(arm.rotation.y) * 0.25,
        );
      }
      const dock = new THREE.Group();
      dock.position.set(0, 0, -2.4);
      scene.add(dock);
      const dockmat = new THREE.MeshPhysicalMaterial({
        color: dark ? 0x1a211c : 0xc8cec0,
        roughness: 0.43,
        metalness: 0.18,
        envMapIntensity: 0.5,
      });
      const base = mesh(
        new RoundedBoxGeometry(2.6, 0.14, 1.25, 4, 0.06),
        dockmat,
        0,
        0.08,
        0,
        dock,
      );
      base.castShadow = false;
      mesh(
        new RoundedBoxGeometry(2.38, 1.18, 0.4, 5, 0.1),
        dockmat,
        0,
        0.64,
        -0.5,
        dock,
      );
      mesh(
        new THREE.BoxGeometry(0.35, 0.025, 0.025),
        light,
        0,
        1.04,
        -0.282,
        dock,
      );
      for (const x of [-0.55, 0.55])
        mesh(
          new THREE.BoxGeometry(0.17, 0.025, 0.23),
          metal,
          x,
          0.165,
          0.15,
          dock,
        );
      const floor = mesh(
        new THREE.PlaneGeometry(200, 200),
        new THREE.ShadowMaterial({ opacity: dark ? 0.2 : 0.12 }),
        0,
        0,
        0,
        scene,
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      floor.castShadow = false;
      const raycaster = new THREE.Raycaster(),
        pointer = new THREE.Vector2();
      const click = (e) => {
        const rect = el.getBoundingClientRect();
        pointer.set(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.intersectObjects(robot.children, true).length)
          current.current.onStart();
      };
      el.addEventListener("pointerup", click);
      const resize = () => {
        const { width, height } = el.getBoundingClientRect();
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      observer = new ResizeObserver(resize);
      observer.observe(el);
      resize();
      const clock = new THREE.Clock();
      let moving = 0;
      const animate = () => {
        const t = clock.getElapsedTime();
        moving += (Number(current.current.active) - moving) * 0.035;
        robot.position.z = moving * (0.8 + Math.sin(t * 0.7) * 0.2);
        robot.position.x = reduced ? 0 : Math.sin(t * 0.65) * 0.36 * moving;
        robot.rotation.y = reduced ? 0 : Math.sin(t * 0.65) * 0.16 * moving;
        brush.rotation.y = reduced ? 0 : t * moving * 6;
        light.emissiveIntensity = reduced ? 0.4 : 0.35 + Math.sin(t * 2) * 0.12;
        renderer.render(scene, camera);
        frame = requestAnimationFrame(animate);
      };
      animate();
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        el.removeEventListener("pointerup", click);
        scene.traverse((o) => {
          o.geometry?.dispose();
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
              m.map?.dispose();
              m.dispose();
            }
          }
        });
        environmentMap.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    } catch {
      renderer?.dispose();
      setFailed(true);
    }
  }, [theme, wet]);
  return (
    <div
      className="robot-scene"
      ref={host}
      aria-label={`${theme === "dark" ? "Graphite" : "Porcelain"} robot vacuum on its docking station`}
      role="img"
    >
      {failed && (
        <button
          className="fallback-robot"
          onClick={onStart}
          aria-label="Start cleaning"
        >
          <span>vacuum</span>
          <b>⏻</b>
        </button>
      )}
    </div>
  );
}
