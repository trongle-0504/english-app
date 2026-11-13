// Pictures sent in a request body as base64: Listening question screenshots, Writing Task 1 chart pictures.
import { ApiError } from './api.ts'

/** A picture for a model or a store: base64 without a data: prefix. */
export interface Base64Image {
  mimeType: string
  data: string
}

const IMAGE_TYPES = /^image\/(png|jpe?g|webp|gif|heic|heif)$/
const MAX_IMAGE_BASE64 = 14_000_000 // ≈ 10 MB decoded

/** `images` from a request body: 1–`max` `{ mimeType, data }` with base64 data (a data: prefix is allowed). */
export function parseImages(value: unknown, max = 4): Base64Image[] {
  if (!Array.isArray(value) || !value.length) throw new ApiError(400, 'Add at least one image.')
  if (value.length > max) throw new ApiError(400, `At most ${max} images at a time.`)
  return value.map((item: { mimeType?: unknown; data?: unknown }, i) => {
    if (typeof item?.mimeType !== 'string' || typeof item.data !== 'string') throw new ApiError(400, `"images[${i}]" must be { mimeType, data }.`)
    if (!IMAGE_TYPES.test(item.mimeType)) throw new ApiError(400, `"images[${i}]" has unsupported type ${item.mimeType}.`)
    if (item.data.length > MAX_IMAGE_BASE64) throw new ApiError(400, `"images[${i}]" is larger than 10 MB.`)
    return { mimeType: item.mimeType, data: item.data.replace(/^data:[^,]*,/, '') }
  })
}
