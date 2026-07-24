export type LiveIconName =
  | "mic"
  | "screen"
  | "vision"
  | "voice"
  | "send"
  | "stop"
  | "plus"
  | "settings"
  | "handsFree";

const PATHS: Record<LiveIconName, string> = {
  mic: "M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3zm-7 9a7 7 0 0014 0M12 18v4m-4 0h8",
  screen: "M4 4h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm4 18h8m-4-4v4",
  vision: "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12zm9.5 3a3 3 0 100-6 3 3 0 000 6z",
  voice: "M4 10v4m4-7v10m4-14v18m4-14v10m4-7v4",
  send: "M3 11.5L21 3l-8.5 18-2-7.5L3 11.5zm7.5 2L21 3",
  stop: "M7 7h10v10H7z",
  plus: "M12 5v14M5 12h14",
  settings: "M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm7.4-3.5a7.3 7.3 0 00-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 00-1.7-1L15 3.5h-4L10.6 6a8 8 0 00-1.7 1L6.5 6 4.5 9.5l2 1.5a7.3 7.3 0 000 2l-2 1.5 2 3.4 2.4-1a8 8 0 001.7 1l.4 2.6h4l.4-2.6a8 8 0 001.7-1l2.4 1 2-3.4-2-1.5a7.3 7.3 0 00.1-1z",
  handsFree: "M5 10v4m3-7v10m4-13v16m4-13v10m3-7v4M3 4l18 16"
};

export function LiveIcon({ name }: { name: LiveIconName }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round" d={PATHS[name]} />
    </svg>
  );
}
