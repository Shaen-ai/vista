export type PriceQuoteMessageInput = {
  inquiry: string;
  roomType?: string;
  style?: string;
  projectId?: string | null;
  shareUrl?: string | null;
};

export function buildQuoteMessage(input: PriceQuoteMessageInput): string {
  const lines = [input.inquiry.trim()];
  if (input.roomType?.trim()) lines.push(`Room type: ${input.roomType.trim()}`);
  if (input.style?.trim()) lines.push(`Style: ${input.style.trim()}`);
  if (input.projectId?.trim()) lines.push(`Project ID: ${input.projectId.trim()}`);
  if (input.shareUrl?.trim()) lines.push(`Share URL: ${input.shareUrl.trim()}`);
  return lines.join("\n");
}
