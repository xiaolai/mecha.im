import type { Command } from "commander";
import type { CommandDeps } from "../types.js";
import { registerBusTopicCreateCommand } from "./bus-topic-create.js";
import { registerBusTopicListCommand } from "./bus-topic-list.js";
import { registerBusTopicPublishCommand } from "./bus-topic-publish.js";
import { registerBusTopicTailCommand } from "./bus-topic-tail.js";
import { registerBusQueueCreateCommand } from "./bus-queue-create.js";
import { registerBusQueueListCommand } from "./bus-queue-list.js";
import { registerBusQueueInspectCommand } from "./bus-queue-inspect.js";
import { registerBusQueueDeadLettersCommand } from "./bus-queue-dead-letters.js";
import { registerBusQueueDrainCommand } from "./bus-queue-drain.js";
import { registerBusQueueNackCommand } from "./bus-queue-nack.js";
import { registerBusQueuePushCommand } from "./bus-queue-push.js";

/** Register the 'bus' command group with topic and queue subgroups. */
export function registerBusCommand(program: Command, deps: CommandDeps): void {
  const bus = program
    .command("bus")
    .description("Manage the message bus (topics and queues)");

  const topic = bus
    .command("topic")
    .description("Manage pub/sub topics");

  registerBusTopicCreateCommand(topic, deps);
  registerBusTopicListCommand(topic, deps);
  registerBusTopicPublishCommand(topic, deps);
  registerBusTopicTailCommand(topic, deps);

  const queue = bus
    .command("queue")
    .description("Manage durable queues");

  registerBusQueueCreateCommand(queue, deps);
  registerBusQueuePushCommand(queue, deps);
  registerBusQueueListCommand(queue, deps);
  registerBusQueueInspectCommand(queue, deps);
  registerBusQueueDrainCommand(queue, deps);
  registerBusQueueNackCommand(queue, deps);
  registerBusQueueDeadLettersCommand(queue, deps);
}
