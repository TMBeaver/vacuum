import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

function faceTexture(kind, color) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const c = canvas.getContext("2d");
  c.strokeStyle = c.fillStyle = color;
  c.lineWidth = 9;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.translate(128, 128);
  if (kind === "power") {
    c.beginPath();
    c.arc(0, 5, 49, -Math.PI * 0.3, Math.PI * 1.3);
    c.stroke();
    c.beginPath();
    c.moveTo(0, -57);
    c.lineTo(0, -5);
    c.stroke();
  }
  if (kind === "dock") {
    c.beginPath();
    c.moveTo(-48, 0);
    c.lineTo(0, -42);
    c.lineTo(48, 0);
    c.moveTo(-32, -12);
    c.lineTo(-32, 43);
    c.lineTo(32, 43);
    c.lineTo(32, -12);
    c.stroke();
  }
  if (kind === "mop") {
    c.beginPath();
    c.moveTo(0, -62);
    c.bezierCurveTo(-92, 35, -24, 74, 0, 55);
    c.bezierCurveTo(24, 74, 92, 35, 0, -62);
    c.stroke();
  }
  if (kind === "auto") {
    c.beginPath();
    c.arc(0, 0, 48, 0, Math.PI * 2);
    c.moveTo(0, -28);
    c.lineTo(0, 0);
    c.lineTo(23, 12);
    c.stroke();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function textTexture(text, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const c = canvas.getContext("2d");
  c.fillStyle = color;
  c.font = '500 66px "Bahnschrift", "Segoe UI", sans-serif';
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, 256, 64);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createRobot(dark) {
  const robot = new THREE.Group(),
    dock = new THREE.Group(),
    interactive = [],
    anchors = {};
  const deckRise = 0.18;
  const top = (height) => height + deckRise;
  const themeTargets = [];
  const palette = (material, darkColor, lightColor) =>
    themeTargets.push({
      material,
      dark: new THREE.Color(darkColor),
      light: new THREE.Color(lightColor),
    });
  const body = new THREE.MeshPhysicalMaterial({
    color: dark ? 0x242b29 : 0xc8cdc4,
    metalness: dark ? 0.6 : 0.16,
    roughness: 0.27,
    clearcoat: 0.7,
    envMapIntensity: 0.7,
  });
  const porcelain = new THREE.MeshPhysicalMaterial({
    color: dark ? 0x141b18 : 0xe4e5dc,
    metalness: dark ? 0.3 : 0.08,
    roughness: 0.43,
    clearcoat: 0.25,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.38,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x101713,
    roughness: 0.8,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: dark ? 0x7b897f : 0x9aa694,
    metalness: 0.85,
    roughness: 0.25,
  });
  const led = new THREE.MeshStandardMaterial({
    color: 0xc3d4a9,
    emissive: 0x8aab65,
    emissiveIntensity: 0.45,
  });
  const blue = new THREE.MeshPhysicalMaterial({
    color: 0x82b8ce,
    metalness: 0.1,
    roughness: 0.25,
    transparent: true,
    opacity: 0.8,
  });
  const mesh = (g, m, x = 0, y = 0, z = 0, parent = robot, action) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.castShadow = true;
    o.receiveShadow = true;
    parent.add(o);
    if (action) {
      o.userData.action = action;
      interactive.push(o);
    }
    return o;
  };
  const cylinder = (r, h, m, x, y, z, parent = robot, action) =>
    mesh(new THREE.CylinderGeometry(r, r, h, 128), m, x, y, z, parent, action);
  const ring = (r, t, m, y, z = 0, parent = robot) => {
    const o = mesh(new THREE.TorusGeometry(r, t, 12, 128), m, 0, y, z, parent);
    o.rotation.x = Math.PI / 2;
    return o;
  };
  const anchor = (action, x, y, z, parent = robot) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    anchors[action] = o;
  };
  cylinder(2, 0.26, rubber, 0, 0.23, 0);
  cylinder(2.035, 0.27 + deckRise, body, 0, 0.46 + deckRise / 2, 0);
  cylinder(1.99, 0.1, porcelain, 0, top(0.645), 0);
  ring(2.018, 0.025, metal, top(0.59));
  ring(1.92, 0.009, rubber, top(0.7));
  for (const x of [-1.6, 1.6])
    mesh(
      new RoundedBoxGeometry(0.3, 0.24, 0.75, 3, 0.06),
      rubber,
      x,
      0.13,
      0.05,
    );
  mesh(
    new RoundedBoxGeometry(0.78, 0.16, 0.08, 3, 0.04),
    rubber,
    0,
    0.43 + deckRise / 2,
    2.015,
  );
  const lens = new THREE.MeshPhysicalMaterial({
    color: 0x172933,
    metalness: 0.8,
    roughness: 0.08,
  });
  for (const x of [-0.24, 0, 0.24])
    mesh(
      new THREE.SphereGeometry(0.045, 12, 8),
      lens,
      x,
      0.44 + deckRise / 2,
      2.063,
    );
  for (let i = 0; i < 20; i++) {
    const a = Math.PI * 0.61 + i * 0.035;
    const vent = mesh(
      new RoundedBoxGeometry(0.027, 0.1, 0.025, 2, 0.008),
      rubber,
      Math.sin(a) * 2.035,
      0.43 + deckRise / 2,
      Math.cos(a) * 2.035,
    );
    vent.rotation.y = a;
  }
  cylinder(0.49, 0.06, rubber, 0, top(0.73), -0.91);
  cylinder(0.45, 0.19, body, 0, top(0.86), -0.91);
  ring(0.456, 0.022, led, top(0.85), -0.91);
  cylinder(0.43, 0.045, porcelain, 0, top(0.98), -0.91, robot, "performance");
  anchor("performance", 0, top(1.02), -0.91);
  const scanner = new THREE.Group();
  scanner.position.set(0, top(0.87), -0.91);
  robot.add(scanner);
  mesh(new THREE.BoxGeometry(0.08, 0.055, 0.045), rubber, 0, 0, 0.455, scanner);
  const buttons = {};
  for (const [action, x, z, r] of [
    ["power", 0.87, -0.73, 0.23],
    ["dock", 0.87, -0.12, 0.17],
    ["mop", -0.87, -0.73, 0.21],
    ["auto", -0.87, -0.12, 0.17],
  ]) {
    cylinder(r + 0.027, 0.025, rubber, x, top(0.72), z);
    const buttonGroup = new THREE.Group();
    buttonGroup.position.set(x, top(0.75), z);
    robot.add(buttonGroup);
    buttons[action] = buttonGroup;
    cylinder(r, 0.037, body, 0, 0, 0, buttonGroup, action);
    const icon = mesh(
      new THREE.PlaneGeometry(r * 1.35, r * 1.35),
      new THREE.MeshBasicMaterial({
        map: faceTexture(action, "#ffffff"),
        color: dark ? 0xc5d6b1 : 0x516744,
        transparent: true,
        depthWrite: false,
      }),
      0,
      0.023,
      0,
      buttonGroup,
      action,
    );
    icon.rotation.x = -Math.PI / 2;
    palette(icon.material, 0xc5d6b1, 0x516744);
    anchor(action, 0, 0.04, 0, buttonGroup);
  }
  // The front hatch pivots at its hinge and the removable cassette rises from its well.
  mesh(
    new RoundedBoxGeometry(2.35, 0.045, 1.37, 5, 0.19),
    rubber,
    0,
    top(0.703),
    0.88,
  );
  const cassette = new THREE.Group();
  cassette.position.set(0, top(0.43), 0.88);
  robot.add(cassette);
  const binMaterial = new THREE.MeshPhysicalMaterial({
    color: dark ? 0x7f9370 : 0x9eac89,
    roughness: 0.17,
    metalness: 0.1,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  mesh(
    new RoundedBoxGeometry(2.04, 0.29, 1.15, 5, 0.1),
    binMaterial,
    0,
    0.1,
    0,
    cassette,
    "bin",
  );
  for (let x = -0.7; x < 0.8; x += 0.17)
    mesh(new THREE.BoxGeometry(0.025, 0.18, 0.75), metal, x, 0.08, 0, cassette);
  const dust = new THREE.Group();
  cassette.add(dust);
  const dustMaterial = new THREE.MeshStandardMaterial({
    color: 0x8b8d73,
    roughness: 1,
  });
  for (let i = 0; i < 28; i++) {
    const g = mesh(
      new THREE.IcosahedronGeometry(0.035 + (i % 4) * 0.013, 0),
      dustMaterial,
      Math.sin(i * 6.7) * 0.8,
      0.2 + (i % 3) * 0.025,
      Math.cos(i * 4.3) * 0.38,
      dust,
    );
    g.rotation.set(i, i * 0.7, i * 0.3);
  }
  const hatch = new THREE.Group();
  hatch.position.set(0, top(0.747), 0.18);
  robot.add(hatch);
  mesh(
    new RoundedBoxGeometry(2.29, 0.05, 1.36, 6, 0.15),
    porcelain,
    0,
    0,
    0.67,
    hatch,
    "bin",
  );
  mesh(
    new RoundedBoxGeometry(0.46, 0.036, 0.075, 4, 0.035),
    metal,
    0,
    0.045,
    1.17,
    hatch,
    "bin",
  );
  const logo = mesh(
    new THREE.PlaneGeometry(0.91, 0.23),
    new THREE.MeshBasicMaterial({
      map: textTexture("vacuum", "#ffffff"),
      color: dark ? 0xaab6a8 : 0x6b7864,
      transparent: true,
      depthWrite: false,
    }),
    0,
    0.028,
    0.68,
    hatch,
    "bin",
  );
  logo.rotation.x = -Math.PI / 2;
  palette(logo.material, 0xaab6a8, 0x6b7864);
  anchor("bin", 0, 0.07, 1.17, hatch);
  const mop = new THREE.Group();
  mop.position.set(0, 0.14, -1.52);
  robot.add(mop);
  const cloth = new THREE.MeshStandardMaterial({
    color: 0x81a8b4,
    roughness: 0.96,
  });
  mesh(
    new RoundedBoxGeometry(2.6, 0.08, 0.92, 5, 0.22),
    cloth,
    0,
    0,
    0,
    mop,
    "mop",
  );
  for (let i = 0; i < 15; i++)
    mesh(
      new THREE.BoxGeometry(0.035, 0.012, 0.65),
      blue,
      -1.08 + i * 0.153,
      -0.045,
      0,
      mop,
    );
  const brushes = [];
  for (const x of [-1.72, 1.72]) {
    const b = new THREE.Group();
    b.position.set(x, 0.15, 1.1);
    robot.add(b);
    brushes.push(b);
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      const arm = mesh(
        new RoundedBoxGeometry(0.055, 0.025, 0.68, 2, 0.014),
        metal,
        Math.sin(a) * 0.29,
        0,
        Math.cos(a) * 0.29,
        b,
      );
      arm.rotation.y = a;
    }
  }
  const dockBody = new THREE.MeshPhysicalMaterial({
    color: dark ? 0x1d2820 : 0xbfc8b8,
    metalness: 0.2,
    roughness: 0.3,
    clearcoat: 0.45,
  });
  mesh(
    new RoundedBoxGeometry(2.8, 0.14, 1.4, 5, 0.12),
    dockBody,
    0,
    0.075,
    0,
    dock,
    "station",
  );
  mesh(
    new RoundedBoxGeometry(2.6, 1.38, 0.48, 6, 0.16),
    dockBody,
    0,
    0.72,
    -0.48,
    dock,
    "station",
  );
  mesh(
    new RoundedBoxGeometry(0.35, 0.028, 0.027, 3, 0.013),
    led,
    0,
    1.2,
    -0.232,
    dock,
    "station",
  );
  const dockWord = mesh(
    new THREE.PlaneGeometry(0.62, 0.16),
    new THREE.MeshBasicMaterial({
      map: textTexture("vacuum", "#ffffff"),
      color: dark ? 0xa0ad95 : 0x66775a,
      transparent: true,
    }),
    0,
    0.74,
    -0.235,
    dock,
    "station",
  );
  for (const x of [-0.55, 0.55])
    mesh(
      new RoundedBoxGeometry(0.2, 0.028, 0.26, 3, 0.02),
      metal,
      x,
      0.16,
      0.2,
      dock,
    );
  palette(body, 0x242b29, 0xc8cdc4);
  palette(porcelain, 0x141b18, 0xe4e5dc);
  palette(metal, 0x7b897f, 0x9aa694);
  palette(binMaterial, 0x7f9370, 0x9eac89);
  palette(dockBody, 0x1d2820, 0xbfc8b8);
  palette(dockWord.material, 0xa0ad95, 0x66775a);
  dock.position.z = -2.68;
  anchor("station", 1.03, 1.25, -0.4, dock);
  return {
    deckRise,
    robot,
    dock,
    interactive,
    anchors,
    hatch,
    cassette,
    dust,
    mop,
    brushes,
    scanner,
    buttons,
    led,
    updateTheme(dark, blend) {
      for (const target of themeTargets)
        target.material.color.lerp(dark ? target.dark : target.light, blend);
      body.metalness = THREE.MathUtils.lerp(
        body.metalness,
        dark ? 0.6 : 0.16,
        blend,
      );
      porcelain.metalness = THREE.MathUtils.lerp(
        porcelain.metalness,
        dark ? 0.3 : 0.08,
        blend,
      );
    },
  };
}
