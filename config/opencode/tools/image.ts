// Version: 1.0.1

import { tool } from "@opencode-ai/plugin"
import sharp from "sharp"
import path from "path"
import { readFile, writeFile } from "fs/promises"

const script = path.join(import.meta.dir, "image.py")

function generateRandomFilename(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  const randomValues = new Uint8Array(10)
  crypto.getRandomValues(randomValues)
  return Array.from(randomValues, (v) => chars[v % chars.length]).join("")
}

async function convertToPng(imagePath: string): Promise<string> {
  const ext = path.extname(imagePath).toLowerCase()
  if (ext === ".png") {
    return imagePath
  }

  const buffer = await readFile(imagePath)
  const pngBuffer = await sharp(buffer).png().toBuffer()
  const randomName = generateRandomFilename()
  const tempPath = path.join(path.dirname(imagePath), `opencode_image_${randomName}.png`)
  await writeFile(tempPath, pngBuffer)
  return tempPath
}

async function displayImage(args: { imagePath: string }, context: { worktree?: string; directory?: string }) {
  const base = context.worktree || context.directory || process.cwd()
  const inputPath = path.isAbsolute(args.imagePath)
    ? args.imagePath
    : path.join(base, args.imagePath)

  const pngPath = await convertToPng(inputPath)

  try {
    const proc = await Bun.$`python3 ${script} "${pngPath}"`.nothrow()
    const out = proc.stdout.toString().trim()
    const err = proc.stderr.toString().trim()
    return [out, err].filter(Boolean).join("\n")
  } finally {
    if (pngPath !== inputPath) {
      await Bun.$`rm "${pngPath}"`.nothrow()
    }
  }
}

export const display = tool({
  description: "This tool displays an image in the current terminal window. The image remains until image_dismiss is called. Use this tool to show the user images, pictures, graphs, etc., unless the user requests a different display method.",
  args: {
    imagePath: tool.schema.string().describe("Path to the image file to display"),
  },
  async execute(args, context) {
    try {
      return await displayImage(args, context)
    } catch (error: any) {
      return error.stderr || error.stdout || error.message
    }
  },
})

export const dismiss = tool({
  description: "This tool dismisses (removes, clears) the image currently displayed by the image_display tool in the current terminal window.",
  args: {},
  async execute() {
    try {
      const proc = await Bun.$`python3 ${script} --dismiss`.nothrow()
      const out = proc.stdout.toString().trim()
      const err = proc.stderr.toString().trim()
      return [out, err].filter(Boolean).join("\n")
    } catch (error: any) {
      return error.stderr || error.stdout || error.message
    }
  },
})
