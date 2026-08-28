/**
 * 贴图进档案（微信二维码等）：压到 480px、存 PNG data URL。
 * 二维码必须高对比，不走 JPEG——压缩痕会让扫码变难；白底垫底，兼容透明图和暗色截图。
 */
export async function ingestImage(file) {
  const img = await loadImage(file);
  const max = 480;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片"));
    };
    img.src = url;
  });
}

/** 从粘贴事件里取出第一张图，没有就返回 null。 */
export function imageFromClipboard(clipboardData) {
  const item = [...(clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  return item ? item.getAsFile() : null;
}
