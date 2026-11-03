/**
 * @description 九宫格切片声明（像素，图片左上原点）。
 */
export type NineSliceBox = {
  // 左侧包边原生宽度
  left: number
  // 右侧包边原生宽度
  right: number
  // 顶部包边原生高度
  top: number
  // 底部包边原生高度
  bottom: number
}

/** 面板九宫格绘制结果，供调用方在同一画布上继续叠加内容。 */
export type NineSliceSurface = {
  // 面板画布的 2D 上下文，返回时处于 css 坐标系（dpr 缩放变换已设），可直接按 css 单位叠加绘制
  ctx: CanvasRenderingContext2D
  // 面板画布位图宽度（设备像素）
  bufferWidth: number
  // 面板画布位图高度（设备像素）
  bufferHeight: number
  // 盒的 css 宽度
  boxWidth: number
  // 盒的 css 高度
  boxHeight: number
  // 绘制时的设备像素比
  dpr: number
}

/**
 * @description 把一张面板贴图按九宫格绘制到盒尺寸的画布上，并返回画布表面供继续叠加。
 * @param canvas 承载面板的画布，位图尺寸由本函数对齐到盒尺寸的设备像素。
 * @param box 气泡可视盒元素，绘制尺寸与重绘时机由其尺寸决定。
 * @param image 已就绪的面板贴图（naturalWidth 大于 0）。
 * @param slice 九宫格切片声明。
 * @param scale 横向显示缩放；纵向在盒高装不下上下切片之和时钳制，保证切角始终完整。
 * @returns 绘制成功返回画布表面；画布 2D 上下文不可用时返回 null。
 * @remarks 九宫格边界取整到设备像素，相邻分片共享整数边界以杜绝透缝；
 *          画布经 clearRect 全清后重绘，返回时上下文已切换到 css 坐标系，
 *          叠加内容直接按 css 单位绘制即可，需要设备像素的场景自行 setTransform 显式切换。
 */
export function drawPanelNineSlice(
  canvas: HTMLCanvasElement,
  box: HTMLElement,
  image: HTMLImageElement,
  slice: NineSliceBox,
  scale: number
): NineSliceSurface | null {
  const boxWidth = box.offsetWidth
  const boxHeight = box.offsetHeight
  const dpr = window.devicePixelRatio || 1
  const bufferWidth = Math.max(1, Math.round(boxWidth * dpr))
  const bufferHeight = Math.max(1, Math.round(boxHeight * dpr))
  if (canvas.width !== bufferWidth) canvas.width = bufferWidth
  if (canvas.height !== bufferHeight) canvas.height = bufferHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, bufferWidth, bufferHeight)
  const { left, right, top, bottom } = slice
  const iw = image.naturalWidth
  const ih = image.naturalHeight
  const hScale = scale
  const vScale = Math.min(scale, (boxHeight - 2) / (top + bottom))
  // 九宫格在设备像素坐标系绘制，边界取整：相邻分片共享同一条整数边界，
  // 避免小数边界被各分片独立像素对齐后产生 1px 透缝
  const xs = [0, left * hScale, boxWidth - right * hScale, boxWidth].map((v) => Math.round(v * dpr))
  const ys = [0, top * vScale, boxHeight - bottom * vScale, boxHeight].map((v) =>
    Math.round(v * dpr)
  )
  const colSegs = [0, left, iw - right, iw]
  const rowSegs = [0, top, ih - bottom, ih]
  for (let iy = 0; iy < 3; iy += 1) {
    for (let ix = 0; ix < 3; ix += 1) {
      const drawWidth = xs[ix + 1] - xs[ix]
      const drawHeight = ys[iy + 1] - ys[iy]
      const srcWidth = colSegs[ix + 1] - colSegs[ix]
      const srcHeight = rowSegs[iy + 1] - rowSegs[iy]
      if (drawWidth <= 0 || drawHeight <= 0 || srcWidth <= 0 || srcHeight <= 0) continue
      ctx.drawImage(
        image,
        colSegs[ix],
        rowSegs[iy],
        srcWidth,
        srcHeight,
        xs[ix],
        ys[iy],
        drawWidth,
        drawHeight
      )
    }
  }
  // 归一到 css 坐标系再交还调用方：叠加内容的布局值全是 css 语义，dpr 换算只留在本函数内
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, bufferWidth, bufferHeight, boxWidth, boxHeight, dpr }
}
