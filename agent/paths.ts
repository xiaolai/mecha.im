const STATE_DIR = process.env.MECHA_STATE_DIR ?? "/state";

export const PATHS = {
  state: STATE_DIR,
  tasks: `${STATE_DIR}/tasks`,
  taskIndex: `${STATE_DIR}/tasks/index.json`,
  logs: `${STATE_DIR}/logs`,
  eventsLog: `${STATE_DIR}/logs/events.jsonl`,
  scheduleState: `${STATE_DIR}/logs/schedule-state.json`,
  costs: `${STATE_DIR}/costs.json`,
  characterConfig: `${STATE_DIR}/character.json`,
} as const;
