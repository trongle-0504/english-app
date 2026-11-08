import type { ToolContext } from '../data.ts'
import type { Args } from './args.ts'

/** One tool the coach model can call through MCP (shown to it as mcp_app_<name>). */
export interface CoachTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** The line shown in the chat while it runs ("Reading your Writing mistakes…"). */
  label: (args: Args) => string
  run: (args: Args, ctx: ToolContext) => Promise<Record<string, unknown>>
}

export const DAY = { type: 'string', description: 'A VN calendar day, YYYY-MM-DD.' }
