import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";
import { ToolDefinition, registerTool } from "./registry";

// ----- Input Schema -----
const inputSchema = z.object({
  notes: z
    .string()
    .min(10)
    .max(50_000)
    .describe("Meeting transcript or notes to extract action items from"),
  format: z
    .enum(["action_items_only", "full"])
    .default("full")
    .describe(
      "Output format: 'action_items_only' returns just the action items array; " +
      "'full' also includes a meeting summary and key decisions"
    ),
  participants: z
    .array(z.string())
    .optional()
    .describe("Known participant names to help with owner attribution (optional)"),
});

type Input = z.infer<typeof inputSchema>;

// ----- Handler -----
async function handler(input: Input) {
  const { notes, format, participants } = input;

  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const participantHint = participants?.length
    ? `\nKnown participants: ${participants.join(", ")}`
    : "";

  const systemPrompt =
    "You are an expert meeting analyst. Extract structured information from meeting notes or transcripts. " +
    "Always respond with valid JSON matching the exact schema requested. " +
    "Be concise and specific. For deadlines, use ISO 8601 date format if a specific date is mentioned, " +
    "or a relative description like 'end of week', 'next Monday', 'Q2'. " +
    "If no deadline is mentioned, omit the field. " +
    "For priority, use 'high', 'medium', or 'low' based on urgency signals in the text. " +
    "For owner, extract the person's name if mentioned, otherwise use 'Unassigned'.";

  const userPrompt = format === "full"
    ? `Extract all action items, key decisions, and a brief summary from the following meeting notes.${participantHint}

Return a JSON object with this exact structure:
{
  "meetingTitle": "inferred title or topic of the meeting",
  "summary": "2-3 sentence summary of what was discussed and decided",
  "actionItems": [
    {
      "id": 1,
      "owner": "person responsible (or 'Unassigned')",
      "task": "clear, specific description of what needs to be done",
      "deadline": "ISO date or relative deadline (omit if none mentioned)",
      "priority": "high | medium | low",
      "context": "brief context or reason for this task (omit if obvious)"
    }
  ],
  "decisions": [
    "decision 1",
    "decision 2"
  ]
}

Meeting notes:
${notes}`
    : `Extract all action items from the following meeting notes.${participantHint}

Return a JSON object with this exact structure:
{
  "meetingTitle": "inferred title or topic of the meeting",
  "actionItems": [
    {
      "id": 1,
      "owner": "person responsible (or 'Unassigned')",
      "task": "clear, specific description of what needs to be done",
      "deadline": "ISO date or relative deadline (omit if none mentioned)",
      "priority": "high | medium | low",
      "context": "brief context or reason for this task (omit if obvious)"
    }
  ]
}

Meeting notes:
${notes}`;

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  const rawText = message.content[0].type === "text" ? message.content[0].text : "";

  // Strip markdown code fences if present
  const jsonText = rawText.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Failed to parse structured response from LLM");
  }

  const actionItems = (parsed.actionItems as unknown[]) ?? [];

  return {
    meetingTitle: (parsed.meetingTitle as string) ?? "Untitled Meeting",
    actionItems,
    actionItemCount: actionItems.length,
    ...(format === "full" && {
      summary: (parsed.summary as string) ?? "",
      decisions: (parsed.decisions as string[]) ?? [],
    }),
  };
}

// ----- Register -----
const meetingActionItemsTool: ToolDefinition<Input> = {
  name: "meeting-action-items",
  description:
    "Extract structured action items, decisions, and a summary from meeting notes or transcripts. " +
    "Identifies owners, deadlines, and priorities. Powered by Claude.",
  version: "1.0.0",
  inputSchema,
  handler,
  metadata: {
    tags: ["meeting", "productivity", "extraction", "llm", "action-items"],
    pricing: "$0.05 per call",
    exampleInput: {
      notes: "Q3 planning meeting. Sarah will finalize the budget by Friday. John needs to set up the staging environment before the demo next Tuesday. We decided to postpone the mobile launch to Q4. Everyone agreed to use Jira for tracking.",
      format: "full",
    },
  },
};

registerTool(meetingActionItemsTool);

export default meetingActionItemsTool;
