import { analyzePdf } from './document-processing/pdf-analysis'
import { cleanPages } from './document-processing/quality'
import { createHash } from 'node:crypto'
/** Standalone bounded parser process. Never serves HTTP or invokes cloud OCR. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { readOffice } from './document-office'
import { extractPdfPages } from './document-pdf'
import { createWorker } from 'tesseract.js'
import { imageSize } from 'image-size'
import { createCanvas, loadImage } from '@napi-rs/canvas'
let worker: Awaited<ReturnType<typeof createWorker>> | undefined
const MAX_PIXELS = 20_000_000
const transformLog: any[] = []
const detailedMode = process.argv[4] === 'analysis'
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
  let result = await worker.recognize(canvas.toBuffer('image/png'))
  let rotation = 0
  if (detailedMode) {
    let best = { angle: 0, confidence: result.data.confidence, text: result.data.text }
    for (const angle of [90, 180, 270]) {
      const w = angle === 90 || angle === 270 ? canvas.height : canvas.width,
        h = angle === 90 || angle === 270 ? canvas.width : canvas.height,
        scale = Math.min(1, 1600 / Math.max(w, h)),
        sample = createCanvas(
          Math.max(1, Math.round(w * scale)),
          Math.max(1, Math.round(h * scale))
        ),
        sampleCtx = sample.getContext('2d')
      sampleCtx.fillStyle = '#fff'
      sampleCtx.fillRect(0, 0, sample.width, sample.height)
      sampleCtx.translate(sample.width / 2, sample.height / 2)
      sampleCtx.rotate((angle * Math.PI) / 180)
      sampleCtx.scale(scale, scale)
      sampleCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
      const trial = await worker.recognize(sample.toBuffer('image/png'))
      if (
        trial.data.confidence > best.confidence + 10 &&
        trial.data.text.replace(/\s/g, '').length > 2
      )
        best = { angle, confidence: trial.data.confidence, text: trial.data.text }
    }
    if (best.angle) {
      rotation = best.angle
      result = { ...result, data: { ...result.data, text: best.text, confidence: best.confidence } }
    }
    transformLog.push({
      rotation,
      confidence: result.data.confidence,
      confidenceKind: 'tesseract-engine',
      inputWidth: canvas.width,
      inputHeight: canvas.height,
      note: '角度为候选识别方向，必须对照原图；未承诺自动去倾斜或公式识别'
    })
  }
  return result.data.text.replace(/(?<=[\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, '')
}
async function run() {
  const file = process.argv[2],
    ext = process.argv[3]
  const buffer = await readFile(file)
  let text: string
  let analysis: any
  const detailed = process.argv[4] === 'analysis'
  let password: string | undefined
  if (detailed) {
    const input = readFileSync(0, 'utf8')
    if (input.length > 4096) throw Error('解析选项超限')
    if (input) {
      const options = JSON.parse(input)
      if (
        options.password !== undefined &&
        (typeof options.password !== 'string' || options.password.length > 256)
      )
        throw Error('密码格式无效')
      password = options.password
    }
  }
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) text = await recognize(buffer)
  else if (ext === 'xlsx' || ext === 'pptx') text = await readOffice(buffer, ext, recognize)
  else if (ext === 'docx') {
    text = (await (await import('mammoth')).default.extractRawText({ buffer })).value
  } else if (['txt', 'md', 'markdown'].includes(ext)) {
    const { decodeText } = await import('./knowledge-parse')
    text = decodeText(buffer)
  } else {
    const { getDocumentProxy, createIsomorphicCanvasFactory, renderPageAsImage } = await import(
      'unpdf'
    )
    const canvasImport = () => import('@napi-rs/canvas')
    const CanvasFactory = await createIsomorphicCanvasFactory(canvasImport)
    const pdf: any = await getDocumentProxy(new Uint8Array(buffer), {
      CanvasFactory,
      password,
      isEvalSupported: false
    } as any)
    try {
      if (detailed) {
        const { extractImages, getResolvedPDFJS } = await import('unpdf')
        const { OPS } = await getResolvedPDFJS()
        analysis = await analyzePdf(pdf, {
          OPS,
          extractImages: (n) => extractImages(pdf, n),
          ocrPage: async (n) => {
            const page = await pdf.getPage(n),
              v = page.getViewport({ scale: 2 })
            if (v.width * v.height > MAX_PIXELS) throw Error('PDF页面像素超限')
            return recognize(
              Buffer.from(await renderPageAsImage(pdf, n, { canvasImport, scale: 2 }))
            )
          },
          ocrImage: async (image) => {
            if (image.width * image.height > MAX_PIXELS) throw Error('图片像素超限')
            const c = createCanvas(image.width, image.height),
              ctx = c.getContext('2d'),
              data = ctx.createImageData(image.width, image.height)
            for (let i = 0; i < image.width * image.height; i++) {
              const start = i * image.channels
              data.data[i * 4] = image.data[start]
              data.data[i * 4 + 1] = image.data[start + (image.channels === 1 ? 0 : 1)]
              data.data[i * 4 + 2] = image.data[start + (image.channels === 1 ? 0 : 2)]
              data.data[i * 4 + 3] = image.channels === 4 ? image.data[start + 3] : 255
            }
            ctx.putImageData(data, 0, 0)
            return recognize(c.toBuffer('image/png'))
          }
        })
        text = analysis.cleaned
      } else {
        text = await extractPdfPages(pdf, async (n) => {
          const page = await pdf.getPage(n),
            view = page.getViewport({ scale: 2 })
          if (view.width * view.height > MAX_PIXELS) throw Error('PDF 页面像素超过上限，请缩小页面')
          const png = await renderPageAsImage(pdf, n, { canvasImport, scale: 2 })
          return recognize(Buffer.from(png))
        })
      }
    } finally {
      await pdf.loadingTask.destroy()
    }
  }
  if (!text.replace(/^#{1,3} .*$/gm, '').trim())
    throw Error('没有提取到文字，请检查图片清晰度或文档内容')
  if (text.length > 2_000_000) throw Error('提取正文超过200万字符，请拆分文件')
  if (detailed && !analysis) {
    analysis = cleanPages([
      {
        number: 1,
        type: ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? 'scan' : 'text',
        method: ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? 'ocr' : 'native',
        status: 'complete',
        elements: [{ id: 'document-text', type: 'paragraph', text }],
        issues: [
          {
            code: 'non-pdf-locator',
            severity: 'warning',
            reason: '非PDF资料以原文工作表/幻灯片/段落位置为准，不将编号当作PDF页码'
          }
        ]
      }
    ])
  }
  if (analysis) {
    analysis.imageTransforms = transformLog
    analysis.sourceHash = createHash('sha256').update(buffer).digest('hex')
  }
  process.stdout.write(JSON.stringify({ text, ...(analysis ? { analysis } : {}) }))
}
run()
  .catch((error) => {
    process.stdout.write(
      JSON.stringify({
        error:
          error?.name === 'PasswordException'
            ? 'PDF 有密码保护或密码错误，请在任务重试时输入正确密码，或先解密后导入'
            : String(error?.message || error)
      })
    )
    process.exitCode = 1
  })
  .finally(async () => {
    await worker?.terminate()
  })
