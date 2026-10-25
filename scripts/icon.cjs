const fs = require("node:fs");
const zlib = require("node:zlib");
const path = require("node:path");
function crc32(buffer) {
  let c = 0xffffffff;
  for (const b of buffer) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type),
    n = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  n.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([n, t, data, crc]);
}
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4,
        dx = x / size - 0.5,
        dy = y / size - 0.5,
        d = Math.hypot(dx, dy),
        lidar = Math.hypot(dx, dy + 0.16);
      let rgb = [49, 58, 44];
      if (d > 0.43) rgb = [160, 175, 139];
      else if (d > 0.4) rgb = [77, 89, 66];
      else {
        const light = Math.max(0, 1 - Math.hypot(dx + 0.25, dy + 0.3));
        rgb = [50 + light * 43, 60 + light * 43, 45 + light * 43];
      }
      if (lidar < 0.115) rgb = [48, 58, 40];
      if (lidar < 0.095 && lidar > 0.078) rgb = [175, 196, 145];
      if (Math.hypot(dx, dy - 0.14) < 0.035) rgb = [190, 209, 162];
      raw[i] = rgb[0];
      raw[i + 1] = rgb[1];
      raw[i + 2] = rgb[2];
      raw[i + 3] = d < 0.47 ? 255 : 0;
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const sizes = [16, 32, 48, 256],
  images = sizes.map(png),
  header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const p = 6 + 16 * i;
  header[p] = s === 256 ? 0 : s;
  header[p + 1] = s === 256 ? 0 : s;
  header.writeUInt16LE(1, p + 4);
  header.writeUInt16LE(32, p + 6);
  header.writeUInt32LE(images[i].length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += images[i].length;
});
fs.mkdirSync(path.join(__dirname, "../build"), { recursive: true });
fs.writeFileSync(
  path.join(__dirname, "../build/icon.ico"),
  Buffer.concat([header, ...images]),
);
fs.writeFileSync(path.join(__dirname, "../build/icon.png"), images.at(-1));
