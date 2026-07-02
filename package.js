/**
 * BossSay - 打包脚本
 * 用于生成上架 Chrome Web Store / Edge Add-ons 的 ZIP 包
 *
 * 使用方法：node package.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ==================== 简易 ZIP 生成 ====================

// CRC32 查找表
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipBuffer(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const data = file.data;
    const crc = crc32(data);

    // 使用 deflate 压缩
    let compressed;
    let compressionMethod;
    if (data.length > 0) {
      compressed = zlib.deflateRawSync(data, { level: 6 });
      compressionMethod = 8; // deflate
    } else {
      compressed = Buffer.alloc(0);
      compressionMethod = 0; // stored
    }

    // Local file header
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);  // signature
    localHeader.writeUInt16LE(20, 4);            // version needed
    localHeader.writeUInt16LE(0, 6);             // flags
    localHeader.writeUInt16LE(compressionMethod, 8);  // compression method
    localHeader.writeUInt32LE(0, 10);            // mod time/date
    localHeader.writeUInt32LE(crc, 14);          // crc32
    localHeader.writeUInt32LE(compressed.length, 18);  // compressed size
    localHeader.writeUInt32LE(data.length, 22);  // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26); // name length
    localHeader.writeUInt16LE(0, 28);            // extra length
    nameBuf.copy(localHeader, 30);

    localHeaders.push(Buffer.concat([localHeader, compressed]));

    // Central directory header
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);  // signature
    centralHeader.writeUInt16LE(20, 4);            // version made by
    centralHeader.writeUInt16LE(20, 6);            // version needed
    centralHeader.writeUInt16LE(0, 8);             // flags
    centralHeader.writeUInt16LE(compressionMethod, 10); // compression
    centralHeader.writeUInt32LE(0, 12);            // mod time/date
    centralHeader.writeUInt32LE(crc, 16);          // crc32
    centralHeader.writeUInt32LE(compressed.length, 20); // compressed size
    centralHeader.writeUInt32LE(data.length, 24);  // uncompressed size
    centralHeader.writeUInt16LE(nameBuf.length, 28); // name length
    centralHeader.writeUInt16LE(0, 30);            // extra length
    centralHeader.writeUInt16LE(0, 32);            // comment length
    centralHeader.writeUInt16LE(0, 34);            // disk number
    centralHeader.writeUInt16LE(0, 36);            // internal attrs
    centralHeader.writeUInt32LE(0, 38);            // external attrs
    centralHeader.writeUInt32LE(offset, 42);       // offset
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDirOffset = offset;
  const centralDirBuf = Buffer.concat(centralHeaders);
  const centralDirSize = centralDirBuf.length;

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, centralDirBuf, eocd]);
}

// ==================== 文件收集 ====================

const INCLUDE_DIRS = ['popup', 'content', 'background', 'lib', 'icons'];
const INCLUDE_FILES = ['manifest.json', 'LICENSE', 'README.md', 'PRIVACY.md'];
const EXCLUDE_PATTERNS = ['.DS_Store', '.git', 'node_modules', '.vscode', '.idea'];

function walkDir(dir, basePath = '') {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

    // 排除
    if (EXCLUDE_PATTERNS.some(p => entry.name.includes(p))) continue;

    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, relativePath));
    } else {
      results.push({
        name: relativePath.replace(/\\/g, '/'), // 确保用 / 分隔
        data: fs.readFileSync(fullPath),
      });
    }
  }
  return results;
}

// ==================== 主逻辑 ====================

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const version = manifest.version;
const output = `bosssay-v${version}.zip`;

console.log('🎯 BossSay 打包工具');
console.log(`版本: v${version}`);
console.log(`输出: ${output}`);
console.log('');

const files = [];

// 添加指定目录
for (const dir of INCLUDE_DIRS) {
  if (fs.existsSync(dir)) {
    files.push(...walkDir(dir, dir));
  }
}

// 添加指定文件
for (const file of INCLUDE_FILES) {
  if (fs.existsSync(file)) {
    files.push({
      name: file,
      data: fs.readFileSync(file),
    });
  }
}

// 生成 ZIP
const zipBuffer = createZipBuffer(files);
fs.writeFileSync(output, zipBuffer);

console.log(`✅ 打包完成: ${output}`);
console.log(`📦 文件大小: ${(zipBuffer.length / 1024).toFixed(1)} KB`);
console.log('');
console.log('📋 包含文件:');
files.forEach(f => {
  console.log(`   ${f.name} (${f.data.length} bytes)`);
});
console.log('');
console.log('🚀 下一步：');
console.log('   Chrome: https://chrome.google.com/webstore/devconsole');
console.log('   Edge:   https://partner.microsoft.com/dashboard/microsoftedge');
