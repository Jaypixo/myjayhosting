// Minimal ZIP writer: stored (uncompressed) entries only, no external deps.
// This project doesn't run `npm install` at deploy time (see CLAUDE.md's
// Email Infrastructure section on why `marked` had to be vendored instead of
// bare-imported), so a real zip library would hit that exact same "Could not
// resolve" build failure. Storing instead of deflating means no compression
// codec to implement either, just CRC32 and the three classic PKZIP records.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ZIP timestamps are MS-DOS format, 1980-2107 range only. Anything outside
// that (shouldn't happen for real uploads) just clamps to the epoch.
function dosDateTime(date) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  const dosTime = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return { dosTime, dosDate };
}

// entries: [{ name: string, data: Uint8Array, date?: Date }]
export function buildZip(entries) {
  const encoder = new TextEncoder();
  const fileParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const fileBytes = entry.data;
    const crc = crc32(fileBytes);
    const { dosTime, dosDate } = dosDateTime(entry.date);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed to extract
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // compression method: store
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, fileBytes.length, true); // compressed size
    lv.setUint32(22, fileBytes.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra field length
    local.set(nameBytes, 30);
    fileParts.push(local, fileBytes);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed to extract
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, fileBytes.length, true);
    cv.setUint32(24, fileBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra field length
    cv.setUint16(32, 0, true); // file comment length
    cv.setUint16(34, 0, true); // disk number start
    cv.setUint16(36, 0, true); // internal attributes
    cv.setUint32(38, 0, true); // external attributes
    cv.setUint32(42, offset, true); // offset of local header from start of archive
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + fileBytes.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralParts.reduce((sum, p) => sum + p.length, 0);

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralDirSize, true);
  ev.setUint32(16, centralDirOffset, true);
  ev.setUint16(20, 0, true); // comment length

  const total = new Uint8Array(centralDirOffset + centralDirSize + end.length);
  let pos = 0;
  for (const part of fileParts) { total.set(part, pos); pos += part.length; }
  for (const part of centralParts) { total.set(part, pos); pos += part.length; }
  total.set(end, pos);

  return total;
}
