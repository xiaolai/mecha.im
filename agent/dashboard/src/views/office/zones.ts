import type { ActivityState, ClickableItem } from "./office-bridge";

export type ZoneId = "desk" | "phone" | "sofa" | "printer" | "server" | "door";

export interface ZoneDef {
  id: ZoneId;
  tileX: number;
  tileY: number;
  label: string;
  clickable: ClickableItem | null;
  facingDir: "down" | "left" | "right" | "up";
}

export const ZONES: Record<ZoneId, ZoneDef> = {
  desk:    { id: "desk",    tileX: 7,  tileY: 7,  label: "Desk",        clickable: "computer", facingDir: "up" },
  phone:   { id: "phone",   tileX: 12, tileY: 4,  label: "Phone",       clickable: "phone",    facingDir: "up" },
  sofa:    { id: "sofa",    tileX: 12, tileY: 11, label: "Sofa",        clickable: null,       facingDir: "down" },
  printer: { id: "printer", tileX: 2,  tileY: 11, label: "Printer",     clickable: "printer",  facingDir: "right" },
  server:  { id: "server",  tileX: 2,  tileY: 4,  label: "Server Rack", clickable: "server",   facingDir: "right" },
  door:    { id: "door",    tileX: 7,  tileY: 13, label: "Door",        clickable: "door",     facingDir: "down" },
};

const ACTIVITY_TO_ZONE: Record<ActivityState, ZoneId> = {
  idle: "sofa",
  thinking: "desk",
  calling: "phone",
  scheduled: "printer",
  error: "server",
  webhook: "door",
};

export function zoneForActivity(activity: ActivityState): ZoneId {
  return ACTIVITY_TO_ZONE[activity];
}
