export function syntheticWave() {
  const b = Buffer.alloc(44 + 8000 * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(b.length - 44, 40);
  for (let i = 0; i < 8000; i++) b.writeInt16LE(Math.round(512 * Math.sin(i * Math.PI * 2 * 440 / 16000)), 44 + i * 2);
  return b;
}
