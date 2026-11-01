/** Standalone bounded parser process. Never serves HTTP or invokes cloud OCR. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { readOffice } from './document-office'
import { extractPdfPages } from './document-pdf'
import { createWorker } from 'tesseract.js'
import { imageSize } from 'image-size'
import { createCanvas, loadImage } from '@napi-rs/canvas'
let worker: Awaited<ReturnType<typeof createWorker>> | undefined
const MAX_PIXELS = 20_000_000
async function recognize(buffer: Buffer): Promise<string> {
  const dimensions = imageSize(buffer)
  if (
    !dimensions.width ||
    !dimensions.height ||
    dimensions.width * dimensions.height > MAX_PIXELS ||
    dimensions.width > 16000 ||
    dimensions.height > 16000
  )
    throw Error('图片像素超过上限（2000万像素），请缩小后重试')
  const image = await loadImage(buffer)
  if (image.width * image.height > MAX_PIXELS || image.width > 16000 || image.height > 16000)
    throw Error('图片像素超过上限（2000万像素），请缩小后重试')
  const canvas = createCanvas(image.width, image.height),
    ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, image.width, image.height)
  ctx.drawImage(image, 0, 0)
  if (!worker) {
    const langPath = process.env.CHRYS_OCR_DATA
    if (
      !langPath ||
      !['eng', 'chi_sim'].every((l) => existsSync(join(langPath, `${l}.traineddata.gz`)))
    )
      throw Error('本地 OCR 语言资源未安装，请运行 npm run setup:ocr')
    worker = await createWorker(['chi_sim', 'eng'], 1, {
      langPath,
      gzip: true,
      cacheMethod: 'none',
      workerPath: require.resolve('tesseract.js/src/worker-script/node/index.js'),
      errorHandler: () => {}
    })
  }
  const result = await worker.recognize(canvas.toBuffer('image/png'))
  return result.data.text.replace(/(?<=[\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, '')
}
async function run() {
  const file = process.argv[2],
    ext = process.argv[3]
  const buffer = await readFile(file)
  let text: string
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) text = await recognize(buffer)
  else if (ext === 'xlsx' || ext === 'pptx') text = await readOffice(buffer, ext, recognize)
  else {
    const { getDocumentProxy, createIsomorphicCanvasFactory, renderPageAsImage } = await import(
      'unpdf'
    )
    const canvasImport = () => import('@napi-rs/canvas')
    const CanvasFactory = await createIsomorphicCanvasFactory(canvasImport)
    const pdf: any = await getDocumentProxy(new Uint8Array(buffer), {
      CanvasFactory,
      isEvalSupported: false
    } as any)
    try {
      text = await extractPdfPages(pdf, async (n) => {
        const page = await pdf.getPage(n),
          view = page.getViewport({ scale: 2 })
        if (view.width * view.height > MAX_PIXELS) throw Error('PDF 页面像素超过上限，请缩小页面')
        const png = await renderPageAsImage(pdf, n, { canvasImport, scale: 2 })
        return recognize(Buffer.from(png))
      })
    } finally {
      await pdf.loadingTask.destroy()
    }
  }
  if (!text.replace(/^#{1,3} .*$/gm, '').trim())
    throw Error('没有提取到文字，请检查图片清晰度或文档内容')
  if (text.length > 2_000_000) throw Error('提取正文超过200万字符，请拆分文件')
  process.stdout.write(JSON.stringify({ text }))
}
run()
  .catch((error) => {
    process.stdout.write(
      JSON.stringify({
        error:
          error?.name === 'PasswordException'
            ? 'PDF 有密码保护，请去掉密码后导入'
            : String(error?.message || error)
      })
    )
    process.exitCode = 1
  })
  .finally(async () => {
    await worker?.terminate()
  })
