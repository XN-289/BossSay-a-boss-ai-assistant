/**
 * BossSay - 图标生成脚本
 * 使用 Node.js 运行此脚本来生成插件图标
 *
 * 使用方法：
 *   node generate-icons.js
 *
 * 需要安装 canvas 依赖：
 *   npm install canvas
 */

const fs = require('fs');
const path = require('path');

// 如果没有 canvas 模块，使用纯 Node.js 生成简单的 PNG
// 这里我们创建一个最简单的有效 PNG 文件

function createSimplePNG(size) {
  // 创建一个简单的 PNG 文件（有效但无图像内容）
  // PNG 文件格式：签名 + IHDR + IDAT + IEND

  const width = size;
  const height = size;

  // PNG 签名
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);   // width
  ihdrData.writeUInt32BE(height, 4);  // height
  ihdrData.writeUInt8(8, 8);          // bit depth
  ihdrData.writeUInt8(2, 9);          // color type (RGB)
  ihdrData.writeUInt8(0, 10);         // compression
  ihdrData.writeUInt8(0, 11);         // filter
  ihdrData.writeUInt8(0, 12);         // interlace

  const ihdrChunk = createChunk('IHDR', ihdrData);

  // IDAT chunk - 最简化的图像数据
  // 创建一个填充渐变色的图像
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter byte (none)
    for (let x = 0; x < width; x++) {
      // 渐变色：从 #667eea 到 #764ba2
      const t = (x + y) / (width + height);
      const r = Math.floor(102 + (118 - 102) * t);
      const g = Math.floor(126 + (75 - 126) * t);
      const b = Math.floor(234 + (162 - 234) * t);
      rawData.push(r, g, b);
    }
  }

  // 使用 zlib 压缩（Node.js 内置）
  const zlib = require('zlib');
  const rawBuffer = Buffer.from(rawData);
  const compressed = zlib.deflateSync(rawBuffer);
  const idatChunk = createChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

// CRC32 实现
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xedb88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// 生成图标
const iconsDir = path.join(__dirname, 'icons');

[16, 48, 128].forEach(size => {
  const png = createSimplePNG(size);
  const filePath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`✅ 已生成: icon${size}.png`);
});

console.log('\n图标生成完成！');
console.log('如需更精美的图标，请在浏览器中打开 generate-icons.html');
